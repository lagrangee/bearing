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
import {
  authoritySchema,
  effortSchema,
  planningReviewSchema,
  projectSnapshotSchema,
} from "../src/project-snapshot/schema";
import { assetProjectionSchema } from "../src/project-snapshot/schema-asset";
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
  expect(effort.events.map((event) => event.role)).toEqual([
    "effort.planned",
    "effort.activated",
    "effort.concluded",
  ]);
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
  expect(check.events).toEqual([]);
});

test("binds Adoption relation time to the exact Asset decision instead of Authority recency", () => {
  const snapshot = fixture();
  if (snapshot.assets.validity === "invalid" || snapshot.reviews.validity === "invalid") {
    throw new Error("Expected Assets and Planning Reviews.");
  }
  const firstAsset = snapshot.assets.items.find(
    (asset) => asset.id === "asset:planning-model-evidence",
  );
  if (firstAsset === undefined) throw new Error("Expected first Asset.");
  const secondAssetSource = createSourceRecord(snapshot.basis.sitemapFingerprint, {
    kind: "asset",
    locator: ".bearing/state/assets.md",
    binding: { role: "asset", identity: "asset:second-evidence" },
    fragment: "asset:second-evidence",
  });
  const authoritySource = createSourceRecord(snapshot.basis.sitemapFingerprint, {
    kind: "canonical",
    locator: ".bearing/state/authorities/design.md",
    binding: { role: "authority", identity: "authority:design" },
  });
  const firstReviewSource = createSourceRecord(snapshot.basis.sitemapFingerprint, {
    kind: "canonical",
    locator: ".bearing/state/planning-reviews/adopt-first.md",
    binding: { role: "planning-review", identity: "planning-review:adopt-first" },
  });
  const secondReviewSource = createSourceRecord(snapshot.basis.sitemapFingerprint, {
    kind: "canonical",
    locator: ".bearing/state/planning-reviews/adopt-second.md",
    binding: { role: "planning-review", identity: "planning-review:adopt-second" },
  });
  const accepted = (value: string) =>
    ({ availability: "available", value, precision: "second" }) as const;
  const firstReview = planningReviewSchema.parse({
    id: "planning-review:adopt-first",
    title: "Adopt first",
    source: firstReviewSource.reference,
    citations: [],
    status: "completed",
    scope: "Adopt first evidence.",
    resolution: {
      acceptedDecision: "Adopt first evidence.",
      acceptedAt: accepted("2026-07-31T09:00:00Z"),
      rationale: "First evidence governs its use.",
      changedReferences: ["authority:design"],
    },
  });
  const secondReview = planningReviewSchema.parse({
    id: "planning-review:adopt-second",
    title: "Adopt second",
    source: secondReviewSource.reference,
    citations: [],
    status: "completed",
    scope: "Adopt second evidence.",
    resolution: {
      acceptedDecision: "Adopt second evidence.",
      acceptedAt: accepted("2026-07-31T10:00:00Z"),
      rationale: "Second evidence governs its use.",
      changedReferences: ["authority:design"],
    },
  });
  const secondAsset = assetProjectionSchema.parse({
    ...firstAsset,
    id: "asset:second-evidence",
    title: "Second Evidence",
    source: secondAssetSource.reference,
    citations: [],
    registeredAt: accepted("2026-07-31T11:00:00Z"),
    displayLocation: "docs/second-evidence.md",
    adoptedByAuthorityIds: [],
    gatePassageEvidenceFor: [],
    citationCount: 0,
  });
  const authority = authoritySchema.parse({
    id: "authority:design",
    title: "Design",
    source: authoritySource.reference,
    citations: [],
    scope: "Govern the evidence baseline.",
    baselineAssetIds: [firstAsset.id, secondAsset.id],
    adoptions: [
      { assetId: firstAsset.id, decisionReference: firstReview.id },
      { assetId: secondAsset.id, decisionReference: secondReview.id },
    ],
  });
  const withAdoptions = withLineage({
    ...snapshot,
    assets: { validity: "available", items: [...snapshot.assets.items, secondAsset] },
    authorities: { validity: "available", items: [authority] },
    reviews: {
      ...snapshot.reviews,
      items: [...snapshot.reviews.items, firstReview, secondReview],
    },
    sources: [
      ...snapshot.sources,
      secondAssetSource,
      authoritySource,
      firstReviewSource,
      secondReviewSource,
    ],
  });

  const authorityModel = readable(
    buildPlanningLineageSubjectModel(
      withAdoptions,
      { kind: "authority", id: authority.id },
      "bearing",
    ),
  );
  const forward = authorityModel.relations.find((relation) => relation.key === "adoption.used-by");
  expect(forward?.state).toBe("present");
  if (forward?.state !== "present") throw new Error("Expected forward Adoption relation.");
  expect(
    forward.items.map((item) => [
      item.reference,
      item.event?.role,
      item.event?.time,
      item.event?.decisionReference,
    ]),
  ).toEqual([
    [firstAsset.id, "authority.adoption", accepted("2026-07-31T09:00:00Z"), firstReview.id],
    [secondAsset.id, "authority.adoption", accepted("2026-07-31T10:00:00Z"), secondReview.id],
  ]);

  const assetModel = readable(
    buildPlanningLineageSubjectModel(
      withAdoptions,
      { kind: "asset", id: firstAsset.id },
      "bearing",
    ),
  );
  const reverse = assetModel.relations.find((relation) => relation.key === "adoption.used-by");
  expect(reverse?.state).toBe("present");
  if (reverse?.state !== "present") throw new Error("Expected reverse Adoption relation.");
  expect(reverse.items[0]?.event).toEqual({
    role: "authority.adoption",
    label: "Adopted",
    time: accepted("2026-07-31T09:00:00Z"),
    decisionReference: firstReview.id,
  });
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
