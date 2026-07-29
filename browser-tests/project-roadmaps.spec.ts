import AxeBuilder from "@axe-core/playwright";
import { expect, type Locator, type Page, test } from "@playwright/test";
import type { ProjectSnapshot } from "../src/project-snapshot/contract";
import { projectSnapshotSchema } from "../src/project-snapshot/schema";
import { createSourceRecord } from "../src/project-snapshot/source-records";
import { createProjectOverviewFixture } from "../tests/fixtures/project-overview";
import { browserArtifactPath } from "./browser-artifact-output";

const projectView = (snapshot: ProjectSnapshot) => ({
  project: { entryId: "roadmaps", displayName: "Bearing fixture", availability: "available" },
  cache: {
    snapshot: { state: "available", snapshot },
    receipt: {
      schemaVersion: 1,
      producer: { packageName: "@lagrangee/bearing", packageVersion: "0.0.0-test" },
      completedAt: "2026-07-14T10:00:00+08:00",
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
  session: { csrfToken: "ticket-12-csrf" },
});

const serveSnapshot = async (page: Page, snapshot: ProjectSnapshot): Promise<void> => {
  await page.route("**/api/v1/projects/roadmaps/snapshot", (route) =>
    route.fulfill({ json: readyEnvelope(snapshot) }),
  );
};

const minimumTarget = async (locator: Locator, size: number): Promise<void> => {
  const box = await locator.boundingBox();
  if (box === null) throw new Error("Expected an interactive target with rendered bounds.");
  expect(box.width).toBeGreaterThanOrEqual(size);
  expect(box.height).toBeGreaterThanOrEqual(size);
};

const longCriteriaFixture = (): ProjectSnapshot => {
  const snapshot = createProjectOverviewFixture();
  if (snapshot.gates.validity === "invalid") throw new Error("Expected Gate fixture.");
  return projectSnapshotSchema.parse({
    ...snapshot,
    gates: {
      ...snapshot.gates,
      items: snapshot.gates.items.map((gate) =>
        gate.id === "gate:two"
          ? {
              ...gate,
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
  });
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
  return projectSnapshotSchema.parse({
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
          readiness: "unknown",
          horizonState: "planned",
          effortIds: [],
        },
      ],
    },
  });
};

const oneFogFixture = (): ProjectSnapshot => {
  const snapshot = createProjectOverviewFixture();
  return projectSnapshotSchema.parse({
    ...snapshot,
    providerCaptures: snapshot.providerCaptures.map((capture) =>
      capture.binding.nativeScope === ".scratch/portal" &&
      (capture.state === "available" || capture.state === "partial") &&
      capture.projection.map !== undefined
        ? {
            ...capture,
            projection: {
              ...capture.projection,
              map: {
                ...capture.projection.map,
                fog: ["One unresolved question."],
              },
            },
          }
        : capture,
    ),
  });
};

test("Roadmaps opens the lifecycle Index before Detail and preserves contextual inspection", async ({
  page,
}, testInfo) => {
  await serveSnapshot(page, createProjectOverviewFixture());
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/projects/roadmaps/roadmaps");

  await expect(page.getByRole("heading", { name: "Roadmaps", level: 1 })).toBeVisible();
  await expect(page.getByRole("link", { name: "Roadmaps", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(page.locator(".roadmap-index-row > a")).toHaveText([
    "Second Horizon",
    "Portal Evolution",
  ]);
  await expect(page.getByText("Active", { exact: true })).toBeVisible();
  await expect(page.getByText("Passed", { exact: true })).toBeVisible();
  await expect(page.getByText("Current", { exact: true })).toBeVisible();
  await expect(page.getByText("Planned", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Gate horizon state is unavailable.", { exact: true })).toBeVisible();
  await expect(page.locator("main")).not.toContainText("%");

  const gate = page.getByRole("button", { name: "G1, Model ready, Passed" });
  await gate.focus();
  await page.keyboard.press("Enter");
  const inspector = page.getByRole("complementary", { name: "Selected context" });
  await expect(inspector.getByRole("heading", { name: "Model ready" })).toBeVisible();
  await expect(inspector.getByText("Ready for review", { exact: true })).toBeVisible();
  await expect(inspector.getByText("The planning model is accepted.")).toBeVisible();
  await expect(inspector.getByRole("button", { name: /Resume in Agent Surface/u })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(gate).toBeFocused();

  await page.screenshot({
    path: await browserArtifactPath(testInfo, "roadmaps-index-1280.png"),
    fullPage: true,
  });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  await page.getByRole("link", { name: "Portal Evolution", exact: true }).click();
  await expect(page).toHaveURL(/\/roadmaps\/roadmap%3Aportal$/u);
  await expect(page.getByRole("heading", { name: "Portal Evolution", level: 1 })).toBeVisible();
  await page.getByRole("link", { name: "Roadmaps", exact: true }).last().click();
  await expect(page).toHaveURL(/\/projects\/roadmaps\/roadmaps$/u);
});

test("Roadmap Detail keeps Gate contracts, native frontiers, Passage, and placeholders read-only", async ({
  page,
}, testInfo) => {
  const postRequests: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST") postRequests.push(request.url());
  });
  await serveSnapshot(page, longCriteriaFixture());
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/projects/roadmaps/roadmaps/roadmap%3Aportal");

  await expect(page.getByRole("heading", { name: "Milestone Gates" })).toBeVisible();
  await expect(page.locator(".gate-node .gate-copy strong")).toHaveText([
    "G1 · Model ready",
    "G2 · Overview proven",
  ]);
  await expect(page.getByRole("heading", { name: "G2 · Overview proven" })).toBeVisible();
  await expect(page.getByText("Readiness · Not ready", { exact: true })).toBeVisible();
  await expect(page.getByText("Overview is usable.", { exact: true })).toBeVisible();
  await expect(page.getByText("Evidence remains inspectable.", { exact: true })).toBeVisible();
  await expect(page.getByText("Frontiers remain read-only.", { exact: true })).toBeVisible();
  await expect(page.getByText("1 more criterion is available in full Gate context.")).toBeVisible();
  await expect(page.locator(".gate-contract")).not.toContainText("Degraded relations stay scoped.");
  await page.getByRole("button", { name: /Inspect full Gate context/u }).click();
  let inspector = page.getByRole("complementary", { name: "Selected context" });
  await expect(inspector.getByText("Degraded relations stay scoped.")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("heading", { name: "Efforts and frontiers" })).toBeVisible();
  await expect(page.locator(".effort-row")).toHaveCount(2);
  await expect(page.getByText("Claimed 1 · Ready 1 · Blocked 1 · Resolved 0")).toBeVisible();

  const effort = page.getByRole("button", { name: /Web Portal Validation, active/u });
  await effort.focus();
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
  await expect(effort).toBeFocused();
  await page.keyboard.press("Space");
  inspector = page.getByRole("complementary", { name: "Selected context" });
  await expect(inspector.getByRole("heading", { name: "Web Portal Validation" })).toBeVisible();
  await expect(inspector.getByText("Portal Validation", { exact: true })).toHaveCount(0);
  await expect(inspector.getByText("Pass the integration gate")).toBeVisible();
  await expect(inspector.getByText(/1 blocker/u)).toBeVisible();
  await expect(inspector.getByRole("button", { name: /Resume in Agent Surface/u })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(effort).toBeFocused();

  const passedGate = page.getByRole("button", { name: "G1, Model ready, Passed" });
  await passedGate.click();
  inspector = page.getByRole("complementary", { name: "Selected context" });
  await expect(inspector.getByRole("heading", { name: "Accepted Passage" })).toBeVisible();
  await expect(inspector.getByText("Accept the planning model as ready.")).toBeVisible();
  await page.keyboard.press("Escape");

  const map = page.getByRole("button", {
    name: "Tracker-native Map .scratch/portal/map.md",
  });
  await map.click();
  inspector = page.getByRole("complementary", { name: "Selected context" });
  await expect(inspector.getByRole("heading", { name: "Portal Validation" })).toBeVisible();
  await expect(inspector.getByText("Read-only native work context")).toBeVisible();
  await expect(inspector.getByRole("button", { name: /Resume in Agent Surface/u })).toBeDisabled();
  await page.keyboard.press("Escape");

  const resume = page.getByRole("button", { name: /Resume Roadmap in Agent Surface/u });
  await resume.click();
  inspector = page.getByRole("complementary", { name: "Selected context" });
  await expect(inspector.getByRole("heading", { name: "Portal Evolution" })).toBeVisible();
  await expect(inspector.getByRole("button", { name: /Resume in Agent Surface/u })).toBeDisabled();
  expect(postRequests).toEqual([]);
  await page.keyboard.press("Escape");

  await expect(page.getByText("Planning Model Evidence", { exact: true })).toBeVisible();
  await page.screenshot({
    path: await browserArtifactPath(testInfo, "roadmap-detail-1280.png"),
    fullPage: true,
  });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("Roadmap journey reflows at review widths and retains scoped degraded states", async ({
  page,
}, testInfo) => {
  const snapshot = oneFogFixture();
  await serveSnapshot(page, snapshot);
  await page.goto("/projects/roadmaps/roadmaps");
  for (const width of [640, 375]) {
    await page.setViewportSize({ width, height: width === 375 ? 812 : 900 });
    await expect(page.locator(".project-nav")).toHaveAttribute("aria-hidden", "true");
    await expect(page.getByText("Read-only normalized snapshot", { exact: true })).toBeVisible();
    expect(
      await page.locator("html").evaluate((element) => element.scrollWidth > element.clientWidth),
    ).toBe(false);
    if (width === 375) {
      await page.screenshot({
        path: await browserArtifactPath(testInfo, "roadmaps-index-375.png"),
        fullPage: true,
      });
    }
  }
  await expect(page.getByText("Gate horizon state is unavailable.")).toBeVisible();
  await minimumTarget(page.locator(".gate-node").first(), 44);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  await page.getByRole("link", { name: "Portal Evolution" }).click();
  for (const width of [768, 640, 375]) {
    await page.setViewportSize({ width, height: width === 375 ? 812 : 900 });
    await expect(page.locator(".project-nav")).toHaveAttribute("aria-hidden", "true");
    await expect(page.getByText("Read-only normalized snapshot", { exact: true })).toBeVisible();
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
      const effort = page.getByRole("button", { name: /Web Portal Validation.+Fog 1/u });
      await expect(effort.locator(".effort-fog")).toBeVisible();
      await expect(effort.locator(".effort-fog")).toContainText("1");
    }
  }
  await minimumTarget(page.getByRole("button", { name: /Resume Roadmap/u }), 44);
  await minimumTarget(page.locator(".gate-node").first(), 44);
  await minimumTarget(page.locator(".effort-row").first(), 44);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  const partial = projectSnapshotSchema.parse({
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
              gatePassageEvidenceFor: asset.gatePassageEvidenceFor.filter(
                (gateId) => gateId !== "gate:one",
              ),
            })),
          },
  });
  await page.unroute("**/api/v1/projects/roadmaps/snapshot");
  await serveSnapshot(page, partial);
  await page.reload();
  await expect(page.getByText(/remains readable with unresolved relations/u)).toBeVisible();
  await expect(page.getByText("1 ordered Gate relation is unavailable.")).toBeVisible();

  const mapPartial = projectSnapshotSchema.parse({
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
    efforts:
      snapshot.efforts.validity === "invalid"
        ? snapshot.efforts
        : {
            ...snapshot.efforts,
            items: snapshot.efforts.items.map((effort) =>
              effort.id === "effort:portal"
                ? { ...effort, derivedState: "unknown" as const }
                : effort,
            ),
          },
    providerCaptures: snapshot.providerCaptures.filter(
      (capture) => capture.binding.nativeScope !== ".scratch/portal",
    ),
  });
  await page.unroute("**/api/v1/projects/roadmaps/snapshot");
  await serveSnapshot(page, mapPartial);
  await page.reload();
  await expect(page.getByText(/remains readable with unresolved relations/u)).toBeVisible();
  await expect(page.getByText("1 native Map relation is unavailable.")).toBeVisible();

  await page.goto("/projects/roadmaps/roadmaps/roadmap%3Amissing");
  await expect(page.getByRole("heading", { name: "Roadmap not found" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Return to Roadmaps" })).toBeVisible();
});

test("Roadmaps keeps planned, absent, and invalid states explicit", async ({ page }) => {
  await serveSnapshot(page, plannedGateFixture());
  await page.goto("/projects/roadmaps/roadmaps");
  const planned = page.getByRole("button", { name: "G3, Evidence decision, Planned" });
  await planned.focus();
  await page.keyboard.press("Space");
  const inspector = page.getByRole("complementary", { name: "Selected context" });
  await expect(inspector.getByRole("heading", { name: "Evidence decision" })).toBeVisible();
  await expect(inspector.getByText("Readiness unknown", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");

  const base = createProjectOverviewFixture();
  await page.unroute("**/api/v1/projects/roadmaps/snapshot");
  await serveSnapshot(
    page,
    projectSnapshotSchema.parse({ ...base, roadmapIndex: { validity: "absent" } }),
  );
  await page.reload();
  await expect(page.getByText("No canonical Roadmap Index is available")).toBeVisible();

  await page.unroute("**/api/v1/projects/roadmaps/snapshot");
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
