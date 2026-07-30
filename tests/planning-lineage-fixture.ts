import { rebuildAssetReverseRelations } from "../src/project-snapshot/asset-reverse-relations";
import type { ProjectSnapshot, ProjectSnapshotInput } from "../src/project-snapshot/contract";
import { normalizePlanningDerivations } from "../src/project-snapshot/normalized-planning-derivation";
import { buildPlanningLineageProjection } from "../src/project-snapshot/planning-lineage";
import { projectSnapshotSchema } from "../src/project-snapshot/schema";

export const withRebuiltPlanningLineage = (
  candidate: ProjectSnapshotInput,
): ProjectSnapshotInput => ({
  ...candidate,
  lineage: buildPlanningLineageProjection(candidate),
});

export const parseRebuiltPlanningLineageFixture = (candidate: ProjectSnapshot): ProjectSnapshot => {
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
      checks: candidate.checks,
      reviews: candidate.reviews,
    }),
  };
  return projectSnapshotSchema.parse({
    ...normalized,
    lineage: buildPlanningLineageProjection(normalized),
  });
};
