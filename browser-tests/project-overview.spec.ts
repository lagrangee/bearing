import AxeBuilder from "@axe-core/playwright";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { createNativeScopeDiscoveryObservation } from "../src/native-scope-discovery";
import { createProviderScopeObservation } from "../src/native-work-provider";
import type { ProjectSnapshot } from "../src/project-snapshot/contract";
import { buildNativeScopeDiscoveryProjection } from "../src/project-snapshot/native-scope-discovery";
import { buildMattNativeSourceRecords } from "../src/project-snapshot/native-work-sources";
import { mergeSourceRecords } from "../src/project-snapshot/source-records";
import { createProjectOverviewFixture } from "../tests/fixtures/project-overview";
import { parseRebuiltPlanningLineageFixture } from "../tests/planning-lineage-fixture";
import { browserArtifactPath } from "./browser-artifact-output";

const completedAt = "2026-07-13T20:00:00+08:00";

const expectMinimumTarget = async (target: Locator, size: number): Promise<void> => {
  const box = await target.boundingBox();
  if (box === null) throw new Error("Expected an interactive target with rendered bounds.");
  expect(box.width).toBeGreaterThanOrEqual(size);
  expect(box.height).toBeGreaterThanOrEqual(size);
};

const focusByTab = async (page: Page, target: Locator): Promise<void> => {
  for (let index = 0; index < 40; index += 1) {
    await page.keyboard.press("Tab");
    if (await target.evaluate((element) => document.activeElement === element)) return;
  }
  throw new Error("Expected the target to be reachable through the document tab order.");
};

const projectView = () => {
  const snapshot = createProjectOverviewFixture();
  if (snapshot.summary.validity !== "available") throw new Error("Expected Summary fixture.");
  return {
    project: { entryId: "overview", displayName: "Bearing 控制台", availability: "available" },
    cache: {
      snapshot: {
        state: "available",
        snapshot: {
          ...snapshot,
          summary: {
            ...snapshot.summary,
            value: {
              ...snapshot.summary.value,
              purpose: "让用户和 agent 每天快速看清 whole project。",
            },
          },
        },
      },
      receipt: {
        schemaVersion: 1,
        producer: { packageName: "@lagrangee/bearing", packageVersion: "0.0.0-test" },
        completedAt,
        sitemap: { version: 1, fingerprint: snapshot.basis.sitemapFingerprint },
        reconciliation: "no-op",
      },
      retained: false,
    },
    diagnosticCounts: { blocking: 1, nonBlocking: 0, total: 1 },
  };
};

const readyEnvelope = (due: boolean) => ({
  version: 1,
  state: "ready",
  view: projectView(),
  validation: { due, cooldownRemainingMs: due ? 0 : 30_000, inFlight: false },
  session: { csrfToken: "ticket-11-csrf" },
});

const completedEnvelope = () => ({
  version: 1,
  state: "completed",
  mode: "ensure-current",
  outcome: "checked",
  snapshotDisposition: "reused",
  view: projectView(),
  validation: { due: false, cooldownRemainingMs: 30_000, inFlight: false },
});

const discoveredProjectView = () => {
  const view = projectView();
  if (view.cache.snapshot.state !== "available") throw new Error("Expected Snapshot fixture.");
  const snapshot = view.cache.snapshot.snapshot;
  const observation = createNativeScopeDiscoveryObservation({
    provider: "matt-skills/v1",
    state: "available",
    observedAt: "2026-07-31T08:30:00.000Z",
    freshness: "current",
    coverage: "complete",
    scopes: [
      {
        identity: ".scratch/discovered",
        binding: { provider: "matt-skills/v1", nativeScope: ".scratch/discovered" },
        locator: ".scratch/discovered",
        driver: "local",
        rootRole: "wayfinder-map",
        title: "Discovered delivery",
        lifecycle: "open",
        classification: "map",
        admission: ["contract-map"],
        subjects: [
          {
            identity: ".scratch/discovered/map.md",
            locator: ".scratch/discovered/map.md",
            title: "Discovered delivery",
            classification: "map",
            lifecycle: "open",
            parentIdentity: null,
            admission: ["contract-map"],
          },
        ],
      },
      {
        identity: ".scratch/research",
        binding: { provider: "matt-skills/v1", nativeScope: ".scratch/research" },
        locator: ".scratch/research",
        driver: "local",
        rootRole: "standalone-request",
        title: "Discovered research",
        lifecycle: "closed",
        classification: "request",
        admission: ["contract-standalone"],
        subjects: [
          {
            identity: ".scratch/research/issue.md",
            locator: ".scratch/research/issue.md",
            title: "Discovered research",
            classification: "request",
            lifecycle: "closed",
            parentIdentity: null,
            admission: ["contract-standalone"],
          },
        ],
      },
    ],
    diagnostics: [],
  });
  const nativeScopeDiscovery = buildNativeScopeDiscoveryProjection(
    {
      observationId: observation.id,
      provider: observation.provider,
      state: observation.state,
      observedAt: observation.observedAt,
      validators: observation.validators,
      freshness: observation.freshness.assessment,
      coverage: observation.coverage.assessment,
      scopes: observation.scopes,
      diagnostics: observation.diagnostics,
      confirmedEmpty: observation.confirmedEmpty,
      latestAttempt: null,
    },
    snapshot.efforts,
  );
  const discoveredSnapshot = parseRebuiltPlanningLineageFixture({
    ...snapshot,
    nativeScopeDiscovery,
  } as ProjectSnapshot);
  return {
    ...view,
    cache: {
      ...view.cache,
      snapshot: {
        ...view.cache.snapshot,
        snapshot: discoveredSnapshot,
      },
    },
  };
};

const discoveredEnvelope = () => ({
  ...completedEnvelope(),
  view: discoveredProjectView(),
});

const inspectedProjectView = (latestAttemptFailed = false) => {
  const view = discoveredProjectView();
  if (view.cache.snapshot.state !== "available") throw new Error("Expected Snapshot fixture.");
  const snapshot = view.cache.snapshot.snapshot;
  const template = snapshot.providerObservations.find(
    (observation) => observation.binding.nativeScope === ".scratch/portal",
  );
  if (template === undefined || (template.state !== "available" && template.state !== "partial")) {
    throw new Error("Expected Local provider fixture.");
  }
  const projection = JSON.parse(
    JSON.stringify(template.projection).replaceAll(".scratch/portal", ".scratch/discovered"),
  ) as typeof template.projection;
  const observation = createProviderScopeObservation({
    provider: "matt-skills/v1",
    binding: { provider: "matt-skills/v1", nativeScope: ".scratch/discovered" },
    observedAt: "2026-07-31T08:35:00.000Z",
    sourceRevision: "fixture:inspection",
    validators: [],
    state: "available",
    freshness: {
      assessment: "current",
      evidence: [{ kind: "fixture", value: "targeted-inspection" }],
    },
    coverage: {
      assessment: "complete",
      dimensions: [{ key: "scope-membership", state: "covered" }],
    },
    completion: "complete",
    diagnostics: [],
    projection,
  });
  const nativeScopeInspections = {
    observations: [observation],
    selections: [
      {
        provider: "matt-skills/v1" as const,
        nativeScope: observation.binding.nativeScope,
        observationId: observation.id,
        effectiveFreshness: latestAttemptFailed ? ("undetermined" as const) : ("current" as const),
        latestAttempt: {
          intent: "native-scope-inspection" as const,
          attemptedAt: latestAttemptFailed
            ? "2026-07-31T08:40:00.000Z"
            : "2026-07-31T08:35:00.000Z",
          outcome: latestAttemptFailed ? ("failed" as const) : ("succeeded" as const),
          diagnostics: latestAttemptFailed
            ? [
                {
                  code: "native-scope-inspection.incomplete",
                  impact: "blocking" as const,
                  target: ".scratch/discovered",
                  message: "The latest detail refresh could not complete.",
                },
              ]
            : [],
        },
      },
    ],
  };
  const nativeScopeDiscovery =
    snapshot.nativeScopeDiscovery.state === "never-run"
      ? snapshot.nativeScopeDiscovery
      : {
          ...snapshot.nativeScopeDiscovery,
          scopes: snapshot.nativeScopeDiscovery.scopes.map((candidate) => ({
            ...candidate,
            detailAvailability:
              candidate.summary.binding.nativeScope === ".scratch/discovered"
                ? ("details-inspected" as const)
                : candidate.detailAvailability,
          })),
        };
  const inspectedSnapshot = parseRebuiltPlanningLineageFixture({
    ...snapshot,
    nativeScopeDiscovery,
    nativeScopeInspections,
    sources: mergeSourceRecords([
      snapshot.sources,
      buildMattNativeSourceRecords([observation], snapshot.basis.sitemapFingerprint),
    ]),
  } as ProjectSnapshot);
  return {
    ...view,
    cache: {
      ...view.cache,
      snapshot: { state: "available" as const, snapshot: inspectedSnapshot },
    },
  };
};

const inspectedEnvelope = (latestAttemptFailed = false) => ({
  version: 1,
  state: "completed",
  mode: "force",
  outcome: "applied",
  reconciliation: "applied",
  snapshotDisposition: "materialized",
  view: inspectedProjectView(latestAttemptFailed),
  validation: { due: false, cooldownRemainingMs: 30_000, inFlight: false },
});

const unavailableInspectionEnvelope = () => {
  const view = discoveredProjectView();
  if (view.cache.snapshot.state !== "available") throw new Error("Expected Snapshot fixture.");
  const snapshot = view.cache.snapshot.snapshot;
  const failedSnapshot = parseRebuiltPlanningLineageFixture({
    ...snapshot,
    nativeScopeInspections: {
      observations: [],
      selections: [
        {
          provider: "matt-skills/v1",
          nativeScope: ".scratch/discovered",
          observationId: null,
          effectiveFreshness: "undetermined",
          latestAttempt: {
            intent: "native-scope-inspection",
            attemptedAt: "2026-07-31T08:35:00.000Z",
            outcome: "failed",
            diagnostics: [
              {
                code: "native-scope-inspection.acquisition-failed",
                impact: "blocking",
                target: ".scratch/discovered",
                message: "Native scope detail acquisition failed.",
              },
            ],
          },
        },
      ],
    },
  } as ProjectSnapshot);
  return {
    ...inspectedEnvelope(),
    view: {
      ...view,
      cache: {
        ...view.cache,
        snapshot: { state: "available" as const, snapshot: failedSnapshot },
      },
    },
  };
};

const failedEnvelope = () => ({
  version: 1,
  state: "failed",
  mode: "ensure-current",
  outcome: "failed",
  error: { code: "snapshot-write-failed", message: "Automatic validation failed." },
  view: {
    ...projectView(),
    cache: { ...projectView().cache, retained: true },
  },
  validation: { due: true, cooldownRemainingMs: 30_000, inFlight: false },
});

const forcedEnvelope = () => ({
  version: 1,
  state: "completed",
  mode: "force",
  outcome: "no-op",
  reconciliation: "no-op",
  snapshotDisposition: "reused",
  view: projectView(),
  validation: { due: false, cooldownRemainingMs: 30_000, inFlight: false },
});

test("Overview keeps cache visible, preserves reading order, and uses contextual inspectors", async ({
  page,
}, testInfo) => {
  let syncCalls = 0;
  let releaseSync = () => {};
  const syncGate = new Promise<void>((resolve) => {
    releaseSync = resolve;
  });
  await page.route("**/api/v1/projects/overview/snapshot", (route) =>
    route.fulfill({ json: readyEnvelope(true) }),
  );
  await page.route("**/api/v1/projects/overview/sync", async (route) => {
    syncCalls += 1;
    await syncGate;
    await route.fulfill({ json: completedEnvelope() });
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/projects/overview");

  await expect(page.getByRole("heading", { name: "Portal Project", level: 1 })).toBeVisible();
  await expect(page.locator(".project-switcher code")).toHaveText("Bearing 控制台");
  await expect(page.locator(".project-switcher strong")).toHaveText("Portal Project");
  await expect(page.locator(".project-operation")).toContainText("Checking");
  await expect(
    page.getByText("让用户和 agent 每天快速看清 whole project。", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("region", { name: "Attention" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Next work" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Active Roadmaps" })).toBeVisible();
  expect(
    await page
      .locator(".overview-page > *")
      .evaluateAll((elements) => elements.map((element) => element.className)),
  ).toEqual([
    "project-intro",
    "attention-queue",
    "overview-section discovered-work",
    "guidance-section",
    "roadmap-landscape",
  ]);
  await expect(page.locator("main").getByText("Planning Audit", { exact: true })).toHaveCount(0);
  await expect(page.locator("main").getByText("Assets", { exact: true })).toHaveCount(0);
  await expect(page.locator(".roadmap-landscape-item h3")).toHaveText([
    "Second Horizon",
    "Portal Evolution",
  ]);
  await expect(page.getByText("No Gate horizon is available.", { exact: true })).toBeVisible();
  await expectMinimumTarget(page.getByRole("button", { name: "View Project Summary" }), 40);
  await expectMinimumTarget(page.getByRole("button", { name: /Inspect the horizon/u }), 40);
  const firstGate = page.locator(".gate-node").first();
  await expectMinimumTarget(firstGate, 40);
  await firstGate.hover();
  await expect(firstGate.locator(".gate-copy strong")).toHaveCSS(
    "text-decoration-line",
    "underline",
  );
  await page.mouse.move(0, 0);
  releaseSync();
  await expect(page.locator(".project-operation")).toHaveText("Up to date");

  const primary = page.getByRole("button", { name: /Finish Overview/u });
  await primary.click();
  let inspector = page.getByRole("complementary", { name: "Selected context" });
  await expect(inspector.getByRole("heading", { name: "Finish Overview" })).toBeVisible();
  await expect(inspector.getByRole("button", { name: /Resume in Agent Surface/u })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(primary).toBeFocused();

  const alternative = page.getByRole("button", { name: /Inspect the horizon/u });
  await alternative.click();
  inspector = page.getByRole("complementary", { name: "Selected context" });
  await expect(inspector.getByRole("heading", { name: "Inspect the horizon" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(alternative).toBeFocused();

  const source = page.getByRole("button", { name: "View Project Summary" });
  await source.click();
  inspector = page.getByRole("complementary", { name: "Selected context" });
  await expect(
    inspector.getByText(".bearing/state/project-summary.md", { exact: true }),
  ).toBeVisible();
  await expect(inspector.getByText(/grants no filesystem authority/u)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(source).toBeFocused();

  await expect.poll(() => syncCalls).toBe(1);
  await expect(page.locator(".project-operation")).toHaveCount(0, { timeout: 3_000 });
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
  await page.mouse.move(0, 0);
  await page.screenshot({
    path: await browserArtifactPath(testInfo, "overview-1280.png"),
    fullPage: true,
  });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  for (const width of [768, 375]) {
    await page.setViewportSize({ width, height: width === 375 ? 812 : 900 });
    await page.waitForTimeout(250);
    await expect(page.locator(".portal-shell")).not.toHaveClass(/nav-open/u);
    const navigationBox = await page.locator("#project-navigation").boundingBox();
    expect(navigationBox === null || navigationBox.x + navigationBox.width <= 0).toBe(true);
    expect(
      await page.locator("html").evaluate((element) => element.scrollWidth > element.clientWidth),
    ).toBe(false);
    await page.screenshot({
      path: await browserArtifactPath(testInfo, `overview-${width}.png`),
      fullPage: true,
    });
  }
  await expectMinimumTarget(page.getByRole("button", { name: "View Project Summary" }), 44);
  await expectMinimumTarget(page.getByRole("button", { name: /Inspect the horizon/u }), 44);
  await expectMinimumTarget(page.locator(".gate-node").first(), 44);
  await expect(page.locator(".updated-date")).toBeHidden();
  const syncBox = await page.getByRole("button", { name: "Sync" }).boundingBox();
  if (syncBox === null) throw new Error("Expected the mobile Sync target.");
  expect(syncBox.x + syncBox.width).toBeLessThanOrEqual(365);

  await alternative.click();
  const dialog = page.getByRole("dialog", { name: "Selected context" });
  await expect(dialog).toBeVisible();
  await expect(page.locator("main")).toHaveAttribute("aria-hidden", "true");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(alternative).toBeFocused();
});

test("desktop Guidance inspector preserves non-modal keyboard semantics", async ({ page }) => {
  // Given: a current cached Overview at the desktop breakpoint.
  await page.route("**/api/v1/projects/overview/snapshot", (route) =>
    route.fulfill({ json: readyEnvelope(false) }),
  );
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/projects/overview");
  const primary = page.getByRole("button", { name: /Finish Overview/u });
  await focusByTab(page, primary);

  // When: the primary Guidance action is activated using only the keyboard.
  await page.keyboard.press("Enter");

  // Then: the desktop inspector receives focus without becoming a modal focus trap.
  const inspector = page.getByRole("complementary", { name: "Selected context" });
  const close = inspector.getByRole("button", { name: "Close selected context" });
  await expect(inspector.getByRole("heading", { name: "Finish Overview" })).toBeVisible();
  await expect(close).toBeFocused();
  expect(await page.locator("main").getAttribute("inert")).toBeNull();
  await expect(page.locator("main")).toHaveAttribute("aria-hidden", "false");
  await page.keyboard.press("Tab");
  expect(await inspector.evaluate((element) => !element.contains(document.activeElement))).toBe(
    true,
  );
  await page.keyboard.press("Shift+Tab");
  await expect(close).toBeFocused();

  // External focus changes must not strand an open inspector outside its key boundary.
  await close.evaluate((element) => element.blur());
  await expect(page.locator("body")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(inspector).toHaveCount(0);
  await expect(primary).toBeFocused();
});

test("Project Summary source inspector is reachable and reversible by keyboard", async ({
  page,
}) => {
  // Given: a current cached Overview whose provenance action is in the document tab order.
  await page.route("**/api/v1/projects/overview/snapshot", (route) =>
    route.fulfill({ json: readyEnvelope(false) }),
  );
  await page.goto("/projects/overview");
  const source = page.getByRole("button", { name: "View Project Summary" });
  await focusByTab(page, source);

  // When: the source action is activated using only the keyboard.
  await page.keyboard.press("Enter");

  // Then: source provenance is inspectable and Escape returns focus to its trigger.
  const inspector = page.getByRole("complementary", { name: "Selected context" });
  await expect(
    inspector.getByText(".bearing/state/project-summary.md", { exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(inspector).toHaveCount(0);
  await expect(source).toBeFocused();
});

test("narrow Guidance dialog contains focus and remains accessible while open", async ({
  page,
}) => {
  // Given: a current cached Overview at the 375px narrow-window breakpoint.
  await page.route("**/api/v1/projects/overview/snapshot", (route) =>
    route.fulfill({ json: readyEnvelope(false) }),
  );
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/projects/overview");
  const alternative = page.getByRole("button", { name: /Inspect the horizon/u });
  await focusByTab(page, alternative);

  // When: an alternative Guidance action is activated with Space.
  await page.keyboard.press("Space");

  // Then: the dialog traps focus, passes Axe, and Escape restores the trigger.
  const dialog = page.getByRole("dialog", { name: "Selected context" });
  const close = dialog.getByRole("button", { name: "Close selected context" });
  await expect(dialog.getByRole("heading", { name: "Inspect the horizon" })).toBeVisible();
  await expect(close).toBeFocused();
  await expect(page.locator("main")).toHaveAttribute("inert", "");
  await page.keyboard.press("Tab");
  await expect(close).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(close).toBeFocused();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(alternative).toBeFocused();
});

test("ordinary in-project navigation does not reactivate validation", async ({ page }) => {
  let snapshotReads = 0;
  let syncCalls = 0;
  await page.route("**/api/v1/projects/overview/snapshot", (route) => {
    snapshotReads += 1;
    return route.fulfill({ json: readyEnvelope(false) });
  });
  await page.route("**/api/v1/projects/overview/sync", (route) => {
    syncCalls += 1;
    return route.fulfill({ json: completedEnvelope() });
  });
  await page.goto("/projects/overview");
  await page.getByRole("link", { name: "Roadmaps", exact: true }).click();
  await expect(page).toHaveURL(/\/projects\/overview\/roadmaps$/u);
  await expect(page.getByRole("heading", { name: "Roadmaps", level: 1 })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("heading", { name: "Portal Project", level: 1 })).toBeVisible();
  expect(snapshotReads).toBe(1);
  expect(syncCalls).toBe(0);
});

test("explicit discovered-work refresh is keyboard operable and retains evidence after failure", async ({
  page,
}) => {
  let discoveryCalls = 0;
  const inspectionBodies: string[] = [];
  let discoveryPublished = false;
  let releaseDiscovery = () => {};
  const discoveryGate = new Promise<void>((resolve) => {
    releaseDiscovery = resolve;
  });
  await page.route("**/api/v1/projects/overview/snapshot", (route) =>
    route.fulfill({
      json: discoveryPublished
        ? { ...readyEnvelope(false), view: discoveredProjectView() }
        : readyEnvelope(false),
    }),
  );
  await page.route("**/api/v1/projects/overview/discover-native-scopes", async (route) => {
    discoveryCalls += 1;
    if (discoveryCalls === 1) {
      await discoveryGate;
      discoveryPublished = true;
      return route.fulfill({ json: discoveredEnvelope() });
    }
    return route.fulfill({
      status: 500,
      json: { code: "request-failed", message: "Portal request failed." },
    });
  });
  let releaseInspection = () => {};
  const inspectionGate = new Promise<void>((resolve) => {
    releaseInspection = resolve;
  });
  await page.route("**/api/v1/projects/overview/inspect-native-scope", async (route) => {
    inspectionBodies.push(route.request().postData() ?? "");
    if (inspectionBodies.length === 1) {
      await inspectionGate;
      return route.fulfill({ json: unavailableInspectionEnvelope() });
    }
    return route.fulfill({
      json: inspectionBodies.length === 2 ? inspectedEnvelope() : inspectedEnvelope(true),
    });
  });
  await page.goto("/projects/overview");

  const discover = page.getByRole("button", { name: "Discover native work" });
  await focusByTab(page, discover);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Refreshing" })).toBeDisabled();
  expect(discoveryCalls).toBe(1);
  releaseDiscovery();

  const refresh = page.getByRole("button", { name: "Refresh discovered work" });
  await expect(refresh).toBeVisible();
  await expect(page.getByRole("heading", { name: "Discovered delivery" })).toBeVisible();
  await expect(page.getByText("map", { exact: true })).toBeVisible();
  await expect(page.getByText("open", { exact: true })).toBeVisible();
  await focusByTab(page, refresh);
  await page.keyboard.press("Space");

  await expect(page.getByText(/refresh request failed/u)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Discovered delivery" })).toBeVisible();
  expect(discoveryCalls).toBe(2);
  await expectMinimumTarget(refresh, 40);

  await page.getByRole("link", { name: "Discovered delivery" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Inspecting native scope" }),
  ).toBeVisible();
  expect(inspectionBodies).toEqual([
    JSON.stringify({
      version: 1,
      subject: { kind: "native-scope", id: ".scratch/discovered" },
      target: { provider: "matt-skills/v1", nativeScope: ".scratch/discovered" },
      refresh: false,
    }),
  ]);
  releaseInspection();
  await expect(
    page.getByRole("heading", { name: "Native scope detail unavailable" }),
  ).toBeVisible();
  await expect(page.getByText(/Detail freshness is undetermined/u)).toBeVisible();
  await page.getByRole("button", { name: "Retry details" }).click();
  await expect(page.getByRole("heading", { name: ".scratch/discovered", level: 1 })).toBeVisible();
  const refreshDetails = page.getByRole("button", { name: "Refresh details" });
  await expect(refreshDetails).toBeVisible();
  await refreshDetails.click();
  await expect(page.getByText(/latest refresh failed/u)).toBeVisible();
  await expect(page.getByText("undetermined", { exact: false }).first()).toBeVisible();
  expect(inspectionBodies).toEqual([
    JSON.stringify({
      version: 1,
      subject: { kind: "native-scope", id: ".scratch/discovered" },
      target: { provider: "matt-skills/v1", nativeScope: ".scratch/discovered" },
      refresh: false,
    }),
    JSON.stringify({
      version: 1,
      subject: { kind: "native-scope", id: ".scratch/discovered" },
      target: { provider: "matt-skills/v1", nativeScope: ".scratch/discovered" },
      refresh: true,
    }),
    JSON.stringify({
      version: 1,
      subject: { kind: "native-scope", id: ".scratch/discovered" },
      target: { provider: "matt-skills/v1", nativeScope: ".scratch/discovered" },
      refresh: true,
    }),
  ]);
  await expectMinimumTarget(refreshDetails, 40);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("a failed inspection stays scoped to its subject and does not block another target", async ({
  page,
}) => {
  const inspectionBodies: string[] = [];
  await page.route("**/api/v1/projects/overview/snapshot", (route) =>
    route.fulfill({ json: { ...readyEnvelope(false), view: discoveredProjectView() } }),
  );
  await page.route("**/api/v1/projects/overview/inspect-native-scope", async (route) => {
    inspectionBodies.push(route.request().postData() ?? "");
    return route.fulfill({ json: unavailableInspectionEnvelope() });
  });
  await page.goto("/projects/overview");

  await page.getByRole("link", { name: "Discovered delivery" }).click();
  await expect(
    page.getByRole("heading", { name: "Native scope detail unavailable" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Overview", exact: true }).click();
  await page.getByRole("link", { name: "Discovered research" }).click();
  await expect.poll(() => inspectionBodies.length).toBe(2);
  expect(inspectionBodies).toEqual([
    JSON.stringify({
      version: 1,
      subject: { kind: "native-scope", id: ".scratch/discovered" },
      target: { provider: "matt-skills/v1", nativeScope: ".scratch/discovered" },
      refresh: false,
    }),
    JSON.stringify({
      version: 1,
      subject: { kind: "native-scope", id: ".scratch/research" },
      target: { provider: "matt-skills/v1", nativeScope: ".scratch/research" },
      refresh: false,
    }),
  ]);
});

test("a persisted first inspection failure does not reacquire until explicit Retry", async ({
  page,
}) => {
  const inspectionBodies: string[] = [];
  const failed = unavailableInspectionEnvelope();
  await page.route("**/api/v1/projects/overview/snapshot", (route) =>
    route.fulfill({ json: { ...readyEnvelope(false), view: failed.view } }),
  );
  await page.route("**/api/v1/projects/overview/inspect-native-scope", async (route) => {
    inspectionBodies.push(route.request().postData() ?? "");
    return route.fulfill({ json: failed });
  });
  await page.goto("/projects/overview");

  await page.getByRole("link", { name: "Discovered delivery" }).click();
  await expect(
    page.getByRole("heading", { name: "Native scope detail unavailable" }),
  ).toBeVisible();
  expect(inspectionBodies).toEqual([]);

  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Native scope detail unavailable" }),
  ).toBeVisible();
  expect(inspectionBodies).toEqual([]);

  await page.getByRole("button", { name: "Retry details" }).click();
  await expect.poll(() => inspectionBodies.length).toBe(1);
  expect(inspectionBodies).toEqual([
    JSON.stringify({
      version: 1,
      subject: { kind: "native-scope", id: ".scratch/discovered" },
      target: { provider: "matt-skills/v1", nativeScope: ".scratch/discovered" },
      refresh: true,
    }),
  ]);
});

test("retained cache stays readable and Retry performs a forced reconciliation", async ({
  page,
}) => {
  const requestBodies: string[] = [];
  await page.route("**/api/v1/projects/overview/snapshot", (route) =>
    route.fulfill({ json: readyEnvelope(true) }),
  );
  await page.route("**/api/v1/projects/overview/sync", (route) => {
    requestBodies.push(route.request().postData() ?? "");
    return route.fulfill({
      json: requestBodies.length === 1 ? failedEnvelope() : forcedEnvelope(),
    });
  });
  await page.goto("/projects/overview");

  const banner = page.getByRole("alert");
  await expect(banner).toContainText("Cached project content remains visible");
  await expect(page.getByRole("heading", { name: "Portal Project", level: 1 })).toBeVisible();
  await banner.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(banner).toHaveCount(0);
  expect(requestBodies).toEqual([
    JSON.stringify({ version: 1, mode: "ensure-current" }),
    JSON.stringify({ version: 1, mode: "force" }),
  ]);
});

test("invalid and absent semantic projections stay scoped to their Overview sections", async ({
  page,
}) => {
  const view = projectView();
  if (
    view.cache.snapshot.state !== "available" ||
    view.cache.snapshot.snapshot.roadmapIndex.validity !== "available"
  ) {
    throw new Error("Expected available browser fixture.");
  }
  const scopedView = {
    ...view,
    cache: {
      ...view.cache,
      snapshot: {
        state: "available",
        snapshot: {
          ...view.cache.snapshot.snapshot,
          summary: {
            validity: "invalid",
            issues: [
              {
                code: "invalid-summary",
                target: "project-summary",
                message: "Summary sections are malformed.",
              },
            ],
          },
          guidance: { validity: "absent" },
        },
      },
    },
  };
  await page.route("**/api/v1/projects/overview/snapshot", (route) =>
    route.fulfill({
      json: {
        version: 1,
        state: "ready",
        view: scopedView,
        validation: { due: false, cooldownRemainingMs: 30_000, inFlight: false },
        session: { csrfToken: "ticket-11-csrf" },
      },
    }),
  );
  await page.goto("/projects/overview");

  await expect(page.getByRole("heading", { name: "Project brief unavailable" })).toBeVisible();
  await expect(page.getByText("No project-wide Next Work Guidance is available.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Active Roadmaps" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Portal Evolution" })).toBeVisible();
});
