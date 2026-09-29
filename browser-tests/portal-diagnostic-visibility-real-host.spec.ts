import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { planningLineageSubjectHref } from "../src/planning-lineage-route";
import { PROJECT_READ_MODEL_PROJECTION_VERSION } from "../src/project-read-model/contract";
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
      const effort = await readFile(join(root, ".bearing/state/efforts/fixture.md"), "utf8");
      for (const [scope, title] of [
        ["unobserved", "Unobserved Work"],
        ["unrelated", "Unrelated Work"],
      ] as const) {
        await cp(join(root, ".scratch/work"), join(root, `.scratch/${scope}`), { recursive: true });
        await writeFile(
          join(root, `.bearing/state/efforts/${scope}.md`),
          effort
            .replaceAll("effort:fixture", `effort:${scope}`)
            .replaceAll("Fixture Work", title)
            .replaceAll(".scratch/work", `.scratch/${scope}`),
        );
      }
      const gatePath = join(root, ".bearing/state/milestone-gates/fixture.md");
      await writeFile(
        gatePath,
        (await readFile(gatePath, "utf8")).replace(
          "  - effort:fixture",
          "  - effort:fixture\n  - effort:unobserved\n  - effort:unrelated",
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
      const providerRequests: unknown[] = [];
      page.on("request", (request) => {
        if (request.method() !== "GET") posts.push(`${request.method()} ${request.url()}`);
        if (
          request.method() === "POST" &&
          new URL(request.url()).pathname.endsWith("/provider-observation")
        ) {
          providerRequests.push(request.postDataJSON());
        }
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
      const diagnosticLink = queue
        .getByRole("link")
        .filter({ hasText: unavailable.message })
        .filter({ hasText: "Effort: Unobserved Work" });
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
      await expect(technical).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Open Technical Details" })).toBeFocused();
      const topbarAttention = page.getByRole("link", {
        name: `${rows.attentionCount} items need attention`,
      });
      await topbarAttention.focus();
      await expect(topbarAttention).toBeFocused();
      await topbarAttention.press("Enter");
      await expect(page).toHaveURL(`${host.url}/projects/diagnostics#attention-queue`);
      await expect(queue).toBeFocused();
      await expect(queue.locator(".attention-item")).toHaveCount(rows.attentionCount);
      await page.goBack();
      await expect(page.getByRole("heading", { name: "Unobserved Work", level: 1 })).toBeVisible();
      expect(posts).toEqual([]);
      expect(await readRepositorySourceBytes(root)).toEqual(sources);
      let recovery: Readonly<{ attentionCount: number; removedDiagnostic: string }> | undefined;
      if (!firstFailure) {
        const unrelatedDiagnostics = rows.diagnostics.filter(
          (item) => item.target === ".scratch/unrelated",
        );
        expect(unrelatedDiagnostics.length).toBeGreaterThan(0);
        const response = page.waitForResponse(
          (candidate) =>
            candidate.request().method() === "POST" &&
            new URL(candidate.url()).pathname.endsWith("/provider-observation"),
        );
        await page.getByRole("button", { name: "Refresh source", exact: true }).click();
        const result = await (await response).json();
        expect(result).toMatchObject({
          state: "completed",
          action: "source-load",
          acquisitionCount: 1,
        });
        await expect(page.locator(".source-observation-feedback")).toHaveText("1 source checked.");
        expect(providerRequests).toEqual([
          {
            version: 1,
            action: "source-load",
            binding: { provider: "matt-skills/v1", nativeScope: ".scratch/unobserved" },
          },
        ]);
        const refreshedRows = await queryPortalProjectRows(root, "overview");
        expect(refreshedRows.diagnostics).not.toContainEqual(
          expect.objectContaining({ reference: unavailable.reference }),
        );
        expect(refreshedRows.diagnostics).not.toContainEqual(
          expect.objectContaining({ code: unavailable.code, target: unavailable.target }),
        );
        expect(refreshedRows.attentionCount).toBe(rows.attentionCount - 1);
        expect(refreshedRows.attention).toContainEqual(
          expect.objectContaining({
            kind: "planning-review",
            id: "planning-review:fixture",
            title: "Review the current sequence",
          }),
        );
        // References belong to the new generation; the unrelated diagnostic's meaning remains.
        for (const { code, target, message, impact } of unrelatedDiagnostics) {
          const retained = refreshedRows.diagnostics.find(
            (item) => item.code === code && item.target === target,
          );
          expect(retained).toMatchObject({ code, target, message, impact });
          expect(refreshedRows.attention).toContainEqual({
            kind: "structural-diagnostic",
            diagnosticReference: retained?.reference,
          });
        }
        const stored = new DatabaseSync(projectReadModelPath(root));
        expect(
          stored
            .prepare(
              "SELECT observation_json FROM provider_evidence WHERE observation_id IS NOT NULL AND json_extract(observation_json, '$.binding.nativeScope') = ? ORDER BY binding_key, role",
            )
            .all(".scratch/work"),
        ).toEqual(originalObservations);
        stored.close();
        await page.getByRole("button", { name: "Open Technical Details" }).click();
        await expect(technical).not.toContainText(unavailable.reference);
        await technical.getByRole("button", { name: "Close Technical Details" }).click();
        await expect(technical).toHaveCount(0);
        await expect(page.getByRole("button", { name: "Open Technical Details" })).toBeFocused();
        await page
          .getByRole("link", {
            name: `${refreshedRows.attentionCount} items need attention`,
          })
          .click();
        await expect(page).toHaveURL(`${host.url}/projects/diagnostics#attention-queue`);
        await expect(queue.locator(".attention-item")).toHaveCount(refreshedRows.attentionCount);
        await expect(queue.getByText("Review the current sequence", { exact: true })).toBeVisible();
        await expect(queue.getByText("Effort: Unrelated Work · Impact: blocking")).toBeVisible();
        await expect(queue.getByText("Effort: Unobserved Work · Impact: blocking")).toHaveCount(0);
        expect(posts).toHaveLength(1);
        expect(await readRepositorySourceBytes(root)).toEqual(sources);
        recovery = {
          attentionCount: refreshedRows.attentionCount,
          removedDiagnostic: unavailable.reference,
        };
      }
      await writeFile(
        await browserArtifactPath(
          testInfo,
          `${firstFailure ? "failed" : "missing"}-observation-attention.json`,
        ),
        `${JSON.stringify({ diagnostics, attentionCount: rows.attentionCount, posts, providerRequests, recovery, existingEvidencePreserved: true, sourceBytesPreserved: true }, null, 2)}\n`,
      );
    } finally {
      await stopBuiltPortal(host);
      await Promise.all(
        [root, homeRoot].map((directory) => rm(directory, { recursive: true, force: true })),
      );
    }
  });
}

test("projection 11 with unchanged inputs requires explicit rebuild and scoped reacquisition", async () => {
  const root = await realpath(await copyPortalProjectFixture());
  try {
    await runBuiltBearing(["provider", "capture", "--repo", root, "--scope", ".scratch/work"]);
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
    await runBuiltBearing(["cache", "rebuild", "--repo", root]);
    const current = await queryPortalProjectRows(root, "overview");
    const unavailable = current.diagnostics.find(
      (item) =>
        item.target === ".scratch/unobserved" && item.code === "provider-observation-unavailable",
    );
    if (unavailable === undefined) throw new Error("Unobserved scope diagnostic is missing.");
    const cachePath = projectReadModelPath(root);
    const old = new DatabaseSync(cachePath);
    const basis = old.prepare("SELECT basis_fingerprint FROM read_model_metadata").get();
    expect(
      old
        .prepare("SELECT count(*) AS count FROM provider_evidence WHERE observation_id IS NOT NULL")
        .get(),
    ).toEqual({ count: 1 });
    // Model the previous committed semantics without changing its canonical/native input basis.
    old.prepare("UPDATE read_model_metadata SET projection_version = 11").run();
    old
      .prepare(
        "DELETE FROM project_attention WHERE json_extract(payload_json, '$.diagnosticReference') = ?",
      )
      .run(unavailable.reference);
    expect(old.prepare("SELECT basis_fingerprint FROM read_model_metadata").get()).toEqual(basis);
    old.close();
    const sources = await readRepositorySourceBytes(root);
    const cacheBytes = await readFile(cachePath);
    const inspect = await runHarnessCommand(
      "node",
      ["dist/cli.js", "inspect", "project", "--repo", root],
      { environment: process.env },
    );
    expect(inspect.exitCode).toBe(1);
    expect(JSON.parse(inspect.stdout)).toMatchObject({ outcome: "recovery-required" });
    expect(await readFile(cachePath)).toEqual(cacheBytes);
    expect(await readRepositorySourceBytes(root)).toEqual(sources);

    const rebuild = await runHarnessCommand(
      "node",
      ["dist/cli.js", "cache", "rebuild", "--repo", root],
      { environment: process.env },
    );
    expect(rebuild.exitCode).toBe(0);
    expect(JSON.parse(rebuild.stdout)).toMatchObject({
      outcome: "complete",
      result: { acquisitionCount: 0 },
    });
    const rebuilt = await queryPortalProjectRows(root, "overview");
    const missing = rebuilt.diagnostics.filter(
      (item) => item.code === "provider-observation-unavailable",
    );
    expect(missing.map((item) => item.target).toSorted()).toEqual([
      ".scratch/unobserved",
      ".scratch/work",
    ]);
    for (const diagnostic of missing) {
      expect(rebuilt.attention).toContainEqual({
        kind: "structural-diagnostic",
        diagnosticReference: diagnostic.reference,
      });
    }
    const reset = new DatabaseSync(cachePath);
    expect(reset.prepare("SELECT projection_version FROM read_model_metadata").get()).toEqual({
      projection_version: PROJECT_READ_MODEL_PROJECTION_VERSION,
    });
    expect(
      reset
        .prepare("SELECT count(*) AS count FROM provider_evidence WHERE observation_id IS NOT NULL")
        .get(),
    ).toEqual({ count: 0 });
    reset.close();
    const capture = await runHarnessCommand(
      "node",
      ["dist/cli.js", "provider", "capture", "--repo", root, "--scope", ".scratch/unobserved"],
      { environment: process.env },
    );
    expect(capture.exitCode).toBe(0);
    expect(JSON.parse(capture.stdout)).toMatchObject({
      outcome: "complete",
      result: { acquisitionCount: 1 },
    });
    const acquired = await queryPortalProjectRows(root, "overview");
    expect(
      acquired.diagnostics
        .filter((item) => item.code === "provider-observation-unavailable")
        .map((item) => item.target),
    ).toEqual([".scratch/work"]);
    expect(await readRepositorySourceBytes(root)).toEqual(sources);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
