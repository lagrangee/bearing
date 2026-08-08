import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import type { ProjectSnapshot } from "../src/project-snapshot/contract";
import { projectSnapshotSchema } from "../src/project-snapshot/schema";
import { createSourceRecord } from "../src/project-snapshot/source-records";
import { createProjectOverviewFixture } from "../tests/fixtures/project-overview";
import { withRebuiltPlanningLineage } from "../tests/planning-lineage-fixture";
import { browserArtifactPath } from "./browser-artifact-output";
import {
  projectRowEnvelope,
  projectSectionFromRequest,
  projectTargetFromRequest,
} from "./project-row-fixture";

const assetsFixture = (): ProjectSnapshot => {
  const snapshot = createProjectOverviewFixture();
  if (snapshot.assets.validity !== "available") throw new Error("Expected Assets fixture.");
  const current = snapshot.assets.items[0];
  if (current === undefined) throw new Error("Expected current Asset.");
  const replacementSource = createSourceRecord(snapshot.basis.sitemapFingerprint, {
    kind: "asset",
    locator: ".bearing/state/assets.md",
    binding: { role: "asset", identity: "asset:replaced" },
    fragment: "asset:replaced",
  });
  const archivedSource = createSourceRecord(snapshot.basis.sitemapFingerprint, {
    kind: "asset",
    locator: ".bearing/state/assets.md",
    binding: { role: "asset", identity: "asset:archived" },
    fragment: "asset:archived",
  });
  return projectSnapshotSchema.parse(
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

const serveSnapshot = async (page: Page, snapshot: ProjectSnapshot): Promise<void> => {
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

test("exact Asset Detail shows its request-scoped source probe and keeps Preview explicit", async ({
  page,
}, testInfo) => {
  await serveSnapshot(page, assetsFixture());
  await page.goto("/projects/assets/assets");
  await page.getByRole("link", { name: /Planning Model Evidence/u }).click();

  await expect(page.getByRole("heading", { name: "Planning Model Evidence" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Source" })).toBeVisible();
  await expect(page.getByText("Current local source: file.")).toBeVisible();
  await expect(page.getByText("Locator: .scratch/evidence/planning-model")).toBeVisible();
  await expect(page.getByRole("link", { name: "View Content" })).toHaveAttribute(
    "href",
    "/preview/projects/assets/assets/asset%3Aplanning-model-evidence",
  );
  await page.screenshot({
    path: await browserArtifactPath(testInfo, "asset-detail-exact-source-probe.png"),
    fullPage: true,
  });
});
