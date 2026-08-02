import { lstat, mkdir, readFile, unlink } from "node:fs/promises";
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
import { fingerprintInputRecords } from "./fingerprint";
import { retainContainedInputs } from "./input-boundary";
import {
  fingerprintNativeScopeInspections,
  type NativeScopeInspectionIntent,
  selectNativeScopeInspections,
} from "./native-scope-inspection";
import { resolveRepositoryRoot } from "./path-boundary";
import { buildPlanningGraph, type PlanningGraph } from "./planning-graph";
import type { PlanningGraphInstrumentation } from "./planning-graph-instrumentation";
import type { MattProviderFactory } from "./provider-observation-acquisition";
import {
  fingerprintProviderObservationSelection,
  type ProviderObservationIntent,
  type ProviderObservationOperation,
  type ProviderObservationSelection,
  selectProviderObservations,
} from "./provider-observation-store";
import type { MattSkillsV1ProviderObservation } from "./providers/matt-skills-v1/capture";
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
  legacyNativeScopeDiscoveryStorePath: string;
  legacyNativeScopeDiscoveryStorePresent: boolean;
  inputs: readonly string[];
  fingerprint: string;
  diagnostics: readonly StructuralDiagnostic[];
  advisoryFreshness: AdvisoryFreshness;
  decoded: DecodedBearingRecordGeneration;
  providerObservations: readonly MattSkillsV1ProviderObservation[];
  providerObservationSelections: readonly ProviderObservationSelection[];
  providerObservationOperation: ProviderObservationOperation;
  providerObservationStorePath: string;
  providerObservationStoreBytes: Buffer;
  providerObservationStoreChanged: boolean;
  nativeScopeInspectionObservations: readonly MattSkillsV1ProviderObservation[];
  nativeScopeInspectionSelections: readonly ProviderObservationSelection[];
  nativeScopeInspectionOperation: Awaited<
    ReturnType<typeof selectNativeScopeInspections>
  >["operation"];
  nativeScopeInspectionStorePath: string;
  nativeScopeInspectionStoreBytes: Buffer;
  nativeScopeInspectionStoreChanged: boolean;
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
  providerAcquisitionCount: number;
  nativeScopeInspectionAcquisitionCount: number;
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
  explicitInputs?: readonly string[];
  providerFactory?: MattProviderFactory;
  providerObservationIntent?: ProviderObservationIntent;
  providerObservationNow?: () => string;
  nativeScopeInspectionIntent?: NativeScopeInspectionIntent;
  nativeScopeInspectionMaximumStoreBytes?: number;
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
    join(repoRoot, ".bearing/cache/provider-observations.json"),
    join(repoRoot, ".bearing/cache/native-scope-discovery.json"),
    join(repoRoot, ".bearing/cache/native-scope-inspections.json"),
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
  const nativeScopeInspectionIntent = options.nativeScopeInspectionIntent ?? { kind: "none" };
  const nativeReconciliationRequest =
    nativeScopeInspectionIntent.kind === "reconcile"
      ? nativeScopeInspectionIntent.request
      : undefined;
  if (
    nativeReconciliationRequest !== undefined &&
    options.providerObservationIntent !== undefined &&
    options.providerObservationIntent !== "ordinary-sync" &&
    options.providerObservationIntent !== "targeted-reconciliation"
  ) {
    throw new TypeError(
      "Targeted native reconciliation cannot be combined with baseline, recovery or full verification.",
    );
  }
  const discovery = await discoverProjectSitemapInputs(root);
  const explicit =
    options.explicitInputs === undefined
      ? { inputs: [], diagnostics: [] }
      : await retainContainedInputs(root, options.explicitInputs);
  const discoveryInputs = [...new Set([...discovery.inputs, ...explicit.inputs])].sort(
    (left, right) => left.localeCompare(right, "en"),
  );
  const discovered = performance.now();
  const baseGeneration = await captureSyncInputGeneration(root, discoveryInputs);
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
  const generation = await extendSyncInputGeneration(baseGeneration, assetResolution.inputs, {
    optionalLocators: advisoryBasisInputsFromGeneration(initiallyDecoded),
    observations: assetResolution.observations.map((observation) => ({
      key: `asset-content-availability:${observation.id}:${observation.location}`,
      value: observation.availability,
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
        ? (options.providerObservationIntent ?? "ordinary-sync")
        : "targeted-reconciliation",
    ...(nativeReconciliationRequest === undefined ? {} : { nativeReconciliationRequest }),
    ...(options.providerFactory === undefined ? {} : { providerFactory: options.providerFactory }),
    ...(options.providerObservationNow === undefined
      ? {}
      : { now: options.providerObservationNow }),
  });
  const nativeScopeInspection = await selectNativeScopeInspections({
    repoRoot: generation.root,
    generation,
    intent: nativeScopeInspectionIntent,
    boundObservations: providerSelection.observations,
    boundSelections: providerSelection.selections,
    ...(options.providerFactory === undefined ? {} : { providerFactory: options.providerFactory }),
    ...(options.providerObservationNow === undefined
      ? {}
      : { now: options.providerObservationNow }),
    ...(options.nativeScopeInspectionMaximumStoreBytes === undefined
      ? {}
      : { maximumStoreBytes: options.nativeScopeInspectionMaximumStoreBytes }),
  });
  const finalGeneration = fingerprintInputRecords(generation.records, [
    ...generation.observations,
    {
      key: "provider-observation-selection",
      value: fingerprintProviderObservationSelection(
        providerSelection.observations,
        providerSelection.selections,
      ),
    },
    {
      key: "native-scope-inspection-selection",
      value: fingerprintNativeScopeInspections(
        nativeScopeInspection.observations,
        nativeScopeInspection.selections,
      ),
    },
  ]);
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
  const graphStarted = performance.now();
  const reusableGraph = options.planningGraph?.fingerprint === finalGeneration.fingerprint;
  const planningGraph = reusableGraph
    ? options.planningGraph
    : await buildPlanningGraph({
        decoded,
        providerObservations: providerSelection.observations,
        providerObservationSelections: providerSelection.selections,
        nativeScopeInspectionObservations: nativeScopeInspection.observations,
        nativeScopeInspectionSelections: nativeScopeInspection.selections,
        diagnostics,
        fingerprint: finalGeneration.fingerprint,
        assetContentObservations: assetResolution.observations,
        ...(options.planningGraphInstrumentation === undefined
          ? {}
          : { instrumentation: options.planningGraphInstrumentation }),
      });
  const graphBuilt = performance.now();
  const sitemap = buildProjectSitemapFromGeneration(
    decoded,
    providerSelection.observations,
    finalGeneration.inputs,
    finalGeneration.fingerprint,
    diagnostics,
    advisoryFreshness,
    planningGraph,
  );
  const report = serializeReport(finalGeneration.inputs, finalGeneration.fingerprint, diagnostics);
  const outputBuilt = performance.now();
  const reportPath = join(root, ".bearing/cache/sync-report.md");
  const sitemapPath = join(root, ".bearing/cache/project-sitemap.md");
  const previousReport = await readExisting(reportPath);
  const previousSitemap = await readExisting(sitemapPath);
  const legacyNativeScopeDiscoveryStorePath = join(
    root,
    ".bearing/cache/native-scope-discovery.json",
  );
  const legacyNativeScopeDiscoveryStorePresent =
    (await readExisting(legacyNativeScopeDiscoveryStorePath)) !== undefined;
  const reportChanged = previousReport === undefined || !previousReport.equals(report);
  const sitemapChanged = previousSitemap === undefined || !previousSitemap.equals(sitemap);
  const compared = performance.now();
  const operationMetrics = generation.instrumentation.snapshot();
  return {
    root,
    changed: reportChanged || sitemapChanged || legacyNativeScopeDiscoveryStorePresent,
    reportChanged,
    sitemapChanged,
    report,
    sitemap,
    reportPath,
    sitemapPath,
    legacyNativeScopeDiscoveryStorePath,
    legacyNativeScopeDiscoveryStorePresent,
    inputs: finalGeneration.inputs,
    fingerprint: finalGeneration.fingerprint,
    diagnostics,
    advisoryFreshness,
    decoded,
    providerObservations: providerSelection.observations,
    providerObservationSelections: providerSelection.selections,
    providerObservationOperation: providerSelection.operation,
    providerObservationStorePath: providerSelection.storePath,
    providerObservationStoreBytes: providerSelection.storeBytes,
    providerObservationStoreChanged: providerSelection.storeChanged,
    nativeScopeInspectionObservations: nativeScopeInspection.observations,
    nativeScopeInspectionSelections: nativeScopeInspection.selections,
    nativeScopeInspectionOperation: nativeScopeInspection.operation,
    nativeScopeInspectionStorePath: nativeScopeInspection.storePath,
    nativeScopeInspectionStoreBytes: nativeScopeInspection.storeBytes,
    nativeScopeInspectionStoreChanged: nativeScopeInspection.storeChanged,
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
      providerAcquisitionCount: providerSelection.operation.acquisitionCount,
      nativeScopeInspectionAcquisitionCount: nativeScopeInspection.operation.acquisitionCount,
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

export const syncProjectionResultFromPlan = (plan: SyncPlan): SyncProjectionResult => ({
  changed: plan.changed,
  advisoryFreshness: plan.advisoryFreshness,
  diagnostics: plan.diagnostics,
  fingerprint: plan.fingerprint,
  inputs: plan.inputs,
  reportPath: plan.reportPath,
  sitemapPath: plan.sitemapPath,
});

export const commitSyncPlan = async (
  plan: SyncPlan,
  options: Readonly<{
    publishProviderObservations?: boolean;
    publishNativeScopeInspections?: boolean;
  }> = {},
): Promise<SyncProjectionResult> => {
  if (
    plan.changed ||
    plan.providerObservationStoreChanged ||
    plan.nativeScopeInspectionStoreChanged
  ) {
    await mkdir(dirname(plan.reportPath), { recursive: true });
    if (plan.legacyNativeScopeDiscoveryStorePresent) {
      try {
        await unlink(plan.legacyNativeScopeDiscoveryStorePath);
      } catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
      }
    }
    if (plan.providerObservationStoreChanged && options.publishProviderObservations !== false) {
      await writeFileAtomically(
        plan.providerObservationStorePath,
        plan.providerObservationStoreBytes,
        0o644,
      );
    }
    if (plan.nativeScopeInspectionStoreChanged && options.publishNativeScopeInspections !== false) {
      await writeFileAtomically(
        plan.nativeScopeInspectionStorePath,
        plan.nativeScopeInspectionStoreBytes,
        0o644,
      );
    }
    if (plan.reportChanged) await writeFileAtomically(plan.reportPath, plan.report, 0o644);
    if (plan.sitemapChanged) await writeFileAtomically(plan.sitemapPath, plan.sitemap, 0o644);
  }
  return syncProjectionResultFromPlan(plan);
};
