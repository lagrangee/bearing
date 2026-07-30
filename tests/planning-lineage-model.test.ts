import { expect, test } from "bun:test";
import {
  buildPlanningLineageSubjectModel,
  type PlanningLineageSubjectModel,
} from "../src/portal-ui/planning-lineage-model";
import type { ProjectSnapshot } from "../src/project-snapshot/contract";
import {
  buildPlanningLineageProjection,
  findPlanningLineageSubjectProjection,
} from "../src/project-snapshot/planning-lineage";
import { effortSchema, projectSnapshotSchema } from "../src/project-snapshot/schema";
import { createSourceRecord } from "../src/project-snapshot/source-records";
import { createProjectOverviewFixture } from "./fixtures/project-overview";
import { parseRebuiltPlanningLineageFixture } from "./planning-lineage-fixture";

const fixture = (): ProjectSnapshot => createProjectOverviewFixture();
const withLineage = parseRebuiltPlanningLineageFixture;
const readable = (
  model: PlanningLineageSubjectModel,
): Extract<PlanningLineageSubjectModel, { state: "available" | "partial" }> => {
  if (model.state !== "available" && model.state !== "partial") {
    throw new Error(`Expected readable model, received ${model.state}.`);
  }
  return model;
};

test("builds a Gate-owned route with trustworthy parents, full content, and typed relations", () => {
  const model = readable(
    buildPlanningLineageSubjectModel(fixture(), { kind: "gate", id: "gate:one" }, "bearing"),
  );

  expect(model.subject).toMatchObject({
    kind: "gate",
    id: "gate:one",
    title: "Model ready",
  });
  expect(model.parentPath.map((crumb) => crumb.label)).toEqual([
    "Portal Project",
    "Portal Evolution",
    "Model ready",
  ]);
  expect(model.sections.map((section) => section.anchor)).toEqual([
    "gate.intent",
    "gate.exit-criteria",
    "gate.readiness",
    "gate.passage",
  ]);
  expect(model.relations).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        key: "outcome.roadmap",
        direction: "belongs to",
        state: "present",
      }),
      expect.objectContaining({
        key: "outcome.contributing-efforts",
        direction: "receives contribution from",
        state: "present",
      }),
      expect.objectContaining({
        key: "passage.evidence",
        direction: "accepted with evidence",
        state: "present",
      }),
      expect.objectContaining({
        key: "planning-use.citations",
        state: "confirmed-none",
      }),
    ]),
  );
});

test("builds Effort, Asset, Alignment Check, and Planning Review routes from their own truth", () => {
  const snapshot = fixture();
  const expectations = [
    [
      { kind: "effort", id: "effort:model" },
      ["effort.intent", "effort.lifecycle", "effort.native-work"],
      ["outcome.roadmap", "outcome.target-gate", "native-work.binding", "planning-use.citations"],
    ],
    [
      { kind: "asset", id: "asset:planning-model-evidence" },
      [
        "asset.identity",
        "asset.lifecycle",
        "asset.provenance",
        "asset.evidence-roles",
        "asset.preview",
      ],
      ["production.owner", "production.producer", "planning-use.cited-by", "passage.used-by"],
    ],
    [
      { kind: "alignment-check", id: "alignment-check:portal" },
      [
        "alignment-check.target",
        "alignment-check.lifecycle",
        "alignment-check.resolution",
        "alignment-check.rationale",
        "alignment-check.event-time",
        "alignment-check.changed-references",
        "alignment-check.evidence",
      ],
      ["planning-use.citations"],
    ],
    [
      { kind: "planning-review", id: "planning-review:sequence" },
      [
        "planning-review.scope",
        "planning-review.lifecycle",
        "planning-review.resolution",
        "planning-review.rationale",
        "planning-review.event-time",
        "planning-review.changed-references",
        "planning-review.evidence",
      ],
      ["planning-use.citations"],
    ],
  ] as const;

  for (const [subject, anchors, relationKeys] of expectations) {
    const model = readable(buildPlanningLineageSubjectModel(snapshot, subject, "bearing"));
    expect(model.sections.map((section) => section.anchor)).toEqual([...anchors]);
    expect(model.relations.map((relation) => relation.key)).toEqual(
      expect.arrayContaining(relationKeys),
    );
  }

  const effort = readable(
    buildPlanningLineageSubjectModel(snapshot, { kind: "effort", id: "effort:model" }, "bearing"),
  );
  expect(effort.relations).toContainEqual(
    expect.objectContaining({
      key: "native-work.binding",
      direction: "binds to native scope",
      state: "present",
    }),
  );
  const lifecycle = effort.sections.find((section) => section.anchor === "effort.lifecycle");
  expect(JSON.stringify(lifecycle)).not.toMatch(/planned at|activated at|concluded at|T\d\d:/iu);
  const asset = readable(
    buildPlanningLineageSubjectModel(
      snapshot,
      { kind: "asset", id: "asset:planning-model-evidence" },
      "bearing",
    ),
  );
  expect(
    asset.sections.find((section) => section.anchor === "asset.evidence-roles")?.items,
  ).toEqual(["Planning Citation", "Passage Evidence"]);
  expect(asset.relations).toContainEqual(
    expect.objectContaining({
      key: "production.producer",
      direction: "was produced by",
      state: "present",
    }),
  );
  const check = readable(
    buildPlanningLineageSubjectModel(
      snapshot,
      { kind: "alignment-check", id: "alignment-check:portal" },
      "bearing",
    ),
  );
  expect(
    check.sections.find((section) => section.anchor === "alignment-check.event-time")?.body,
  ).toBe("Time unavailable in the current typed decision contract.");
});

test("retains the requested identity for missing and invalid subject projections", () => {
  expect(
    buildPlanningLineageSubjectModel(fixture(), { kind: "gate", id: "gate:missing" }, "bearing"),
  ).toMatchObject({
    state: "missing",
    requested: { kind: "gate", id: "gate:missing" },
  });
  const snapshot = fixture();
  expect(
    buildPlanningLineageSubjectModel(
      withLineage({
        ...snapshot,
        gates: {
          validity: "invalid",
          issues: [{ code: "invalid-gate", target: "gate:one", message: "Gate unavailable." }],
        },
      }),
      { kind: "gate", id: "gate:one" },
      "bearing",
    ),
  ).toMatchObject({
    state: "unavailable",
    requested: { kind: "gate", id: "gate:one" },
    issueCount: 1,
  });

  expect(
    buildPlanningLineageSubjectModel(
      withLineage({
        ...snapshot,
        gates: {
          validity: "partial",
          items:
            snapshot.gates.validity === "invalid"
              ? []
              : snapshot.gates.items.filter((gate) => gate.id !== "gate:one"),
          issues: [{ code: "invalid-gate", target: "gate:one", message: "Gate unavailable." }],
        },
      }),
      { kind: "gate", id: "gate:one" },
      "bearing",
    ),
  ).toMatchObject({
    state: "unavailable",
    requested: { kind: "gate", id: "gate:one" },
    issueCount: 1,
    reason: expect.stringContaining("Partial collection coverage"),
  });
});

test("the lineage builder stops ambiguous parentage while the complete Snapshot rejects it", () => {
  const snapshot = fixture();
  if (snapshot.roadmaps.validity === "invalid") throw new Error("Expected Roadmaps.");
  const second = snapshot.roadmaps.items.find((roadmap) => roadmap.id === "roadmap:second");
  if (second === undefined) throw new Error("Expected second Roadmap.");
  const ambiguous = {
    ...snapshot,
    roadmaps: {
      ...snapshot.roadmaps,
      items: snapshot.roadmaps.items.map((roadmap) =>
        roadmap.id === second.id ? { ...roadmap, gateOrder: ["gate:one"] } : roadmap,
      ),
    },
  };
  const lineage = buildPlanningLineageProjection(ambiguous);
  expect(
    findPlanningLineageSubjectProjection(lineage, { kind: "gate", id: "gate:one" })?.parentPath,
  ).toMatchObject({
    state: "truncated-unavailable",
    reason: "Canonical parentage is ambiguous.",
  });
  expect(projectSnapshotSchema.safeParse({ ...ambiguous, lineage }).success).toBe(false);
});

test("large relation collections expose truthful coverage and a stable filtered view", () => {
  const snapshot = fixture();
  if (snapshot.efforts.validity === "invalid" || snapshot.gates.validity === "invalid") {
    throw new Error("Expected Efforts and Gates.");
  }
  const template = snapshot.efforts.items[0];
  if (template === undefined) throw new Error("Expected an Effort.");
  const extras = Array.from({ length: 5 }, (_, index) => {
    const id = `effort:extra-${index + 1}`;
    const source = createSourceRecord(snapshot.basis.sitemapFingerprint, {
      kind: "canonical",
      locator: `.bearing/state/efforts/extra-${index + 1}.md`,
      binding: { role: "effort", identity: id },
    });
    return {
      source,
      effort: effortSchema.parse({
        ...template,
        id,
        title: `Extra Effort ${index + 1}`,
        source: source.reference,
        citations: [],
        targetGateId: "gate:one",
        workBinding: undefined,
      }),
    };
  });
  const extraEfforts = extras.map(({ effort }) => effort);
  const expanded = withLineage({
    ...snapshot,
    sources: [...snapshot.sources, ...extras.map(({ source }) => source)],
    efforts: {
      validity: "available" as const,
      items: [...snapshot.efforts.items, ...extraEfforts],
    },
  });

  const model = readable(
    buildPlanningLineageSubjectModel(expanded, { kind: "gate", id: "gate:one" }, "bearing"),
  );
  const relation = model.relations.find(
    (candidate) => candidate.key === "outcome.contributing-efforts",
  );
  expect(relation).toMatchObject({
    state: "present",
    total: { count: 6, coverage: "complete" },
  });
  if (relation?.state !== "present") throw new Error("Expected present relation.");
  expect(relation.items).toHaveLength(3);
  expect(relation.filteredViewHref).toBe(
    "/projects/bearing/lineage/gate/gate%3Aone/relations/outcome_contributing-efforts?filter=all&order=canonical",
  );
});
