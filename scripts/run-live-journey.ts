import { createHash } from "node:crypto";
import { chmod, lstat, mkdir, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import packageMetadata from "../package.json";
import { assertCodexE2EOutputIsolation } from "./codex-e2e-runtime";
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
import { inspectLiveScenarioMatrixStatus } from "./live-scenario-convergence";
import {
  liveScenarioPackageSchema,
  readLiveScenarioPackageBasis,
  scanLiveScenarioDurableEvidence,
  writeLiveScenarioPackageBasis,
} from "./live-scenario-evidence";
import {
  createLiveScenarioMatrixResult,
  createLiveScenarioResult,
  parseLiveScenarioAttemptDisposition,
} from "./live-scenario-generation";
import {
  createLiveScenarioEvaluation,
  loadLiveScenarioRegistry,
  preflightLiveScenarioRegistry,
} from "./live-scenario-registry";
import {
  assertLiveScenarioSourceCurrent,
  liveScenarioCandidateDefinitionDigest,
  liveScenarioDefinitionDigest,
  prepareLiveScenarioGeneration,
  verifyLiveScenarioGeneration,
} from "./live-scenario-runner";
import { assertCanonicalPackageBoundary } from "./release-boundary";
import { sha256File, verifyReleaseCandidate } from "./release-candidate-lib";

const usage = `Usage:
  bun scripts/run-live-journey.ts prepare-local-rehearsal \\
    --source-root <absolute-path> --package-output <absolute-new-path>

  bun scripts/run-live-journey.ts prepare-candidate-package \\
    --candidate-receipt <absolute-path> --tarball <absolute-path> \\
    --source-root <absolute-path> --package-output <absolute-new-path>

  bun scripts/run-live-journey.ts configure-github-repository \\
    --source-root <absolute-path> --github-repository <owner/name> [--github-program <path>]

  bun scripts/run-live-journey.ts preflight-matrix \\
    --source-root <absolute-path> --registry <checkout-relative-path>

  bun scripts/run-live-journey.ts matrix-status \\
    --source-root <absolute-path> --registry <checkout-relative-path> \\
    --generation-root <absolute-path>

  bun scripts/run-live-journey.ts prepare-scenario \\
    --source-root <absolute-path> --registry <checkout-relative-path> \\
    --scenario <scenario-id> --package-manifest <absolute-path> \\
    --workspace <absolute-new-path> --codex-home <absolute-path> \\
    [--generation-id <uuid>] [--codex-program <path>] \\
    [--github-checkout <absolute-path>] [--github-program <path>] \\
    [--journey-attempt <positive-integer>]

  bun scripts/run-live-journey.ts run-scenario-turn \\
    --manifest <absolute-path> --turn <positive-integer> --prompt-file <path|-> \\
    [--retry-reason <model|network|credential|harness>]

  bun scripts/run-live-journey.ts evaluate-scenario \\
    --manifest <absolute-path> --verdicts <absolute-path> \\
    --output <absolute-new-path>

  bun scripts/run-live-journey.ts complete-matrix \\
    --source-root <absolute-path> --registry <absolute-path> --results <absolute-directory> \\
    --output <absolute-new-path>
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
    scenario: { type: "string" },
    "package-manifest": { type: "string" },
    "generation-root": { type: "string" },
    "generation-id": { type: "string" },
    results: { type: "string" },
    "codex-home": { type: "string" },
    "codex-program": { type: "string" },
    "github-repository": { type: "string" },
    "github-checkout": { type: "string" },
    "github-program": { type: "string" },
    "journey-attempt": { type: "string" },
    manifest: { type: "string" },
    turn: { type: "string" },
    "prompt-file": { type: "string" },
    "retry-reason": { type: "string" },
    verdicts: { type: "string" },
    output: { type: "string" },
  },
});

const required = (name: keyof typeof parsed.values): string =>
  parsed.values[name] ?? fail(`Missing --${name}.`);

const positiveInteger = (value: string, label: string): number => {
  if (!/^[1-9][0-9]*$/u.test(value)) fail(`${label} must be a positive integer.`);
  const parsedValue = Number(value);
  if (!Number.isSafeInteger(parsedValue)) fail(`${label} must be a safe positive integer.`);
  return parsedValue;
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

const prepareScenario = async (): Promise<void> => {
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
  const prepared = await prepareLiveScenarioGeneration({
    sourceRoot,
    workspaceRoot: resolve(required("workspace")),
    operatorCodexHome: resolve(required("codex-home")),
    registryPath: required("registry"),
    scenarioId: required("scenario"),
    package: matrixPackage,
    ...(parsed.values["generation-id"] === undefined
      ? {}
      : { generationId: parsed.values["generation-id"] }),
    ...(parsed.values["codex-program"] === undefined
      ? {}
      : { codexProgram: parsed.values["codex-program"] }),
    ...(parsed.values["github-checkout"] === undefined
      ? {}
      : { githubCheckout: parsed.values["github-checkout"] }),
    ...(parsed.values["github-program"] === undefined
      ? {}
      : { githubProgram: parsed.values["github-program"] }),
    ...(parsed.values["journey-attempt"] === undefined
      ? {}
      : {
          journeyAttempt: positiveInteger(parsed.values["journey-attempt"], "--journey-attempt"),
        }),
  });
  process.stdout.write(
    `${JSON.stringify({
      generationId: prepared.generationId,
      scenarioId: prepared.scenario.id,
      manifest: prepared.paths.manifest,
      repository: prepared.paths.repository,
      prompts: prepared.paths.prompts,
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
  const matrixDefinitionSha256 = await liveScenarioDefinitionDigest({
    sourceRoot,
    registryPath: "validation/live-journey/registry.json",
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

const transcriptShowsTestedBehavior = (bytes: Buffer): boolean => {
  for (const line of bytes.toString("utf8").split(/\r?\n/u).filter(Boolean)) {
    let event: Readonly<{ type?: unknown; item?: Readonly<{ type?: unknown }> }>;
    try {
      event = JSON.parse(line);
    } catch {
      return true;
    }
    if (
      event.type === "thread.started" ||
      event.type === "turn.started" ||
      event.type === "turn.failed" ||
      event.type === "error" ||
      (event.type === "item.completed" && event.item?.type === "error")
    ) {
      continue;
    }
    return true;
  }
  return false;
};

const snapshotScenarioAgentHome = (agentHome: string): Promise<string> =>
  snapshotDirectory(agentHome, {
    excludeTrees: [".codex", "skill-directory/.system"],
  });

type CodexTurnManifest = Readonly<{
  generationId: string;
  paths: Readonly<{
    sourceRoot: string;
    manifest: string;
    manifestDigest: string;
    registry: string;
    installationEntry: string;
    agentHome: string;
    repository: string;
    prompts: readonly string[];
    sessionState: string;
    attempts: string;
    transcripts: string;
    observations: string;
    remoteInventories?: string | undefined;
  }>;
  launch: Readonly<{
    environment: Readonly<{ HOME: string; CODEX_HOME: string }>;
    initial: Readonly<{
      program: string;
      workingDirectory: string;
      arguments: readonly string[];
    }>;
    resume: Readonly<{
      program: string;
      workingDirectory: string;
      arguments: readonly string[];
    }>;
  }>;
}>;

const prepareCodexTurn = async (manifest: CodexTurnManifest, turn: number, attempt?: 1 | 2) => {
  const sessionState = await readCodexSessionState(manifest.paths.sessionState);
  if (sessionState === undefined && turn !== 1)
    fail("The first Codex Journey turn must be turn 1.");
  if (
    sessionState !== undefined &&
    (sessionState.generationId !== manifest.generationId ||
      (turn !== sessionState.lastTurn + 1 && !(attempt === 2 && turn === sessionState.lastTurn)))
  ) {
    fail("Codex session state does not match this generation or next turn.");
  }
  if (sessionState !== undefined) {
    const initialTranscriptNames = (await readdir(manifest.paths.transcripts))
      .filter((name) => /^turn-01(?:-attempt-0[12])?\.jsonl$/u.test(name))
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
    required("prompt-file"),
    registry.scenarios.map(({ id }) => id),
    [manifest.paths.installationEntry],
  );
  const environment = createCodexJourneyEnvironment(process.env, manifest.launch.environment);
  const operatorCodexHome = dirname(
    await realpath(join(manifest.launch.environment.CODEX_HOME, "auth.json")),
  );
  const version = await runProcess(step.program, ["--version"], environment, step.workingDirectory);
  if (version.exitCode !== 0 || version.stdout.trim().length === 0) {
    fail(version.stderr.trim() || "Codex CLI version lookup failed before tested behavior.");
  }
  const turnLabel = `${String(turn).padStart(2, "0")}${
    attempt === undefined ? "" : `-attempt-${String(attempt).padStart(2, "0")}`
  }`;
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
  const startedAt = performance.now();
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
        prepared.manifest.paths.attempts,
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
  const durationMs = Math.max(1, Math.round(performance.now() - startedAt));
  const runtimeGitHubToken = prepared.environment["GH_TOKEN"];
  if (
    runtimeGitHubToken !== undefined &&
    (result.stdout.includes(runtimeGitHubToken) || result.stderr.includes(runtimeGitHubToken))
  ) {
    fail("GitHub credential appeared in Codex process output; transcript was not written.");
  }
  assertCodexE2EOutputIsolation({
    stdout: result.stdout,
    stderr: result.stderr,
    operatorCodexHome: prepared.operatorCodexHome,
  });
  await Promise.all([
    writeFile(prepared.transcriptPath, result.stdout, { flag: "wx" }),
    writeFile(prepared.stderrPath, result.stderr, { flag: "wx" }),
  ]);
  return { ...result, durationMs };
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
  process.stdout.write(
    `${JSON.stringify({
      observation: prepared.observationPath,
      exitCode: result.exitCode,
      terminalBoundary: observation.terminalBoundary,
    })}\n`,
  );
  if (
    result.exitCode !== 0 ||
    observedSessionId === undefined ||
    !["turn.completed", "turn.failed"].includes(observation.terminalBoundary)
  ) {
    process.exitCode = 1;
  }
};

const expectedScenarioObservationPointers = async (
  manifest: Awaited<ReturnType<typeof verifyLiveScenarioGeneration>>,
  count: number,
  retryTurn?: number,
) => {
  const names = await readdir(manifest.paths.observations);
  const parsed = names.map((name) => {
    const match =
      /^turn-([0-9]{2,})-attempt-(0[12])\.json$/u.exec(name) ??
      fail(`Live Scenario observation name is invalid: ${name}.`);
    return { name, turn: Number(match[1]), attempt: Number(match[2]) };
  });
  if (parsed.some(({ turn }) => turn > count && turn !== retryTurn)) {
    fail("Live Scenario observations must be complete, contiguous, and bounded to expected turns.");
  }
  const pointers: string[] = [];
  for (let turn = 1; turn <= count; turn += 1) {
    const attempts = parsed
      .filter((entry) => entry.turn === turn)
      .sort((left, right) => left.attempt - right.attempt);
    if (
      attempts.length === 0 ||
      attempts.length > 2 ||
      attempts.some((entry, index) => entry.attempt !== index + 1)
    ) {
      fail("Live Scenario observations must have one or two contiguous attempts per turn.");
    }
    pointers.push(`observations/${attempts.at(-1)?.name}`);
  }
  return pointers;
};

const allScenarioObservationPointers = async (
  manifest: Awaited<ReturnType<typeof verifyLiveScenarioGeneration>>,
) =>
  (await readdir(manifest.paths.observations))
    .map((name) => {
      const match =
        /^turn-([0-9]{2,})-attempt-(0[12])\.json$/u.exec(name) ??
        fail(`Live Scenario observation name is invalid: ${name}.`);
      return { name, turn: Number(match[1]), attempt: Number(match[2]) };
    })
    .sort((left, right) => left.turn - right.turn || left.attempt - right.attempt)
    .map(({ name }) => `observations/${name}`);

const runScenarioTurn = async (): Promise<void> => {
  const turn = positiveInteger(required("turn"), "--turn");
  const manifest = await verifyLiveScenarioGeneration(resolve(required("manifest")));
  const expectedPrompt = manifest.paths.prompts[turn - 1];
  if (expectedPrompt === undefined || resolve(required("prompt-file")) !== expectedPrompt) {
    fail("Live Scenario turn requires its generated natural-language prompt.");
  }
  const retryReason = z
    .enum(["model", "network", "credential", "harness"])
    .optional()
    .parse(parsed.values["retry-reason"]);
  const harnessRetry = retryReason === "harness";
  const turnPrefix = `turn-${String(turn).padStart(2, "0")}-attempt-`;
  const existingAttempts = (await readdir(manifest.paths.observations))
    .filter((name) => name.startsWith(turnPrefix))
    .sort((left, right) => left.localeCompare(right, "en"));
  const attempt = retryReason === undefined ? 1 : 2;
  if (
    (attempt === 1 && existingAttempts.length !== 0) ||
    (attempt === 2 &&
      (existingAttempts.length !== 1 || existingAttempts[0] !== `${turnPrefix}01.json`))
  ) {
    fail("Live Scenario turn attempt does not match its bounded retry history.");
  }
  const priorPointers = await expectedScenarioObservationPointers(
    manifest,
    attempt === 2 ? turn : turn - 1,
    attempt === 2 ? turn : undefined,
  );
  const prepared = await prepareCodexTurn(manifest, turn, attempt);
  const before = {
    repository: await snapshotDirectory(manifest.paths.repository),
    agentHome: await snapshotScenarioAgentHome(manifest.paths.agentHome),
  };
  let retryGitHubObservation:
    | Awaited<ReturnType<typeof verifyGitHubJourneyObservation>>
    | undefined;
  if (attempt === 2) {
    const firstPointer = `observations/${turnPrefix}01.json`;
    const first =
      manifest.github === undefined
        ? await verifyLiveJourneyObservation({
            workspaceRoot: manifest.paths.workspaceRoot,
            pointer: firstPointer,
            expectedCodexCliVersion: prepared.codexCliVersion,
          })
        : await verifyGitHubJourneyObservation({
            workspaceRoot: manifest.paths.workspaceRoot,
            pointer: firstPointer,
            expectedCodexCliVersion: prepared.codexCliVersion,
          });
    const base = "base" in first ? first.base : first;
    const firstTranscript = await readGeneratedEvidenceFile(
      manifest.paths.workspaceRoot,
      base.privateEvidence.transcript.pointer,
    );
    const testedBehaviorStarted = transcriptShowsTestedBehavior(firstTranscript.bytes);
    if (
      base.state.after.repository !== before.repository ||
      (!harnessRetry &&
        (base.state.after.agentHome !== before.agentHome ||
          testedBehaviorStarted ||
          base.state.before.repository !== base.state.after.repository ||
          base.state.before.agentHome !== base.state.after.agentHome))
    ) {
      fail(
        "Live Scenario retry cannot resume from unrecorded state or advanced non-harness behavior.",
      );
    }
    if ("base" in first) {
      retryGitHubObservation = first;
      if (JSON.stringify(first.before) !== JSON.stringify(first.after)) {
        fail("GitHub Live Scenario retry requires unchanged remote state.");
      }
    }
    const firstPath = join(manifest.paths.workspaceRoot, firstPointer);
    await writeFile(
      join(manifest.paths.attempts, `turn-${String(turn).padStart(2, "0")}.json`),
      `${JSON.stringify(
        {
          schemaVersion: 1,
          turn,
          reason: retryReason,
          testedBehaviorStarted,
          priorObservation: { pointer: firstPointer, sha256: await sha256File(firstPath) },
        },
        null,
        2,
      )}\n`,
      { flag: "wx" },
    );
  }
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
      (!harnessRetry && previous.state.after.agentHome !== before.agentHome)
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
    if (
      retryGitHubObservation !== undefined &&
      JSON.stringify(retryGitHubObservation.after) !== JSON.stringify(remoteBefore)
    ) {
      fail("GitHub remote state changed before the bounded retry.");
    }
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
  await completeCodexTurn(prepared, result, observation);
};

const evaluateScenario = async (): Promise<void> => {
  const manifest = await verifyLiveScenarioGeneration(resolve(required("manifest")));
  const output = resolve(required("output"));
  await ensureMissing(output);
  const pointers = await expectedScenarioObservationPointers(
    manifest,
    manifest.paths.prompts.length,
  );
  const allPointers = await allScenarioObservationPointers(manifest);
  const firstObservation = JSON.parse(
    (
      await readGeneratedEvidenceFile(manifest.paths.workspaceRoot, pointers[0] as string)
    ).bytes.toString("utf8"),
  ) as Readonly<{ codex?: Readonly<{ cliVersion?: unknown }> }>;
  const codexCliVersion =
    typeof firstObservation.codex?.cliVersion === "string"
      ? firstObservation.codex.cliVersion
      : fail("Live Scenario observation has no Codex CLI version.");
  const observations = new Map();
  const githubObservations = new Map<
    string,
    Awaited<ReturnType<typeof verifyGitHubJourneyObservation>>
  >();
  for (const pointer of allPointers) {
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
  const verdict = JSON.parse(await readFile(resolve(required("verdicts")), "utf8")) as Readonly<{
    outcome?: unknown;
    rationale?: unknown;
    requiredOutcomeObservations?: readonly unknown[];
    forbiddenOutcomeObservations?: readonly unknown[];
    authorizedRemoteIssueNumbers?: unknown;
  }>;
  const evaluation = createLiveScenarioEvaluation({
    scenario: manifest.scenario,
    outcome: verdict.outcome as "pass" | "fail" | "blocked" | "not-run",
    coordinatorIdentity: manifest.coordinatorIdentity,
    rationale: verdict.rationale as string,
    requiredOutcomeObservations: verdict.requiredOutcomeObservations ?? [],
    forbiddenOutcomeObservations: verdict.forbiddenOutcomeObservations ?? [],
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
    evaluation.outcome === "pass" &&
    pointers.some((pointer) => !observationSupportsSemanticPass(observations.get(pointer)))
  ) {
    fail("Passing Live Scenario requires every expected Codex turn to complete cleanly.");
  }
  const attemptNames = (await readdir(manifest.paths.attempts)).sort((left, right) =>
    left.localeCompare(right, "en"),
  );
  const retriedTurns = allPointers
    .filter((pointer) => pointer.endsWith("-attempt-02.json"))
    .map((pointer) => Number(/turn-([0-9]{2,})-/u.exec(pointer)?.[1]));
  if (
    attemptNames.length !== retriedTurns.length ||
    attemptNames.some(
      (name, index) => name !== `turn-${String(retriedTurns[index]).padStart(2, "0")}.json`,
    )
  ) {
    fail("Live Scenario retry ledger does not match its observed attempts.");
  }
  const attempts = await Promise.all(
    attemptNames.map(async (name) => {
      const disposition = parseLiveScenarioAttemptDisposition(
        JSON.parse(await readFile(join(manifest.paths.attempts, name), "utf8")),
      );
      const expectedPointer = `observations/turn-${String(disposition.turn).padStart(2, "0")}-attempt-01.json`;
      const prior = await readGeneratedEvidenceFile(
        manifest.paths.workspaceRoot,
        disposition.priorObservation.pointer,
      );
      if (
        disposition.priorObservation.pointer !== expectedPointer ||
        disposition.priorObservation.sha256 !==
          createHash("sha256").update(prior.bytes).digest("hex")
      ) {
        fail(
          `Live Scenario retry disposition is not bound to attempt 1: turn ${disposition.turn}.`,
        );
      }
      const observation = observations.get(expectedPointer);
      const transcript =
        observation === undefined
          ? undefined
          : await readGeneratedEvidenceFile(
              manifest.paths.workspaceRoot,
              observation.privateEvidence.transcript.pointer,
            );
      const testedBehaviorStarted =
        transcript === undefined ? undefined : transcriptShowsTestedBehavior(transcript.bytes);
      if (
        observation === undefined ||
        testedBehaviorStarted === undefined ||
        disposition.testedBehaviorStarted !== testedBehaviorStarted ||
        (disposition.reason !== "harness" &&
          (observation.state.before.repository !== observation.state.after.repository ||
            testedBehaviorStarted ||
            observation.state.before.agentHome !== observation.state.after.agentHome))
      ) {
        fail(
          `Live Scenario retry disposition contradicts visible state: turn ${disposition.turn}.`,
        );
      }
      const githubObservation = githubObservations.get(expectedPointer);
      if (
        githubObservation !== undefined &&
        JSON.stringify(githubObservation.before) !== JSON.stringify(githubObservation.after)
      ) {
        fail(`GitHub retry disposition contradicts remote state: turn ${disposition.turn}.`);
      }
      return disposition;
    }),
  );
  let remoteIntegrity: ReturnType<typeof assertGitHubRemoteIntegrity> | undefined;
  if (manifest.github !== undefined) {
    const baselinePath =
      manifest.paths.baselineInventory ?? fail("GitHub baseline inventory is unavailable.");
    const baseline = JSON.parse(await readFile(baselinePath, "utf8"));
    const final =
      githubObservations.get(pointers.at(-1) as string)?.after ??
      fail("GitHub final remote observation is unavailable.");
    const authorizedIssueNumbers = z
      .array(z.number().int().positive())
      .max(24)
      .superRefine((numbers, context) => {
        if (new Set(numbers).size !== numbers.length) {
          context.addIssue({ code: "custom", message: "Authorized remote issues must be unique." });
        }
      })
      .parse(verdict.authorizedRemoteIssueNumbers);
    if (evaluation.outcome === "pass" && authorizedIssueNumbers.length === 0) {
      fail("Passing GitHub Scenario requires one fresh candidate-scoped native delivery.");
    }
    remoteIntegrity = assertGitHubRemoteIntegrity({
      before: baseline,
      after: final,
      authorizedIssueNumbers,
      requireCandidateBranch: evaluation.outcome === "pass",
    });
  }
  const result = createLiveScenarioResult({
    evidenceClass: manifest.evidenceClass,
    generationId: manifest.generationId,
    package: manifest.package,
    matrixDefinitionSha256: manifest.matrixDefinitionSha256,
    codexCliVersion,
    coordinatorIdentity: manifest.coordinatorIdentity,
    startingStateSha256: manifest.startingStateSha256,
    durationMs: [...observations.values()].reduce(
      (total, observation) => total + observation.durationMs,
      0,
    ),
    evaluation,
    remoteIntegrity,
    attempts,
  });
  const [outputParent, cleanupDirectories, cleanupSessionState] = await Promise.all([
    realpath(dirname(output)),
    Promise.all(
      [manifest.paths.transcripts, manifest.paths.runtimeRoot].map((path) => realpath(path)),
    ),
    realpath(manifest.paths.sessionState),
  ]);
  const durableOutput = join(outputParent, basename(output));
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
    `${JSON.stringify({ output: durableOutput, scenarioId: result.scenarioId, outcome: result.evaluation.outcome })}\n`,
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

const preflightMatrix = async (): Promise<void> => {
  const result = await preflightLiveScenarioRegistry({
    sourceRoot: resolve(required("source-root")),
    registryPath: required("registry"),
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
};

const matrixStatus = async (): Promise<void> => {
  const result = await inspectLiveScenarioMatrixStatus({
    sourceRoot: resolve(required("source-root")),
    registryPath: required("registry"),
    generationRoot: resolve(required("generation-root")),
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
};

const completeMatrix = async (): Promise<void> => {
  const output = resolve(required("output"));
  await ensureMissing(output);
  const sourceRoot = await realpath(resolve(required("source-root")));
  const trackedRegistryPath = join(sourceRoot, "validation/live-journey/registry.json");
  if ((await realpath(resolve(required("registry")))) !== (await realpath(trackedRegistryPath))) {
    fail("Matrix completion requires the tracked source registry.");
  }
  const registry = await loadLiveScenarioRegistry(trackedRegistryPath);
  const resultsRoot = resolve(required("results"));
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
  const outputRoot = dirname(output);
  const scenarioResults = await Promise.all(
    expectedNames.map(async (name) => {
      const path = join(resultsRoot, name);
      return {
        result: JSON.parse(await readFile(path, "utf8")),
        pointer: relative(outputRoot, path).replaceAll("\\", "/"),
        sha256: await sha256File(path),
      };
    }),
  );
  const result = createLiveScenarioMatrixResult({ registry, scenarioResults });
  await assertLiveScenarioSourceCurrent(sourceRoot, result.package);
  if (
    (await liveScenarioDefinitionDigest({
      sourceRoot,
      registryPath: "validation/live-journey/registry.json",
    })) !== result.matrixDefinitionSha256
  ) {
    fail("Matrix completion source definition does not match the Scenario result identity.");
  }
  await writeFile(
    output,
    scanLiveScenarioDurableEvidence({ value: result, configPath: resolve(".gitleaks.toml") }),
    { flag: "wx" },
  );
  process.stdout.write(
    `${JSON.stringify({ output, outcome: result.terminalOutcome, scenarios: result.scenarios.length })}\n`,
  );
};

if (command === "prepare-scenario") await prepareScenario();
else if (command === "run-scenario-turn") await runScenarioTurn();
else if (command === "evaluate-scenario") await evaluateScenario();
else if (command === "preflight-matrix") await preflightMatrix();
else if (command === "matrix-status") await matrixStatus();
else if (command === "prepare-local-rehearsal") await prepareLocalRehearsal();
else if (command === "prepare-candidate-package") await prepareCandidatePackage();
else if (command === "configure-github-repository") await configureGitHubRepository();
else if (command === "complete-matrix") await completeMatrix();
else fail(`Unknown command: ${command}.\n${usage}`);
