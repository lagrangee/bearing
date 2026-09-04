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

const evidenceRejectionReasonSchema = z.enum([
  "credential-match",
  "scanner-unavailable",
  "mechanical-failure",
]);

const invocationFailureStageSchema = z.enum([
  "codex-invocation",
  "github-broker-shutdown",
  "github-remote-after-readback",
  "output-processing",
  "evidence-publication",
  "conversation-publication",
]);

const evidenceRejectionSchema = z
  .object({
    reason: evidenceRejectionReasonSchema,
    stage: invocationFailureStageSchema.optional(),
    error: z
      .object({
        name: z.string().min(1).max(64),
        message: z.string().min(1).max(512),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((rejection, context) => {
    if (rejection.reason === "mechanical-failure") {
      if (rejection.stage === undefined) {
        context.addIssue({
          code: "custom",
          path: ["stage"],
          message: "Mechanical evidence rejection requires one failure stage.",
        });
      }
      if (rejection.error === undefined) {
        context.addIssue({
          code: "custom",
          path: ["error"],
          message: "Mechanical evidence rejection requires one safe error summary.",
        });
      }
    }
  });

export type LiveJourneyEvidenceRejection = z.infer<typeof evidenceRejectionSchema>;
export type LiveJourneyInvocationFailureStage = z.infer<typeof invocationFailureStageSchema>;

const observationSchema = z
  .object({
    schemaVersion: z.literal(1),
    turn: z.number().int().positive(),
    invocationStarted: z.boolean(),
    startedAt: z.string().datetime({ offset: true }),
    endedAt: z.string().datetime({ offset: true }),
    durationMs: z.number().int().nonnegative().safe(),
    exitCode: z.number().int(),
    terminalBoundary: z.string().min(1),
    codex: z.object({
      cliVersion: z.string().min(1),
      requestedModel: z.literal(CODEX_E2E_RUNTIME.model),
      requestedReasoningEffort: z.literal(CODEX_E2E_RUNTIME.reasoningEffort),
      requestedFastMode: z.literal(CODEX_E2E_RUNTIME.fastMode),
    }),
    invokedSkill: z
      .object({
        name: z.string().min(1),
        path: z.string().min(1),
      })
      .optional(),
    evidenceRejection: evidenceRejectionSchema.optional(),
    eventCounts: z.record(z.string(), z.number().int().nonnegative()),
    state: z.object({
      before: z.object({ repository: z.string(), agentHome: z.string() }),
      after: z.object({ repository: z.string(), agentHome: z.string() }),
    }),
    privateEvidence: z.object({
      rawEvents: z.object({
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
  })
  .superRefine((observation, context) => {
    const observedDurationMs = Date.parse(observation.endedAt) - Date.parse(observation.startedAt);
    if (observedDurationMs < 0) {
      context.addIssue({
        code: "custom",
        path: ["endedAt"],
        message: "Observation endedAt must not precede startedAt.",
      });
    }
    if (observation.durationMs !== observedDurationMs) {
      context.addIssue({
        code: "custom",
        path: ["durationMs"],
        message: "Observation duration must equal endedAt minus startedAt.",
      });
    }
    const rejectionCount = observation.eventCounts["durable-evidence-rejected"] ?? 0;
    if (rejectionCount > 0 && observation.evidenceRejection === undefined) {
      context.addIssue({
        code: "custom",
        path: ["evidenceRejection"],
        message: "Rejected durable evidence requires one main-observation diagnosis.",
      });
    }
    if (observation.evidenceRejection !== undefined && rejectionCount !== 1) {
      context.addIssue({
        code: "custom",
        path: ["eventCounts", "durable-evidence-rejected"],
        message: "One evidence rejection diagnosis requires one matching synthetic event.",
      });
    }
  });

const sessionStateSchema = z.object({
  schemaVersion: z.literal(1),
  generationId: z.string().uuid(),
  sessionId: z.string().uuid(),
  lastTurn: z.number().int().positive(),
});

const inheritedJourneyEnvironmentKeys = ["COLORTERM", "LANG", "LC_ALL", "TERM", "TZ"] as const;

export const createCodexJourneyEnvironment = (
  operatorEnvironment: Readonly<Record<string, string | undefined>>,
  launchEnvironment: Readonly<{
    HOME: string;
    CODEX_HOME: string;
    TMPDIR: string;
    PATH: string;
    DEVELOPER_DIR: string;
    npm_config_script_shell: string;
    SHELL?: string | undefined;
  }>,
  options: Readonly<{ includeCanonicalBearingBin?: boolean }> = {},
): Readonly<Record<string, string>> => {
  const environment: Record<string, string> = {};
  for (const key of inheritedJourneyEnvironmentKeys) {
    const value = operatorEnvironment[key];
    if (value !== undefined) environment[key] = value;
  }
  Object.assign(environment, launchEnvironment);
  if (options.includeCanonicalBearingBin !== false) {
    environment["PATH"] = `${join(
      launchEnvironment.HOME,
      ".bearing",
      "bin",
    )}${delimiter}${environment["PATH"]}`;
  }
  environment["ZDOTDIR"] = join(launchEnvironment.HOME, ".shell");
  return Object.freeze(environment);
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
  rawEventsPointer: string;
  stderrPointer: string;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  invokedSkill?: Readonly<{ name: string; path: string }>;
  evidenceRejection?: LiveJourneyEvidenceRejection;
}) => {
  if (!Number.isSafeInteger(input.turn) || input.turn <= 0) fail("Observation turn is invalid.");
  const eventCounts: Record<string, number> = {};
  const unfinishedItemIds = new Set<string>();
  let terminalBoundary = `process-exit-${input.exitCode}`;
  for (const line of input.stdout.split(/\r?\n/u).filter((entry) => entry.length > 0)) {
    let event: Readonly<{ type?: unknown; item?: Readonly<{ id?: unknown }> }>;
    try {
      event = JSON.parse(line) as Readonly<{
        type?: unknown;
        item?: Readonly<{ id?: unknown }>;
      }>;
    } catch {
      eventCounts["invalid-jsonl"] = (eventCounts["invalid-jsonl"] ?? 0) + 1;
      continue;
    }
    const type = typeof event.type === "string" ? event.type : "unknown";
    eventCounts[type] = (eventCounts[type] ?? 0) + 1;
    const itemId =
      typeof event.item?.id === "string" && event.item.id.trim().length > 0
        ? event.item.id
        : undefined;
    if (type === "item.started" && itemId === undefined) {
      fail("Codex item.started event has no valid item ID.");
    }
    if (type === "item.started" && itemId !== undefined) unfinishedItemIds.add(itemId);
    if (type === "item.completed" && itemId !== undefined) unfinishedItemIds.delete(itemId);
    if (type === "turn.completed" && unfinishedItemIds.size > 0) {
      fail(
        `Codex turn completed with unfinished items: ${[...unfinishedItemIds].sort().join(", ")}`,
      );
    }
    if (type === "turn.completed" || type === "turn.failed") terminalBoundary = type;
  }
  const observation = {
    schemaVersion: 1 as const,
    turn: input.turn,
    invocationStarted:
      (eventCounts["thread.started"] ?? 0) > 0 || (eventCounts["turn.started"] ?? 0) > 0,
    startedAt: input.startedAt,
    endedAt: input.endedAt,
    durationMs: input.durationMs,
    exitCode: input.exitCode,
    terminalBoundary,
    codex: Object.freeze({
      cliVersion: input.codexCliVersion,
      requestedModel: CODEX_E2E_RUNTIME.model,
      requestedReasoningEffort: CODEX_E2E_RUNTIME.reasoningEffort,
      requestedFastMode: CODEX_E2E_RUNTIME.fastMode,
    }),
    ...(input.invokedSkill === undefined
      ? {}
      : { invokedSkill: Object.freeze(input.invokedSkill) }),
    ...(input.evidenceRejection === undefined
      ? {}
      : {
          evidenceRejection: Object.freeze({
            ...input.evidenceRejection,
            ...(input.evidenceRejection.error === undefined
              ? {}
              : { error: Object.freeze(input.evidenceRejection.error) }),
          }),
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
      rawEvents: Object.freeze(privateEvidence(input.rawEventsPointer, input.stdout)),
      stderr: Object.freeze(privateEvidence(input.stderrPointer, input.stderr)),
    }),
  };
  observationSchema.parse(observation);
  return Object.freeze(observation);
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

export const extractCodexAgentReply = (stdout: string): string => {
  const messages: string[] = [];
  for (const line of stdout.split(/\r?\n/u)) {
    try {
      const event = JSON.parse(line) as Readonly<{
        type?: unknown;
        item?: Readonly<{ type?: unknown; text?: unknown }>;
      }>;
      if (
        event.type === "item.completed" &&
        event.item?.type === "agent_message" &&
        typeof event.item.text === "string" &&
        event.item.text.trim().length > 0
      ) {
        messages.push(event.item.text.trim());
      }
    } catch {
      // Raw invalid JSONL remains durable diagnostic evidence.
    }
  }
  const reply = messages.join("\n\n");
  if (reply.length === 0) fail("Completed Codex Turn has no readable Agent reply.");
  return reply;
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
    observation.privateEvidence.rawEvents,
    observation.privateEvidence.stderr,
  ]) {
    const file = await readGeneratedEvidenceFile(input.workspaceRoot, evidence.pointer);
    if (file.bytes.byteLength !== evidence.bytes || sha256Bytes(file.bytes) !== evidence.sha256) {
      fail(`Private observation evidence digest mismatch: ${evidence.pointer}`);
    }
  }
  return observation;
};

export const observationCompletedCleanly = (input: unknown): boolean => {
  const observation = observationSchema.parse(input);
  return (
    observation.invocationStarted &&
    observation.exitCode === 0 &&
    observation.terminalBoundary === "turn.completed" &&
    (observation.eventCounts["turn.failed"] ?? 0) === 0 &&
    (observation.eventCounts["invalid-jsonl"] ?? 0) === 0
  );
};

const rawEventsContainAgentReply = (stdout: string): boolean => {
  for (const line of stdout.split(/\r?\n/u).filter((entry) => entry.length > 0)) {
    try {
      const event = JSON.parse(line) as Readonly<{
        type?: unknown;
        item?: Readonly<{ type?: unknown }>;
      }>;
      if (event.type === "item.completed" && event.item?.type === "agent_message") return true;
    } catch {
      // observationSchema event counts reject invalid JSONL from recovered pass evidence.
    }
  }
  return false;
};

const observationIsRecoverableInterruption = (input: unknown, rawEvents: string): boolean => {
  const observation = observationSchema.parse(input);
  return (
    observation.invocationStarted &&
    observation.exitCode !== 0 &&
    observation.terminalBoundary === "turn.failed" &&
    (observation.eventCounts["turn.failed"] ?? 0) === 1 &&
    (observation.eventCounts["turn.completed"] ?? 0) === 0 &&
    (observation.eventCounts["invalid-jsonl"] ?? 0) === 0 &&
    (observation.eventCounts["durable-evidence-rejected"] ?? 0) === 0 &&
    observation.state.before.repository === observation.state.after.repository &&
    observation.state.before.agentHome === observation.state.after.agentHome &&
    !rawEventsContainAgentReply(rawEvents)
  );
};

export const passingObservationChainCompleted = (input: {
  observations: readonly unknown[];
  rawEventStreams: readonly string[];
  sessionLastTurn: number | undefined;
}): boolean => {
  if (
    input.observations.length === 0 ||
    input.rawEventStreams.length !== input.observations.length
  ) {
    return false;
  }
  const observations = input.observations.map((observation) =>
    observationSchema.parse(observation),
  );
  if (
    input.sessionLastTurn !== observations.length ||
    !observationCompletedCleanly(observations.at(-1))
  ) {
    return false;
  }
  return observations.every((observation, index) => {
    if (observation.turn !== index + 1) return false;
    if (observationCompletedCleanly(observation)) return true;
    return (
      index < observations.length - 1 &&
      observationIsRecoverableInterruption(observation, input.rawEventStreams[index] ?? "")
    );
  });
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
