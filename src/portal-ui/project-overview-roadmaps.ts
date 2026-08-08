import type {
  MilestoneGate,
  ProjectionIssue,
  Roadmap,
  SourceRecord,
} from "../project-generation/contract";
import type { OverviewModelData } from "./project-data";

export type OverviewRoadmap = Readonly<{
  roadmap: Roadmap;
  source: SourceRecord | undefined;
  gates: readonly Readonly<{
    gate: MilestoneGate;
    ordinal: number;
    source: SourceRecord | undefined;
  }>[];
  missingGateIds: readonly string[];
}>;

export type OverviewRoadmaps =
  | Readonly<{
      state: "available";
      activeCount: number;
      items: readonly OverviewRoadmap[];
      missingRoadmapIds: readonly string[];
    }>
  | Readonly<{
      state: "partial";
      activeCount: number;
      items: readonly OverviewRoadmap[];
      missingRoadmapIds: readonly string[];
      issues: readonly ProjectionIssue[];
    }>
  | Readonly<{
      state: "absent";
      activeCount: 0;
      items: readonly [];
      missingRoadmapIds: readonly [];
    }>
  | Readonly<{
      state: "invalid";
      activeCount: undefined;
      items: readonly [];
      missingRoadmapIds: readonly [];
      issues: readonly ProjectionIssue[];
    }>;

const indexBy = <Item>(items: readonly Item[], key: (item: Item) => string): Map<string, Item> => {
  const index = new Map<string, Item>();
  for (const item of items) index.set(key(item), item);
  return index;
};

const gateItems = (snapshot: OverviewModelData): readonly MilestoneGate[] =>
  snapshot.gates.validity === "invalid" ? [] : snapshot.gates.items;

export const buildOverviewRoadmaps = (
  snapshot: OverviewModelData,
  sources: ReadonlyMap<string, SourceRecord>,
): OverviewRoadmaps => {
  if (snapshot.roadmapIndex.validity === "absent") {
    return { state: "absent", activeCount: 0, items: [], missingRoadmapIds: [] };
  }
  if (snapshot.roadmapIndex.validity === "invalid" || snapshot.roadmaps.validity === "invalid") {
    const issues = [
      ...(snapshot.roadmapIndex.validity === "invalid" ? snapshot.roadmapIndex.issues : []),
      ...(snapshot.roadmaps.validity === "invalid" ? snapshot.roadmaps.issues : []),
    ];
    return {
      state: "invalid",
      activeCount: undefined,
      items: [],
      missingRoadmapIds: [],
      issues,
    };
  }

  const activeCount = snapshot.roadmapIndex.value.activeRoadmapIds.length;
  const roadmaps = indexBy(snapshot.roadmaps.items, (roadmap) => roadmap.id);
  const gates = indexBy(gateItems(snapshot), (gate) => gate.id);
  const items: OverviewRoadmap[] = [];
  const missingRoadmapIds: string[] = [];
  let missingGateCount = 0;
  for (const roadmapId of snapshot.roadmapIndex.value.activeRoadmapIds) {
    const roadmap = roadmaps.get(roadmapId);
    if (roadmap === undefined) {
      missingRoadmapIds.push(roadmapId);
      continue;
    }
    const orderedGates: OverviewRoadmap["gates"][number][] = [];
    const missingGateIds: string[] = [];
    for (const [index, gateId] of roadmap.gateOrder.entries()) {
      const gate = gates.get(gateId);
      if (gate === undefined) {
        missingGateIds.push(gateId);
        missingGateCount += 1;
      } else {
        orderedGates.push({ gate, ordinal: index + 1, source: sources.get(gate.source) });
      }
    }
    items.push({
      roadmap,
      source: sources.get(roadmap.source),
      gates: orderedGates,
      missingGateIds,
    });
  }

  const projectionIssues = [
    ...(snapshot.roadmapIndex.validity === "partial" ? snapshot.roadmapIndex.issues : []),
    ...(snapshot.roadmaps.validity === "partial" ? snapshot.roadmaps.issues : []),
    ...(snapshot.gates.validity === "partial" ? snapshot.gates.issues : []),
  ];
  const relationIssueCount = missingRoadmapIds.length + missingGateCount;
  if (projectionIssues.length === 0 && relationIssueCount === 0) {
    return { state: "available", activeCount, items, missingRoadmapIds };
  }
  const relationIssues: ProjectionIssue[] =
    relationIssueCount === 0
      ? []
      : [
          {
            code: "unresolved-roadmap-horizon",
            target: "roadmap-index",
            message: `${relationIssueCount} typed Roadmap relation(s) could not be resolved.`,
          },
        ];
  return {
    state: "partial",
    activeCount,
    items,
    missingRoadmapIds,
    issues: [...projectionIssues, ...relationIssues],
  };
};
