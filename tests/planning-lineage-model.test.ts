import { expect, test } from "bun:test";
import { createProviderScopeObservation } from "../src/native-work-provider";
import {
  buildPlanningLineageSubjectModel,
  effortPlanningBasisForWorkRegion,
  nativeLifecycleEventsFor,
  type PlanningLineageSection,
  type PlanningLineageSubjectModel,
  resolvePlanningLineageStatusTag,
} from "../src/portal-ui/planning-lineage-model";
import type { ProjectGeneration } from "../src/project-generation/contract";
import {
  buildPlanningLineageProjection,
  findPlanningLineageSubjectProjection,
  nativeEventHistoryAvailabilityFor,
} from "../src/project-generation/planning-lineage";
import {
  authoritySchema,
  effortSchema,
  projectGenerationSchema,
} from "../src/project-generation/schema";
import { assetProjectionSchema } from "../src/project-generation/schema-asset";
import { createSourceRecord } from "../src/project-generation/source-records";
import {
  createAttentionWithoutActiveWorkFixture,
  createAvailableLifecycleTimeFixture,
  createConfirmedNoManagedWorkFixture,
  createHistoryOnlyWorkFixture,
} from "./fixtures/effort-work-rollup";
import { createProjectOverviewFixture } from "./fixtures/project-overview";
import { parseRebuiltPlanningLineageFixture } from "./planning-lineage-fixture";

const fixture = (): ProjectGeneration => createProjectOverviewFixture();
const withLineage = parseRebuiltPlanningLineageFixture;
const readable = (
  model: PlanningLineageSubjectModel,
): Extract<PlanningLineageSubjectModel, { state: "available" | "partial" }> => {
  if (model.state !== "available" && model.state !== "partial") {
    throw new Error(`Expected readable model, received ${model.state}.`);
  }
  return model;
};

const proseFor = (section: PlanningLineageSection | undefined): string | undefined =>
  section?.content.find((content) => content.kind === "plain-prose")?.value;

const bulletedFactsFor = (
  section: PlanningLineageSection | undefined,
): readonly string[] | undefined =>
  section?.content.find((content) => content.kind === "fact-list" && content.style === "bulleted")
    ?.values;

const definitionFactsFor = (section: PlanningLineageSection | undefined) =>
  section?.content.find(
    (content) => content.kind === "fact-list" && content.style === "definitions",
  )?.facts;

const providerSectionFor = (section: PlanningLineageSection | undefined) => {
  const document = section?.content.find(
    (content) => content.kind === "provider-document",
  )?.document;
  if (document === undefined) return undefined;
  return document.sections[0];
};

test("fails closed with a diagnostic for an unknown status token", () => {
  expect(resolvePlanningLineageStatusTag("future-lifecycle-state")).toEqual({
    token: "status-unknown",
    label: "Status unavailable",
    tone: "muted",
    tooltip: "This status token is not supported by this Portal version.",
    diagnostic: {
      code: "portal.status-token.unknown",
      message: "Unsupported Portal status token: future-lifecycle-state",
    },
  });

  const snapshot = fixture();
  if (snapshot.roadmaps.validity === "invalid") {
    throw new Error("Expected readable Roadmap fixtures.");
  }
  const roadmaps = snapshot.roadmaps;
  const roadmap = roadmaps.items[0];
  if (roadmap === undefined) throw new Error("Expected a Roadmap fixture.");
  const model = readable(
    buildPlanningLineageSubjectModel(
      {
        ...snapshot,
        roadmaps: {
          ...roadmaps,
          items: [
            { ...roadmap, lifecycle: "future-lifecycle-state" as never },
            ...roadmaps.items.slice(1),
          ],
        },
      },
      { kind: "roadmap", id: roadmap.id },
      "bearing",
    ),
  );
  expect(model.headerStatuses).toEqual([
    {
      token: "status-unknown",
      label: "Status unavailable",
      tone: "muted",
      tooltip: "This status token is not supported by this Portal version.",
      diagnostic: {
        code: "portal.status-token.unknown",
        message: "Unsupported Portal status token: lifecycle-future-lifecycle-state",
      },
    },
  ]);
});

test("keeps position and completed lifecycle statuses visually distinct", () => {
  expect(resolvePlanningLineageStatusTag("position-current")).toMatchObject({
    label: "Current",
    tone: "current",
  });
  expect(resolvePlanningLineageStatusTag("lifecycle-completed")).toMatchObject({
    label: "Completed",
    tone: "completed",
  });
});

const effortRollupFor = (section: PlanningLineageSection | undefined) =>
  section?.content.find((content) => content.kind === "effort-rollup")?.rows;

const timeFactsFor = (section: PlanningLineageSection | undefined) =>
  section?.content.find((content) => content.kind === "time-facts")?.facts;

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
  ]);
  expect(model.sections.map((section) => section.anchor)).toEqual([
    "gate.intent",
    "gate.exit-criteria",
    "gate.passage",
    "native-work.effort-summaries",
  ]);
  expect(model.headerStatuses?.map((status) => status.token)).toEqual(["lifecycle-passed"]);
  expect(
    effortRollupFor(
      model.sections.find((section) => section.anchor === "native-work.effort-summaries"),
    ),
  ).toEqual([
    {
      id: "effort:model",
      title: "Planning Model",
      href: "/projects/bearing/lineage/effort/effort%3Amodel",
      lifecycle: "concluded",
      lifecycleTime: { label: "Concluded", time: { availability: "unavailable" } },
      counts: {
        claimed: { mode: "exact", value: 0 },
        ready: { mode: "exact", value: 0 },
        blocked: { mode: "exact", value: 0 },
        resolved: { mode: "exact", value: 1 },
      },
    },
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
        key: "planning-use.citations",
        state: "confirmed-none",
      }),
    ]),
  );
});

test("builds one complete Roadmap Outcome Spine with ordered Gates and nested Efforts", () => {
  const model = readable(
    buildPlanningLineageSubjectModel(
      fixture(),
      { kind: "roadmap", id: "roadmap:portal" },
      "bearing",
    ),
  );

  expect(model.outcomeSpine).toMatchObject({
    layout: "horizontal-eligible",
    gates: [
      {
        id: "gate:one",
        title: "Model ready",
        focused: false,
        efforts: [{ id: "effort:model", title: "Planning Model" }],
      },
      {
        id: "gate:two",
        title: "Overview proven",
        focused: true,
        efforts: [{ id: "effort:portal", title: "Web Portal Validation" }],
      },
    ],
  });
  expect(model.sections.map((section) => section.anchor)).toEqual(["roadmap.intent"]);
  expect(model.headerStatuses).toEqual([
    {
      token: "lifecycle-active",
      label: "Active",
      tone: "active",
      tooltip: "This lifecycle is active.",
    },
  ]);
});

test("forces the complete Outcome Spine vertical when title content exceeds readable cells", () => {
  const snapshot = fixture();
  if (snapshot.gates.validity === "invalid") throw new Error("Expected Gates.");
  const longTitle = withLineage({
    ...snapshot,
    gates: {
      ...snapshot.gates,
      items: snapshot.gates.items.map((gate) =>
        gate.id === "gate:one"
          ? {
              ...gate,
              title:
                "A deliberately long mixed 中文 English Gate title that must remain complete without shrinking or horizontal scrolling",
            }
          : gate,
      ),
    },
  });
  const model = readable(
    buildPlanningLineageSubjectModel(
      longTitle,
      { kind: "roadmap", id: "roadmap:portal" },
      "bearing",
    ),
  );

  expect(model.outcomeSpine?.layout).toBe("vertical");
  expect(model.outcomeSpine?.gates[0]?.title).toContain("mixed 中文 English");
});

test("builds Effort, Asset, and Planning Review routes from their own truth", () => {
  const snapshot = fixture();
  const expectations = [
    [
      { kind: "effort", id: "effort:model" },
      [],
      ["outcome.roadmap", "outcome.target-gate", "native-work.binding", "planning-use.citations"],
    ],
    [
      { kind: "asset", id: "asset:planning-model-evidence" },
      ["asset.identity", "asset.ownership", "asset.lifecycle", "asset.source", "asset.evidence"],
      ["production.owner", "planning-use.cited-by"],
    ],
    [
      { kind: "planning-review", id: "planning-review:sequence" },
      [
        "planning-review.question",
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
  expect(JSON.stringify(effort.effortLens)).not.toMatch(
    /planned at|activated at|concluded at|T\d\d:/iu,
  );
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
    definitionFactsFor(asset.sections.find((section) => section.anchor === "asset.evidence")),
  ).toEqual([
    { key: "citations", label: "Planning Citations", value: "1" },
    { key: "authority-baselines", label: "Authority baselines", value: "0" },
  ]);
  expect(asset.relations.map((relation) => relation.key)).not.toContain("production.producer");
  if (snapshot.assets.validity === "invalid") throw new Error("Expected Assets.");
  const prototypeSnapshot = withLineage({
    ...snapshot,
    assets: {
      ...snapshot.assets,
      items: snapshot.assets.items.map((candidate) =>
        candidate.id === "asset:planning-model-evidence"
          ? { ...candidate, kind: "prototype" }
          : candidate,
      ),
    },
  });
  const prototype = buildPlanningLineageSubjectModel(
    prototypeSnapshot,
    { kind: "asset", id: "asset:planning-model-evidence" },
    "bearing",
  );
  expect(prototype.state).toBe("available");
  if (prototype.state !== "available") throw new Error("Expected complete prototype semantics.");
  expect(prototype.sections.map((section) => section.anchor)).toEqual([
    "asset.identity",
    "asset.ownership",
    "asset.lifecycle",
    "asset.source",
    "asset.evidence",
  ]);
  expect(
    findPlanningLineageSubjectProjection(prototypeSnapshot.lineage, {
      kind: "asset",
      id: "asset:planning-model-evidence",
    })?.semanticSections,
  ).not.toContainEqual(expect.objectContaining({ role: "asset.content" }));
  const directorySnapshot = withLineage(snapshot);
  const directory = readable(
    buildPlanningLineageSubjectModel(
      directorySnapshot,
      { kind: "asset", id: "asset:planning-model-evidence" },
      "bearing",
    ),
  );
  expect(directory.sections.map((section) => section.anchor)).toEqual([
    "asset.identity",
    "asset.ownership",
    "asset.lifecycle",
    "asset.source",
    "asset.evidence",
  ]);
  expect(
    findPlanningLineageSubjectProjection(directorySnapshot.lineage, {
      kind: "asset",
      id: "asset:planning-model-evidence",
    })?.semanticSections,
  ).not.toContainEqual(expect.objectContaining({ role: "asset.content" }));
  const review = readable(
    buildPlanningLineageSubjectModel(
      snapshot,
      { kind: "planning-review", id: "planning-review:sequence" },
      "bearing",
    ),
  );
  expect(review.events).toEqual([]);
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
  expect(projectGenerationSchema.safeParse({ ...ambiguous, lineage }).success).toBe(false);
});

test("large relation collections expose truthful coverage and a stable filtered view", () => {
  const snapshot = fixture();
  if (
    snapshot.roadmaps.validity === "invalid" ||
    snapshot.efforts.validity === "invalid" ||
    snapshot.gates.validity === "invalid"
  ) {
    throw new Error("Expected Roadmaps, Efforts, and Gates.");
  }
  const template = snapshot.efforts.items[0];
  if (template === undefined) throw new Error("Expected an Effort.");
  const modelEffort = snapshot.efforts.items.find((effort) => effort.id === "effort:model");
  const portalEffort = snapshot.efforts.items.find((effort) => effort.id === "effort:portal");
  if (modelEffort === undefined || portalEffort === undefined) {
    throw new Error("Expected the ordered fixture Efforts.");
  }
  const extras = Array.from({ length: 5 }, (_, index) => {
    const id = `effort:extra-${index + 1}`;
    const source = createSourceRecord(snapshot.basis.basisFingerprint, {
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
        workBindingState: { state: "invalid", reason: "missing" },
      }),
    };
  });
  const extraEfforts = extras.map(({ effort }) => effort);
  const lastExtra = extraEfforts[4];
  if (lastExtra === undefined) throw new Error("Expected the fifth extra Effort.");
  const gateOneEffortIds = [
    lastExtra.id,
    modelEffort.id,
    ...extraEfforts.slice(0, 4).map((effort) => effort.id),
  ];
  const expanded = withLineage({
    ...snapshot,
    sources: [...snapshot.sources, ...extras.map(({ source }) => source)],
    roadmaps: {
      ...snapshot.roadmaps,
      items: snapshot.roadmaps.items.map((roadmap) =>
        roadmap.id === "roadmap:portal"
          ? { ...roadmap, effortIds: [...gateOneEffortIds, portalEffort.id] }
          : roadmap,
      ),
    },
    gates: {
      ...snapshot.gates,
      items: snapshot.gates.items.map((gate) =>
        gate.id === "gate:one" ? { ...gate, effortIds: gateOneEffortIds } : gate,
      ),
    },
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
  expect(
    effortRollupFor(
      model.sections.find((section) => section.anchor === "native-work.effort-summaries"),
    )?.map((row) => row.id),
  ).toEqual(gateOneEffortIds);
});

test("renders complete provider-native dossiers on stable Local identities without file actions", () => {
  const snapshot = fixture();
  const map = readable(
    buildPlanningLineageSubjectModel(
      snapshot,
      { kind: "native-subject", id: ".scratch/portal/map.md" },
      "bearing",
    ),
  );
  expect(map.parentPath.map((crumb) => crumb.label)).toEqual([
    "Portal Project",
    "Portal Evolution",
    "Overview proven",
    "Web Portal Validation",
  ]);
  expect(map.subject.sourceHref).toBeUndefined();
  expect(map.sections.map((section) => section.anchor)).toEqual(
    expect.arrayContaining([
      "map.destination",
      "map.lifecycle",
      "map.fog",
      "map.decisions",
      "map.out-of-scope",
      "map.notes",
      "map.resolution-evidence",
      "native.provenance",
      "native.observation-trust",
    ]),
  );
  expect(proseFor(map.sections.find((section) => section.anchor === "map.decisions"))).toBe(
    "No decisions are recorded.",
  );
  expect(bulletedFactsFor(map.sections.find((section) => section.anchor === "map.fog"))).toEqual([
    "Finish the product journey.",
    "Review the evidence.",
  ]);
  expect(
    bulletedFactsFor(map.sections.find((section) => section.anchor === "native.provenance")),
  ).toBeUndefined();
  expect(map.semanticAvailability.get("map.lifecycle")).toBe("available");
  expect(map.semanticAvailability.get("native.provenance")).toBe("available");
  expect(map.semanticAvailability.get("native.observation-trust")).toBe("available");

  const wayfinder = readable(
    buildPlanningLineageSubjectModel(
      snapshot,
      { kind: "native-subject", id: ".scratch/portal/issues/01-build.md" },
      "bearing",
    ),
  );
  expect(wayfinder.parentPath.map((crumb) => crumb.label)).toEqual([
    "Portal Project",
    "Portal Evolution",
    "Overview proven",
    "Web Portal Validation",
    "Portal Validation",
  ]);
  expect(wayfinder.sections.map((section) => section.anchor)).toEqual(
    expect.arrayContaining([
      "wayfinder.question",
      "wayfinder.claim",
      "wayfinder.answer",
      "wayfinder.lifecycle",
      "native.provenance",
      "native.observation-trust",
    ]),
  );
});

test("persists one generation-bound Native Work Reading State for Snapshot and Portal", () => {
  const snapshot = fixture();
  const effort = snapshot.lineage.subjects.find(
    (subject) => subject.identity.kind === "effort" && subject.identity.id === "effort:portal",
  );
  const scope = snapshot.lineage.subjects.find(
    (subject) =>
      subject.identity.kind === "native-scope" && subject.identity.id === ".scratch/portal",
  );
  expect(effort?.nativeWorkReadingState).toMatchObject({
    conclusion: "Open work remains",
    binding: { state: "bound", effortIds: ["effort:portal"] },
    why: {
      projectionState: "available",
      freshness: "current",
      coverage: "complete",
      completion: "incomplete",
      blockingDiagnosticCount: 0,
    },
  });
  expect(scope?.nativeWorkReadingState).toEqual(effort?.nativeWorkReadingState);

  const model = buildPlanningLineageSubjectModel(
    snapshot,
    { kind: "native-scope", id: ".scratch/portal" },
    "bearing",
  );
  expect(model.state).toBe("available");
  if (model.state !== "available") throw new Error("Expected native scope model.");
  expect(model.workRegion?.readingState).toEqual(scope?.nativeWorkReadingState);
});

test("builds an Effort-first governance lens from canonical lifecycle and nonterminal bound work", () => {
  const active = readable(
    buildPlanningLineageSubjectModel(fixture(), { kind: "effort", id: "effort:portal" }, "bearing"),
  );

  expect(active.effortLens).toMatchObject({
    lifecycle: "active",
    targetGate: {
      title: "Overview proven",
      href: "/projects/bearing/lineage/gate/gate%3Atwo",
    },
    managedWorkHealth: "Healthy",
    intent: "Deliver the accepted Portal journey.",
    currentWork: {
      state: "available",
      currentHref: "/projects/bearing/lineage/native-scope/.scratch%2Fportal#native-work-current",
      resolvedHref: "/projects/bearing/lineage/native-scope/.scratch%2Fportal#native-work-resolved",
      counts: {
        total: { mode: "exact", value: 4 },
        current: { mode: "exact", value: 4 },
        resolved: { mode: "exact", value: 0 },
      },
      items: [
        { title: "Build the Roadmap journey", status: "Claimed" },
        { title: "Review the Roadmap journey", status: "Ready" },
        {
          title: "Pass the integration gate",
          status: "Blocked",
          blockerImpact: "Blocked by unresolved prerequisite work.",
        },
        { title: "Route a new Portal request", status: "Ready" },
      ],
    },
  });
  expect(active.effortLens?.outcome).toBeUndefined();
  expect(active.effortLens?.managedWorkObservation).toBeUndefined();
  const activeCurrentWork = active.effortLens?.currentWork;
  if (activeCurrentWork?.state !== "available") throw new Error("Expected current work.");
  expect(activeCurrentWork.items.map((item) => item.title)).not.toContain("Portal Validation");
  expect(activeCurrentWork.items.map((item) => item.title)).not.toContain("Portal Validation PRD");
  expect(active.sections).toEqual([]);

  const concluded = readable(
    buildPlanningLineageSubjectModel(fixture(), { kind: "effort", id: "effort:model" }, "bearing"),
  );
  expect(concluded.effortLens).toMatchObject({
    lifecycle: "concluded",
    targetGate: { title: "Model ready" },
    managedWorkHealth: "Healthy",
    outcome: {
      disposition: "completed",
      rationale: "The governed contribution was explicitly accepted as complete.",
      concludedAt: { availability: "unavailable" },
    },
  });
  expect(concluded.effortLens?.currentWork).toMatchObject({
    state: "available",
    items: [],
    emptyState: "resolved-only",
    counts: {
      total: { mode: "exact", value: 1 },
      current: { mode: "exact", value: 0 },
      resolved: { mode: "exact", value: 1 },
    },
  });
});

test("warns when a concluded Effort still has nonterminal native work", () => {
  const snapshot = fixture();
  if (snapshot.efforts.validity === "invalid") throw new Error("Expected Efforts.");
  const concludedWithOpenWork = withLineage({
    ...snapshot,
    efforts: {
      ...snapshot.efforts,
      items: snapshot.efforts.items.map((effort) =>
        effort.id === "effort:portal"
          ? effortSchema.parse({
              ...effort,
              lifecycle: "concluded",
              conclusion: {
                disposition: "completed",
                rationale: "The canonical Effort is concluded while provider work remains open.",
                concludedAt: { availability: "unavailable" },
              },
            })
          : effort,
      ),
    },
  });
  const model = readable(
    buildPlanningLineageSubjectModel(
      concludedWithOpenWork,
      { kind: "effort", id: "effort:portal" },
      "bearing",
    ),
  );

  expect(model.effortLens?.currentWork).toMatchObject({
    state: "available",
    consistencyWarning:
      "This Effort is concluded, but nonterminal managed work remains in the bound scope.",
  });
});

test("identifies confirmed no managed work independently from planning-basis documents", () => {
  const model = readable(
    buildPlanningLineageSubjectModel(
      createConfirmedNoManagedWorkFixture(),
      { kind: "effort", id: "effort:portal" },
      "bearing",
    ),
  );

  expect(model.effortLens?.currentWork).toMatchObject({
    state: "available",
    items: [],
    emptyState: "confirmed-no-managed-work",
    counts: {
      total: { mode: "exact", value: 0 },
      current: { mode: "exact", value: 0 },
      resolved: { mode: "exact", value: 0 },
    },
  });
  expect(model.effortLens?.managedWorkHealth).toBe("Healthy");
});

test("identifies resolved-only Work without counting Planning Basis", () => {
  const model = readable(
    buildPlanningLineageSubjectModel(
      createHistoryOnlyWorkFixture(),
      { kind: "effort", id: "effort:model" },
      "bearing",
    ),
  );

  expect(model.effortLens?.currentWork).toMatchObject({
    state: "available",
    items: [],
    emptyState: "resolved-only",
    counts: {
      total: { mode: "exact", value: 1 },
      current: { mode: "exact", value: 0 },
      resolved: { mode: "exact", value: 1 },
    },
  });
});

test("identifies no active work with remaining Attention and preserves uncertain counts", () => {
  const model = readable(
    buildPlanningLineageSubjectModel(
      createAttentionWithoutActiveWorkFixture(),
      { kind: "effort", id: "effort:portal" },
      "bearing",
    ),
  );

  expect(model.effortLens?.currentWork).toMatchObject({
    state: "available",
    items: [],
    emptyState: "attention-without-active-work",
    counts: {
      total: { mode: "at-least", value: 0 },
      current: { mode: "at-least", value: 0 },
      resolved: { mode: "at-least", value: 0 },
    },
  });
  expect(model.effortLens?.managedWorkHealth).toBe("Needs attention");
});

test("preserves an available canonical lifecycle time in the Gate rollup", () => {
  const model = readable(
    buildPlanningLineageSubjectModel(
      createAvailableLifecycleTimeFixture(),
      { kind: "gate", id: "gate:one" },
      "bearing",
    ),
  );

  expect(
    effortRollupFor(
      model.sections.find((section) => section.anchor === "native-work.effort-summaries"),
    ),
  ).toEqual([
    expect.objectContaining({
      id: "effort:model",
      lifecycleTime: {
        label: "Concluded",
        time: {
          availability: "available",
          value: "2026-07-31T10:00:00Z",
          precision: "second",
        },
      },
    }),
  ]);
});

test("discloses only degraded Effort observation state with exact bound recovery", () => {
  const snapshot = fixture();
  const portal = snapshot.providerObservations.find(
    (observation) =>
      observation.binding.nativeScope === ".scratch/portal" &&
      (observation.state === "available" || observation.state === "partial"),
  );
  if (portal === undefined || (portal.state !== "available" && portal.state !== "partial")) {
    throw new Error("Expected the Portal observation.");
  }
  const partial = createProviderScopeObservation({
    ...portal,
    state: "partial",
    coverage: {
      assessment: "incomplete",
      dimensions: [{ key: "scope", state: "gap" }],
    },
  } as never) as typeof portal;
  const candidate = withLineage({
    ...snapshot,
    providerObservations: snapshot.providerObservations.map((observation) =>
      observation.id === portal.id ? partial : observation,
    ),
    providerObservationSelections: snapshot.providerObservationSelections.map((selection) =>
      selection.observationId === portal.id
        ? {
            ...selection,
            observationId: partial.id,
            effectiveFreshness: partial.freshness.assessment,
          }
        : selection,
    ),
  });
  const model = readable(
    buildPlanningLineageSubjectModel(candidate, { kind: "effort", id: "effort:portal" }, "bearing"),
  );

  expect(model.effortLens?.managedWorkHealth).toBe("Needs attention");
  expect(model.effortLens?.managedWorkObservation).toEqual({
    state: "partial",
    indication: "Managed work coverage is partial; confirmed items remain visible.",
    lastVerified: "2026-07-28T00:00:00.000Z",
    refreshTarget: { kind: "native-scope", id: ".scratch/portal" },
  });
  expect(model.effortLens?.currentWork?.state).toBe("available");
  const currentWork = model.effortLens?.currentWork;
  if (currentWork?.state !== "available") throw new Error("Expected retained current work.");
  expect(currentWork.items.map((item) => item.title)).toContain("Build the Roadmap journey");
});

test("uses a refreshed disposable observation only for its exact bound Effort scope", () => {
  const snapshot = fixture();
  const portal = snapshot.providerObservations.find(
    (observation) =>
      observation.binding.nativeScope === ".scratch/portal" &&
      (observation.state === "available" || observation.state === "partial"),
  );
  if (portal === undefined || (portal.state !== "available" && portal.state !== "partial")) {
    throw new Error("Expected the Portal observation.");
  }
  const stale = createProviderScopeObservation({
    ...portal,
    freshness: { ...portal.freshness, assessment: "stale" },
  } as never) as typeof portal;
  const refreshed = createProviderScopeObservation({
    ...portal,
    observedAt: "2026-08-03T10:00:00.000Z",
    projection: {
      ...portal.projection,
      deliveryTickets: [],
      structuralOrder: portal.projection.structuralOrder.filter(
        (reference) => !reference.endsWith("03-gate.md"),
      ),
      graph: {
        ...portal.projection.graph,
        parentChild: portal.projection.graph.parentChild.filter(
          (relation) => !relation.child.endsWith("03-gate.md"),
        ),
        blockedBy: [],
      },
    },
  } as never) as typeof portal;
  const candidate = withLineage({
    ...snapshot,
    providerObservations: snapshot.providerObservations.map((observation) =>
      observation.id === portal.id ? stale : observation,
    ),
    providerObservationSelections: snapshot.providerObservationSelections.map((selection) =>
      selection.observationId === portal.id
        ? { ...selection, observationId: stale.id, effectiveFreshness: "stale" as const }
        : selection,
    ),
    providerDetailEvidences: {
      observations: [refreshed],
      selections: [
        {
          provider: "matt-skills/v1" as const,
          nativeScope: ".scratch/portal",
          observationId: refreshed.id,
          effectiveFreshness: "current" as const,
          latestAttempt: {
            intent: "provider-detail-selection" as const,
            attemptedAt: "2026-08-03T10:00:00.000Z",
            outcome: "succeeded" as const,
            diagnostics: [],
          },
        },
      ],
    },
  });
  const portalModel = readable(
    buildPlanningLineageSubjectModel(candidate, { kind: "effort", id: "effort:portal" }, "bearing"),
  );
  const modelWork = portalModel.effortLens?.currentWork;
  if (modelWork?.state !== "available") throw new Error("Expected refreshed current work.");

  expect(modelWork.items.map((item) => item.title)).not.toContain("Pass the integration gate");
  expect(portalModel.effortLens?.managedWorkObservation).toMatchObject({
    state: "stale",
    lastVerified: "2026-08-03T10:00:00.000Z",
    latestRefreshSucceeded: true,
  });
  const unrelated = readable(
    buildPlanningLineageSubjectModel(candidate, { kind: "effort", id: "effort:model" }, "bearing"),
  );
  expect(unrelated.effortLens?.managedWorkHealth).toBe("Healthy");
});

test("builds a bounded Planning Basis and rejects duplicate Map or Spec candidates", () => {
  const active = readable(
    buildPlanningLineageSubjectModel(fixture(), { kind: "effort", id: "effort:portal" }, "bearing"),
  );
  expect(active.effortLens?.planningBasis).toEqual({
    state: "available",
    items: [
      {
        role: "Map",
        title: "Portal Validation",
        lifecycle: "active",
        href: "/projects/bearing/lineage/native-subject/.scratch%2Fportal%2Fmap.md",
      },
      {
        role: "PRD / Spec",
        title: "Portal Validation PRD",
        lifecycle: "ready-for-agent",
        href: "/projects/bearing/lineage/native-subject/.scratch%2Fportal%2FPRD.md",
      },
    ],
  });

  const concluded = readable(
    buildPlanningLineageSubjectModel(fixture(), { kind: "effort", id: "effort:model" }, "bearing"),
  );
  expect(concluded.effortLens?.planningBasis).toMatchObject({
    state: "available",
    items: [{ role: "Map", title: "Planning Model" }],
  });

  const region = active.workRegion;
  if (region === undefined) throw new Error("Expected a work region.");
  const duplicateMap = {
    ...region,
    roles: region.roles.map((group) =>
      group.role === "map" ? { ...group, items: [...group.items, ...group.items] } : group,
    ),
  };
  expect(effortPlanningBasisForWorkRegion(duplicateMap, "bearing")).toEqual({
    state: "attention",
    diagnostic: {
      code: "effort.planning-basis.multiple-candidates",
      message:
        "Planning Basis requires at most one Map and one PRD / Spec; multiple candidates cannot be rendered as a valid basis.",
    },
  });
});

test("projects explicit Effort Outputs and Governance without inferring latest from titles", () => {
  const snapshot = fixture();
  if (snapshot.assets.validity === "invalid" || snapshot.efforts.validity === "invalid") {
    throw new Error("Expected Assets and Efforts.");
  }
  const firstAsset = snapshot.assets.items[0];
  const modelEffort = snapshot.efforts.items.find((effort) => effort.id === "effort:portal");
  if (firstAsset === undefined || modelEffort === undefined) {
    throw new Error("Expected the model Effort and its evidence.");
  }
  const accepted = (value: string) =>
    ({ availability: "available", value, precision: "second" }) as const;
  const authoritySource = createSourceRecord(snapshot.basis.basisFingerprint, {
    kind: "canonical",
    locator: ".bearing/state/authorities/design.md",
    binding: { role: "authority", identity: "authority:design" },
  });
  const secondAssetSource = createSourceRecord(snapshot.basis.basisFingerprint, {
    kind: "asset",
    locator: ".bearing/state/assets.md",
    binding: { role: "asset", identity: "asset:planning-model-evidence-v2" },
    fragment: "asset:planning-model-evidence-v2",
  });
  const thirdAssetSource = createSourceRecord(snapshot.basis.basisFingerprint, {
    kind: "asset",
    locator: ".bearing/state/assets.md",
    binding: { role: "asset", identity: "asset:planning-model-evidence-v3" },
    fragment: "asset:planning-model-evidence-v3",
  });
  const authority = authoritySchema.parse({
    id: "authority:design",
    title: "Design",
    source: authoritySource.reference,
    citations: [],
    scope: "Govern the planning-model outputs.",
    baselineAssetIds: [],
  });
  const first = assetProjectionSchema.parse({
    ...firstAsset,
    owner: modelEffort.id,
    disposition: "superseded",
    supersededBy: "asset:planning-model-evidence-v2",
    supersededAt: accepted("2026-08-03T08:00:00Z"),
    addedAt: accepted("2026-08-01T08:00:00Z"),
  });
  const availableOutput = (
    id: "asset:planning-model-evidence-v2" | "asset:planning-model-evidence-v3",
    title: string,
    source: typeof secondAssetSource,
    addedAt: string,
  ) => {
    const slug = id.slice("asset:".length);
    return assetProjectionSchema.parse({
      ...firstAsset,
      id,
      title,
      source: source.reference,
      owner: modelEffort.id,
      citations: [],
      authorityBaselines: [],
      disposition: "active",
      addedAt: accepted(addedAt),
      sourceLocator: `.scratch/evidence/${slug}`,
    });
  };
  const second = availableOutput(
    "asset:planning-model-evidence-v2",
    "Planning Model Evidence v2",
    secondAssetSource,
    "2026-08-02T08:00:00Z",
  );
  const third = availableOutput(
    "asset:planning-model-evidence-v3",
    "Planning Model Evidence v3",
    thirdAssetSource,
    "2026-08-03T08:00:00Z",
  );
  const candidate = withLineage({
    ...snapshot,
    sources: [...snapshot.sources, authoritySource, secondAssetSource, thirdAssetSource],
    authorities: { validity: "available", items: [authority] },
    efforts: {
      ...snapshot.efforts,
      items: snapshot.efforts.items.map((effort) =>
        effort.id === modelEffort.id
          ? effortSchema.parse({ ...effort, authorityIds: [authority.id] })
          : effort,
      ),
    },
    assets: { validity: "available", items: [first, second, third] },
  });
  const model = readable(
    buildPlanningLineageSubjectModel(candidate, { kind: "effort", id: modelEffort.id }, "bearing"),
  );

  expect(model.effortLens?.outputs).toMatchObject({
    state: "available",
    items: [
      { title: "Planning Model Evidence", superseded: true, lifecycle: "superseded" },
      { title: "Planning Model Evidence v2", superseded: false, lifecycle: "active" },
      { title: "Planning Model Evidence v3", superseded: false, lifecycle: "active" },
    ],
  });
  expect(
    model.effortLens?.outputs?.state === "available" && model.effortLens.outputs.items[1]?.times,
  ).toEqual([
    expect.objectContaining({ label: "Added to Assets", time: accepted("2026-08-02T08:00:00Z") }),
  ]);
  expect(model.effortLens?.governance).toEqual({
    authorities: [
      { title: "Design", href: "/projects/bearing/lineage/authority/authority%3Adesign" },
    ],
    citations: [],
  });
});

test("keeps Spec, Delivery, Incoming, and native scope semantics independent", () => {
  const snapshot = fixture();
  const spec = readable(
    buildPlanningLineageSubjectModel(
      snapshot,
      { kind: "native-subject", id: ".scratch/portal/PRD.md" },
      "bearing",
    ),
  );
  expect(
    definitionFactsFor(spec.sections.find((section) => section.anchor === "spec.lifecycle")),
  ).toEqual([{ key: "lifecycle", label: "Lifecycle", value: "ready-for-agent" }]);
  expect(
    providerSectionFor(spec.sections.find((section) => section.anchor === "spec.testing")),
  ).toMatchObject({
    version: 1,
    sourceIdentity: "spec.testing",
    title: "Testing Decisions",
    availability: "available",
  });

  const delivery = readable(
    buildPlanningLineageSubjectModel(
      snapshot,
      { kind: "native-subject", id: ".scratch/portal/issues/03-gate.md" },
      "bearing",
    ),
  );
  expect(delivery.parentPath.map((crumb) => crumb.label)).toEqual([
    "Portal Project",
    "Portal Evolution",
    "Overview proven",
    "Web Portal Validation",
    "Portal Validation PRD",
  ]);
  expect(
    delivery.relations.find((relation) => relation.key === "native-work.blocked-by"),
  ).toMatchObject({
    state: "present",
    total: { count: 1, coverage: "complete" },
  });

  const incoming = readable(
    buildPlanningLineageSubjectModel(
      snapshot,
      { kind: "native-subject", id: ".scratch/portal/issues/04-incoming.md" },
      "bearing",
    ),
  );
  expect(
    definitionFactsFor(
      incoming.sections.find((section) => section.anchor === "incoming.classification"),
    ),
  ).toEqual(
    expect.arrayContaining([
      { key: "category", label: "Category", value: "enhancement" },
      { key: "state", label: "State", value: "ready-for-agent" },
    ]),
  );

  const scope = readable(
    buildPlanningLineageSubjectModel(
      snapshot,
      { kind: "native-scope", id: ".scratch/portal" },
      "bearing",
    ),
  );
  expect(scope.subject.title).toBe("Contributing Work");
  expect(scope.workHistoryOwner).toEqual({
    title: "Web Portal Validation",
    href: "/projects/bearing/lineage/effort/effort%3Aportal",
  });
  expect(scope.sections).toEqual([]);
  expect(scope.sections.some((section) => section.anchor === "native-scope.subjects")).toBe(false);
  expect(scope.workRegion?.roles.map((role) => role.role)).toEqual([
    "map",
    "spec",
    "wayfinder",
    "delivery",
    "incoming",
  ]);
  expect(scope.workRegion?.roles.flatMap((role) => role.items.map((item) => item.title))).toEqual([
    "Portal Validation",
    "Portal Validation PRD",
    "Build the Roadmap journey",
    "Review the Roadmap journey",
    "Pass the integration gate",
    "Route a new Portal request",
  ]);
  expect(
    buildPlanningLineageSubjectModel(
      snapshot,
      { kind: "native-subject", id: ".scratch/model/PRD.md" },
      "bearing",
    ),
  ).toMatchObject({
    state: "missing",
  });
});

test("publishes one discriminated authored-content view model without flattened display bodies", () => {
  const snapshot = fixture();
  const read = (id: string) =>
    readable(buildPlanningLineageSubjectModel(snapshot, { kind: "native-subject", id }, "bearing"));
  const spec = read(".scratch/portal/PRD.md");
  const map = read(".scratch/portal/map.md");
  const wayfinder = read(".scratch/portal/issues/01-build.md");
  const delivery = read(".scratch/portal/issues/03-gate.md");
  const incoming = read(".scratch/portal/issues/04-incoming.md");

  for (const model of [spec, map, wayfinder, delivery, incoming]) {
    for (const section of model.sections) {
      expect(Object.keys(section).sort()).toEqual(["anchor", "content", "title"]);
      expect(section.content.every((content) => "kind" in content)).toBe(true);
    }
  }

  expect(
    spec.sections
      .find((section) => section.anchor === "spec.testing")
      ?.content.map(({ kind }) => kind),
  ).toEqual(["provider-document"]);
  expect(
    map.sections
      .find((section) => section.anchor === "map.destination")
      ?.content.map(({ kind }) => kind),
  ).toEqual(["provider-document"]);
  expect(
    wayfinder.sections
      .find((section) => section.anchor === "wayfinder.question")
      ?.content.map(({ kind }) => kind),
  ).toEqual(["provider-document"]);
  expect(
    delivery.sections
      .find((section) => section.anchor === "delivery.acceptance-criteria")
      ?.content.map(({ kind }) => kind),
  ).toEqual(["fact-list"]);

  const incomingDocument = incoming.sections
    .find((section) => section.anchor === "incoming.content")
    ?.content.find((content) => content.kind === "provider-document");
  expect(incomingDocument?.document.provenance.facts).toEqual(
    expect.arrayContaining([{ key: "role", label: "Role", value: "triage-note" }]),
  );
  expect(incomingDocument?.document.sections[0]?.version).toBe(1);
  expect(JSON.stringify(incomingDocument?.document.sections)).not.toContain("triage-note");

  const gate = readable(
    buildPlanningLineageSubjectModel(snapshot, { kind: "gate", id: "gate:one" }, "bearing"),
  );
  expect(gate.sections.find((section) => section.anchor === "gate.exit-criteria")?.content).toEqual(
    [expect.objectContaining({ kind: "fact-list", style: "bulleted" })],
  );
  expect(
    gate.sections.find((section) => section.anchor === "gate.exit-criteria")?.content,
  ).not.toEqual(expect.arrayContaining([expect.objectContaining({ kind: "provider-document" })]));

  const asset = readable(
    buildPlanningLineageSubjectModel(
      snapshot,
      { kind: "asset", id: "asset:planning-model-evidence" },
      "bearing",
    ),
  );
  const identity = asset.sections.find((section) => section.anchor === "asset.identity");
  expect(proseFor(identity)).toBe("Keep durable planning-model context available.");
  expect(definitionFactsFor(identity)).toEqual([
    { key: "kind", label: "Kind", value: "reference" },
  ]);
  expect(JSON.stringify(identity)).not.toContain("Kind: reference. Purpose:");
});

test("keeps canonical owners and typed facts outside Provider Markdown rendering", () => {
  const snapshot = fixture();
  const canonicalSubjects = [
    { label: "Roadmap", subject: { kind: "roadmap" as const, id: "roadmap:portal" } },
    { label: "Gate", subject: { kind: "gate" as const, id: "gate:one" } },
    { label: "Effort", subject: { kind: "effort" as const, id: "effort:portal" } },
    {
      label: "Review",
      subject: { kind: "planning-review" as const, id: "planning-review:sequence" },
    },
    {
      label: "Asset",
      subject: { kind: "asset" as const, id: "asset:planning-model-evidence" },
    },
  ];

  for (const { label, subject } of canonicalSubjects) {
    const model = readable(buildPlanningLineageSubjectModel(snapshot, subject, "bearing"));
    expect(
      model.sections.flatMap((section) =>
        section.content.filter((content) => content.kind === "provider-document"),
      ),
      `${label} canonical content must not enter the Provider renderer`,
    ).toEqual([]);
  }

  const map = readable(
    buildPlanningLineageSubjectModel(
      snapshot,
      { kind: "native-subject", id: ".scratch/portal/map.md" },
      "bearing",
    ),
  );
  expect(
    map.sections
      .filter((section) => section.content.some((content) => content.kind === "provider-document"))
      .map((section) => section.anchor),
  ).toEqual(["map.destination"]);
  for (const anchor of ["map.lifecycle", "map.fog", "map.decisions", "map.out-of-scope"]) {
    expect(
      map.sections
        .find((section) => section.anchor === anchor)
        ?.content.some((content) => content.kind === "provider-document") ?? false,
      `${anchor} typed facts must not enter the Provider renderer`,
    ).toBe(false);
  }

  expect(snapshot.summary.validity).toBe("available");
  if (snapshot.summary.validity !== "available") throw new Error("Expected Summary fixture.");
  expect(snapshot.summary.value.purpose).toBe("Keep the whole project visible.");
  expect(snapshot.brief.validity).toBe("absent");
  expect(snapshot.authorities.validity).toBe("available");
  if (snapshot.authorities.validity !== "available") throw new Error("Expected Authority fixture.");
  expect(snapshot.authorities.items).toEqual([]);
  expect(snapshot.audit.validity).toBe("available");
  if (snapshot.audit.validity !== "available") throw new Error("Expected Audit fixture.");
  expect(snapshot.audit.value.coverage).toBe("complete");
});

test("keeps unknown and ambiguous Incoming classifications distinct from needs-triage", () => {
  const snapshot = fixture();
  const portal = snapshot.providerObservations.find(
    (observation) =>
      observation.binding.nativeScope === ".scratch/portal" &&
      (observation.state === "available" || observation.state === "partial"),
  );
  if (portal === undefined || (portal.state !== "available" && portal.state !== "partial")) {
    throw new Error("Expected the Portal provider observation.");
  }
  const incomingIndex = portal.projection.incomingIssues.findIndex(
    (issue) => issue.ref === ".scratch/portal/issues/04-incoming.md",
  );
  if (incomingIndex < 0) throw new Error("Expected the Portal Incoming fixture.");

  const bodies: string[] = [];
  for (const classification of ["unknown", "ambiguous"] as const) {
    const incomingIssues = portal.projection.incomingIssues.map((issue, position) =>
      position === incomingIndex
        ? {
            ...issue,
            classification: {
              category: classification,
              state: classification,
            },
            semanticSections: issue.semanticSections.map((section) =>
              section.role === "incoming.classification" || section.role === "incoming.routing"
                ? { ...section, availability: "unavailable" as const }
                : section,
            ),
          }
        : issue,
    );
    const observation = createProviderScopeObservation({
      provider: portal.provider,
      binding: portal.binding,
      observedAt: portal.observedAt,
      ...(portal.sourceRevision === undefined ? {} : { sourceRevision: portal.sourceRevision }),
      ...(portal.sourceObservedAt === undefined
        ? {}
        : { sourceObservedAt: portal.sourceObservedAt }),
      validators: portal.validators,
      state: portal.state,
      freshness: portal.freshness,
      coverage: {
        assessment: portal.coverage.assessment,
        dimensions: portal.coverage.dimensions.map((dimension) => ({
          key: dimension.key,
          state: dimension.state,
          ...(dimension.detail === undefined ? {} : { detail: dimension.detail }),
        })),
      },
      completion: portal.completion,
      diagnostics: portal.diagnostics,
      projection: {
        ...portal.projection,
        incomingIssues,
      },
    });
    const providerObservations = snapshot.providerObservations.map((candidate) =>
      candidate.id === portal.id ? observation : candidate,
    );
    const providerObservationSelections = snapshot.providerObservationSelections.map((selection) =>
      selection.nativeScope === ".scratch/portal"
        ? { ...selection, observationId: observation.id }
        : selection,
    );
    const candidate = {
      ...snapshot,
      providerObservations,
      providerObservationSelections,
    };
    const projected = projectGenerationSchema.parse({
      ...candidate,
      lineage: buildPlanningLineageProjection(candidate),
    });
    const model = readable(
      buildPlanningLineageSubjectModel(
        projected,
        { kind: "native-subject", id: ".scratch/portal/issues/04-incoming.md" },
        "bearing",
      ),
    );
    const body = proseFor(
      model.sections.find((section) => section.anchor === "incoming.classification"),
    );
    expect(body).toContain(`Classification remains ${classification} · ${classification}`);
    expect(body).not.toContain("needs-triage");
    bodies.push(body ?? "");
  }
  expect(new Set(bodies).size).toBe(2);
});

test("withholds native hierarchy certainty when the selected observation is not trustworthy", () => {
  const snapshot = fixture();
  const providerObservationSelections = snapshot.providerObservationSelections.map((selection) =>
    selection.nativeScope === ".scratch/portal"
      ? { ...selection, effectiveFreshness: "undetermined" as const }
      : selection,
  );
  const candidate = {
    ...snapshot,
    providerObservationSelections,
  };
  const lineage = buildPlanningLineageProjection(candidate);
  const degraded = {
    ...candidate,
    lineage,
  } as ProjectGeneration;

  const mapProjection = findPlanningLineageSubjectProjection(lineage, {
    kind: "native-subject",
    id: ".scratch/portal/map.md",
  });
  expect(mapProjection?.parentPath).toMatchObject({
    state: "truncated-unavailable",
    reason: expect.stringContaining("not trustworthy"),
  });
  expect(
    mapProjection?.relations.find((relation) => relation.key === "native-work.parent"),
  ).toMatchObject({
    state: "unknown",
  });
  expect(
    mapProjection?.relations.find((relation) => relation.key === "native-work.children"),
  ).toMatchObject({
    state: "present",
    total: { count: 2, coverage: "at-least" },
  });
  expect(mapProjection?.semanticSections).toContainEqual({
    role: "map.decisions",
    availability: "confirmed-empty",
  });
  expect(mapProjection?.semanticSections).toContainEqual({
    role: "native.event-history",
    availability: "unsupported",
  });

  const scopeProjection = findPlanningLineageSubjectProjection(lineage, {
    kind: "native-scope",
    id: ".scratch/portal",
  });
  expect(scopeProjection?.semanticSections).toEqual([
    { role: "native-scope.trust", availability: "unavailable" },
    { role: "native-scope.subjects", availability: "available" },
  ]);
  expect(
    scopeProjection?.relations.find((relation) => relation.key === "native-work.members"),
  ).toMatchObject({
    state: "present",
    total: { count: 6, coverage: "at-least" },
  });

  const model = readable(
    buildPlanningLineageSubjectModel(
      degraded,
      { kind: "native-subject", id: ".scratch/portal/map.md" },
      "bearing",
    ),
  );
  expect(model.state).toBe("partial");
  expect(
    definitionFactsFor(
      model.sections.find((section) => section.anchor === "native.observation-trust"),
    ),
  ).toContainEqual({ key: "selected-evidence", label: "Selected evidence", value: "withheld" });
});

test("keeps a trustworthy native route readable when an unrelated scope is stale", () => {
  const snapshot = fixture();
  const providerObservationSelections = snapshot.providerObservationSelections.map((selection) =>
    selection.nativeScope === ".scratch/model"
      ? { ...selection, effectiveFreshness: "undetermined" as const }
      : selection,
  );
  const candidate = { ...snapshot, providerObservationSelections };
  const scoped = {
    ...candidate,
    lineage: buildPlanningLineageProjection(candidate),
  } as ProjectGeneration;

  const trustworthy = readable(
    buildPlanningLineageSubjectModel(
      scoped,
      { kind: "native-subject", id: ".scratch/portal/map.md" },
      "bearing",
    ),
  );
  expect(trustworthy).toMatchObject({
    state: "partial",
    subject: { title: "Portal Validation" },
  });
  expect(
    definitionFactsFor(
      trustworthy.sections.find((section) => section.anchor === "native.observation-trust"),
    ),
  ).toContainEqual({
    key: "selected-evidence",
    label: "Selected evidence",
    value: "trustworthy",
  });
  expect(
    buildPlanningLineageSubjectModel(
      scoped,
      { kind: "native-subject", id: ".scratch/model/map.md" },
      "bearing",
    ),
  ).toMatchObject({
    state: "partial",
    subject: { title: "Planning Model" },
  });
});

test("discloses selected stale and undetermined freshness without changing native event facts", () => {
  const snapshot = fixture();
  for (const freshness of ["stale", "undetermined"] as const) {
    const providerObservationSelections = snapshot.providerObservationSelections.map((selection) =>
      selection.nativeScope === ".scratch/portal"
        ? { ...selection, effectiveFreshness: freshness }
        : selection,
    );
    const candidate = { ...snapshot, providerObservationSelections };
    const scoped = {
      ...candidate,
      lineage: buildPlanningLineageProjection(candidate),
    } as ProjectGeneration;
    const model = readable(
      buildPlanningLineageSubjectModel(
        scoped,
        { kind: "native-subject", id: ".scratch/portal/map.md" },
        "bearing",
      ),
    );

    expect(
      definitionFactsFor(
        model.sections.find((section) => section.anchor === "native.observation-trust"),
      ),
    ).toContainEqual({ key: "freshness", label: "Freshness", value: freshness });
    expect(
      timeFactsFor(
        model.sections.find((section) => section.anchor === "native.observation-trust"),
      )?.find((fact) => fact.label === "Verified at")?.time,
    ).toEqual({
      availability: "available",
      value: "2026-07-28T00:00:00.000Z",
      precision: "fractional-second",
    });
    expect(model.events).toEqual([
      {
        role: "native.created",
        label: "Created",
        time: { availability: "unsupported" },
      },
    ]);
  }
});

test("renders GitHub tracker closure independently for Map and Spec native subjects", () => {
  const snapshot = fixture();
  const portal = snapshot.providerObservations.find(
    (observation) => observation.binding.nativeScope === ".scratch/portal",
  );
  if (
    portal === undefined ||
    (portal.state !== "available" && portal.state !== "partial") ||
    portal.projection.map === undefined ||
    portal.projection.spec === undefined
  ) {
    throw new Error("Expected Map and Spec fixtures.");
  }
  for (const [object, number, closedAt] of [
    [portal.projection.map, 1, "2026-07-21T01:02:03Z"],
    [portal.projection.spec, 2, "2026-07-22T04:05:06Z"],
  ] as const) {
    const closedObject = {
      ...object,
      native: {
        kind: "github" as const,
        identity: {
          repositoryDatabaseId: "9001",
          repositoryNodeId: "R_reference",
          objectKind: "issue" as const,
          objectDatabaseId: String(9100 + number),
          objectNodeId: `I_reference_${number}`,
          number,
          url: `https://github.com/example/reference/issues/${number}`,
          owner: "example",
          repository: "reference",
        },
        createdAt: {
          availability: "available" as const,
          value: "2026-07-01T00:00:00Z",
          precision: "second" as const,
          basis: "source-event" as const,
        },
        lastUpdated: {
          availability: "available" as const,
          value: "2026-07-02T00:00:00Z",
          precision: "second" as const,
          basis: "source-event" as const,
        },
        trackerClosure: {
          state: "closed" as const,
          disposition: "completed" as const,
          closedAt: {
            availability: "available" as const,
            value: closedAt,
            precision: "second" as const,
            basis: "source-event" as const,
          },
        },
        sourceAnchors: [],
        rawFacets: [],
      },
    };
    expect(nativeLifecycleEventsFor(closedObject)).toContainEqual({
      role: "native.tracker-closed",
      label: "Tracker closed",
      time: {
        availability: "available",
        value: closedAt,
        precision: "second",
        basis: "source-event",
      },
    });
    expect(nativeEventHistoryAvailabilityFor(closedObject)).toBe("available");
  }
});

test("carries provider unsupported availability through validated Snapshot and Portal rendering", () => {
  const snapshot = fixture();
  const portal = snapshot.providerObservations.find(
    (observation) =>
      observation.binding.nativeScope === ".scratch/portal" &&
      (observation.state === "available" || observation.state === "partial"),
  );
  if (
    portal === undefined ||
    (portal.state !== "available" && portal.state !== "partial") ||
    portal.projection.map === undefined
  ) {
    throw new Error("Expected the Portal Map observation.");
  }
  const unsupported = createProviderScopeObservation({
    provider: portal.provider,
    binding: portal.binding,
    observedAt: portal.observedAt,
    ...(portal.sourceRevision === undefined ? {} : { sourceRevision: portal.sourceRevision }),
    ...(portal.sourceObservedAt === undefined ? {} : { sourceObservedAt: portal.sourceObservedAt }),
    validators: portal.validators,
    state: portal.state,
    freshness: portal.freshness,
    coverage: {
      ...portal.coverage,
      dimensions: portal.coverage.dimensions.map((dimension) => ({
        key: dimension.key,
        state: dimension.state,
        ...(dimension.detail === undefined ? {} : { detail: dimension.detail }),
      })),
    },
    completion: portal.completion,
    diagnostics: portal.diagnostics,
    projection: {
      ...portal.projection,
      map: {
        ...portal.projection.map,
        destination: portal.projection.map.destination.map((section) =>
          section.semanticRole === "map.destination"
            ? { ...section, availability: "unsupported" as const, markdown: "" }
            : section,
        ),
        fog: [],
        semanticSections: portal.projection.map.semanticSections.map((section) =>
          section.role === "map.fog" || section.role === "map.destination"
            ? { ...section, availability: "unsupported" as const }
            : section,
        ),
      },
    },
  });
  const providerObservations = snapshot.providerObservations.map((observation) =>
    observation.id === portal.id ? unsupported : observation,
  );
  const providerObservationSelections = snapshot.providerObservationSelections.map((selection) =>
    selection.nativeScope === ".scratch/portal"
      ? { ...selection, observationId: unsupported.id }
      : selection,
  );
  const candidate = {
    ...snapshot,
    providerObservations,
    providerObservationSelections,
  };
  const projected = projectGenerationSchema.parse({
    ...candidate,
    lineage: buildPlanningLineageProjection(candidate),
  });
  const model = readable(
    buildPlanningLineageSubjectModel(
      projected,
      { kind: "native-subject", id: ".scratch/portal/map.md" },
      "bearing",
    ),
  );

  expect(model.state).toBe("partial");
  expect(model.semanticAvailability.get("map.fog")).toBe("unsupported");
  expect(
    providerSectionFor(model.sections.find((section) => section.anchor === "map.destination")),
  ).toMatchObject({ availability: "unsupported", sourceIdentity: "map.destination" });
  expect(proseFor(model.sections.find((section) => section.anchor === "map.fog"))).toBe(
    "The current source does not support the requested semantic section.",
  );
});

test("rejects missing or forged provider-native Source provenance", () => {
  const snapshot = fixture();
  const mapSource = snapshot.sources.find(
    (source) =>
      source.binding?.role === "map" && source.binding.identity === ".scratch/portal/map.md",
  );
  const scopeSource = snapshot.sources.find(
    (source) =>
      source.binding?.role === "native-scope" && source.binding.identity === ".scratch/portal",
  );
  if (mapSource?.binding === undefined || scopeSource === undefined) {
    throw new Error("Expected provider-native Source fixtures.");
  }
  const forged = createSourceRecord(snapshot.basis.basisFingerprint, {
    kind: "tracker",
    locator: ".scratch/forged/map.md",
    binding: mapSource.binding,
  });
  const forgedCandidate = {
    ...snapshot,
    sources: snapshot.sources.map((source) =>
      source.reference === mapSource.reference ? forged : source,
    ),
  };
  expect(
    projectGenerationSchema.safeParse({
      ...forgedCandidate,
      lineage: buildPlanningLineageProjection(forgedCandidate),
    }).success,
  ).toBe(false);

  const missingCandidate = {
    ...snapshot,
    sources: snapshot.sources.filter((source) => source.reference !== scopeSource.reference),
  };
  expect(
    projectGenerationSchema.safeParse({
      ...missingCandidate,
      lineage: buildPlanningLineageProjection(missingCandidate),
    }).success,
  ).toBe(false);
});

test("retains unresolved native graph references as unavailable relation targets", () => {
  const snapshot = fixture();
  const providerObservations = snapshot.providerObservations.map((observation) => {
    if (
      observation.binding.nativeScope !== ".scratch/portal" ||
      (observation.state !== "available" && observation.state !== "partial")
    ) {
      return observation;
    }
    return createProviderScopeObservation({
      provider: observation.provider,
      binding: observation.binding,
      observedAt: observation.observedAt,
      ...(observation.sourceRevision === undefined
        ? {}
        : { sourceRevision: observation.sourceRevision }),
      ...(observation.sourceObservedAt === undefined
        ? {}
        : { sourceObservedAt: observation.sourceObservedAt }),
      validators: observation.validators,
      state: observation.state,
      freshness: observation.freshness,
      coverage: {
        ...observation.coverage,
        dimensions: observation.coverage.dimensions.map((dimension) => ({
          key: dimension.key,
          state: dimension.state,
          ...(dimension.detail === undefined ? {} : { detail: dimension.detail }),
        })),
      },
      completion: observation.completion,
      diagnostics: observation.diagnostics,
      projection: {
        ...observation.projection,
        graph: {
          ...observation.projection.graph,
          blockedBy: [
            ...observation.projection.graph.blockedBy,
            {
              blocked: ".scratch/portal/issues/03-gate.md",
              blocker: ".scratch/portal/issues/unavailable.md",
              evidence: "matt-contract" as const,
            },
          ],
        },
      },
    });
  });
  const providerObservationSelections = snapshot.providerObservationSelections.map((selection) =>
    selection.nativeScope === ".scratch/portal"
      ? { ...selection, effectiveFreshness: "undetermined" as const }
      : selection,
  );
  const lineage = buildPlanningLineageProjection({
    ...snapshot,
    providerObservations,
    providerObservationSelections,
  });
  const delivery = findPlanningLineageSubjectProjection(lineage, {
    kind: "native-subject",
    id: ".scratch/portal/issues/03-gate.md",
  });
  const blockedBy = delivery?.relations.find(
    (relation) => relation.key === "native-work.blocked-by",
  );
  expect(blockedBy).toMatchObject({
    state: "present",
    total: { count: 2, coverage: "at-least" },
  });
  if (blockedBy?.state !== "present") throw new Error("Expected native blocked-by relation.");
  expect(blockedBy.targets).toContainEqual({
    reference: ".scratch/portal/issues/unavailable.md",
    label: ".scratch/portal/issues/unavailable.md",
    availability: "unavailable",
    note: "Referenced native subject is outside the selected observation or unavailable.",
  });
});
