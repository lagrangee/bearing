import type { PlanningLineageRelationKey, PlanningLineageSubject } from "../planning-lineage-route";
import { planningLineageSubjectForReference } from "../planning-lineage-route";
import { assessSelectedProviderObservationEvidence } from "../provider-observation-contract";
import type {
  PlanningLineageProjection,
  PlanningLineageRelation,
  PlanningLineageSubjectProjection,
  ProjectSnapshotInput,
} from "./contract";
import { planningLineageProjectionSchema } from "./schema-planning-lineage";

export type PlanningLineageBuildInput = Pick<
  ProjectSnapshotInput,
  | "roadmaps"
  | "gates"
  | "efforts"
  | "authorities"
  | "assets"
  | "checks"
  | "reviews"
  | "providerObservations"
  | "providerObservationSelections"
>;
type Input = PlanningLineageBuildInput;

type CollectionItem<Projection> =
  Projection extends Readonly<{
    items: readonly (infer Item)[];
  }>
    ? Item
    : never;
type RoadmapRecord = CollectionItem<Input["roadmaps"]>;
type GateRecord = CollectionItem<Input["gates"]>;
type EffortRecord = CollectionItem<Input["efforts"]>;
type AuthorityRecord = CollectionItem<Input["authorities"]>;
type AssetRecord = CollectionItem<Input["assets"]>;
type AlignmentCheckRecord = CollectionItem<Input["checks"]>;
type PlanningReviewRecord = CollectionItem<Input["reviews"]>;
type SubjectRecord =
  | RoadmapRecord
  | GateRecord
  | EffortRecord
  | AuthorityRecord
  | AssetRecord
  | AlignmentCheckRecord
  | PlanningReviewRecord;
type Collection<T> =
  | Readonly<{ validity: "available" | "partial"; items: readonly T[] }>
  | Readonly<{ validity: "invalid" }>;
type ReadableCollection<T> = Extract<Collection<T>, { validity: "available" | "partial" }>;

type RelationTarget = Extract<PlanningLineageRelation, { state: "present" }>["targets"][number];

const compareStableIdentity = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const trusted = <T>(collection: Collection<T>): readonly T[] =>
  collection.validity === "invalid" ? [] : collection.items;

const collectionFor = (
  input: Input,
  kind: PlanningLineageSubject["kind"],
): Collection<SubjectRecord> => {
  switch (kind) {
    case "roadmap":
      return input.roadmaps;
    case "gate":
      return input.gates;
    case "effort":
      return input.efforts;
    case "authority":
      return input.authorities;
    case "alignment-check":
      return input.checks;
    case "planning-review":
      return input.reviews;
    case "asset":
      return input.assets;
  }
};

const recordFor = (input: Input, subject: PlanningLineageSubject): SubjectRecord | undefined => {
  const collection = collectionFor(input, subject.kind);
  return collection.validity === "invalid"
    ? undefined
    : collection.items.find((candidate) => String(candidate.id) === subject.id);
};

const targetForReference = (input: Input, reference: string, note?: string): RelationTarget => {
  const subject = planningLineageSubjectForReference(reference);
  const record = subject === undefined ? undefined : recordFor(input, subject);
  const available = subject !== undefined && record !== undefined;
  const unavailableNote =
    subject === undefined
      ? "Stable detail route unavailable for this planning reference in the current Snapshot."
      : "Referenced subject unavailable in the current Snapshot.";
  return {
    reference,
    label: record?.title ?? reference,
    availability: available ? "available" : "unavailable",
    ...(subject === undefined ? {} : { subject }),
    ...(available
      ? note === undefined
        ? {}
        : { note }
      : { note: note === undefined ? unavailableNote : `${note} ${unavailableNote}` }),
  };
};

const relationBase = (
  key: PlanningLineageRelationKey,
  label: string,
  direction: string,
  cardinality: "one" | "many",
) => ({ key, label, direction, cardinality, inParentPath: false });

const confirmedNone = (
  key: PlanningLineageRelationKey,
  label: string,
  direction: string,
  cardinality: "one" | "many",
): PlanningLineageRelation => ({
  ...relationBase(key, label, direction, cardinality),
  state: "confirmed-none",
  reason: "The current typed subject confirms no relation.",
});

const unknownRelation = (
  key: PlanningLineageRelationKey,
  label: string,
  direction: string,
  cardinality: "one" | "many",
  reason: string,
): PlanningLineageRelation => ({
  ...relationBase(key, label, direction, cardinality),
  state: "unknown",
  reason,
});

const unavailableRelation = (
  key: PlanningLineageRelationKey,
  label: string,
  direction: string,
  cardinality: "one" | "many",
  reason: string,
): PlanningLineageRelation => ({
  ...relationBase(key, label, direction, cardinality),
  state: "unavailable",
  reason,
});

const presentRelation = (
  key: PlanningLineageRelationKey,
  label: string,
  direction: string,
  cardinality: "one" | "many",
  targets: readonly RelationTarget[],
  coverage: "complete" | "at-least" = "complete",
): PlanningLineageRelation => ({
  ...relationBase(key, label, direction, cardinality),
  state: "present",
  targets,
  total: { count: targets.length, coverage },
});

const directRelation = (
  input: Input,
  key: PlanningLineageRelationKey,
  label: string,
  direction: string,
  cardinality: "one" | "many",
  references: readonly string[],
): PlanningLineageRelation =>
  references.length === 0
    ? confirmedNone(key, label, direction, cardinality)
    : presentRelation(
        key,
        label,
        direction,
        cardinality,
        references.map((reference) => targetForReference(input, reference)),
      );

type ReverseRelationSource = Readonly<{
  validity: "available" | "partial" | "invalid";
}>;

const reverseReferenceRelation = (
  input: Input,
  key: PlanningLineageRelationKey,
  label: string,
  direction: string,
  references: readonly string[],
  sources: readonly ReverseRelationSource[],
  notes?: ReadonlyMap<string, string>,
): PlanningLineageRelation => {
  const incomplete = sources.some((source) => source.validity !== "available");
  if (references.length > 0) {
    return presentRelation(
      key,
      label,
      direction,
      "many",
      references.map((reference) => targetForReference(input, reference, notes?.get(reference))),
      incomplete ? "at-least" : "complete",
    );
  }
  if (sources.some((source) => source.validity === "invalid")) {
    return unavailableRelation(
      key,
      label,
      direction,
      "many",
      "One or more source projections required for this reverse relation are unavailable.",
    );
  }
  if (incomplete) {
    return unknownRelation(
      key,
      label,
      direction,
      "many",
      "Partial source coverage cannot confirm an empty reverse relation.",
    );
  }
  return confirmedNone(key, label, direction, "many");
};

const citationRelation = (
  input: Input,
  citations: readonly Readonly<{ assetId: string; note: string }>[],
): PlanningLineageRelation =>
  citations.length === 0
    ? confirmedNone("planning-use.citations", "Planning Citations", "cites", "many")
    : presentRelation(
        "planning-use.citations",
        "Planning Citations",
        "cites",
        "many",
        citations.map((citation) => targetForReference(input, citation.assetId, citation.note)),
      );

const reverseAssetRelation = (
  input: Input,
  key: "production.owned-assets",
  label: string,
  direction: string,
  predicate: (asset: AssetRecord) => boolean,
): PlanningLineageRelation => {
  if (input.assets.validity === "invalid") {
    return unavailableRelation(
      key,
      label,
      direction,
      "many",
      "The Asset projection is unavailable.",
    );
  }
  const assets = input.assets.items.filter(predicate);
  if (assets.length === 0 && input.assets.validity === "partial") {
    return unknownRelation(
      key,
      label,
      direction,
      "many",
      "Partial Asset coverage cannot confirm an empty reverse relation.",
    );
  }
  if (assets.length === 0) return confirmedNone(key, label, direction, "many");
  return presentRelation(
    key,
    label,
    direction,
    "many",
    assets.map((asset) => targetForReference(input, asset.id)),
    input.assets.validity === "partial" ? "at-least" : "complete",
  );
};

const parentPathFor = (
  input: Input,
  subject: PlanningLineageSubject,
  record: SubjectRecord,
): PlanningLineageSubjectProjection["parentPath"] => {
  if (
    subject.kind === "roadmap" ||
    subject.kind === "authority" ||
    subject.kind === "alignment-check" ||
    subject.kind === "planning-review" ||
    subject.kind === "asset"
  ) {
    return { state: "complete", ancestors: [] };
  }
  if (subject.kind === "gate") {
    if (input.roadmaps.validity === "invalid") {
      return {
        state: "truncated-unavailable",
        ancestors: [],
        reason: "Roadmap parentage is unavailable in the current generation.",
      };
    }
    if (input.roadmaps.validity === "partial") {
      return {
        state: "truncated-unknown",
        ancestors: [],
        reason: "Partial Roadmap coverage cannot prove unique parentage.",
      };
    }
    const candidates = input.roadmaps.items.filter((roadmap) =>
      roadmap.gateOrder.some((gateId) => String(gateId) === subject.id),
    );
    if (
      candidates.length !== 1 ||
      String(candidates[0]?.id) !== String((record as GateRecord).roadmapId)
    ) {
      return {
        state: "truncated-unavailable",
        ancestors: [],
        reason:
          candidates.length > 1
            ? "Canonical parentage is ambiguous."
            : "Canonical Roadmap parentage is unavailable.",
      };
    }
    const roadmap = candidates[0];
    if (roadmap === undefined) {
      throw new Error("A unique Canonical Roadmap parent was not retained.");
    }
    return {
      state: "complete",
      ancestors: [{ kind: "roadmap", id: roadmap.id }],
    };
  }

  const effort = record as EffortRecord;
  if (input.roadmaps.validity === "invalid") {
    return {
      state: "truncated-unavailable",
      ancestors: [],
      reason: "Roadmap parentage is unavailable in the current generation.",
    };
  }
  if (input.roadmaps.validity === "partial") {
    return {
      state: "truncated-unknown",
      ancestors: [],
      reason: "Partial Roadmap coverage cannot prove unique parentage.",
    };
  }
  const roadmapCandidates = input.roadmaps.items.filter(
    (roadmap) =>
      String(roadmap.id) === String(effort.roadmapId) &&
      roadmap.effortIds.some((effortId) => String(effortId) === subject.id),
  );
  if (roadmapCandidates.length !== 1) {
    return {
      state: "truncated-unavailable",
      ancestors: [],
      reason:
        roadmapCandidates.length > 1
          ? "Canonical Roadmap parentage is ambiguous."
          : "Canonical Roadmap parentage is unavailable.",
    };
  }
  const roadmap = roadmapCandidates[0];
  if (roadmap === undefined) {
    throw new Error("A unique Canonical Roadmap parent was not retained.");
  }
  const roadmapAncestor = { kind: "roadmap" as const, id: roadmap.id };
  if (input.gates.validity === "invalid") {
    return {
      state: "truncated-unavailable",
      ancestors: [roadmapAncestor],
      reason: "Target Gate parentage is unavailable in the current generation.",
    };
  }
  if (input.gates.validity === "partial") {
    return {
      state: "truncated-unknown",
      ancestors: [roadmapAncestor],
      reason: "Partial Gate coverage cannot prove unique parentage.",
    };
  }
  const gateCandidates = input.gates.items.filter(
    (gate) =>
      String(gate.id) === String(effort.targetGateId) &&
      String(gate.roadmapId) === String(roadmap.id) &&
      gate.effortIds.some((effortId) => String(effortId) === subject.id),
  );
  if (gateCandidates.length !== 1) {
    return {
      state: "truncated-unavailable",
      ancestors: [roadmapAncestor],
      reason:
        gateCandidates.length > 1
          ? "Canonical Target Gate parentage is ambiguous."
          : "Canonical Target Gate parentage is unavailable.",
    };
  }
  const gate = gateCandidates[0];
  if (gate === undefined) {
    throw new Error("A unique Canonical Gate parent was not retained.");
  }
  return {
    state: "complete",
    ancestors: [roadmapAncestor, { kind: "gate", id: gate.id }],
  };
};

const section = (
  role: string,
  availability: "available" | "confirmed-empty" | "unavailable" = "available",
) => ({ role, availability });

const semanticSectionsFor = (
  subject: PlanningLineageSubject,
  record: SubjectRecord,
): PlanningLineageSubjectProjection["semanticSections"] => {
  switch (subject.kind) {
    case "roadmap": {
      const roadmap = record as RoadmapRecord;
      return [
        section("roadmap.event-history"),
        section("roadmap.intent"),
        section("roadmap.gates", roadmap.gateOrder.length === 0 ? "confirmed-empty" : "available"),
        section("roadmap.focus", roadmap.focusedGateId === null ? "confirmed-empty" : "available"),
      ];
    }
    case "gate": {
      const gate = record as GateRecord;
      return [
        section("gate.event-history"),
        section("gate.intent"),
        section("gate.exit-criteria"),
        section("gate.readiness"),
        section("gate.passage", gate.passage === undefined ? "confirmed-empty" : "available"),
      ];
    }
    case "effort":
      return [
        section("effort.event-history"),
        section("effort.intent"),
        section("effort.lifecycle"),
        section("effort.native-work"),
      ];
    case "authority": {
      const authority = record as AuthorityRecord;
      return [
        section("authority.scope"),
        section(
          "authority.baseline",
          authority.baselineAssetIds.length === 0 ? "confirmed-empty" : "available",
        ),
        section(
          "authority.adoption-decisions",
          authority.adoptions.length === 0 ? "confirmed-empty" : "available",
        ),
        section(
          "authority.event-history",
          authority.adoptions.length === 0 ? "confirmed-empty" : "available",
        ),
        section("authority.superseded-context", "unavailable"),
      ];
    }
    case "alignment-check": {
      const check = record as AlignmentCheckRecord;
      return [
        section("alignment-check.target"),
        section("alignment-check.lifecycle"),
        section("alignment-check.resolution"),
        section(
          "alignment-check.rationale",
          check.resolution === undefined ? "confirmed-empty" : "available",
        ),
        section(
          "alignment-check.event-time",
          check.resolution === undefined ? "confirmed-empty" : "available",
        ),
        section(
          "alignment-check.changed-references",
          (check.resolution?.changedReferences.length ?? 0) === 0 ? "confirmed-empty" : "available",
        ),
        section(
          "alignment-check.evidence",
          check.citations.length === 0 ? "confirmed-empty" : "available",
        ),
      ];
    }
    case "planning-review": {
      const review = record as PlanningReviewRecord;
      return [
        section("planning-review.scope"),
        section("planning-review.lifecycle"),
        section("planning-review.resolution"),
        section(
          "planning-review.rationale",
          review.resolution === undefined ? "confirmed-empty" : "available",
        ),
        section(
          "planning-review.event-time",
          review.resolution === undefined ? "confirmed-empty" : "available",
        ),
        section(
          "planning-review.changed-references",
          (review.resolution?.changedReferences.length ?? 0) === 0
            ? "confirmed-empty"
            : "available",
        ),
        section(
          "planning-review.evidence",
          review.citations.length === 0 ? "confirmed-empty" : "available",
        ),
      ];
    }
    case "asset":
      return [
        section("asset.event-history"),
        section("asset.identity"),
        section("asset.lifecycle"),
        section("asset.provenance"),
        section("asset.evidence-roles"),
        section("asset.preview", "unavailable"),
      ];
  }
};

const relationsForRoadmap = (input: Input, roadmap: RoadmapRecord): PlanningLineageRelation[] => [
  directRelation(
    input,
    "outcome.ordered-gates",
    "Ordered Gates",
    "orders",
    "many",
    roadmap.gateOrder,
  ),
  directRelation(
    input,
    "outcome.contributing-efforts",
    "Contributing Efforts",
    "receives contribution from",
    "many",
    roadmap.effortIds,
  ),
  citationRelation(input, roadmap.citations),
];

const relationsForGate = (input: Input, gate: GateRecord): PlanningLineageRelation[] => [
  directRelation(input, "outcome.roadmap", "Roadmap", "belongs to", "one", [gate.roadmapId]),
  directRelation(
    input,
    "outcome.contributing-efforts",
    "Contributing Efforts",
    "receives contribution from",
    "many",
    gate.effortIds,
  ),
  citationRelation(input, gate.citations),
  directRelation(
    input,
    "passage.evidence",
    "Passage Evidence",
    "accepted with evidence",
    "many",
    gate.passage?.evidenceAssetIds ?? [],
  ),
];

const workBindingRelation = (input: Input, effort: EffortRecord): PlanningLineageRelation => {
  const binding = effort.workBinding;
  if (binding === undefined) {
    return confirmedNone("native-work.binding", "Work Binding", "binds to native scope", "one");
  }
  const observation = input.providerObservations.find(
    (candidate) =>
      candidate.provider === binding.provider &&
      candidate.binding.nativeScope === binding.nativeScope,
  );
  const selection = input.providerObservationSelections.find(
    (candidate) =>
      candidate.provider === binding.provider && candidate.nativeScope === binding.nativeScope,
  );
  const assessment = assessSelectedProviderObservationEvidence(observation, selection);
  const available =
    assessment.projectionState === "available" || assessment.projectionState === "partial";
  return presentRelation("native-work.binding", "Work Binding", "binds to native scope", "one", [
    {
      reference: `${binding.provider}:${binding.nativeScope}`,
      label: binding.nativeScope,
      availability: available ? "available" : "unavailable",
      note: `${binding.provider}. Projection ${assessment.projectionState}; freshness ${assessment.freshness}; coverage ${assessment.coverage}; completion ${assessment.completion}; frontier evidence ${assessment.frontierEvidence}.`,
    },
  ]);
};

const relationsForEffort = (input: Input, effort: EffortRecord): PlanningLineageRelation[] => [
  directRelation(input, "outcome.roadmap", "Roadmap", "belongs to", "one", [effort.roadmapId]),
  directRelation(input, "outcome.target-gate", "Target Gate", "targets", "one", [
    effort.targetGateId,
  ]),
  workBindingRelation(input, effort),
  directRelation(
    input,
    "governance.authorities",
    "Authorities",
    "governed by",
    "many",
    effort.authorityIds,
  ),
  citationRelation(input, effort.citations),
  reverseAssetRelation(
    input,
    "production.owned-assets",
    "Owned Assets",
    "owns",
    (asset) => asset.owner === effort.id,
  ),
];

const relationsForAuthority = (
  input: Input,
  authority: AuthorityRecord,
): PlanningLineageRelation[] => [
  directRelation(
    input,
    "adoption.current-baseline",
    "Current Baseline",
    "includes",
    "many",
    authority.baselineAssetIds,
  ),
  authority.adoptions.length === 0
    ? confirmedNone("adoption.used-by", "Authority Adoption", "adopts", "many")
    : presentRelation(
        "adoption.used-by",
        "Authority Adoption",
        "adopts",
        "many",
        authority.adoptions.map((adoption) =>
          targetForReference(
            input,
            adoption.assetId,
            `Accepted Decision: ${adoption.decisionReference}`,
          ),
        ),
      ),
  citationRelation(input, authority.citations),
];

const relationsForCheck = (
  input: Input,
  check: AlignmentCheckRecord,
): PlanningLineageRelation[] => [
  directRelation(input, "governance.target", "Target", "checks alignment of", "one", [
    check.target,
  ]),
  directRelation(
    input,
    "governance.changed-references",
    "Changed References",
    "accepted changes to",
    "many",
    check.resolution?.changedReferences ?? [],
  ),
  citationRelation(input, check.citations),
];

const relationsForReview = (
  input: Input,
  review: PlanningReviewRecord,
): PlanningLineageRelation[] => [
  directRelation(
    input,
    "governance.changed-references",
    "Changed References",
    "accepted changes to",
    "many",
    review.resolution?.changedReferences ?? [],
  ),
  citationRelation(input, review.citations),
];

const relationsForAsset = (input: Input, asset: AssetRecord): PlanningLineageRelation[] => [
  directRelation(input, "production.owner", "Owner", "is owned by", "one", [asset.owner]),
  presentRelation("production.producer", "Producer", "was produced by", "one", [
    {
      reference: `producer:${asset.producer.kind}:${asset.producer.name}`,
      label: `${asset.producer.kind} / ${asset.producer.name}`,
      availability: "available",
      ...(asset.producer.reference === undefined
        ? {}
        : { note: `Producer reference: ${asset.producer.reference}` }),
    },
  ]),
  asset.producedFor === undefined
    ? confirmedNone("production.produced-for", "Produced For", "was produced for", "one")
    : presentRelation("production.produced-for", "Produced For", "was produced for", "one", [
        {
          reference: asset.producedFor,
          label: asset.producedFor,
          availability: "unavailable",
          note: "Provider-native route unavailable in the current Snapshot.",
        },
      ]),
  reverseReferenceRelation(
    input,
    "planning-use.cited-by",
    "Planning Citations",
    "is cited by",
    asset.citations.map((citation) => citation.citingReference),
    [input.roadmaps, input.gates, input.efforts, input.authorities, input.checks, input.reviews],
    new Map(asset.citations.map((citation) => [citation.citingReference, citation.note])),
  ),
  reverseReferenceRelation(
    input,
    "adoption.used-by",
    "Authority Adoption",
    "is adopted by",
    asset.adoptedByAuthorityIds,
    [input.authorities],
  ),
  reverseReferenceRelation(
    input,
    "passage.used-by",
    "Gate Passage Evidence",
    "is used by",
    asset.gatePassageEvidenceFor,
    [input.gates],
  ),
  directRelation(
    input,
    "asset.replacement",
    "Replacement Asset",
    "is superseded by",
    "one",
    asset.supersededBy === undefined ? [] : [asset.supersededBy],
  ),
];

const relationsFor = (
  input: Input,
  subject: PlanningLineageSubject,
  record: SubjectRecord,
): readonly PlanningLineageRelation[] => {
  switch (subject.kind) {
    case "roadmap":
      return relationsForRoadmap(input, record as RoadmapRecord);
    case "gate":
      return relationsForGate(input, record as GateRecord);
    case "effort":
      return relationsForEffort(input, record as EffortRecord);
    case "authority":
      return relationsForAuthority(input, record as AuthorityRecord);
    case "alignment-check":
      return relationsForCheck(input, record as AlignmentCheckRecord);
    case "planning-review":
      return relationsForReview(input, record as PlanningReviewRecord);
    case "asset":
      return relationsForAsset(input, record as AssetRecord);
  }
};

const subjectProjection = (
  input: Input,
  identity: PlanningLineageSubject,
  record: SubjectRecord,
) => {
  const parentPath = parentPathFor(input, identity, record);
  const ancestors = new Set(
    parentPath.ancestors.map((ancestor) => `${ancestor.kind}:${ancestor.id}`),
  );
  const relations = relationsFor(input, identity, record).map((relation) => ({
    ...relation,
    inParentPath:
      relation.state === "present" &&
      relation.targets.every(
        (target) =>
          target.subject !== undefined &&
          ancestors.has(`${target.subject.kind}:${target.subject.id}`),
      ),
  }));
  return {
    identity,
    source: record.source,
    parentPath,
    semanticSections: semanticSectionsFor(identity, record),
    relations,
  };
};

const projectSubjects = (input: Input) => {
  const groups = [
    ["roadmap", input.roadmaps],
    ["gate", input.gates],
    ["effort", input.efforts],
    ["authority", input.authorities],
    ["alignment-check", input.checks],
    ["planning-review", input.reviews],
    ["asset", input.assets],
  ] as const;
  return groups
    .flatMap(([kind, collection]) =>
      trusted(collection as Collection<SubjectRecord>).map((record) =>
        subjectProjection(input, { kind, id: String(record.id) } as PlanningLineageSubject, record),
      ),
    )
    .toSorted((left, right) => {
      const byKind = compareStableIdentity(left.identity.kind, right.identity.kind);
      return byKind === 0 ? compareStableIdentity(left.identity.id, right.identity.id) : byKind;
    });
};

export const buildPlanningLineageProjection = (input: Input): PlanningLineageProjection =>
  planningLineageProjectionSchema.parse({ subjects: projectSubjects(input) });

export const findPlanningLineageSubjectProjection = (
  projection: PlanningLineageProjection,
  identity: PlanningLineageSubject,
): PlanningLineageSubjectProjection | undefined =>
  projection.subjects.find(
    (candidate) =>
      candidate.identity.kind === identity.kind && candidate.identity.id === identity.id,
  );

export const planningLineageSubjectCollectionValidity = (
  input: Input,
  kind: PlanningLineageSubject["kind"],
): "available" | "partial" | "invalid" => collectionFor(input, kind).validity;

export const readablePlanningLineageCollection = <T>(
  collection: Collection<T>,
): ReadableCollection<T> | undefined =>
  collection.validity === "invalid" ? undefined : collection;
