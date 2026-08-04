import type {
  MilestoneGate,
  ProjectSnapshot,
  Roadmap,
  SourceRecord,
} from "../project-snapshot/contract";

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
