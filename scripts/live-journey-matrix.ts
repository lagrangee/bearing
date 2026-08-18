import { createHash } from "node:crypto";
import { readdir, readFile, readlink, realpath, writeFile } from "node:fs/promises";
import { delimiter, isAbsolute, join, relative, sep } from "node:path";
import { z } from "zod";
import { CODEX_E2E_RUNTIME } from "./codex-e2e-runtime";
import { sha256Bytes } from "./release-digest";

export { localRehearsalWorktreeDigest } from "./local-rehearsal-identity";

const fail = (message: string): never => {
  throw new Error(message);
};

const evidencePointerSchema = z
  .string()
  .min(1)
  .refine((value) => !isAbsolute(value) && !value.split(/[\\/]/u).includes(".."), {
    message: "Evidence pointers must stay relative to the generated workspace.",
  });

const observationSchema = z.object({
  schemaVersion: z.literal(1),
  turn: z.number().int().positive(),
  invocationStarted: z.boolean(),
  durationMs: z.number().int().positive().safe(),
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
  const operatorPath = environment["PATH"] ?? fail("Codex Journey launch requires PATH.");
  environment["PATH"] = operatorPath
    .split(delimiter)
    .filter((entry) => entry.length > 0 && !/(?:^|[\\/])\.codex(?:[\\/]|$)/u.test(entry))
    .join(delimiter);
  if (environment["PATH"].length === 0) {
    fail("Codex Journey launch requires one PATH entry outside operator Codex configuration.");
  }
  environment["PATH"] =
    `${join(launchEnvironment.HOME, ".bearing", "bin")}${delimiter}${environment["PATH"]}`;
  environment["ZDOTDIR"] = join(launchEnvironment.HOME, ".shell");
  return Object.freeze({ ...environment, ...launchEnvironment });
};

const blackBoxTerms = /(?:pass criteria|expected commands?|expected files?|matrix case)/iu;

export const assertJourneyAgentPrompt = (
  prompt: string,
  scenarioIds: readonly string[],
  allowedLocators: readonly string[] = [],
): string => {
  if (allowedLocators.some((locator) => locator.length === 0 || !isAbsolute(locator))) {
    fail("Journey Agent prompt violates the black-box boundary.");
  }
  const semanticPrompt = allowedLocators.reduce(
    (value, locator) => value.replaceAll(locator, "<agent-visible-locator>"),
    prompt,
  );
  if (
    prompt.trim() !== prompt ||
    prompt.length === 0 ||
    blackBoxTerms.test(semanticPrompt) ||
    scenarioIds.some((scenarioId) => semanticPrompt.includes(scenarioId))
  ) {
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
  durationMs: number;
}) => {
  if (!Number.isSafeInteger(input.turn) || input.turn <= 0) fail("Observation turn is invalid.");
  if (!Number.isSafeInteger(input.durationMs) || input.durationMs <= 0) {
    fail("Observation duration is invalid.");
  }
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
    durationMs: input.durationMs,
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

export const readGeneratedEvidenceFile = async (workspaceRoot: string, pointer: string) => {
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
  if (
    !input.pointer.startsWith("observations/") &&
    !input.pointer.startsWith("github/observations/")
  ) {
    fail("Coordinator verdict must reference a generated observation.");
  }
  const observationFile = await readGeneratedEvidenceFile(input.workspaceRoot, input.pointer);
  const observation = observationSchema.parse(JSON.parse(observationFile.bytes.toString("utf8")));
  if (observation.codex.cliVersion !== input.expectedCodexCliVersion) {
    fail("Observation Codex CLI version does not match the Coordinator evaluation.");
  }
  for (const evidence of [
    observation.privateEvidence.transcript,
    observation.privateEvidence.stderr,
  ]) {
    const file = await readGeneratedEvidenceFile(input.workspaceRoot, evidence.pointer);
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

const snapshotFiles = async (
  root: string,
  directory: string,
  excludedLocators: ReadonlySet<string>,
  excludedTrees: readonly string[],
): Promise<readonly SnapshotEntry[]> => {
  const entries: SnapshotEntry[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === ".git") continue;
    const path = join(directory, entry.name);
    const locator = relative(root, path);
    if (
      excludedLocators.has(locator) ||
      excludedTrees.some((tree) => locator === tree || locator.startsWith(`${tree}/`))
    ) {
      continue;
    }
    if (entry.isDirectory()) {
      entries.push(...(await snapshotFiles(root, path, excludedLocators, excludedTrees)));
    } else if (entry.isFile()) {
      entries.push({ locator, kind: "file" });
    } else if (entry.isSymbolicLink()) {
      entries.push({ locator, kind: "symbolic-link" });
    } else {
      fail(`Live Journey snapshots refuse non-file entries: ${locator}`);
    }
  }
  return entries.sort((left, right) => left.locator.localeCompare(right.locator, "en"));
};

export const snapshotDirectory = async (
  root: string,
  options: Readonly<{ exclude?: readonly string[]; excludeTrees?: readonly string[] }> = {},
): Promise<string> => {
  const excludedLocators = new Set(options.exclude ?? []);
  const frames: string[] = [];
  for (const entry of await snapshotFiles(
    root,
    root,
    excludedLocators,
    options.excludeTrees ?? [],
  )) {
    const bytes =
      entry.kind === "file"
        ? await readFile(join(root, entry.locator))
        : Buffer.from(await readlink(join(root, entry.locator)), "utf8");
    frames.push(`${entry.kind}\0${entry.locator}\0${sha256Bytes(bytes)}\n`);
  }
  return digestText(frames.join(""));
};
