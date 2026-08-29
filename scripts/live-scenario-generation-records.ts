import { createHash } from "node:crypto";
import { mkdir, open, readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import writeFileAtomic from "write-file-atomic";
import { z } from "zod";
import { liveScenarioPackageSchema } from "./live-scenario-evidence";
import {
  liveScenarioBoundedPackageSchema,
  liveScenarioPackageEvidenceIdentity,
} from "./live-scenario-generation";
import { digestLiveScenarioFixture } from "./live-scenario-registry";

const fail = (message: string): never => {
  throw new Error(message);
};

const digestSchema = z.string().regex(/^[0-9a-f]{64}$/u);
const recordIdSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/u);
const generationIdSchema = z.string().uuid();
const scenarioIdSchema = z.string().regex(/^[A-Z]+-\d{2}$/u);
const terminalBoundarySchema = z.string().trim().min(1).max(120);
const outcomeSchema = z.enum(["pass", "fail", "blocked", "not-run"]);

const generationRecordSchema = z
  .object({
    schemaVersion: z.literal(1),
    recordType: z.literal("generation"),
    recordId: recordIdSchema,
    generationId: generationIdSchema,
    generationScope: z.literal("single-scenario-tracer"),
    package: liveScenarioBoundedPackageSchema,
    packageIdentitySha256: digestSchema,
    matrixDefinitionSha256: digestSchema,
    harnessIdentitySha256: digestSchema,
    admissionIdentitySha256: digestSchema,
    admissionBasisIdentitySha256: digestSchema,
    admittedScenarioCount: z.number().int().positive().safe(),
    scenarioId: scenarioIdSchema,
  })
  .strict();

const scenarioRecordSchema = z
  .object({
    schemaVersion: z.literal(1),
    recordType: z.literal("scenario"),
    recordId: recordIdSchema,
    generationId: generationIdSchema,
    generationRecordId: recordIdSchema,
    scenarioId: scenarioIdSchema,
    scenarioDefinitionSha256: digestSchema,
    fixtureIdentitySha256: digestSchema,
    declaredTurnCount: z.number().int().positive().safe(),
  })
  .strict();

const attemptRecordSchema = z
  .object({
    schemaVersion: z.literal(1),
    recordType: z.literal("attempt"),
    recordId: recordIdSchema,
    generationId: generationIdSchema,
    generationRecordId: recordIdSchema,
    scenarioId: scenarioIdSchema,
    scenarioRecordId: recordIdSchema,
    turn: z.number().int().positive().safe(),
    attempt: z.literal(1),
    promptSha256: digestSchema,
    invocationStarted: z.boolean(),
    terminalBoundary: terminalBoundarySchema,
    observationSha256: digestSchema,
  })
  .strict();

const turnRecordSchema = z
  .object({
    schemaVersion: z.literal(1),
    recordType: z.literal("turn"),
    recordId: recordIdSchema,
    generationId: generationIdSchema,
    generationRecordId: recordIdSchema,
    scenarioId: scenarioIdSchema,
    scenarioRecordId: recordIdSchema,
    turn: z.number().int().positive().safe(),
    promptSha256: digestSchema,
    terminalAttemptRecordId: recordIdSchema,
    terminalBoundary: terminalBoundarySchema,
  })
  .strict();

const scenarioResultRecordSchema = z
  .object({
    schemaVersion: z.literal(1),
    recordType: z.literal("scenario-result"),
    recordId: recordIdSchema,
    generationId: generationIdSchema,
    generationRecordId: recordIdSchema,
    scenarioId: scenarioIdSchema,
    scenarioRecordId: recordIdSchema,
    semanticEvaluationAuthority: z.literal("coordinating-agent"),
    outcome: outcomeSchema,
    evaluationSha256: digestSchema,
    turnRecordIds: z.array(recordIdSchema).min(1),
  })
  .strict();

const generationTerminalRecordSchema = z
  .object({
    schemaVersion: z.literal(1),
    recordType: z.literal("generation-terminal"),
    recordId: recordIdSchema,
    generationId: generationIdSchema,
    generationRecordId: recordIdSchema,
    disposition: z.literal("completed"),
    scenarioResultRecordId: recordIdSchema,
    semanticPassClaim: z.literal(false),
  })
  .strict();

type GenerationRecord = z.infer<typeof generationRecordSchema>;
type ScenarioRecord = z.infer<typeof scenarioRecordSchema>;
type AttemptRecord = z.infer<typeof attemptRecordSchema>;
type TurnRecord = z.infer<typeof turnRecordSchema>;
type ScenarioResultRecord = z.infer<typeof scenarioResultRecordSchema>;
type GenerationTerminalRecord = z.infer<typeof generationTerminalRecordSchema>;

type RecordSchema<T extends { readonly recordId: string; readonly recordType: string }> =
  z.ZodType<T>;

const sha256 = (value: Uint8Array | string): string =>
  createHash("sha256").update(value).digest("hex");

const recordIdentity = (recordType: string, value: unknown): string =>
  `sha256:${sha256(`${recordType}\0${JSON.stringify(value)}\n`)}`;

const buildRecord = <T extends { readonly recordId: string; readonly recordType: string }>(
  schema: RecordSchema<T>,
  value: Omit<T, "recordId">,
): T => schema.parse({ ...value, recordId: recordIdentity(value.recordType, value) });

const verifyRecordIdentity = <T extends { readonly recordId: string; readonly recordType: string }>(
  schema: RecordSchema<T>,
  value: unknown,
): T => {
  const parsed = schema.parse(value);
  const { recordId, ...identityBasis } = parsed;
  if (recordId !== recordIdentity(parsed.recordType, identityBasis)) {
    fail(`${parsed.recordType} record identity mismatch.`);
  }
  return Object.freeze(parsed);
};

const isMissing = (error: unknown): boolean =>
  error instanceof Error && "code" in error && error.code === "ENOENT";

const reserveCreateOnceTarget = async (path: string): Promise<void> => {
  try {
    const reservation = await open(path, "wx", 0o600);
    await reservation.close();
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EEXIST") {
      fail(`Immutable Generation record already exists: ${path}`);
    }
    throw error;
  }
};

const publishRecord = async <T extends { readonly recordId: string; readonly recordType: string }>(
  path: string,
  schema: RecordSchema<T>,
  record: T,
): Promise<T> => {
  await mkdir(dirname(path), { recursive: true });
  await reserveCreateOnceTarget(path);
  const bytes = `${JSON.stringify(record, null, 2)}\n`;
  await writeFileAtomic(path, bytes, { mode: 0o600, fsync: true });
  const readback = verifyRecordIdentity(schema, JSON.parse(await readFile(path, "utf8")));
  if (JSON.stringify(readback) !== JSON.stringify(record)) {
    fail(`${record.recordType} record exact readback mismatch.`);
  }
  return readback;
};

const readRecord = async <T extends { readonly recordId: string; readonly recordType: string }>(
  path: string,
  schema: RecordSchema<T>,
): Promise<T | undefined> => {
  try {
    return verifyRecordIdentity(schema, JSON.parse(await readFile(path, "utf8")));
  } catch (error) {
    if (isMissing(error)) return undefined;
    throw error;
  }
};

const generationPath = (root: string): string => join(root, "generation.json");
const scenarioRoot = (root: string, scenarioId: string): string =>
  join(root, "scenarios", scenarioId);
const scenarioPath = (root: string, scenarioId: string): string =>
  join(scenarioRoot(root, scenarioId), "scenario.json");
const attemptPath = (root: string, scenarioId: string, turn: number, attempt: number): string =>
  join(
    scenarioRoot(root, scenarioId),
    "attempts",
    `${String(turn).padStart(2, "0")}-${String(attempt).padStart(2, "0")}.json`,
  );
const turnPath = (root: string, scenarioId: string, turn: number): string =>
  join(scenarioRoot(root, scenarioId), "turns", `${String(turn).padStart(2, "0")}.json`);
const scenarioResultPath = (root: string, scenarioId: string): string =>
  join(scenarioRoot(root, scenarioId), "scenario-result.json");
const terminalPath = (root: string): string => join(root, "generation-terminal.json");

const assertGenerationInput = (
  inspected: Awaited<ReturnType<typeof inspectLiveScenarioGenerationRecords>>,
  generationId: string,
  scenarioId?: string,
): void => {
  if (
    inspected.generationId !== generationId ||
    (scenarioId !== undefined && inspected.records.generation.scenarioId !== scenarioId)
  ) {
    fail("Generation record identity does not match the requested operation.");
  }
  if (!inspected.resumable) {
    fail("Terminal Generation cannot append behavior or resume.");
  }
};

const readOrdinalRecords = async <
  T extends { readonly recordId: string; readonly recordType: string },
>(
  path: string,
  namePattern: RegExp,
  schema: RecordSchema<T>,
): Promise<T[]> => {
  let names: string[];
  try {
    names = await readdir(path);
  } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }
  if (names.some((name) => !namePattern.test(name))) {
    fail(`Generation record namespace contains an unexpected entry: ${path}`);
  }
  return Promise.all(
    names
      .sort((left, right) => left.localeCompare(right, "en"))
      .map(async (name) => {
        const record = await readRecord(join(path, name), schema);
        return record ?? fail(`Generation record disappeared during inspection: ${name}`);
      }),
  );
};

export const createLiveScenarioGenerationRecord = async (input: {
  generationRoot: string;
  generationId: string;
  package: unknown;
  matrixDefinitionSha256: string;
  harnessIdentitySha256: string;
  admissionIdentitySha256: string;
  admissionBasisIdentitySha256: string;
  admittedScenarioCount: number;
  scenarioId: string;
}): Promise<GenerationRecord> => {
  const generationRoot = resolve(input.generationRoot);
  await mkdir(generationRoot, { recursive: true });
  if ((await readdir(generationRoot)).length !== 0) {
    fail("New immutable Generation root must be empty.");
  }
  const matrixPackage = liveScenarioPackageSchema.parse(input.package);
  const boundedPackage = liveScenarioPackageEvidenceIdentity(matrixPackage);
  if (
    matrixPackage.matrixDefinitionSha256 !== input.matrixDefinitionSha256 ||
    input.scenarioId.trim().length === 0
  ) {
    fail("Generation basis identities contradict the admitted Scenario.");
  }
  const record = buildRecord(generationRecordSchema, {
    schemaVersion: 1,
    recordType: "generation",
    generationId: input.generationId,
    generationScope: "single-scenario-tracer",
    package: boundedPackage,
    packageIdentitySha256: sha256(`${JSON.stringify(boundedPackage)}\n`),
    matrixDefinitionSha256: input.matrixDefinitionSha256,
    harnessIdentitySha256: input.harnessIdentitySha256,
    admissionIdentitySha256: input.admissionIdentitySha256,
    admissionBasisIdentitySha256: input.admissionBasisIdentitySha256,
    admittedScenarioCount: input.admittedScenarioCount,
    scenarioId: input.scenarioId,
  });
  return publishRecord(generationPath(generationRoot), generationRecordSchema, record);
};

export const createLiveScenarioExecutionRecord = async (input: {
  generationRoot: string;
  generationId: string;
  scenarioId: string;
  scenarioDefinitionSha256: string;
  fixtureIdentitySha256: string;
  declaredTurnCount: number;
}): Promise<ScenarioRecord> => {
  const inspected = await inspectLiveScenarioGenerationRecords(input.generationRoot);
  assertGenerationInput(inspected, input.generationId, input.scenarioId);
  if (inspected.records.scenario !== undefined) {
    fail("Immutable Scenario record already exists.");
  }
  const record = buildRecord(scenarioRecordSchema, {
    schemaVersion: 1,
    recordType: "scenario",
    generationId: input.generationId,
    generationRecordId: inspected.records.generation.recordId,
    scenarioId: input.scenarioId,
    scenarioDefinitionSha256: input.scenarioDefinitionSha256,
    fixtureIdentitySha256: input.fixtureIdentitySha256,
    declaredTurnCount: input.declaredTurnCount,
  });
  return publishRecord(
    scenarioPath(resolve(input.generationRoot), input.scenarioId),
    scenarioRecordSchema,
    record,
  );
};

export const publishLiveScenarioAttemptReceipt = async (input: {
  generationRoot: string;
  generationId: string;
  scenarioId: string;
  turn: number;
  attempt: number;
  promptSha256: string;
  invocationStarted: boolean;
  terminalBoundary: string;
  observationSha256: string;
}): Promise<AttemptRecord> => {
  const inspected = await inspectLiveScenarioGenerationRecords(input.generationRoot);
  assertGenerationInput(inspected, input.generationId, input.scenarioId);
  const scenario = inspected.records.scenario ?? fail("Scenario record is unavailable.");
  if (
    input.attempt !== 1 ||
    input.turn !== inspected.records.turns.length + 1 ||
    inspected.records.attempts.some(({ turn }) => turn === input.turn)
  ) {
    fail("Generation tracer requires one first launch for the exact next Turn.");
  }
  if (input.turn > scenario.declaredTurnCount) {
    fail("Generation tracer Turn exceeds the admitted Scenario definition.");
  }
  const record = buildRecord(attemptRecordSchema, {
    schemaVersion: 1,
    recordType: "attempt",
    generationId: input.generationId,
    generationRecordId: inspected.records.generation.recordId,
    scenarioId: input.scenarioId,
    scenarioRecordId: scenario.recordId,
    turn: input.turn,
    attempt: 1,
    promptSha256: input.promptSha256,
    invocationStarted: input.invocationStarted,
    terminalBoundary: input.terminalBoundary,
    observationSha256: input.observationSha256,
  });
  return publishRecord(
    attemptPath(resolve(input.generationRoot), input.scenarioId, input.turn, input.attempt),
    attemptRecordSchema,
    record,
  );
};

export const publishLiveScenarioTurnReceipt = async (input: {
  generationRoot: string;
  generationId: string;
  scenarioId: string;
  turn: number;
  promptSha256: string;
  terminalAttemptRecordId: string;
  terminalBoundary: string;
}): Promise<TurnRecord> => {
  const inspected = await inspectLiveScenarioGenerationRecords(input.generationRoot);
  assertGenerationInput(inspected, input.generationId, input.scenarioId);
  const scenario = inspected.records.scenario ?? fail("Scenario record is unavailable.");
  const attempt =
    inspected.records.attempts.find(({ turn }) => turn === input.turn) ??
    fail("Turn receipt requires its published Attempt receipt.");
  if (
    input.turn !== inspected.records.turns.length + 1 ||
    attempt.recordId !== input.terminalAttemptRecordId ||
    attempt.promptSha256 !== input.promptSha256 ||
    attempt.terminalBoundary !== input.terminalBoundary
  ) {
    fail("Turn receipt contradicts its terminal Attempt identity.");
  }
  const record = buildRecord(turnRecordSchema, {
    schemaVersion: 1,
    recordType: "turn",
    generationId: input.generationId,
    generationRecordId: inspected.records.generation.recordId,
    scenarioId: input.scenarioId,
    scenarioRecordId: scenario.recordId,
    turn: input.turn,
    promptSha256: input.promptSha256,
    terminalAttemptRecordId: input.terminalAttemptRecordId,
    terminalBoundary: input.terminalBoundary,
  });
  return publishRecord(
    turnPath(resolve(input.generationRoot), input.scenarioId, input.turn),
    turnRecordSchema,
    record,
  );
};

export const publishLiveScenarioResultRecord = async (input: {
  generationRoot: string;
  generationId: string;
  scenarioId: string;
  outcome: "pass" | "fail" | "blocked" | "not-run";
  evaluationSha256: string;
  turnRecordIds: readonly string[];
}): Promise<ScenarioResultRecord> => {
  const inspected = await inspectLiveScenarioGenerationRecords(input.generationRoot);
  assertGenerationInput(inspected, input.generationId, input.scenarioId);
  const scenario = inspected.records.scenario ?? fail("Scenario record is unavailable.");
  if (
    inspected.records.scenarioResult !== undefined ||
    inspected.records.turns.length !== scenario.declaredTurnCount ||
    JSON.stringify(input.turnRecordIds) !==
      JSON.stringify(inspected.records.turns.map(({ recordId }) => recordId))
  ) {
    fail("Scenario Result requires the exact complete Turn record chain.");
  }
  const record = buildRecord(scenarioResultRecordSchema, {
    schemaVersion: 1,
    recordType: "scenario-result",
    generationId: input.generationId,
    generationRecordId: inspected.records.generation.recordId,
    scenarioId: input.scenarioId,
    scenarioRecordId: scenario.recordId,
    semanticEvaluationAuthority: "coordinating-agent",
    outcome: input.outcome,
    evaluationSha256: input.evaluationSha256,
    turnRecordIds: [...input.turnRecordIds],
  });
  return publishRecord(
    scenarioResultPath(resolve(input.generationRoot), input.scenarioId),
    scenarioResultRecordSchema,
    record,
  );
};

export const terminateLiveScenarioGeneration = async (input: {
  generationRoot: string;
  generationId: string;
  disposition: "completed";
  scenarioResultRecordId: string;
}): Promise<GenerationTerminalRecord> => {
  const inspected = await inspectLiveScenarioGenerationRecords(input.generationRoot);
  assertGenerationInput(inspected, input.generationId);
  const result =
    inspected.records.scenarioResult ?? fail("Generation completion requires a Scenario Result.");
  if (result.recordId !== input.scenarioResultRecordId) {
    fail("Generation Terminal contradicts its Scenario Result identity.");
  }
  const record = buildRecord(generationTerminalRecordSchema, {
    schemaVersion: 1,
    recordType: "generation-terminal",
    generationId: input.generationId,
    generationRecordId: inspected.records.generation.recordId,
    disposition: input.disposition,
    scenarioResultRecordId: input.scenarioResultRecordId,
    semanticPassClaim: false,
  });
  return publishRecord(
    terminalPath(resolve(input.generationRoot)),
    generationTerminalRecordSchema,
    record,
  );
};

export const inspectLiveScenarioGenerationRecords = async (generationRootInput: string) => {
  const generationRoot = resolve(generationRootInput);
  const generation =
    (await readRecord(generationPath(generationRoot), generationRecordSchema)) ??
    fail("Generation record is unavailable.");
  const scenario = await readRecord(
    scenarioPath(generationRoot, generation.scenarioId),
    scenarioRecordSchema,
  );
  const attempts = await readOrdinalRecords(
    join(scenarioRoot(generationRoot, generation.scenarioId), "attempts"),
    /^\d{2,}-01\.json$/u,
    attemptRecordSchema,
  );
  const turns = await readOrdinalRecords(
    join(scenarioRoot(generationRoot, generation.scenarioId), "turns"),
    /^\d{2,}\.json$/u,
    turnRecordSchema,
  );
  const scenarioResult = await readRecord(
    scenarioResultPath(generationRoot, generation.scenarioId),
    scenarioResultRecordSchema,
  );
  const terminal = await readRecord(terminalPath(generationRoot), generationTerminalRecordSchema);

  if (
    generation.packageIdentitySha256 !== sha256(`${JSON.stringify(generation.package)}\n`) ||
    generation.package.matrixDefinitionSha256 !== generation.matrixDefinitionSha256
  ) {
    fail("Generation package or Matrix identity is internally inconsistent.");
  }
  if (
    scenario !== undefined &&
    (scenario.generationId !== generation.generationId ||
      scenario.generationRecordId !== generation.recordId ||
      scenario.scenarioId !== generation.scenarioId)
  ) {
    fail("Scenario record does not belong to this Generation.");
  }
  if (
    attempts.some(
      (attempt, index) =>
        scenario === undefined ||
        attempt.generationId !== generation.generationId ||
        attempt.generationRecordId !== generation.recordId ||
        attempt.scenarioRecordId !== scenario.recordId ||
        attempt.scenarioId !== scenario.scenarioId ||
        attempt.turn !== index + 1,
    )
  ) {
    fail("Attempt record chain is not contiguous or identity-bound.");
  }
  if (
    turns.some((turn, index) => {
      const attempt = attempts[index];
      return (
        scenario === undefined ||
        attempt === undefined ||
        turn.generationId !== generation.generationId ||
        turn.generationRecordId !== generation.recordId ||
        turn.scenarioRecordId !== scenario.recordId ||
        turn.scenarioId !== scenario.scenarioId ||
        turn.turn !== index + 1 ||
        turn.terminalAttemptRecordId !== attempt.recordId ||
        turn.promptSha256 !== attempt.promptSha256 ||
        turn.terminalBoundary !== attempt.terminalBoundary
      );
    })
  ) {
    fail("Turn record chain is not contiguous or identity-bound.");
  }
  if (
    scenarioResult !== undefined &&
    (scenario === undefined ||
      scenarioResult.generationId !== generation.generationId ||
      scenarioResult.generationRecordId !== generation.recordId ||
      scenarioResult.scenarioRecordId !== scenario.recordId ||
      scenarioResult.scenarioId !== scenario.scenarioId ||
      turns.length !== scenario.declaredTurnCount ||
      JSON.stringify(scenarioResult.turnRecordIds) !==
        JSON.stringify(turns.map(({ recordId }) => recordId)))
  ) {
    fail("Scenario Result does not close the exact Turn record chain.");
  }
  if (
    terminal !== undefined &&
    (scenarioResult === undefined ||
      terminal.generationId !== generation.generationId ||
      terminal.generationRecordId !== generation.recordId ||
      terminal.scenarioResultRecordId !== scenarioResult.recordId)
  ) {
    fail("Generation Terminal does not close the exact Scenario Result.");
  }

  const nextOperation =
    terminal !== undefined
      ? "fresh-generation-required"
      : scenario === undefined
        ? "create-scenario"
        : scenarioResult !== undefined
          ? "terminate-generation"
          : turns.length === scenario.declaredTurnCount
            ? "publish-scenario-result"
            : attempts.length > turns.length
              ? "publish-turn"
              : "publish-attempt";
  return Object.freeze({
    schemaVersion: 1 as const,
    generationId: generation.generationId,
    lifecycle: terminal === undefined ? ("active" as const) : ("completed" as const),
    resumable: terminal === undefined,
    semanticPassClaim: false as const,
    nextOperation,
    records: Object.freeze({
      generation,
      scenario,
      attempts: Object.freeze(attempts),
      turns: Object.freeze(turns),
      scenarioResult,
      terminal,
    }),
  });
};

const liveScenarioHarnessFiles = Object.freeze([
  ".gitleaks.toml",
  "docs/agents/codex-e2e.md",
  "package-lock.json",
  "package.json",
]);

export const liveScenarioHarnessIdentitySha256 = async (input: {
  sourceRoot: string;
}): Promise<string> => {
  const sourceRoot = resolve(input.sourceRoot);
  const fileFrames = await Promise.all(
    liveScenarioHarnessFiles.map(async (locator) => {
      const bytes = await readFile(join(sourceRoot, locator));
      return `${locator}\0${bytes.byteLength}\0${sha256(bytes)}\n`;
    }),
  );
  const scriptsSha256 = await digestLiveScenarioFixture(join(sourceRoot, "scripts"));
  return sha256(`live-scenario-harness-v1\0scripts\0${scriptsSha256}\n${fileFrames.join("")}`);
};
