import AxeBuilder from "@axe-core/playwright";
import { expect, type Locator, type Page, test } from "@playwright/test";
import type { ProjectSnapshot } from "../src/project-snapshot/contract";
import { projectSnapshotSchema } from "../src/project-snapshot/schema";
import { createSourceRecord } from "../src/project-snapshot/source-records";
import { createProjectOverviewFixture } from "../tests/fixtures/project-overview";
import {
  parseRebuiltPlanningLineageFixture,
  withRebuiltPlanningLineage,
} from "../tests/planning-lineage-fixture";
import { browserArtifactPath } from "./browser-artifact-output";
import {
  projectFindEnvelope,
  projectRowEnvelope,
  projectSectionFromRequest,
  projectTargetFromRequest,
} from "./project-row-fixture";

const envelope = (
  snapshot: ProjectSnapshot,
  section: Parameters<typeof projectRowEnvelope>[0]["section"],
  target?: Parameters<typeof projectRowEnvelope>[0]["target"],
) => projectRowEnvelope({ snapshot, section, entryId: "assets", target });

const assetsFixture = (): ProjectSnapshot => {
  const snapshot = createProjectOverviewFixture();
  if (snapshot.assets.validity !== "available" || snapshot.reviews.validity === "invalid") {
    throw new Error("Expected Assets and Planning Reviews fixture.");
  }
  const assetSource = createSourceRecord(snapshot.basis.sitemapFingerprint, {
    kind: "asset",
    locator: ".bearing/state/assets.md",
    binding: { role: "asset", identity: "asset:uncited-context" },
    fragment: "asset:uncited-context",
  });
  const authoritySource = createSourceRecord(snapshot.basis.sitemapFingerprint, {
    kind: "canonical",
    locator: ".bearing/state/authorities/product-design.md",
    binding: { role: "authority", identity: "authority:product-design" },
  });
  const adoptionReviewSource = createSourceRecord(snapshot.basis.sitemapFingerprint, {
    kind: "canonical",
    locator: ".bearing/state/planning-reviews/adopt-product-design.md",
    binding: {
      role: "planning-review",
      identity: "planning-review:adopt-product-design",
    },
  });
  return projectSnapshotSchema.parse(
    withRebuiltPlanningLineage({
      ...snapshot,
      authorities: {
        validity: "available",
        items: [
          {
            id: "authority:product-design",
            title: "Product Design",
            source: authoritySource.reference,
            citations: [],
            scope: "Accepted product-design direction.",
            baselineAssetIds: ["asset:uncited-context"],
            adoptions: [
              {
                assetId: "asset:uncited-context",
                decisionReference: "planning-review:adopt-product-design",
              },
            ],
          },
        ],
      },
      reviews: {
        ...snapshot.reviews,
        items: [
          ...snapshot.reviews.items,
          {
            id: "planning-review:adopt-product-design",
            title: "Adopt product design",
            source: adoptionReviewSource.reference,
            citations: [],
            status: "completed",
            scope: "Adopt the product-design baseline.",
            resolution: {
              acceptedDecision: "Adopt the product-design Asset.",
              acceptedAt: { availability: "unavailable" },
              rationale: "The Asset governs the accepted product-design direction.",
              changedReferences: ["authority:product-design"],
            },
          },
        ],
      },
      assets: {
        validity: "available",
        items: [
          ...snapshot.assets.items,
          {
            id: "asset:uncited-context",
            title: "Uncited Product Context",
            source: assetSource.reference,
            evidenceRoles: ["authority-adoption"],
            citations: [],
            authorityAdoptions: [
              {
                authorityId: "authority:product-design",
                decisionReference: "planning-review:adopt-product-design",
                source: authoritySource.reference,
              },
            ],
            passageEvidence: [],
            kind: "product-design",
            owner: "effort:portal",
            producer: { kind: "planning-skill", name: "impeccable" },
            lifecycleSource: "registry",
            registeredAt: { availability: "unavailable" },
            disposition: "available",
            displayLocation: "PRODUCT.md",
            contentAvailability: "available",
            contentShape: "file",
          },
        ],
      },
      sources: [...snapshot.sources, assetSource, authoritySource, adoptionReviewSource],
    }),
  );
};

const emptyFixture = (): ProjectSnapshot => {
  const snapshot = createProjectOverviewFixture();
  if (snapshot.efforts.validity === "invalid" || snapshot.gates.validity === "invalid") {
    throw new Error("Expected planning fixture.");
  }
  return projectSnapshotSchema.parse(
    withRebuiltPlanningLineage({
      ...snapshot,
      efforts: {
        ...snapshot.efforts,
        items: snapshot.efforts.items.map((effort) => ({ ...effort, citations: [] })),
      },
      gates: {
        ...snapshot.gates,
        items: snapshot.gates.items.map((gate) =>
          gate.passage === undefined
            ? gate
            : { ...gate, passage: { ...gate.passage, evidenceAssetIds: [] } },
        ),
      },
      assets: { validity: "available", items: [] },
    }),
  );
};

const serveSnapshot = async (page: Page, current: () => ProjectSnapshot): Promise<void> => {
  await page.route("**/api/v1/projects/assets/read-model?section=*", (route) =>
    route.fulfill({
      json: envelope(
        current(),
        projectSectionFromRequest(route.request().url()),
        projectTargetFromRequest(route.request().url()),
      ),
    }),
  );
};

const focusByTab = async (page: Page, target: Locator): Promise<void> => {
  for (let index = 0; index < 50; index += 1) {
    await page.keyboard.press("Tab");
    if (await target.evaluate((element) => document.activeElement === element)) return;
  }
  throw new Error("Expected target in the document tab order.");
};

const minimumTarget = async (target: Locator, size: number): Promise<void> => {
  const box = await target.boundingBox();
  if (box === null) throw new Error("Expected rendered target bounds.");
  expect(box.width).toBeGreaterThanOrEqual(size);
  expect(box.height).toBeGreaterThanOrEqual(size);
};

const expectClosedNarrowNavigation = async (page: Page): Promise<void> => {
  const navigation = page.locator(".project-nav");
  const main = page.locator("#main-content");
  await expect(navigation).toHaveAttribute("aria-hidden", "true");
  await expect(navigation).toHaveAttribute("inert", "");
  await expect(page.locator(".nav-scrim")).toBeHidden();
  await expect(main).not.toHaveAttribute("inert", "");
  await expect(main).toHaveAttribute("aria-hidden", "false");
  await expect
    .poll(() =>
      navigation.evaluate((element) => {
        const navigationBounds = element.getBoundingClientRect();
        const mainBounds = document.querySelector("#main-content")?.getBoundingClientRect();
        if (mainBounds === undefined) return null;
        const overlapsMain =
          navigationBounds.left < mainBounds.right &&
          navigationBounds.right > mainBounds.left &&
          navigationBounds.top < mainBounds.bottom &&
          navigationBounds.bottom > mainBounds.top;
        return { navigationOutsideViewport: navigationBounds.right <= 0, overlapsMain };
      }),
    )
    .toEqual({ navigationOutsideViewport: true, overlapsMain: false });
};

test("Assets keeps semantic rows searchable, directly navigable, and read-only", async ({
  context,
  page,
}, testInfo) => {
  const snapshot = assetsFixture();
  const posts: string[] = [];
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST") posts.push(request.url());
  });
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await context.grantPermissions(["clipboard-read", "clipboard-write"], {
    origin: "http://127.0.0.1:4180",
  });
  await serveSnapshot(page, () => snapshot);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/projects/assets/assets");

  await expect(page.getByRole("heading", { name: "Assets", level: 1 })).toBeVisible();
  await expect(page.locator(".asset-row .asset-title strong")).toHaveText([
    "Planning Model Evidence",
    "Uncited Product Context",
  ]);
  await expect(page.locator(".asset-title small")).toHaveText([
    "verification-report",
    "product-design",
  ]);
  await expect(page.locator(".asset-owner")).toHaveText(["Model ready", "Web Portal Validation"]);
  await expect(page.locator(".asset-evidence-summary")).toHaveText([
    "Planning Citation · Passage Evidence",
    "Authority Adoption",
  ]);
  await expect(page.getByText(".scratch/evidence/planning-model", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Quick Look/u })).toHaveCount(0);
  await expect(page.getByText("Showing 2 of 2", { exact: false })).toHaveCount(0);
  expect((await page.locator(".asset-row").first().boundingBox())?.height).toBeLessThan(100);
  const search = page.getByPlaceholder("Find an Asset");
  const filter = page.getByRole("combobox", { name: "Evidence", exact: true });
  await focusByTab(page, search);
  await search.fill("verification-report");
  await expect(page.locator(".asset-row")).toHaveCount(1);
  await search.fill("no such Asset");
  await expect(page.getByRole("heading", { name: "No matching Assets" })).toBeVisible();
  await page.getByRole("button", { name: "Clear filters" }).click();
  await focusByTab(page, filter);
  await filter.selectOption("uncited");
  await expect(page.locator(".asset-row")).toHaveCount(1);
  await expect(page.getByRole("status")).toContainText("1 of 2 Assets");
  await filter.selectOption("cited");
  await expect(page.locator(".asset-row .asset-title strong")).toHaveText([
    "Planning Model Evidence",
  ]);
  await filter.selectOption("authority-baselines");
  await expect(page.locator(".asset-row .asset-title strong")).toHaveText([
    "Uncited Product Context",
  ]);
  await filter.selectOption("passage-evidence");
  await expect(page.locator(".asset-row .asset-title strong")).toHaveText([
    "Planning Model Evidence",
  ]);
  await filter.selectOption("execution-evidence");
  await expect(page.getByRole("heading", { name: "No matching Assets" })).toBeVisible();
  await filter.selectOption("all");

  const row = page.getByRole("link", { name: /Planning Model Evidence.+Planning Citation/u });
  await focusByTab(page, row);
  await minimumTarget(row, 40);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/lineage\/asset\/asset%3Aplanning-model-evidence$/u);
  await expect(page.getByRole("heading", { name: "Planning Model Evidence" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Ownership and Purpose" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Evidence Roles" })).toBeVisible();
  await expect(page.getByText(".scratch/evidence/planning-model", { exact: true })).toHaveCount(0);
  const citation = page
    .getByLabel("Lineage Context")
    .getByRole("link", { name: /^Planning Model is cited by/u });
  await expect(citation).toBeVisible();
  await citation.click();
  await expect(page).toHaveURL(/\/lineage\/effort\/effort%3Amodel$/u);
  await page.goBack();
  await expect(page.getByRole("heading", { name: "Planning Model Evidence" })).toBeVisible();
  const viewContent = page.getByRole("link", { name: /View Content/u });
  await expect(viewContent).toHaveAttribute("target", "_blank");
  await expect(viewContent).toHaveAttribute("rel", "noopener noreferrer");
  await expect(viewContent).toHaveAttribute(
    "href",
    "/preview/projects/assets/assets/asset%3Aplanning-model-evidence",
  );
  await page.getByRole("button", { name: "Open Technical Details" }).click();
  const inspector = page.getByRole("complementary", { name: "Technical Details" });
  await expect(inspector.getByText("asset:planning-model-evidence", { exact: true })).toBeVisible();
  await expect(
    inspector.getByText(".scratch/evidence/planning-model", { exact: true }),
  ).toBeVisible();
  await expect(
    inspector.getByText("executor-profile / generic-agent", { exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  const previewPagePromise = context.waitForEvent("page");
  await viewContent.click();
  const previewPage = await previewPagePromise;
  await expect.poll(() => previewPage.url()).toContain("/preview/projects/assets/assets/");
  await previewPage.close();
  expect(posts).toEqual([]);

  expect((await page.request.get("/api/v1/projects/assets/assets?path=PRODUCT.md")).status()).toBe(
    404,
  );
  expect((await page.request.get("/PRODUCT.md")).status()).toBe(404);
  await page.screenshot({
    path: await browserArtifactPath(testInfo, "assets-1280.png"),
    fullPage: true,
  });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test("Assets keeps semantic direct rows and Technical Details keyboard-safe at review widths", async ({
  page,
}, testInfo) => {
  const snapshot = assetsFixture();
  await serveSnapshot(page, () => snapshot);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/projects/assets/assets");
  for (const width of [640, 375]) {
    await page.setViewportSize({ width, height: width === 375 ? 812 : 900 });
    await expectClosedNarrowNavigation(page);
    await expect(
      page.getByRole("link", { name: /Uncited Product Context.+Authority Adoption/u }),
    ).toBeVisible();
    await expect(
      page.locator(".asset-owner").filter({ hasText: "Web Portal Validation" }),
    ).toBeVisible();
    expect(
      await page.locator("html").evaluate((element) => element.scrollWidth > element.clientWidth),
    ).toBe(false);
    await page.screenshot({
      path: await browserArtifactPath(testInfo, `assets-${width}.png`),
      fullPage: true,
    });
  }

  const row = page.getByRole("link", { name: /Uncited Product Context.+Authority Adoption/u });
  await row.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Uncited Product Context" })).toBeVisible();
  await page.getByRole("button", { name: "Open Technical Details" }).press("Enter");
  const dialog = page.getByRole("dialog", { name: "Technical Details" });
  const close = dialog.getByRole("button", { name: "Close Technical Details" });
  await expect(close).toBeFocused();
  await expect(page.locator("main")).toHaveAttribute("inert", "");
  await page.keyboard.press("Tab");
  await expect(close).toBeFocused();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Open Technical Details" })).toBeFocused();
  await minimumTarget(page.getByRole("button", { name: "Open Technical Details" }), 44);
});

test("Asset detail distinguishes absent and expected-unreadable content", async ({ page }) => {
  let snapshot = assetsFixture();
  await serveSnapshot(page, () => snapshot);
  const detailPath = "/projects/assets/lineage/asset/asset%3Aplanning-model-evidence";
  const withContentAvailability = (contentAvailability: "missing" | "unreadable") => {
    if (snapshot.assets.validity === "invalid") throw new Error("Expected Assets fixture.");
    return parseRebuiltPlanningLineageFixture({
      ...snapshot,
      assets: {
        ...snapshot.assets,
        items: snapshot.assets.items.map((asset) =>
          asset.id === "asset:planning-model-evidence"
            ? { ...asset, contentAvailability, contentShape: "unavailable" }
            : asset,
        ),
      },
    });
  };

  snapshot = withContentAvailability("missing");
  await page.goto(detailPath);
  await expect(page.getByRole("heading", { name: "Planning Model Evidence" })).toBeVisible();
  await expect(page.getByRole("link", { name: /View Content/u })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Content unavailable" })).toHaveCount(0);

  snapshot = withContentAvailability("unreadable");
  await page.reload();
  await expect(page.getByRole("heading", { name: "Content unavailable" })).toBeVisible();
  await expect(page.getByRole("link", { name: /View Content/u })).toHaveCount(0);
  await expect(page.getByText(/^Cause:/u)).toBeVisible();
  await expect(page.getByText(/^Impact:/u)).toContainText("other Asset semantics remain available");
  await expect(page.getByText(/^Recovery:/u)).toContainText("Technical Details");
});

test("Assets distinguishes empty, partial, invalid, and filtered-empty states", async ({
  page,
}) => {
  let snapshot = emptyFixture();
  await serveSnapshot(page, () => snapshot);
  await page.goto("/projects/assets/assets");
  await expect(page.getByRole("heading", { name: "No registered Assets" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "No matching Assets" })).toHaveCount(0);

  const available = assetsFixture();
  if (available.assets.validity !== "available") throw new Error("Expected Assets fixture.");
  const issue = { code: "invalid-asset", target: "assets", message: "One entry is invalid." };
  snapshot = projectSnapshotSchema.parse(
    withRebuiltPlanningLineage({
      ...available,
      assets: { validity: "partial", items: available.assets.items, issues: [issue] },
    }),
  );
  await page.reload();
  await expect(page.getByText(/Asset orientation is partial/u)).toBeVisible();
  await expect(page.locator(".asset-row")).toHaveCount(2);
  await page
    .getByRole("combobox", { name: "Evidence", exact: true })
    .selectOption("execution-evidence");
  await expect(page.getByText(/Execution Evidence coverage is incomplete/u)).toBeVisible();
  await expect(page.getByRole("heading", { name: "No confirmed matching Assets" })).toBeVisible();

  snapshot = projectSnapshotSchema.parse(
    withRebuiltPlanningLineage({
      ...available,
      authorities: { validity: "invalid", issues: [issue] },
    }),
  );
  await page.reload();
  await page
    .getByRole("combobox", { name: "Evidence", exact: true })
    .selectOption("authority-baselines");
  await expect(page.getByText(/Authority baseline coverage is incomplete/u)).toBeVisible();
  await expect(page.getByRole("heading", { name: "No confirmed matching Assets" })).toBeVisible();

  await page.getByRole("combobox", { name: "Evidence", exact: true }).selectOption("cited");
  await expect(page.getByText(/Planning Citation coverage is incomplete/u)).toBeVisible();
  await expect(page.locator(".asset-row .asset-title strong")).toHaveText([
    "Planning Model Evidence",
  ]);
  await page.getByRole("combobox", { name: "Evidence", exact: true }).selectOption("uncited");
  await expect(
    page.getByText(/No Asset can be confirmed uncited until every citation-owning collection/u),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "No confirmed matching Assets" })).toBeVisible();

  snapshot = projectSnapshotSchema.parse(
    withRebuiltPlanningLineage({
      ...available,
      gates:
        available.gates.validity === "invalid"
          ? available.gates
          : { validity: "partial", items: available.gates.items, issues: [issue] },
    }),
  );
  await page.reload();
  await page
    .getByRole("combobox", { name: "Evidence", exact: true })
    .selectOption("passage-evidence");
  await expect(page.getByText(/Gate Passage evidence coverage is incomplete/u)).toBeVisible();
  await expect(page.locator(".asset-row .asset-title strong")).toHaveText([
    "Planning Model Evidence",
  ]);

  snapshot = projectSnapshotSchema.parse(
    withRebuiltPlanningLineage({
      ...available,
      assets: { validity: "invalid", issues: [issue] },
    }),
  );
  await page.reload();
  await expect(page.getByRole("heading", { name: "Assets unavailable" })).toBeVisible();
  await expect(page.getByPlaceholder("Find an Asset")).toHaveCount(0);
});

test("Project Find recovers typed identity and semantic context without leaving the project surface", async ({
  page,
}) => {
  let snapshot = assetsFixture();
  const posts: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST") posts.push(request.url());
  });
  await serveSnapshot(page, () => snapshot);
  await page.route("**/api/v1/projects/assets/find?*", (route) =>
    route.fulfill({
      json: projectFindEnvelope(
        snapshot,
        "assets",
        new URL(route.request().url()).searchParams.get("query") ?? "",
      ),
    }),
  );
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/projects/assets/assets");

  const find = page.getByRole("button", { name: "Find in project" });
  await find.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Find in project" });
  const input = dialog.getByRole("searchbox", {
    name: "Search identity, title, or semantic phrase",
  });
  await expect(input).toBeFocused();
  await input.fill("asset:uncited-context");
  const result = dialog.getByRole("option").filter({ hasText: "Uncited Product Context" }).first();
  await expect(result).toBeVisible();
  await expect(result).toContainText("Asset");
  await expect(result).toContainText("Portal Project");
  await expect(result).not.toContainText("asset:uncited-context");
  await expect(result).not.toContainText("Identity");
  await expect(result).not.toContainText("Snapshot");
  await expect(result).not.toContainText("Target section unavailable");
  expect(
    await page.locator("html").evaluate((element) => element.scrollWidth > element.clientWidth),
  ).toBe(false);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  await page.keyboard.press("Escape");
  await expect(find).toBeFocused();
  await find.press("Enter");
  const reopened = page.getByRole("dialog", { name: "Find in project" });
  const reopenedInput = reopened.getByRole("searchbox", {
    name: "Search identity, title, or semantic phrase",
  });
  await reopenedInput.fill("whole-project orientation");
  const roadmap = reopened.getByRole("option").filter({ hasText: "Portal Evolution" }).first();
  await expect(roadmap).toContainText("Prove whole-project orientation.");
  await expect(roadmap).not.toContainText("Intent");
  await page.keyboard.press("ArrowDown");
  await expect(reopenedInput).toHaveAttribute("aria-activedescendant", /project-find-result-/u);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(
    /\/projects\/assets\/lineage\/roadmap\/roadmap%3Aportal#roadmap\.intent$/u,
  );
  await expect(page.getByRole("heading", { name: "Portal Evolution" })).toBeVisible();

  await page.goBack();
  const restoredDialog = page.getByRole("dialog", { name: "Find in project" });
  await expect(restoredDialog).toBeVisible();
  await expect(
    restoredDialog.getByRole("searchbox", {
      name: "Search identity, title, or semantic phrase",
    }),
  ).toHaveValue("whole-project orientation");
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Find in project" }).press("Enter");
  const auditDialog = page.getByRole("dialog", { name: "Find in project" });
  const auditInput = auditDialog.getByRole("searchbox", {
    name: "Search identity, title, or semantic phrase",
  });
  await auditInput.fill("complete coverage");
  const auditResult = auditDialog.getByRole("option").filter({ hasText: "Planning Audit" });
  await expect(auditResult).toContainText("complete coverage");
  await auditResult.click();
  await expect(page).toHaveURL(/\/projects\/assets\/audit$/u);
  await expect(page.getByRole("heading", { name: "Planning Audit" })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("dialog", { name: "Find in project" })).toBeVisible();
  await page.keyboard.press("Escape");

  if (snapshot.efforts.validity === "invalid") throw new Error("Expected Effort fixture.");
  snapshot = parseRebuiltPlanningLineageFixture({
    ...snapshot,
    efforts: {
      ...snapshot.efforts,
      items: snapshot.efforts.items.map((effort) =>
        effort.id === "effort:portal"
          ? {
              ...effort,
              workBinding: undefined,
              workBindingState: { state: "invalid" as const, reason: "missing" as const },
            }
          : effort,
      ),
    },
  });
  expect(
    snapshot.providerObservations.some(
      (observation) => observation.binding.nativeScope === ".scratch/portal",
    ),
  ).toBe(true);
  await page.reload();
  await page.getByRole("button", { name: "Find in project" }).press("Enter");
  const standaloneDialog = page.getByRole("dialog", { name: "Find in project" });
  const standaloneInput = standaloneDialog.getByRole("searchbox", {
    name: "Search identity, title, or semantic phrase",
  });
  await standaloneInput.fill(".scratch/portal/issues/03-gate.md");
  await expect(standaloneDialog.getByRole("option")).toHaveCount(0);
  await standaloneInput.fill("Pass the integration gate");
  await expect(standaloneDialog.getByRole("option")).toHaveCount(0);
  await expect(
    standaloneDialog.getByText("No matches in Bearing-managed scope", { exact: false }),
  ).toBeVisible();
  await page.keyboard.press("Escape");

  snapshot = projectSnapshotSchema.parse(
    withRebuiltPlanningLineage({
      ...snapshot,
      assets: {
        validity: "invalid",
        issues: [{ code: "invalid-assets", target: "assets", message: "Assets unavailable." }],
      },
    }),
  );
  await page.reload();
  await page.getByRole("button", { name: "Find in project" }).press("Enter");
  const degradedDialog = page.getByRole("dialog", { name: "Find in project" });
  await degradedDialog
    .getByRole("searchbox", { name: "Search identity, title, or semantic phrase" })
    .fill("no such managed object");
  await expect(
    degradedDialog.getByText("Asset content is unavailable", { exact: false }),
  ).toBeVisible();
  await expect(
    degradedDialog.getByText("repair the affected project source in Agent Surface", {
      exact: false,
    }),
  ).toBeVisible();
  expect(posts).toEqual([]);
});
