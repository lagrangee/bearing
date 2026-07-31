import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { OverviewAttention } from "../src/portal-ui/overview-attention";
import { buildProjectOverviewModel } from "../src/portal-ui/project-overview-model";
import type { ProjectSnapshot } from "../src/project-snapshot/contract";
import { projectSnapshotSchema } from "../src/project-snapshot/schema";
import { createProjectOverviewFixture } from "./fixtures/project-overview";
import { withRebuiltPlanningLineage } from "./planning-lineage-fixture";

const snapshotFixture = createProjectOverviewFixture;

test("projects Overview in accepted semantic order without re-sorting planning truth", () => {
  const model = buildProjectOverviewModel(snapshotFixture());

  expect(model.summary.state).toBe("available");
  expect(model.guidance.state).toBe("available");
  expect(model.guidance.state === "available" && model.guidance.value.semanticFreshness).toBe(
    "stale",
  );
  expect(model.roadmaps.state).toBe("available");
  if (model.roadmaps.state !== "available") throw new Error("Expected Roadmaps.");
  expect(model.roadmaps.activeCount).toBe(2);
  expect(model.roadmaps.items.map((item) => String(item.roadmap.id))).toEqual([
    "roadmap:second",
    "roadmap:portal",
  ]);
  expect(model.roadmaps.items[1]?.gates.map((item) => String(item.gate.id))).toEqual([
    "gate:one",
    "gate:two",
  ]);
  expect(model.roadmaps.items[1]?.gates.map((item) => item.ordinal)).toEqual([1, 2]);
});

test("resolves Attention and provenance only from typed Snapshot references", () => {
  const model = buildProjectOverviewModel(snapshotFixture());

  expect(model.attention.map((item) => item.state)).toEqual([
    "available",
    "available",
    "available",
  ]);
  expect(model.attention.map((item) => item.title)).toEqual([
    "Project Summary has one malformed section.",
    "Confirm the Portal revision",
    "Review the current sequence",
  ]);
  expect(model.summary.source?.displayLocator).toBe(".bearing/state/project-summary.md");
  expect(model.guidance.source?.displayLocator).toBe(".bearing/state/next-work-guidance.md");
  if (model.guidance.state !== "available") throw new Error("Expected Guidance.");
  expect(model.sources.get(model.guidance.value.primary.source)?.fragment).toBe("primary");
});

test("binding diagnostics deep-link to the preserved native scope route", () => {
  const snapshot = snapshotFixture();
  const diagnosticAttention = snapshot.attention.find(
    (item) => item.kind === "structural-diagnostic",
  );
  if (diagnosticAttention?.kind !== "structural-diagnostic") {
    throw new Error("Expected one structural diagnostic Attention item.");
  }
  const conflicted = {
    ...snapshot,
    diagnostics: snapshot.diagnostics.map((diagnostic) =>
      diagnostic.reference === diagnosticAttention.diagnosticReference
        ? {
            ...diagnostic,
            code: "native-scope-discovery.binding-conflict",
            target: ".scratch/portal",
            message: "Multiple Efforts bind this native scope.",
          }
        : diagnostic,
    ),
    nativeScopeDiscovery: {
      state: "available",
      provider: "matt-skills/v1",
      observationId: `sha256:${"d".repeat(64)}`,
      observedAt: "2026-07-31T08:00:00.000Z",
      validators: [],
      freshness: "current",
      coverage: "complete",
      scopes: [
        {
          summary: {
            identity: ".scratch/portal",
            binding: { provider: "matt-skills/v1", nativeScope: ".scratch/portal" },
            locator: ".scratch/portal",
            driver: "local",
            rootRole: "wayfinder-map",
            title: "Portal Validation",
            lifecycle: "open",
            classification: "map",
            admission: ["contract-map"],
            subjects: [],
          },
          bindingContext: {
            state: "binding-conflict",
            effortIds: ["effort:model", "effort:portal"],
          },
          detailAvailability: "details-inspected",
        },
      ],
      count: { kind: "exact", value: 0 },
      confirmedUnboundEmpty: true,
      diagnostics: [],
      latestAttempt: null,
    },
  } as const;
  const model = buildProjectOverviewModel(conflicted as unknown as ProjectSnapshot);
  const item = model.attention.find((candidate) => candidate.kind === "diagnostic");
  expect(item?.nativeSubject).toEqual({ kind: "native-scope", id: ".scratch/portal" });

  const html = renderToStaticMarkup(
    createElement(OverviewAttention, {
      attention: model.attention,
      entryId: "bearing",
      onInspect: () => {},
      onNavigate: () => {},
    }),
  );
  expect(html).toContain("native-scope");
  expect(html).toContain(encodeURIComponent(".scratch/portal"));
});

test("renders retained members from a trustworthy partial Roadmap projection", () => {
  const snapshot = snapshotFixture();
  if (
    snapshot.roadmapIndex.validity !== "available" ||
    snapshot.roadmaps.validity !== "available"
  ) {
    throw new Error("Expected available Roadmap fixtures.");
  }
  const portalRoadmap = snapshot.roadmaps.items.find((roadmap) => roadmap.id === "roadmap:portal");
  if (portalRoadmap === undefined) throw new Error("Expected Portal Roadmap fixture.");
  const issue = {
    code: "invalid-roadmap",
    target: "roadmap:second",
    message: "One Roadmap is unavailable.",
  };
  const partial = projectSnapshotSchema.parse(
    withRebuiltPlanningLineage({
      ...snapshot,
      roadmapIndex: {
        validity: "partial",
        value: { ...snapshot.roadmapIndex.value, activeRoadmapIds: ["roadmap:portal"] },
        issues: [issue],
      },
      roadmaps: { validity: "partial", items: [portalRoadmap], issues: [issue] },
    }),
  );
  const model = buildProjectOverviewModel(partial);

  expect(model.roadmaps).toMatchObject({ state: "partial", activeCount: 1 });
  expect(model.roadmaps.items.map((item) => String(item.roadmap.id))).toEqual(["roadmap:portal"]);
  expect(model.roadmaps.state === "partial" && model.roadmaps.issues).toContainEqual(issue);
});
