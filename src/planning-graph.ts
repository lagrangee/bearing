import type { AssetContentObservation } from "./asset-inputs";
import type { DecodedBearingRecordGeneration } from "./bearing-record-decoder";
import { buildCapturedNativeNodes } from "./captured-native-work";
import { type NativeSourceRecord, scopeFor } from "./native-work";
import type { PlanningGraphInstrumentation } from "./planning-graph-instrumentation";
import { buildAssetProjection } from "./project-snapshot/assets";
import type {
  AlignmentCheck,
  AssetProjection,
  Authority,
  CollectionProjection,
  Effort,
  MapProjection,
  MilestoneGate,
  ProjectionIssue,
  Roadmap,
  SnapshotDiagnostic,
  SourceRecord,
  TicketProjection,
} from "./project-snapshot/contract";
import { buildDecisionProjection } from "./project-snapshot/decisions";
import { buildSnapshotDiagnostics } from "./project-snapshot/diagnostic-projection";
import { buildGovernanceProjection } from "./project-snapshot/governance";
import { buildNativeProjection } from "./project-snapshot/native";
import { normalizePlanningDerivations } from "./project-snapshot/normalized-planning-derivation";
import { createSourceRecord, mergeSourceRecords } from "./project-snapshot/source-records";
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
  map?: PlanningGraphValue<MapProjection>;
  tickets: readonly PlanningGraphValue<TicketProjection>[];
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

type InvalidContextResult<Target extends PlanningTarget> = Readonly<{
  fingerprint: string;
  state: "invalid";
  target: Target;
  context?: undefined;
  issues: readonly PlanningGraphIssue[];
}>;

type PlanningContextResultFor<Target extends PlanningTarget, Context> =
  | Readonly<{
      fingerprint: string;
      state: "complete" | "partial";
      target: Target;
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
  nativeRecords: readonly NativeSourceRecord[];
  diagnostics: readonly StructuralDiagnostic[];
  fingerprint: string;
  assetContentObservations: readonly AssetContentObservation[];
  instrumentation?: PlanningGraphInstrumentation;
}>;

export type PlanningGraphProjection = Readonly<{
  roadmaps: CollectionProjection<Roadmap>;
  gates: CollectionProjection<MilestoneGate>;
  efforts: CollectionProjection<Effort>;
  maps: CollectionProjection<MapProjection>;
  tickets: CollectionProjection<TicketProjection>;
}>;

export interface PlanningGraph {
  readonly fingerprint: string;
  planningProjection(): PlanningGraphProjection;
  contextFor(target: Extract<PlanningTarget, { kind: "roadmap" }>): RoadmapContextResult;
  contextFor(target: Readonly<{ kind: "gate"; id: string }>): GateContextResult;
  contextFor(target: Extract<PlanningTarget, { kind: "effort" }>): EffortContextResult;
  contextFor(target: PlanningTarget): PlanningContextResult;
}

type GraphCollections = Readonly<{
  roadmaps: CollectionProjection<Roadmap>;
  gates: CollectionProjection<MilestoneGate>;
  efforts: CollectionProjection<Effort>;
  authorities: CollectionProjection<Authority>;
  assets: CollectionProjection<AssetProjection>;
  checks: CollectionProjection<AlignmentCheck>;
  maps: CollectionProjection<MapProjection>;
  tickets: CollectionProjection<TicketProjection>;
}>;

type PlanningProjectionInput = PlanningGraphProjection &
  Readonly<{
    diagnostics: readonly SnapshotDiagnostic[];
    sources: readonly SourceRecord[];
  }>;

const compareUtf8 = (left: string, right: string): number =>
  Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));

const TRACKER_NATIVE_DIAGNOSTIC_CODES = new Set([
  "duplicate-ticket-number",
  "unsupported-tracker-status",
  "missing-ticket-blocker",
  "ambiguous-ticket-blocker",
  "claimed-with-unresolved-blocker",
]);

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

const trackerSources = (
  records: readonly NativeSourceRecord[],
  fingerprint: string,
): readonly SourceRecord[] =>
  records.flatMap((record) => {
    if (!/^\.scratch\/[^/]+\/(?:map\.md|issues\/(?:.*\/)?\d+-[^/]+\.md)$/u.test(record.locator)) {
      return [];
    }
    return [
      createSourceRecord(fingerprint, {
        kind: "tracker",
        locator: record.locator,
        binding: {
          role: record.locator.endsWith("/map.md") ? "map" : "ticket",
          identity: record.locator,
        },
      }),
    ];
  });

const deepFreeze = <T>(value: T, seen = new WeakSet<object>()): T => {
  if (typeof value !== "object" || value === null || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
};

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

const effortScope = (source: SourceRecord): string | undefined =>
  source.displayLocator.endsWith("/effort.md")
    ? source.displayLocator.slice(0, -"/effort.md".length)
    : undefined;

const issueInsideEffort = (
  issue: PlanningGraphIssue,
  effortSource: SourceRecord,
  sourceByReference: ReadonlyMap<string, SourceRecord>,
): boolean => {
  const scope = effortScope(effortSource);
  if (scope === undefined) return true;
  const issueSource = sourceByReference.get(issue.source ?? "")?.displayLocator;
  return (
    issue.target === scope ||
    issue.target.startsWith(`${scope}/`) ||
    issueSource === scope ||
    issueSource?.startsWith(`${scope}/`) === true
  );
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

const stripUnavailableEffortBindings = <T extends MapProjection | TicketProjection>(
  collection: CollectionProjection<T>,
  effortIds: ReadonlySet<string>,
): CollectionProjection<T> => {
  if (collection.validity === "invalid") return collection;
  const items = collection.items.map((item) =>
    item.effortId === undefined || effortIds.has(item.effortId)
      ? item
      : ({ ...item, effortId: undefined } as T),
  );
  return collection.validity === "available"
    ? { validity: "available", items }
    : { validity: "partial", items, issues: collection.issues };
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
  const effortIds = new Set<string>(efforts.map((effort) => effort.id));
  const maps = stripUnavailableEffortBindings(input.maps, effortIds);
  const tickets = stripUnavailableEffortBindings(input.tickets, effortIds);
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
    maps,
    tickets,
    diagnostics: input.diagnostics,
    sources: input.sources,
  });
  return { ...normalized, maps, tickets };
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
  readonly #sources: readonly SourceRecord[];
  readonly #sourceByReference: ReadonlyMap<string, SourceRecord>;
  readonly #knownKinds: ReadonlyMap<string, ReadonlySet<string>>;
  readonly #knownSources: ReadonlyMap<string, ReadonlySet<string>>;
  readonly #checkTargetBySource: ReadonlyMap<string, string>;
  readonly #assetOwnersBySource: ReadonlyMap<string, ReadonlySet<string>>;
  readonly #globalNativeIssues: readonly PlanningGraphIssue[];
  readonly #instrumentation: PlanningGraphInstrumentation | undefined;

  constructor(
    fingerprint: string,
    collections: GraphCollections,
    planningProjection: PlanningGraphProjection,
    sources: readonly SourceRecord[],
    knownKinds: ReadonlyMap<string, ReadonlySet<string>>,
    knownSources: ReadonlyMap<string, ReadonlySet<string>>,
    checkTargetBySource: ReadonlyMap<string, string>,
    assetOwnersBySource: ReadonlyMap<string, ReadonlySet<string>>,
    globalNativeIssues: readonly PlanningGraphIssue[],
    instrumentation?: PlanningGraphInstrumentation,
  ) {
    this.fingerprint = fingerprint;
    this.#collections = deepFreeze(collections);
    this.#planningProjection = deepFreeze(planningProjection);
    this.#sources = deepFreeze([...sources]);
    this.#sourceByReference = new Map(sources.map((source) => [source.reference, source]));
    this.#knownKinds = knownKinds;
    this.#knownSources = knownSources;
    this.#checkTargetBySource = checkTargetBySource;
    this.#assetOwnersBySource = assetOwnersBySource;
    this.#globalNativeIssues = deepFreeze([...globalNativeIssues]);
    this.#instrumentation = instrumentation;
    Object.freeze(this);
  }

  planningProjection(): PlanningGraphProjection {
    return this.#planningProjection;
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
    const maps = trusted(this.#collections.maps).filter(
      (candidate) => candidate.effortId === effort.id,
    );
    if (maps.length > 1)
      closureIssues.push(
        relationIssue(
          "ambiguous-native-map",
          effort.id,
          "Multiple native Maps are attributed to one Effort.",
          effort.source,
        ),
      );
    const tickets = trusted(this.#collections.tickets)
      .filter((candidate) => candidate.effortId === effort.id)
      .sort((left, right) => compareUtf8(left.reference, right.reference));
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
    closureIssues.push(
      ...issues(this.#collections.maps).filter((issue) =>
        issueInsideEffort(issue, effortSource, sourceByReference),
      ),
      ...issues(this.#collections.tickets).filter((issue) =>
        issueInsideEffort(issue, effortSource, sourceByReference),
      ),
    );
    return {
      effort: valueWithSource(effort, sourceByReference),
      source: effortSource,
      ...(roadmap === undefined ? {} : { roadmap: valueWithSource(roadmap, sourceByReference) }),
      ...(gate === undefined ? {} : { targetGate: valueWithSource(gate, sourceByReference) }),
      authorities: authorityValues,
      ...(maps.length === 1 && maps[0] !== undefined
        ? { map: valueWithSource(maps[0], sourceByReference) }
        : {}),
      tickets: tickets.map((ticket) => valueWithSource(ticket, sourceByReference)),
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
      for (const value of [
        ...context.authorities,
        ...context.tickets,
        ...context.alignmentChecks,
        ...context.evidence,
        ...(context.map === undefined ? [] : [context.map]),
      ])
        references.add(value.source.reference);
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
      ...this.#globalNativeIssues,
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
    const effortContexts = trusted(this.#collections.efforts)
      .filter((effort) => effort.roadmapId === roadmap.id)
      .sort((left, right) => compareUtf8(left.id, right.id))
      .flatMap((effort) => {
        const context = this.#buildEffortContext(effort, closureIssues);
        return context === undefined ? [] : [context];
      });
    const finalIssues = stableIssues(closureIssues);
    return deepFreeze({
      fingerprint: this.fingerprint,
      state: finalIssues.length === 0 ? ("complete" as const) : ("partial" as const),
      target,
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
      ...this.#globalNativeIssues,
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
    const effortContexts = trusted(this.#collections.efforts)
      .filter((effort) => effort.targetGateId === gate.id)
      .sort((left, right) => compareUtf8(left.id, right.id))
      .flatMap((effort) => {
        const context = this.#buildEffortContext(effort, closureIssues);
        return context === undefined ? [] : [context];
      });
    const finalIssues = stableIssues(closureIssues);
    return deepFreeze({
      fingerprint: this.fingerprint,
      state: finalIssues.length === 0 ? ("complete" as const) : ("partial" as const),
      target,
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
  const effortLocators = new Set(
    input.decoded.records
      .filter((record) => record.type === "effort")
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
          effortLocators.has(diagnostic.target)
        ),
    ),
  });
  const governanceSourceByReference = new Map(
    governance.sources.map((source) => [source.reference, source]),
  );
  const effortByScope = new Map<string, string>();
  for (const effort of trusted(governance.efforts)) {
    const source = governanceSourceByReference.get(effort.source);
    const scope = source === undefined ? undefined : effortScope(source);
    if (scope !== undefined) effortByScope.set(scope, effort.id);
  }
  const native = buildNativeProjection({
    nodes: buildCapturedNativeNodes(input.nativeRecords),
    effortByScope,
    sitemapFingerprint: input.fingerprint,
    diagnostics: input.diagnostics,
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
    trackerSources(input.nativeRecords, input.fingerprint),
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
    maps: native.maps,
    tickets: native.tickets,
    diagnostics: diagnosticProjection.diagnostics,
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
  const effortScopeTrust = new Map<string, "known" | "untrustworthy">();
  for (const record of input.decoded.records) {
    if (record.type !== "effort") continue;
    const scope = scopeFor(record.locator);
    if (scope === undefined) continue;
    const trust = record.data?.Type === "effort" ? "known" : "untrustworthy";
    if (effortScopeTrust.get(scope) !== "known") effortScopeTrust.set(scope, trust);
  }
  const sourceForLocator = new Map(
    sources
      .filter((source) => source.kind === "tracker")
      .map((source) => [source.displayLocator, source.reference]),
  );
  const globalNativeIssues: PlanningGraphIssue[] = input.nativeRecords.flatMap((record) => {
    const scope = record.native?.scope;
    if (scope === undefined || effortScopeTrust.get(scope) !== "untrustworthy") return [];
    return [
      relationIssue(
        "unscopable-native-work",
        record.locator,
        "Native work belongs to a scope whose Effort relation is unavailable.",
        sourceForLocator.get(record.locator),
      ),
    ];
  });
  const nativeLocators = new Set(input.nativeRecords.map((record) => record.locator));
  for (const diagnostic of input.diagnostics) {
    const scope = scopeFor(diagnostic.target);
    const unscopable =
      (scope !== undefined &&
        effortScopeTrust.get(scope) === "untrustworthy" &&
        nativeLocators.has(diagnostic.target)) ||
      (scope === undefined && TRACKER_NATIVE_DIAGNOSTIC_CODES.has(diagnostic.code));
    if (!unscopable) continue;
    globalNativeIssues.push(
      relationIssue(
        diagnostic.code,
        diagnostic.target,
        diagnostic.message,
        sourceForLocator.get(diagnostic.target),
      ),
    );
  }
  return new ImmutablePlanningGraph(
    input.fingerprint,
    {
      roadmaps: overlayNormalizedItems(governance.roadmaps, planningProjection.roadmaps),
      gates: overlayNormalizedItems(governance.gates, planningProjection.gates),
      efforts: overlayNormalizedItems(governance.efforts, planningProjection.efforts),
      authorities: governance.authorities,
      assets: assets.assets,
      checks: decisions.checks,
      maps: native.maps,
      tickets: native.tickets,
    },
    planningProjection,
    sources,
    knownKinds,
    knownSources,
    checkTargetBySource,
    assetOwnersBySource,
    stableIssues(globalNativeIssues),
    input.instrumentation,
  );
};
