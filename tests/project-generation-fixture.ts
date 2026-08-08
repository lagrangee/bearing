import { resolveAssetInputs } from "../src/asset-inputs";
import {
  decodeBearingRecordGeneration,
  rebaseDecodedBearingRecordGeneration,
} from "../src/bearing-record-decoder";
import { listFiles } from "../src/discovery";
import { buildProjectCompilationProjections } from "../src/project-compilation-projection";
import { buildProjectGeneration } from "../src/project-generation/projection";
import type { ProjectGenerationBuildInput } from "../src/project-generation/projection-input";
import { captureProjectInputGeneration } from "../src/project-input-generation";
import { acquireProviderObservations } from "../src/provider-acquisition";
import type { StructuralDiagnostic } from "../src/types";

export type SourceFixture = Readonly<{ locator: string; source: string }>;

export const decodeSourceFixtures = (
  records: readonly SourceFixture[],
  fingerprint = `sha256:${"0".repeat(64)}`,
) => {
  const captured = records.map((record) => ({
    locator: record.locator,
    source: record.source,
    bytes: Buffer.from(record.source, "utf8"),
  }));
  return decodeBearingRecordGeneration({
    fingerprint,
    records: captured,
  }).records;
};

export const captureDecodedInputs = async (
  repoRoot: string,
  inputs: readonly string[],
  fingerprint?: string,
) => {
  const generation = await captureProjectInputGeneration(repoRoot, inputs);
  const initial = decodeBearingRecordGeneration(generation);
  const acquisition = await acquireProviderObservations(generation, initial);
  const decoded =
    fingerprint === undefined
      ? initial
      : rebaseDecodedBearingRecordGeneration(initial, fingerprint, generation.records.length);
  const diagnostics: StructuralDiagnostic[] = [];
  const assets = await resolveAssetInputs(repoRoot, decoded, diagnostics, listFiles);
  return {
    decoded,
    providerObservations: acquisition.observations,
    providerObservationSelections: acquisition.observations.map((observation) => ({
      provider: observation.provider,
      nativeScope: observation.binding.nativeScope,
      observationId: observation.id,
      effectiveFreshness: observation.freshness.assessment,
      latestAttempt: null,
    })),
    assetContentObservations: assets.observations,
  };
};

export const captureDecodedSourceInputs = async (input: {
  readonly repoRoot: string;
  readonly inputs: readonly string[];
  readonly packageVersion?: string;
  readonly basisFingerprint?: string;
  readonly diagnostics?: readonly unknown[];
  readonly advisoryFreshness?: Readonly<Record<string, unknown>>;
}) =>
  (await captureDecodedInputs(input.repoRoot, input.inputs, input.basisFingerprint)).decoded
    .records;

type ProjectGenerationFixtureInput = Omit<
  ProjectGenerationBuildInput,
  | "decoded"
  | "providerObservations"
  | "providerObservationSelections"
  | "assetContentObservations"
  | "projectProjections"
> &
  Readonly<{
    inputs: readonly string[];
    assetContentObservations?: ProjectGenerationBuildInput["assetContentObservations"];
  }>;

export const buildProjectGenerationForTest = async (input: ProjectGenerationFixtureInput) => {
  const captured = await captureDecodedInputs(input.repoRoot, input.inputs, input.basisFingerprint);
  const assetContentObservations =
    input.assetContentObservations ?? captured.assetContentObservations;
  const projectProjections = await buildProjectCompilationProjections({
    decoded: captured.decoded,
    providerObservations: captured.providerObservations,
    diagnostics: input.diagnostics,
    fingerprint: input.basisFingerprint,
    assetContentObservations,
  });
  return buildProjectGeneration({
    repoRoot: input.repoRoot,
    packageVersion: input.packageVersion,
    basisFingerprint: input.basisFingerprint,
    diagnostics: input.diagnostics,
    advisoryFreshness: input.advisoryFreshness,
    ...captured,
    providerObservationSelections: captured.providerObservationSelections,
    assetContentObservations,
    projectProjections,
  });
};
