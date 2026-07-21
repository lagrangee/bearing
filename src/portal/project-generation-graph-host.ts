import type { PlanningGraph } from "../planning-graph";

export type ProjectGenerationGraphAccess = Readonly<{
  current(): PlanningGraph | undefined;
  publish(graph: PlanningGraph): void;
}>;

export type ProjectGenerationGraphHost = Readonly<{
  forEntry(entryId: string): ProjectGenerationGraphAccess;
}>;

export const createProjectGenerationGraphHost = (): ProjectGenerationGraphHost => {
  const currentByEntry = new Map<string, PlanningGraph>();
  const accessByEntry = new Map<string, ProjectGenerationGraphAccess>();
  const forEntry = (entryId: string): ProjectGenerationGraphAccess => {
    const existing = accessByEntry.get(entryId);
    if (existing !== undefined) return existing;
    const access = Object.freeze({
      current: () => currentByEntry.get(entryId),
      publish: (graph: PlanningGraph): void => {
        currentByEntry.set(entryId, graph);
      },
    });
    accessByEntry.set(entryId, access);
    return access;
  };
  return Object.freeze({ forEntry });
};
