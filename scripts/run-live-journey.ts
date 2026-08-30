import { randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import packageMetadata from "../package.json";
import {
  assertCodexE2EOutputIsolation,
  redactCodexE2EEphemeralCapabilities,
} from "./codex-e2e-runtime";
import {
  assertGitHubRemoteIntegrity,
  captureGitHubRemoteInventory,
  configureFixedGitHubValidationRepository,
  createGitHubJourneyObservation,
  startGitHubJourneyCredentialBroker,
  verifyGitHubJourneyObservation,
  writeOrVerifyGitHubRemoteBaseline,
} from "./github-live-journey";
import {
  assertJourneyAgentPrompt,
  createCodexJourneyEnvironment,
  createLiveJourneyObservation,
  extractCodexThreadId,
  localRehearsalWorktreeDigest,
  observationSupportsSemanticPass,
  readCodexSessionState,
  readGeneratedEvidenceFile,
  snapshotDirectory,
  verifyLiveJourneyObservation,
  writeCodexSessionState,
} from "./live-journey-matrix";
import { parseLiveMatrixGenerationBasis } from "./live-matrix-generation";
import {
  createLiveMatrixResult,
  createLiveMatrixScenarioTerminalResult,
  verifyLiveMatrixScenarioEvidence,
} from "./live-matrix-results";
import { runLiveMatrixSchedule } from "./live-matrix-scheduler";
import { prepareLiveScenarioGenerationAdmission } from "./live-scenario-admission";
import {
  liveScenarioMatrixPackageIdentitySha256,
  liveScenarioPackageEvidenceIdentity,
  liveScenarioPackageSchema,
  readLiveScenarioPackageBasis,
  scanLiveScenarioDurableEvidence,
  writeLiveScenarioPackageBasis,
} from "./live-scenario-evidence";
import {
  createLiveScenarioEvaluation,
  liveScenarioIdSchema,
  liveScenarioResourceKeyForCapability,
  loadLiveScenarioRegistry,
  preflightLiveScenarioRegistry,
} from "./live-scenario-registry";
import {
  assertLiveScenarioSourceCurrent,
  liveScenarioCandidateDefinitionDigest,
  liveScenarioDefinitionDigest,
  liveScenarioHarnessIdentitySha256,
  verifyLiveScenarioBehaviorBoundary,
  verifyLiveScenarioGeneration,
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
    [--github-checkout <absolute-path>] [--github-program <path>]

  bun scripts/run-live-journey.ts run-generation \\
    --generation <absolute-path>

  bun scripts/run-live-journey.ts evaluate-scenario \\
    --generation <absolute-path> --manifest <absolute-path> --verdicts <absolute-path> \\
    --output <absolute-new-path>

  bun scripts/run-live-journey.ts complete-matrix \\
    --source-root <absolute-path> --registry <absolute-path> --results <absolute-directory> \\
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
    results: { type: "string" },
    "codex-home": { type: "string" },
    "codex-program": { type: "string" },
    "prerequisite-skill-root": { type: "string" },
    "github-repository": { type: "string" },
    "github-checkout": { type: "string" },
    "github-program": { type: "string" },
    manifest: { type: "string" },
    verdicts: { type: "string" },
    output: { type: "string" },
  },
});

const required = (name: keyof typeof parsed.values): string =>
  parsed.values[name] ?? fail(`Missing --${name}.`);

const ensureMissing = async (path: string): Promise<void> => {
  try {
    await lstat(path);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return;
    throw error;
  }
  fail(`Output already exists: ${path}`);
};

const pathIsInside = (root: string, path: string): boolean => {
  const relation = relative(resolve(root), resolve(path));
  return relation === "" || (!relation.startsWith("..") && !isAbsolute(relation));
};

const withLiveScenarioCoordinatorManifestHidden = async <Result>(
  input: Readonly<{
    protectedPaths: readonly string[];
    agentHome: string;
    repository: string;
  }>,
  operation: () => Promise<Result>,
): Promise<Result> => {
  if (
    input.protectedPaths.some(
      (path) => pathIsInside(input.agentHome, path) || pathIsInside(input.repository, path),
    )
  ) {
    fail("Coordinator-only evidence must stay outside the Scenario Agent writable roots.");
  }
  const entries = (
    await Promise.all(
      input.protectedPaths.map(async (path) => {
        try {
          return { path, mode: (await lstat(path)).mode & 0o777 } as const;
        } catch (error) {
          if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
          throw error;
        }
      }),
    )
  ).filter((entry) => entry !== null);
  try {
    await Promise.all(entries.map(({ path }) => chmod(path, 0o000)));
    return await operation();
  } finally {
    await Promise.all(entries.map(({ path, mode }) => chmod(path, mode)));
  }
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

const runProcess = async (
  program: string,
  args: readonly string[],
  environment: Readonly<Record<string, string>>,
  workingDirectory?: string,
) => {
  const child = Bun.spawn([program, ...args], {
    ...(workingDirectory === undefined ? {} : { cwd: workingDirectory }),
    env: environment,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { exitCode, stdout, stderr };
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
    fixtures: z
      .object({
        olderGlobalKit: z.object({
          packageName: z.literal("@lagrangee/bearing"),
          packageVersion: z.literal("0.1.1"),
          source: z.object({
            kind: z.literal("npm"),
            spec: z.literal("@lagrangee/bearing@0.1.1"),
          }),
          artifact: z.object({
            path: z.string().min(1),
            file: z.string().min(1),
            sha256: z.string().regex(/^[0-9a-f]{64}$/u),
          }),
        }),
      })
      .optional(),
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
  const registry = await loadLiveScenarioRegistry(resolve(sourceRoot, registryPath));
  const matrixDefinitionSha256 = await liveScenarioDefinitionDigest({
    sourceRoot,
    registryPath,
  });
  let olderGlobalKit:
    | Readonly<{
        packageName: "@lagrangee/bearing";
        packageVersion: "0.1.1";
        source: Readonly<{ kind: "npm"; spec: "@lagrangee/bearing@0.1.1" }>;
        artifact: Readonly<{ path: string; file: string; sha256: string }>;
      }>
    | undefined;
  if (
    registry.scenarios.some(
      ({ composition }) => composition.fixtureProfile === "older-kit-active-stable-repository",
    )
  ) {
    const fixtureSpec = "@lagrangee/bearing@0.1.1" as const;
    const fixtureResults = z
      .array(localPackResultSchema)
      .length(1)
      .parse(
        JSON.parse(
          runLocalCommand(
            "npm",
            [
              "pack",
              fixtureSpec,
              "--json",
              "--ignore-scripts",
              "--pack-destination",
              packageOutput,
            ],
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
    const fixture = fixtureResults[0] ?? fail("G1 older Global Kit pack produced no artifact.");
    if (fixture.name !== "@lagrangee/bearing" || fixture.version !== "0.1.1") {
      fail("G1 older Global Kit package identity does not match the fixed npm package.");
    }
    const fixtureArtifact = await realpath(join(packageOutput, fixture.filename));
    olderGlobalKit = Object.freeze({
      packageName: "@lagrangee/bearing" as const,
      packageVersion: "0.1.1" as const,
      source: Object.freeze({ kind: "npm" as const, spec: fixtureSpec }),
      artifact: Object.freeze({
        path: fixtureArtifact,
        file: basename(fixtureArtifact),
        sha256: await sha256File(fixtureArtifact),
      }),
    });
  }
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
    ...(olderGlobalKit === undefined ? {} : { fixtures: { olderGlobalKit } }),
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

const promptBytes = async (
  path: string,
  scenarioIds: readonly string[],
  allowedLocators: readonly string[],
): Promise<string> => {
  const prompt =
    path === "-"
      ? await new Response(Bun.stdin.stream()).text()
      : await readFile(resolve(path), "utf8");
  return assertJourneyAgentPrompt(
    prompt.endsWith("\n") ? prompt.slice(0, -1) : prompt,
    scenarioIds,
    allowedLocators,
  );
};

const snapshotScenarioAgentHome = (agentHome: string): Promise<string> =>
  snapshotDirectory(agentHome, {
    excludeTrees: [".codex", "skill-directory/.system"],
  });

type CodexTurnManifest = Awaited<ReturnType<typeof verifyLiveScenarioGeneration>>;

const prepareCodexTurn = async (manifest: CodexTurnManifest, turn: number, promptFile: string) => {
  const sessionState = await readCodexSessionState(manifest.paths.sessionState);
  if (sessionState === undefined && turn !== 1)
    fail("The first Codex Journey turn must be turn 1.");
  if (
    sessionState !== undefined &&
    (sessionState.generationId !== manifest.generationId || turn !== sessionState.lastTurn + 1)
  ) {
    fail("Codex session state does not match this generation or next turn.");
  }
  if (sessionState !== undefined) {
    const initialTranscriptNames = (await readdir(manifest.paths.transcripts))
      .filter((name) => name === "turn-01.jsonl")
      .sort((left, right) => left.localeCompare(right, "en"));
    if (initialTranscriptNames.length === 0) {
      fail("Codex session state has no initial launch transcript.");
    }
    const initialSessionIds = await Promise.all(
      initialTranscriptNames.map(async (name) =>
        extractCodexThreadId(await readFile(join(manifest.paths.transcripts, name), "utf8")),
      ),
    );
    if (!initialSessionIds.includes(sessionState.sessionId)) {
      fail("Codex session state is not bound to this generation's initial launch.");
    }
  }
  const step = sessionState === undefined ? manifest.launch.initial : manifest.launch.resume;
  const args = step.arguments.map((argument) =>
    argument === "<session-id>"
      ? (sessionState?.sessionId ?? fail("Resume launch requires generated session state."))
      : argument,
  );
  const registry = await loadLiveScenarioRegistry(manifest.paths.registry);
  const prompt = await promptBytes(
    promptFile,
    registry.scenarios.map(({ id }) => id),
    [manifest.paths.installationEntry],
  );
  const environment = createCodexJourneyEnvironment(process.env, manifest.launch.environment, {
    includeCanonicalBearingBin:
      manifest.scenario.composition.fixtureProfile !== "fresh-installation-repository",
  });
  const operatorCodexHome = await realpath(manifest.paths.operatorCodexHome);
  const version = await runProcess(step.program, ["--version"], environment, step.workingDirectory);
  if (version.exitCode !== 0 || version.stdout.trim().length === 0) {
    fail(version.stderr.trim() || "Codex CLI version lookup failed before tested behavior.");
  }
  const turnLabel = String(turn).padStart(2, "0");
  const transcriptPath = join(manifest.paths.transcripts, `turn-${turnLabel}.jsonl`);
  const stderrPath = join(manifest.paths.transcripts, `turn-${turnLabel}.stderr.log`);
  const observationPath = join(manifest.paths.observations, `turn-${turnLabel}.json`);
  await Promise.all([
    ensureMissing(transcriptPath),
    ensureMissing(stderrPath),
    ensureMissing(observationPath),
  ]);
  return {
    manifest,
    turn,
    turnLabel,
    sessionState,
    step,
    args,
    prompt,
    environment,
    operatorCodexHome,
    codexCliVersion: version.stdout.trim(),
    transcriptPath,
    stderrPath,
    observationPath,
  } as const;
};

const runPreparedCodexTurn = async (prepared: Awaited<ReturnType<typeof prepareCodexTurn>>) => {
  const startedAt = Date.now();
  const promptDirectory =
    prepared.manifest.paths.prompts[0] === undefined
      ? fail("Live Scenario prompt directory is unavailable.")
      : dirname(prepared.manifest.paths.prompts[0]);
  const result = await withLiveScenarioCoordinatorManifestHidden(
    {
      protectedPaths: [
        prepared.manifest.paths.manifest,
        prepared.manifest.paths.manifestDigest,
        promptDirectory,
        prepared.manifest.paths.observations,
        prepared.manifest.paths.transcripts,
        prepared.manifest.paths.sessionState,
        ...(prepared.manifest.paths.remoteInventories === undefined
          ? []
          : [prepared.manifest.paths.remoteInventories]),
      ],
      agentHome: prepared.manifest.paths.agentHome,
      repository: prepared.manifest.paths.repository,
    },
    () =>
      runProcess(
        prepared.step.program,
        [...prepared.args, prepared.prompt],
        prepared.environment,
        prepared.step.workingDirectory,
      ),
  );
  const endedAt = Date.now();
  const durationMs = endedAt - startedAt;
  const runtimeGitHubToken = prepared.environment["GH_TOKEN"];
  if (
    runtimeGitHubToken !== undefined &&
    (result.stdout.includes(runtimeGitHubToken) || result.stderr.includes(runtimeGitHubToken))
  ) {
    fail("GitHub credential appeared in Codex process output; transcript was not written.");
  }
  const ephemeralCapabilityValues = [
    prepared.environment["BEARING_GITHUB_BROKER_SOCKET"],
    prepared.environment["BEARING_GITHUB_BROKER_AUTH"],
  ].filter((value): value is string => value !== undefined);
  const output = {
    stdout: redactCodexE2EEphemeralCapabilities(result.stdout, ephemeralCapabilityValues),
    stderr: redactCodexE2EEphemeralCapabilities(result.stderr, ephemeralCapabilityValues),
  };
  assertCodexE2EOutputIsolation({
    ...output,
    operatorCodexHome: prepared.operatorCodexHome,
    ephemeralCapabilityValues,
  });
  await Promise.all([
    writeFile(prepared.transcriptPath, output.stdout, { flag: "wx" }),
    writeFile(prepared.stderrPath, output.stderr, { flag: "wx" }),
  ]);
  return {
    ...result,
    ...output,
    startedAt: new Date(startedAt).toISOString(),
    endedAt: new Date(endedAt).toISOString(),
    durationMs,
  };
};

const completeCodexTurn = async (
  prepared: Awaited<ReturnType<typeof prepareCodexTurn>>,
  result: Awaited<ReturnType<typeof runPreparedCodexTurn>>,
  observation: Readonly<{ invocationStarted: boolean; terminalBoundary: string }>,
) => {
  await writeFile(prepared.observationPath, `${JSON.stringify(observation, null, 2)}\n`, {
    flag: "wx",
  });
  const observedSessionId = extractCodexThreadId(result.stdout) ?? prepared.sessionState?.sessionId;
  if (observation.invocationStarted && observedSessionId !== undefined) {
    await writeCodexSessionState(prepared.manifest.paths.sessionState, {
      schemaVersion: 1,
      generationId: prepared.manifest.generationId,
      sessionId: observedSessionId,
      lastTurn: prepared.turn,
    });
  }
  const completed = !(
    result.exitCode !== 0 ||
    observedSessionId === undefined ||
    observation.terminalBoundary !== "turn.completed"
  );
  return Object.freeze({
    observation: prepared.observationPath,
    exitCode: result.exitCode,
    terminalBoundary: observation.terminalBoundary,
    completed,
  });
};

const expectedScenarioObservationPointers = async (
  manifest: Awaited<ReturnType<typeof verifyLiveScenarioGeneration>>,
  count: number,
) => {
  const expected = Array.from(
    { length: count },
    (_, index) => `turn-${String(index + 1).padStart(2, "0")}.json`,
  );
  const observed = (await readdir(manifest.paths.observations)).sort((left, right) =>
    left.localeCompare(right, "en"),
  );
  if (JSON.stringify(observed) !== JSON.stringify(expected)) {
    fail(
      "Live Scenario observations must be complete, contiguous, and contain one result per turn.",
    );
  }
  return expected.map((name) => `observations/${name}`);
};

const executionSummarySchema = z
  .object({
    schemaVersion: z.literal(1),
    generationId: z.string().uuid(),
    peakConcurrency: z.number().int().min(1).max(4),
    scenarios: z.array(
      z
        .object({
          scenarioId: liveScenarioIdSchema,
          state: z.literal("completed"),
        })
        .strict(),
    ),
  })
  .strict();

const readGenerationBasis = async (path: string) => {
  const generationPath = await realpath(resolve(path));
  if (basename(generationPath) !== "generation.json") {
    fail("Live Matrix Generation basis must use the canonical generation.json name.");
  }
  const basis = parseLiveMatrixGenerationBasis(JSON.parse(await readFile(generationPath, "utf8")));
  return Object.freeze({ generationPath, workspaceRoot: dirname(generationPath), basis });
};

const readPreparedGenerationManifests = async (
  generation: Awaited<ReturnType<typeof readGenerationBasis>>,
) => {
  const readbacks = new Map(
    generation.basis.preparedScenarios.map((readback) => [readback.scenarioId, readback]),
  );
  const manifests = await Promise.all(
    generation.basis.selectedScenarioIds.map(async (scenarioId) => {
      const manifestPath = join(
        generation.workspaceRoot,
        "scenarios",
        scenarioId,
        "scenario-manifest.json",
      );
      const manifest = await verifyLiveScenarioGeneration(manifestPath);
      const readback =
        readbacks.get(scenarioId) ?? fail(`Generation readback is missing: ${scenarioId}.`);
      if (
        manifest.generationId !== generation.basis.generationId ||
        manifest.scenario.id !== scenarioId ||
        manifest.startingStateSha256 !== readback.fixtureSha256 ||
        manifest.matrixDefinitionSha256 !== generation.basis.registryDefinitionSha256 ||
        liveScenarioMatrixPackageIdentitySha256(
          liveScenarioPackageEvidenceIdentity(manifest.package),
        ) !== generation.basis.package.identitySha256
      ) {
        fail(`Prepared Scenario contradicts its Generation basis: ${scenarioId}.`);
      }
      return manifest;
    }),
  );
  const sourceRoots = [...new Set(manifests.map(({ paths }) => paths.sourceRoot))];
  if (
    sourceRoots.length !== 1 ||
    (await liveScenarioHarnessIdentitySha256({ sourceRoot: sourceRoots[0] as string })) !==
      generation.basis.harnessIdentitySha256
  ) {
    fail("Live Matrix Harness identity changed after Generation preparation.");
  }
  return manifests;
};

const readGenerationExecution = async (
  generation: Awaited<ReturnType<typeof readGenerationBasis>>,
) => {
  const path = join(generation.workspaceRoot, "execution.json");
  const summary = executionSummarySchema.parse(JSON.parse(await readFile(path, "utf8")));
  const scenarioIds = summary.scenarios.map(({ scenarioId }) => scenarioId);
  if (
    summary.generationId !== generation.basis.generationId ||
    JSON.stringify(scenarioIds) !== JSON.stringify(generation.basis.selectedScenarioIds)
  ) {
    fail("Live Matrix execution summary contradicts its Generation basis.");
  }
  return Object.freeze({ path, summary });
};

const observedScenarioObservationPointers = async (
  manifest: Readonly<{
    paths: Readonly<{ observations: string; prompts: readonly string[] }>;
  }>,
) => {
  const observed = (await readdir(manifest.paths.observations))
    .filter((name) => /^turn-\d{2}\.json$/u.test(name))
    .sort((left, right) => left.localeCompare(right, "en"));
  const expected = Array.from(
    { length: observed.length },
    (_, index) => `turn-${String(index + 1).padStart(2, "0")}.json`,
  );
  if (
    observed.length > manifest.paths.prompts.length ||
    JSON.stringify(observed) !== JSON.stringify(expected)
  ) {
    fail("Live Scenario observations must be contiguous and start at Turn 1.");
  }
  return observed.map((name) => `observations/${name}`);
};

const runScenarioTurn = async (input: {
  manifest: CodexTurnManifest;
  turn: number;
  promptFile: string;
}) => {
  const turn = input.turn;
  if (!Number.isSafeInteger(turn) || turn <= 0) fail("Live Scenario turn must be positive.");
  const manifest = input.manifest;
  const currentManifest = await verifyLiveScenarioBehaviorBoundary(manifest.paths.manifest);
  if (
    currentManifest.generationId !== manifest.generationId ||
    currentManifest.scenario.id !== manifest.scenario.id ||
    JSON.stringify(currentManifest.launch) !== JSON.stringify(manifest.launch)
  ) {
    fail("Live Scenario manifest changed before its next Turn.");
  }
  const expectedPrompt = manifest.paths.prompts[turn - 1];
  if (expectedPrompt === undefined || resolve(input.promptFile) !== expectedPrompt) {
    fail("Live Scenario turn requires its generated natural-language prompt.");
  }
  const priorPointers = await expectedScenarioObservationPointers(manifest, turn - 1);
  const prepared = await prepareCodexTurn(manifest, turn, input.promptFile);
  const before = {
    repository: await snapshotDirectory(manifest.paths.repository),
    agentHome: await snapshotScenarioAgentHome(manifest.paths.agentHome),
  };
  if (turn > 1) {
    const pointer = priorPointers.at(-1) ?? fail("Previous Live Scenario turn is unavailable.");
    const previous =
      manifest.github === undefined
        ? await verifyLiveJourneyObservation({
            workspaceRoot: manifest.paths.workspaceRoot,
            pointer,
            expectedCodexCliVersion: prepared.codexCliVersion,
          })
        : (
            await verifyGitHubJourneyObservation({
              workspaceRoot: manifest.paths.workspaceRoot,
              pointer,
              expectedCodexCliVersion: prepared.codexCliVersion,
            })
          ).base;
    if (
      previous.state.after.repository !== before.repository ||
      previous.state.after.agentHome !== before.agentHome
    ) {
      fail("Live Scenario state changed outside the recorded turn chain.");
    }
  }
  let result: Awaited<ReturnType<typeof runPreparedCodexTurn>>;
  let remoteBeforeBytes: string | undefined;
  let remoteAfterBytes: string | undefined;
  if (manifest.github === undefined) {
    result = await runPreparedCodexTurn(prepared);
  } else {
    const remoteInventoryRoot =
      manifest.paths.remoteInventories ?? fail("GitHub remote inventory path is unavailable.");
    const beforePath = join(remoteInventoryRoot, `turn-${prepared.turnLabel}-before.json`);
    const afterPath = join(remoteInventoryRoot, `turn-${prepared.turnLabel}-after.json`);
    await ensureMissing(afterPath);
    const remoteBefore = await captureGitHubRemoteInventory({
      program: manifest.github.program,
      repositorySlug: manifest.github.repositorySlug,
      scopeKey: manifest.github.scopeKey,
    });
    remoteBeforeBytes = `${JSON.stringify(remoteBefore, null, 2)}\n`;
    await writeOrVerifyGitHubRemoteBaseline({ path: beforePath, bytes: remoteBeforeBytes });
    const broker = await startGitHubJourneyCredentialBroker({
      program: manifest.github.program,
      agentHome: manifest.paths.agentHome,
      repositoryRoot: manifest.paths.repository,
      repositorySlug: manifest.github.repositorySlug,
      scopeKey: manifest.github.scopeKey,
      preparedGitConfigSha256: manifest.github.preparedGitConfigSha256,
      baseEnvironment: prepared.environment,
    });
    try {
      result = await runPreparedCodexTurn({
        ...prepared,
        args: [...prepared.args, ...broker.codexArguments],
        environment: broker.environment,
      });
    } finally {
      await broker.stop();
    }
    const remoteAfter = await captureGitHubRemoteInventory({
      program: manifest.github.program,
      repositorySlug: manifest.github.repositorySlug,
      scopeKey: manifest.github.scopeKey,
    });
    remoteAfterBytes = `${JSON.stringify(remoteAfter, null, 2)}\n`;
    await writeFile(afterPath, remoteAfterBytes, { flag: "wx" });
  }
  const after = {
    repository: await snapshotDirectory(manifest.paths.repository),
    agentHome: await snapshotScenarioAgentHome(manifest.paths.agentHome),
  };
  const baseObservation = {
    turn,
    codexCliVersion: prepared.codexCliVersion,
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
    before,
    after,
    transcriptPointer: `transcripts/turn-${prepared.turnLabel}.jsonl`,
    stderrPointer: `transcripts/turn-${prepared.turnLabel}.stderr.log`,
    startedAt: result.startedAt,
    endedAt: result.endedAt,
    durationMs: result.durationMs,
  } as const;
  const observation =
    manifest.github === undefined
      ? createLiveJourneyObservation(baseObservation)
      : createGitHubJourneyObservation({
          ...baseObservation,
          remoteBeforePointer: `github/remote-inventories/turn-${prepared.turnLabel}-before.json`,
          remoteBeforeBytes:
            remoteBeforeBytes ?? fail("GitHub remote-before evidence is unavailable."),
          remoteAfterPointer: `github/remote-inventories/turn-${prepared.turnLabel}-after.json`,
          remoteAfterBytes:
            remoteAfterBytes ?? fail("GitHub remote-after evidence is unavailable."),
        });
  const terminal = await completeCodexTurn(prepared, result, observation);
  if (!terminal.completed) {
    fail(
      `Live Scenario ${manifest.scenario.id} Turn ${turn} did not reach a recorded terminal boundary.`,
    );
  }
  return terminal;
};

const runGeneration = async (): Promise<void> => {
  const generation = await readGenerationBasis(required("generation"));
  const executionPath = join(generation.workspaceRoot, "execution.json");
  await ensureMissing(executionPath);
  const manifests = await readPreparedGenerationManifests(generation);
  for (const manifest of manifests) {
    if (
      (await readdir(manifest.paths.observations)).length !== 0 ||
      (await readdir(manifest.paths.transcripts)).length !== 0
    ) {
      fail("A partially executed Matrix cannot be resumed; prepare a fresh Generation.");
    }
    await ensureMissing(manifest.paths.sessionState);
  }
  let generationFault: Readonly<{ scenarioId: string; reason: unknown }> | undefined;
  const scheduled = await runLiveMatrixSchedule(
    manifests.map((manifest) => {
      const resourceKey = liveScenarioResourceKeyForCapability(
        manifest.scenario.composition.capabilityProfile,
      );
      return {
        task: manifest,
        ...(resourceKey === undefined ? {} : { resourceKey }),
      };
    }),
    async (manifest) => {
      if (generationFault !== undefined) {
        throw new Error(
          `Generation already became invalid while running ${generationFault.scenarioId}.`,
        );
      }
      try {
        for (const [index, promptFile] of manifest.paths.prompts.entries()) {
          await runScenarioTurn({
            manifest,
            turn: index + 1,
            promptFile,
          });
        }
        return manifest.scenario.id;
      } catch (reason) {
        generationFault ??= { scenarioId: manifest.scenario.id, reason };
        throw reason;
      }
    },
  );
  if (generationFault !== undefined) {
    const diagnostic =
      generationFault.reason instanceof Error
        ? generationFault.reason.message
        : String(generationFault.reason);
    fail(
      `Live Matrix Generation is invalid because ${generationFault.scenarioId} execution failed: ${diagnostic || "unknown failure"}. Prepare a fresh Generation.`,
    );
  }
  const summary = executionSummarySchema.parse({
    schemaVersion: 1,
    generationId: generation.basis.generationId,
    peakConcurrency: scheduled.peakConcurrency,
    scenarios: scheduled.results.map(({ task }) => ({
      scenarioId: task.scenario.id,
      state: "completed" as const,
    })),
  });
  await writeFile(
    executionPath,
    scanLiveScenarioDurableEvidence({ value: summary, configPath: resolve(".gitleaks.toml") }),
    { flag: "wx" },
  );
  process.stdout.write(
    `${JSON.stringify({
      generationId: summary.generationId,
      execution: executionPath,
      peakConcurrency: summary.peakConcurrency,
      scenarios: summary.scenarios,
    })}\n`,
  );
};

const evaluateScenario = async (): Promise<void> => {
  const generation = await readGenerationBasis(required("generation"));
  const evidenceRoot = dirname(generation.workspaceRoot);
  const execution = await readGenerationExecution(generation);
  const manifest = await verifyLiveScenarioBehaviorBoundary(resolve(required("manifest")), {
    behaviorCompleted: true,
  });
  const output = resolve(required("output"));
  await ensureMissing(output);
  const readback = generation.basis.preparedScenarios.find(
    ({ scenarioId }) => scenarioId === manifest.scenario.id,
  );
  const executionScenario = execution.summary.scenarios.find(
    ({ scenarioId }) => scenarioId === manifest.scenario.id,
  );
  if (
    manifest.generationId !== generation.basis.generationId ||
    readback === undefined ||
    readback.fixtureSha256 !== manifest.startingStateSha256 ||
    executionScenario === undefined ||
    (await liveScenarioHarnessIdentitySha256({ sourceRoot: manifest.paths.sourceRoot })) !==
      generation.basis.harnessIdentitySha256
  ) {
    fail("Live Scenario evaluation contradicts its Generation basis.");
  }
  const pointers = await observedScenarioObservationPointers(manifest);
  const observations = new Map();
  const githubObservations = new Map<
    string,
    Awaited<ReturnType<typeof verifyGitHubJourneyObservation>>
  >();
  let codexCliVersion: string | undefined;
  for (const pointer of pointers) {
    if (codexCliVersion === undefined) {
      const firstObservation = JSON.parse(
        (await readGeneratedEvidenceFile(manifest.paths.workspaceRoot, pointer)).bytes.toString(
          "utf8",
        ),
      ) as Readonly<{ codex?: Readonly<{ cliVersion?: unknown }> }>;
      codexCliVersion =
        typeof firstObservation.codex?.cliVersion === "string"
          ? firstObservation.codex.cliVersion
          : fail("Live Scenario observation has no Codex CLI version.");
    }
    if (manifest.github === undefined) {
      observations.set(
        pointer,
        await verifyLiveJourneyObservation({
          workspaceRoot: manifest.paths.workspaceRoot,
          pointer,
          expectedCodexCliVersion: codexCliVersion,
        }),
      );
    } else {
      const verified = await verifyGitHubJourneyObservation({
        workspaceRoot: manifest.paths.workspaceRoot,
        pointer,
        expectedCodexCliVersion: codexCliVersion,
      });
      githubObservations.set(pointer, verified);
      observations.set(pointer, verified.base);
    }
  }
  const verdict = z
    .object({
      outcome: z.enum(["pass", "fail", "blocked"]),
      rationale: z.string().trim().min(1).max(800),
      requiredOutcomeObservations: z.array(z.unknown()).default([]),
      forbiddenOutcomeObservations: z.array(z.unknown()).default([]),
      authorizedRemoteIssueNumbers: z.array(z.number().int().positive()).max(24).optional(),
    })
    .strict()
    .parse(JSON.parse(await readFile(resolve(required("verdicts")), "utf8")));
  const fullTurnSet = pointers.length === manifest.paths.prompts.length;
  if (!fullTurnSet) {
    fail("Semantic Live Scenario verdict requires every declared Turn to complete.");
  }
  const evaluation = createLiveScenarioEvaluation({
    scenario: manifest.scenario,
    outcome: verdict.outcome,
    coordinatorIdentity: manifest.coordinatorIdentity,
    rationale: verdict.rationale,
    requiredOutcomeObservations: verdict.requiredOutcomeObservations,
    forbiddenOutcomeObservations: verdict.forbiddenOutcomeObservations,
  });
  const referencedPointers = [
    ...evaluation.requiredOutcomeObservations,
    ...evaluation.forbiddenOutcomeObservations,
  ].flatMap(({ evidencePointers }) => evidencePointers);
  if (
    referencedPointers.some((pointer) => !pointers.includes(pointer) || !observations.has(pointer))
  ) {
    fail("Live Scenario verdict references evidence outside the complete turn set.");
  }
  if (
    verdict.outcome === "pass" &&
    pointers.some((pointer) => !observationSupportsSemanticPass(observations.get(pointer)))
  ) {
    fail("Passing Live Scenario requires every expected Codex turn to complete cleanly.");
  }
  if (manifest.github !== undefined && pointers.length > 0) {
    const baselinePath =
      manifest.paths.baselineInventory ?? fail("GitHub baseline inventory is unavailable.");
    const baseline = JSON.parse(await readFile(baselinePath, "utf8"));
    const final =
      githubObservations.get(pointers.at(-1) as string)?.after ??
      fail("GitHub final remote observation is unavailable.");
    const authorizedIssueNumbers = verdict.authorizedRemoteIssueNumbers ?? [];
    if (new Set(authorizedIssueNumbers).size !== authorizedIssueNumbers.length) {
      fail("Authorized remote issues must be unique.");
    }
    if (verdict.outcome === "pass" && authorizedIssueNumbers.length === 0) {
      fail("Passing GitHub Scenario requires one fresh candidate-scoped native delivery.");
    }
    assertGitHubRemoteIntegrity({
      before: baseline,
      after: final,
      authorizedIssueNumbers,
      requireCandidateBranch: verdict.outcome === "pass",
    });
  }
  const orderedObservations = pointers.map(
    (pointer) =>
      observations.get(pointer) ?? fail(`Live Scenario observation is unavailable: ${pointer}.`),
  );
  const firstObservation =
    orderedObservations[0] ?? fail("Live Scenario has no completed Turn observation.");
  const lastObservation =
    orderedObservations.at(-1) ?? fail("Live Scenario has no completed Turn observation.");
  const result = createLiveMatrixScenarioTerminalResult({
    generationId: manifest.generationId,
    scenarioId: manifest.scenario.id,
    outcome: verdict.outcome,
    rationale: verdict.rationale,
    evidence: await Promise.all(
      pointers.map(async (pointer) => ({
        evidenceClass: "observation" as const,
        pointer: relative(evidenceRoot, join(manifest.paths.workspaceRoot, pointer)).replaceAll(
          "\\",
          "/",
        ),
        sha256: await sha256File(join(manifest.paths.workspaceRoot, pointer)),
      })),
    ),
    turns: orderedObservations.map((observation) => ({
      turnNumber: observation.turn,
      startedAt: observation.startedAt,
      endedAt: observation.endedAt,
    })),
    startedAt: firstObservation.startedAt,
    endedAt: lastObservation.endedAt,
  });
  const [outputParent, cleanupDirectories, cleanupSessionState] = await Promise.all([
    realpath(dirname(output)),
    Promise.all(
      [manifest.paths.transcripts, manifest.paths.runtimeRoot].map((path) => realpath(path)),
    ),
    Promise.resolve(resolve(manifest.paths.sessionState)),
  ]);
  const durableOutput = join(outputParent, basename(output));
  const outputRelation = relative(evidenceRoot, durableOutput);
  if (
    outputRelation === "" ||
    outputRelation === ".." ||
    outputRelation.startsWith(`..${sep}`) ||
    isAbsolute(outputRelation)
  ) {
    fail("Bounded Scenario result must stay inside its Matrix evidence root.");
  }
  const outputInCleanupDirectory = cleanupDirectories.some((directory) => {
    const relation = relative(directory, durableOutput);
    return (
      relation === "" ||
      (!isAbsolute(relation) && relation !== ".." && !relation.startsWith(`..${sep}`))
    );
  });
  if (outputInCleanupDirectory || durableOutput === cleanupSessionState) {
    fail("Bounded Scenario result cannot be written inside cleanup-owned storage.");
  }
  const durableResult = scanLiveScenarioDurableEvidence({
    value: result,
    configPath: resolve(".gitleaks.toml"),
  });
  await writeFile(durableOutput, durableResult, { flag: "wx" });
  await Promise.all([
    rm(manifest.paths.transcripts, { recursive: true }),
    rm(manifest.paths.runtimeRoot, { recursive: true }),
    rm(manifest.paths.sessionState, { force: true }),
  ]);
  process.stdout.write(
    `${JSON.stringify({ output: durableOutput, scenarioId: result.scenarioId, outcome: result.outcome })}\n`,
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
  const generation = await readGenerationBasis(required("generation"));
  const execution = await readGenerationExecution(generation);
  const sourceRoot = await realpath(resolve(required("source-root")));
  const trackedRegistryPath = join(sourceRoot, "validation/live-journey/registry.json");
  if ((await realpath(resolve(required("registry")))) !== (await realpath(trackedRegistryPath))) {
    fail("Matrix completion requires the tracked source registry.");
  }
  const registry = await loadLiveScenarioRegistry(trackedRegistryPath);
  const resultsRoot = await realpath(resolve(required("results")));
  const expectedNames = registry.scenarios.map(({ id }) => `${id}.json`);
  const observedNames = (await readdir(resultsRoot))
    .filter((name) => name.endsWith(".json"))
    .sort((left, right) => left.localeCompare(right, "en"));
  if (
    observedNames.length !== expectedNames.length ||
    expectedNames.some((name) => !observedNames.includes(name))
  ) {
    fail("Matrix result directory requires one exact JSON result per registered Scenario.");
  }
  const outputRoot = await realpath(dirname(output));
  if (outputRoot !== dirname(generation.workspaceRoot)) {
    fail("Matrix result must be written at its Generation evidence root.");
  }
  const scenarioResults = await Promise.all(
    expectedNames.map(async (name) => {
      const path = join(resultsRoot, name);
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
    peakConcurrency: execution.summary.peakConcurrency,
    endedAt: new Date().toISOString(),
  });
  await writeFile(
    output,
    scanLiveScenarioDurableEvidence({ value: result, configPath: resolve(".gitleaks.toml") }),
    { flag: "wx" },
  );
  await rm(execution.path);
  process.stdout.write(
    `${JSON.stringify({ output, outcome: result.terminalOutcome, scenarios: result.scenarios.length })}\n`,
  );
};

if (command === "prepare-generation") await prepareGeneration();
else if (command === "run-generation") await runGeneration();
else if (command === "evaluate-scenario") await evaluateScenario();
else if (command === "check-matrix-definition") await checkMatrixDefinition();
else if (command === "prepare-local-rehearsal") await prepareLocalRehearsal();
else if (command === "prepare-candidate-package") await prepareCandidatePackage();
else if (command === "configure-github-repository") await configureGitHubRepository();
else if (command === "complete-matrix") await completeMatrix();
else fail(`Unknown command: ${command}.\n${usage}`);
