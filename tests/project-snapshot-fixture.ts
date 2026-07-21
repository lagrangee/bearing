import { resolveAssetInputs } from "../src/asset-inputs";
import {
  decodeBearingRecordGeneration,
  rebaseDecodedBearingRecordGeneration,
} from "../src/bearing-record-decoder";
import { listFiles } from "../src/discovery";
import { normalizeNativeSource } from "../src/native-work";
import { buildPlanningGraph } from "../src/planning-graph";
import { buildProjectSnapshot } from "../src/project-snapshot/projection";
import type { ProjectSnapshotBuildInput } from "../src/project-snapshot/projection-input";
import { captureSyncInputGeneration } from "../src/sync-input-generation";
import type { StructuralDiagnostic } from "../src/types";

export type SourceFixture = Readonly<{ locator: string; source: string }>;

export const decodeSourceFixtures = (
  records: readonly SourceFixture[],
  fingerprint = `sha256:${"0".repeat(64)}`,
) => {
  const captured = records.map((record) => ({
    ...normalizeNativeSource(record.locator, record.source),
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
  const generation = await captureSyncInputGeneration(repoRoot, inputs);
  const initial = decodeBearingRecordGeneration(generation);
  const decoded =
    fingerprint === undefined
      ? initial
      : rebaseDecodedBearingRecordGeneration(initial, fingerprint, generation.records.length);
  const diagnostics: StructuralDiagnostic[] = [];
  const assets = await resolveAssetInputs(repoRoot, decoded, diagnostics, listFiles);
  return {
    decoded,
    nativeRecords: generation.records.filter((record) => record.native !== undefined),
    assetContentObservations: assets.observations,
  };
};

export const captureDecodedSourceInputs = async (input: {
  readonly repoRoot: string;
  readonly inputs: readonly string[];
  readonly packageVersion?: string;
  readonly sitemapFingerprint?: string;
  readonly diagnostics?: readonly unknown[];
  readonly advisoryFreshness?: Readonly<Record<string, unknown>>;
}) =>
  (await captureDecodedInputs(input.repoRoot, input.inputs, input.sitemapFingerprint)).decoded
    .records;

type LegacySnapshotFixtureInput = Omit<
  ProjectSnapshotBuildInput,
  "decoded" | "nativeRecords" | "assetContentObservations" | "planningGraph"
> &
  Readonly<{
    inputs: readonly string[];
    assetContentObservations?: ProjectSnapshotBuildInput["assetContentObservations"];
  }>;

export const buildProjectSnapshotForTest = async (input: LegacySnapshotFixtureInput) => {
  const captured = await captureDecodedInputs(
    input.repoRoot,
    input.inputs,
    input.sitemapFingerprint,
  );
  const assetContentObservations =
    input.assetContentObservations ?? captured.assetContentObservations;
  const planningGraph = await buildPlanningGraph({
    decoded: captured.decoded,
    nativeRecords: captured.nativeRecords,
    diagnostics: input.diagnostics,
    fingerprint: input.sitemapFingerprint,
    assetContentObservations,
  });
  return buildProjectSnapshot({
    repoRoot: input.repoRoot,
    packageVersion: input.packageVersion,
    sitemapFingerprint: input.sitemapFingerprint,
    diagnostics: input.diagnostics,
    advisoryFreshness: input.advisoryFreshness,
    ...captured,
    assetContentObservations,
    planningGraph,
  });
};
