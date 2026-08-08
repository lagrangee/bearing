import AxeBuilder from "@axe-core/playwright";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { createProviderScopeObservation } from "../src/native-work-provider";
import { planningLineageSubjectHref } from "../src/planning-lineage-route";
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

const readyEnvelope = (
  snapshot: ProjectSnapshot,
  section: Parameters<typeof projectRowEnvelope>[0]["section"],
  target?: Parameters<typeof projectRowEnvelope>[0]["target"],
) => projectRowEnvelope({ snapshot, section, entryId: "roadmaps", target });

const serveSnapshot = async (page: Page, snapshot: ProjectSnapshot): Promise<void> => {
  await page.route("**/api/v1/projects/roadmaps/read-model?section=*", (route) =>
    route.fulfill({
      json: readyEnvelope(
        snapshot,
        projectSectionFromRequest(route.request().url()),
        projectTargetFromRequest(route.request().url()),
      ),
    }),
  );
};

const minimumTarget = async (locator: Locator, size: number): Promise<void> => {
  const box = await locator.boundingBox();
  if (box === null) throw new Error("Expected an interactive target with rendered bounds.");
  expect(box.width).toBeGreaterThanOrEqual(size);
  expect(box.height).toBeGreaterThanOrEqual(size);
};

const expectReadableGateMeasure = async (locator: Locator, minimumWidth: number): Promise<void> => {
  const widths = await locator.evaluateAll((elements) =>
    elements.map((element) => element.getBoundingClientRect().width),
  );
  expect(widths.length).toBe(4);
  expect(Math.min(...widths)).toBeGreaterThanOrEqual(minimumWidth);
};

const expectHorizontalHorizonAlignment = async (locator: Locator): Promise<void> => {
  const alignments = await locator.evaluateAll((horizons) =>
    horizons.map((horizon) => {
      const gates = Array.from(horizon.querySelectorAll(".gate-segment"));
      return {
        markerTops: gates.map(
          (gate) => gate.querySelector(".gate-marker")?.getBoundingClientRect().top ?? -1,
        ),
        titleTops: gates.map(
          (gate) => gate.querySelector(".gate-copy strong")?.getBoundingClientRect().top ?? -1,
        ),
        statusTops: gates.map(
          (gate) => gate.querySelector(".gate-copy small")?.getBoundingClientRect().top ?? -1,
        ),
      };
    }),
  );
  const spread = (values: readonly number[]) => Math.max(...values) - Math.min(...values);
  for (const alignment of alignments) {
    expect(spread(alignment.markerTops)).toBeLessThanOrEqual(1);
    expect(spread(alignment.titleTops)).toBeLessThanOrEqual(1);
    expect(spread(alignment.statusTops)).toBeLessThanOrEqual(1);
  }
};

const longGateIntent =
  "让维护者完整理解 Gate 的语义目标、退出条件与 Passage ownership, while preserving the full canonical planning meaning across a deliberately long reading line without moving essential content into an inspector.";

const longCriteriaFixture = (): ProjectSnapshot => {
  const snapshot = createProjectOverviewFixture();
  if (snapshot.gates.validity === "invalid") throw new Error("Expected Gate fixture.");
  return projectSnapshotSchema.parse(
    withRebuiltPlanningLineage({
      ...snapshot,
      gates: {
        ...snapshot.gates,
        items: snapshot.gates.items.map((gate) =>
          gate.id === "gate:two"
            ? {
                ...gate,
                intent: longGateIntent,
                exitCriteria: [
                  "Overview is usable.",
                  "Evidence remains inspectable.",
                  "Frontiers remain read-only.",
                  "Degraded relations stay scoped.",
                ],
              }
            : gate,
        ),
      },
    }),
  );
};

const plannedGateFixture = (): ProjectSnapshot => {
  const snapshot = createProjectOverviewFixture();
  if (snapshot.roadmaps.validity === "invalid" || snapshot.gates.validity === "invalid") {
    throw new Error("Expected complete planning fixture.");
  }
  const template = snapshot.gates.items.find((gate) => gate.id === "gate:two");
  if (template === undefined) throw new Error("Expected focused Gate fixture.");
  const plannedSource = createSourceRecord(snapshot.basis.sitemapFingerprint, {
    kind: "canonical",
    locator: ".bearing/state/milestone-gates/three.md",
    binding: { role: "milestone-gate", identity: "gate:three" },
  });
  return projectSnapshotSchema.parse(
    withRebuiltPlanningLineage({
      ...snapshot,
      sources: [...snapshot.sources, plannedSource],
      roadmaps: {
        ...snapshot.roadmaps,
        items: snapshot.roadmaps.items.map((roadmap) =>
          roadmap.id === "roadmap:portal"
            ? { ...roadmap, gateOrder: [...roadmap.gateOrder, "gate:three"] }
            : roadmap,
        ),
      },
      gates: {
        ...snapshot.gates,
        items: [
          ...snapshot.gates.items,
          {
            ...template,
            id: "gate:three",
            source: plannedSource.reference,
            title: "Evidence decision",
            lifecycle: "planned",
            activatedAt: undefined,
            readiness: "unknown",
            horizonState: "planned",
            effortIds: [],
          },
        ],
      },
    }),
  );
};

const longRoadmapIntent =
  "让维护者在不中断阅读节奏的前提下看清完整的 canonical Roadmap intent, while preserving the full English planning meaning across a deliberately long responsive reading line.";
const longPassedGateTitle =
  "Model ready with a deliberately long bilingual outcome title that remains fully readable 模型契约完整可读";

const roadmapReadingFixture = (): ProjectSnapshot => {
  const snapshot = createProjectOverviewFixture();
  if (
    snapshot.roadmapIndex.validity !== "available" ||
    snapshot.roadmaps.validity !== "available"
  ) {
    throw new Error("Expected complete Roadmap fixture.");
  }
  if (snapshot.gates.validity !== "available") throw new Error("Expected complete Gate fixture.");
  return projectSnapshotSchema.parse(
    withRebuiltPlanningLineage({
      ...snapshot,
      roadmapIndex: {
        ...snapshot.roadmapIndex,
        value: {
          ...snapshot.roadmapIndex.value,
          activeRoadmapIds: ["roadmap:portal"],
          completedRoadmapIds: ["roadmap:second"],
        },
      },
      roadmaps: {
        ...snapshot.roadmaps,
        items: snapshot.roadmaps.items.map((roadmap) =>
          roadmap.id === "roadmap:portal"
            ? { ...roadmap, intent: longRoadmapIntent }
            : {
                ...roadmap,
                lifecycle: "completed" as const,
                completedAt: {
                  availability: "available" as const,
                  value: "2026-08-01T00:00:00Z",
                  precision: "second" as const,
                },
                horizon: "exhausted" as const,
              },
        ),
      },
      gates: {
        ...snapshot.gates,
        items: snapshot.gates.items.map((gate) =>
          gate.id === "gate:one"
            ? {
                ...gate,
                title: longPassedGateTitle,
                passage: {
                  ...gate.passage,
                  acceptedDecision: gate.passage?.acceptedDecision ?? "Accept the model.",
                  acceptedAt: {
                    availability: "available" as const,
                    value: "2026-08-02T00:00:00Z",
                    precision: "second" as const,
                  },
                  rationale: gate.passage?.rationale ?? "The model is ready.",
                  evidenceAssetIds: gate.passage?.evidenceAssetIds ?? [],
                  exceptions: gate.passage?.exceptions ?? [],
                },
              }
            : gate,
        ),
      },
    }),
  );
};

const fourGateReadingFixture = (): ProjectSnapshot => {
  const snapshot = roadmapReadingFixture();
  if (snapshot.roadmaps.validity !== "available" || snapshot.gates.validity !== "available") {
    throw new Error("Expected complete planning fixture.");
  }
  const template = snapshot.gates.items.find((gate) => gate.id === "gate:two");
  if (template === undefined) throw new Error("Expected focused Gate fixture.");
  const addedGates = [
    { id: "gate:three", title: "Evidence decision" },
    {
      id: "gate:four",
      title: "Operational handoff remains understandable across every responsive reading mode",
    },
  ] as const;
  const addedSources = addedGates.map((gate) =>
    createSourceRecord(snapshot.basis.sitemapFingerprint, {
      kind: "canonical",
      locator: `.bearing/state/milestone-gates/${gate.id.slice("gate:".length)}.md`,
      binding: { role: "milestone-gate", identity: gate.id },
    }),
  );
  return projectSnapshotSchema.parse(
    withRebuiltPlanningLineage({
      ...snapshot,
      sources: [...snapshot.sources, ...addedSources],
      roadmaps: {
        ...snapshot.roadmaps,
        items: snapshot.roadmaps.items.map((roadmap) =>
          roadmap.id === "roadmap:portal"
            ? {
                ...roadmap,
                gateOrder: [...roadmap.gateOrder, ...addedGates.map((gate) => gate.id)],
              }
            : roadmap,
        ),
      },
      gates: {
        ...snapshot.gates,
        items: [
          ...snapshot.gates.items,
          ...addedGates.map((gate, index) => ({
            ...template,
            id: gate.id,
            source: addedSources[index]?.reference ?? template.source,
            title: gate.title,
            lifecycle: "planned" as const,
            activatedAt: undefined,
            readiness: "unknown" as const,
            horizonState: "planned" as const,
            effortIds: [],
          })),
        ],
      },
    }),
  );
};

const oneFogFixture = (
  snapshot: ProjectSnapshot = createProjectOverviewFixture(),
): ProjectSnapshot => {
  const providerObservations = snapshot.providerObservations.map((capture) =>
    capture.binding.nativeScope === ".scratch/portal" &&
    (capture.state === "available" || capture.state === "partial") &&
    capture.projection.map !== undefined
      ? (createProviderScopeObservation({
          ...capture,
          projection: {
            ...capture.projection,
            map: {
              ...capture.projection.map,
              fog: ["One unresolved question."],
            },
          },
        } as never) as typeof capture)
      : capture,
  );
  const portalObservation = providerObservations.find(
    (observation) => observation.binding.nativeScope === ".scratch/portal",
  );
  if (portalObservation === undefined) throw new Error("Expected the Portal observation.");
  return projectSnapshotSchema.parse({
    ...snapshot,
    providerObservations,
    providerObservationSelections: snapshot.providerObservationSelections.map((selection) =>
      selection.nativeScope === ".scratch/portal"
        ? { ...selection, observationId: portalObservation.id }
        : selection,
    ),
  });
};

test("Roadmaps opens the lifecycle Index before Detail and preserves contextual inspection", async ({
  page,
}, testInfo) => {
  await serveSnapshot(page, roadmapReadingFixture());
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/projects/roadmaps/roadmaps");

  await expect(page.getByRole("heading", { name: "Roadmaps", level: 1 })).toBeVisible();
  await expect(page.getByText("Peer outcome horizons", { exact: true })).toHaveCount(0);
  await expect(
    page.getByText(/Each Roadmap carries an independently governed Gate sequence/u),
  ).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Roadmaps", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(page.locator(".roadmap-index-row > a")).toHaveText([
    "Portal Evolution",
    "Second Horizon",
  ]);
  await expect(page.getByText("Active", { exact: true })).toBeVisible();
  await expect(page.getByText("Completed", { exact: true })).toBeVisible();
  await expect(page.getByText(longRoadmapIntent, { exact: true })).toBeVisible();
  await expect(page.getByText("Current", { exact: true })).toBeVisible();
  await expect(page.getByText("Planned", { exact: true })).toHaveCount(0);
  await expect(
    page.getByText("Declared Gate horizon exhausted; Roadmap completion remains explicit.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.locator("main")).not.toContainText("%");
  await expect(page.getByText("Time unavailable", { exact: true })).toHaveCount(0);
  await expect(page.locator(".roadmap-index-row .gate-quick-look")).toHaveCount(0);
  await expect(page.locator(".roadmap-index-row .gate-copy small")).toHaveCount(2);
  await expect(page.locator(".roadmap-index-row .gate-copy small").first()).toHaveText(
    "Passed · Aug 2",
  );
  await expect(page.locator(".roadmap-index-row .gate-copy small").nth(1)).toHaveText("Current");
  await expect(
    page.locator(".roadmap-index-row .gate-copy small").nth(1).locator("time"),
  ).toHaveCount(0);
  await expect(
    page.locator(".roadmap-index-row", { hasText: "Portal Evolution" }).locator(".roadmap-event"),
  ).toHaveCount(0);
  await expect(page.locator(".roadmap-index-row .horizon").first()).toHaveCSS(
    "flex-direction",
    "row",
  );
  await expect(page.locator(".gate-copy strong", { hasText: longPassedGateTitle })).toBeVisible();

  const gate = page.getByRole("link", { name: new RegExp(`G1, ${longPassedGateTitle}, Passed`) });
  await gate.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(
    planningLineageSubjectHref("roadmaps", { kind: "gate", id: "gate:one" }),
  );
  await expect(page.getByRole("heading", { name: longPassedGateTitle, level: 1 })).toBeVisible();
  await page.goBack();

  await page.screenshot({
    path: await browserArtifactPath(testInfo, "roadmaps-index-1280.png"),
    fullPage: true,
  });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  await page.getByRole("link", { name: "Portal Evolution", exact: true }).click();
  await expect(page).toHaveURL(
    planningLineageSubjectHref("roadmaps", { kind: "roadmap", id: "roadmap:portal" }),
  );
  await expect(page.getByRole("heading", { name: "Portal Evolution", level: 1 })).toBeVisible();
  await page
    .getByRole("navigation", { name: "Project navigation" })
    .getByRole("link", { name: "Roadmaps", exact: true })
    .click();
  await expect(page).toHaveURL(/\/projects\/roadmaps\/roadmaps$/u);

  await page.goto("/projects/roadmaps");
  await expect(page.locator(".roadmap-landscape-item h3")).toHaveText(["Portal Evolution"]);
  await expect(page.getByText("Second Horizon", { exact: true })).toHaveCount(0);
});

test("Roadmap, Gate, and Effort subjects keep full contracts and Passage read-only", async ({
  page,
}, testInfo) => {
  const postRequests: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST") postRequests.push(request.url());
  });
  await serveSnapshot(page, longCriteriaFixture());
  await page.setViewportSize({ width: 1280, height: 900 });
  const roadmapHref = planningLineageSubjectHref("roadmaps", {
    kind: "roadmap",
    id: "roadmap:portal",
  });
  const focusedGateHref = planningLineageSubjectHref("roadmaps", {
    kind: "gate",
    id: "gate:two",
  });
  const passedGateHref = planningLineageSubjectHref("roadmaps", {
    kind: "gate",
    id: "gate:one",
  });
  await page.goto(roadmapHref);

  const outcomeSpine = page.getByRole("region", { name: "Outcome Spine" });
  await expect(outcomeSpine).toBeVisible();
  await expect(outcomeSpine.getByRole("link", { name: "Overview proven" })).toBeVisible();
  await expect(outcomeSpine.getByRole("link", { name: "Web Portal Validation" })).toBeVisible();
  await page.locator(`a[href="${focusedGateHref}"]`).first().click();
  await expect(page.getByRole("heading", { name: "Overview proven", level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Exit Criteria" })).toBeVisible();
  const gateIntent = page.getByText(longGateIntent, { exact: true });
  await expect(gateIntent).toBeVisible();
  const semanticSectionMetrics = await gateIntent.evaluate((element) => {
    const section = element.closest("section");
    if (section === null) throw new Error("Expected semantic section.");
    const paragraphBounds = element.getBoundingClientRect();
    const sectionBounds = section.getBoundingClientRect();
    const sectionStyle = getComputedStyle(section);
    return {
      paragraphWidth: paragraphBounds.width,
      sectionWidth: sectionBounds.width,
      paddingTop: Number.parseFloat(sectionStyle.paddingTop),
      paddingBottom: Number.parseFloat(sectionStyle.paddingBottom),
    };
  });
  expect(semanticSectionMetrics.paragraphWidth).toBeLessThanOrEqual(
    semanticSectionMetrics.sectionWidth,
  );
  expect(semanticSectionMetrics.paddingTop).toBeGreaterThanOrEqual(24);
  expect(semanticSectionMetrics.paddingTop).toBeLessThanOrEqual(32);
  expect(semanticSectionMetrics.paddingBottom).toBeGreaterThanOrEqual(24);
  expect(semanticSectionMetrics.paddingBottom).toBeLessThanOrEqual(32);
  await expect(page.getByText("Overview is usable.", { exact: true })).toBeVisible();
  await expect(page.getByText("Evidence remains inspectable.", { exact: true })).toBeVisible();
  await expect(page.getByText("Frontiers remain read-only.", { exact: true })).toBeVisible();
  await expect(page.getByText("Degraded relations stay scoped.", { exact: true })).toBeVisible();
  await page.goBack();

  await page
    .getByRole("region", { name: "Outcome Spine" })
    .getByRole("link", { name: "Web Portal Validation", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Web Portal Validation", level: 1 }),
  ).toBeVisible();
  await expect(page.getByLabel("Effort governance status")).toContainText("Active");
  await expect(page.getByLabel("Effort governance status")).toContainText("Healthy");
  await expect(page.getByRole("heading", { name: "Current Work", level: 2 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Planning Basis", level: 2 })).toBeVisible();
  await page.goBack();

  await page.locator(`a[href="${passedGateHref}"]`).first().click();
  await expect(page.getByRole("heading", { name: "Passage", exact: true })).toBeVisible();
  await expect(
    page.getByText("Accept the planning model as ready.", { exact: false }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: /^Planning Model Evidence\b/u })).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Canonical Parent Path" }).getByRole("link", {
      name: "Portal Evolution",
    }),
  ).toHaveAttribute(
    "href",
    planningLineageSubjectHref("roadmaps", {
      kind: "roadmap",
      id: "roadmap:portal",
    }),
  );

  await expect(
    page.getByRole("button", { name: "Quick Look Planning Model Evidence" }),
  ).toHaveCount(0);
  expect(postRequests).toEqual([]);
  await page.screenshot({
    path: await browserArtifactPath(testInfo, "roadmap-lineage-1280.png"),
    fullPage: true,
  });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("Roadmap journey reflows at review widths and retains scoped degraded states", async ({
  page,
}, testInfo) => {
  const snapshot = oneFogFixture(fourGateReadingFixture());
  await serveSnapshot(page, snapshot);
  await page.goto("/projects/roadmaps/roadmaps");
  for (const width of [1280, 1201, 1200, 1100, 1024, 901, 900, 768, 681, 640, 375]) {
    await page.setViewportSize({ width, height: width === 375 ? 812 : 900 });
    await page.waitForTimeout(250);
    if (width <= 900) {
      await expect(page.locator(".project-nav")).toHaveAttribute("aria-hidden", "true");
    }
    expect(
      await page.locator("html").evaluate((element) => element.scrollWidth > element.clientWidth),
    ).toBe(false);
    const indexHorizon = page.locator(".roadmap-index-row .horizon").first();
    if (width === 1280) {
      await expect(indexHorizon).toHaveCSS("flex-direction", "row");
      await expectHorizontalHorizonAlignment(page.locator(".roadmap-index-row .horizon"));
    }
    if (width === 375) await expect(indexHorizon).toHaveCSS("flex-direction", "column");
    await expectReadableGateMeasure(page.locator(".roadmap-index-row .gate-copy"), 120);
    if (width === 1280) {
      await page.screenshot({
        path: await browserArtifactPath(testInfo, "roadmaps-index-four-gates-1280.png"),
        fullPage: true,
      });
    }
    if (width === 375) {
      await page.screenshot({
        path: await browserArtifactPath(testInfo, "roadmaps-index-375.png"),
        fullPage: true,
      });
    }
  }
  await expect(page.getByText(longRoadmapIntent, { exact: true })).toBeVisible();
  await minimumTarget(page.locator(".roadmap-index-row .gate-node").first(), 44);
  // A 1280 × 900 display at 200% browser zoom exposes a 640 × 450 CSS viewport.
  await page.setViewportSize({ width: 640, height: 450 });
  await expect(page.locator(".roadmap-index-row .gate-node")).toHaveCount(4);
  await expectReadableGateMeasure(page.locator(".roadmap-index-row .gate-copy"), 220);
  expect(
    await page.locator("html").evaluate((element) => element.scrollWidth > element.clientWidth),
  ).toBe(false);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  await page.goto("/projects/roadmaps");
  await expect(page.locator(".roadmap-landscape-item")).toHaveCount(1);
  await expect(page.getByText("Second Horizon", { exact: true })).toHaveCount(0);
  for (const width of [1280, 1201, 1200, 1100, 1024, 901, 900, 768, 681, 640, 375]) {
    await page.setViewportSize({ width, height: width === 375 ? 812 : 900 });
    await page.waitForTimeout(250);
    await expect(page.getByText(longRoadmapIntent, { exact: true })).toBeVisible();
    await expect(page.locator(".roadmap-landscape-item .gate-node")).toHaveCount(4);
    await expect(page.locator(".gate-copy strong", { hasText: longPassedGateTitle })).toBeVisible();
    expect(
      await page.locator("html").evaluate((element) => element.scrollWidth > element.clientWidth),
    ).toBe(false);
    const overviewHorizon = page.locator(".roadmap-landscape-item .horizon");
    if (width === 1280) {
      await expect(overviewHorizon).toHaveCSS("flex-direction", "row");
      await expectHorizontalHorizonAlignment(page.locator(".roadmap-landscape-item .horizon"));
    }
    if (width === 375) await expect(overviewHorizon).toHaveCSS("flex-direction", "column");
    await expectReadableGateMeasure(page.locator(".roadmap-landscape-item .gate-copy"), 120);
    if (width === 1280 || width === 375) {
      await page.screenshot({
        path: await browserArtifactPath(testInfo, `roadmaps-overview-four-gates-${width}.png`),
        fullPage: true,
      });
    }
  }
  await page.setViewportSize({ width: 640, height: 450 });
  await expect(page.locator(".roadmap-landscape-item .gate-node")).toHaveCount(4);
  await expectReadableGateMeasure(page.locator(".roadmap-landscape-item .gate-copy"), 220);
  expect(
    await page.locator("html").evaluate((element) => element.scrollWidth > element.clientWidth),
  ).toBe(false);
  await page.goto("/projects/roadmaps/roadmaps");

  await page.getByRole("link", { name: "Portal Evolution" }).click();
  for (const width of [768, 640, 375]) {
    await page.setViewportSize({ width, height: width === 375 ? 812 : 900 });
    await page.waitForTimeout(250);
    await expect(page.locator(".project-nav")).toHaveAttribute("aria-hidden", "true");
    expect(
      await page.locator("html").evaluate((element) => element.scrollWidth > element.clientWidth),
    ).toBe(false);
    if (width !== 640) {
      await page.screenshot({
        path: await browserArtifactPath(testInfo, `roadmap-detail-${width}.png`),
        fullPage: true,
      });
    }
    if (width === 375) {
      await expect(
        page
          .getByRole("region", { name: "Outcome Spine" })
          .getByRole("link", { name: "Web Portal Validation", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Quick Look Web Portal Validation" }),
      ).toHaveCount(0);
    }
  }
  await minimumTarget(
    page
      .getByRole("region", { name: "Outcome Spine" })
      .getByRole("link", { name: "Web Portal Validation", exact: true }),
    44,
  );
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  const partial = projectSnapshotSchema.parse(
    withRebuiltPlanningLineage({
      ...snapshot,
      gates: {
        validity: "partial" as const,
        items:
          snapshot.gates.validity === "invalid"
            ? []
            : snapshot.gates.items.filter((gate) => gate.id !== "gate:one"),
        issues: [{ code: "invalid-gate", target: "gate:one", message: "Gate unavailable." }],
      },
      assets:
        snapshot.assets.validity === "invalid"
          ? snapshot.assets
          : {
              ...snapshot.assets,
              items: snapshot.assets.items.map((asset) => ({
                ...asset,
                evidenceRoles: asset.evidenceRoles.filter((role) => role !== "passage-evidence"),
                passageEvidence: asset.passageEvidence.filter(
                  (evidence) => evidence.gateId !== "gate:one",
                ),
              })),
            },
    }),
  );
  await page.unroute("**/api/v1/projects/roadmaps/read-model?section=*");
  await serveSnapshot(page, partial);
  await page.reload();
  await expect(page.getByText("Gate unavailable", { exact: true })).toBeVisible();
  await expect(page.getByText("gate:one", { exact: false })).toHaveCount(0);

  const mapPartial = projectSnapshotSchema.parse(
    withRebuiltPlanningLineage({
      ...snapshot,
      gates:
        snapshot.gates.validity === "invalid"
          ? snapshot.gates
          : {
              ...snapshot.gates,
              items: snapshot.gates.items.map((gate) =>
                gate.id === "gate:two" ? { ...gate, readiness: "unknown" as const } : gate,
              ),
            },
      providerObservations: snapshot.providerObservations.filter(
        (capture) => capture.binding.nativeScope !== ".scratch/portal",
      ),
      providerObservationSelections: snapshot.providerObservationSelections.map((selection) =>
        selection.nativeScope === ".scratch/portal"
          ? {
              ...selection,
              observationId: null,
              effectiveFreshness: "undetermined" as const,
            }
          : selection,
      ),
    }),
  );
  await page.unroute("**/api/v1/projects/roadmaps/read-model?section=*");
  await serveSnapshot(page, mapPartial);
  await page.goto(
    planningLineageSubjectHref("roadmaps", {
      kind: "effort",
      id: "effort:portal",
    }),
  );
  await expect(page.getByLabel("Effort governance status")).toContainText("Needs attention");
  await expect(
    page.getByText("Managed work details are unavailable", { exact: false }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Current Work", level: 2 })).toBeVisible();
  await expect(page.locator('[id="effort.native-work"]')).toHaveCount(0);

  await page.goto(
    planningLineageSubjectHref("roadmaps", {
      kind: "roadmap",
      id: "roadmap:missing",
    }),
  );
  await expect(page.getByRole("heading", { name: "Roadmap not found" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Return to project overview" })).toBeVisible();
});

test("Roadmaps keeps planned, absent, and invalid states explicit", async ({ page }) => {
  await serveSnapshot(page, plannedGateFixture());
  await page.goto("/projects/roadmaps/roadmaps");
  await expect(page.locator(".roadmap-index-row .gate-node")).toHaveCount(3);
  const planned = page.getByRole("link", { name: /G3, Evidence decision, Planned/u });
  await planned.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Evidence decision", level: 1 })).toBeVisible();
  await page.goBack();

  const base = createProjectOverviewFixture();
  await page.unroute("**/api/v1/projects/roadmaps/read-model?section=*");
  await serveSnapshot(
    page,
    projectSnapshotSchema.parse({ ...base, roadmapIndex: { validity: "absent" } }),
  );
  await page.reload();
  await expect(page.getByText("No canonical Roadmap Index is available")).toBeVisible();

  await page.unroute("**/api/v1/projects/roadmaps/read-model?section=*");
  await serveSnapshot(
    page,
    projectSnapshotSchema.parse({
      ...base,
      roadmapIndex: {
        validity: "invalid",
        issues: [
          {
            code: "invalid-roadmap-index",
            target: ".bearing/state/roadmap-index.md",
            message: "Roadmap Index is invalid.",
          },
        ],
      },
    }),
  );
  await page.reload();
  await expect(page.getByRole("heading", { name: "Roadmaps unavailable" })).toBeVisible();
  await expect(page.getByText(/Other project destinations remain available/u)).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});
