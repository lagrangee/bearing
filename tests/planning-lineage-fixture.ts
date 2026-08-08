import { rebuildAssetReverseRelations } from "../src/project-generation/asset-reverse-relations";
import type { ProjectGeneration, ProjectGenerationInput } from "../src/project-generation/contract";
import { normalizePlanningDerivations } from "../src/project-generation/normalized-planning-derivation";
import { buildPlanningLineageProjection } from "../src/project-generation/planning-lineage";
import { projectGenerationSchema } from "../src/project-generation/schema";

export const withRebuiltPlanningLineage = (
  candidate: ProjectGenerationInput,
): ProjectGenerationInput => ({
  ...candidate,
  lineage: buildPlanningLineageProjection(candidate),
});

export const parseRebuiltPlanningLineageFixture = (
  candidate: ProjectGeneration,
): ProjectGeneration => {
  const planning = normalizePlanningDerivations({
    roadmaps: candidate.roadmaps,
    gates: candidate.gates,
    efforts: candidate.efforts,
    providerObservations: candidate.providerObservations,
    providerObservationSelections: candidate.providerObservationSelections,
    diagnostics: candidate.diagnostics,
    sources: candidate.sources,
  });
  const normalized = {
    ...candidate,
    ...planning,
    assets: rebuildAssetReverseRelations(candidate.assets, {
      roadmaps: planning.roadmaps,
      gates: planning.gates,
      efforts: planning.efforts,
      authorities: candidate.authorities,
      reviews: candidate.reviews,
    }),
  };
  return projectGenerationSchema.parse({
    ...normalized,
    lineage: buildPlanningLineageProjection(normalized),
  });
};
