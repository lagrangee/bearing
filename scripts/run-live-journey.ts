import { lstat, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import { inspectCodexE2EOperatorContext } from "./codex-e2e-runtime";
import {
  assertGitHubRemoteIntegrity,
  captureGitHubRemoteInventory,
  configureFixedGitHubValidationRepository,
  createGitHubJourneyEvaluation,
  createGitHubJourneyObservation,
  prepareGitHubJourneyGeneration,
  readGitHubJourneyGeneration,
  validateGitHubJourneyVerdicts,
  verifyGitHubJourneyGeneration,
  verifyGitHubJourneyObservation,
} from "./github-live-journey";
import {
  assertJourneyAgentPrompt,
  createCleanJourneyEvaluation,
  createCodexJourneyEnvironment,
  createLiveJourneyObservation,
  extractCodexThreadId,
  matrixDefinitionDigest,
  observationSupportsSemanticPass,
  prepareCleanJourneyGeneration,
  readCleanJourneyGeneration,
  readCodexSessionState,
  snapshotDirectory,
  verifyCleanJourneyGeneration,
  verifyLiveJourneyObservation,
  writeCodexSessionState,
} from "./live-journey-matrix";
import { sha256File, verifyReleaseCandidate } from "./release-candidate-lib";

const usage = `Usage:
  bun scripts/run-live-journey.ts prepare-clean \\
    --candidate-receipt <absolute-path> --tarball <absolute-path> \\
    --source-root <absolute-path> --workspace <absolute-new-path> \\
    --codex-home <absolute-path> [--codex-program <path>]

  bun scripts/run-live-journey.ts run-clean-turn \\
    --manifest <absolute-path> --turn <positive-integer> --prompt-file <path|->

  bun scripts/run-live-journey.ts evaluate-clean \\
    --manifest <absolute-path> --verdicts <absolute-path> \\
    --codex-cli-version <version> --coordinator-identity <identity> \\
    --duration-ms <non-negative-integer> --output <absolute-new-path>

  bun scripts/run-live-journey.ts configure-github-repository \\
    --source-root <absolute-path> --github-repository <owner/name> [--github-program <path>]

  bun scripts/run-live-journey.ts prepare-github \\
    --clean-manifest <absolute-path> \\
    --github-checkout <absolute-path> [--github-program <path>] [--codex-program <path>]

  bun scripts/run-live-journey.ts run-github-turn \\
    --manifest <absolute-path> --turn <positive-integer> --prompt-file <path|->

  bun scripts/run-live-journey.ts evaluate-github \\
    --manifest <absolute-path> --verdicts <absolute-path> \\
    --authorized-issues <absolute-json-array-path> \\
    --codex-cli-version <version> --coordinator-identity <identity> \\
    --duration-ms <non-negative-integer> --output <absolute-new-path>
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
    "codex-home": { type: "string" },
    "codex-program": { type: "string" },
    "clean-manifest": { type: "string" },
    "github-repository": { type: "string" },
    "github-checkout": { type: "string" },
    "github-program": { type: "string" },
    manifest: { type: "string" },
    turn: { type: "string" },
    "prompt-file": { type: "string" },
    verdicts: { type: "string" },
    "codex-cli-version": { type: "string" },
    "coordinator-identity": { type: "string" },
    "duration-ms": { type: "string" },
    "authorized-issues": { type: "string" },
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

const nonNegativeInteger = (value: string, label: string): number => {
  if (!/^(?:0|[1-9][0-9]*)$/u.test(value)) fail(`${label} must be a non-negative integer.`);
  const parsedValue = Number(value);
  if (!Number.isSafeInteger(parsedValue)) fail(`${label} must be a safe non-negative integer.`);
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

const runProcess = async (
  program: string,
  args: readonly string[],
  environment: Readonly<Record<string, string>>,
) => {
  const child = Bun.spawn([program, ...args], {
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

const prepareClean = async (): Promise<void> => {
  const receiptPath = resolve(required("candidate-receipt"));
  const explicitTarball = await realpath(resolve(required("tarball")));
  const sourceRoot = await realpath(resolve(required("source-root")));
  const workspaceRoot = resolve(required("workspace"));
  const codexHome = await realpath(resolve(required("codex-home")));
  const receipt = await verifyReleaseCandidate(receiptPath, { repositoryRoot: sourceRoot });
  if (receipt.packageName !== "@lagrangee/bearing") {
    fail("Candidate Receipt package name is not @lagrangee/bearing.");
  }
  const receiptTarball = await realpath(join(dirname(receiptPath), receipt.artifact.file));
  if (explicitTarball !== receiptTarball) {
    fail("Explicit tarball locator does not match the Candidate Receipt.");
  }
  const operatorContext = await inspectCodexE2EOperatorContext(codexHome);
  const prepared = await prepareCleanJourneyGeneration({
    sourceRoot,
    workspaceRoot,
    codexHome,
    candidate: {
      packageName: "@lagrangee/bearing",
      packageVersion: receipt.packageVersion,
      sourceCommit: receipt.sourceCommit,
      workflow: receipt.workflow,
      artifact: {
        path: receiptTarball,
        file: receipt.artifact.file,
        sha256: receipt.artifact.sha256,
      },
      matrixDefinitionSha256: await matrixDefinitionDigest(
        join(sourceRoot, "validation/live-journey/matrix.json"),
      ),
    },
    candidateReceipt: { path: receiptPath, sha256: await sha256File(receiptPath) },
    disabledOperatorSkillPaths: operatorContext.disabledSkills.map(({ locator }) => locator),
    operatorContextFingerprint: operatorContext.fingerprint,
    ...(parsed.values["codex-program"] === undefined
      ? {}
      : { codexProgram: parsed.values["codex-program"] }),
  });
  process.stdout.write(
    `${JSON.stringify({
      candidateManifest: prepared.paths.candidateManifest,
      overlay: prepared.paths.overlay,
      repository: prepared.paths.repository,
      operatorContextFingerprint: operatorContext.fingerprint,
    })}\n`,
  );
};

const verifiedGeneration = async (manifestPath: string) => {
  const manifest = await verifyCleanJourneyGeneration(
    await readCleanJourneyGeneration(manifestPath),
  );
  const receipt = await verifyReleaseCandidate(manifest.candidateReceipt.path, {
    repositoryRoot: manifest.paths.sourceRoot,
  });
  const receiptTarball = await realpath(
    join(dirname(manifest.candidateReceipt.path), receipt.artifact.file),
  );
  if (
    receipt.packageName !== manifest.candidate.packageName ||
    receipt.packageVersion !== manifest.candidate.packageVersion ||
    receipt.sourceCommit !== manifest.candidate.sourceCommit ||
    JSON.stringify(receipt.workflow) !== JSON.stringify(manifest.candidate.workflow) ||
    receipt.artifact.file !== manifest.candidate.artifact.file ||
    receipt.artifact.sha256 !== manifest.candidate.artifact.sha256 ||
    receiptTarball !== manifest.candidate.artifact.path
  ) {
    fail("Candidate Manifest identity does not match the verified Candidate Receipt.");
  }
  return manifest;
};

const verifiedGitHubGeneration = async (manifestPath: string) =>
  verifyGitHubJourneyGeneration(await readGitHubJourneyGeneration(manifestPath));

const promptBytes = async (path: string): Promise<string> => {
  const prompt =
    path === "-"
      ? await new Response(Bun.stdin.stream()).text()
      : await readFile(resolve(path), "utf8");
  return assertJourneyAgentPrompt(prompt.endsWith("\n") ? prompt.slice(0, -1) : prompt);
};

type CodexTurnManifest = Readonly<{
  generationId: string;
  paths: Readonly<{
    sessionState: string;
    transcripts: string;
    observations: string;
  }>;
  launch: Readonly<{
    environment: Readonly<{ HOME: string; CODEX_HOME: string }>;
    initial: Readonly<{ program: string; arguments: readonly string[] }>;
    resume: Readonly<{ program: string; arguments: readonly string[] }>;
  }>;
}>;

const prepareCodexTurn = async (manifest: CodexTurnManifest, turn: number) => {
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
    const initialTranscript = await readFile(
      join(manifest.paths.transcripts, "turn-01.jsonl"),
      "utf8",
    );
    if (extractCodexThreadId(initialTranscript) !== sessionState.sessionId) {
      fail("Codex session state is not bound to this generation's initial launch.");
    }
  }
  const step = sessionState === undefined ? manifest.launch.initial : manifest.launch.resume;
  const args = step.arguments.map((argument) =>
    argument === "<session-id>"
      ? (sessionState?.sessionId ?? fail("Resume launch requires generated session state."))
      : argument,
  );
  const prompt = await promptBytes(required("prompt-file"));
  const environment = createCodexJourneyEnvironment(process.env, manifest.launch.environment);
  const version = await runProcess(step.program, ["--version"], environment);
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
    codexCliVersion: version.stdout.trim(),
    transcriptPath,
    stderrPath,
    observationPath,
  } as const;
};

const runPreparedCodexTurn = async (prepared: Awaited<ReturnType<typeof prepareCodexTurn>>) => {
  const result = await runProcess(
    prepared.step.program,
    [...prepared.args, prepared.prompt],
    prepared.environment,
  );
  await Promise.all([
    writeFile(prepared.transcriptPath, result.stdout, { flag: "wx" }),
    writeFile(prepared.stderrPath, result.stderr, { flag: "wx" }),
  ]);
  return result;
};

const completeCodexTurn = async (
  prepared: Awaited<ReturnType<typeof prepareCodexTurn>>,
  result: Awaited<ReturnType<typeof runPreparedCodexTurn>>,
  observation: Readonly<{ terminalBoundary: string }>,
) => {
  await writeFile(prepared.observationPath, `${JSON.stringify(observation, null, 2)}\n`, {
    flag: "wx",
  });
  const observedSessionId = extractCodexThreadId(result.stdout) ?? prepared.sessionState?.sessionId;
  if (observedSessionId !== undefined) {
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

const runCleanTurn = async (): Promise<void> => {
  const turn = positiveInteger(required("turn"), "--turn");
  const manifest = await verifiedGeneration(resolve(required("manifest")));
  const prepared = await prepareCodexTurn(manifest, turn);
  const before = {
    repository: await snapshotDirectory(manifest.paths.repository),
    agentHome: await snapshotDirectory(manifest.paths.agentHome),
  };
  const result = await runPreparedCodexTurn(prepared);
  const after = {
    repository: await snapshotDirectory(manifest.paths.repository),
    agentHome: await snapshotDirectory(manifest.paths.agentHome),
  };
  const observation = createLiveJourneyObservation({
    turn,
    codexCliVersion: prepared.codexCliVersion,
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
    before,
    after,
    transcriptPointer: `transcripts/turn-${prepared.turnLabel}.jsonl`,
    stderrPointer: `transcripts/turn-${prepared.turnLabel}.stderr.log`,
  });
  await completeCodexTurn(prepared, result, observation);
};

const evaluateClean = async (): Promise<void> => {
  const manifest = await verifiedGeneration(resolve(required("manifest")));
  const verdicts = JSON.parse(await readFile(resolve(required("verdicts")), "utf8")) as unknown[];
  const output = resolve(required("output"));
  await ensureMissing(output);
  const codexCliVersion = required("codex-cli-version");
  const result = createCleanJourneyEvaluation({
    candidate: manifest.candidate,
    codexCliVersion,
    coordinatorIdentity: required("coordinator-identity"),
    durationMs: nonNegativeInteger(required("duration-ms"), "--duration-ms"),
    verdicts,
  });
  for (const verdict of result.cases) {
    const observations = [];
    for (const pointer of verdict.observationPointers) {
      observations.push(
        await verifyLiveJourneyObservation({
          workspaceRoot: manifest.paths.workspaceRoot,
          pointer,
          expectedCodexCliVersion: codexCliVersion,
        }),
      );
    }
    if (
      verdict.outcome === "pass" &&
      !observations.some((observation) => observationSupportsSemanticPass(observation))
    ) {
      fail(`Passing Case lacks a completed Codex observation: ${verdict.caseId}`);
    }
  }
  if (output.startsWith(`${manifest.paths.transcripts}/`)) {
    fail("Bounded result cannot be written inside private transcript storage.");
  }
  await writeFile(output, `${JSON.stringify(result, null, 2)}\n`, { flag: "wx" });
  await rm(manifest.paths.transcripts, { recursive: true });
  process.stdout.write(`${JSON.stringify({ output, outcome: result.outcome })}\n`);
};

const prepareGitHub = async (): Promise<void> => {
  const prepared = await prepareGitHubJourneyGeneration({
    cleanManifestPath: resolve(required("clean-manifest")),
    repositoryRoot: resolve(required("github-checkout")),
    ...(parsed.values["github-program"] === undefined
      ? {}
      : { githubProgram: parsed.values["github-program"] }),
    ...(parsed.values["codex-program"] === undefined
      ? {}
      : { codexProgram: parsed.values["codex-program"] }),
  });
  process.stdout.write(
    `${JSON.stringify({
      candidateManifest: prepared.paths.candidateManifest,
      repositoryIdentitySha256: prepared.github.repositoryIdentitySha256,
      scopeKey: prepared.github.scopeKey,
      viewerPermission: prepared.github.viewerPermission,
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

const runGitHubTurn = async (): Promise<void> => {
  const manifest = await verifiedGitHubGeneration(resolve(required("manifest")));
  const turn = positiveInteger(required("turn"), "--turn");
  const prepared = await prepareCodexTurn(manifest, turn);
  const remoteBeforePath = join(
    manifest.paths.remoteInventories,
    `turn-${prepared.turnLabel}-before.json`,
  );
  const remoteAfterPath = join(
    manifest.paths.remoteInventories,
    `turn-${prepared.turnLabel}-after.json`,
  );
  await Promise.all([ensureMissing(remoteBeforePath), ensureMissing(remoteAfterPath)]);
  const remoteBefore = await captureGitHubRemoteInventory({
    program: manifest.github.program,
    repositorySlug: manifest.github.repositorySlug,
    scopeKey: manifest.github.scopeKey,
  });
  const remoteBeforeBytes = `${JSON.stringify(remoteBefore, null, 2)}\n`;
  await writeFile(remoteBeforePath, remoteBeforeBytes, { flag: "wx" });
  const before = {
    repository: await snapshotDirectory(manifest.paths.repository),
    agentHome: await snapshotDirectory(manifest.paths.agentHome),
  };
  const result = await runPreparedCodexTurn(prepared);
  const after = {
    repository: await snapshotDirectory(manifest.paths.repository),
    agentHome: await snapshotDirectory(manifest.paths.agentHome),
  };
  const remoteAfter = await captureGitHubRemoteInventory({
    program: manifest.github.program,
    repositorySlug: manifest.github.repositorySlug,
    scopeKey: manifest.github.scopeKey,
  });
  const remoteAfterBytes = `${JSON.stringify(remoteAfter, null, 2)}\n`;
  await writeFile(remoteAfterPath, remoteAfterBytes, { flag: "wx" });
  const observation = createGitHubJourneyObservation({
    turn,
    codexCliVersion: prepared.codexCliVersion,
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
    before,
    after,
    transcriptPointer: `github/transcripts/turn-${prepared.turnLabel}.jsonl`,
    stderrPointer: `github/transcripts/turn-${prepared.turnLabel}.stderr.log`,
    remoteBeforePointer: `github/remote-inventories/turn-${prepared.turnLabel}-before.json`,
    remoteBeforeBytes,
    remoteAfterPointer: `github/remote-inventories/turn-${prepared.turnLabel}-after.json`,
    remoteAfterBytes,
  });
  await completeCodexTurn(prepared, result, observation);
};

const evaluateGitHub = async (): Promise<void> => {
  const manifest = await verifiedGitHubGeneration(resolve(required("manifest")));
  const verdicts = JSON.parse(await readFile(resolve(required("verdicts")), "utf8")) as unknown[];
  const authorizedIssueNumbers = z
    .array(z.number().int().positive())
    .parse(JSON.parse(await readFile(resolve(required("authorized-issues")), "utf8")));
  const output = resolve(required("output"));
  await ensureMissing(output);
  const codexCliVersion = required("codex-cli-version");
  const observationNames = (await readdir(manifest.paths.observations)).sort((left, right) =>
    left.localeCompare(right, "en"),
  );
  if (
    observationNames.length === 0 ||
    observationNames.some((name) => !/^turn-[0-9]{2,}\.json$/u.test(name))
  ) {
    fail("GitHub evaluation requires only generated turn observations.");
  }
  const ordered = [] as Awaited<ReturnType<typeof verifyGitHubJourneyObservation>>[];
  for (const [index, name] of observationNames.entries()) {
    const expectedName = `turn-${String(index + 1).padStart(2, "0")}.json`;
    if (name !== expectedName) fail("GitHub turn observations must be complete and contiguous.");
    ordered.push(
      await verifyGitHubJourneyObservation({
        workspaceRoot: manifest.paths.workspaceRoot,
        pointer: `github/observations/${name}`,
        expectedCodexCliVersion: codexCliVersion,
      }),
    );
  }
  if (ordered.length === 0) fail("GitHub evaluation requires at least one generated observation.");
  const finalObservation = ordered.at(-1) ?? fail("GitHub final observation is unavailable.");
  const generatedPointers = new Set(observationNames.map((name) => `github/observations/${name}`));
  for (const rawVerdict of verdicts) {
    const verdict = z.object({ observationPointers: z.array(z.string()) }).parse(rawVerdict);
    if (verdict.observationPointers.some((pointer) => !generatedPointers.has(pointer))) {
      fail("GitHub verdict references an observation outside the complete turn set.");
    }
  }
  const validatedVerdicts = validateGitHubJourneyVerdicts(verdicts);
  for (const verdict of validatedVerdicts) {
    if (
      verdict.outcome === "pass" &&
      !verdict.observationPointers.some((pointer) => {
        const matching = ordered.find((observation) =>
          pointer.endsWith(`turn-${String(observation.turn).padStart(2, "0")}.json`),
        );
        return matching !== undefined && observationSupportsSemanticPass(matching.base);
      })
    ) {
      fail(`Passing GitHub Case lacks a completed Codex observation: ${verdict.caseId}`);
    }
  }
  const baseline = JSON.parse(await readFile(manifest.paths.baselineInventory, "utf8"));
  for (const observation of ordered) {
    for (const snapshot of [observation.before, observation.after]) {
      assertGitHubRemoteIntegrity({
        before: baseline,
        after: snapshot,
        authorizedIssueNumbers,
        requireCompleteAuthorizedSet: false,
      });
    }
  }
  const integrity = assertGitHubRemoteIntegrity({
    before: baseline,
    after: finalObservation.after,
    authorizedIssueNumbers,
  });
  const result = createGitHubJourneyEvaluation({
    candidate: manifest.candidate,
    codexCliVersion,
    coordinatorIdentity: required("coordinator-identity"),
    durationMs: nonNegativeInteger(required("duration-ms"), "--duration-ms"),
    repositoryIdentitySha256: integrity.repositoryIdentitySha256,
    remoteIntegritySha256: integrity.integritySha256,
    verdicts,
  });
  if (
    output.startsWith(`${manifest.paths.transcripts}/`) ||
    output.startsWith(`${manifest.paths.remoteInventories}/`)
  ) {
    fail("Bounded result cannot be written inside private GitHub evidence storage.");
  }
  await writeFile(output, `${JSON.stringify(result, null, 2)}\n`, { flag: "wx" });
  await Promise.all([
    rm(manifest.paths.transcripts, { recursive: true }),
    rm(manifest.paths.remoteInventories, { recursive: true }),
  ]);
  process.stdout.write(`${JSON.stringify({ output, outcome: result.outcome })}\n`);
};

if (command === "prepare-clean") await prepareClean();
else if (command === "run-clean-turn") await runCleanTurn();
else if (command === "evaluate-clean") await evaluateClean();
else if (command === "configure-github-repository") await configureGitHubRepository();
else if (command === "prepare-github") await prepareGitHub();
else if (command === "run-github-turn") await runGitHubTurn();
else if (command === "evaluate-github") await evaluateGitHub();
else fail(`Unknown command: ${command}.\n${usage}`);
