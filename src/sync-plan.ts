import { lstat, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { stringify } from "yaml";
import {
  advisoryBasisInputsFromGeneration,
  deriveAdvisoryFreshnessFromGeneration,
} from "./advisory-freshness";
import { type AssetContentObservation, resolveAssetInputs } from "./asset-inputs";
import { writeFileAtomically } from "./atomic-write";
import {
  type DecodedBearingRecordGeneration,
  decodeBearingRecordGeneration,
  rebaseDecodedBearingRecordGeneration,
} from "./bearing-record-decoder";
import { deriveStructuralDiagnosticsFromGeneration } from "./diagnostics";
import { listFiles } from "./discovery";
import type { NativeSourceRecord } from "./native-work";
import { resolveRepositoryRoot } from "./path-boundary";
import { buildPlanningGraph, type PlanningGraph } from "./planning-graph";
import type { PlanningGraphInstrumentation } from "./planning-graph-instrumentation";
import { buildProjectSitemapFromGeneration } from "./sitemap";
import { discoverProjectSitemapInputs } from "./sitemap-discovery";
import { captureSyncInputGeneration, extendSyncInputGeneration } from "./sync-input-generation";
import type { AdvisoryFreshness, StructuralDiagnostic, SyncProjectionResult } from "./types";

export type SyncPlan = Readonly<{
  root: string;
  changed: boolean;
  reportChanged: boolean;
  sitemapChanged: boolean;
  report: Buffer;
  sitemap: Buffer;
  reportPath: string;
  sitemapPath: string;
  inputs: readonly string[];
  fingerprint: string;
  diagnostics: readonly StructuralDiagnostic[];
  advisoryFreshness: AdvisoryFreshness;
  decoded: DecodedBearingRecordGeneration;
  nativeRecords: readonly NativeSourceRecord[];
  assetContentObservations: readonly AssetContentObservation[];
  planningGraph: PlanningGraph;
  planningPhaseMs: Readonly<{
    graphBuild: number;
    output: number;
    cacheComparison: number;
  }>;
  metrics: SyncPerformanceMetrics;
}>;

export type SyncPerformanceMetrics = Readonly<{
  inputReadCount: number;
  capturedInputCount: number;
  bearingRecordCount: number;
  recordDecodeCount: number;
  repositoryRevalidationCount: number;
  phaseMs: Readonly<{
    discovery: number;
    capture: number;
    decode: number;
    assetResolution: number;
    derivation: number;
    outputComparison: number;
  }>;
}>;

export type PrepareSyncOptions = Readonly<{
  planningGraph?: PlanningGraph;
  planningGraphInstrumentation?: PlanningGraphInstrumentation;
}>;

const readExisting = async (target: string): Promise<Buffer | undefined> => {
  try {
    return await readFile(target);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
    throw error;
  }
};

const ensureCacheBoundary = async (repoRoot: string): Promise<void> => {
  const directories = [join(repoRoot, ".bearing"), join(repoRoot, ".bearing/cache")];
  const outputs = [
    join(repoRoot, ".bearing/cache/sync-report.md"),
    join(repoRoot, ".bearing/cache/project-sitemap.md"),
  ];
  const inspect = async (
    target: string,
  ): Promise<Awaited<ReturnType<typeof lstat>> | undefined> => {
    try {
      const metadata = await lstat(target);
      if (metadata.isSymbolicLink()) {
        throw new Error(`Bearing cache boundary cannot be a symbolic link: ${target}`);
      }
      return metadata;
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
      throw error;
    }
  };
  for (const target of directories) {
    const metadata = await inspect(target);
    if (metadata !== undefined && !metadata.isDirectory()) {
      throw new Error(`Bearing cache boundary must be a directory: ${target}`);
    }
  }
  for (const target of outputs) {
    const metadata = await inspect(target);
    if (metadata !== undefined && !metadata.isFile()) {
      throw new Error(`Bearing cache output must be a regular file: ${target}`);
    }
  }
};

const diagnosticLine = (diagnostic: StructuralDiagnostic): string =>
  `- **${diagnostic.impact}** \`${diagnostic.code}\` at \`${diagnostic.target}\`: ${diagnostic.message}`;

const serializeReport = (
  inputs: readonly string[],
  fingerprint: string,
  diagnostics: readonly StructuralDiagnostic[],
): Buffer => {
  const frontmatter = stringify(
    {
      Type: "bearing-sync-report",
      Version: 1,
      Inputs: [...inputs],
      "Input fingerprint": fingerprint,
    },
    { lineWidth: 0 },
  ).trimEnd();
  const findings =
    diagnostics.length === 0
      ? "No structural diagnostics."
      : diagnostics.map(diagnosticLine).join("\n");
  return Buffer.from(
    `---\n${frontmatter}\n---\n\n# Bearing Sync Report\n\n## Structural Diagnostics\n\n${findings}\n`,
    "utf8",
  );
};

export const prepareSync = async (
  repoRoot: string,
  options: PrepareSyncOptions = {},
): Promise<SyncPlan> => {
  const started = performance.now();
  const root = await resolveRepositoryRoot(repoRoot);
  await ensureCacheBoundary(root);
  const discovery = await discoverProjectSitemapInputs(root);
  const discovered = performance.now();
  const baseGeneration = await captureSyncInputGeneration(root, discovery.inputs);
  const baseCaptured = performance.now();
  const initiallyDecoded = decodeBearingRecordGeneration(baseGeneration);
  const decodedAt = performance.now();
  const discoveryDiagnostics = [...discovery.diagnostics];
  const assetResolution = await resolveAssetInputs(
    root,
    initiallyDecoded,
    discoveryDiagnostics,
    listFiles,
  );
  const assetsResolved = performance.now();
  const generation = await extendSyncInputGeneration(baseGeneration, assetResolution.inputs, {
    optionalLocators: advisoryBasisInputsFromGeneration(initiallyDecoded),
    observations: assetResolution.observations.map((observation) => ({
      key: `asset-content-availability:${observation.id}:${observation.location}`,
      value: observation.availability,
    })),
  });
  const extended = performance.now();
  const decoded = rebaseDecodedBearingRecordGeneration(
    initiallyDecoded,
    generation.fingerprint,
    generation.records.length,
  );
  const diagnostics = deriveStructuralDiagnosticsFromGeneration(
    decoded,
    generation.records,
    discoveryDiagnostics,
  );
  const advisoryFreshness = deriveAdvisoryFreshnessFromGeneration(decoded, generation.records);
  const nativeRecords = generation.records.filter((record) => record.native !== undefined);
  const graphStarted = performance.now();
  const reusableGraph = options.planningGraph?.fingerprint === generation.fingerprint;
  const planningGraph = reusableGraph
    ? options.planningGraph
    : await buildPlanningGraph({
        decoded,
        nativeRecords,
        diagnostics,
        fingerprint: generation.fingerprint,
        assetContentObservations: assetResolution.observations,
        ...(options.planningGraphInstrumentation === undefined
          ? {}
          : { instrumentation: options.planningGraphInstrumentation }),
      });
  const graphBuilt = performance.now();
  const sitemap = buildProjectSitemapFromGeneration(
    decoded,
    nativeRecords,
    generation.inputs,
    generation.fingerprint,
    diagnostics,
    advisoryFreshness,
    planningGraph,
  );
  const report = serializeReport(generation.inputs, generation.fingerprint, diagnostics);
  const outputBuilt = performance.now();
  const reportPath = join(root, ".bearing/cache/sync-report.md");
  const sitemapPath = join(root, ".bearing/cache/project-sitemap.md");
  const previousReport = await readExisting(reportPath);
  const previousSitemap = await readExisting(sitemapPath);
  const reportChanged = previousReport === undefined || !previousReport.equals(report);
  const sitemapChanged = previousSitemap === undefined || !previousSitemap.equals(sitemap);
  const compared = performance.now();
  const operationMetrics = generation.instrumentation.snapshot();
  return {
    root,
    changed: reportChanged || sitemapChanged,
    reportChanged,
    sitemapChanged,
    report,
    sitemap,
    reportPath,
    sitemapPath,
    inputs: generation.inputs,
    fingerprint: generation.fingerprint,
    diagnostics,
    advisoryFreshness,
    decoded,
    nativeRecords,
    assetContentObservations: assetResolution.observations,
    planningGraph,
    planningPhaseMs: {
      graphBuild: graphBuilt - graphStarted,
      output: outputBuilt - graphBuilt,
      cacheComparison: compared - outputBuilt,
    },
    metrics: {
      inputReadCount: operationMetrics.inputReadCount,
      capturedInputCount: generation.records.length,
      bearingRecordCount: decoded.metrics.bearingRecordCount,
      recordDecodeCount: decoded.metrics.decodeCount,
      repositoryRevalidationCount: operationMetrics.repositoryRevalidationCount,
      phaseMs: {
        discovery: discovered - started,
        capture: baseCaptured - discovered + (extended - assetsResolved),
        decode: decodedAt - baseCaptured,
        assetResolution: assetsResolved - decodedAt,
        derivation: outputBuilt - extended,
        outputComparison: compared - outputBuilt,
      },
    },
  };
};

export const commitSyncPlan = async (plan: SyncPlan): Promise<SyncProjectionResult> => {
  if (plan.changed) {
    await mkdir(dirname(plan.reportPath), { recursive: true });
    if (plan.reportChanged) await writeFileAtomically(plan.reportPath, plan.report, 0o644);
    if (plan.sitemapChanged) await writeFileAtomically(plan.sitemapPath, plan.sitemap, 0o644);
  }
  return {
    changed: plan.changed,
    advisoryFreshness: plan.advisoryFreshness,
    diagnostics: plan.diagnostics,
    fingerprint: plan.fingerprint,
    inputs: plan.inputs,
    reportPath: plan.reportPath,
    sitemapPath: plan.sitemapPath,
  };
};
