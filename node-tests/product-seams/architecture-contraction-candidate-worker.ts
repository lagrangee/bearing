import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import type { Stats } from "node:fs";
import { lstat, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import {
  ARCHITECTURE_CONTRACTION_METHOD,
  type ArchitectureContractionCandidateIdentity,
} from "../../scripts/architecture-contraction-candidate-contract";
import { upsertCatalogEntry } from "../../src/catalog/store";
import {
  inspectProject,
  materializeProjectReadModelCandidate,
  prepareProjectReadModelCandidate,
  queryCommittedProject,
} from "../../src/project-read-model/inspect";
import {
  queryPortalProjectRows,
  queryPortalProjectRowsWithGeneration,
} from "../../src/project-read-model/portal";
import {
  rebuildProjectReadModel,
  verifyAllProjectProviderScopes,
} from "../../src/project-read-model/provider-operations";
import {
  inspectProjectReadModel,
  type ProjectReadModelCandidate,
  projectReadModelPath,
  publishProjectReadModel,
} from "../../src/project-read-model/store";
import {
  defaultMattProviderFactory,
  type MattProviderFactory,
} from "../../src/provider-acquisition";
import {
  BENCHMARK_SCALES,
  createRepresentativeProject,
  runtimeMetadata,
} from "../../tests/fixtures/representative-project";

const BASELINE_FIXTURE_DIGEST =
  "sha256:c8f3d7e2dd616163a1dc38856ba15f94c09362440a6baa838e1b1f11827774c8";

const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

const percentile95 = (samples: readonly number[]): number => {
  if (samples.length !== ARCHITECTURE_CONTRACTION_METHOD.sampleCount) {
    throw new Error("Candidate measurement requires the accepted sample count.");
  }
  const ordered = [...samples].sort((left, right) => left - right);
  return ordered[Math.ceil(ordered.length * 0.95) - 1] ?? Number.POSITIVE_INFINITY;
};

const sample = async (operation: () => Promise<void>): Promise<number[]> => {
  for (let index = 0; index < ARCHITECTURE_CONTRACTION_METHOD.warmupCount; index += 1) {
    await operation();
  }
  const samples: number[] = [];
  for (let index = 0; index < ARCHITECTURE_CONTRACTION_METHOD.sampleCount; index += 1) {
    const started = performance.now();
    await operation();
    samples.push(performance.now() - started);
  }
  return samples;
};

const footprint = async (root: string) => {
  const files: Readonly<{ locator: string; size: number }>[] = [];
  const visit = async (path: string): Promise<void> => {
    let metadata: Stats;
    try {
      metadata = await lstat(path);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return;
      throw error;
    }
    if (metadata.isDirectory()) {
      for (const entry of await readdir(path)) await visit(join(path, entry));
      return;
    }
    if (metadata.isFile()) {
      files.push({ locator: relative(root, path), size: metadata.size });
    }
  };
  await visit(root);
  const observations = files.filter((file) =>
    /provider-observation|native-scope-inspection/iu.test(file.locator),
  );
  return {
    fileCount: files.length,
    totalBytes: files.reduce((total, file) => total + file.size, 0),
    observationFileCount: observations.length,
    observationBytes: observations.reduce((total, file) => total + file.size, 0),
  };
};

const summaryVariant = (document: string, variant: "A" | "B"): string =>
  document.replace(/variant [AB]/gu, `variant ${variant}`);

const observingProviderFactory =
  (onAcquisition: () => void): MattProviderFactory =>
  (input) => {
    const provider = defaultMattProviderFactory(input);
    return {
      id: provider.id,
      capture: async (binding) => {
        onAcquisition();
        return provider.capture(binding);
      },
      ...(provider.reconcile === undefined
        ? {}
        : {
            reconcile: async (reconciliation) => {
              onAcquisition();
              return provider.reconcile?.(reconciliation) as ReturnType<
                NonNullable<typeof provider.reconcile>
              >;
            },
          }),
    };
  };

const runGenerationProcess = async (
  args: readonly string[],
): Promise<readonly Readonly<{ basisFingerprint: string; rows: string }>[]> => {
  const child = spawn(process.execPath, [process.argv[1] ?? "", ...args], {
    cwd: process.cwd(),
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
    stderr += chunk;
  });
  const exitCode = await new Promise<number>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => resolve(code ?? 1));
  });
  if (exitCode !== 0) {
    throw new Error(
      `Generation probe process exited ${exitCode}: ${stderr.trim() || stdout.trim()}`,
    );
  }
  return JSON.parse(stdout) as readonly Readonly<{ basisFingerprint: string; rows: string }>[];
};

export const measureArchitectureContractionCandidate = async (
  candidate: ArchitectureContractionCandidateIdentity,
) => {
  const fixture = await createRepresentativeProject("representative");
  const homeDir = await mkdtemp(join(tmpdir(), "bearing-contraction-catalog-"));
  try {
    let providerAcquisitionCount = 0;
    const providerFactory = observingProviderFactory(() => {
      providerAcquisitionCount += 1;
    });
    const initialCandidate = await prepareProjectReadModelCandidate(fixture.root, {
      providerFactory,
    });
    if (
      initialCandidate.candidate.basisInputs.length !==
        BENCHMARK_SCALES.representative.inputCount ||
      initialCandidate.plan.decoded.records.length !==
        BENCHMARK_SCALES.representative.bearingRecordCount
    ) {
      throw new Error("Representative fixture topology drifted from the accepted Ticket 04 basis.");
    }

    await upsertCatalogEntry({
      homeDir,
      repoRoot: fixture.root,
      createEntryId: () => "architecture-contraction-candidate",
    });
    const catalogPath = join(homeDir, ".bearing/catalog.sqlite");
    const catalogBefore = await readFile(catalogPath);

    const rebuilt = await rebuildProjectReadModel(fixture.root);
    if (rebuilt.result.acquisitionCount !== 0) {
      throw new Error("Physical rebuild performed provider acquisition.");
    }
    const verified = await verifyAllProjectProviderScopes(fixture.root);
    if (
      verified.outcome !== "complete" ||
      verified.result.acquisitionCount !== BENCHMARK_SCALES.representative.scopeCount
    ) {
      throw new Error(
        "Initial provider acquisition did not cover the exact representative scopes.",
      );
    }

    const summaryPath = join(fixture.root, fixture.summaryLocator);
    const originalSummary = await readFile(summaryPath, "utf8");
    let nextVariant: "A" | "B" = "B";
    const rematerializationAcquisitionCountBefore = providerAcquisitionCount;
    const rematerialize = async (): Promise<void> => {
      await writeFile(summaryPath, summaryVariant(originalSummary, nextVariant));
      nextVariant = nextVariant === "A" ? "B" : "A";
      const before = await inspectProjectReadModel(fixture.root);
      if (before.state !== "ready") throw new Error("Expected a current generation.");
      const result = await inspectProject(fixture.root, { kind: "project" }, { providerFactory });
      if (result.outcome !== "complete" && result.outcome !== "partial") {
        throw new Error("Semantic rematerialization did not return a readable generation.");
      }
      if (result.generation?.publicationCount !== before.metadata.receipt.publicationCount + 1) {
        throw new Error("One semantic transaction did not publish exactly one generation.");
      }
    };
    for (let index = 0; index < ARCHITECTURE_CONTRACTION_METHOD.warmupCount; index += 1) {
      await rematerialize();
    }
    const stateBeforeMeasured = await inspectProjectReadModel(fixture.root);
    if (stateBeforeMeasured.state !== "ready") throw new Error("Expected a current generation.");
    const rematerializationSamples: number[] = [];
    for (let index = 0; index < ARCHITECTURE_CONTRACTION_METHOD.sampleCount; index += 1) {
      const started = performance.now();
      await rematerialize();
      rematerializationSamples.push(performance.now() - started);
    }
    const stateAfterMeasured = await inspectProjectReadModel(fixture.root);
    if (stateAfterMeasured.state !== "ready") throw new Error("Expected a current generation.");
    const semanticPublicationCount =
      stateAfterMeasured.metadata.receipt.publicationCount -
      stateBeforeMeasured.metadata.receipt.publicationCount;
    const ordinaryRematerializationAcquisitionCount =
      providerAcquisitionCount - rematerializationAcquisitionCountBefore;

    const inspectSamples = await sample(async () => {
      const result = await queryCommittedProject(fixture.root, {
        kind: "planning-reference",
        reference: "effort:e001",
      });
      if (result.outcome !== "complete" && result.outcome !== "partial") {
        throw new Error("Typed Inspect query did not return a readable generation.");
      }
    });
    const portalSamples = await sample(async () => {
      const result = await queryPortalProjectRows(fixture.root);
      if (result.section !== "overview" || result.objects.length === 0) {
        throw new Error("Portal typed query did not return bounded current rows.");
      }
    });

    const readModel = projectReadModelPath(fixture.root);
    const readModelBefore = await readFile(readModel);
    const readModelStatBefore = await stat(readModel);
    const unchangedStateBefore = await inspectProjectReadModel(fixture.root);
    if (unchangedStateBefore.state !== "ready") throw new Error("Expected a current generation.");
    const unchangedAcquisitionCountBefore = providerAcquisitionCount;
    const unchangedSamples = await sample(async () => {
      const result = await inspectProject(
        fixture.root,
        {
          kind: "planning-reference",
          reference: "effort:e001",
        },
        { providerFactory },
      );
      if (result.outcome !== "complete" && result.outcome !== "partial") {
        throw new Error("Unchanged Ensure Current did not return a readable generation.");
      }
    });
    const unchangedStateAfter = await inspectProjectReadModel(fixture.root);
    if (unchangedStateAfter.state !== "ready") throw new Error("Expected a current generation.");
    const readModelAfter = await readFile(readModel);
    const readModelStatAfter = await stat(readModel);
    const unchangedPublicationCount =
      unchangedStateAfter.metadata.receipt.publicationCount -
      unchangedStateBefore.metadata.receipt.publicationCount;
    const unchangedProviderAcquisitionCount =
      providerAcquisitionCount - unchangedAcquisitionCountBefore;
    const unchangedReadModelMutationCount =
      sha256(readModelBefore) === sha256(readModelAfter) &&
      readModelStatBefore.mtimeMs === readModelStatAfter.mtimeMs
        ? 0
        : 1;

    await writeFile(summaryPath, summaryVariant(originalSummary, "B"));
    const failedCandidate = await materializeProjectReadModelCandidate(fixture.root);
    const lastGoodBefore = await inspectProjectReadModel(fixture.root);
    if (lastGoodBefore.state !== "ready") throw new Error("Expected a last-good generation.");
    try {
      await publishProjectReadModel(fixture.root, failedCandidate, { faultAt: "before-commit" });
      throw new Error("Injected publication failure did not fail.");
    } catch (error) {
      if (!(error instanceof Error) || !/Injected publication failure/u.test(error.message)) {
        throw error;
      }
    }
    const lastGoodAfter = await inspectProjectReadModel(fixture.root);
    const lastGoodPreservedAfterFailedCommit =
      lastGoodAfter.state === "ready" &&
      lastGoodAfter.metadata.basisFingerprint === lastGoodBefore.metadata.basisFingerprint &&
      lastGoodAfter.metadata.receipt.publicationCount ===
        lastGoodBefore.metadata.receipt.publicationCount;

    const generationCandidates = new Map<
      string,
      Readonly<{
        candidate: Awaited<ReturnType<typeof materializeProjectReadModelCandidate>>;
        rows: string;
      }>
    >();
    for (const variant of ["A", "B"] as const) {
      await writeFile(summaryPath, summaryVariant(originalSummary, variant));
      const generationCandidate = await materializeProjectReadModelCandidate(fixture.root, {
        providerFactory,
      });
      await publishProjectReadModel(fixture.root, generationCandidate);
      const snapshot = await queryPortalProjectRowsWithGeneration(fixture.root);
      generationCandidates.set(generationCandidate.basisFingerprint, {
        candidate: generationCandidate,
        rows: sha256(Buffer.from(JSON.stringify(snapshot.rows))),
      });
    }
    if (generationCandidates.size !== 2) {
      throw new Error("Concurrent generation probe requires two distinct semantic generations.");
    }
    const generationPair = [...generationCandidates.values()];
    if (generationPair[0]?.rows === generationPair[1]?.rows) {
      throw new Error("Concurrent generation probe requires distinguishable Portal rows.");
    }
    const firstCandidatePath = join(homeDir, "generation-a.json");
    const secondCandidatePath = join(homeDir, "generation-b.json");
    await Promise.all([
      writeFile(firstCandidatePath, JSON.stringify(generationPair[0]?.candidate)),
      writeFile(secondCandidatePath, JSON.stringify(generationPair[1]?.candidate)),
    ]);
    const [writerRows, firstReaderRows, secondReaderRows] = await Promise.all([
      runGenerationProcess([
        "--generation-writer",
        fixture.root,
        firstCandidatePath,
        secondCandidatePath,
        "50",
      ]),
      runGenerationProcess(["--generation-reader", fixture.root, "50"]),
      runGenerationProcess(["--generation-reader", fixture.root, "50"]),
    ]);
    if (writerRows.length !== 0) throw new Error("Generation writer returned reader evidence.");
    const portalReaders = [...firstReaderRows, ...secondReaderRows];
    const mixedGenerationObserved = portalReaders.some((snapshot) => {
      const expected = generationCandidates.get(snapshot.basisFingerprint);
      return expected === undefined || expected.rows !== snapshot.rows;
    });
    const catalogBytesChanged = sha256(catalogBefore) !== sha256(await readFile(catalogPath));

    return {
      schemaVersion: 1 as const,
      evidenceKind: "architecture-contraction-candidate-measurement" as const,
      candidate,
      measuredAt: new Date().toISOString(),
      machine: runtimeMetadata(),
      fixture: {
        baselineDigest: BASELINE_FIXTURE_DIGEST,
        candidateDigest: fixture.digest,
        managedInputCount: initialCandidate.candidate.basisInputs.length,
        bearingRecordCount: BENCHMARK_SCALES.representative.bearingRecordCount,
        providerScopeCount: BENCHMARK_SCALES.representative.scopeCount,
        baselineTotalBytes: 26_311,
        candidateTotalBytes: fixture.totalBytes,
        comparability:
          fixture.digest === BASELINE_FIXTURE_DIGEST
            ? "Exact fixture bytes match Ticket 04."
            : "Same generated topology; clean-cut wording replaced the historical Sync benchmark phrase (+8 bytes).",
      },
      methodology: ARCHITECTURE_CONTRACTION_METHOD,
      measurements: {
        typedInspectQueryP95Ms: percentile95(inspectSamples),
        typedPortalQueryP95Ms: percentile95(portalSamples),
        unchangedManagedBasisP95Ms: percentile95(unchangedSamples),
        unchangedProviderAcquisitionCount,
        unchangedPublicationCount,
        unchangedReadModelMutationCount,
        semanticRematerializationP95Ms: percentile95(rematerializationSamples),
        semanticRematerializationPeakRssBytes: process.resourceUsage().maxRSS * 1024,
        semanticTransactionCount: ARCHITECTURE_CONTRACTION_METHOD.sampleCount,
        semanticPublicationCount,
        providerInitialAcquisitionCount: verified.result.acquisitionCount,
        ordinaryRematerializationAcquisitionCount,
        retainedFootprint: await footprint(join(fixture.root, ".bearing/cache")),
        lastGoodPreservedAfterFailedCommit,
        mixedGenerationObserved,
        catalogBytesChanged,
      },
    };
  } finally {
    await Promise.all([
      rm(fixture.root, { recursive: true, force: true }),
      rm(homeDir, { recursive: true, force: true }),
    ]);
  }
};

if (import.meta.main) {
  const [mode, ...args] = process.argv.slice(2);
  if (mode === "--generation-reader") {
    const [repoRoot, countValue] = args;
    const count = Number(countValue);
    if (repoRoot === undefined || !Number.isInteger(count) || count <= 0) {
      throw new Error("Generation reader arguments are invalid.");
    }
    const observations = [];
    for (let index = 0; index < count; index += 1) {
      const snapshot = await queryPortalProjectRowsWithGeneration(repoRoot);
      observations.push({
        basisFingerprint: snapshot.generation.basisFingerprint,
        rows: sha256(Buffer.from(JSON.stringify(snapshot.rows))),
      });
    }
    process.stdout.write(`${JSON.stringify(observations)}\n`);
  } else if (mode === "--generation-writer") {
    const [repoRoot, firstPath, secondPath, countValue] = args;
    const count = Number(countValue);
    if (
      repoRoot === undefined ||
      firstPath === undefined ||
      secondPath === undefined ||
      !Number.isInteger(count) ||
      count <= 0
    ) {
      throw new Error("Generation writer arguments are invalid.");
    }
    const candidates = await Promise.all(
      [firstPath, secondPath].map(
        async (path) => JSON.parse(await readFile(path, "utf8")) as ProjectReadModelCandidate,
      ),
    );
    for (let index = 0; index < count; index += 1) {
      const candidate = candidates[index % candidates.length];
      if (candidate === undefined) throw new Error("Generation writer candidate is missing.");
      await publishProjectReadModel(repoRoot, candidate);
    }
    process.stdout.write("[]\n");
  } else {
    const [packageFile, packageSha256] = args;
    const sourceCommit = mode;
    if (sourceCommit === undefined || packageFile === undefined || packageSha256 === undefined) {
      throw new Error(
        "Candidate worker requires source commit, package file, and package SHA-256.",
      );
    }
    process.stdout.write(
      `${JSON.stringify(
        await measureArchitectureContractionCandidate({ sourceCommit, packageFile, packageSha256 }),
      )}\n`,
    );
  }
}
