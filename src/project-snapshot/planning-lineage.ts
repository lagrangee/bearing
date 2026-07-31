import type { PlanningLineageRelationKey, PlanningLineageSubject } from "../planning-lineage-route";
import { planningLineageSubjectForReference } from "../planning-lineage-route";
import { assessSelectedProviderObservationEvidence } from "../provider-observation-contract";
import {
  hasCompleteMattNativeEvidence,
  type MattNativeRecord,
  mattNativeRecords,
} from "../providers/matt-skills-v1/native-read-model";
import {
  type MattNativeSubject,
  mattNativeScopeSubject,
  mattNativeSubjectForObject,
  sameMattNativeBindingDefinition,
  sameMattNativeLocator,
  sameMattNativeScope,
} from "../providers/matt-skills-v1/native-subject";
import type { MattProjectedObject } from "../providers/matt-skills-v1/projection";
import { mattObjects } from "../providers/matt-skills-v1/projection";
import {
  buildMattNativeWorkReadingState,
  type MattNativeWorkReadingState,
  mattNativeWorkReadingContextForEffort,
  mattNativeWorkReadingContextForScope,
} from "../providers/matt-skills-v1/reading-state";
import { mattSkillsV1ProviderObservationSchema } from "../providers/matt-skills-v1/schema";
import type {
  PlanningLineageProjection,
  PlanningLineageRelation,
  PlanningLineageSubjectProjection,
  ProjectSnapshot,
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
  | "sources"
>;
type Input = Omit<PlanningLineageBuildInput, "providerObservations"> &
  Readonly<{
    providerObservations: ProjectSnapshot["providerObservations"];
  }>;

const normalizedInput = (input: PlanningLineageBuildInput): Input => ({
  ...input,
  providerObservations: input.providerObservations.map((observation) =>
    mattSkillsV1ProviderObservationSchema.parse(observation),
  ),
});

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
type NativeObservation = Input["providerObservations"][number];
type NativeRecord = MattNativeRecord;
type SubjectRecord =
  | RoadmapRecord
  | GateRecord
  | EffortRecord
  | AuthorityRecord
  | AssetRecord
  | AlignmentCheckRecord
  | PlanningReviewRecord
  | NativeRecord;
type Collection<T> =
  | Readonly<{ validity: "available" | "partial"; items: readonly T[] }>
  | Readonly<{ validity: "invalid" }>;
type ReadableCollection<T> = Extract<Collection<T>, { validity: "available" | "partial" }>;

type RelationTarget = Extract<PlanningLineageRelation, { state: "present" }>["targets"][number];

const compareStableIdentity = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const trusted = <T>(collection: Collection<T>): readonly T[] =>
  collection.validity === "invalid" ? [] : collection.items;

const isNativeSubjectKind = (
  kind: PlanningLineageSubject["kind"],
): kind is MattNativeSubject["kind"] => kind.startsWith("native-");

const hasCompleteNativeEvidence = (input: Input, observation: NativeObservation): boolean =>
  hasCompleteMattNativeEvidence(observation, input.providerObservationSelections);

const providerSubjectRecords = (input: Input): readonly NativeRecord[] =>
  mattNativeRecords(input.providerObservations, input.sources);

const nativeCollectionFor = (
  input: Input,
  kind: MattNativeSubject["kind"],
): Collection<NativeRecord> => {
  const records = providerSubjectRecords(input).filter((record) =>
    kind === "native-scope"
      ? record.recordKind === "native-scope"
      : record.recordKind === "native-object" &&
        mattNativeSubjectForObject(record.object).kind === kind,
  );
  const incomplete = input.providerObservations.some(
    (observation) => !hasCompleteNativeEvidence(input, observation),
  );
  return incomplete
    ? { validity: "partial", items: records }
    : { validity: "available", items: records };
};

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
    case "native-scope":
    case "native-subject":
      return nativeCollectionFor(input, kind);
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
  if (isNativeSubjectKind(subject.kind)) {
    const nativeRecord = record as NativeRecord;
    const observation = nativeRecord.observation;
    const effortCandidates =
      input.efforts.validity === "invalid"
        ? []
        : input.efforts.items.filter(
            (effort) =>
              effort.workBinding !== undefined &&
              sameMattNativeScope(effort.workBinding, observation.binding),
          );
    if (input.efforts.validity === "invalid") {
      return {
        state: "truncated-unavailable",
        ancestors: [],
        reason: "Bound Effort parentage is unavailable in the current generation.",
      };
    }
    if (input.efforts.validity === "partial" && effortCandidates.length === 0) {
      return {
        state: "truncated-unknown",
        ancestors: [],
        reason: "Partial Effort coverage cannot prove native Work Binding parentage.",
      };
    }
    if (effortCandidates.length !== 1) {
      return {
        state: "truncated-unavailable",
        ancestors: [],
        reason:
          effortCandidates.length > 1
            ? "Native scope has conflicting canonical Work Bindings."
            : "Native scope has no trustworthy canonical Work Binding.",
      };
    }
    const effort = effortCandidates[0];
    if (effort === undefined) throw new Error("Unique native Work Binding was not retained.");
    const effortSubject = { kind: "effort" as const, id: effort.id };
    const effortPath = parentPathFor(input, effortSubject, effort);
    const canonicalAncestors = [...effortPath.ancestors, effortSubject];
    if (nativeRecord.recordKind === "native-scope") {
      return {
        state: effortPath.state,
        ancestors: canonicalAncestors,
        ...(effortPath.reason === undefined ? {} : { reason: effortPath.reason }),
      };
    }

    const projection =
      observation.state === "available" || observation.state === "partial"
        ? observation.projection
        : undefined;
    if (projection === undefined || !hasCompleteNativeEvidence(input, observation)) {
      return {
        state: "truncated-unavailable",
        ancestors: canonicalAncestors,
        reason: "Native hierarchy is not trustworthy in the selected provider observation.",
      };
    }
    const objectByRef = new Map(
      mattObjects(observation).map((object) => [String(object.ref), object]),
    );
    const parentByChild = new Map<string, string[]>();
    for (const relation of projection.graph.parentChild) {
      const parents = parentByChild.get(relation.child) ?? [];
      parents.push(relation.parent);
      parentByChild.set(relation.child, parents);
    }
    const chain: PlanningLineageSubject[] = [];
    const visited = new Set<string>([String(nativeRecord.object.ref)]);
    let current = String(nativeRecord.object.ref);
    while (true) {
      const parents = parentByChild.get(current) ?? [];
      if (parents.length === 0) break;
      if (parents.length !== 1) {
        return {
          state: "truncated-unavailable",
          ancestors: [...canonicalAncestors, ...chain.toReversed()],
          reason: "Native parentage is ambiguous.",
        };
      }
      const parentRef = parents[0];
      if (parentRef === undefined || visited.has(parentRef)) {
        return {
          state: "truncated-unavailable",
          ancestors: [...canonicalAncestors, ...chain.toReversed()],
          reason: "Native parentage contains a cycle.",
        };
      }
      const parent = objectByRef.get(parentRef);
      if (parent === undefined) {
        return {
          state: "truncated-unavailable",
          ancestors: [...canonicalAncestors, ...chain.toReversed()],
          reason: "Native parent subject is unavailable.",
        };
      }
      visited.add(parentRef);
      chain.push(mattNativeSubjectForObject(parent));
      current = parentRef;
    }
    return {
      state: effortPath.state,
      ancestors: [...canonicalAncestors, ...chain.toReversed()],
      ...(effortPath.reason === undefined ? {} : { reason: effortPath.reason }),
    };
  }
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
  availability: "available" | "confirmed-empty" | "unavailable" | "unsupported" = "available",
) => ({ role, availability });

export const nativeEventHistoryAvailabilityFor = (
  object: MattProjectedObject,
): "available" | "unavailable" | "unsupported" => {
  const closure =
    (object.native.kind === "github" && object.native.trackerClosure.state === "closed"
      ? object.native.trackerClosure.closedAt
      : undefined) ??
    (object.kind === "wayfinder-ticket" || object.kind === "delivery-ticket"
      ? object.trackerClosure.state === "closed"
        ? object.trackerClosure.closedAt
        : undefined
      : object.kind === "incoming-issue" && object.lifecycle.state === "closed"
        ? object.lifecycle.closedAt
        : undefined);
  const times = [object.native.createdAt, ...(closure === undefined ? [] : [closure])];
  if (times.some((time) => time.availability === "available")) return "available";
  if (times.some((time) => time.availability === "unavailable")) return "unavailable";
  return "unsupported";
};

const nativeStructuralSections = (
  object: MattProjectedObject,
  complete: boolean,
): PlanningLineageSubjectProjection["semanticSections"] => {
  const lifecycleRole = (
    {
      map: "map.lifecycle",
      spec: "spec.lifecycle",
      "wayfinder-ticket": "wayfinder.lifecycle",
      "delivery-ticket": "delivery.lifecycle",
      "incoming-issue": "incoming.lifecycle",
    } as const
  )[object.kind];
  const lifecycle = section(lifecycleRole);
  const conditional =
    object.kind === "wayfinder-ticket"
      ? object.lifecycle.state === "resolved-on-route"
        ? [section("wayfinder.decision-backlink")]
        : object.lifecycle.state === "ruled-out-of-scope"
          ? [section("wayfinder.disposition-backlink")]
          : []
      : [];
  return [
    lifecycle,
    ...conditional,
    section("native.event-history", nativeEventHistoryAvailabilityFor(object)),
    section("native.provenance"),
    section("native.observation-trust", complete ? "available" : "unavailable"),
  ];
};

const semanticSectionsFor = (
  input: Input,
  subject: PlanningLineageSubject,
  record: SubjectRecord,
): PlanningLineageSubjectProjection["semanticSections"] => {
  if (isNativeSubjectKind(subject.kind)) {
    const native = record as NativeRecord;
    if (native.recordKind === "native-scope") {
      const observation = native.observation;
      const complete = hasCompleteNativeEvidence(input, observation);
      return [
        section("native-scope.trust", complete ? "available" : "unavailable"),
        section(
          "native-scope.subjects",
          mattObjects(observation).length === 0
            ? complete
              ? "confirmed-empty"
              : "unavailable"
            : "available",
        ),
      ];
    }
    return [
      ...native.object.semanticSections.map((candidate) =>
        section(candidate.role, candidate.availability),
      ),
      ...nativeStructuralSections(
        native.object,
        hasCompleteNativeEvidence(input, native.observation),
      ),
    ];
  }
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
  const matchingEfforts = trusted(input.efforts).filter(
    (candidate) =>
      candidate.workBinding !== undefined && sameMattNativeScope(candidate.workBinding, binding),
  );
  const bindingConflict = matchingEfforts.length > 1;
  const observation = input.providerObservations.find((candidate) =>
    sameMattNativeScope(candidate.binding, binding),
  );
  const selection = input.providerObservationSelections.find((candidate) =>
    observation === undefined
      ? sameMattNativeScope(candidate, binding)
      : sameMattNativeBindingDefinition(candidate, observation.binding),
  );
  const assessment = assessSelectedProviderObservationEvidence(observation, selection);
  const available =
    !bindingConflict &&
    (assessment.projectionState === "available" || assessment.projectionState === "partial");
  const scopeSubject = mattNativeScopeSubject({ binding });
  return presentRelation("native-work.binding", "Work Binding", "binds to native scope", "one", [
    {
      reference: `${binding.provider}:${binding.nativeScope}`,
      label: binding.nativeScope,
      availability: available ? "available" : "unavailable",
      ...((available || bindingConflict) && scopeSubject !== undefined
        ? { subject: scopeSubject }
        : {}),
      note: bindingConflict
        ? `${binding.provider}. Binding needs attention: multiple Efforts bind the same stable provider-native identity; no binding is selected as its canonical parent.`
        : `${binding.provider}. Projection ${assessment.projectionState}; freshness ${assessment.freshness}; coverage ${assessment.coverage}; completion ${assessment.completion}; frontier evidence ${assessment.frontierEvidence}.`,
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

const nativeTarget = (input: Input, subject: MattNativeSubject, note?: string): RelationTarget => {
  const record = recordFor(input, subject) as NativeRecord | undefined;
  return {
    reference: subject.id,
    label: record?.title ?? subject.id,
    availability: record === undefined ? "unavailable" : "available",
    subject,
    ...(record === undefined
      ? { note: note ?? "Provider-native subject unavailable in the selected observation." }
      : note === undefined
        ? {}
        : { note }),
  };
};

const nativeRelation = (
  input: Input,
  key: PlanningLineageRelationKey,
  label: string,
  direction: string,
  cardinality: "one" | "many",
  subjects: readonly MattNativeSubject[],
  complete: boolean,
): PlanningLineageRelation =>
  cardinality === "one" && subjects.length > 1
    ? unavailableRelation(
        key,
        label,
        direction,
        cardinality,
        "Provider-native relation has ambiguous cardinality.",
      )
    : subjects.length === 0
      ? complete
        ? confirmedNone(key, label, direction, cardinality)
        : unknownRelation(
            key,
            label,
            direction,
            cardinality,
            "Selected provider evidence cannot confirm an empty native relation.",
          )
      : presentRelation(
          key,
          label,
          direction,
          cardinality,
          subjects.map((subject) => nativeTarget(input, subject)),
          complete ? "complete" : "at-least",
        );

const nativeReferenceRelation = (
  input: Input,
  key: PlanningLineageRelationKey,
  label: string,
  direction: string,
  cardinality: "one" | "many",
  references: readonly string[],
  objects: readonly MattProjectedObject[],
  complete: boolean,
): PlanningLineageRelation => {
  if (cardinality === "one" && references.length > 1) {
    return unavailableRelation(
      key,
      label,
      direction,
      cardinality,
      "Provider-native relation has ambiguous cardinality.",
    );
  }
  if (references.length === 0) {
    return complete
      ? confirmedNone(key, label, direction, cardinality)
      : unknownRelation(
          key,
          label,
          direction,
          cardinality,
          "Selected provider evidence cannot confirm an empty native relation.",
        );
  }
  const byReference = new Map(objects.map((object) => [String(object.ref), object]));
  return presentRelation(
    key,
    label,
    direction,
    cardinality,
    references.map((reference) => {
      const object = byReference.get(reference);
      return object === undefined
        ? {
            reference,
            label: reference,
            availability: "unavailable",
            note: "Referenced native subject is outside the selected observation or unavailable.",
          }
        : nativeTarget(input, mattNativeSubjectForObject(object));
    }),
    complete ? "complete" : "at-least",
  );
};

const relationsForNative = (
  input: Input,
  record: NativeRecord,
): readonly PlanningLineageRelation[] => {
  const observation = record.observation;
  const objects = mattObjects(observation);
  const scope = mattNativeScopeSubject(observation);
  const complete = hasCompleteNativeEvidence(input, observation);
  if (record.recordKind === "native-scope") {
    return [
      nativeRelation(
        input,
        "native-work.members",
        "Native Subjects",
        "contains",
        "many",
        objects.map(mattNativeSubjectForObject),
        complete,
      ),
    ];
  }
  const reference = String(record.object.ref);
  const projection =
    observation.state === "available" || observation.state === "partial"
      ? observation.projection
      : undefined;
  if (projection === undefined) {
    return [
      presentRelation("native-work.scope", "Native Scope", "belongs to", "one", [
        nativeTarget(input, scope),
      ]),
      unavailableRelation(
        "native-work.parent",
        "Native Parent",
        "belongs under",
        "one",
        "Native hierarchy is unavailable in the selected provider observation.",
      ),
      unavailableRelation(
        "native-work.children",
        "Native Children",
        "contains",
        "many",
        "Native hierarchy is unavailable in the selected provider observation.",
      ),
      unavailableRelation(
        "native-work.blocked-by",
        "Blocked By",
        "is blocked by",
        "many",
        "Native blocker evidence is unavailable in the selected provider observation.",
      ),
      unavailableRelation(
        "native-work.blocks",
        "Blocks",
        "blocks",
        "many",
        "Native blocker evidence is unavailable in the selected provider observation.",
      ),
    ];
  }
  return [
    presentRelation("native-work.scope", "Native Scope", "belongs to", "one", [
      nativeTarget(input, scope),
    ]),
    nativeReferenceRelation(
      input,
      "native-work.parent",
      "Native Parent",
      "belongs under",
      "one",
      projection.graph.parentChild
        .filter((relation) => relation.child === reference)
        .map((relation) => relation.parent),
      objects,
      complete,
    ),
    nativeReferenceRelation(
      input,
      "native-work.children",
      "Native Children",
      "contains",
      "many",
      projection.graph.parentChild
        .filter((relation) => relation.parent === reference)
        .map((relation) => relation.child),
      objects,
      complete,
    ),
    nativeReferenceRelation(
      input,
      "native-work.blocked-by",
      "Blocked By",
      "is blocked by",
      "many",
      projection.graph.blockedBy
        .filter((relation) => relation.blocked === reference)
        .map((relation) => relation.blocker),
      objects,
      complete,
    ),
    nativeReferenceRelation(
      input,
      "native-work.blocks",
      "Blocks",
      "blocks",
      "many",
      projection.graph.blockedBy
        .filter((relation) => relation.blocker === reference)
        .map((relation) => relation.blocked),
      objects,
      complete,
    ),
  ];
};

const relationsFor = (
  input: Input,
  subject: PlanningLineageSubject,
  record: SubjectRecord,
): readonly PlanningLineageRelation[] => {
  if (isNativeSubjectKind(subject.kind)) {
    return relationsForNative(input, record as NativeRecord);
  }
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

const nativeWorkReadingStateFor = (
  input: Input,
  subject: PlanningLineageSubject,
  record: SubjectRecord,
): MattNativeWorkReadingState | undefined => {
  const efforts = trusted(input.efforts);
  if (subject.kind === "effort") {
    const effort = record as EffortRecord;
    if (effort.workBinding === undefined) return undefined;
    const binding = effort.workBinding;
    const observation =
      input.providerObservations.find((candidate) =>
        sameMattNativeScope(candidate.binding, binding),
      ) ??
      input.providerObservations.find((candidate) =>
        sameMattNativeLocator(candidate.binding, binding),
      );
    const context = mattNativeWorkReadingContextForEffort(
      efforts,
      effort,
      observation,
      input.providerObservationSelections,
    );
    return context === undefined
      ? undefined
      : buildMattNativeWorkReadingState(observation, input.providerObservationSelections, context);
  }
  if (subject.kind !== "native-scope") return undefined;
  const observation = (record as NativeRecord).observation;
  return buildMattNativeWorkReadingState(
    observation,
    input.providerObservationSelections,
    mattNativeWorkReadingContextForScope(efforts, observation),
  );
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
  const nativeWorkReadingState = nativeWorkReadingStateFor(input, identity, record);
  return {
    identity,
    source: record.source,
    parentPath,
    semanticSections: semanticSectionsFor(input, identity, record),
    ...(nativeWorkReadingState === undefined ? {} : { nativeWorkReadingState }),
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
  const bearingSubjects = groups.flatMap(([kind, collection]) =>
    trusted(collection as Collection<SubjectRecord>).map((record) =>
      subjectProjection(input, { kind, id: String(record.id) } as PlanningLineageSubject, record),
    ),
  );
  const providerSubjects = providerSubjectRecords(input).map((record) => {
    const identity =
      record.recordKind === "native-scope"
        ? mattNativeScopeSubject(record.observation)
        : mattNativeSubjectForObject(record.object);
    return subjectProjection(input, identity, record);
  });
  return [...bearingSubjects, ...providerSubjects].toSorted((left, right) => {
    const byKind = compareStableIdentity(left.identity.kind, right.identity.kind);
    return byKind === 0 ? compareStableIdentity(left.identity.id, right.identity.id) : byKind;
  });
};

export const buildPlanningLineageProjection = (
  input: PlanningLineageBuildInput,
): PlanningLineageProjection =>
  planningLineageProjectionSchema.parse({
    subjects: projectSubjects(normalizedInput(input)),
  });

export const findPlanningLineageSubjectProjection = (
  projection: PlanningLineageProjection,
  identity: PlanningLineageSubject,
): PlanningLineageSubjectProjection | undefined =>
  projection.subjects.find(
    (candidate) =>
      candidate.identity.kind === identity.kind && candidate.identity.id === identity.id,
  );

export const planningLineageSubjectCollectionValidity = (
  input: PlanningLineageBuildInput,
  kind: PlanningLineageSubject["kind"],
): "available" | "partial" | "invalid" => collectionFor(normalizedInput(input), kind).validity;

export const readablePlanningLineageCollection = <T>(
  collection: Collection<T>,
): ReadableCollection<T> | undefined =>
  collection.validity === "invalid" ? undefined : collection;
