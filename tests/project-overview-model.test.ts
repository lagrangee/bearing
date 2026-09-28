import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { OverviewAttention } from "../src/portal-ui/overview-attention";
import { buildProjectOverviewModel } from "../src/portal-ui/project-overview-model";
import {
  projectGenerationSchema,
  structuralDiagnosticSchema,
} from "../src/project-generation/schema";
import { createProjectOverviewFixture } from "./fixtures/project-overview";
import { withRebuiltPlanningLineage } from "./planning-lineage-fixture";

const snapshotFixture = createProjectOverviewFixture;

test("projects Overview in accepted semantic order without re-sorting planning truth", () => {
  const model = buildProjectOverviewModel(snapshotFixture());

  expect(model.summary.state).toBe("available");
  expect(model.brief.state).toBe("absent");
  expect("guidance" in model).toBe(false);
  expect("discoveredWork" in model).toBe(false);
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

  expect(model.attention.map((item) => item.state)).toEqual(["available", "available"]);
  expect(model.attention.map((item) => item.title)).toEqual([
    "Project Summary has one malformed section.",
    "Review the current sequence",
  ]);
  expect(model.summary.source?.displayLocator).toBe(".bearing/state/project-summary.md");
});

test("consumes normalized managed Attention without a second UI scope derivation", () => {
  const snapshot = snapshotFixture();
  const model = buildProjectOverviewModel(snapshot);

  expect(model.attention).toHaveLength(snapshot.attention.length);
  expect(model.attention.map((item) => item.key)).toEqual(
    snapshot.attention.map((item) =>
      item.kind === "structural-diagnostic" ? item.diagnosticReference : item.id,
    ),
  );
});

test("renders no healthy-state Attention placeholder when the normalized queue is empty", () => {
  const html = renderToStaticMarkup(
    createElement(OverviewAttention, {
      attention: [],
      entryId: "bearing",
      onNavigate: () => {},
    }),
  );

  expect(html).toBe("");
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
  const partial = projectGenerationSchema.parse(
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

test("unresolved declared Binding diagnostics route to the Effort without guessing invalid ownership", () => {
  const snapshot = snapshotFixture();
  if (snapshot.efforts.validity === "invalid") throw new Error("Expected Efforts.");
  const effort = snapshot.efforts.items.find((item) => item.workBinding !== undefined);
  if (effort?.workBinding === undefined) throw new Error("Expected declared Binding.");
  const diagnostic = structuralDiagnosticSchema.parse({
    reference: `diagnostic:${"a".repeat(64)}`,
    code: "provider-observation-unavailable",
    impact: "blocking",
    target: effort.workBinding.nativeScope,
    message: "No Provider Observation is available for this declared scope.",
  });
  for (const reason of ["unresolved", "conflicting"] as const) {
    const changed = {
      ...snapshot,
      efforts: {
        ...snapshot.efforts,
        items: snapshot.efforts.items.map((item) =>
          item.id === effort.id
            ? { ...item, workBindingState: { state: "invalid" as const, reason } }
            : item,
        ),
      },
      diagnostics: [...snapshot.diagnostics, diagnostic],
      attention: [
        ...snapshot.attention,
        { kind: "structural-diagnostic" as const, diagnosticReference: diagnostic.reference },
      ],
    };
    const model = buildProjectOverviewModel(changed);
    const item = model.attention.find((item) => item.key === diagnostic.reference);
    expect(model.attention).toHaveLength(snapshot.attention.length + 1);
    expect(item?.title).toBe(diagnostic.message);
    if (reason === "unresolved") {
      expect(item?.subject).toEqual({ kind: "effort", id: effort.id });
      expect(item?.detail).toBe(`Effort: ${effort.title} · Impact: blocking`);
    } else {
      expect(item?.subject).toBeUndefined();
    }
  }
});
