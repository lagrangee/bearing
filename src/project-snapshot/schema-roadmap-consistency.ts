import type { RefinementCtx } from "zod";

type Collection<T> =
  | Readonly<{ validity: "available" | "partial"; items: readonly T[] }>
  | Readonly<{ validity: "invalid" }>;

type Roadmap = Readonly<{
  id: string;
  lifecycle: "active" | "completed" | "superseded";
  focusedGateId: string | null;
  gateOrder: readonly string[];
  effortIds: readonly string[];
}>;

type Gate = Readonly<{
  id: string;
  roadmapId: string;
  lifecycle: "planned" | "active" | "passed" | "superseded";
  effortIds: readonly string[];
}>;

type Effort = Readonly<{
  id: string;
  roadmapId: string;
  targetGateId: string;
}>;

export type RoadmapConsistencySnapshot = Readonly<{
  roadmaps: Collection<Roadmap>;
  gates: Collection<Gate>;
  efforts: Collection<Effort>;
}>;

const trusted = <T>(collection: Collection<T>): readonly T[] =>
  collection.validity === "invalid" ? [] : collection.items;

const complete = <T>(collection: Collection<T>): boolean => collection.validity === "available";

const byId = <T>(values: readonly T[], key: (item: T) => string): Map<string, T> =>
  new Map(values.map((item) => [key(item), item]));

const sameSet = (actual: readonly string[], expected: readonly string[]): boolean => {
  const expectedSet = new Set(expected);
  return actual.length === expectedSet.size && actual.every((value) => expectedSet.has(value));
};

const coversRetained = (actual: readonly string[], expected: readonly string[]): boolean => {
  const actualSet = new Set(actual);
  return expected.every((value) => actualSet.has(value));
};

const validRelationSet = <T>(
  collection: Collection<T>,
  actual: readonly string[],
  retained: readonly string[],
): boolean => (complete(collection) ? sameSet(actual, retained) : coversRetained(actual, retained));

const addIssue = (context: RefinementCtx, path: readonly (string | number)[], message: string) =>
  context.addIssue({ code: "custom", path: [...path], message });

const validateRoadmaps = (snapshot: RoadmapConsistencySnapshot, context: RefinementCtx): void => {
  const gates = trusted(snapshot.gates);
  const gateIndex = byId(gates, (gate) => gate.id);
  const efforts = trusted(snapshot.efforts);
  const effortIndex = byId(efforts, (effort) => effort.id);
  for (const [position, roadmap] of trusted(snapshot.roadmaps).entries()) {
    if (roadmap.lifecycle !== "active" && roadmap.focusedGateId !== null) {
      addIssue(
        context,
        ["roadmaps", "items", position, "focusedGateId"],
        "A completed or superseded Roadmap must clear its focused Gate.",
      );
    }
    if (roadmap.focusedGateId !== null) {
      const focusedGate = gateIndex.get(roadmap.focusedGateId);
      if (focusedGate !== undefined && focusedGate.lifecycle !== "active") {
        addIssue(
          context,
          ["roadmaps", "items", position, "focusedGateId"],
          "A trustworthy focused Gate must be active.",
        );
      }
    }
    for (const [gatePosition, gateId] of roadmap.gateOrder.entries()) {
      const gate = gateIndex.get(gateId);
      if (gate !== undefined && gate.roadmapId !== roadmap.id) {
        addIssue(
          context,
          ["roadmaps", "items", position, "gateOrder", gatePosition],
          "A Roadmap Gate relation must preserve canonical ownership.",
        );
      }
    }
    const ownedGateIds = gates
      .filter((gate) => gate.roadmapId === roadmap.id)
      .map((gate) => gate.id);
    if (!validRelationSet(snapshot.gates, roadmap.gateOrder, ownedGateIds)) {
      addIssue(
        context,
        ["roadmaps", "items", position, "gateOrder"],
        "Roadmap Gate order must cover retained owned Gates and be exact when available.",
      );
    }
    for (const [effortPosition, effortId] of roadmap.effortIds.entries()) {
      const effort = effortIndex.get(effortId);
      if (effort !== undefined && effort.roadmapId !== roadmap.id) {
        addIssue(
          context,
          ["roadmaps", "items", position, "effortIds", effortPosition],
          "A Roadmap Effort relation must preserve canonical ownership.",
        );
      }
    }
    const ownedEffortIds = efforts
      .filter((effort) => effort.roadmapId === roadmap.id)
      .map((effort) => effort.id);
    if (!validRelationSet(snapshot.efforts, roadmap.effortIds, ownedEffortIds)) {
      addIssue(
        context,
        ["roadmaps", "items", position, "effortIds"],
        "Roadmap Efforts must cover retained owned Efforts and be exact when available.",
      );
    }
  }
};

const validateGates = (snapshot: RoadmapConsistencySnapshot, context: RefinementCtx): void => {
  const roadmaps = byId(trusted(snapshot.roadmaps), (roadmap) => roadmap.id);
  const efforts = trusted(snapshot.efforts);
  const effortIndex = byId(efforts, (effort) => effort.id);
  for (const [position, gate] of trusted(snapshot.gates).entries()) {
    const roadmap = roadmaps.get(gate.roadmapId);
    if (roadmap === undefined && complete(snapshot.roadmaps)) {
      addIssue(context, ["gates", "items", position, "roadmapId"], "A Gate owner must resolve.");
    }
    for (const [effortPosition, effortId] of gate.effortIds.entries()) {
      const effort = effortIndex.get(effortId);
      if (
        effort !== undefined &&
        (effort.targetGateId !== gate.id || effort.roadmapId !== gate.roadmapId)
      ) {
        addIssue(
          context,
          ["gates", "items", position, "effortIds", effortPosition],
          "A Gate Effort relation must preserve Target Gate and Roadmap ownership.",
        );
      }
    }
    const targetEffortIds = efforts
      .filter((effort) => effort.targetGateId === gate.id)
      .map((effort) => effort.id);
    if (!validRelationSet(snapshot.efforts, gate.effortIds, targetEffortIds)) {
      addIssue(
        context,
        ["gates", "items", position, "effortIds"],
        "Gate Efforts must cover retained Target Gate Efforts and be exact when available.",
      );
    }
  }
};

const validateEfforts = (snapshot: RoadmapConsistencySnapshot, context: RefinementCtx): void => {
  const roadmaps = byId(trusted(snapshot.roadmaps), (roadmap) => roadmap.id);
  const gates = byId(trusted(snapshot.gates), (gate) => gate.id);
  for (const [position, effort] of trusted(snapshot.efforts).entries()) {
    const roadmap = roadmaps.get(effort.roadmapId);
    const gate = gates.get(effort.targetGateId);
    if (roadmap === undefined && complete(snapshot.roadmaps)) {
      addIssue(
        context,
        ["efforts", "items", position, "roadmapId"],
        "An Effort Roadmap must resolve.",
      );
    }
    if (gate === undefined && complete(snapshot.gates)) {
      addIssue(
        context,
        ["efforts", "items", position, "targetGateId"],
        "An Effort Target Gate must resolve.",
      );
    } else if (gate !== undefined && gate.roadmapId !== effort.roadmapId) {
      addIssue(
        context,
        ["efforts", "items", position, "targetGateId"],
        "An Effort Target Gate must belong to the Effort Roadmap.",
      );
    }
  }
};

export const validateRoadmapConsistency = (
  snapshot: RoadmapConsistencySnapshot,
  context: RefinementCtx,
): void => {
  validateRoadmaps(snapshot, context);
  validateGates(snapshot, context);
  validateEfforts(snapshot, context);
};
