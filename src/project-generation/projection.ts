import { mattNativeScopeKey } from "../providers/matt-skills-v1/native-subject";
import { buildAdvisoryProjection } from "./advisory";
import { collectAssetDirectEvidence } from "./asset-direct-evidence";
import { rebuildAssetReverseRelations } from "./asset-reverse-relations";
import { buildAssetProjection } from "./assets";
import type { ProjectGeneration } from "./contract";
import { buildDecisionProjection } from "./decisions";
import { buildGenerationDiagnostics } from "./diagnostic-projection";
import { buildGovernanceProjection } from "./governance";
import { buildRoadmapIndexProjection } from "./governance-index";
import { buildMattNativeSourceRecords } from "./native-work-sources";
import type { ProjectGenerationBuildInput } from "./projection-input";
import { PROJECT_GENERATION_VERSION, projectGenerationSchema } from "./schema";
import { mergeSourceRecords } from "./source-records";

export const buildProjectGeneration = async (
  input: ProjectGenerationBuildInput,
): Promise<ProjectGeneration> => {
  const providerObservationSelections =
    input.providerObservationSelections ??
    input.providerObservations.map((observation) => ({
      provider: observation.provider,
      nativeScope: observation.binding.nativeScope,
      observationId: observation.id,
      effectiveFreshness: observation.freshness.assessment,
      latestAttempt: null,
    }));
  const records = input.decoded.records;
  if (input.projectProjections.fingerprint !== input.basisFingerprint) {
    throw new Error("Project compilation fingerprint does not match its generation basis.");
  }
  const planning = input.projectProjections.planning;
  const governance = buildGovernanceProjection({
    records,
    basisFingerprint: input.basisFingerprint,
    diagnostics: input.diagnostics,
    providerObservations: input.providerObservations,
  });
  const roadmapIndex = buildRoadmapIndexProjection(
    {
      records,
      basisFingerprint: input.basisFingerprint,
      diagnostics: input.diagnostics,
    },
    planning.roadmaps,
  );
  const assetProjection = await buildAssetProjection({
    records,
    basisFingerprint: input.basisFingerprint,
    contentObservations: input.assetContentObservations,
  });
  const decisions = buildDecisionProjection({
    records,
    basisFingerprint: input.basisFingerprint,
  });
  const advisory = buildAdvisoryProjection({
    records,
    basisFingerprint: input.basisFingerprint,
    advisoryFreshness: input.advisoryFreshness,
    reviews: decisions.reviews,
  });
  const boundScopeKeys = new Set(
    planning.efforts.validity === "invalid"
      ? []
      : planning.efforts.items.flatMap((effort) =>
          effort.workBindingState.state !== "bound" || effort.workBinding === undefined
            ? []
            : [mattNativeScopeKey(effort.workBinding)],
        ),
  );
  const inspectableScopeKeys = new Set(
    planning.efforts.validity === "invalid"
      ? []
      : planning.efforts.items.flatMap((effort) =>
          effort.workBinding === undefined ||
          (effort.workBindingState.state === "invalid" &&
            effort.workBindingState.reason !== "unresolved")
            ? []
            : [mattNativeScopeKey(effort.workBinding)],
        ),
  );
  const lineageObservationByScope = new Map(
    [
      ...(input.providerDetailEvidenceObservations ?? []).filter((observation) =>
        boundScopeKeys.has(mattNativeScopeKey(observation.binding)),
      ),
      ...input.providerObservations,
    ].map((observation) => [mattNativeScopeKey(observation.binding), observation]),
  );
  const sources = mergeSourceRecords([
    governance.sources,
    assetProjection.sources,
    decisions.sources,
    advisory.sources,
    buildMattNativeSourceRecords([...lineageObservationByScope.values()], input.basisFingerprint),
  ]);
  const diagnosticProjection = buildGenerationDiagnostics({
    basisFingerprint: input.basisFingerprint,
    managedTargets: [
      ...(assetProjection.assets.validity === "invalid"
        ? []
        : assetProjection.assets.items.map((asset) => asset.id)),
      ...(planning.efforts.validity === "invalid"
        ? []
        : planning.efforts.items.flatMap((effort) =>
            effort.workBindingState.state !== "bound" || effort.workBinding === undefined
              ? []
              : [effort.workBinding.nativeScope],
          )),
      ...sources.flatMap((source) =>
        source.kind === "tracker" && source.binding !== undefined ? [source.displayLocator] : [],
      ),
    ],
    diagnostics: input.diagnostics,
    sourceLocators: sources.map((source) => ({
      kind: source.kind,
      locator: source.displayLocator,
      ...(source.fragment === undefined ? {} : { fragment: source.fragment }),
      ...(source.binding === undefined ? {} : { binding: source.binding }),
    })),
  });
  const assets = rebuildAssetReverseRelations(assetProjection.assets, {
    roadmaps: planning.roadmaps,
    gates: planning.gates,
    efforts: planning.efforts,
    authorities: governance.authorities,
    reviews: decisions.reviews,
    directEvidence: collectAssetDirectEvidence(records),
  });
  return projectGenerationSchema.parse({
    schemaVersion: PROJECT_GENERATION_VERSION,
    producer: { packageVersion: input.packageVersion },
    basis: { generationVersion: 1, basisFingerprint: input.basisFingerprint },
    summary: governance.summary,
    brief: governance.brief,
    roadmapIndex,
    roadmaps: planning.roadmaps,
    gates: planning.gates,
    efforts: planning.efforts,
    authorities: governance.authorities,
    assets,
    reviews: decisions.reviews,
    lineage: input.projectProjections.lineage,
    audit: advisory.audit,
    providerObservations: input.providerObservations,
    providerObservationSelections,
    providerDetailEvidences: {
      observations: (input.providerDetailEvidenceObservations ?? []).filter((observation) =>
        inspectableScopeKeys.has(mattNativeScopeKey(observation.binding)),
      ),
      selections: (input.providerDetailEvidenceSelections ?? []).filter((selection) =>
        inspectableScopeKeys.has(mattNativeScopeKey(selection)),
      ),
    },
    diagnostics: diagnosticProjection.diagnostics,
    attention: [...diagnosticProjection.attention, ...decisions.attention],
    sources,
  });
};
