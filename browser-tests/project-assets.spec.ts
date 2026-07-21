import AxeBuilder from "@axe-core/playwright";
import { expect, type Locator, type Page, test } from "@playwright/test";
import type { ProjectSnapshot } from "../src/project-snapshot/contract";
import { projectSnapshotSchema } from "../src/project-snapshot/schema";
import { createSourceRecord } from "../src/project-snapshot/source-records";
import { createProjectOverviewFixture } from "../tests/fixtures/project-overview";
import { browserArtifactPath } from "./browser-artifact-output";

const projectView = (snapshot: ProjectSnapshot) => ({
  project: { entryId: "assets", displayName: "Bearing fixture", availability: "available" },
  cache: {
    snapshot: { state: "available", snapshot },
    receipt: {
      schemaVersion: 1,
      producer: { packageName: "@lagrangee/bearing", packageVersion: "0.0.0-test" },
      completedAt: "2026-07-14T12:00:00+08:00",
      sitemap: { version: 1, fingerprint: snapshot.basis.sitemapFingerprint },
      reconciliation: "no-op",
    },
    retained: false,
  },
  diagnosticCounts: { blocking: 0, nonBlocking: 0, total: 0 },
});

const envelope = (snapshot: ProjectSnapshot) => ({
  version: 1,
  state: "ready",
  view: projectView(snapshot),
  validation: { due: false, cooldownRemainingMs: 30_000, inFlight: false },
  session: { csrfToken: "ticket-13-csrf" },
});

const assetsFixture = (): ProjectSnapshot => {
  const snapshot = createProjectOverviewFixture();
  if (snapshot.assets.validity !== "available") throw new Error("Expected Assets fixture.");
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
  return projectSnapshotSchema.parse({
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
          citations: [],
          kind: "product-design",
          owner: "effort:portal",
          producer: { kind: "planning-skill", name: "impeccable" },
          lifecycleSource: "registry",
          disposition: "available",
          displayLocation: "PRODUCT.md",
          contentAvailability: "available",
          adoptedByAuthorityIds: ["authority:product-design"],
          gatePassageEvidenceFor: [],
          citationCount: 0,
        },
      ],
    },
    sources: [...snapshot.sources, assetSource, authoritySource],
  });
};

const emptyFixture = (): ProjectSnapshot => {
  const snapshot = createProjectOverviewFixture();
  if (snapshot.efforts.validity === "invalid" || snapshot.gates.validity === "invalid") {
    throw new Error("Expected planning fixture.");
  }
  return projectSnapshotSchema.parse({
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
  });
};

const serveSnapshot = async (page: Page, current: () => ProjectSnapshot): Promise<void> => {
  await page.route("**/api/v1/projects/assets/snapshot", (route) =>
    route.fulfill({ json: envelope(current()) }),
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

test("Assets keeps stable rows searchable, filterable, inspectable, and read-only", async ({
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
  await serveSnapshot(page, () => snapshot);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/projects/assets/assets");

  await expect(page.getByRole("heading", { name: "Assets", level: 1 })).toBeVisible();
  await expect(page.locator(".asset-row .asset-title strong")).toHaveText([
    "Planning Model Evidence",
    "Uncited Product Context",
  ]);
  expect(
    await page
      .locator(".asset-row")
      .first()
      .evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(" ").length),
  ).toBe(5);
  expect((await page.locator(".asset-row").first().boundingBox())?.height).toBeLessThan(100);
  const search = page.getByPlaceholder("Find an Asset");
  const filter = page.getByLabel("Planning Citations");
  await focusByTab(page, search);
  await search.fill("generic-agent");
  await expect(page.locator(".asset-row")).toHaveCount(1);
  await search.fill("no such Asset");
  await expect(page.getByRole("heading", { name: "No matching Assets" })).toBeVisible();
  await page.getByRole("button", { name: "Clear filters" }).click();
  await focusByTab(page, filter);
  await filter.selectOption("uncited");
  await expect(page.locator(".asset-row")).toHaveCount(1);
  await expect(page.locator(".asset-row .citation-count")).toContainText("0 citations");
  await filter.selectOption("cited");
  await expect(page.locator(".asset-row .asset-title strong")).toHaveText([
    "Planning Model Evidence",
  ]);
  await filter.selectOption("all");

  const row = page.getByRole("button", { name: /Planning Model Evidence/u });
  await focusByTab(page, row);
  await page.keyboard.press("Enter");
  const inspector = page.getByRole("complementary", { name: "Selected context" });
  await expect(inspector.getByRole("heading", { name: "Planning Model Evidence" })).toBeVisible();
  await expect(inspector.getByText("asset:planning-model-evidence", { exact: true })).toBeVisible();
  await expect(inspector.getByText(/effort:model.+\.scratch\/model\/effort\.md/u)).toBeVisible();
  await expect(
    inspector
      .getByRole("heading", { name: "Gate Passage evidence" })
      .locator("..")
      .locator("li", { hasText: "gate:one" }),
  ).toBeVisible();
  await expect(inspector.getByRole("button", { name: /Resume in Agent Surface/u })).toBeDisabled();
  await expect(inspector.getByRole("button", { name: "Open native source" })).toBeDisabled();
  await expect(inspector.locator("a[href]")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(row).toBeFocused();
  expect(posts).toEqual([]);

  expect((await page.request.get("/api/v1/projects/assets/assets?path=PRODUCT.md")).status()).toBe(
    404,
  );
  expect((await page.request.get("/PRODUCT.md")).status()).toBe(404);
  await minimumTarget(row, 40);
  await page.screenshot({
    path: await browserArtifactPath(testInfo, "assets-1280.png"),
    fullPage: true,
  });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test("Assets preserves zero citations, keyboard return, and modal focus at review widths", async ({
  page,
}, testInfo) => {
  const snapshot = assetsFixture();
  await serveSnapshot(page, () => snapshot);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/projects/assets/assets");
  for (const width of [640, 375]) {
    await page.setViewportSize({ width, height: width === 375 ? 812 : 900 });
    await expectClosedNarrowNavigation(page);
    await expect(page.getByText("Read-only normalized snapshot", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Uncited Product Context.+0 citations/u }),
    ).toBeVisible();
    expect(
      await page.locator("html").evaluate((element) => element.scrollWidth > element.clientWidth),
    ).toBe(false);
    await page.screenshot({
      path: await browserArtifactPath(testInfo, `assets-${width}.png`),
      fullPage: true,
    });
  }

  const row = page.getByRole("button", { name: /Uncited Product Context.+0 citations/u });
  await row.focus();
  await page.keyboard.press("Space");
  const dialog = page.getByRole("dialog", { name: "Selected context" });
  const close = dialog.getByRole("button", { name: "Close selected context" });
  await expect(dialog.getByText("authority:product-design", { exact: true })).toBeVisible();
  await expect(close).toBeFocused();
  await expect(page.locator("main")).toHaveAttribute("inert", "");
  await page.keyboard.press("Tab");
  await expect(close).toBeFocused();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(row).toBeFocused();
  await minimumTarget(row, 44);

  const citedRow = page.getByRole("button", { name: /Planning Model Evidence.+1 citation/u });
  await citedRow.click();
  const relationDialog = page.getByRole("dialog", { name: "Selected context" });
  await relationDialog
    .getByRole("heading", { name: "Planning Citations" })
    .locator("..")
    .locator("li")
    .scrollIntoViewIfNeeded();
  expect(
    await relationDialog.evaluate((element) => element.scrollWidth > element.clientWidth),
  ).toBe(false);
  await page.keyboard.press("Escape");
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
  snapshot = projectSnapshotSchema.parse({
    ...available,
    assets: { validity: "partial", items: available.assets.items, issues: [issue] },
  });
  await page.reload();
  await expect(page.getByText(/Asset orientation is partial/u)).toBeVisible();
  await expect(page.locator(".asset-row")).toHaveCount(2);

  snapshot = projectSnapshotSchema.parse({
    ...available,
    assets: { validity: "invalid", issues: [issue] },
  });
  await page.reload();
  await expect(page.getByRole("heading", { name: "Assets unavailable" })).toBeVisible();
  await expect(page.getByPlaceholder("Find an Asset")).toHaveCount(0);
});
