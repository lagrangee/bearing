import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { planningLineageSubjectHref } from "../src/planning-lineage-route";
import { queryPortalProjectRows } from "../src/project-read-model/portal";
import { projectReadModelPath } from "../src/project-read-model/store";
import {
  copyPortalProjectFixture,
  readRepositorySourceBytes,
} from "../tests/fixtures/repository-fixture";
import { browserArtifactPath } from "./browser-artifact-output";
import {
  runBuiltBearing,
  runHarnessCommand,
  startBuiltPortal,
  stopBuiltPortal,
  writeCatalogFixture,
} from "./real-host-test-support";

for (const firstFailure of [false, true]) {
  test(`real Host exposes ${firstFailure ? "first acquisition failure" : "missing Observation"} through the same managed Attention`, async ({
    page,
  }, testInfo) => {
    const root = await realpath(await copyPortalProjectFixture());
    const homeRoot = await mkdtemp(join(tmpdir(), "bearing-diagnostic-visibility-home-"));
    let host: Awaited<ReturnType<typeof startBuiltPortal>> | undefined;
    try {
      await runBuiltBearing(["provider", "capture", "--repo", root, "--scope", ".scratch/work"]);
      const original = new DatabaseSync(projectReadModelPath(root));
      const originalObservations = original
        .prepare(
          "SELECT observation_json FROM provider_evidence WHERE observation_id IS NOT NULL ORDER BY binding_key, role",
        )
        .all();
      original.close();
      await cp(join(root, ".scratch/work"), join(root, ".scratch/unobserved"), { recursive: true });
      const effort = await readFile(join(root, ".bearing/state/efforts/fixture.md"), "utf8");
      await writeFile(
        join(root, ".bearing/state/efforts/unobserved.md"),
        effort
          .replaceAll("effort:fixture", "effort:unobserved")
          .replaceAll("Fixture Work", "Unobserved Work")
          .replaceAll(".scratch/work", ".scratch/unobserved"),
      );
      const gatePath = join(root, ".bearing/state/milestone-gates/fixture.md");
      await writeFile(
        gatePath,
        (await readFile(gatePath, "utf8")).replace(
          "  - effort:fixture",
          "  - effort:fixture\n  - effort:unobserved",
        ),
      );
      await mkdir(join(root, ".bearing/state/planning-reviews"));
      await writeFile(
        join(root, ".bearing/state/planning-reviews/fixture.md"),
        `---\nType: planning-review\nID: planning-review:fixture\nTitle: Review the current sequence\nStatus: pending\nQuestion: Should the project continue?\nScope: project\nInputs: []\nInput fingerprint: sha256:${"0".repeat(64)}\n---\n\n# Planning Review\n`,
      );
      await runBuiltBearing(["cache", "rebuild", "--repo", root]);
      const initialRows = await queryPortalProjectRows(root, "overview");
      expect(initialRows.diagnostics.some((item) => item.target === ".scratch/unobserved")).toBe(
        true,
      );
      const before = new DatabaseSync(projectReadModelPath(root));
      expect(
        before
          .prepare(
            "SELECT observation_json FROM provider_evidence WHERE observation_id IS NOT NULL ORDER BY binding_key, role",
          )
          .all(),
      ).toEqual(originalObservations);
      const evidenceBefore = before
        .prepare("SELECT * FROM provider_evidence ORDER BY binding_key, role")
        .all();
      // Compatible rebuild preserves the existing Observation and performs no acquisition.
      before.close();
      const rebuild = await runHarnessCommand(
        "node",
        ["dist/cli.js", "cache", "rebuild", "--repo", root],
        { environment: process.env },
      );
      expect(rebuild.exitCode).toBe(0);
      expect(JSON.parse(rebuild.stdout).result.acquisitionCount).toBe(0);
      const after = new DatabaseSync(projectReadModelPath(root));
      expect(
        after.prepare("SELECT * FROM provider_evidence ORDER BY binding_key, role").all(),
      ).toEqual(evidenceBefore);
      after.close();
      if (firstFailure) {
        const entry = join(homeRoot, "first-failure.ts");
        const artifact = join(homeRoot, "first-failure.mjs");
        await writeFile(
          entry,
          `
import { captureProjectProviderScopes } from ${JSON.stringify(join(process.cwd(), "src/project-read-model/provider-operations.ts"))};
import { defaultMattProviderFactory, ProviderObservationAcquisitionUnavailableError } from ${JSON.stringify(join(process.cwd(), "src/provider-acquisition.ts"))};
const result = await captureProjectProviderScopes(process.argv[2], [".scratch/unobserved"], {
  providerFactory: (input) => ({ ...defaultMattProviderFactory(input), capture: async () => {
    throw new ProviderObservationAcquisitionUnavailableError("The source cannot be reached.");
  } }),
});
console.log(JSON.stringify(result));
`,
        );
        const build = await runHarnessCommand(
          "bun",
          ["build", entry, "--target=node", "--format=esm", `--outfile=${artifact}`],
          { environment: process.env },
        );
        expect(build.exitCode).toBe(0);
        const failedCapture = await runHarnessCommand("node", [artifact, root], {
          environment: process.env,
        });
        expect(failedCapture.exitCode).toBe(0);
        const result = JSON.parse(failedCapture.stdout);
        expect(result.outcome).toBe("unfulfilled");
        expect(result.result.acquisitionCount).toBe(1);
        expect(result.diagnostics).toContainEqual(
          expect.objectContaining({
            code: "provider-acquisition-failed",
            target: ".scratch/unobserved",
            message: "Provider observation acquisition failed: The source cannot be reached.",
          }),
        );
      }
      const rows = await queryPortalProjectRows(root, "overview");
      const diagnostics = rows.diagnostics.filter((item) => item.target === ".scratch/unobserved");
      const unavailable = diagnostics.find(
        (item) => item.code === "provider-observation-unavailable",
      );
      if (unavailable === undefined)
        throw new Error(
          `Missing scope diagnostic was omitted: ${JSON.stringify(rows.diagnostics)}`,
        );
      expect(diagnostics.every((item) => item.impact === "blocking")).toBe(true);

      for (const diagnostic of diagnostics) {
        expect(rows.attention).toContainEqual({
          kind: "structural-diagnostic",
          diagnosticReference: diagnostic.reference,
        });
      }
      expect(rows.attention).toContainEqual(
        expect.objectContaining({ kind: "planning-review", id: "planning-review:fixture" }),
      );
      const sources = await readRepositorySourceBytes(root);
      await writeCatalogFixture(homeRoot, [
        { entryId: "diagnostics", repoRoot: root, displayName: "Diagnostic fixture" },
      ]);
      host = await startBuiltPortal(homeRoot);
      const posts: string[] = [];
      page.on("request", (request) => {
        if (request.method() !== "GET") posts.push(`${request.method()} ${request.url()}`);
      });
      const detailHref = planningLineageSubjectHref("diagnostics", {
        kind: "effort",
        id: "effort:unobserved",
      });
      await page.goto(`${host.url}/projects/diagnostics`);
      const queue = page.getByRole("region", { name: "Attention" });
      await expect(queue.locator(".attention-item")).toHaveCount(rows.attentionCount);
      await expect(
        page.getByRole("link", { name: `${rows.attentionCount} items need attention` }),
      ).toBeVisible();
      await expect(queue.getByText("Review the current sequence", { exact: true })).toBeVisible();
      const diagnosticLink = queue.getByRole("link").filter({ hasText: unavailable.message });
      await expect(diagnosticLink).toContainText("Effort: Unobserved Work · Impact: blocking");
      await expect(diagnosticLink).toHaveAttribute("href", detailHref);
      await expect(queue.getByRole("button")).toHaveCount(0);
      for (const width of [1280, 640, 375]) {
        await page.setViewportSize({ width, height: 900 });
        await diagnosticLink.focus();
        await expect(diagnosticLink).toBeFocused();
        await expect(diagnosticLink).toBeVisible();
        expect(
          await page
            .locator("html")
            .evaluate((element) => element.scrollWidth > element.clientWidth),
        ).toBe(false);
      }
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      await page.screenshot({
        path: await browserArtifactPath(
          testInfo,
          `${firstFailure ? "failed" : "missing"}-attention-375.png`,
        ),
        fullPage: true,
      });
      await page.setViewportSize({ width: 1280, height: 900 });
      await diagnosticLink.press("Enter");
      await expect(page.getByRole("heading", { name: "Unobserved Work", level: 1 })).toBeVisible();
      await expect(page.getByRole("button", { name: "Refresh source", exact: true })).toBeVisible();
      if (firstFailure)
        await expect(
          page
            .getByText("Provider observation acquisition failed: The source cannot be reached.", {
              exact: false,
            })
            .first(),
        ).toBeVisible();
      await page.getByRole("button", { name: "Open Technical Details" }).click();
      const technical = page.getByRole("complementary", { name: "Technical Details" });
      for (const diagnostic of diagnostics) {
        await expect(technical).toContainText(diagnostic.reference);
        await expect(technical).toContainText(diagnostic.message);
        await expect(technical).toContainText(`Target: ${diagnostic.target}`);
        await expect(technical).toContainText(diagnostic.impact);
      }
      await technical.getByRole("button", { name: "Close Technical Details" }).click();
      const topbarAttention = page.getByRole("link", {
        name: `${rows.attentionCount} items need attention`,
      });
      await topbarAttention.focus();
      await topbarAttention.press("Enter");
      await expect(page).toHaveURL(`${host.url}/projects/diagnostics#attention-queue`);
      await expect(queue).toBeFocused();
      await expect(queue.locator(".attention-item")).toHaveCount(rows.attentionCount);
      await page.goBack();
      await expect(page.getByRole("heading", { name: "Unobserved Work", level: 1 })).toBeVisible();
      expect(posts).toEqual([]);
      expect(await readRepositorySourceBytes(root)).toEqual(sources);
      await writeFile(
        await browserArtifactPath(
          testInfo,
          `${firstFailure ? "failed" : "missing"}-observation-attention.json`,
        ),
        `${JSON.stringify({ diagnostics, attentionCount: rows.attentionCount, posts, existingEvidencePreserved: true, sourceBytesPreserved: true }, null, 2)}\n`,
      );
    } finally {
      await stopBuiltPortal(host);
      await Promise.all(
        [root, homeRoot].map((directory) => rm(directory, { recursive: true, force: true })),
      );
    }
  });
}
