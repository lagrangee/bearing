import type { AssetContentObservation } from "./asset-inputs";
import type { DecodedBearingRecordGeneration } from "./bearing-record-decoder";
import { deepFreeze } from "./immutable";
import { collectAssetDirectEvidence } from "./project-generation/asset-direct-evidence";
import { rebuildAssetReverseRelations } from "./project-generation/asset-reverse-relations";
import { buildAssetProjection } from "./project-generation/assets";
import type {
  CollectionProjection,
  Effort,
  GenerationDiagnostic,
  MilestoneGate,
  PlanningLineageProjection,
  ProjectionIssue,
  ProviderScopeObservation,
  Roadmap,
  SourceRecord,
} from "./project-generation/contract";
import { buildDecisionProjection } from "./project-generation/decisions";
import { buildGenerationDiagnostics } from "./project-generation/diagnostic-projection";
import { buildGovernanceProjection } from "./project-generation/governance";
import { buildMattNativeSourceRecords } from "./project-generation/native-work-sources";
import { normalizePlanningDerivations } from "./project-generation/normalized-planning-derivation";
import { buildPlanningLineageProjection } from "./project-generation/planning-lineage";
import { mergeSourceRecords } from "./project-generation/source-records";
import type { ProviderObservationSelection } from "./provider-evidence-contract";
import type { MattSkillsV1ProviderObservation } from "./providers/matt-skills-v1/capture";
import { mattNativeScopeKey } from "./providers/matt-skills-v1/native-subject";
import type { StructuralDiagnostic } from "./types";

export type ProjectCompilationProjectionInput = Readonly<{
  decoded: DecodedBearingRecordGeneration;
  providerObservations: readonly MattSkillsV1ProviderObservation[];
  providerObservationSelections?: readonly ProviderObservationSelection[];
  providerDetailEvidenceObservations?: readonly MattSkillsV1ProviderObservation[];
  providerDetailEvidenceSelections?: readonly ProviderObservationSelection[];
  diagnostics: readonly StructuralDiagnostic[];
  fingerprint: string;
  assetContentObservations: readonly AssetContentObservation[];
}>;

export type ProjectCompilationPlanningProjection = Readonly<{
  roadmaps: CollectionProjection<Roadmap>;
  gates: CollectionProjection<MilestoneGate>;
  efforts: CollectionProjection<Effort>;
  providerObservations: readonly ProviderScopeObservation[];
  providerObservationSelections: readonly ProviderObservationSelection[];
}>;

export type ProjectCompilationProjectionBundle = Readonly<{
  fingerprint: string;
  planning: ProjectCompilationPlanningProjection;
  lineage: PlanningLineageProjection;
}>;

type PlanningProjectionInput = ProjectCompilationPlanningProjection &
  Readonly<{
    diagnostics: readonly GenerationDiagnostic[];
    sources: readonly SourceRecord[];
  }>;

const PLANNING_RELATION_DIAGNOSTIC_CODES = new Set([
  "broken-canonical-reference",
  "roadmap-focus-outside-gate-order",
  "roadmap-focuses-non-active-gate",
  "gate-roadmap-mismatch",
  "gate-missing-from-roadmap-order",
  "effort-roadmap-gate-mismatch",
]);

const GATE_RELATION_CHAIN_BREAKING_CODES = new Set([
  "passed-gate-missing-passage",
  "open-gate-has-passage",
]);

const trusted = <T>(collection: CollectionProjection<T>): readonly T[] =>
  collection.validity === "invalid" ? [] : collection.items;

const issues = <T>(collection: CollectionProjection<T>): readonly ProjectionIssue[] =>
  collection.validity === "available" ? [] : collection.issues;

const projectionWithIsolation = <T extends { source: string }>(
  collection: CollectionProjection<T>,
  retained: readonly T[],
  removed: readonly T[],
  sourceByReference: ReadonlyMap<string, SourceRecord>,
  diagnostics: readonly GenerationDiagnostic[],
): CollectionProjection<T> => {
  if (collection.validity === "invalid") return collection;
  const relationIssues = removed.map((item): ProjectionIssue => {
    const source = sourceByReference.get(item.source);
    const diagnostic = diagnostics.find(
      (candidate) =>
        candidate.impact === "blocking" &&
        (candidate.source === item.source || candidate.target === source?.displayLocator),
    );
    if (diagnostic !== undefined) {
      return {
        code: diagnostic.code,
        target: diagnostic.target,
        message: diagnostic.message,
        ...(diagnostic.source === undefined ? {} : { source: diagnostic.source }),
      };
    }
    return {
      code: "invalid-planning-relation",
      target: source?.displayLocator ?? item.source,
      message: "Planning object is isolated because its required relation is unavailable.",
      ...(source === undefined ? {} : { source: source.reference }),
    };
  });
  const collectionIssues = collection.validity === "partial" ? collection.issues : [];
  const combined = [...collectionIssues, ...relationIssues];
  if (combined.length === 0) return { validity: "available", items: retained };
  return retained.length === 0
    ? { validity: "invalid", issues: combined }
    : { validity: "partial", items: retained, issues: combined };
};

const buildPlanningProjection = (
  input: PlanningProjectionInput,
): ProjectCompilationPlanningProjection => {
  const sourceByReference: ReadonlyMap<string, SourceRecord> = new Map(
    input.sources.map((source) => [source.reference, source]),
  );
  const hasSingleBoundSource = (role: "roadmap" | "milestone-gate", identity: string): boolean =>
    input.sources.filter(
      (source) => source.binding?.role === role && source.binding.identity === identity,
    ).length === 1;
  const unavailableGateIds = new Set(
    issues(input.gates).flatMap((issue) => {
      if (!GATE_RELATION_CHAIN_BREAKING_CODES.has(issue.code)) return [];
      const binding = sourceByReference.get(issue.source ?? "")?.binding;
      return binding?.role === "milestone-gate" ? [binding.identity] : [];
    }),
  );
  const initialRoadmaps = trusted(input.roadmaps);
  const initialGates = trusted(input.gates);
  const roadmapById = new Map(initialRoadmaps.map((roadmap) => [roadmap.id, roadmap]));
  const gateById = new Map(initialGates.map((gate) => [gate.id, gate]));
  const roadmaps = initialRoadmaps.filter((roadmap) => {
    const orderedRelationsTrustworthy = roadmap.gateOrder.every((gateId) => {
      const gate = gateById.get(gateId);
      return (
        (gate === undefined &&
          hasSingleBoundSource("milestone-gate", gateId) &&
          !unavailableGateIds.has(gateId)) ||
        gate?.roadmapId === roadmap.id
      );
    });
    if (!orderedRelationsTrustworthy || roadmap.focusedGateId === null) {
      return orderedRelationsTrustworthy;
    }
    const focused = gateById.get(roadmap.focusedGateId);
    return (
      roadmap.gateOrder.includes(roadmap.focusedGateId) &&
      ((focused === undefined &&
        hasSingleBoundSource("milestone-gate", roadmap.focusedGateId) &&
        !unavailableGateIds.has(roadmap.focusedGateId)) ||
        (focused?.roadmapId === roadmap.id && focused.lifecycle === "active"))
    );
  });
  const gates = initialGates.filter((gate) => {
    const roadmap = roadmapById.get(gate.roadmapId);
    return (
      (roadmap === undefined && hasSingleBoundSource("roadmap", gate.roadmapId)) ||
      roadmap?.gateOrder.includes(gate.id) === true
    );
  });
  const initialEfforts = trusted(input.efforts);
  const efforts = initialEfforts.filter((effort) => {
    const roadmap = roadmapById.get(effort.roadmapId);
    const gate = gateById.get(effort.targetGateId);
    return (
      ((roadmap === undefined && hasSingleBoundSource("roadmap", effort.roadmapId)) ||
        roadmap?.gateOrder.includes(effort.targetGateId) === true) &&
      ((gate === undefined && hasSingleBoundSource("milestone-gate", effort.targetGateId)) ||
        gate?.roadmapId === effort.roadmapId)
    );
  });
  const isolatedRoadmaps = projectionWithIsolation(
    input.roadmaps,
    roadmaps,
    initialRoadmaps.filter((roadmap) => !roadmaps.includes(roadmap)),
    sourceByReference,
    input.diagnostics,
  );
  const isolatedGates = projectionWithIsolation(
    input.gates,
    gates,
    initialGates.filter((gate) => !gates.includes(gate)),
    sourceByReference,
    input.diagnostics,
  );
  const isolatedEfforts = projectionWithIsolation(
    input.efforts,
    efforts,
    initialEfforts.filter((effort) => !efforts.includes(effort)),
    sourceByReference,
    input.diagnostics,
  );
  const normalized = normalizePlanningDerivations({
    roadmaps: isolatedRoadmaps,
    gates: isolatedGates,
    efforts: isolatedEfforts,
    providerObservations: input.providerObservations,
    providerObservationSelections: input.providerObservationSelections,
    diagnostics: input.diagnostics,
    sources: input.sources,
  });
  return {
    ...normalized,
    providerObservations: input.providerObservations,
    providerObservationSelections: input.providerObservationSelections,
  };
};

export const buildProjectCompilationProjections = async (
  input: ProjectCompilationProjectionInput,
): Promise<ProjectCompilationProjectionBundle> => {
  const providerObservationSelections =
    input.providerObservationSelections ??
    input.providerObservations.map((observation) => ({
      provider: observation.provider,
      nativeScope: observation.binding.nativeScope,
      observationId: observation.id,
      effectiveFreshness: observation.freshness.assessment,
      latestAttempt: null,
    }));
  const lineageObservationByScope = new Map<string, MattSkillsV1ProviderObservation>();
  const boundScopeKeys = new Set(
    input.decoded.records.flatMap((record) => {
      const data = record.data;
      if (data?.Type !== "effort" || data["Work binding"] === undefined) return [];
      return [
        mattNativeScopeKey({
          provider: data["Work binding"].Provider,
          nativeScope: data["Work binding"]["Native scope"],
        }),
      ];
    }),
  );
  for (const observation of input.providerDetailEvidenceObservations ?? []) {
    const key = mattNativeScopeKey(observation.binding);
    if (boundScopeKeys.has(key)) lineageObservationByScope.set(key, observation);
  }
  for (const observation of input.providerObservations) {
    lineageObservationByScope.set(mattNativeScopeKey(observation.binding), observation);
  }
  const lineageObservations = [...lineageObservationByScope.values()].sort((left, right) =>
    mattNativeScopeKey(left.binding).localeCompare(mattNativeScopeKey(right.binding), "en"),
  );
  const effortLocators = new Set(
    input.decoded.records
      .filter((record) => record.type === "effort")
      .map((record) => record.locator),
  );
  const gateLocators = new Set(
    input.decoded.records
      .filter((record) => record.type === "milestone-gate")
      .map((record) => record.locator),
  );
  const governance = buildGovernanceProjection({
    records: input.decoded.records,
    basisFingerprint: input.fingerprint,
    providerObservations: input.providerObservations,
    diagnostics: input.diagnostics.filter(
      (diagnostic) =>
        !PLANNING_RELATION_DIAGNOSTIC_CODES.has(diagnostic.code) &&
        !(
          diagnostic.code === "ambiguous-canonical-reference" &&
          (effortLocators.has(diagnostic.target) || gateLocators.has(diagnostic.target))
        ),
    ),
  });
  const assets = await buildAssetProjection({
    records: input.decoded.records,
    basisFingerprint: input.fingerprint,
    contentObservations: input.assetContentObservations,
  });
  const decisions = buildDecisionProjection({
    records: input.decoded.records,
    basisFingerprint: input.fingerprint,
  });
  const sources = mergeSourceRecords([
    governance.sources,
    assets.sources,
    decisions.sources,
    buildMattNativeSourceRecords(lineageObservations, input.fingerprint),
  ]);
  const diagnosticProjection = buildGenerationDiagnostics({
    basisFingerprint: input.fingerprint,
    diagnostics: input.diagnostics,
    sourceLocators: sources.map((source) => ({
      kind: source.kind,
      locator: source.displayLocator,
      ...(source.fragment === undefined ? {} : { fragment: source.fragment }),
      ...(source.binding === undefined ? {} : { binding: source.binding }),
    })),
  });
  const planningProjection = buildPlanningProjection({
    roadmaps: governance.roadmaps,
    gates: governance.gates,
    efforts: governance.efforts,
    providerObservations: input.providerObservations,
    providerObservationSelections,
    diagnostics: diagnosticProjection.diagnostics,
    sources,
  });
  const rebuiltAssets = rebuildAssetReverseRelations(assets.assets, {
    roadmaps: planningProjection.roadmaps,
    gates: planningProjection.gates,
    efforts: planningProjection.efforts,
    authorities: governance.authorities,
    reviews: decisions.reviews,
    directEvidence: collectAssetDirectEvidence(input.decoded.records),
  });
  const lineageProjection = buildPlanningLineageProjection({
    roadmaps: planningProjection.roadmaps,
    gates: planningProjection.gates,
    efforts: planningProjection.efforts,
    authorities: governance.authorities,
    assets: rebuiltAssets,
    reviews: decisions.reviews,
    providerObservations: input.providerObservations,
    providerObservationSelections,
    providerDetailEvidences: {
      observations: input.providerDetailEvidenceObservations ?? [],
      selections: input.providerDetailEvidenceSelections ?? [],
    },
    sources,
  });
  return deepFreeze({
    fingerprint: input.fingerprint,
    planning: planningProjection,
    lineage: lineageProjection,
  });
};
