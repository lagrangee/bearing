import type { RefinementCtx } from "zod";
import type { PlanningLineageProjection } from "./contract";
import { buildPlanningLineageProjection, type PlanningLineageBuildInput } from "./planning-lineage";

export type PlanningLineageConsistencySnapshot = PlanningLineageBuildInput &
  Readonly<{ lineage: PlanningLineageProjection }>;

export const validatePlanningLineageConsistency = (
  snapshot: PlanningLineageConsistencySnapshot,
  context: RefinementCtx,
): void => {
  let expected: PlanningLineageProjection;
  try {
    expected = buildPlanningLineageProjection(snapshot);
  } catch {
    context.addIssue({
      code: "custom",
      path: ["lineage"],
      message:
        "Planning Lineage cannot be rebuilt from an invalid generation-scoped subject projection.",
    });
    return;
  }
  if (JSON.stringify(snapshot.lineage) === JSON.stringify(expected)) return;
  context.addIssue({
    code: "custom",
    path: ["lineage"],
    message:
      "Planning Lineage must exactly match the generation-scoped typed subjects, parent paths, semantic availability, and relations.",
  });
};
