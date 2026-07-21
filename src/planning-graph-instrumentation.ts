export type PlanningGraphInstrumentationSnapshot = Readonly<{
  planningGraphBuilds: number;
  rootClosures: number;
}>;

export type PlanningGraphInstrumentation = Readonly<{
  recordBuild(): void;
  recordRootClosure(): void;
  snapshot(): PlanningGraphInstrumentationSnapshot;
}>;

export const createPlanningGraphInstrumentation = (): PlanningGraphInstrumentation => {
  let planningGraphBuilds = 0;
  let rootClosures = 0;
  return Object.freeze({
    recordBuild(): void {
      planningGraphBuilds += 1;
    },
    recordRootClosure(): void {
      rootClosures += 1;
    },
    snapshot(): PlanningGraphInstrumentationSnapshot {
      return Object.freeze({ planningGraphBuilds, rootClosures });
    },
  });
};
