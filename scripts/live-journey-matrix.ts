import { createHash, randomUUID } from "node:crypto";
import {
  appendFile,
  cp,
  lstat,
  mkdir,
  readdir,
  readFile,
  readlink,
  realpath,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { z } from "zod";
import {
  CODEX_E2E_RUNTIME,
  codexE2ELaunchContract,
  inspectCodexE2EOperatorContext,
} from "./codex-e2e-runtime";
import { sha256Bytes, sha256File } from "./release-digest";

const matrixCaseSchema = z.object({
  id: z.string().regex(/^(?:CLEAN|GITHUB|SAFETY)-\d{2}$/u),
  name: z.string().min(1),
});

const matrixJourneySchema = z.object({
  id: z.enum([
    "clean-installation-and-local-loop",
    "github-and-active-reconciliation",
    "safety-and-lifecycle",
  ]),
  name: z.string().min(1),
  cases: z.array(matrixCaseSchema).min(1),
});

const matrixSchema = z.object({
  schemaVersion: z.literal(1),
  journeys: z.array(matrixJourneySchema).length(3),
});

const workflowSchema = z.object({
  name: z.string().min(1),
  runId: z.string().min(1),
  runAttempt: z.number(),
});

const artifactSchema = z.object({
  path: z.string().min(1),
  file: z.string().min(1),
  sha256: z.string().regex(/^[0-9a-f]{64}$/u),
});

const launchStepSchema = z.object({
  program: z.string().min(1),
  arguments: z.array(z.string()),
  appendPromptAsFinalArgument: z.literal(true),
});

const launchSchema = z.object({
  environment: z.object({ HOME: z.string(), CODEX_HOME: z.string() }),
  initial: launchStepSchema,
  resume: launchStepSchema,
});

export const liveMatrixCandidateSchema = z
  .object({
    packageName: z.literal("@lagrangee/bearing"),
    packageVersion: z.string().min(1),
    sourceCommit: z.string().min(1),
    workflow: workflowSchema,
    artifact: artifactSchema,
    matrixDefinitionSha256: z.string().regex(/^[0-9a-f]{64}$/u),
  })
  .superRefine((candidate, context) => {
    if (
      !isAbsolute(candidate.artifact.path) ||
      basename(candidate.artifact.path) !== candidate.artifact.file
    ) {
      context.addIssue({
        code: "custom",
        message: "Candidate tarball locator must be one absolute path with the receipt file name.",
      });
    }
  });

export type LiveMatrixCandidate = z.infer<typeof liveMatrixCandidateSchema>;

const generationManifestSchema = z.object({
  schemaVersion: z.literal(1),
  generationId: z.string().uuid(),
  journey: z.literal("clean-installation-and-local-loop"),
  candidate: liveMatrixCandidateSchema,
  candidateReceipt: z.object({
    path: z.string(),
    sha256: z.string().regex(/^[0-9a-f]{64}$/u),
  }),
  operatorContextFingerprint: z.string().regex(/^[0-9a-f]{64}$/u),
  paths: z.object({
    sourceRoot: z.string(),
    workspaceRoot: z.string(),
    overlay: z.string(),
    candidateManifest: z.string(),
    candidateManifestDigest: z.string(),
    sessionState: z.string(),
    agentHome: z.string(),
    repository: z.string(),
    observations: z.string(),
    transcripts: z.string(),
  }),
  launch: launchSchema,
});

const cleanCaseIds = ["CLEAN-01", "CLEAN-02", "CLEAN-03", "CLEAN-04", "CLEAN-05"] as const;
const cleanTrackedInputs = [
  "validation/live-journey/matrix.json",
  "validation/live-journey/journeys/clean-installation-and-local-loop.md",
  "validation/live-journey/fixtures/local-loop/AGENTS.md",
  "validation/live-journey/fixtures/local-loop/README.md",
  "validation/live-journey/fixtures/local-loop/package.json",
  "validation/live-journey/fixtures/local-loop/src/format-label.ts",
  "validation/live-journey/fixtures/local-loop/tests/format-label.test.ts",
] as const;
const cleanCaseIdSchema = z.enum(cleanCaseIds);
const outcomeSchema = z.enum(["pass", "fail", "blocked", "not-run"]);
const evidencePointerSchema = z
  .string()
  .min(1)
  .refine((value) => !isAbsolute(value) && !value.split(/[\\/]/u).includes(".."), {
    message: "Evidence pointers must stay relative to the generated workspace.",
  });
const verdictSchema = z.object({
  caseId: cleanCaseIdSchema,
  outcome: outcomeSchema,
  judgmentBasis: z.string().trim().min(1).max(600),
  observationPointers: z.array(evidencePointerSchema).min(1),
});

const observationSchema = z.object({
  schemaVersion: z.literal(1),
  turn: z.number().int().positive(),
  invocationStarted: z.boolean(),
  exitCode: z.number().int(),
  terminalBoundary: z.string().min(1),
  codex: z.object({
    cliVersion: z.string().min(1),
    requestedModel: z.literal(CODEX_E2E_RUNTIME.model),
    requestedReasoningEffort: z.literal(CODEX_E2E_RUNTIME.reasoningEffort),
  }),
  eventCounts: z.record(z.string(), z.number().int().nonnegative()),
  state: z.object({
    before: z.object({ repository: z.string(), agentHome: z.string() }),
    after: z.object({ repository: z.string(), agentHome: z.string() }),
  }),
  privateEvidence: z.object({
    transcript: z.object({
      pointer: evidencePointerSchema,
      sha256: z.string().regex(/^[0-9a-f]{64}$/u),
      bytes: z.number().int().nonnegative(),
    }),
    stderr: z.object({
      pointer: evidencePointerSchema,
      sha256: z.string().regex(/^[0-9a-f]{64}$/u),
      bytes: z.number().int().nonnegative(),
    }),
  }),
});

const sessionStateSchema = z.object({
  schemaVersion: z.literal(1),
  generationId: z.string().uuid(),
  sessionId: z.string().uuid(),
  lastTurn: z.number().int().positive(),
});

const fail = (message: string): never => {
  throw new Error(message);
};

const inheritedJourneyEnvironmentKeys = [
  "COLORTERM",
  "LANG",
  "LC_ALL",
  "LOGNAME",
  "PATH",
  "SHELL",
  "TERM",
  "TMPDIR",
  "TZ",
  "USER",
] as const;

export const createCodexJourneyEnvironment = (
  operatorEnvironment: Readonly<Record<string, string | undefined>>,
  launchEnvironment: Readonly<{ HOME: string; CODEX_HOME: string }>,
): Readonly<Record<string, string>> => {
  const environment: Record<string, string> = {};
  for (const key of inheritedJourneyEnvironmentKeys) {
    const value = operatorEnvironment[key];
    if (value !== undefined) environment[key] = value;
  }
  if (environment["PATH"] === undefined) fail("Codex Journey launch requires PATH.");
  return Object.freeze({ ...environment, ...launchEnvironment });
};

export const loadLiveJourneyMatrix = async (path: string) => {
  const matrix = matrixSchema.parse(JSON.parse(await readFile(path, "utf8")));
  const caseIds = matrix.journeys.flatMap((journey) => journey.cases.map(({ id }) => id));
  if (new Set(caseIds).size !== caseIds.length) fail("Matrix Case identities must be unique.");
  return matrix;
};

export const matrixDefinitionDigest = (path: string): Promise<string> => sha256File(path);

const git = (root: string, args: readonly string[]): string => {
  const result = Bun.spawnSync(["git", ...args], { cwd: root, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) {
    fail(result.stderr.toString().trim() || `git ${args.join(" ")} failed.`);
  }
  return result.stdout.toString().trim();
};

const isSameOrDescendant = (candidate: string, boundary: string): boolean =>
  candidate === boundary || candidate.startsWith(`${boundary}${sep}`);

const assertIndependentNewWorkspace = async (sourceRoot: string, workspaceRoot: string) => {
  if (!isAbsolute(sourceRoot) || !isAbsolute(workspaceRoot)) {
    fail("Source and workspace roots must be absolute paths.");
  }
  const canonicalSource = await realpath(sourceRoot);
  const canonicalWorkspaceParent = await realpath(dirname(workspaceRoot));
  const canonicalWorkspace = join(canonicalWorkspaceParent, basename(workspaceRoot));
  if (
    isSameOrDescendant(canonicalWorkspace, canonicalSource) ||
    isSameOrDescendant(canonicalSource, canonicalWorkspace)
  ) {
    fail("Generated workspace and Candidate source must be independent paths.");
  }
  try {
    await lstat(workspaceRoot);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return;
    throw error;
  }
  fail("Generated workspace already exists.");
};

const ensureLocalOverlayExclude = async (sourceRoot: string): Promise<void> => {
  const excludePath = join(sourceRoot, ".git/info/exclude");
  const current = await readFile(excludePath, "utf8").catch((error: unknown) => {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return "";
    throw error;
  });
  if (current.split(/\r?\n/u).includes("/README.local.md")) return;
  await mkdir(dirname(excludePath), { recursive: true });
  await appendFile(
    excludePath,
    `${current.length === 0 || current.endsWith("\n") ? "" : "\n"}/README.local.md\n`,
  );
};

const localOverlay = (
  candidate: LiveMatrixCandidate,
): string => `<!-- bearing:live-matrix-local-entry -->
# Install Bearing from this exact local Candidate

Ask your Agent:

> Install Bearing by following [the real Agent installation guide](docs/agent-installation.md).
> For this pre-release journey, use the exact local package at
> \`${candidate.artifact.path}\` instead of a registry package locator. Preserve all other guidance,
> including complete-bundle installation, Skill Directory integration, and setup consent.

Candidate identity:

- Package: \`${candidate.packageName}@${candidate.packageVersion}\`
- Source commit: \`${candidate.sourceCommit}\`
- Tarball SHA-256: \`${candidate.artifact.sha256}\`
- Candidate workflow: \`${candidate.workflow.name}/${candidate.workflow.runId}/${candidate.workflow.runAttempt}\`
- Matrix definition SHA-256: \`${candidate.matrixDefinitionSha256}\`

Installation does not authorize repository setup. The Agent must wait for Human confirmation.
`;

const writeOverlay = async (path: string, candidate: LiveMatrixCandidate): Promise<void> => {
  const existing = await readFile(path, "utf8").catch((error: unknown) => {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
    throw error;
  });
  if (existing !== undefined && !existing.startsWith("<!-- bearing:live-matrix-local-entry -->")) {
    fail("README.local.md exists and is not a generated Live Matrix overlay.");
  }
  await writeFile(path, localOverlay(candidate));
};

const initializeFixtureRepository = async (
  sourceRoot: string,
  repository: string,
): Promise<void> => {
  await cp(join(sourceRoot, "validation/live-journey/fixtures/local-loop"), repository, {
    recursive: true,
    errorOnExist: true,
  });
  git(repository, ["init", "-q"]);
  git(repository, ["add", "."]);
  git(repository, [
    "-c",
    "user.name=Bearing Live Matrix",
    "-c",
    "user.email=live-matrix@example.invalid",
    "commit",
    "-qm",
    "Initialize disposable local loop fixture",
  ]);
};

export const prepareCleanJourneyGeneration = async (input: {
  sourceRoot: string;
  workspaceRoot: string;
  codexHome: string;
  candidate: LiveMatrixCandidate;
  candidateReceipt: Readonly<{ path: string; sha256: string }>;
  disabledOperatorSkillPaths: readonly string[];
  operatorContextFingerprint: string;
  codexProgram?: string;
}) => {
  const candidate = liveMatrixCandidateSchema.parse(input.candidate);
  const candidateReceipt = z
    .object({
      path: z.string().refine(isAbsolute),
      sha256: z.string().regex(/^[0-9a-f]{64}$/u),
    })
    .parse(input.candidateReceipt);
  const operatorContextFingerprint = z
    .string()
    .regex(/^[0-9a-f]{64}$/u)
    .parse(input.operatorContextFingerprint);
  const sourceRoot = resolve(input.sourceRoot);
  const workspaceRoot = resolve(input.workspaceRoot);
  const codexHome = resolve(input.codexHome);
  await assertIndependentNewWorkspace(sourceRoot, workspaceRoot);
  await realpath(codexHome);

  if (git(sourceRoot, ["rev-parse", "HEAD"]) !== candidate.sourceCommit) {
    fail("Candidate source commit does not match the current fixed HEAD.");
  }
  if (git(sourceRoot, ["status", "--porcelain=v1", "--untracked-files=no"]) !== "") {
    fail("Candidate source has tracked changes before Matrix preparation.");
  }
  for (const locator of cleanTrackedInputs) {
    git(sourceRoot, ["ls-files", "--error-unmatch", locator]);
  }
  const matrixPath = join(sourceRoot, "validation/live-journey/matrix.json");
  await loadLiveJourneyMatrix(matrixPath);
  if ((await matrixDefinitionDigest(matrixPath)) !== candidate.matrixDefinitionSha256) {
    fail("Matrix definition digest mismatch before Agent behavior.");
  }
  if ((await sha256File(candidate.artifact.path)) !== candidate.artifact.sha256) {
    fail("Candidate tarball digest mismatch before Agent behavior.");
  }
  if ((await sha256File(candidateReceipt.path)) !== candidateReceipt.sha256) {
    fail("Candidate Receipt digest mismatch before Agent behavior.");
  }

  await ensureLocalOverlayExclude(sourceRoot);
  const overlay = join(sourceRoot, "README.local.md");
  await writeOverlay(overlay, candidate);

  const agentHome = join(workspaceRoot, "agent-home");
  const repository = join(workspaceRoot, "repositories/local-loop");
  const observations = join(workspaceRoot, "observations");
  const transcripts = join(workspaceRoot, "transcripts");
  const candidateManifest = join(workspaceRoot, "candidate-manifest.json");
  const candidateManifestDigest = `${candidateManifest}.sha256`;
  const sessionState = join(workspaceRoot, "codex-session.json");
  await Promise.all([
    mkdir(agentHome, { recursive: true }),
    mkdir(observations, { recursive: true }),
    mkdir(transcripts, { recursive: true }),
    mkdir(dirname(repository), { recursive: true }),
  ]);
  await initializeFixtureRepository(sourceRoot, repository);

  const launch = codexE2ELaunchContract({
    repositoryRoot: repository,
    isolatedHome: agentHome,
    codexHome,
    disabledOperatorSkillPaths: input.disabledOperatorSkillPaths,
    ...(input.codexProgram === undefined ? {} : { program: input.codexProgram }),
  });
  const manifest = Object.freeze({
    schemaVersion: 1 as const,
    generationId: randomUUID(),
    journey: "clean-installation-and-local-loop" as const,
    candidate,
    candidateReceipt: Object.freeze(candidateReceipt),
    operatorContextFingerprint,
    paths: Object.freeze({
      sourceRoot,
      workspaceRoot,
      overlay,
      candidateManifest,
      candidateManifestDigest,
      sessionState,
      agentHome,
      repository,
      observations,
      transcripts,
    }),
    launch,
  });
  const manifestBytes = `${JSON.stringify(manifest, null, 2)}\n`;
  await writeFile(candidateManifest, manifestBytes);
  await writeFile(candidateManifestDigest, `${digestText(manifestBytes)}\n`);
  return manifest;
};

export const readCleanJourneyGeneration = async (path: string) => {
  const manifestPath = resolve(path);
  const manifestBytes = await readFile(manifestPath, "utf8");
  const recordedDigest = (await readFile(`${manifestPath}.sha256`, "utf8")).trim();
  if (recordedDigest !== digestText(manifestBytes)) {
    fail("Candidate Manifest digest mismatch before Codex launch.");
  }
  const manifest = generationManifestSchema.parse(JSON.parse(manifestBytes));
  if (
    manifest.paths.candidateManifest !== manifestPath ||
    manifest.paths.candidateManifestDigest !== `${manifestPath}.sha256`
  ) {
    fail("Candidate Manifest locator mismatch before Codex launch.");
  }
  return manifest;
};

export const verifyCleanJourneyGeneration = async (manifest: unknown) => {
  const parsed = generationManifestSchema.parse(manifest);
  const expectedPaths = {
    overlay: join(parsed.paths.sourceRoot, "README.local.md"),
    candidateManifest: join(parsed.paths.workspaceRoot, "candidate-manifest.json"),
    candidateManifestDigest: join(parsed.paths.workspaceRoot, "candidate-manifest.json.sha256"),
    sessionState: join(parsed.paths.workspaceRoot, "codex-session.json"),
    agentHome: join(parsed.paths.workspaceRoot, "agent-home"),
    repository: join(parsed.paths.workspaceRoot, "repositories/local-loop"),
    observations: join(parsed.paths.workspaceRoot, "observations"),
    transcripts: join(parsed.paths.workspaceRoot, "transcripts"),
  };
  for (const [name, expected] of Object.entries(expectedPaths)) {
    if (parsed.paths[name as keyof typeof expectedPaths] !== expected) {
      fail(`Generated ${name} locator mismatch before Codex launch.`);
    }
  }
  if (git(parsed.paths.sourceRoot, ["rev-parse", "HEAD"]) !== parsed.candidate.sourceCommit) {
    fail("Candidate source commit mismatch before Codex launch.");
  }
  if (git(parsed.paths.sourceRoot, ["status", "--porcelain=v1", "--untracked-files=no"]) !== "") {
    fail("Candidate source has tracked changes before Codex launch.");
  }
  if (
    (await matrixDefinitionDigest(
      join(parsed.paths.sourceRoot, "validation/live-journey/matrix.json"),
    )) !== parsed.candidate.matrixDefinitionSha256
  ) {
    fail("Matrix definition digest mismatch before Codex launch.");
  }
  if ((await sha256File(parsed.candidate.artifact.path)) !== parsed.candidate.artifact.sha256) {
    fail("Candidate tarball digest mismatch before Codex launch.");
  }
  if ((await sha256File(parsed.candidateReceipt.path)) !== parsed.candidateReceipt.sha256) {
    fail("Candidate Receipt digest mismatch before Codex launch.");
  }
  const operatorContext = await inspectCodexE2EOperatorContext(
    parsed.launch.environment.CODEX_HOME,
  );
  if (operatorContext.fingerprint !== parsed.operatorContextFingerprint) {
    fail("Codex operator context changed after Matrix preparation.");
  }
  const expectedLaunch = codexE2ELaunchContract({
    repositoryRoot: parsed.paths.repository,
    isolatedHome: parsed.paths.agentHome,
    codexHome: parsed.launch.environment.CODEX_HOME,
    disabledOperatorSkillPaths: operatorContext.disabledSkills.map(({ locator }) => locator),
    program: parsed.launch.initial.program,
  });
  if (JSON.stringify(parsed.launch) !== JSON.stringify(expectedLaunch)) {
    fail("Fixed Codex launch contract mismatch before tested behavior.");
  }
  const overlay = await readFile(parsed.paths.overlay, "utf8");
  if (overlay !== localOverlay(parsed.candidate)) {
    fail("Local entry overlay identity mismatch before Codex launch.");
  }
  return parsed;
};

const blackBoxTerms =
  /(?:\b(?:CLEAN|GITHUB|SAFETY)-\d{2}\b|pass criteria|expected commands?|expected files?|matrix case)/iu;

export const assertJourneyAgentPrompt = (prompt: string): string => {
  if (prompt.trim() !== prompt || prompt.length === 0 || blackBoxTerms.test(prompt)) {
    fail("Journey Agent prompt violates the black-box boundary.");
  }
  return prompt;
};

const digestText = (value: string): string =>
  createHash("sha256").update(value, "utf8").digest("hex");

const privateEvidence = (pointer: string, bytes: string) => ({
  pointer: evidencePointerSchema.parse(pointer),
  sha256: digestText(bytes),
  bytes: Buffer.byteLength(bytes),
});

export const createLiveJourneyObservation = (input: {
  turn: number;
  codexCliVersion: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  before: Readonly<{ repository: string; agentHome: string }>;
  after: Readonly<{ repository: string; agentHome: string }>;
  transcriptPointer: string;
  stderrPointer: string;
}) => {
  if (!Number.isSafeInteger(input.turn) || input.turn <= 0) fail("Observation turn is invalid.");
  const eventCounts: Record<string, number> = {};
  let terminalBoundary = `process-exit-${input.exitCode}`;
  for (const line of input.stdout.split(/\r?\n/u).filter((entry) => entry.length > 0)) {
    try {
      const event = JSON.parse(line) as Readonly<{ type?: unknown }>;
      const type = typeof event.type === "string" ? event.type : "unknown";
      eventCounts[type] = (eventCounts[type] ?? 0) + 1;
      if (type === "turn.completed" || type === "turn.failed") terminalBoundary = type;
    } catch {
      eventCounts["invalid-jsonl"] = (eventCounts["invalid-jsonl"] ?? 0) + 1;
    }
  }
  return Object.freeze({
    schemaVersion: 1 as const,
    turn: input.turn,
    invocationStarted:
      (eventCounts["thread.started"] ?? 0) > 0 || (eventCounts["turn.started"] ?? 0) > 0,
    exitCode: input.exitCode,
    terminalBoundary,
    codex: Object.freeze({
      cliVersion: input.codexCliVersion,
      requestedModel: CODEX_E2E_RUNTIME.model,
      requestedReasoningEffort: CODEX_E2E_RUNTIME.reasoningEffort,
    }),
    eventCounts: Object.freeze(
      Object.fromEntries(
        Object.entries(eventCounts).sort(([left], [right]) => left.localeCompare(right)),
      ),
    ),
    state: Object.freeze({
      before: Object.freeze(input.before),
      after: Object.freeze(input.after),
    }),
    privateEvidence: Object.freeze({
      transcript: Object.freeze(privateEvidence(input.transcriptPointer, input.stdout)),
      stderr: Object.freeze(privateEvidence(input.stderrPointer, input.stderr)),
    }),
  });
};

export const extractCodexThreadId = (stdout: string): string | undefined => {
  for (const line of stdout.split(/\r?\n/u)) {
    try {
      const event = JSON.parse(line) as Readonly<{ type?: unknown; thread_id?: unknown }>;
      if (event.type === "thread.started" && typeof event.thread_id === "string") {
        return event.thread_id;
      }
    } catch {
      // Raw invalid JSONL remains private failure evidence.
    }
  }
  return undefined;
};

const evidenceFile = async (workspaceRoot: string, pointer: string) => {
  const relativePointer = evidencePointerSchema.parse(pointer);
  const canonicalWorkspace = await realpath(workspaceRoot);
  const path = await realpath(join(canonicalWorkspace, relativePointer));
  if (!path.startsWith(`${canonicalWorkspace}${sep}`)) {
    fail(`Evidence pointer escapes the generated workspace: ${pointer}`);
  }
  return { path, bytes: await readFile(path) };
};

export const verifyLiveJourneyObservation = async (input: {
  workspaceRoot: string;
  pointer: string;
  expectedCodexCliVersion: string;
}) => {
  if (!input.pointer.startsWith("observations/")) {
    fail("Coordinator verdict must reference a generated observation.");
  }
  const observationFile = await evidenceFile(input.workspaceRoot, input.pointer);
  const observation = observationSchema.parse(JSON.parse(observationFile.bytes.toString("utf8")));
  if (observation.codex.cliVersion !== input.expectedCodexCliVersion) {
    fail("Observation Codex CLI version does not match the Coordinator evaluation.");
  }
  for (const evidence of [
    observation.privateEvidence.transcript,
    observation.privateEvidence.stderr,
  ]) {
    const file = await evidenceFile(input.workspaceRoot, evidence.pointer);
    if (file.bytes.byteLength !== evidence.bytes || sha256Bytes(file.bytes) !== evidence.sha256) {
      fail(`Private observation evidence digest mismatch: ${evidence.pointer}`);
    }
  }
  return observation;
};

export const observationSupportsSemanticPass = (input: unknown): boolean => {
  const observation = observationSchema.parse(input);
  return (
    observation.invocationStarted &&
    observation.exitCode === 0 &&
    observation.terminalBoundary === "turn.completed" &&
    (observation.eventCounts["turn.failed"] ?? 0) === 0 &&
    (observation.eventCounts["invalid-jsonl"] ?? 0) === 0
  );
};

export const readCodexSessionState = async (path: string) => {
  try {
    return sessionStateSchema.parse(JSON.parse(await readFile(path, "utf8")));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
    throw error;
  }
};

export const writeCodexSessionState = async (
  path: string,
  state: z.input<typeof sessionStateSchema>,
): Promise<void> => {
  const parsed = sessionStateSchema.parse(state);
  await writeFile(path, `${JSON.stringify(parsed, null, 2)}\n`);
};

type SnapshotEntry = Readonly<{ locator: string; kind: "file" | "symbolic-link" }>;

const snapshotFiles = async (root: string, directory = root): Promise<readonly SnapshotEntry[]> => {
  const entries: SnapshotEntry[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === ".git") continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) entries.push(...(await snapshotFiles(root, path)));
    else if (entry.isFile()) entries.push({ locator: relative(root, path), kind: "file" });
    else if (entry.isSymbolicLink()) {
      entries.push({ locator: relative(root, path), kind: "symbolic-link" });
    } else fail(`Live Journey snapshots refuse non-file entries: ${relative(root, path)}`);
  }
  return entries.sort((left, right) => left.locator.localeCompare(right.locator, "en"));
};

export const snapshotDirectory = async (root: string): Promise<string> => {
  const frames: string[] = [];
  for (const entry of await snapshotFiles(root)) {
    const bytes =
      entry.kind === "file"
        ? await readFile(join(root, entry.locator))
        : Buffer.from(await readlink(join(root, entry.locator)), "utf8");
    frames.push(`${entry.kind}\0${entry.locator}\0${sha256Bytes(bytes)}\n`);
  }
  return digestText(frames.join(""));
};

export const createCleanJourneyEvaluation = (input: {
  candidate: LiveMatrixCandidate;
  codexCliVersion: string;
  coordinatorIdentity: string;
  durationMs: number;
  verdicts: readonly unknown[];
}) => {
  const candidate = liveMatrixCandidateSchema.parse(input.candidate);
  const verdicts = z.array(verdictSchema).parse(input.verdicts);
  if (
    verdicts.length !== cleanCaseIds.length ||
    new Set(verdicts.map(({ caseId }) => caseId)).size !== cleanCaseIds.length ||
    cleanCaseIds.some((caseId) => !verdicts.some((verdict) => verdict.caseId === caseId))
  ) {
    fail("Coordinator evaluation requires each Clean Case exactly once.");
  }
  if (
    input.codexCliVersion.trim() !== input.codexCliVersion ||
    input.codexCliVersion.length === 0 ||
    input.coordinatorIdentity.trim() !== input.coordinatorIdentity ||
    input.coordinatorIdentity.length === 0 ||
    !Number.isSafeInteger(input.durationMs) ||
    input.durationMs < 0
  ) {
    fail("Coordinator evaluation metadata is invalid.");
  }
  return Object.freeze({
    schemaVersion: 1 as const,
    journey: "clean-installation-and-local-loop" as const,
    candidate: Object.freeze({
      packageName: candidate.packageName,
      packageVersion: candidate.packageVersion,
      sourceCommit: candidate.sourceCommit,
      workflow: Object.freeze(candidate.workflow),
      artifact: Object.freeze({ file: candidate.artifact.file, sha256: candidate.artifact.sha256 }),
      matrixDefinitionSha256: candidate.matrixDefinitionSha256,
    }),
    codex: Object.freeze({
      cliVersion: input.codexCliVersion,
      requestedModel: CODEX_E2E_RUNTIME.model,
      requestedReasoningEffort: CODEX_E2E_RUNTIME.reasoningEffort,
    }),
    coordinatorIdentity: input.coordinatorIdentity,
    durationMs: input.durationMs,
    outcome: verdicts.every(({ outcome }) => outcome === "pass")
      ? ("pass" as const)
      : ("not-pass" as const),
    cases: Object.freeze(verdicts.map((verdict) => Object.freeze(verdict))),
  });
};
