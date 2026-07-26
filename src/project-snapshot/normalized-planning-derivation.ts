import type {
  CollectionProjection,
  Effort,
  MapProjection,
  MilestoneGate,
  Roadmap,
  SnapshotDiagnostic,
  SourceRecord,
  TicketProjection,
} from "./contract";
import { assessScopedProjectionIssues, isValueAttributedToEffort } from "./scoped-native-relations";

type Issue = Readonly<{ code: string; target: string; source?: string | undefined }>;
export type DerivedCollection<T> =
  | Readonly<{ validity: "available"; items: readonly T[] }>
  | Readonly<{ validity: "partial"; items: readonly T[]; issues?: readonly Issue[] }>
  | Readonly<{ validity: "invalid"; issues?: readonly Issue[] }>;
export type DerivedRoadmap = Readonly<{
  id: string;
  lifecycle: "active" | "completed" | "superseded";
  focusedGateId: string | null;
  gateOrder: readonly string[];
  horizon: "active-horizon" | "exhausted" | "unknown";
}>;
export type DerivedGate = Readonly<{
  id: string;
  source: string;
  roadmapId: string;
  lifecycle: "planned" | "active" | "passed" | "superseded";
  readiness: "unknown" | "not-ready" | "ready-for-review";
  horizonState: "passed" | "focused" | "planned" | "superseded" | "unknown";
  effortIds: readonly string[];
}>;
export type DerivedEffort = Readonly<{
  id: string;
  source: string;
  roadmapId: string;
  targetGateId: string;
  workBinding?: Readonly<{ nativeScope: string }> | undefined;
  derivedState: "active" | "resolved" | "unknown";
}>;
type DerivedMap = Readonly<{
  effortId?: string | undefined;
  state: "active" | "resolved" | "unknown";
  fogCount: number;
}>;
type DerivedTicket = Readonly<{
  effortId?: string | undefined;
  state: "claimed" | "ready" | "blocked" | "resolved" | "triage";
}>;
export type DerivedDiagnostic = Readonly<{
  impact: "blocking" | "non-blocking";
  target: string;
  source?: string | undefined;
}>;
export type DerivedSource = Readonly<{ reference: string; displayLocator: string }>;
export type NormalizedPlanningTruth = Readonly<{
  roadmaps: DerivedCollection<DerivedRoadmap>;
  gates: DerivedCollection<DerivedGate>;
  efforts: DerivedCollection<DerivedEffort>;
  maps: DerivedCollection<DerivedMap>;
  tickets: DerivedCollection<DerivedTicket>;
  diagnostics: readonly DerivedDiagnostic[];
  sources: readonly DerivedSource[];
}>;

const trusted = <T>(collection: DerivedCollection<T>): readonly T[] =>
  collection.validity === "invalid" ? [] : collection.items;
const compareUtf8 = (left: string, right: string): number =>
  Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
const sourceIndex = (sources: readonly DerivedSource[]): ReadonlyMap<string, string> =>
  new Map(sources.map((source) => [source.reference, source.displayLocator]));
export const nativeProjectionUncertainForEffort = (
  collection: DerivedCollection<unknown>,
  effort: Pick<DerivedEffort, "source" | "workBinding">,
  sources: readonly DerivedSource[],
): boolean => {
  return assessScopedProjectionIssues(
    collection,
    [{ source: effort.source, nativeScope: effort.workBinding?.nativeScope }],
    sources,
    {
      unscopableIsUncertain: false,
    },
  ).uncertain;
};

export const blockingDiagnosticForEffort = (
  effort: DerivedEffort,
  diagnostics: readonly DerivedDiagnostic[],
  sources: readonly DerivedSource[],
): boolean => {
  return diagnostics.some(
    (diagnostic) =>
      diagnostic.impact === "blocking" &&
      isValueAttributedToEffort(
        diagnostic,
        { source: effort.source, nativeScope: effort.workBinding?.nativeScope },
        sources,
      ),
  );
};

export const normalizedEffortState = (
  effort: DerivedEffort,
  truth: Pick<NormalizedPlanningTruth, "maps" | "tickets" | "diagnostics" | "sources">,
): DerivedEffort["derivedState"] => {
  const uncertain =
    nativeProjectionUncertainForEffort(truth.maps, effort, truth.sources) ||
    nativeProjectionUncertainForEffort(truth.tickets, effort, truth.sources) ||
    blockingDiagnosticForEffort(effort, truth.diagnostics, truth.sources);
  if (uncertain) return "unknown";
  const maps = trusted(truth.maps).filter((map) => map.effortId === effort.id);
  const tickets = trusted(truth.tickets).filter((ticket) => ticket.effortId === effort.id);
  if (maps.length + tickets.length === 0) return "unknown";
  return maps.every((map) => map.state === "resolved" && map.fogCount === 0) &&
    tickets.every((ticket) => ticket.state === "resolved")
    ? "resolved"
    : "active";
};

const diagnosticForSource = (
  source: string,
  diagnostics: readonly DerivedDiagnostic[],
  sources: readonly DerivedSource[],
): boolean => {
  const index = sourceIndex(sources);
  const locator = index.get(source);
  return diagnostics.some(
    (diagnostic) =>
      diagnostic.impact === "blocking" &&
      (diagnostic.source === source ||
        (locator !== undefined &&
          (diagnostic.target === locator || diagnostic.target.startsWith(`${locator}#`)))),
  );
};

export const normalizedGateReadiness = (
  gate: DerivedGate,
  truth: Pick<
    NormalizedPlanningTruth,
    "gates" | "efforts" | "maps" | "tickets" | "diagnostics" | "sources"
  >,
): DerivedGate["readiness"] => {
  if (
    gate.effortIds.length === 0 ||
    (truth.gates.validity === "partial" &&
      truth.gates.issues?.some(
        (issue) => issue.code === "untrusted-effort-contributor" && issue.target === gate.id,
      )) ||
    diagnosticForSource(gate.source, truth.diagnostics, truth.sources)
  )
    return "unknown";
  const efforts = new Map(trusted(truth.efforts).map((effort) => [effort.id, effort]));
  const states: DerivedEffort["derivedState"][] = [];
  for (const effortId of gate.effortIds) {
    const effort = efforts.get(effortId);
    if (
      effort === undefined ||
      effort.targetGateId !== gate.id ||
      effort.roadmapId !== gate.roadmapId
    )
      return "unknown";
    states.push(normalizedEffortState(effort, truth));
  }
  if (states.some((state) => state === "unknown")) return "unknown";
  return states.every((state) => state === "resolved") ? "ready-for-review" : "not-ready";
};

export const normalizedRoadmapHorizon = (
  roadmap: DerivedRoadmap,
  gates: DerivedCollection<DerivedGate>,
): DerivedRoadmap["horizon"] => {
  if (roadmap.lifecycle !== "active") return "exhausted";
  const gateIndex = new Map(trusted(gates).map((gate) => [gate.id, gate]));
  if (roadmap.focusedGateId !== null) {
    const gate = gateIndex.get(roadmap.focusedGateId);
    return gate?.roadmapId === roadmap.id ? "active-horizon" : "unknown";
  }
  if (roadmap.gateOrder.length === 0) return "unknown";
  return roadmap.gateOrder.every((gateId) => {
    const gate = gateIndex.get(gateId);
    return (
      gate?.roadmapId === roadmap.id &&
      (gate.lifecycle === "passed" || gate.lifecycle === "superseded")
    );
  })
    ? "exhausted"
    : "unknown";
};

export const normalizedGateHorizon = (
  gate: DerivedGate,
  roadmaps: DerivedCollection<DerivedRoadmap>,
): DerivedGate["horizonState"] => {
  if (gate.lifecycle === "passed" || gate.lifecycle === "superseded") return gate.lifecycle;
  if (gate.lifecycle === "planned") return "planned";
  const roadmap = trusted(roadmaps).find((candidate) => candidate.id === gate.roadmapId);
  return roadmap?.focusedGateId === gate.id ? "focused" : "unknown";
};

const mapCollection = <T>(
  collection: CollectionProjection<T>,
  update: (item: T) => T,
): CollectionProjection<T> => {
  if (collection.validity === "invalid") return collection;
  const items = collection.items.map(update);
  return collection.validity === "available"
    ? { validity: "available", items }
    : { validity: "partial", items, issues: collection.issues };
};

type ProjectionInput = Readonly<{
  roadmaps: CollectionProjection<Roadmap>;
  gates: CollectionProjection<MilestoneGate>;
  efforts: CollectionProjection<Effort>;
  maps: CollectionProjection<MapProjection>;
  tickets: CollectionProjection<TicketProjection>;
  diagnostics: readonly SnapshotDiagnostic[];
  sources: readonly SourceRecord[];
}>;

type NormalizedPlanningProjection = Readonly<{
  roadmaps: CollectionProjection<Roadmap>;
  gates: CollectionProjection<MilestoneGate>;
  efforts: CollectionProjection<Effort>;
}>;

const effortFrontier = (
  effort: Effort,
  maps: CollectionProjection<MapProjection>,
  tickets: CollectionProjection<TicketProjection>,
): Effort["frontier"] => {
  const scopedMaps = trusted(maps).filter((map) => map.effortId === effort.id);
  const scopedTickets = trusted(tickets).filter((ticket) => ticket.effortId === effort.id);
  const referencesIn = (state: TicketProjection["state"]): Effort["frontier"]["claimed"] =>
    scopedTickets
      .filter((ticket) => ticket.state === state)
      .map((ticket) => ticket.reference)
      .sort(compareUtf8);
  return {
    claimed: referencesIn("claimed"),
    ready: referencesIn("ready"),
    blocked: referencesIn("blocked"),
    resolved: referencesIn("resolved"),
    fogCount: scopedMaps.reduce((total, map) => total + map.fogCount, 0),
  };
};

const effortIdsFor = (
  efforts: CollectionProjection<Effort>,
  matches: (effort: Effort) => boolean,
): readonly Effort["id"][] =>
  trusted(efforts)
    .filter(matches)
    .map((effort) => effort.id)
    .sort(compareUtf8);

export const normalizePlanningDerivations = (
  input: ProjectionInput,
): NormalizedPlanningProjection => {
  const efforts = mapCollection<Effort>(input.efforts, (effort) => ({
    ...effort,
    derivedState: normalizedEffortState(effort, input),
    frontier: effortFrontier(effort, input.maps, input.tickets),
  }));
  const roadmaps = mapCollection<Roadmap>(input.roadmaps, (roadmap) => ({
    ...roadmap,
    horizon: normalizedRoadmapHorizon(roadmap, input.gates),
    effortIds: effortIdsFor(efforts, (effort) => effort.roadmapId === roadmap.id),
  }));
  const gatesWithRelations = mapCollection<MilestoneGate>(input.gates, (gate) => ({
    ...gate,
    horizonState: normalizedGateHorizon(gate, roadmaps),
    effortIds: effortIdsFor(efforts, (effort) => effort.targetGateId === gate.id),
  }));
  const gates = mapCollection<MilestoneGate>(gatesWithRelations, (gate) => ({
    ...gate,
    readiness: normalizedGateReadiness(gate, {
      ...input,
      efforts,
      gates: gatesWithRelations,
    }),
  }));
  return { roadmaps, gates, efforts };
};
