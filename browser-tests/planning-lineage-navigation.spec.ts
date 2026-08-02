import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { createProviderScopeObservation } from "../src/native-work-provider";
import {
  planningLineageFilteredViewHref,
  planningLineageSubjectHref,
} from "../src/planning-lineage-route";
import type { ProjectSnapshot } from "../src/project-snapshot/contract";
import { buildMattNativeSourceRecords } from "../src/project-snapshot/native-work-sources";
import { buildPlanningLineageProjection } from "../src/project-snapshot/planning-lineage";
import { projectSnapshotSchema } from "../src/project-snapshot/schema";
import { createSourceRecord } from "../src/project-snapshot/source-records";
import { encodeGitHubMattNativeScope } from "../src/providers/matt-skills-v1/github";
import { mattNativeScopeSubject } from "../src/providers/matt-skills-v1/native-subject";
import { createMattReferenceProjection } from "../tests/fixtures/matt-reference-scenario";
import { createProjectOverviewFixture } from "../tests/fixtures/project-overview";
import { parseRebuiltPlanningLineageFixture } from "../tests/planning-lineage-fixture";

const projectView = (snapshot: ProjectSnapshot) => ({
  project: { entryId: "lineage", displayName: "Bearing fixture", availability: "available" },
  cache: {
    snapshot: { state: "available", snapshot },
    receipt: {
      schemaVersion: 1,
      producer: { packageName: "@lagrangee/bearing", packageVersion: "0.0.0-test" },
      completedAt: "2026-07-31T10:00:00+08:00",
      sitemap: { version: 1, fingerprint: snapshot.basis.sitemapFingerprint },
      reconciliation: "no-op",
    },
    retained: false,
  },
  diagnosticCounts: { blocking: 0, nonBlocking: 0, total: 0 },
});

const readyEnvelope = (snapshot: ProjectSnapshot) => ({
  version: 1,
  state: "ready",
  view: projectView(snapshot),
  validation: { due: false, cooldownRemainingMs: 30_000, inFlight: false },
  session: { csrfToken: "ticket-11-csrf" },
});

const forcedEnvelope = (snapshot: ProjectSnapshot) => ({
  version: 1,
  state: "completed",
  mode: "force",
  outcome: "applied",
  reconciliation: "applied",
  snapshotDisposition: "materialized",
  view: projectView(snapshot),
  validation: { due: false, cooldownRemainingMs: 30_000, inFlight: false },
});

const fixture = (): ProjectSnapshot => {
  const snapshot = createProjectOverviewFixture();
  const authoritySource = createSourceRecord(snapshot.basis.sitemapFingerprint, {
    kind: "canonical",
    locator: ".bearing/state/authorities/architecture.md",
    binding: { role: "authority", identity: "authority:architecture" },
  });
  if (snapshot.efforts.validity === "invalid") throw new Error("Expected Efforts.");
  const candidate = {
    ...snapshot,
    efforts: {
      ...snapshot.efforts,
      items: snapshot.efforts.items.map((effort) =>
        effort.id === "effort:portal"
          ? { ...effort, authorityIds: ["authority:architecture"] }
          : effort,
      ),
    },
    authorities: {
      validity: "available" as const,
      items: [
        {
          id: "authority:architecture",
          title: "Architecture",
          source: authoritySource.reference,
          citations: [],
          scope: "Accepted architecture direction.",
          baselineAssetIds: [],
          adoptions: [],
        },
      ],
    },
    sources: [...snapshot.sources, authoritySource],
  };
  return projectSnapshotSchema.parse({
    ...candidate,
    lineage: buildPlanningLineageProjection(candidate),
  });
};

const githubFixture = (): ProjectSnapshot => {
  const snapshot = fixture();
  if (snapshot.efforts.validity === "invalid") throw new Error("Expected Efforts.");
  const nativeScope = encodeGitHubMattNativeScope({
    host: "github.com",
    rootKind: "wayfinder-map",
    repository: {
      owner: "example",
      name: "reference",
      databaseId: "9001",
      nodeId: "R_reference",
    },
    root: {
      objectKind: "issue",
      number: 101,
      databaseId: "9101",
      nodeId: "I_reference_1",
    },
  });
  const observation = createProviderScopeObservation({
    provider: "matt-skills/v1",
    binding: { provider: "matt-skills/v1", nativeScope },
    observedAt: "2026-07-31T10:00:00.000Z",
    sourceRevision: "github:reference-revision",
    sourceObservedAt: "2026-07-31T10:00:00.000Z",
    validators: [],
    state: "available",
    freshness: {
      assessment: "current",
      evidence: [{ kind: "github-scope", value: nativeScope }],
    },
    coverage: {
      assessment: "complete",
      dimensions: [{ key: "scope", state: "covered" }],
    },
    completion: "incomplete",
    diagnostics: [],
    projection: createMattReferenceProjection("github"),
  });
  const providerObservations = [
    ...snapshot.providerObservations.filter(
      (candidate) => candidate.binding.nativeScope !== ".scratch/portal",
    ),
    observation,
  ];
  const providerObservationSelections = [
    ...snapshot.providerObservationSelections.filter(
      (candidate) => candidate.nativeScope !== ".scratch/portal",
    ),
    {
      provider: "matt-skills/v1" as const,
      nativeScope,
      observationId: observation.id,
      effectiveFreshness: "current" as const,
      latestAttempt: null,
    },
  ];
  const sources = [
    ...snapshot.sources.filter((source) => !source.displayLocator.startsWith(".scratch/portal")),
    ...buildMattNativeSourceRecords([observation], snapshot.basis.sitemapFingerprint),
  ];
  return parseRebuiltPlanningLineageFixture({
    ...snapshot,
    efforts: {
      ...snapshot.efforts,
      items: snapshot.efforts.items.map((effort) =>
        effort.id === "effort:portal"
          ? {
              ...effort,
              workBinding: { provider: "matt-skills/v1" as const, nativeScope },
            }
          : effort,
      ),
    },
    providerObservations,
    providerObservationSelections,
    sources,
  });
};

const timedFixture = (): ProjectSnapshot => {
  const snapshot = fixture();
  if (snapshot.gates.validity === "invalid" || snapshot.assets.validity === "invalid") {
    throw new Error("Expected readable Gates and Assets.");
  }
  const passage = snapshot.gates.items.find((gate) => gate.id === "gate:one")?.passage;
  if (passage === undefined) throw new Error("Expected Gate Passage.");
  const candidate = {
    ...snapshot,
    gates: {
      ...snapshot.gates,
      items: snapshot.gates.items.map((gate) =>
        gate.id === "gate:one"
          ? {
              ...gate,
              plannedAt: {
                availability: "available" as const,
                value: "2026-07-31T08:00:00Z",
                precision: "second" as const,
              },
              activatedAt: {
                availability: "available" as const,
                value: "2026-07-31T09:00:00Z",
                precision: "second" as const,
              },
              passage: {
                ...passage,
                acceptedAt: {
                  availability: "available" as const,
                  value: "2026-07-31T10:00:00.123Z",
                  precision: "fractional-second" as const,
                },
              },
            }
          : gate,
      ),
    },
    assets: {
      ...snapshot.assets,
      items: snapshot.assets.items.map((asset) => ({
        ...asset,
        registeredAt: {
          availability: "available" as const,
          value: "2026-07-31T09:30:00Z",
          precision: "second" as const,
        },
        producedAt: {
          availability: "available" as const,
          value: "2026-07-30",
          precision: "date" as const,
        },
      })),
    },
  };
  return projectSnapshotSchema.parse({
    ...candidate,
    lineage: buildPlanningLineageProjection(candidate),
  });
};

const withoutRequestedGate = (snapshot: ProjectSnapshot): ProjectSnapshot => {
  if (snapshot.gates.validity === "invalid" || snapshot.assets.validity === "invalid") {
    throw new Error("Expected readable Gates and Assets.");
  }
  const candidate = {
    ...snapshot,
    gates: {
      validity: "partial" as const,
      items: snapshot.gates.items.filter((gate) => gate.id !== "gate:one"),
      issues: [
        {
          code: "invalid-gate",
          target: "gate:one",
          message: "The requested Gate became unavailable.",
        },
      ],
    },
    assets: {
      ...snapshot.assets,
      items: snapshot.assets.items.map((asset) => ({
        ...asset,
        evidenceRoles: asset.evidenceRoles.filter((role) => role !== "passage-evidence"),
        passageEvidence: asset.passageEvidence.filter((evidence) => evidence.gateId !== "gate:one"),
      })),
    },
  };
  return projectSnapshotSchema.parse({
    ...candidate,
    lineage: buildPlanningLineageProjection(candidate),
  });
};

const serveSnapshot = async (page: Page, snapshot: ProjectSnapshot): Promise<void> => {
  await page.route("**/api/v1/projects/lineage/snapshot", (route) =>
    route.fulfill({ json: readyEnvelope(snapshot) }),
  );
};

const viewportOverflow = async (page: Page) =>
  page.locator("body *").evaluateAll((elements) =>
    elements.flatMap((element) => {
      const bounds = element.getBoundingClientRect();
      return bounds.right > window.innerWidth + 0.5
        ? [
            {
              tag: element.tagName,
              className: element.className,
              text: element.textContent?.trim().slice(0, 80),
              left: bounds.left,
              right: bounds.right,
              viewport: window.innerWidth,
            },
          ]
        : [];
    }),
  );

test("stable durable-subject routes survive direct entry and keep failures scoped", async ({
  page,
}) => {
  const snapshot = fixture();
  const posts: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST") posts.push(request.url());
  });
  await serveSnapshot(page, snapshot);
  const cases = [
    [{ kind: "roadmap", id: "roadmap:portal" }, "Portal Evolution"],
    [{ kind: "gate", id: "gate:one" }, "Model ready"],
    [{ kind: "effort", id: "effort:portal" }, "Web Portal Validation"],
    [{ kind: "authority", id: "authority:architecture" }, "Architecture"],
    [{ kind: "alignment-check", id: "alignment-check:portal" }, "Confirm the Portal revision"],
    [{ kind: "planning-review", id: "planning-review:sequence" }, "Review the current sequence"],
    [{ kind: "asset", id: "asset:planning-model-evidence" }, "Planning Model Evidence"],
    [{ kind: "native-scope", id: ".scratch/portal" }, ".scratch/portal"],
    [{ kind: "native-subject", id: ".scratch/portal/map.md" }, "Portal Validation"],
    [{ kind: "native-subject", id: ".scratch/portal/PRD.md" }, "Portal Validation PRD"],
    [
      { kind: "native-subject", id: ".scratch/portal/issues/01-build.md" },
      "Build the Roadmap journey",
    ],
    [
      { kind: "native-subject", id: ".scratch/portal/issues/03-gate.md" },
      "Pass the integration gate",
    ],
    [
      { kind: "native-subject", id: ".scratch/portal/issues/04-incoming.md" },
      "Route a new Portal request",
    ],
  ] as const;

  for (const [subject, title] of cases) {
    const href = planningLineageSubjectHref("lineage", subject);
    await page.goto(href);
    await expect(page).toHaveURL(href);
    await expect(page.getByRole("heading", { name: title, level: 1 })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Canonical Parent Path" })).toBeVisible();
  }

  const githubSnapshot = githubFixture();
  const githubObservation = githubSnapshot.providerObservations.find((observation) =>
    observation.binding.nativeScope.startsWith("github-matt-v1:"),
  );
  if (
    githubObservation === undefined ||
    (githubObservation.state !== "available" && githubObservation.state !== "partial") ||
    githubObservation.projection.map === undefined
  ) {
    throw new Error("Expected the GitHub browser fixture.");
  }
  const nativeCases = [
    {
      snapshot,
      scope: { kind: "native-scope" as const, id: ".scratch/portal" },
      scopeTitle: ".scratch/portal",
      subject: { kind: "native-subject" as const, id: ".scratch/portal/map.md" },
      title: "Portal Validation",
      source: ".scratch/portal/map.md",
      sourceHref: undefined,
    },
    {
      snapshot: githubSnapshot,
      scope: mattNativeScopeSubject(githubObservation),
      scopeTitle: "example/reference issue #101",
      subject: {
        kind: "native-subject" as const,
        id: githubObservation.projection.map.ref,
      },
      title: "Reference Map",
      source: "github/example/reference/issues/101",
      sourceHref: "https://github.com/example/reference/issues/101",
    },
  ] as const;

  for (const nativeCase of nativeCases) {
    await page.unroute("**/api/v1/projects/lineage/snapshot");
    await serveSnapshot(page, nativeCase.snapshot);
    const scopeHref = planningLineageSubjectHref("lineage", nativeCase.scope);
    await page.goto(scopeHref);
    await expect(page).toHaveURL(scopeHref);
    await expect(
      page.getByRole("heading", { name: nativeCase.scopeTitle, level: 1 }),
    ).toBeVisible();

    const mapHref = planningLineageSubjectHref("lineage", nativeCase.subject);
    for (const anchor of ["map.lifecycle", "native.provenance"] as const) {
      await page.goto(`${mapHref}#${anchor}`);
      await page.reload();
      await expect(page).toHaveURL(`${mapHref}#${anchor}`);
      await expect(page.locator(`#${anchor.replace(".", "\\.")}`)).toBeInViewport();
      await expect(page.getByRole("heading", { name: nativeCase.title, level: 1 })).toBeVisible();
    }
    await page.getByRole("button", { name: "Open Technical Details" }).click();
    const technicalDetails = page.getByRole("complementary", { name: "Technical Details" });
    if (nativeCase.sourceHref === undefined) {
      await expect(technicalDetails.getByRole("link", { name: nativeCase.source })).toHaveCount(0);
      await expect(
        technicalDetails
          .locator("dt", { hasText: /^Source$/u })
          .locator("xpath=following-sibling::dd"),
      ).toHaveText(nativeCase.source);
    } else {
      const sourceLink = technicalDetails.getByRole("link", { name: nativeCase.source });
      await expect(sourceLink).toHaveAttribute("href", nativeCase.sourceHref);
      await expect(
        technicalDetails.getByRole("button", { name: "Close Technical Details" }),
      ).toBeFocused();
      await page.keyboard.press("Shift+Tab");
      await expect(sourceLink).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(
        technicalDetails.getByRole("button", { name: "Close Technical Details" }),
      ).toBeFocused();
    }
    await page.keyboard.press("Escape");
  }

  const unavailableNativeAnchor = `${planningLineageSubjectHref("lineage", {
    kind: "native-subject",
    id: ".scratch/model/map.md",
  })}#map.resolution-evidence`;
  await page.goto(unavailableNativeAnchor);
  await expect(page).toHaveURL(unavailableNativeAnchor);
  await expect(page.getByText("Requested section unavailable", { exact: false })).toBeVisible();

  const missing = planningLineageSubjectHref("lineage", {
    kind: "gate",
    id: "gate:missing",
  });
  await page.goto(missing);
  await expect(page).toHaveURL(missing);
  await expect(page.getByRole("heading", { name: "Gate not found" })).toBeVisible();

  const missingNative = planningLineageSubjectHref("lineage", {
    kind: "native-subject",
    id: ".scratch/missing/PRD.md",
  });
  await page.goto(missingNative);
  await expect(page).toHaveURL(missingNative);
  await expect(page.getByRole("heading", { name: "Native Subject not found" })).toBeVisible();

  await page.goto("/projects/lineage/lineage/gate/not-a-gate");
  await expect(page).toHaveURL(/\/lineage\/gate\/not-a-gate$/u);
  await expect(page.getByRole("heading", { name: "Gate route unavailable" })).toBeVisible();

  await page.goto(`${planningLineageSubjectHref("lineage", cases[1][0])}#gate.answer`);
  await expect(page.getByText("Requested section unavailable", { exact: false })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Model ready", level: 1 })).toBeVisible();
  expect(posts).toEqual([]);
});

test("Source Event Time stays source-precise while browser-relative updates remain display-only", async ({
  page,
}) => {
  const snapshot = timedFixture();
  const posts: string[] = [];
  let snapshotReads = 0;
  page.on("request", (request) => {
    if (request.method() === "POST") posts.push(request.url());
  });
  await page.clock.install({ time: new Date("2026-07-31T10:05:00Z") });
  await page.route("**/api/v1/projects/lineage/snapshot", (route) => {
    snapshotReads += 1;
    return route.fulfill({ json: readyEnvelope(snapshot) });
  });

  await page.goto(
    planningLineageSubjectHref("lineage", {
      kind: "gate",
      id: "gate:one",
    }),
  );
  const history = page.locator("#gate\\.event-history");
  const accepted = history.locator('time[datetime="2026-07-31T10:00:00.123Z"]');
  await expect(accepted).toBeVisible();
  await expect(accepted).not.toContainText(/10:00:00/u);
  await expect(accepted.locator("xpath=following-sibling::small")).toHaveText("5 minutes ago");
  await expect(history.getByText("2026-07-31T10:00:00.123Z", { exact: true })).toBeAttached();
  await expect(history.getByText("fractional-second precision", { exact: true })).toBeAttached();

  await page.goto(
    planningLineageSubjectHref("lineage", {
      kind: "roadmap",
      id: "roadmap:portal",
    }),
  );
  const compact = page.locator(
    '.lineage-relation-event .source-event-time.compact:has(time[datetime="2026-07-31T10:00:00.123Z"])',
  );
  await expect(compact.locator("time")).toHaveText("5 minutes ago");
  await expect(compact).toHaveAttribute("title", /2026/u);
  await page.getByRole("link", { name: "Model ready", exact: true }).focus();
  expect(
    await compact.evaluate((element) => getComputedStyle(element, "::after").content),
  ).toContain("2026");

  await page.goto("/projects/lineage/roadmaps");
  const gateStateTime = page.locator('.gate-node time[datetime="2026-07-31T10:00:00.123Z"]');
  await expect(gateStateTime).toHaveText("Jul 31");
  await expect(gateStateTime.locator("xpath=..")).toHaveText("Passed · Jul 31");

  await page.goto("/projects/lineage/assets");
  await expect(page.locator('.asset-row-primary time[datetime="2026-07-31T09:30:00Z"]')).toHaveText(
    "35 minutes ago",
  );

  await page.goto(
    planningLineageSubjectHref("lineage", {
      kind: "asset",
      id: "asset:planning-model-evidence",
    }),
  );
  const produced = page.locator('#asset\\.event-history time[datetime="2026-07-30"]');
  await expect(produced).toHaveText("2026-07-30");
  await expect(page.locator("#asset\\.event-history")).not.toContainText("2026-07-30T00:00:00");

  await page.goto(
    planningLineageSubjectHref("lineage", {
      kind: "gate",
      id: "gate:one",
    }),
  );
  const samePageRelative = page
    .locator("#gate\\.event-history")
    .locator('time[datetime="2026-07-31T10:00:00.123Z"]')
    .locator("xpath=following-sibling::small");
  await expect(samePageRelative).toHaveText("5 minutes ago");
  const readsBeforeTick = snapshotReads;
  await page.clock.fastForward(60_000);
  await expect(samePageRelative).toHaveText("6 minutes ago");
  expect(posts).toEqual([]);
  expect(snapshotReads).toBe(readsBeforeTick);
});

test("semantic detail owns the reading contract while Technical Details stays transient and accessible", async ({
  page,
}) => {
  await serveSnapshot(page, fixture());
  await page.setViewportSize({ width: 1280, height: 800 });
  const gateHref = planningLineageSubjectHref("lineage", {
    kind: "gate",
    id: "gate:one",
  });
  await page.goto(`${gateHref}#gate.exit-criteria`);
  await page.reload();
  await expect(page).toHaveURL(`${gateHref}#gate.exit-criteria`);
  await expect(page.locator("#gate\\.exit-criteria")).toBeInViewport();

  const breadcrumb = page.getByRole("navigation", { name: "Canonical Parent Path" });
  await expect(breadcrumb.getByRole("link")).toHaveText(["Portal Project", "Portal Evolution"]);
  await expect(breadcrumb).not.toContainText("Model ready");
  const header = page.locator(".lineage-header");
  await expect(header.getByRole("heading", { name: "Model ready", level: 1 })).toBeVisible();
  await expect(header).not.toContainText("Gate");
  await expect(header).not.toContainText("gate:one");
  await expect(header).not.toContainText(".bearing/state/milestone-gates/one.md");
  await expect(header).not.toContainText("available");
  await expect(page.getByRole("heading", { name: "Intent", level: 2 })).toHaveCount(1);
  await expect(page.getByText("Establish the model.", { exact: true })).toHaveCount(1);
  await expect(page.getByRole("heading", { name: "Exit Criteria", level: 2 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Passage", level: 2 })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Lifecycle and Readiness", level: 2 }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Contributing Efforts", level: 2 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Event History", level: 2 })).toHaveCount(0);

  const trigger = page.getByRole("button", { name: "Open Technical Details" });
  await expect(trigger).toHaveCount(1);
  await trigger.focus();
  await page.keyboard.press("Enter");
  const drawer = page.getByRole("complementary", { name: "Technical Details" });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole("button", { name: "Close Technical Details" })).toBeFocused();
  await expect(drawer.getByText("gate:one", { exact: true })).toBeVisible();
  await expect(
    drawer.getByText(".bearing/state/milestone-gates/one.md", { exact: true }),
  ).toBeVisible();
  await expect(drawer.getByText("available", { exact: true })).toBeVisible();
  await expect(drawer.getByRole("heading", { name: "Provenance", level: 3 })).toBeVisible();
  await expect(drawer.getByRole("heading", { name: "Diagnostics", level: 3 })).toBeVisible();
  await expect(drawer).not.toContainText("Establish the model.");
  await expect(drawer).not.toContainText("Exit Criteria");
  await expect(drawer).not.toContainText("Lineage Context");
  await page.keyboard.press("Tab");
  await expect(drawer.getByRole("button", { name: "Close Technical Details" })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(drawer.getByRole("button", { name: "Close Technical Details" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(drawer).toHaveCount(0);
  await expect(trigger).toBeFocused();

  await page.setViewportSize({ width: 375, height: 812 });
  await page.keyboard.press("Enter");
  const sheet = page.getByRole("dialog", { name: "Technical Details" });
  const close = sheet.getByRole("button", { name: "Close Technical Details" });
  await expect(sheet).toBeVisible();
  await expect(close).toBeFocused();
  expect(
    await sheet.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      return { top: bounds.top, height: bounds.height, viewport: window.innerHeight };
    }),
  ).toEqual({ top: 0, height: 812, viewport: 812 });
  await page.keyboard.press("Tab");
  await expect(close).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(close).toBeFocused();
  expect(await viewportOverflow(page)).toEqual([]);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test("a same-route Snapshot transition sends an unavailable semantic anchor back to subject top", async ({
  page,
}) => {
  const initial = fixture();
  const updated = withoutRequestedGate(initial);
  await page.addInitScript(() => {
    const nativeScrollTo = window.scrollTo.bind(window);
    (
      window as typeof window & {
        bearingScrollToCalls?: unknown[];
      }
    ).bearingScrollToCalls = [];
    const interceptedScrollTo = (optionsOrX?: ScrollToOptions | number, y?: number) => {
      (
        window as typeof window & {
          bearingScrollToCalls: unknown[];
        }
      ).bearingScrollToCalls.push([optionsOrX, y]);
      if (typeof optionsOrX === "number") nativeScrollTo(optionsOrX, y ?? 0);
      else nativeScrollTo(optionsOrX);
    };
    window.scrollTo = interceptedScrollTo as typeof window.scrollTo;
  });
  await serveSnapshot(page, initial);
  await page.route("**/api/v1/projects/lineage/sync", (route) =>
    route.fulfill({ json: forcedEnvelope(updated) }),
  );
  await page.goto(
    `${planningLineageSubjectHref("lineage", {
      kind: "gate",
      id: "gate:one",
    })}#gate.exit-criteria`,
  );
  await expect(page.getByRole("heading", { name: "Model ready", level: 1 })).toBeVisible();
  await page.getByRole("button", { name: "Sync" }).click();
  await expect(page.getByRole("heading", { name: "Gate unavailable", level: 1 })).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as typeof window & {
              bearingScrollToCalls?: unknown[];
            }
          ).bearingScrollToCalls?.some(
            (args) =>
              Array.isArray(args) &&
              typeof args[0] === "object" &&
              args[0] !== null &&
              (args[0] as { top?: number }).top === 0,
          ) ?? false,
      ),
    )
    .toBe(true);
});

test("Quick Look is transient history and Back restores the filtered canvas", async ({ page }) => {
  await serveSnapshot(page, fixture());
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/projects/lineage/assets");
  const filter = page.getByRole("combobox", { name: "Evidence", exact: true });
  await filter.selectOption("cited");
  const quickLook = page.getByRole("button", { name: "Quick Look Planning Model Evidence" });
  await quickLook.scrollIntoViewIfNeeded();
  await quickLook.focus();
  const before = await page.evaluate(() => window.scrollY);
  await page.keyboard.press("Enter");

  const inspector = page.getByRole("complementary", { name: "Selected context" });
  await expect(inspector.getByRole("heading", { name: "Planning Model Evidence" })).toBeVisible();
  await expect(inspector.getByRole("link", { name: "Open full detail" })).toBeVisible();
  await page.goBack();

  await expect(inspector).toHaveCount(0);
  await expect(filter).toHaveValue("cited");
  await expect(quickLook).toBeFocused();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(before);

  await quickLook.click();
  await inspector.getByRole("link", { name: "Open full detail" }).click();
  await expect(page).toHaveURL(
    planningLineageSubjectHref("lineage", {
      kind: "asset",
      id: "asset:planning-model-evidence",
    }),
  );
  await expect(
    page.getByRole("heading", { name: "Planning Model Evidence", level: 1 }),
  ).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/projects\/lineage\/assets$/u);
  await expect(filter).toHaveValue("cited");
  await expect(quickLook).toBeFocused();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(before);

  const primary = page.locator(
    '[data-bearing-focus-key="asset:asset:planning-model-evidence:primary"]',
  );
  await primary.scrollIntoViewIfNeeded();
  await primary.focus();
  const primaryBefore = await page.evaluate(() => window.scrollY);
  await primary.click();
  await expect(page).toHaveURL(
    planningLineageSubjectHref("lineage", {
      kind: "asset",
      id: "asset:planning-model-evidence",
    }),
  );
  await page.goBack();
  await expect(page).toHaveURL(/\/projects\/lineage\/assets$/u);
  await expect(filter).toHaveValue("cited");
  await expect(primary).toBeFocused();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(primaryBefore);

  await page.getByRole("button", { name: "Quick Look Planning Model Evidence" }).click();
  await expect(page.getByRole("complementary", { name: "Selected context" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("complementary", { name: "Selected context" })).toHaveCount(0);
});

test("relation navigation and Inspector full detail restore lineage focus and scroll", async ({
  page,
}) => {
  await serveSnapshot(page, fixture());
  await page.setViewportSize({ width: 1280, height: 500 });
  const gateHref = planningLineageSubjectHref("lineage", {
    kind: "gate",
    id: "gate:one",
  });
  await page.goto(gateHref);

  const relationLink = page
    .getByLabel("Lineage Context")
    .getByRole("link", { name: "Planning Model", exact: true });
  await relationLink.scrollIntoViewIfNeeded();
  await relationLink.focus();
  await expect(relationLink).toHaveAttribute(
    "data-bearing-focus-key",
    "lineage:outcome.contributing-efforts:effort:model:primary",
  );
  const relationScroll = await page.evaluate(() => window.scrollY);
  await relationLink.click();
  await expect(page).toHaveURL(
    planningLineageSubjectHref("lineage", {
      kind: "effort",
      id: "effort:model",
    }),
  );
  await page.goBack();
  await expect(page).toHaveURL(gateHref);
  expect(await page.evaluate(() => history.state)).toMatchObject({
    bearingCanvas: {
      focusKey: "explicit:lineage:outcome.contributing-efforts:effort:model:primary",
    },
  });
  await expect(relationLink).toBeFocused();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(relationScroll);

  const quickLook = page.getByRole("button", {
    name: "Quick Look Planning Model",
    exact: true,
  });
  await quickLook.scrollIntoViewIfNeeded();
  await quickLook.click();
  await page
    .getByRole("complementary", { name: "Selected context" })
    .getByRole("link", { name: "Open full detail" })
    .click();
  await expect(page).toHaveURL(
    planningLineageSubjectHref("lineage", {
      kind: "effort",
      id: "effort:model",
    }),
  );
  await page.goBack();
  await expect(page).toHaveURL(gateHref);
  await expect(quickLook).toBeFocused();
});

test("lineage detail and filtered views stay keyboard-readable at narrow and 200 percent zoom", async ({
  page,
}) => {
  await serveSnapshot(page, fixture());
  const gateHref = planningLineageSubjectHref("lineage", {
    kind: "gate",
    id: "gate:one",
  });
  // A 1280 CSS-pixel reading surface at 200% browser zoom reflows at 640 CSS pixels.
  await page.setViewportSize({ width: 640, height: 900 });
  await page.goto(gateHref);
  await expect(page.getByRole("heading", { name: "Model ready", level: 1 })).toBeVisible();
  expect(
    await page.locator("html").evaluate((element) => element.scrollWidth > element.clientWidth),
  ).toBe(false);
  expect(await viewportOverflow(page)).toEqual([]);

  const effortHref = planningLineageSubjectHref("lineage", {
    kind: "effort",
    id: "effort:portal",
  });
  await page.goto(effortHref);
  await expect(
    page.getByRole("heading", { name: "Web Portal Validation", level: 1 }),
  ).toBeVisible();
  const workRegion = page.locator(".matt-work-region");
  await expect(
    workRegion.getByRole("heading", { name: "Contributing Work", level: 2 }),
  ).toBeVisible();
  await expect(
    workRegion.getByRole("heading", { name: "Open work remains", level: 3 }),
  ).toBeVisible();
  await workRegion.getByText("Why this state?", { exact: true }).click();
  await expect(workRegion.getByText("Provider Completion", { exact: true })).toBeVisible();
  await expect(workRegion.getByText("incomplete", { exact: true }).first()).toBeVisible();
  await workRegion.getByText("Observation details", { exact: true }).click();
  await expect(workRegion.getByText("Source revision", { exact: true })).toBeVisible();
  await expect(workRegion).not.toContainText("Needs refresh");
  const currentView = workRegion.getByRole("link", { name: /^Current/u });
  await currentView.focus();
  await expect(currentView).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(`${effortHref}#native-work-current`);
  await expect(workRegion.getByRole("heading", { name: "Current", level: 3 })).toBeInViewport();
  expect(await viewportOverflow(page)).toEqual([]);

  const assetHref = planningLineageSubjectHref("lineage", {
    kind: "asset",
    id: "asset:planning-model-evidence",
  });
  await page.goto(assetHref);
  await expect(
    page.getByRole("heading", { name: "Planning Model Evidence", level: 1 }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Evidence Roles", level: 2 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Ancestor Context", level: 3 })).toBeVisible();
  const copyLocation = page.getByRole("button", { name: "Copy Asset Location" });
  await copyLocation.focus();
  await expect(copyLocation).toBeFocused();
  expect(await viewportOverflow(page)).toEqual([]);

  await page.setViewportSize({ width: 375, height: 812 });
  const nativeHref = planningLineageSubjectHref("lineage", {
    kind: "native-scope",
    id: ".scratch/portal",
  });
  await page.goto(nativeHref);
  await expect(page.getByRole("heading", { name: ".scratch/portal", level: 1 })).toBeVisible();
  const subjectLink = page
    .getByRole("link", { name: "Review the Roadmap journey", exact: true })
    .first();
  await subjectLink.focus();
  await expect(subjectLink).toBeFocused();
  await expect
    .poll(() =>
      page.locator("html").evaluate((element) => element.scrollWidth > element.clientWidth),
    )
    .toBe(false);
  expect(await viewportOverflow(page)).toEqual([]);

  await page.goto(
    planningLineageFilteredViewHref(
      "lineage",
      { kind: "gate", id: "gate:one" },
      "outcome.contributing-efforts",
      "available",
    ),
  );
  await expect(page.getByRole("heading", { name: "Contributing Efforts", level: 1 })).toBeVisible();
  await expect(page.getByText("Owner · Model ready", { exact: true })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Canonical Parent Path" })).toHaveCount(0);
  const filteredRelationLink = page.getByRole("link", { name: "Planning Model", exact: true });
  await filteredRelationLink.focus();
  await expect(filteredRelationLink).toBeFocused();
  expect(
    await page.locator("html").evaluate((element) => element.scrollWidth > element.clientWidth),
  ).toBe(false);

  await page.goto(gateHref);
  const relationLink = page.getByRole("link", { name: /Planning Model/u }).first();
  await relationLink.focus();
  await expect(relationLink).toBeFocused();
  const quickLook = page.getByRole("button", {
    name: "Quick Look Planning Model",
    exact: true,
  });
  await quickLook.click();
  const dialog = page.getByRole("dialog", { name: "Selected context" });
  await expect(dialog.getByRole("link", { name: "Open full detail" })).toBeVisible();
  expect(await dialog.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(false);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});
