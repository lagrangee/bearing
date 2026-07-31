import type { ProviderObservationEvidenceAssessment } from "../native-work-provider";
import type {
  AssetProjection,
  Effort,
  MilestoneGate,
  ProjectSnapshot,
  Roadmap,
  SourceRecord,
} from "../project-snapshot/contract";
import { assessSelectedProviderObservationEvidence } from "../provider-observation-contract";
import { sameMattNativeScope } from "../providers/matt-skills-v1/native-subject";
import { mattPlanningPresentation } from "../providers/matt-skills-v1/projection";
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
  claimed: readonly MattTicketView[];
  ready: readonly MattTicketView[];
  uncertain: readonly MattTicketView[];
  blocked: readonly MattTicketView[];
  resolved: readonly MattTicketView[];
}>;

export type MattMapView = Readonly<{
  reference: string;
  title: string;
  source: string;
  state: string;
  fogCount: number;
}>;
export type MattTicketView = Readonly<{
  reference: string;
  title: string;
  source: string;
  state: "claimed" | "ready" | "blocked" | "resolved";
  blockedBy: readonly string[];
}>;

export type RoadmapEffortModel = Readonly<{
  effort: Effort;
  source: SourceRecord | undefined;
  targetGate: MilestoneGate | undefined;
  maps: readonly MattMapView[];
  fogCount: number;
  frontier: Frontier;
  providerAssessment: ProviderObservationEvidenceAssessment | undefined;
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

const sourceFor = (sources: ReadonlyMap<string, SourceRecord>, identity: string): string =>
  [...sources.values()].find(
    (source) => source.kind === "tracker" && source.binding?.identity === identity,
  )?.reference ?? "";

const frontierFor = (
  snapshot: ProjectSnapshot,
  effort: Effort,
  sources: ReadonlyMap<string, SourceRecord>,
): Readonly<{
  frontier: Frontier;
  maps: readonly MattMapView[];
  missing: readonly string[];
  providerAssessment: ProviderObservationEvidenceAssessment | undefined;
}> => {
  const binding = effort.workBinding;
  const capture =
    binding === undefined
      ? undefined
      : snapshot.providerObservations.find((candidate) =>
          sameMattNativeScope(candidate.binding, binding),
        );
  const selection =
    binding === undefined
      ? undefined
      : snapshot.providerObservationSelections.find((candidate) =>
          sameMattNativeScope(candidate, binding),
        );
  const providerAssessment =
    binding === undefined
      ? undefined
      : assessSelectedProviderObservationEvidence(capture, selection);
  const bindingConflict =
    binding !== undefined &&
    items(snapshot.efforts).filter(
      (candidate) =>
        candidate.workBinding !== undefined && sameMattNativeScope(candidate.workBinding, binding),
    ).length > 1;
  if (bindingConflict) {
    return {
      frontier: { claimed: [], ready: [], uncertain: [], blocked: [], resolved: [] },
      maps: [],
      missing: [],
      providerAssessment,
    };
  }
  if (capture === undefined || (capture.state !== "available" && capture.state !== "partial")) {
    return {
      frontier: { claimed: [], ready: [], uncertain: [], blocked: [], resolved: [] },
      maps: [],
      missing: binding === undefined || capture !== undefined ? [] : [binding.nativeScope],
      providerAssessment,
    };
  }
  const presentation = mattPlanningPresentation(capture);
  const tickets: MattTicketView[] = presentation.tickets.map((ticket) => ({
    ...ticket,
    source: sourceFor(sources, ticket.reference),
  }));
  const lane = (state: MattTicketView["state"]) =>
    tickets.filter((ticket) => ticket.state === state);
  const maps: MattMapView[] = presentation.maps.map((map) => ({
    ...map,
    source: sourceFor(sources, map.reference),
  }));
  return {
    frontier: {
      claimed: providerAssessment?.frontierEvidence === "trustworthy" ? lane("claimed") : [],
      ready: providerAssessment?.frontierEvidence === "trustworthy" ? lane("ready") : [],
      uncertain:
        providerAssessment?.frontierEvidence === "withheld"
          ? [...lane("claimed"), ...lane("ready")]
          : [],
      blocked: lane("blocked"),
      resolved: lane("resolved"),
    },
    maps,
    missing: [],
    providerAssessment,
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
  const efforts: RoadmapEffortModel[] = [];
  const missingEffortIds: string[] = [];
  let missingFrontierCount = 0;
  for (const effortId of roadmap.effortIds) {
    const effort = effortIndex.get(effortId);
    if (effort === undefined) {
      missingEffortIds.push(effortId);
      continue;
    }
    const resolved = frontierFor(snapshot, effort, sources);
    missingFrontierCount += resolved.missing.length;
    efforts.push({
      effort,
      source: sources.get(effort.source),
      targetGate: gateIndex.get(effort.targetGateId),
      maps: resolved.maps,
      fogCount: resolved.maps.reduce((total, map) => total + map.fogCount, 0),
      frontier: resolved.frontier,
      providerAssessment: resolved.providerAssessment,
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
    snapshot.providerObservations,
    snapshot.providerObservationSelections,
    efforts.map(({ effort }) => effort),
    snapshot.sources,
  );
  const partial =
    summary.missingGateIds.length > 0 ||
    missingEffortIds.length > 0 ||
    missingFrontierCount > 0 ||
    missingEvidenceAssetIds.length > 0 ||
    mapIssues.uncertain ||
    hasScopedGateIssue(snapshot.gates, roadmap.gateOrder) ||
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
