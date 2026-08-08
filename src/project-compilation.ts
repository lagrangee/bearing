import {
  advisoryBasisInputsFromGeneration,
  deriveAdvisoryFreshnessFromGeneration,
} from "./advisory-freshness";
import { type AssetContentObservation, resolveAssetInputs } from "./asset-inputs";
import {
  type DecodedBearingRecordGeneration,
  decodeBearingRecordGeneration,
  rebaseDecodedBearingRecordGeneration,
} from "./bearing-record-decoder";
import { deriveStructuralDiagnosticsFromGeneration } from "./diagnostics";
import { listFiles } from "./discovery";
import { fingerprintInputRecords } from "./fingerprint";
import { retainContainedInputs } from "./input-boundary";
import { discoverManagedInputs } from "./managed-input-discovery";
import { resolveRepositoryRoot } from "./path-boundary";
import {
  buildProjectCompilationProjections,
  type ProjectCompilationProjectionBundle,
} from "./project-compilation-projection";
import {
  captureProjectInputGeneration,
  extendProjectInputGeneration,
} from "./project-input-generation";
import type { MattProviderFactory } from "./provider-acquisition";
import {
  type ProviderDetailEvidenceIntent,
  type ProviderDetailEvidenceState,
  selectProviderDetailEvidences,
} from "./provider-detail-selection";
import {
  fingerprintProviderObservationSelection,
  type ProviderEvidenceState,
  type ProviderObservationIntent,
  type ProviderObservationOperation,
  type ProviderObservationSelection,
  selectProviderObservations,
} from "./provider-evidence-selection";
import type {
  MattSkillsV1ProviderObservation,
  MattSkillsV1WorkBinding,
} from "./providers/matt-skills-v1/capture";
import type { AdvisoryFreshness, StructuralDiagnostic } from "./types";

export type ProjectCompilation = Readonly<{
  root: string;
  inputs: readonly string[];
  basisObservations: readonly Readonly<{ key: string; value: string }>[];
  projectReadModelBasisFingerprint: string;
  fingerprint: string;
  diagnostics: readonly StructuralDiagnostic[];
  advisoryFreshness: AdvisoryFreshness;
  decoded: DecodedBearingRecordGeneration;
  providerObservations: readonly MattSkillsV1ProviderObservation[];
  providerObservationSelections: readonly ProviderObservationSelection[];
  providerObservationOperation: ProviderObservationOperation;
  providerDetailEvidenceObservations: readonly MattSkillsV1ProviderObservation[];
  providerDetailEvidenceSelections: readonly ProviderObservationSelection[];
  providerDetailEvidenceOperation: Awaited<
    ReturnType<typeof selectProviderDetailEvidences>
  >["operation"];
  assetContentObservations: readonly AssetContentObservation[];
  projectProjections: ProjectCompilationProjectionBundle;
  metrics: ProjectCompilationMetrics;
}>;

export type ProjectCompilationMetrics = Readonly<{
  inputReadCount: number;
  capturedInputCount: number;
  bearingRecordCount: number;
  recordDecodeCount: number;
  repositoryRevalidationCount: number;
  providerAcquisitionCount: number;
  providerDetailEvidenceAcquisitionCount: number;
  phaseMs: Readonly<{
    discovery: number;
    capture: number;
    decode: number;
    assetResolution: number;
    derivation: number;
  }>;
}>;

export type ProjectCompilationOptions = Readonly<{
  explicitInputs?: readonly string[];
  providerFactory?: MattProviderFactory;
  providerObservationIntent?: ProviderObservationIntent;
  providerObservationNow?: () => string;
  providerObservationStore?: ProviderEvidenceState | null;
  requestedProviderBindings?: readonly MattSkillsV1WorkBinding[];
  providerDetailEvidenceIntent?: ProviderDetailEvidenceIntent;
  providerDetailEvidenceMaximumBytes?: number;
  providerDetailEvidenceState?: ProviderDetailEvidenceState | null;
}>;
export const compileProjectGeneration = async (
  repoRoot: string,
  options: ProjectCompilationOptions = {},
): Promise<ProjectCompilation> => {
  const started = performance.now();
  const root = await resolveRepositoryRoot(repoRoot);
  const providerDetailEvidenceIntent = options.providerDetailEvidenceIntent ?? { kind: "none" };
  const nativeReconciliationRequest =
    providerDetailEvidenceIntent.kind === "reconcile"
      ? providerDetailEvidenceIntent.request
      : undefined;
  if (
    nativeReconciliationRequest !== undefined &&
    options.providerObservationIntent !== undefined &&
    options.providerObservationIntent !== "reuse-current" &&
    options.providerObservationIntent !== "targeted-reconciliation"
  ) {
    throw new TypeError(
      "Targeted Native Reconciliation cannot be combined with exact-scope capture or all-scope verification.",
    );
  }
  const discovery = await discoverManagedInputs(root);
  const explicit =
    options.explicitInputs === undefined
      ? { inputs: [], diagnostics: [] }
      : await retainContainedInputs(root, options.explicitInputs);
  const discoveryInputs = [...new Set([...discovery.inputs, ...explicit.inputs])].sort(
    (left, right) => left.localeCompare(right, "en"),
  );
  const discovered = performance.now();
  const baseGeneration = await captureProjectInputGeneration(root, discoveryInputs);
  const baseCaptured = performance.now();
  const initiallyDecoded = decodeBearingRecordGeneration(baseGeneration);
  const decodedAt = performance.now();
  const discoveryDiagnostics = [...discovery.diagnostics, ...explicit.diagnostics];
  const assetResolution = await resolveAssetInputs(
    root,
    initiallyDecoded,
    discoveryDiagnostics,
    listFiles,
  );
  const assetsResolved = performance.now();
  const generation = await extendProjectInputGeneration(baseGeneration, assetResolution.inputs, {
    optionalLocators: advisoryBasisInputsFromGeneration(initiallyDecoded),
    observations: assetResolution.observations.map((observation) => ({
      key: `asset-content-availability:${observation.id}:${observation.location}`,
      value: `${observation.availability}:${observation.shape}`,
    })),
  });
  const extended = performance.now();
  const providerBasisDecoded = rebaseDecodedBearingRecordGeneration(
    initiallyDecoded,
    generation.fingerprint,
    generation.records.length,
  );
  const providerSelection = await selectProviderObservations({
    generation,
    decoded: providerBasisDecoded,
    intent:
      nativeReconciliationRequest === undefined
        ? (options.providerObservationIntent ?? "reuse-current")
        : "targeted-reconciliation",
    ...(nativeReconciliationRequest === undefined ? {} : { nativeReconciliationRequest }),
    ...(options.providerFactory === undefined ? {} : { providerFactory: options.providerFactory }),
    ...(options.providerObservationNow === undefined
      ? {}
      : { now: options.providerObservationNow }),
    ...(options.providerObservationStore === undefined
      ? {}
      : { priorStore: options.providerObservationStore }),
    ...(options.requestedProviderBindings === undefined
      ? {}
      : { requestedBindings: options.requestedProviderBindings }),
  });
  const providerDetailEvidence = await selectProviderDetailEvidences({
    generation,
    intent: providerDetailEvidenceIntent,
    boundObservations: providerSelection.observations,
    boundSelections: providerSelection.selections,
    ...(options.providerFactory === undefined ? {} : { providerFactory: options.providerFactory }),
    ...(options.providerObservationNow === undefined
      ? {}
      : { now: options.providerObservationNow }),
    ...(options.providerDetailEvidenceMaximumBytes === undefined
      ? {}
      : { maximumEvidenceBytes: options.providerDetailEvidenceMaximumBytes }),
    ...(options.providerDetailEvidenceState === undefined
      ? {}
      : { priorEvidence: options.providerDetailEvidenceState }),
  });
  const semanticBasisObservations = [
    ...generation.observations,
    {
      key: "repository-identity",
      value: fingerprintInputRecords([], [{ key: "repository-root", value: generation.root }])
        .fingerprint,
    },
    {
      key: "provider-observation-selection",
      value: fingerprintProviderObservationSelection(
        providerSelection.observations,
        providerSelection.selections,
      ),
    },
  ];
  const basisObservations = [
    ...semanticBasisObservations,
    {
      key: "input-discovery-diagnostics",
      value: JSON.stringify(discoveryDiagnostics),
    },
  ];
  const finalGeneration = fingerprintInputRecords(generation.records, semanticBasisObservations);
  const projectReadModelBasisFingerprint = fingerprintInputRecords(
    generation.records,
    basisObservations,
  ).fingerprint;
  const decoded = rebaseDecodedBearingRecordGeneration(
    providerBasisDecoded,
    finalGeneration.fingerprint,
    generation.records.length,
  );
  const diagnostics = [
    ...deriveStructuralDiagnosticsFromGeneration(decoded, generation.records, discoveryDiagnostics),
    ...providerSelection.diagnostics,
  ];
  const advisoryFreshness = deriveAdvisoryFreshnessFromGeneration(decoded, generation.records);
  const projectProjections = await buildProjectCompilationProjections({
    decoded,
    providerObservations: providerSelection.observations,
    providerObservationSelections: providerSelection.selections,
    providerDetailEvidenceObservations: providerDetailEvidence.observations,
    providerDetailEvidenceSelections: providerDetailEvidence.selections,
    diagnostics,
    fingerprint: finalGeneration.fingerprint,
    assetContentObservations: assetResolution.observations,
  });
  const compiled = performance.now();
  const operationMetrics = generation.instrumentation.snapshot();
  return {
    root,
    inputs: finalGeneration.inputs,
    basisObservations,
    projectReadModelBasisFingerprint,
    fingerprint: finalGeneration.fingerprint,
    diagnostics,
    advisoryFreshness,
    decoded,
    providerObservations: providerSelection.observations,
    providerObservationSelections: providerSelection.selections,
    providerObservationOperation: providerSelection.operation,
    providerDetailEvidenceObservations: providerDetailEvidence.observations,
    providerDetailEvidenceSelections: providerDetailEvidence.selections,
    providerDetailEvidenceOperation: providerDetailEvidence.operation,
    assetContentObservations: assetResolution.observations,
    projectProjections,
    metrics: {
      inputReadCount: operationMetrics.inputReadCount,
      capturedInputCount: generation.records.length,
      bearingRecordCount: decoded.metrics.bearingRecordCount,
      recordDecodeCount: decoded.metrics.decodeCount,
      repositoryRevalidationCount: operationMetrics.repositoryRevalidationCount,
      providerAcquisitionCount: providerSelection.operation.acquisitionCount,
      providerDetailEvidenceAcquisitionCount: providerDetailEvidence.operation.acquisitionCount,
      phaseMs: {
        discovery: discovered - started,
        capture: baseCaptured - discovered + (extended - assetsResolved),
        decode: decodedAt - baseCaptured,
        assetResolution: assetsResolved - decodedAt,
        derivation: compiled - extended,
      },
    },
  };
};
