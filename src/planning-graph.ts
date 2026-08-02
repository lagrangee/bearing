import type { AssetContentObservation } from "./asset-inputs";
import type { DecodedBearingRecordGeneration } from "./bearing-record-decoder";
import { deepFreeze } from "./immutable";
import type { PlanningGraphInstrumentation } from "./planning-graph-instrumentation";
import { collectAssetDirectEvidence } from "./project-snapshot/asset-direct-evidence";
import { rebuildAssetReverseRelations } from "./project-snapshot/asset-reverse-relations";
import { buildAssetProjection } from "./project-snapshot/assets";
import type {
  AlignmentCheck,
  AssetProjection,
  Authority,
  CollectionProjection,
  Effort,
  MilestoneGate,
  PlanningLineageProjection,
  PlanningReview,
  ProjectionIssue,
  ProjectSnapshotInput,
  ProviderScopeObservation,
  Roadmap,
  SnapshotDiagnostic,
  SourceRecord,
} from "./project-snapshot/contract";
import { buildDecisionProjection } from "./project-snapshot/decisions";
import { buildSnapshotDiagnostics } from "./project-snapshot/diagnostic-projection";
import { buildGovernanceProjection } from "./project-snapshot/governance";
import { buildMattNativeSourceRecords } from "./project-snapshot/native-work-sources";
import { normalizePlanningDerivations } from "./project-snapshot/normalized-planning-derivation";
import { buildPlanningLineageProjection } from "./project-snapshot/planning-lineage";
import { mergeSourceRecords } from "./project-snapshot/source-records";
import {
  assessSelectedProviderObservationEvidence,
  type ProviderObservationSelection,
} from "./provider-observation-contract";
import type { MattSkillsV1ProviderObservation } from "./providers/matt-skills-v1/capture";
import {
  mattNativeScopeKey,
  sameMattNativeLocator,
  sameMattNativeScope,
} from "./providers/matt-skills-v1/native-subject";
import { mattObjects } from "./providers/matt-skills-v1/projection";
import type { MattNativeWorkReadingState } from "./providers/matt-skills-v1/reading-state";
import type { StructuralDiagnostic } from "./types";

export type PlanningGraphIssue = Readonly<{
  code: string;
  target: string;
  message: string;
  source?: string | undefined;
}>;

export type PlanningGraphValue<T> = Readonly<{ value: T; source: SourceRecord }>;

export type PlanningGraphEffortContext = Readonly<{
  effort: PlanningGraphValue<Effort>;
  source: SourceRecord;
  roadmap?: PlanningGraphValue<Roadmap>;
  targetGate?: PlanningGraphValue<MilestoneGate>;
  authorities: readonly PlanningGraphValue<Authority>[];
  providerCapture?: ProviderScopeObservation;
  nativeWorkReadingState?: MattNativeWorkReadingState;
  alignmentChecks: readonly PlanningGraphValue<AlignmentCheck>[];
  evidence: readonly PlanningGraphValue<AssetProjection>[];
}>;

export type PlanningGraphGateContext = Readonly<{
  gate: PlanningGraphValue<MilestoneGate>;
  roadmap?: PlanningGraphValue<Roadmap>;
  efforts: readonly PlanningGraphEffortContext[];
  sources: readonly SourceRecord[];
}>;

export type PlanningGraphRoadmapContext = Readonly<{
  roadmap: PlanningGraphValue<Roadmap>;
  gates: readonly PlanningGraphValue<MilestoneGate>[];
  focusedGate?: PlanningGraphValue<MilestoneGate>;
  efforts: readonly PlanningGraphEffortContext[];
  sources: readonly SourceRecord[];
}>;

export type PlanningGraphEffortRootContext = PlanningGraphEffortContext &
  Readonly<{ sources: readonly SourceRecord[] }>;

export type PlanningTarget =
  | Readonly<{ kind: "roadmap"; id: string }>
  | Readonly<{ kind: "gate"; id: string }>
  | Readonly<{ kind: "effort"; id: string }>;

export type PlanningGraphProjectOrientation = Readonly<{
  summary: ProjectSnapshotInput["summary"];
  brief: ProjectSnapshotInput["brief"];
  sources: readonly SourceRecord[];
}>;

type InvalidContextResult<Target extends PlanningTarget> = Readonly<{
  fingerprint: string;
  state: "invalid";
  target: Target;
  projectOrientation: PlanningGraphProjectOrientation;
  context?: undefined;
  issues: readonly PlanningGraphIssue[];
}>;

type PlanningContextResultFor<Target extends PlanningTarget, Context> =
  | Readonly<{
      fingerprint: string;
      state: "complete" | "partial";
      target: Target;
      projectOrientation: PlanningGraphProjectOrientation;
      context: Context;
      issues: readonly PlanningGraphIssue[];
    }>
  | InvalidContextResult<Target>;

export type RoadmapContextResult = PlanningContextResultFor<
  Extract<PlanningTarget, { kind: "roadmap" }>,
  PlanningGraphRoadmapContext
>;
export type GateContextResult = PlanningContextResultFor<
  Extract<PlanningTarget, { kind: "gate" }>,
  PlanningGraphGateContext
>;
export type EffortContextResult = PlanningContextResultFor<
  Extract<PlanningTarget, { kind: "effort" }>,
  PlanningGraphEffortRootContext
>;
export type PlanningContextResult = RoadmapContextResult | GateContextResult | EffortContextResult;

export type PlanningGraphBuildInput = Readonly<{
  decoded: DecodedBearingRecordGeneration;
  providerObservations: readonly MattSkillsV1ProviderObservation[];
  providerObservationSelections?: readonly ProviderObservationSelection[];
  nativeScopeInspectionObservations?: readonly MattSkillsV1ProviderObservation[];
  nativeScopeInspectionSelections?: readonly ProviderObservationSelection[];
  diagnostics: readonly StructuralDiagnostic[];
  fingerprint: string;
  assetContentObservations: readonly AssetContentObservation[];
  instrumentation?: PlanningGraphInstrumentation;
}>;

export type PlanningGraphProjection = Readonly<{
  roadmaps: CollectionProjection<Roadmap>;
  gates: CollectionProjection<MilestoneGate>;
  efforts: CollectionProjection<Effort>;
  providerObservations: readonly ProviderScopeObservation[];
  providerObservationSelections: readonly ProviderObservationSelection[];
}>;

export interface PlanningGraph {
  readonly fingerprint: string;
  planningProjection(): PlanningGraphProjection;
  lineageProjection(): PlanningLineageProjection;
  contextFor(target: Extract<PlanningTarget, { kind: "roadmap" }>): RoadmapContextResult;
  contextFor(target: Readonly<{ kind: "gate"; id: string }>): GateContextResult;
  contextFor(target: Extract<PlanningTarget, { kind: "effort" }>): EffortContextResult;
  contextFor(target: PlanningTarget): PlanningContextResult;
}

type GraphCollections = Readonly<{
  summary: ProjectSnapshotInput["summary"];
  brief: ProjectSnapshotInput["brief"];
  roadmaps: CollectionProjection<Roadmap>;
  gates: CollectionProjection<MilestoneGate>;
  efforts: CollectionProjection<Effort>;
  authorities: CollectionProjection<Authority>;
  assets: CollectionProjection<AssetProjection>;
  checks: CollectionProjection<AlignmentCheck>;
  reviews: CollectionProjection<PlanningReview>;
  providerObservations: readonly ProviderScopeObservation[];
  providerObservationSelections: readonly ProviderObservationSelection[];
}>;

type PlanningProjectionInput = PlanningGraphProjection &
  Readonly<{
    diagnostics: readonly SnapshotDiagnostic[];
    sources: readonly SourceRecord[];
  }>;

const compareUtf8 = (left: string, right: string): number =>
  Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));

const PLANNING_RELATION_DIAGNOSTIC_CODES = new Set([
  "broken-canonical-reference",
  "roadmap-focus-outside-gate-order",
  "roadmap-focuses-non-active-gate",
  "gate-roadmap-mismatch",
  "gate-missing-from-roadmap-order",
  "effort-roadmap-gate-mismatch",
]);

const GATE_RELATION_CHAIN_BREAKING_CODES = new Set([
  "passed-gate-missing-passage",
  "open-gate-has-passage",
]);

const trusted = <T>(collection: CollectionProjection<T>): readonly T[] =>
  collection.validity === "invalid" ? [] : collection.items;

const issues = <T>(collection: CollectionProjection<T>): readonly ProjectionIssue[] =>
  collection.validity === "available" ? [] : collection.issues;

const issueKey = (issue: PlanningGraphIssue): string =>
  `${issue.code}\u0000${issue.target}\u0000${issue.source ?? ""}\u0000${issue.message}`;

const stableIssues = (values: readonly PlanningGraphIssue[]): readonly PlanningGraphIssue[] => {
  const byKey = new Map(values.map((value) => [issueKey(value), value]));
  return [...byKey.values()].sort((left, right) => compareUtf8(issueKey(left), issueKey(right)));
};

const relationIssue = (
  code: string,
  target: string,
  message: string,
  source?: string,
): PlanningGraphIssue => ({ code, target, message, ...(source === undefined ? {} : { source }) });

const valueWithSource = <T extends { source: string }>(
  value: T,
  sourceByReference: ReadonlyMap<string, SourceRecord>,
): PlanningGraphValue<T> => {
  const source = sourceByReference.get(value.source);
  if (source === undefined)
    throw new Error(`Planning Graph source is unavailable: ${value.source}`);
  return { value, source };
};

const projectionWithIsolation = <T extends { source: string }>(
  collection: CollectionProjection<T>,
  retained: readonly T[],
  removed: readonly T[],
  sourceByReference: ReadonlyMap<string, SourceRecord>,
  diagnostics: readonly SnapshotDiagnostic[],
): CollectionProjection<T> => {
  if (collection.validity === "invalid") return collection;
  const relationIssues = removed.map((item): ProjectionIssue => {
    const source = sourceByReference.get(item.source);
    const diagnostic = diagnostics.find(
      (candidate) =>
        candidate.impact === "blocking" &&
        (candidate.source === item.source || candidate.target === source?.displayLocator),
    );
    if (diagnostic !== undefined) {
      return {
        code: diagnostic.code,
        target: diagnostic.target,
        message: diagnostic.message,
        ...(diagnostic.source === undefined ? {} : { source: diagnostic.source }),
      };
    }
    return {
      code: "invalid-planning-relation",
      target: source?.displayLocator ?? item.source,
      message: "Planning object is isolated because its required relation is unavailable.",
      ...(source === undefined ? {} : { source: source.reference }),
    };
  });
  const collectionIssues = collection.validity === "partial" ? collection.issues : [];
  const combined = [...collectionIssues, ...relationIssues];
  if (combined.length === 0) return { validity: "available", items: retained };
  return retained.length === 0
    ? { validity: "invalid", issues: combined }
    : { validity: "partial", items: retained, issues: combined };
};

const buildPlanningProjection = (input: PlanningProjectionInput): PlanningGraphProjection => {
  const sourceByReference: ReadonlyMap<string, SourceRecord> = new Map(
    input.sources.map((source) => [source.reference, source]),
  );
  const hasSingleBoundSource = (role: "roadmap" | "milestone-gate", identity: string): boolean =>
    input.sources.filter(
      (source) => source.binding?.role === role && source.binding.identity === identity,
    ).length === 1;
  const unavailableGateIds = new Set(
    issues(input.gates).flatMap((issue) => {
      if (!GATE_RELATION_CHAIN_BREAKING_CODES.has(issue.code)) return [];
      const binding = sourceByReference.get(issue.source ?? "")?.binding;
      return binding?.role === "milestone-gate" ? [binding.identity] : [];
    }),
  );
  const initialRoadmaps = trusted(input.roadmaps);
  const initialGates = trusted(input.gates);
  const roadmapById = new Map(initialRoadmaps.map((roadmap) => [roadmap.id, roadmap]));
  const gateById = new Map(initialGates.map((gate) => [gate.id, gate]));
  const roadmaps = initialRoadmaps.filter((roadmap) => {
    const orderedRelationsTrustworthy = roadmap.gateOrder.every((gateId) => {
      const gate = gateById.get(gateId);
      return (
        (gate === undefined &&
          hasSingleBoundSource("milestone-gate", gateId) &&
          !unavailableGateIds.has(gateId)) ||
        gate?.roadmapId === roadmap.id
      );
    });
    if (!orderedRelationsTrustworthy || roadmap.focusedGateId === null) {
      return orderedRelationsTrustworthy;
    }
    const focused = gateById.get(roadmap.focusedGateId);
    return (
      roadmap.gateOrder.includes(roadmap.focusedGateId) &&
      ((focused === undefined &&
        hasSingleBoundSource("milestone-gate", roadmap.focusedGateId) &&
        !unavailableGateIds.has(roadmap.focusedGateId)) ||
        (focused?.roadmapId === roadmap.id && focused.lifecycle === "active"))
    );
  });
  const gates = initialGates.filter((gate) => {
    const roadmap = roadmapById.get(gate.roadmapId);
    return (
      (roadmap === undefined && hasSingleBoundSource("roadmap", gate.roadmapId)) ||
      roadmap?.gateOrder.includes(gate.id) === true
    );
  });
  const initialEfforts = trusted(input.efforts);
  const efforts = initialEfforts.filter((effort) => {
    const roadmap = roadmapById.get(effort.roadmapId);
    const gate = gateById.get(effort.targetGateId);
    return (
      ((roadmap === undefined && hasSingleBoundSource("roadmap", effort.roadmapId)) ||
        roadmap?.gateOrder.includes(effort.targetGateId) === true) &&
      ((gate === undefined && hasSingleBoundSource("milestone-gate", effort.targetGateId)) ||
        gate?.roadmapId === effort.roadmapId)
    );
  });
  const isolatedRoadmaps = projectionWithIsolation(
    input.roadmaps,
    roadmaps,
    initialRoadmaps.filter((roadmap) => !roadmaps.includes(roadmap)),
    sourceByReference,
    input.diagnostics,
  );
  const isolatedGates = projectionWithIsolation(
    input.gates,
    gates,
    initialGates.filter((gate) => !gates.includes(gate)),
    sourceByReference,
    input.diagnostics,
  );
  const isolatedEfforts = projectionWithIsolation(
    input.efforts,
    efforts,
    initialEfforts.filter((effort) => !efforts.includes(effort)),
    sourceByReference,
    input.diagnostics,
  );
  const normalized = normalizePlanningDerivations({
    roadmaps: isolatedRoadmaps,
    gates: isolatedGates,
    efforts: isolatedEfforts,
    providerObservations: input.providerObservations,
    providerObservationSelections: input.providerObservationSelections,
    diagnostics: input.diagnostics,
    sources: input.sources,
  });
  return {
    ...normalized,
    providerObservations: input.providerObservations,
    providerObservationSelections: input.providerObservationSelections,
  };
};

const overlayNormalizedItems = <T extends { id: string }>(
  base: CollectionProjection<T>,
  normalized: CollectionProjection<T>,
): CollectionProjection<T> => {
  if (base.validity === "invalid") return base;
  const normalizedById = new Map(trusted(normalized).map((item) => [item.id, item]));
  const items = base.items.map((item) => normalizedById.get(item.id) ?? item);
  return base.validity === "available"
    ? { validity: "available", items }
    : { validity: "partial", items, issues: base.issues };
};

class ImmutablePlanningGraph implements PlanningGraph {
  readonly fingerprint: string;
  readonly #collections: GraphCollections;
  readonly #planningProjection: PlanningGraphProjection;
  readonly #lineageProjection: PlanningLineageProjection;
  readonly #projectOrientation: PlanningGraphProjectOrientation;
  readonly #sources: readonly SourceRecord[];
  readonly #sourceByReference: ReadonlyMap<string, SourceRecord>;
  readonly #knownKinds: ReadonlyMap<string, ReadonlySet<string>>;
  readonly #knownSources: ReadonlyMap<string, ReadonlySet<string>>;
  readonly #checkTargetBySource: ReadonlyMap<string, string>;
  readonly #assetOwnersBySource: ReadonlyMap<string, ReadonlySet<string>>;
  readonly #globalProviderIssues: readonly PlanningGraphIssue[];
  readonly #instrumentation: PlanningGraphInstrumentation | undefined;

  constructor(
    fingerprint: string,
    collections: GraphCollections,
    planningProjection: PlanningGraphProjection,
    lineageProjection: PlanningLineageProjection,
    sources: readonly SourceRecord[],
    knownKinds: ReadonlyMap<string, ReadonlySet<string>>,
    knownSources: ReadonlyMap<string, ReadonlySet<string>>,
    checkTargetBySource: ReadonlyMap<string, string>,
    assetOwnersBySource: ReadonlyMap<string, ReadonlySet<string>>,
    globalProviderIssues: readonly PlanningGraphIssue[],
    instrumentation?: PlanningGraphInstrumentation,
  ) {
    this.fingerprint = fingerprint;
    this.#collections = deepFreeze(collections);
    this.#planningProjection = deepFreeze(planningProjection);
    this.#lineageProjection = deepFreeze(lineageProjection);
    const orientationSourceReferences = new Set(
      [
        ...(collections.summary.validity === "partial" || collections.summary.validity === "invalid"
          ? collections.summary.issues
          : []),
        ...(collections.brief.validity === "partial" || collections.brief.validity === "invalid"
          ? collections.brief.issues
          : []),
      ].flatMap((issue) => (issue.source === undefined ? [] : [issue.source])),
    );
    this.#projectOrientation = deepFreeze({
      summary: collections.summary,
      brief: collections.brief,
      sources: sources.filter(
        (source) =>
          source.binding?.role === "project-summary" ||
          source.binding?.role === "project-brief" ||
          orientationSourceReferences.has(source.reference),
      ),
    });
    this.#sources = deepFreeze([...sources]);
    this.#sourceByReference = new Map(sources.map((source) => [source.reference, source]));
    this.#knownKinds = knownKinds;
    this.#knownSources = knownSources;
    this.#checkTargetBySource = checkTargetBySource;
    this.#assetOwnersBySource = assetOwnersBySource;
    this.#globalProviderIssues = deepFreeze([...globalProviderIssues]);
    this.#instrumentation = instrumentation;
    Object.freeze(this);
  }

  planningProjection(): PlanningGraphProjection {
    return this.#planningProjection;
  }

  lineageProjection(): PlanningLineageProjection {
    return this.#lineageProjection;
  }

  #scopedIssues<T>(id: string, collection: CollectionProjection<T>): readonly ProjectionIssue[] {
    const requestedSources = this.#knownSources.get(id) ?? new Set<string>();
    return issues(collection).filter(
      (issue) =>
        issue.target === id || (issue.source !== undefined && requestedSources.has(issue.source)),
    );
  }

  #invalidTarget<Target extends PlanningTarget>(
    target: Target,
    expectedType: "roadmap" | "milestone-gate" | "effort",
    label: "Roadmap" | "Gate" | "Effort",
    collection: CollectionProjection<unknown>,
  ): InvalidContextResult<Target> {
    const kinds = this.#knownKinds.get(target.id);
    const prefix = expectedType === "milestone-gate" ? "gate" : expectedType;
    const wrongKind =
      (!target.id.startsWith(`${prefix}:`) && target.id.includes(":")) ||
      (kinds !== undefined && !kinds.has(expectedType));
    return deepFreeze({
      fingerprint: this.fingerprint,
      state: "invalid" as const,
      target,
      projectOrientation: this.#projectOrientation,
      issues: stableIssues([
        relationIssue(
          wrongKind
            ? "target-kind-mismatch"
            : kinds?.has(expectedType) === true
              ? "invalid-target"
              : "unknown-target",
          target.id,
          wrongKind
            ? "Stable ID identifies a different Bearing object kind."
            : kinds?.has(expectedType) === true
              ? `The requested ${label} is not trustworthy.`
              : `No ${label} exists with the requested Stable ID.`,
        ),
        ...this.#scopedIssues(target.id, collection),
      ]),
    });
  }

  #attachContributorIssues(closureIssues: PlanningGraphIssue[]): void {
    const sources = new Set(
      closureIssues.flatMap((issue) =>
        issue.code === "untrusted-effort-contributor" && issue.source !== undefined
          ? [issue.source]
          : [],
      ),
    );
    closureIssues.push(
      ...issues(this.#collections.efforts).filter(
        (issue) => issue.source !== undefined && sources.has(issue.source),
      ),
    );
  }

  #buildEffortContext(
    effort: Effort,
    closureIssues: PlanningGraphIssue[],
  ): PlanningGraphEffortContext | undefined {
    const sourceByReference = this.#sourceByReference;
    closureIssues.push(...this.#scopedIssues(effort.id, this.#collections.efforts));
    const effortSource = sourceByReference.get(effort.source);
    if (effortSource === undefined) {
      closureIssues.push(
        relationIssue(
          "missing-source-provenance",
          effort.id,
          "Effort source provenance is unavailable.",
        ),
      );
      return undefined;
    }
    const roadmap = trusted(this.#collections.roadmaps).find(
      (candidate) => candidate.id === effort.roadmapId,
    );
    const gate = trusted(this.#collections.gates).find(
      (candidate) => candidate.id === effort.targetGateId,
    );
    if (roadmap === undefined) {
      closureIssues.push(
        relationIssue(
          "missing-roadmap",
          effort.roadmapId,
          "An Effort's required Roadmap relation is unavailable.",
          effort.source,
        ),
      );
      closureIssues.push(...this.#scopedIssues(effort.roadmapId, this.#collections.roadmaps));
    }
    if (gate === undefined) {
      closureIssues.push(
        relationIssue(
          "missing-target-gate",
          effort.targetGateId,
          "An Effort's required Target Gate relation is unavailable.",
          effort.source,
        ),
      );
      closureIssues.push(...this.#scopedIssues(effort.targetGateId, this.#collections.gates));
    }
    if (roadmap !== undefined && gate !== undefined && gate.roadmapId !== roadmap.id) {
      closureIssues.push(
        relationIssue(
          "effort-roadmap-gate-mismatch",
          effort.id,
          "The Effort's Roadmap and Target Gate do not belong to the same planning chain.",
          effort.source,
        ),
      );
    }
    if (
      roadmap !== undefined &&
      gate !== undefined &&
      gate.roadmapId === roadmap.id &&
      !roadmap.gateOrder.includes(gate.id)
    ) {
      closureIssues.push(
        relationIssue(
          "gate-missing-from-roadmap-order",
          gate.id,
          "The Effort's Target Gate is missing from its Roadmap's canonical order.",
          effort.source,
        ),
      );
    }
    const authorityValues: PlanningGraphValue<Authority>[] = [];
    for (const authorityId of effort.authorityIds) {
      const authority = trusted(this.#collections.authorities).find(
        (candidate) => candidate.id === authorityId,
      );
      if (authority === undefined) {
        closureIssues.push(
          relationIssue(
            "missing-authority",
            authorityId,
            "A required Authority relation is unavailable.",
            effort.source,
          ),
        );
        closureIssues.push(...this.#scopedIssues(authorityId, this.#collections.authorities));
      } else authorityValues.push(valueWithSource(authority, sourceByReference));
    }
    const workBinding = effort.workBinding;
    const providerCapture =
      workBinding === undefined
        ? undefined
        : (this.#collections.providerObservations.find((capture) =>
            sameMattNativeScope(capture.binding, workBinding),
          ) ??
          this.#collections.providerObservations.find((capture) =>
            sameMattNativeLocator(capture.binding, workBinding),
          ));
    const providerSelection =
      workBinding === undefined
        ? undefined
        : this.#collections.providerObservationSelections.find((selection) =>
            sameMattNativeScope(selection, workBinding),
          );
    const nativeWorkReadingState = this.#lineageProjection.subjects.find(
      (subject) => subject.identity.kind === "effort" && subject.identity.id === effort.id,
    )?.nativeWorkReadingState;
    if (effort.workBinding !== undefined && providerCapture === undefined) {
      closureIssues.push(
        relationIssue(
          "missing-provider-capture",
          effort.workBinding.nativeScope,
          "The Effort's required provider capture is unavailable.",
          effort.source,
        ),
      );
    }
    if (providerCapture !== undefined) {
      closureIssues.push(
        ...providerCapture.diagnostics.map((item) =>
          relationIssue(item.code, item.target, item.message),
        ),
      );
    }
    if (
      effort.workBinding !== undefined &&
      (providerCapture === undefined ||
        assessSelectedProviderObservationEvidence(providerCapture, providerSelection)
          .frontierEvidence !== "trustworthy")
    ) {
      closureIssues.push(
        relationIssue(
          "untrusted-provider-observation-selection",
          effort.workBinding.nativeScope,
          "The Effort's selected provider observation is unavailable, conflicted, or not currently trustworthy.",
          effort.source,
        ),
      );
    }
    const relevantTargets = new Set<string>([
      effort.id,
      effort.roadmapId,
      effort.targetGateId,
      ...effort.authorityIds,
    ]);
    const checks = trusted(this.#collections.checks)
      .filter((candidate) => relevantTargets.has(candidate.target))
      .sort((left, right) => compareUtf8(left.id, right.id));
    const citedAssetIds = new Set<string>(effort.citations.map((citation) => citation.assetId));
    closureIssues.push(
      ...issues(this.#collections.checks).filter((issue) => {
        const target =
          issue.source === undefined ? undefined : this.#checkTargetBySource.get(issue.source);
        return target !== undefined && relevantTargets.has(target);
      }),
    );
    const evidence = trusted(this.#collections.assets)
      .filter((candidate) => candidate.owner === effort.id || citedAssetIds.has(candidate.id))
      .sort((left, right) => compareUtf8(left.id, right.id));
    const assetIssues = issues(this.#collections.assets);
    const citedAssetIssueIds = new Set<string>();
    for (const issue of assetIssues) {
      const source = issue.source === undefined ? undefined : sourceByReference.get(issue.source);
      const identity = source?.binding?.role === "asset" ? source.binding.identity : undefined;
      const cited = identity !== undefined && citedAssetIds.has(identity);
      const ownerLinked =
        issue.source !== undefined &&
        this.#assetOwnersBySource.get(issue.source)?.has(effort.id) === true;
      if (cited || ownerLinked) {
        if (cited && identity !== undefined) citedAssetIssueIds.add(identity);
        closureIssues.push(issue);
      } else if (
        citedAssetIds.size > 0 &&
        this.#collections.assets.validity === "invalid" &&
        identity === undefined
      ) {
        closureIssues.push(issue);
      }
    }
    const projectedAssetIds = new Set<string>(evidence.map((asset) => asset.id));
    for (const assetId of citedAssetIds) {
      if (!projectedAssetIds.has(assetId) && !citedAssetIssueIds.has(assetId)) {
        closureIssues.push(
          relationIssue(
            "missing-cited-asset",
            assetId,
            "A cited Asset is unavailable.",
            effort.source,
          ),
        );
      }
    }
    for (const asset of evidence) {
      if (asset.contentAvailability !== "available")
        closureIssues.push(
          relationIssue(
            "unavailable-evidence-content",
            asset.id,
            "Registered evidence content is unavailable.",
            asset.source,
          ),
        );
    }
    return {
      effort: valueWithSource(effort, sourceByReference),
      source: effortSource,
      ...(roadmap === undefined ? {} : { roadmap: valueWithSource(roadmap, sourceByReference) }),
      ...(gate === undefined ? {} : { targetGate: valueWithSource(gate, sourceByReference) }),
      authorities: authorityValues,
      ...(providerCapture === undefined ? {} : { providerCapture }),
      ...(nativeWorkReadingState === undefined ? {} : { nativeWorkReadingState }),
      alignmentChecks: checks.map((check) => valueWithSource(check, sourceByReference)),
      evidence: evidence.map((asset) => valueWithSource(asset, sourceByReference)),
    };
  }

  #sourceClosure(
    baseReferences: readonly string[],
    effortContexts: readonly PlanningGraphEffortContext[],
    finalIssues: readonly PlanningGraphIssue[],
  ): readonly SourceRecord[] {
    const references = new Set(baseReferences);
    for (const context of effortContexts) {
      references.add(context.effort.value.source);
      if (context.roadmap !== undefined) references.add(context.roadmap.value.source);
      if (context.targetGate !== undefined) references.add(context.targetGate.value.source);
      for (const value of [...context.authorities, ...context.alignmentChecks, ...context.evidence])
        references.add(value.source.reference);
      for (const object of mattObjects(context.providerCapture)) {
        const source = this.#sources.find(
          (candidate) => candidate.kind === "tracker" && candidate.binding?.identity === object.ref,
        );
        if (source !== undefined) references.add(source.reference);
      }
    }
    for (const issue of finalIssues) if (issue.source !== undefined) references.add(issue.source);
    return this.#sources.filter((source) => references.has(source.reference));
  }

  contextFor(target: Extract<PlanningTarget, { kind: "roadmap" }>): RoadmapContextResult;
  contextFor(target: Extract<PlanningTarget, { kind: "gate" }>): GateContextResult;
  contextFor(target: Extract<PlanningTarget, { kind: "effort" }>): EffortContextResult;
  contextFor(target: PlanningTarget): PlanningContextResult;
  contextFor(target: PlanningTarget): PlanningContextResult {
    this.#instrumentation?.recordRootClosure();
    if (target.kind === "roadmap") return this.#roadmapContext(target);
    if (target.kind === "gate") return this.#gateContext(target);
    return this.#effortContext(target);
  }

  #roadmapContext(target: Extract<PlanningTarget, { kind: "roadmap" }>): RoadmapContextResult {
    const roadmap = trusted(this.#collections.roadmaps).find(
      (candidate) => candidate.id === target.id,
    );
    if (roadmap === undefined)
      return this.#invalidTarget(target, "roadmap", "Roadmap", this.#collections.roadmaps);
    const closureIssues: PlanningGraphIssue[] = [
      ...this.#scopedIssues(roadmap.id, this.#collections.roadmaps),
      ...this.#globalProviderIssues,
    ];
    const orderedGates: MilestoneGate[] = [];
    for (const gateId of roadmap.gateOrder) {
      const gate = trusted(this.#collections.gates).find((candidate) => candidate.id === gateId);
      if (gate === undefined) {
        closureIssues.push(
          relationIssue(
            "missing-gate",
            gateId,
            "A Gate in the Roadmap's canonical order is unavailable.",
            roadmap.source,
          ),
        );
        closureIssues.push(...this.#scopedIssues(gateId, this.#collections.gates));
      } else {
        orderedGates.push(gate);
        closureIssues.push(...this.#scopedIssues(gate.id, this.#collections.gates));
        if (gate.roadmapId !== roadmap.id)
          closureIssues.push(
            relationIssue(
              "gate-roadmap-mismatch",
              gate.id,
              "A Gate in the Roadmap order declares a different Roadmap.",
              gate.source,
            ),
          );
      }
    }
    let focusedGate: MilestoneGate | undefined;
    if (roadmap.focusedGateId != null) {
      if (!roadmap.gateOrder.includes(roadmap.focusedGateId))
        closureIssues.push(
          relationIssue(
            "roadmap-focus-outside-gate-order",
            roadmap.focusedGateId,
            "The Roadmap focus is outside its canonical Gate order.",
            roadmap.source,
          ),
        );
      focusedGate = trusted(this.#collections.gates).find(
        (candidate) => candidate.id === roadmap.focusedGateId,
      );
      if (focusedGate === undefined)
        closureIssues.push(
          relationIssue(
            "missing-focused-gate",
            roadmap.focusedGateId,
            "The Roadmap's focused Gate is unavailable.",
            roadmap.source,
          ),
        );
      if (focusedGate === undefined) {
        closureIssues.push(...this.#scopedIssues(roadmap.focusedGateId, this.#collections.gates));
      } else if (roadmap.lifecycle === "active" && focusedGate.lifecycle !== "active")
        closureIssues.push(
          relationIssue(
            "roadmap-focuses-non-active-gate",
            focusedGate.id,
            "The Roadmap's focused Gate is not active.",
            focusedGate.source,
          ),
        );
    }
    this.#attachContributorIssues(closureIssues);
    const effortsById = new Map(
      trusted(this.#collections.efforts).map((effort) => [effort.id, effort]),
    );
    const effortContexts = roadmap.effortIds
      .flatMap((effortId) => {
        const effort = effortsById.get(effortId);
        return effort === undefined || effort.roadmapId !== roadmap.id ? [] : [effort];
      })
      .flatMap((effort) => {
        const context = this.#buildEffortContext(effort, closureIssues);
        return context === undefined ? [] : [context];
      });
    const orderedEffortIds = new Set(roadmap.effortIds);
    for (const effort of trusted(this.#collections.efforts)) {
      if (effort.roadmapId !== roadmap.id || orderedEffortIds.has(effort.id)) continue;
      this.#buildEffortContext(effort, closureIssues);
    }
    const finalIssues = stableIssues(closureIssues);
    return deepFreeze({
      fingerprint: this.fingerprint,
      state: finalIssues.length === 0 ? ("complete" as const) : ("partial" as const),
      target,
      projectOrientation: this.#projectOrientation,
      context: {
        roadmap: valueWithSource(roadmap, this.#sourceByReference),
        gates: orderedGates.map((gate) => valueWithSource(gate, this.#sourceByReference)),
        ...(focusedGate === undefined
          ? {}
          : { focusedGate: valueWithSource(focusedGate, this.#sourceByReference) }),
        efforts: effortContexts,
        sources: this.#sourceClosure(
          [roadmap.source, ...orderedGates.map((gate) => gate.source)],
          effortContexts,
          finalIssues,
        ),
      },
      issues: finalIssues,
    });
  }

  #gateContext(target: Extract<PlanningTarget, { kind: "gate" }>): GateContextResult {
    const gate = trusted(this.#collections.gates).find((candidate) => candidate.id === target.id);
    if (gate === undefined)
      return this.#invalidTarget(target, "milestone-gate", "Gate", this.#collections.gates);
    const closureIssues: PlanningGraphIssue[] = [
      ...this.#scopedIssues(gate.id, this.#collections.gates),
      ...this.#globalProviderIssues,
    ];
    const roadmap = trusted(this.#collections.roadmaps).find(
      (candidate) => candidate.id === gate.roadmapId,
    );
    if (roadmap === undefined)
      closureIssues.push(
        relationIssue(
          "missing-roadmap",
          gate.roadmapId,
          "The Gate's required Roadmap relation is unavailable.",
          gate.source,
        ),
      );
    if (roadmap === undefined) {
      closureIssues.push(...this.#scopedIssues(gate.roadmapId, this.#collections.roadmaps));
    } else if (!roadmap.gateOrder.includes(gate.id))
      closureIssues.push(
        relationIssue(
          "gate-missing-from-roadmap-order",
          gate.id,
          "The Gate is missing from its Roadmap's canonical order.",
          gate.source,
        ),
      );
    this.#attachContributorIssues(closureIssues);
    const effortsById = new Map(
      trusted(this.#collections.efforts).map((effort) => [effort.id, effort]),
    );
    const effortContexts = gate.effortIds
      .flatMap((effortId) => {
        const effort = effortsById.get(effortId);
        return effort === undefined || effort.targetGateId !== gate.id ? [] : [effort];
      })
      .flatMap((effort) => {
        const context = this.#buildEffortContext(effort, closureIssues);
        return context === undefined ? [] : [context];
      });
    const finalIssues = stableIssues(closureIssues);
    return deepFreeze({
      fingerprint: this.fingerprint,
      state: finalIssues.length === 0 ? ("complete" as const) : ("partial" as const),
      target,
      projectOrientation: this.#projectOrientation,
      context: {
        gate: valueWithSource(gate, this.#sourceByReference),
        ...(roadmap === undefined
          ? {}
          : { roadmap: valueWithSource(roadmap, this.#sourceByReference) }),
        efforts: effortContexts,
        sources: this.#sourceClosure(
          [gate.source, ...(roadmap === undefined ? [] : [roadmap.source])],
          effortContexts,
          finalIssues,
        ),
      },
      issues: finalIssues,
    });
  }

  #effortContext(target: Extract<PlanningTarget, { kind: "effort" }>): EffortContextResult {
    const effort = trusted(this.#collections.efforts).find(
      (candidate) => candidate.id === target.id,
    );
    if (effort === undefined)
      return this.#invalidTarget(target, "effort", "Effort", this.#collections.efforts);
    const closureIssues: PlanningGraphIssue[] = [];
    const context = this.#buildEffortContext(effort, closureIssues);
    if (context === undefined)
      return this.#invalidTarget(target, "effort", "Effort", this.#collections.efforts);
    const finalIssues = stableIssues(closureIssues);
    return deepFreeze({
      fingerprint: this.fingerprint,
      state: finalIssues.length === 0 ? ("complete" as const) : ("partial" as const),
      target,
      projectOrientation: this.#projectOrientation,
      context: {
        ...context,
        sources: this.#sourceClosure([effort.source], [context], finalIssues),
      },
      issues: finalIssues,
    });
  }
}

export const buildPlanningGraph = async (
  input: PlanningGraphBuildInput,
): Promise<PlanningGraph> => {
  input.instrumentation?.recordBuild();
  const providerObservationSelections =
    input.providerObservationSelections ??
    input.providerObservations.map((observation) => ({
      provider: observation.provider,
      nativeScope: observation.binding.nativeScope,
      observationId: observation.id,
      effectiveFreshness: observation.freshness.assessment,
      latestAttempt: null,
    }));
  const lineageObservationByScope = new Map<string, MattSkillsV1ProviderObservation>();
  const boundScopeKeys = new Set(
    input.decoded.records.flatMap((record) => {
      const data = record.data;
      if (data?.Type !== "effort" || data["Work binding"] === undefined) return [];
      return [
        mattNativeScopeKey({
          provider: data["Work binding"].Provider,
          nativeScope: data["Work binding"]["Native scope"],
        }),
      ];
    }),
  );
  for (const observation of input.nativeScopeInspectionObservations ?? []) {
    const key = mattNativeScopeKey(observation.binding);
    if (boundScopeKeys.has(key)) lineageObservationByScope.set(key, observation);
  }
  for (const observation of input.providerObservations) {
    lineageObservationByScope.set(mattNativeScopeKey(observation.binding), observation);
  }
  const lineageObservations = [...lineageObservationByScope.values()].sort((left, right) =>
    mattNativeScopeKey(left.binding).localeCompare(mattNativeScopeKey(right.binding), "en"),
  );
  const effortLocators = new Set(
    input.decoded.records
      .filter((record) => record.type === "effort")
      .map((record) => record.locator),
  );
  const gateLocators = new Set(
    input.decoded.records
      .filter((record) => record.type === "milestone-gate")
      .map((record) => record.locator),
  );
  const governance = buildGovernanceProjection({
    records: input.decoded.records,
    sitemapFingerprint: input.fingerprint,
    diagnostics: input.diagnostics.filter(
      (diagnostic) =>
        !PLANNING_RELATION_DIAGNOSTIC_CODES.has(diagnostic.code) &&
        !(
          diagnostic.code === "ambiguous-canonical-reference" &&
          (effortLocators.has(diagnostic.target) || gateLocators.has(diagnostic.target))
        ),
    ),
  });
  const assets = await buildAssetProjection({
    records: input.decoded.records,
    sitemapFingerprint: input.fingerprint,
    contentObservations: input.assetContentObservations,
  });
  const decisions = buildDecisionProjection({
    records: input.decoded.records,
    sitemapFingerprint: input.fingerprint,
  });
  const sources = mergeSourceRecords([
    governance.sources,
    assets.sources,
    decisions.sources,
    buildMattNativeSourceRecords(lineageObservations, input.fingerprint),
  ]);
  const assetSourceByIdentity = new Map(
    sources.flatMap((source) =>
      source.binding?.role === "asset"
        ? [[source.binding.identity, source.reference] as const]
        : [],
    ),
  );
  const assetOwnersBySource = new Map<string, Set<string>>();
  const addAssetOwner = (source: string, owner: string): void => {
    const owners = assetOwnersBySource.get(source) ?? new Set<string>();
    owners.add(owner);
    assetOwnersBySource.set(source, owners);
  };
  for (const record of input.decoded.records) {
    if (record.content.kind !== "asset-registry") continue;
    for (const asset of record.content.assets) {
      addAssetOwner(record.source.reference, asset.Owner);
      const assetSource = assetSourceByIdentity.get(asset.ID);
      if (assetSource !== undefined) addAssetOwner(assetSource, asset.Owner);
    }
  }
  const diagnosticProjection = buildSnapshotDiagnostics({
    sitemapFingerprint: input.fingerprint,
    diagnostics: input.diagnostics,
    sourceLocators: sources.map((source) => ({
      kind: source.kind,
      locator: source.displayLocator,
      ...(source.fragment === undefined ? {} : { fragment: source.fragment }),
      ...(source.binding === undefined ? {} : { binding: source.binding }),
    })),
  });
  const planningProjection = buildPlanningProjection({
    roadmaps: governance.roadmaps,
    gates: governance.gates,
    efforts: governance.efforts,
    providerObservations: input.providerObservations,
    providerObservationSelections,
    diagnostics: diagnosticProjection.diagnostics,
    sources,
  });
  const rebuiltAssets = rebuildAssetReverseRelations(assets.assets, {
    roadmaps: planningProjection.roadmaps,
    gates: planningProjection.gates,
    efforts: planningProjection.efforts,
    authorities: governance.authorities,
    checks: decisions.checks,
    reviews: decisions.reviews,
    directEvidence: collectAssetDirectEvidence(input.decoded.records),
  });
  const graphCollections: GraphCollections = {
    summary: governance.summary,
    brief: governance.brief,
    roadmaps: overlayNormalizedItems(governance.roadmaps, planningProjection.roadmaps),
    gates: overlayNormalizedItems(governance.gates, planningProjection.gates),
    efforts: overlayNormalizedItems(governance.efforts, planningProjection.efforts),
    authorities: governance.authorities,
    assets: rebuiltAssets,
    checks: decisions.checks,
    reviews: decisions.reviews,
    providerObservations: input.providerObservations,
    providerObservationSelections,
  };
  const lineageProjection = buildPlanningLineageProjection({
    roadmaps: planningProjection.roadmaps,
    gates: planningProjection.gates,
    efforts: planningProjection.efforts,
    authorities: governance.authorities,
    assets: rebuiltAssets,
    checks: decisions.checks,
    reviews: decisions.reviews,
    providerObservations: input.providerObservations,
    providerObservationSelections,
    nativeScopeInspections: {
      observations: input.nativeScopeInspectionObservations ?? [],
      selections: input.nativeScopeInspectionSelections ?? [],
    },
    sources,
  });
  const knownKinds = new Map<string, Set<string>>();
  const knownSources = new Map<string, Set<string>>();
  const checkTargetBySource = new Map<string, string>();
  for (const record of input.decoded.records) {
    const data = record.data;
    if (data === undefined || data.Type === "asset-registry" || data.Type === "roadmap-index")
      continue;
    const kinds = knownKinds.get(data.ID) ?? new Set<string>();
    kinds.add(data.Type);
    knownKinds.set(data.ID, kinds);
    const sourceReferences = knownSources.get(data.ID) ?? new Set<string>();
    sourceReferences.add(record.source.reference);
    knownSources.set(data.ID, sourceReferences);
    if (data.Type === "alignment-check") {
      checkTargetBySource.set(record.source.reference, data.Target);
    }
  }
  return new ImmutablePlanningGraph(
    input.fingerprint,
    graphCollections,
    planningProjection,
    lineageProjection,
    sources,
    knownKinds,
    knownSources,
    checkTargetBySource,
    assetOwnersBySource,
    [],
    input.instrumentation,
  );
};
