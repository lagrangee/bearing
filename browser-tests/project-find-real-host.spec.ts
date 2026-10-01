import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { planningLineageSubjectHref } from "../src/planning-lineage-route";
import {
  inspectProjectReadModel,
  readProjectProviderEvidence,
} from "../src/project-read-model/store";
import {
  copyPortalProjectFixture,
  readRepositorySourceBytes,
} from "../tests/fixtures/repository-fixture";
import { browserArtifactPath } from "./browser-artifact-output";
import {
  runBuiltBearing,
  startBuiltPortal,
  stopBuiltPortal,
  writeCatalogFixture,
} from "./real-host-test-support";

test("real Host Find matches only published titles and keeps typed navigation and accessible interaction", async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  const root = await realpath(await copyPortalProjectFixture());
  const home = await mkdtemp(join(tmpdir(), "bearing-find-home-"));
  let host: Awaited<ReturnType<typeof startBuiltPortal>> | undefined;
  try {
    for (const [locator, previous] of [
      [".bearing/state/roadmaps/fixture.md", "Fixture Roadmap"],
      [".bearing/state/milestone-gates/fixture.md", "Fixture Gate"],
    ] as const) {
      const path = join(root, locator);
      await writeFile(
        path,
        (await readFile(path, "utf8")).replace(`Title: ${previous}`, "Title: 中文规划"),
      );
    }
    await runBuiltBearing(["provider", "capture", "--repo", root, "--scope", ".scratch/work"]);
    const beforeSources = await readRepositorySourceBytes(root);
    const beforeEvidence = await readProjectProviderEvidence(root);
    const beforeState = await inspectProjectReadModel(root);
    await writeCatalogFixture(home, [
      { entryId: "find", repoRoot: root, displayName: "Find fixture" },
    ]);
    host = await startBuiltPortal(home);
    const errors: string[] = [];
    const providerRequests: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    page.on("request", (request) => {
      if (new URL(request.url()).pathname.endsWith("/provider-observation"))
        providerRequests.push(request.url());
    });
    await page.goto(`${host.url}/projects/find`);
    await expect(
      page.getByRole("heading", { name: "Fixed Portal Project", level: 1 }),
    ).toBeVisible();
    await expect(page).toHaveTitle(/Bearing/u);
    const trigger = page.getByRole("button", { name: "Find in project" });
    await trigger.focus();
    await trigger.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Find in project" });
    const input = dialog.getByRole("searchbox", { name: "Search titles" });
    await expect(input).toBeFocused();
    for (const excluded of [
      "roadmap:fixture",
      ".scratch/work",
      "deterministic recovery",
      "Catalog and Snapshot operations",
    ]) {
      const response = page.waitForResponse((response) => {
        const url = new URL(response.url());
        return (
          url.pathname === "/api/v1/projects/find/find" &&
          url.searchParams.get("query") === excluded
        );
      });
      await input.fill(excluded);
      const body = await (await response).json();
      expect(body.state).toBe("ready");
      if (excluded === "roadmap:fixture") {
        // This ID can fuzzily match the unrelated "Wayfinder Map: Fixture Work" title.
        expect(body.results).not.toEqual(
          expect.arrayContaining([
            expect.objectContaining({ subject: { kind: "roadmap", id: excluded } }),
          ]),
        );
        await expect(dialog.getByRole("option")).toHaveCount(body.results.length);
        await expect(
          dialog.locator(
            `a[href="${planningLineageSubjectHref("find", { kind: "roadmap", id: excluded })}"]`,
          ),
        ).toHaveCount(0);
        continue;
      }
      expect(body.results).toEqual([]);
      await expect(
        dialog.getByText("No matching titles in Bearing-managed scope. Try another title."),
      ).toBeVisible();
      await expect(dialog.getByRole("option")).toHaveCount(0);
    }
    await input.fill("中文规划");
    await expect(dialog.getByRole("option")).toHaveCount(2);
    const hrefs = await dialog
      .getByRole("option")
      .evaluateAll((options) => options.map((option) => option.getAttribute("href")));
    expect(hrefs).toEqual(
      expect.arrayContaining([
        planningLineageSubjectHref("find", { kind: "roadmap", id: "roadmap:fixture" }),
        planningLineageSubjectHref("find", { kind: "gate", id: "gate:fixture" }),
      ]),
    );
    await expect(dialog.getByRole("option").filter({ hasText: "Roadmap" })).toHaveCount(1);
    await expect(dialog.getByRole("option").filter({ hasText: "Gate" })).toHaveCount(1);
    const firstActive = await input.getAttribute("aria-activedescendant");
    await input.press("ArrowDown");
    expect(await input.getAttribute("aria-activedescendant")).not.toBe(firstActive);
    await input.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
    await trigger.press("Enter");
    for (const width of [360, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await input.fill("Verify repository isolation");
      await expect(dialog.getByRole("option")).toHaveCount(1);
      const bounds = await dialog.boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds?.x ?? -1).toBeGreaterThanOrEqual(0);
      expect((bounds?.x ?? width) + (bounds?.width ?? width + 1)).toBeLessThanOrEqual(width);
      expect(
        await page.locator("html").evaluate((element) => element.scrollWidth > element.clientWidth),
      ).toBe(false);
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      await page.screenshot({
        path: await browserArtifactPath(testInfo, `title-find-${width}.png`),
      });
    }
    const response = await page.request.get(
      `${host.url}/api/v1/projects/find/find?query=Verify%20repository%20isolation`,
    );
    const body = await response.json();
    expect(response.ok()).toBe(true);
    expect(body.state).toBe("ready");
    expect(body.results).toHaveLength(1);
    expect(body.results[0]).not.toHaveProperty("excerpt");
    expect(body.results[0].href).not.toContain("#");
    await input.press("Enter");
    await expect(page).toHaveURL(
      `${host.url}${planningLineageSubjectHref("find", { kind: "native-subject", id: ".scratch/work/issues/01-verify-isolation.md" })}`,
    );
    await expect(
      page.getByRole("heading", { name: "Verify repository isolation", level: 1 }),
    ).toBeVisible();
    await expect(
      page.getByText("Can one repository remain trustworthy beside a degraded neighbor?", {
        exact: true,
      }),
    ).toBeVisible();
    expect(providerRequests).toEqual([]);
    expect(errors).toEqual([]);
    expect(await readProjectProviderEvidence(root)).toEqual(beforeEvidence);
    expect(await inspectProjectReadModel(root)).toEqual(beforeState);
    expect(await readRepositorySourceBytes(root)).toEqual(beforeSources);
  } finally {
    if (host !== undefined) await stopBuiltPortal(host);
    await rm(root, { recursive: true, force: true });
    await rm(home, { recursive: true, force: true });
  }
});
