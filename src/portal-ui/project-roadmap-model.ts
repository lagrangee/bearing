import type {
  AssetProjection,
  Effort,
  MapProjection,
  MilestoneGate,
  ProjectSnapshot,
  Roadmap,
  SourceRecord,
  TicketProjection,
} from "../project-snapshot/contract";
import { nativeProjectionUncertainForEffort } from "../project-snapshot/schema-native-scope-consistency";
import {
  assessScopedMapIssues,
  collectRoadmapEvidenceIds,
  hasScopedGateIssue,
} from "./project-roadmap-relations";

export type RoadmapGateModel = Readonly<{
  gate: MilestoneGate;
  ordinal: number;
  source: SourceRecord | undefined;
}>;

export type RoadmapSummaryModel = Readonly<{
  roadmap: Roadmap;
  source: SourceRecord | undefined;
  gates: readonly RoadmapGateModel[];
  missingGateIds: readonly string[];
}>;

export type RoadmapIndexGroup = Readonly<{
  lifecycle: Roadmap["lifecycle"];
  items: readonly RoadmapSummaryModel[];
  missingRoadmapIds: readonly string[];
}>;

export type RoadmapIndexModel =
  | Readonly<{ state: "available" | "partial"; groups: readonly RoadmapIndexGroup[] }>
  | Readonly<{ state: "absent"; groups: readonly [] }>
  | Readonly<{ state: "invalid"; groups: readonly []; issueCount: number }>;

type Frontier = Readonly<{
  claimed: readonly TicketProjection[];
  ready: readonly TicketProjection[];
  blocked: readonly TicketProjection[];
  resolved: readonly TicketProjection[];
}>;

export type RoadmapEffortModel = Readonly<{
  effort: Effort;
  source: SourceRecord | undefined;
  targetGate: MilestoneGate | undefined;
  maps: readonly MapProjection[];
  frontier: Frontier;
  missingFrontierReferences: readonly string[];
}>;

export type RoadmapEvidenceModel = Readonly<{
  asset: AssetProjection;
  source: SourceRecord | undefined;
}>;

type RoadmapDetail = Readonly<{
  roadmap: Roadmap;
  source: SourceRecord | undefined;
  gates: readonly RoadmapGateModel[];
  focusedGate: RoadmapGateModel | undefined;
  efforts: readonly RoadmapEffortModel[];
  evidence: readonly RoadmapEvidenceModel[];
  missingGateIds: readonly string[];
  missingEffortIds: readonly string[];
  missingEvidenceAssetIds: readonly string[];
  missingMapRelationCount: number;
}>;

export type RoadmapDetailModel =
  | (RoadmapDetail & Readonly<{ state: "available" }>)
  | (RoadmapDetail & Readonly<{ state: "partial" }>)
  | Readonly<{ state: "missing" }>
  | Readonly<{ state: "invalid"; issueCount: number }>;

const items = <Item>(
  projection:
    | Readonly<{ validity: "available" | "partial"; items: readonly Item[] }>
    | Readonly<{ validity: "invalid" }>,
): readonly Item[] => (projection.validity === "invalid" ? [] : projection.items);

const indexBy = <Item>(values: readonly Item[], key: (item: Item) => string): Map<string, Item> =>
  new Map(values.map((item) => [key(item), item]));

const sourcesFor = (snapshot: ProjectSnapshot): ReadonlyMap<string, SourceRecord> =>
  indexBy(snapshot.sources, (source) => source.reference);

const gateSummary = (
  roadmap: Roadmap,
  gates: ReadonlyMap<string, MilestoneGate>,
  sources: ReadonlyMap<string, SourceRecord>,
): RoadmapSummaryModel => {
  const ordered: RoadmapGateModel[] = [];
  const missingGateIds: string[] = [];
  for (const [index, gateId] of roadmap.gateOrder.entries()) {
    const gate = gates.get(gateId);
    if (gate === undefined) missingGateIds.push(gateId);
    else ordered.push({ gate, ordinal: index + 1, source: sources.get(gate.source) });
  }
  return {
    roadmap,
    source: sources.get(roadmap.source),
    gates: ordered,
    missingGateIds,
  };
};

export const buildRoadmapIndexModel = (snapshot: ProjectSnapshot): RoadmapIndexModel => {
  if (snapshot.roadmapIndex.validity === "absent") return { state: "absent", groups: [] };
  if (snapshot.roadmapIndex.validity === "invalid" || snapshot.roadmaps.validity === "invalid") {
    const issueCount =
      (snapshot.roadmapIndex.validity === "invalid" ? snapshot.roadmapIndex.issues.length : 0) +
      (snapshot.roadmaps.validity === "invalid" ? snapshot.roadmaps.issues.length : 0);
    return { state: "invalid", groups: [], issueCount };
  }
  const sources = sourcesFor(snapshot);
  const roadmaps = indexBy(snapshot.roadmaps.items, (roadmap) => roadmap.id);
  const gates = indexBy(items(snapshot.gates), (gate) => gate.id);
  const index = snapshot.roadmapIndex.value;
  const definitions = [
    ["active", index.activeRoadmapIds],
    ["completed", index.completedRoadmapIds],
    ["superseded", index.supersededRoadmapIds],
  ] as const;
  const groups = definitions.map(([lifecycle, roadmapIds]): RoadmapIndexGroup => {
    const found: RoadmapSummaryModel[] = [];
    const missingRoadmapIds: string[] = [];
    for (const roadmapId of roadmapIds) {
      const roadmap = roadmaps.get(roadmapId);
      if (roadmap === undefined) missingRoadmapIds.push(roadmapId);
      else found.push(gateSummary(roadmap, gates, sources));
    }
    return { lifecycle, items: found, missingRoadmapIds };
  });
  const incomplete = groups.some(
    (group) =>
      group.missingRoadmapIds.length > 0 ||
      group.items.some((item) => item.missingGateIds.length > 0),
  );
  return {
    state: snapshot.roadmapIndex.validity === "partial" || incomplete ? "partial" : "available",
    groups,
  };
};

const frontierFor = (
  effort: Effort,
  tickets: ReadonlyMap<string, TicketProjection>,
): Readonly<{ frontier: Frontier; missing: readonly string[] }> => {
  const missing: string[] = [];
  const lane = (references: readonly string[]): TicketProjection[] =>
    references.flatMap((reference) => {
      const ticket = tickets.get(reference);
      if (ticket === undefined) missing.push(reference);
      return ticket === undefined ? [] : [ticket];
    });
  return {
    frontier: {
      claimed: lane(effort.frontier.claimed),
      ready: lane(effort.frontier.ready),
      blocked: lane(effort.frontier.blocked),
      resolved: lane(effort.frontier.resolved),
    },
    missing,
  };
};

export const buildRoadmapDetailModel = (
  snapshot: ProjectSnapshot,
  roadmapId: string,
): RoadmapDetailModel => {
  if (snapshot.roadmaps.validity === "invalid") {
    return { state: "invalid", issueCount: snapshot.roadmaps.issues.length };
  }
  const roadmap = snapshot.roadmaps.items.find((candidate) => candidate.id === roadmapId);
  if (roadmap === undefined) return { state: "missing" };
  const sources = sourcesFor(snapshot);
  const gateIndex = indexBy(items(snapshot.gates), (gate) => gate.id);
  const summary = gateSummary(roadmap, gateIndex, sources);
  const effortIndex = indexBy(items(snapshot.efforts), (effort) => effort.id);
  const mapItems = items(snapshot.maps);
  const ticketIndex = indexBy(items(snapshot.tickets), (ticket) => ticket.reference);
  const efforts: RoadmapEffortModel[] = [];
  const missingEffortIds: string[] = [];
  let missingFrontierCount = 0;
  for (const effortId of roadmap.effortIds) {
    const effort = effortIndex.get(effortId);
    if (effort === undefined) {
      missingEffortIds.push(effortId);
      continue;
    }
    const resolved = frontierFor(effort, ticketIndex);
    missingFrontierCount += resolved.missing.length;
    efforts.push({
      effort,
      source: sources.get(effort.source),
      targetGate: gateIndex.get(effort.targetGateId),
      maps: mapItems.filter((map) => map.effortId === effort.id),
      frontier: resolved.frontier,
      missingFrontierReferences: resolved.missing,
    });
  }
  const assetIndex = indexBy(items(snapshot.assets), (asset) => asset.id);
  const evidence: RoadmapEvidenceModel[] = [];
  const missingEvidenceAssetIds: string[] = [];
  for (const assetId of collectRoadmapEvidenceIds(
    roadmap,
    summary.gates.map((entry) => entry.gate),
    efforts.map((entry) => entry.effort),
  )) {
    const asset = assetIndex.get(assetId);
    if (asset === undefined) missingEvidenceAssetIds.push(assetId);
    else evidence.push({ asset, source: sources.get(asset.source) });
  }
  const focusedGate = summary.gates.find((entry) => entry.gate.id === roadmap.focusedGateId);
  const mapIssues = assessScopedMapIssues(
    snapshot.maps,
    efforts.map(({ effort }) => effort),
    snapshot.sources,
  );
  const hasScopedTicketIssue = efforts.some(({ effort }) =>
    nativeProjectionUncertainForEffort(snapshot.tickets, effort, snapshot.sources),
  );
  const partial =
    summary.missingGateIds.length > 0 ||
    missingEffortIds.length > 0 ||
    missingFrontierCount > 0 ||
    missingEvidenceAssetIds.length > 0 ||
    mapIssues.uncertain ||
    hasScopedGateIssue(snapshot.gates, roadmap.gateOrder) ||
    hasScopedTicketIssue ||
    (roadmap.focusedGateId !== null && focusedGate === undefined);
  return {
    state: partial ? "partial" : "available",
    roadmap,
    source: sources.get(roadmap.source),
    gates: summary.gates,
    focusedGate,
    efforts,
    evidence,
    missingGateIds: summary.missingGateIds,
    missingEffortIds,
    missingEvidenceAssetIds,
    missingMapRelationCount: mapIssues.missingRelationCount,
  };
};
