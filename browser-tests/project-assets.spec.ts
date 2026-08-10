import AxeBuilder from "@axe-core/playwright";
import { expect, type Locator, type Page, test } from "@playwright/test";
import type { ProjectGeneration } from "../src/project-generation/contract";
import { projectGenerationSchema } from "../src/project-generation/schema";
import { createSourceRecord } from "../src/project-generation/source-records";
import { createProjectOverviewFixture } from "../tests/fixtures/project-overview";
import { withRebuiltPlanningLineage } from "../tests/planning-lineage-fixture";
import { browserArtifactPath } from "./browser-artifact-output";
import {
  projectRowEnvelope,
  projectSectionFromRequest,
  projectTargetFromRequest,
} from "./project-row-fixture";

const assetsFixture = (): ProjectGeneration => {
  const snapshot = createProjectOverviewFixture();
  if (snapshot.assets.validity !== "available") throw new Error("Expected Assets fixture.");
  const current = snapshot.assets.items[0];
  if (current === undefined) throw new Error("Expected current Asset.");
  const replacementSource = createSourceRecord(snapshot.basis.basisFingerprint, {
    kind: "asset",
    locator: ".bearing/state/assets.md",
    binding: { role: "asset", identity: "asset:replaced" },
    fragment: "asset:replaced",
  });
  const archivedSource = createSourceRecord(snapshot.basis.basisFingerprint, {
    kind: "asset",
    locator: ".bearing/state/assets.md",
    binding: { role: "asset", identity: "asset:archived" },
    fragment: "asset:archived",
  });
  return projectGenerationSchema.parse(
    withRebuiltPlanningLineage({
      ...snapshot,
      assets: {
        validity: "available",
        items: [
          current,
          {
            ...current,
            id: "asset:replaced",
            title: "Replaced Design",
            source: replacementSource.reference,
            sourceLocator: "docs/replaced.md",
            citations: [],
            disposition: "superseded",
            supersededBy: current.id,
            supersededAt: { availability: "unavailable" },
          },
          {
            ...current,
            id: "asset:archived",
            title: "Archived Research",
            source: archivedSource.reference,
            sourceLocator: "docs/archived.md",
            citations: [],
            disposition: "archived",
            archivedAt: { availability: "unavailable" },
          },
        ],
      },
      sources: [...snapshot.sources, replacementSource, archivedSource],
    }),
  );
};

const serveSnapshot = async (page: Page, snapshot: ProjectGeneration): Promise<void> => {
  await page.route("**/api/v1/projects/assets/read-model?section=*", (route) => {
    const section = projectSectionFromRequest(route.request().url());
    const target = projectTargetFromRequest(route.request().url());
    const envelope = projectRowEnvelope({ snapshot, section, entryId: "assets", target });
    if (!("rows" in envelope)) return route.fulfill({ json: envelope });
    return route.fulfill({
      json:
        section === "lineage" && target?.kind === "asset"
          ? {
              ...envelope,
              rows: {
                ...envelope.rows,
                assetSourceProbe: {
                  kind: "local",
                  locator: ".scratch/evidence/planning-model",
                  availability: "file",
                },
              },
            }
          : envelope,
    });
  });
};

const renderedBounds = async (controls: readonly Locator[]) =>
  Promise.all(
    controls.map(async (control) => {
      const box = await control.boundingBox();
      if (box === null) throw new Error("Expected a rendered Asset control.");
      return box;
    }),
  );

test("Assets defaults to Current and composes status, Evidence, and Search filters", async ({
  page,
}, testInfo) => {
  await serveSnapshot(page, assetsFixture());
  await page.goto("/projects/assets/assets");

  await expect(page.locator(".asset-title strong")).toHaveText(["Planning Model Evidence"]);
  const status = page.getByRole("combobox", { name: "Status" });
  const evidence = page.getByRole("combobox", { name: "Evidence" });
  await status.selectOption("replaced");
  await expect(page.locator(".asset-title strong")).toHaveText(["Replaced Design"]);
  await status.selectOption("archived");
  await expect(page.locator(".asset-title strong")).toHaveText(["Archived Research"]);
  await status.selectOption("all");
  await expect(page.locator(".asset-row")).toHaveCount(3);
  await evidence.selectOption("cited");
  await expect(page.locator(".asset-title strong")).toHaveText(["Planning Model Evidence"]);
  await page.getByPlaceholder("Find an Asset").fill("planning-model");
  await expect(page.locator(".asset-row")).toHaveCount(1);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({
    path: await browserArtifactPath(testInfo, "assets-filtered-current.png"),
    fullPage: true,
  });
});

test("Assets controls align wide and stack accessibly at narrow and zoom-equivalent widths", async ({
  page,
}) => {
  await serveSnapshot(page, assetsFixture());
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/projects/assets/assets");

  const search = page.getByRole("searchbox", { name: "Search" });
  const status = page.getByRole("combobox", { name: "Status" });
  const evidence = page.getByRole("combobox", { name: "Evidence" });
  const wideControls = await renderedBounds([search, status, evidence]);
  expect(Math.max(...wideControls.map((box) => box.y))).toBeLessThanOrEqual(
    Math.min(...wideControls.map((box) => box.y)) + 1,
  );

  await search.focus();
  await expect(search).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(status).toBeFocused();
  await expect(status).toHaveCSS("outline-width", "2px");
  await page.keyboard.press("Tab");
  await expect(evidence).toBeFocused();
  await evidence.selectOption("cited");
  await expect(page.locator(".asset-title strong")).toHaveText(["Planning Model Evidence"]);

  for (const width of [640, 375]) {
    await page.setViewportSize({ width, height: width === 375 ? 812 : 900 });
    const controls = await renderedBounds([search, status, evidence]);
    expect(controls[0]?.y).toBeLessThan(controls[1]?.y ?? 0);
    expect(controls[1]?.y).toBeLessThan(controls[2]?.y ?? 0);
    for (const box of controls) expect(box.height).toBeGreaterThanOrEqual(44);
    expect(
      await page.locator("html").evaluate((element) => element.scrollWidth > element.clientWidth),
    ).toBe(false);
  }

  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("exact Asset Detail shows its request-scoped source probe and keeps Preview explicit", async ({
  page,
}, testInfo) => {
  await serveSnapshot(page, assetsFixture());
  await page.goto("/projects/assets/assets");
  await page.getByRole("link", { name: /Planning Model Evidence/u }).click();

  await expect(page.getByRole("heading", { name: "Planning Model Evidence" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Source" })).toBeVisible();
  await expect(
    page.getByText(
      "Source availability is observation evidence; it does not change the canonical locator.",
    ),
  ).toBeVisible();
  await expect(page.getByText(".scratch/evidence/planning-model", { exact: true })).toBeVisible();
  await expect(page.getByText("file", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "View Content" })).toHaveAttribute(
    "href",
    "/preview/projects/assets/assets/asset%3Aplanning-model-evidence",
  );
  await page.screenshot({
    path: await browserArtifactPath(testInfo, "asset-detail-exact-source-probe.png"),
    fullPage: true,
  });
});
