import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import packageMetadata from "../package.json";
import {
  calculateAdaptivePeakConcurrency,
  finalizeAdaptiveScenario,
  resumeAdaptiveScenario,
  startAdaptiveScenario,
} from "./adaptive-live-matrix";
import { configureFixedGitHubValidationRepository } from "./github-live-journey";
import { localRehearsalWorktreeDigest } from "./live-journey-matrix";
import { parseLiveMatrixGenerationBasis } from "./live-matrix-generation";
import { createLiveMatrixResult, verifyLiveMatrixScenarioEvidence } from "./live-matrix-results";
import { prepareLiveScenarioGenerationAdmission } from "./live-scenario-admission";
import {
  liveScenarioPackageSchema,
  readLiveScenarioPackageBasis,
  scanLiveScenarioDurableEvidence,
  writeLiveScenarioPackageBasis,
} from "./live-scenario-evidence";
import { loadLiveScenarioRegistry, preflightLiveScenarioRegistry } from "./live-scenario-registry";
import {
  assertLiveScenarioSourceCurrent,
  liveScenarioCandidateDefinitionDigest,
  liveScenarioDefinitionDigest,
  liveScenarioHarnessIdentitySha256,
} from "./live-scenario-runner";
import { assertCanonicalPackageBoundary } from "./release-boundary";
import { sha256File, verifyReleaseCandidate } from "./release-candidate-lib";

const usage = `Usage:
  bun scripts/run-live-journey.ts prepare-local-rehearsal \\
    --source-root <absolute-path> --package-output <absolute-new-path> \\
    [--registry <checkout-relative-path>]

  bun scripts/run-live-journey.ts prepare-candidate-package \\
    --candidate-receipt <absolute-path> --tarball <absolute-path> \\
    --source-root <absolute-path> --package-output <absolute-new-path>

  bun scripts/run-live-journey.ts configure-github-repository \\
    --source-root <absolute-path> --github-repository <owner/name> [--github-program <path>]

  bun scripts/run-live-journey.ts check-matrix-definition \\
    --source-root <absolute-path> --registry <checkout-relative-path>

  bun scripts/run-live-journey.ts prepare-generation \\
    --source-root <absolute-path> --registry <checkout-relative-path> \\
    --package-manifest <absolute-path> \\
    --workspace <absolute-new-path> --codex-home <absolute-path> \\
    --prerequisite-skill-root <absolute-path> \\
    [--generation-id <uuid>] [--codex-program <path>] \\
    [--github-checkout <absolute-path>] [--github-program <path>] \\
    [--selected-scenario <semantic-id> ...]

  bun scripts/run-live-journey.ts start-scenario \\
    --generation <absolute-path> --scenario-id <semantic-id>

  bun scripts/run-live-journey.ts resume-scenario \\
    --generation <absolute-path> --scenario-id <semantic-id> --reply <path-or-dash>

  bun scripts/run-live-journey.ts finalize-scenario \\
    --generation <absolute-path> --scenario-id <semantic-id> --verdict <absolute-path>

  bun scripts/run-live-journey.ts complete-matrix \\
    --source-root <absolute-path> --registry <absolute-path> \\
    --generation <absolute-path> --output <absolute-new-path>
`;

const fail = (message: string): never => {
  throw new Error(message);
};

const command = process.argv[2];
if (command === undefined || command === "--help" || command === "help") {
  process.stdout.write(usage);
  process.exit(0);
}

const parsed = parseArgs({
  args: process.argv.slice(3),
  strict: true,
  allowPositionals: false,
  options: {
    "candidate-receipt": { type: "string" },
    tarball: { type: "string" },
    "source-root": { type: "string" },
    workspace: { type: "string" },
    "package-output": { type: "string" },
    registry: { type: "string" },
    "package-manifest": { type: "string" },
    "generation-id": { type: "string" },
    generation: { type: "string" },
    "scenario-id": { type: "string" },
    "selected-scenario": { type: "string", multiple: true },
    reply: { type: "string" },
    verdict: { type: "string" },
    "codex-home": { type: "string" },
    "codex-program": { type: "string" },
    "prerequisite-skill-root": { type: "string" },
    "github-repository": { type: "string" },
    "github-checkout": { type: "string" },
    "github-program": { type: "string" },
    output: { type: "string" },
  },
});

const required = (name: keyof typeof parsed.values): string => {
  const value = parsed.values[name];
  return typeof value === "string" ? value : fail(`Missing --${name}.`);
};

const ensureMissing = async (path: string): Promise<void> => {
  try {
    await lstat(path);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return;
    throw error;
  }
  fail(`Output already exists: ${path}`);
};

const prepareGeneration = async (): Promise<void> => {
  const sourceRoot = await realpath(resolve(required("source-root")));
  const packageBasis = await readLiveScenarioPackageBasis(resolve(required("package-manifest")));
  const matrixPackage = liveScenarioPackageSchema.parse(
    packageBasis.evidenceClass === "release-candidate"
      ? (({ schemaVersion: _schemaVersion, candidateReceipt: _candidateReceipt, ...value }) =>
          value)(packageBasis)
      : (({ schemaVersion: _schemaVersion, ...value }) => value)(packageBasis),
  );
  if (matrixPackage.evidenceClass === "release-candidate") {
    const candidateBasis =
      packageBasis.evidenceClass === "release-candidate"
        ? packageBasis
        : fail("Candidate package basis evidence class changed during validation.");
    if (
      (await sha256File(candidateBasis.candidateReceipt.path)) !==
      candidateBasis.candidateReceipt.sha256
    ) {
      fail("Candidate Receipt changed after package-basis preparation.");
    }
    const receipt = await verifyReleaseCandidate(candidateBasis.candidateReceipt.path, {
      repositoryRoot: sourceRoot,
    });
    const receiptTarball = await realpath(
      join(dirname(candidateBasis.candidateReceipt.path), receipt.artifact.file),
    );
    if (
      receipt.packageName !== matrixPackage.packageName ||
      receipt.packageVersion !== matrixPackage.packageVersion ||
      receipt.sourceCommit !== matrixPackage.sourceCommit ||
      JSON.stringify(receipt.workflow) !== JSON.stringify(matrixPackage.workflow) ||
      receiptTarball !== matrixPackage.artifact.path ||
      receipt.artifact.file !== matrixPackage.artifact.file ||
      receipt.artifact.sha256 !== matrixPackage.artifact.sha256
    ) {
      fail("Candidate package basis does not match its verified Receipt.");
    }
  }
  const workspaceRoot = resolve(required("workspace"));
  const admission = await prepareLiveScenarioGenerationAdmission({
    sourceRoot,
    workspaceRoot,
    operatorCodexHome: resolve(required("codex-home")),
    registryPath: required("registry"),
    generationId: parsed.values["generation-id"] ?? randomUUID(),
    package: matrixPackage,
    ...(parsed.values["selected-scenario"] === undefined
      ? {}
      : { scenarioIds: parsed.values["selected-scenario"] }),
    prerequisiteSkillRoot: resolve(required("prerequisite-skill-root")),
    ...(parsed.values["codex-program"] === undefined
      ? {}
      : { codexProgram: parsed.values["codex-program"] }),
    ...(parsed.values["github-checkout"] === undefined
      ? {}
      : { githubCheckout: parsed.values["github-checkout"] }),
    ...(parsed.values["github-program"] === undefined
      ? {}
      : { githubProgram: parsed.values["github-program"] }),
  });
  if (admission.outcome !== "admitted") {
    process.stdout.write(`${JSON.stringify(admission)}\n`);
    process.exitCode = 1;
    return;
  }
  const generationPath = join(workspaceRoot, "generation.json");
  await writeFile(
    generationPath,
    scanLiveScenarioDurableEvidence({
      value: admission.generationBasis,
      configPath: resolve(".gitleaks.toml"),
    }),
    { flag: "wx" },
  );
  process.stdout.write(
    `${JSON.stringify({
      generationId: admission.generationId,
      generation: generationPath,
      manifests: admission.preparedScenarios.map(({ scenario, paths }) => ({
        scenarioId: scenario.id,
        manifest: paths.manifest,
      })),
    })}\n`,
  );
};

const localPackResultSchema = z
  .object({
    name: z.string().min(1),
    version: z.string().min(1),
    filename: z.string().min(1),
    files: z.array(z.object({ path: z.string().min(1) }).passthrough()),
  })
  .passthrough();

const runLocalCommand = (
  program: string,
  args: readonly string[],
  workingDirectory: string,
  environment: NodeJS.ProcessEnv = process.env,
): string => {
  const result = Bun.spawnSync([program, ...args], {
    cwd: workingDirectory,
    env: environment,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    fail(result.stderr.toString().trim() || `${program} ${args.join(" ")} failed.`);
  }
  return result.stdout.toString().trim();
};

const localRehearsalPackageSchema = z
  .object({
    schemaVersion: z.literal(1),
    evidenceClass: z.literal("local-rehearsal"),
    packageName: z.literal("@lagrangee/bearing"),
    packageVersion: z.string().min(1),
    sourceHead: z.string().min(1),
    worktreeSha256: z.string().regex(/^[0-9a-f]{64}$/u),
    artifact: z.object({
      path: z.string().min(1),
      file: z.string().min(1),
      sha256: z.string().regex(/^[0-9a-f]{64}$/u),
    }),
    matrixDefinitionSha256: z.string().regex(/^[0-9a-f]{64}$/u),
  })
  .strict();

const prepareLocalRehearsal = async (): Promise<void> => {
  const sourceRoot = await realpath(resolve(required("source-root")));
  const packageOutput = resolve(required("package-output"));
  const packageOutputRelative = relative(sourceRoot, packageOutput);
  if (
    packageOutputRelative === "" ||
    (!packageOutputRelative.startsWith("..") && !isAbsolute(packageOutputRelative))
  ) {
    fail("Local rehearsal package output must stay outside the source checkout.");
  }
  await ensureMissing(packageOutput);
  await mkdir(packageOutput, { recursive: true });

  const sourceHead = runLocalCommand("git", ["rev-parse", "HEAD"], sourceRoot);
  const worktreeSha256 = await localRehearsalWorktreeDigest(sourceRoot);
  runLocalCommand("bun", ["scripts/build.ts"], sourceRoot);
  if ((await localRehearsalWorktreeDigest(sourceRoot)) !== worktreeSha256) {
    fail("Local rehearsal build changed the source worktree.");
  }
  const packedResults = z
    .array(localPackResultSchema)
    .length(1)
    .parse(
      JSON.parse(
        runLocalCommand(
          "npm",
          ["pack", "--json", "--ignore-scripts", "--pack-destination", packageOutput],
          sourceRoot,
          {
            ...process.env,
            npm_config_cache: join(packageOutput, ".npm-cache"),
            npm_config_loglevel: "error",
            npm_config_update_notifier: "false",
          },
        ),
      ),
    );
  const packed = packedResults[0] ?? fail("Local rehearsal pack did not produce an artifact.");
  if (packed.name !== packageMetadata.name || packed.version !== packageMetadata.version) {
    fail("Local rehearsal package identity does not match package metadata.");
  }
  assertCanonicalPackageBoundary(packed.files.map(({ path }) => path));
  const artifactPath = await realpath(join(packageOutput, packed.filename));
  const registryPath = parsed.values.registry ?? "validation/live-journey/registry.json";
  const matrixDefinitionSha256 = await liveScenarioDefinitionDigest({
    sourceRoot,
    registryPath,
  });
  const localPackage = localRehearsalPackageSchema.parse({
    schemaVersion: 1,
    evidenceClass: "local-rehearsal",
    packageName: packed.name,
    packageVersion: packed.version,
    sourceHead,
    worktreeSha256,
    artifact: {
      path: artifactPath,
      file: basename(artifactPath),
      sha256: await sha256File(artifactPath),
    },
    matrixDefinitionSha256,
  });
  const localPackagePath = join(packageOutput, "local-rehearsal-package.json");
  await writeLiveScenarioPackageBasis(localPackagePath, localPackage);

  process.stdout.write(
    `${JSON.stringify({
      evidenceClass: localPackage.evidenceClass,
      packageManifest: localPackagePath,
      artifact: localPackage.artifact.path,
      matrixDefinitionSha256,
    })}\n`,
  );
};

const prepareCandidatePackage = async (): Promise<void> => {
  const sourceRoot = await realpath(resolve(required("source-root")));
  const receiptPath = resolve(required("candidate-receipt"));
  const explicitTarball = await realpath(resolve(required("tarball")));
  const packageOutput = resolve(required("package-output"));
  await ensureMissing(packageOutput);
  const receipt = await verifyReleaseCandidate(receiptPath, { repositoryRoot: sourceRoot });
  const receiptTarball = await realpath(join(dirname(receiptPath), receipt.artifact.file));
  if (
    receipt.packageName !== "@lagrangee/bearing" ||
    explicitTarball !== receiptTarball ||
    runLocalCommand("git", ["rev-parse", "HEAD"], sourceRoot) !== receipt.sourceCommit
  ) {
    fail("Candidate package inputs do not match the exact source checkout and Receipt.");
  }
  await assertLiveScenarioSourceCurrent(sourceRoot, {
    evidenceClass: "release-candidate",
    sourceCommit: receipt.sourceCommit,
  });
  const matrixDefinitionSha256 = await liveScenarioCandidateDefinitionDigest({
    sourceRoot,
    registryPath: "validation/live-journey/registry.json",
    sourceCommit: receipt.sourceCommit,
  });
  await assertLiveScenarioSourceCurrent(sourceRoot, {
    evidenceClass: "release-candidate",
    sourceCommit: receipt.sourceCommit,
  });
  const candidatePackage = {
    schemaVersion: 1 as const,
    evidenceClass: "release-candidate" as const,
    packageName: receipt.packageName,
    packageVersion: receipt.packageVersion,
    sourceCommit: receipt.sourceCommit,
    workflow: receipt.workflow,
    artifact: {
      path: receiptTarball,
      file: receipt.artifact.file,
      sha256: receipt.artifact.sha256,
    },
    matrixDefinitionSha256,
    candidateReceipt: {
      path: await realpath(receiptPath),
      sha256: await sha256File(receiptPath),
    },
  };
  await mkdir(packageOutput, { recursive: true });
  const manifest = join(packageOutput, "candidate-package.json");
  await writeLiveScenarioPackageBasis(manifest, candidatePackage);
  process.stdout.write(
    `${JSON.stringify({
      evidenceClass: candidatePackage.evidenceClass,
      packageManifest: manifest,
      artifact: candidatePackage.artifact.path,
      matrixDefinitionSha256,
    })}\n`,
  );
};

const configureGitHubRepository = async (): Promise<void> => {
  const configured = await configureFixedGitHubValidationRepository({
    sourceRoot: resolve(required("source-root")),
    repositorySlug: required("github-repository"),
    ...(parsed.values["github-program"] === undefined
      ? {}
      : { githubProgram: parsed.values["github-program"] }),
  });
  process.stdout.write(
    `${JSON.stringify({
      configuration: configured.path,
      repositoryIdentitySha256: configured.configuration.repositoryIdentitySha256,
    })}\n`,
  );
};

const checkMatrixDefinition = async (): Promise<void> => {
  const result = await preflightLiveScenarioRegistry({
    sourceRoot: resolve(required("source-root")),
    registryPath: required("registry"),
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
};

const completeMatrix = async (): Promise<void> => {
  const output = resolve(required("output"));
  await ensureMissing(output);
  const generationPath = await realpath(resolve(required("generation")));
  if (basename(generationPath) !== "generation.json") {
    fail("Live Matrix Generation basis must use the canonical generation.json name.");
  }
  const generation = {
    generationPath,
    workspaceRoot: dirname(generationPath),
    basis: parseLiveMatrixGenerationBasis(JSON.parse(await readFile(generationPath, "utf8"))),
  } as const;
  const sourceRoot = await realpath(resolve(required("source-root")));
  const trackedRegistryPath = join(sourceRoot, "validation/live-journey/registry.json");
  if ((await realpath(resolve(required("registry")))) !== (await realpath(trackedRegistryPath))) {
    fail("Matrix completion requires the tracked source registry.");
  }
  const registry = await loadLiveScenarioRegistry(trackedRegistryPath);
  const resultPaths = registry.scenarios.map(({ id }) =>
    join(generation.workspaceRoot, "scenarios", id, "result.json"),
  );
  const outputRoot = await realpath(dirname(output));
  if (outputRoot !== dirname(generation.workspaceRoot)) {
    fail("Matrix result must be written at its Generation evidence root.");
  }
  const scenarioResults = await Promise.all(
    resultPaths.map(async (path) => {
      const result = await verifyLiveMatrixScenarioEvidence(
        outputRoot,
        JSON.parse(await readFile(path, "utf8")),
      );
      return {
        result,
        reference: {
          pointer: relative(outputRoot, path).replaceAll("\\", "/"),
          sha256: await sha256File(path),
        },
      };
    }),
  );
  const currentDefinitionSha256 = await liveScenarioDefinitionDigest({
    sourceRoot,
    registryPath: "validation/live-journey/registry.json",
  });
  if (
    currentDefinitionSha256 !== generation.basis.registryDefinitionSha256 ||
    (await liveScenarioHarnessIdentitySha256({ sourceRoot })) !==
      generation.basis.harnessIdentitySha256
  ) {
    fail("Matrix completion source definition does not match the Scenario result identity.");
  }
  const result = createLiveMatrixResult({
    generationBasis: generation.basis,
    generationBasisReference: {
      pointer: relative(outputRoot, generation.generationPath).replaceAll("\\", "/"),
      sha256: await sha256File(generation.generationPath),
    },
    registeredScenarioIds: registry.scenarios.map(({ id }) => id),
    scenarioResults,
    peakConcurrency: calculateAdaptivePeakConcurrency(
      scenarioResults.map(({ result: scenario }) => scenario),
    ),
    endedAt: new Date().toISOString(),
  });
  await writeFile(
    output,
    scanLiveScenarioDurableEvidence({ value: result, configPath: resolve(".gitleaks.toml") }),
    { flag: "wx" },
  );
  process.stdout.write(
    `${JSON.stringify({ output, scenarios: result.scenarios.length, report: result.report })}\n`,
  );
};

if (command === "prepare-generation") await prepareGeneration();
else if (command === "start-scenario") {
  process.stdout.write(
    `${JSON.stringify(
      await startAdaptiveScenario({
        generationPath: required("generation"),
        scenarioId: required("scenario-id"),
      }),
    )}\n`,
  );
} else if (command === "resume-scenario") {
  process.stdout.write(
    `${JSON.stringify(
      await resumeAdaptiveScenario({
        generationPath: required("generation"),
        scenarioId: required("scenario-id"),
        replyPath: required("reply"),
      }),
    )}\n`,
  );
} else if (command === "finalize-scenario") {
  process.stdout.write(
    `${JSON.stringify(
      await finalizeAdaptiveScenario({
        generationPath: required("generation"),
        scenarioId: required("scenario-id"),
        verdictPath: required("verdict"),
      }),
    )}\n`,
  );
} else if (command === "check-matrix-definition") await checkMatrixDefinition();
else if (command === "prepare-local-rehearsal") await prepareLocalRehearsal();
else if (command === "prepare-candidate-package") await prepareCandidatePackage();
else if (command === "configure-github-repository") await configureGitHubRepository();
else if (command === "complete-matrix") await completeMatrix();
else fail(`Unknown command: ${command}.\n${usage}`);
