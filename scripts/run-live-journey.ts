import { lstat, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { inspectCodexE2EOperatorContext } from "./codex-e2e-runtime";
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
    manifest: { type: "string" },
    turn: { type: "string" },
    "prompt-file": { type: "string" },
    verdicts: { type: "string" },
    "codex-cli-version": { type: "string" },
    "coordinator-identity": { type: "string" },
    "duration-ms": { type: "string" },
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

const promptBytes = async (path: string): Promise<string> => {
  const prompt =
    path === "-"
      ? await new Response(Bun.stdin.stream()).text()
      : await readFile(resolve(path), "utf8");
  return assertJourneyAgentPrompt(prompt.endsWith("\n") ? prompt.slice(0, -1) : prompt);
};

const runCleanTurn = async (): Promise<void> => {
  const manifestPath = resolve(required("manifest"));
  const turn = positiveInteger(required("turn"), "--turn");
  const manifest = await verifiedGeneration(manifestPath);
  const sessionState = await readCodexSessionState(manifest.paths.sessionState);
  if (sessionState === undefined && turn !== 1) {
    fail("The first Clean Journey turn must be turn 1.");
  }
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
  const before = {
    repository: await snapshotDirectory(manifest.paths.repository),
    agentHome: await snapshotDirectory(manifest.paths.agentHome),
  };
  const result = await runProcess(step.program, [...args, prompt], environment);
  await Promise.all([
    writeFile(transcriptPath, result.stdout, { flag: "wx" }),
    writeFile(stderrPath, result.stderr, { flag: "wx" }),
  ]);
  const after = {
    repository: await snapshotDirectory(manifest.paths.repository),
    agentHome: await snapshotDirectory(manifest.paths.agentHome),
  };
  const observation = createLiveJourneyObservation({
    turn,
    codexCliVersion: version.stdout.trim(),
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
    before,
    after,
    transcriptPointer: `transcripts/turn-${turnLabel}.jsonl`,
    stderrPointer: `transcripts/turn-${turnLabel}.stderr.log`,
  });
  await writeFile(observationPath, `${JSON.stringify(observation, null, 2)}\n`, { flag: "wx" });
  const observedSessionId = extractCodexThreadId(result.stdout) ?? sessionState?.sessionId;
  if (observedSessionId !== undefined) {
    await writeCodexSessionState(manifest.paths.sessionState, {
      schemaVersion: 1,
      generationId: manifest.generationId,
      sessionId: observedSessionId,
      lastTurn: turn,
    });
  }
  process.stdout.write(
    `${JSON.stringify({
      observation: observationPath,
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

if (command === "prepare-clean") await prepareClean();
else if (command === "run-clean-turn") await runCleanTurn();
else if (command === "evaluate-clean") await evaluateClean();
else fail(`Unknown command: ${command}.\n${usage}`);
