import { createHash, randomUUID } from "node:crypto";
import type { Dirent } from "node:fs";
import { link, lstat, mkdir, readdir, readFile, realpath, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import writeFileAtomic from "write-file-atomic";
import { z } from "zod";
import { scanLiveScenarioDurableEvidence } from "./live-scenario-evidence";
import {
  liveScenarioMatrixPackageIdentitySha256,
  liveScenarioMatrixSharedIdentity,
  parseLiveScenarioMatrixResultForScenarioIds,
  parseLiveScenarioResult,
} from "./live-scenario-generation";

const fail = (message: string): never => {
  throw new Error(message);
};

const sha256 = (value: Uint8Array | string): string =>
  createHash("sha256").update(value).digest("hex");
const digestSchema = z.string().regex(/^[0-9a-f]{64}$/u);
const recordIdSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/u);
const generationIdSchema = z.string().uuid();
const scenarioIdSchema = z.string().regex(/^[A-Z]+-\d{2}$/u);
const scenarioWriterSchema = z.string().regex(/^scenario-runner:[A-Z]+-\d{2}$/u);
const outcomeSchema = z.enum(["pass", "fail", "blocked", "not-run"]);
const terminalBoundarySchema = z.string().trim().min(1).max(120);
const publicationIdSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u);
const pointerSchema = z
  .string()
  .min(1)
  .max(240)
  .superRefine((pointer, context) => {
    if (
      isAbsolute(pointer) ||
      pointer.includes("\\") ||
      pointer.split("/").some((part) => part === "" || part === "." || part === "..")
    ) {
      context.addIssue({
        code: "custom",
        message: "Evidence pointer must stay bounded and relative.",
      });
    }
  });
const durablePointerSchema = pointerSchema.refine(
  (pointer) => pointer.startsWith("payloads/") && pointer !== "payloads/",
  "Durable evidence pointer must stay inside payloads/.",
);
const durableReferenceSchema = z
  .object({ pointer: durablePointerSchema, sha256: digestSchema })
  .strict();

const convergencePayloadIdentitySchema = z.object({
  generationId: generationIdSchema,
  terminalRecordId: recordIdSchema,
  scenarioResultRecordIds: z.array(recordIdSchema).min(1),
});

const predecessorSchema = z
  .object({
    generationId: generationIdSchema,
    generationRecordId: recordIdSchema,
    reason: z.string().trim().min(1).max(300),
  })
  .strict();

const generationRecordSchema = z
  .object({
    schemaVersion: z.literal(1),
    recordType: z.literal("generation"),
    recordId: recordIdSchema,
    writer: z.literal("coordinator"),
    ordinal: z.literal(1),
    generationId: generationIdSchema,
    scenarioIds: z.array(scenarioIdSchema).min(1).max(128),
    packageIdentitySha256: digestSchema,
    matrixDefinitionSha256: digestSchema,
    harnessIdentitySha256: digestSchema,
    admissionIdentitySha256: digestSchema,
    predecessor: predecessorSchema.optional(),
  })
  .strict()
  .superRefine((record, context) => {
    if (new Set(record.scenarioIds).size !== record.scenarioIds.length) {
      context.addIssue({
        code: "custom",
        message: "Generation Scenario identities must be unique.",
      });
    }
  });

const scenarioRecordSchema = z
  .object({
    schemaVersion: z.literal(1),
    recordType: z.literal("scenario"),
    recordId: recordIdSchema,
    writer: scenarioWriterSchema,
    ordinal: z.number().int().positive().safe(),
    generationId: generationIdSchema,
    generationRecordId: recordIdSchema,
    scenarioId: scenarioIdSchema,
    definitionSha256: digestSchema,
    fixtureSha256: digestSchema,
    declaredTurnCount: z.number().int().positive().safe(),
  })
  .strict();

const attemptRecordSchema = z
  .object({
    schemaVersion: z.literal(1),
    recordType: z.literal("attempt"),
    recordId: recordIdSchema,
    writer: scenarioWriterSchema,
    ordinal: z.number().int().positive().safe(),
    generationId: generationIdSchema,
    generationRecordId: recordIdSchema,
    scenarioId: scenarioIdSchema,
    scenarioRecordId: recordIdSchema,
    turn: z.number().int().positive().safe(),
    attempt: z.number().int().positive().safe(),
    previousAttemptRecordId: recordIdSchema.optional(),
    promptSha256: digestSchema,
    runtimeIdentitySha256: digestSchema,
  })
  .strict();

const turnRecordSchema = z
  .object({
    schemaVersion: z.literal(1),
    recordType: z.literal("turn"),
    recordId: recordIdSchema,
    writer: scenarioWriterSchema,
    ordinal: z.number().int().positive().safe(),
    generationId: generationIdSchema,
    generationRecordId: recordIdSchema,
    scenarioId: scenarioIdSchema,
    scenarioRecordId: recordIdSchema,
    turn: z.number().int().positive().safe(),
    attemptRecordIds: z.array(recordIdSchema).min(1),
    terminalAttemptRecordId: recordIdSchema,
    observationSha256: digestSchema,
    terminalBoundary: terminalBoundarySchema,
  })
  .strict();

const scenarioResultRecordSchema = z
  .object({
    schemaVersion: z.literal(1),
    recordType: z.literal("scenario-result"),
    recordId: recordIdSchema,
    writer: z.literal("coordinator"),
    ordinal: z.number().int().positive().safe(),
    generationId: generationIdSchema,
    generationRecordId: recordIdSchema,
    scenarioId: scenarioIdSchema,
    scenarioRecordId: recordIdSchema,
    outcome: outcomeSchema,
    evidence: durableReferenceSchema,
    turnRecordIds: z.array(recordIdSchema).min(1),
  })
  .strict();

const convergenceReviewRecordSchema = z
  .object({
    schemaVersion: z.literal(1),
    recordType: z.literal("convergence-review"),
    recordId: recordIdSchema,
    writer: z.literal("coordinator"),
    ordinal: z.literal(1),
    generationId: generationIdSchema,
    generationRecordId: recordIdSchema,
    terminalRecordId: recordIdSchema,
    scenarioResultRecordIds: z.array(recordIdSchema).min(1),
    evidence: durableReferenceSchema,
  })
  .strict();

const matrixResultRecordSchema = z
  .object({
    schemaVersion: z.literal(1),
    recordType: z.literal("matrix-result"),
    recordId: recordIdSchema,
    writer: z.literal("coordinator"),
    ordinal: z.literal(1),
    generationId: generationIdSchema,
    generationRecordId: recordIdSchema,
    scenarioResultRecordIds: z.array(recordIdSchema).min(1),
    evidence: durableReferenceSchema,
  })
  .strict();

const terminalRecordSchema = z
  .object({
    schemaVersion: z.literal(1),
    recordType: z.literal("generation-terminal"),
    recordId: recordIdSchema,
    writer: z.literal("coordinator"),
    ordinal: z.literal(1),
    generationId: generationIdSchema,
    generationRecordId: recordIdSchema,
    matrixResultRecordId: recordIdSchema,
    disposition: z.literal("completed"),
  })
  .strict();

type GenerationRecord = z.infer<typeof generationRecordSchema>;
type ScenarioRecord = z.infer<typeof scenarioRecordSchema>;
type AttemptRecord = z.infer<typeof attemptRecordSchema>;
type TurnRecord = z.infer<typeof turnRecordSchema>;
type ScenarioResultRecord = z.infer<typeof scenarioResultRecordSchema>;
type ConvergenceReviewRecord = z.infer<typeof convergenceReviewRecordSchema>;
type MatrixResultRecord = z.infer<typeof matrixResultRecordSchema>;
type TerminalRecord = z.infer<typeof terminalRecordSchema>;
type ImmutableRecord = { readonly recordId: string; readonly recordType: string };
type RecordSchema<T extends ImmutableRecord> = z.ZodType<T>;

const recordIdentity = (recordType: string, value: unknown): string =>
  `sha256:${sha256(`${recordType}\0${JSON.stringify(value)}\n`)}`;

const buildRecord = <T extends ImmutableRecord>(
  schema: RecordSchema<T>,
  value: Omit<T, "recordId">,
): T => schema.parse({ ...value, recordId: recordIdentity(value.recordType, value) });

const parseRecord = <T extends ImmutableRecord>(schema: RecordSchema<T>, value: unknown): T => {
  const parsed = schema.parse(value);
  const { recordId, ...identityBasis } = parsed;
  if (recordId !== recordIdentity(parsed.recordType, identityBasis)) {
    fail(`${parsed.recordType} record identity mismatch.`);
  }
  return Object.freeze(parsed);
};

const isMissing = (error: unknown): boolean =>
  error instanceof Error && "code" in error && error.code === "ENOENT";

const pathExists = async (path: string): Promise<boolean> => {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
};

export const liveMatrixRecordCandidateRoot = (evidenceRoot: string): string =>
  join(
    dirname(resolve(evidenceRoot)),
    ".live-matrix-private-record-candidates",
    sha256(resolve(evidenceRoot)),
  );

export const liveMatrixPrivateControlRoot = (evidenceRoot: string): string =>
  join(
    dirname(resolve(evidenceRoot)),
    ".live-matrix-private-control",
    sha256(resolve(evidenceRoot)),
  );

const createOnceBytes = async (
  path: string,
  bytes: Uint8Array | string,
  privateCandidateDirectory = dirname(path),
): Promise<void> => {
  await mkdir(dirname(path), { recursive: true });
  await mkdir(privateCandidateDirectory, { recursive: true });
  const expected = Buffer.from(bytes);
  const candidate = join(
    privateCandidateDirectory,
    `.create-once-${basename(path)}-${sha256(expected)}-${randomUUID()}.candidate`,
  );
  await writeFileAtomic(candidate, expected, { mode: 0o600, fsync: true });
  if (
    privateCandidateDirectory !== dirname(path) &&
    process.env["NODE_ENV"] === "test" &&
    process.env["BEARING_LIVE_MATRIX_TEST_CRASH_AFTER_RECORD_CANDIDATE"] === "1"
  ) {
    fail("Injected crash after record candidate staging.");
  }
  try {
    await link(candidate, path);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EEXIST") {
      const targetState = await lstat(path);
      if (
        !targetState.isFile() ||
        targetState.isSymbolicLink() ||
        !(await readFile(path)).equals(expected)
      ) {
        fail(`Immutable evidence has an unexpected writer overlap: ${path}`);
      }
    } else throw error;
  } finally {
    await rm(candidate, { force: true });
  }
  if (!(await readFile(path)).equals(expected))
    fail(`Immutable evidence exact readback mismatch: ${path}`);
};

const publishRecord = async <T extends ImmutableRecord>(
  evidenceRoot: string,
  path: string,
  schema: RecordSchema<T>,
  record: T,
): Promise<T> => {
  const bytes = `${JSON.stringify(record, null, 2)}\n`;
  const candidateRoot = liveMatrixRecordCandidateRoot(evidenceRoot);
  await createOnceBytes(path, bytes, candidateRoot);
  const readback = parseRecord(schema, JSON.parse(await readFile(path, "utf8")));
  if (JSON.stringify(readback) !== JSON.stringify(record)) {
    fail(`${record.recordType} record exact readback mismatch.`);
  }
  return readback;
};

const readRecord = async <T extends ImmutableRecord>(
  path: string,
  schema: RecordSchema<T>,
): Promise<T | undefined> => {
  try {
    return parseRecord(schema, JSON.parse(await readFile(path, "utf8")));
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
const attemptRoot = (root: string, scenarioId: string): string =>
  join(scenarioRoot(root, scenarioId), "attempts");
const attemptPath = (root: string, scenarioId: string, turn: number, attempt: number): string =>
  join(
    attemptRoot(root, scenarioId),
    `${String(turn).padStart(2, "0")}-${String(attempt).padStart(2, "0")}.json`,
  );
const turnRoot = (root: string, scenarioId: string): string =>
  join(scenarioRoot(root, scenarioId), "turns");
const turnPath = (root: string, scenarioId: string, turn: number): string =>
  join(turnRoot(root, scenarioId), `${String(turn).padStart(2, "0")}.json`);
const coordinatorRoot = (root: string): string => join(root, "coordinator");
const scenarioResultRoot = (root: string): string =>
  join(coordinatorRoot(root), "scenario-results");
const scenarioResultPath = (root: string, scenarioId: string): string =>
  join(scenarioResultRoot(root), `${scenarioId}.json`);
const convergencePath = (root: string): string =>
  join(coordinatorRoot(root), "convergence-review.json");
const matrixResultPath = (root: string): string =>
  join(coordinatorRoot(root), "matrix-result.json");
const terminalPath = (root: string): string =>
  join(coordinatorRoot(root), "generation-terminal.json");

const verifyDurableReference = async (
  evidenceRoot: string,
  reference: z.infer<typeof durableReferenceSchema>,
): Promise<unknown> => {
  const bounded = durableReferenceSchema.parse(reference);
  const root = await realpath(resolve(evidenceRoot));
  let target: string;
  try {
    target = await realpath(resolve(root, bounded.pointer));
  } catch (error) {
    if (isMissing(error)) fail(`Durable evidence pointer is missing: ${bounded.pointer}.`);
    throw error;
  }
  const relation = relative(root, target);
  if (
    relation === "" ||
    relation.startsWith("..") ||
    relation.startsWith(`..${sep}`) ||
    isAbsolute(relation)
  ) {
    fail(`Durable evidence pointer escapes its bundle: ${bounded.pointer}.`);
  }
  const bytes = await readFile(target);
  if (sha256(bytes) !== bounded.sha256) {
    fail(`Durable evidence pointer digest mismatch: ${bounded.pointer}.`);
  }
  const value: unknown = JSON.parse(bytes.toString("utf8"));
  assertSecretFreeDurableValue(value);
  return value;
};

const scenarioPayloadIdentity = async (
  evidenceRoot: string,
  reference: z.infer<typeof durableReferenceSchema>,
) => parseLiveScenarioResult(await verifyDurableReference(evidenceRoot, reference));

const matrixPayloadIdentity = async (
  evidenceRoot: string,
  reference: z.infer<typeof durableReferenceSchema>,
  scenarioIds: readonly string[],
) =>
  parseLiveScenarioMatrixResultForScenarioIds(
    await verifyDurableReference(evidenceRoot, reference),
    scenarioIds,
  );

const convergencePayloadIdentity = async (
  evidenceRoot: string,
  reference: z.infer<typeof durableReferenceSchema>,
) => convergencePayloadIdentitySchema.parse(await verifyDurableReference(evidenceRoot, reference));

const assertScenarioPayloadClosure = (
  payload: ReturnType<typeof parseLiveScenarioResult>,
  generation: GenerationRecord,
  scenario: ScenarioRecord,
  outcome: z.infer<typeof outcomeSchema>,
): void => {
  if (
    payload.generationId !== generation.generationId ||
    payload.scenarioId !== scenario.scenarioId ||
    payload.evaluation.outcome !== outcome ||
    payload.startingStateSha256 !== scenario.fixtureSha256 ||
    payload.matrixDefinitionSha256 !== generation.matrixDefinitionSha256 ||
    liveScenarioMatrixPackageIdentitySha256(payload.package) !== generation.packageIdentitySha256
  ) {
    fail(`Scenario Result payload identity contradicts its record: ${scenario.scenarioId}.`);
  }
};

const matrixScenarioProjection = (
  result: ScenarioResultRecord,
  payload: ReturnType<typeof parseLiveScenarioResult>,
  matrixPayloadPointer: string,
) => ({
  scenarioId: result.scenarioId,
  outcome: result.outcome,
  durationMs: payload.durationMs,
  startingStateSha256: payload.startingStateSha256,
  attempts: payload.attempts,
  ...(payload.remoteIntegrity === undefined ? {} : { remoteIntegrity: payload.remoteIntegrity }),
  rationale: payload.evaluation.rationale,
  result: {
    pointer: relative(dirname(matrixPayloadPointer), result.evidence.pointer).replaceAll("\\", "/"),
    sha256: result.evidence.sha256,
  },
});

const assertMatrixPayloadClosure = async (
  evidenceRoot: string,
  generation: GenerationRecord,
  results: readonly ScenarioResultRecord[],
  payload: ReturnType<typeof parseLiveScenarioMatrixResultForScenarioIds>,
  matrixPayloadPointer: string,
): Promise<void> => {
  const matrixIdentity = JSON.stringify(liveScenarioMatrixSharedIdentity(payload));
  const expectedScenarios = await Promise.all(
    results.map(async (result) => {
      const scenario =
        (await readRecord(scenarioPath(evidenceRoot, result.scenarioId), scenarioRecordSchema)) ??
        fail(`Matrix Result Scenario is unavailable: ${result.scenarioId}.`);
      const scenarioPayload = await scenarioPayloadIdentity(evidenceRoot, result.evidence);
      assertScenarioPayloadClosure(scenarioPayload, generation, scenario, result.outcome);
      if (JSON.stringify(liveScenarioMatrixSharedIdentity(scenarioPayload)) !== matrixIdentity) {
        fail("Matrix Result payload identity contradicts its exact Scenario Result set.");
      }
      return matrixScenarioProjection(result, scenarioPayload, matrixPayloadPointer);
    }),
  );
  if (
    payload.generationId !== generation.generationId ||
    payload.matrixDefinitionSha256 !== generation.matrixDefinitionSha256 ||
    liveScenarioMatrixPackageIdentitySha256(payload.package) !== generation.packageIdentitySha256 ||
    JSON.stringify(payload.scenarios) !== JSON.stringify(expectedScenarios)
  ) {
    fail("Matrix Result payload identity contradicts its exact Scenario Result set.");
  }
};

const readDirectory = async (path: string): Promise<string[]> => {
  try {
    return (await readdir(path)).sort((left, right) => left.localeCompare(right, "en"));
  } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }
};

const assertOnlyNames = (path: string, names: readonly string[], allowed: readonly string[]) => {
  const unexpected = names.find((name) => !allowed.includes(name));
  if (unexpected !== undefined)
    fail(`Evidence namespace has an unexpected entry: ${path}/${unexpected}`);
};

const readPayloadNamespace = async (
  evidenceRoot: string,
): Promise<{ readonly files: readonly string[]; readonly directories: readonly string[] }> => {
  const payloadRoot = join(evidenceRoot, "payloads");
  const files: string[] = [];
  const directories: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    let entries: Dirent<string>[];
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (isMissing(error)) return;
      throw error;
    }
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name, "en"))) {
      const absolute = join(directory, entry.name);
      const pointer = relative(evidenceRoot, absolute).replaceAll("\\", "/");
      if (entry.isSymbolicLink())
        fail(`Evidence namespace has an unexpected payload entry: ${pointer}`);
      if (entry.isDirectory()) {
        directories.push(pointer);
        await visit(absolute);
      } else if (entry.isFile()) files.push(pointer);
      else fail(`Evidence namespace has an unexpected payload entry: ${pointer}`);
    }
  };
  await visit(payloadRoot);
  return Object.freeze({ files: Object.freeze(files), directories: Object.freeze(directories) });
};

const assertPayloadNamespaceClosed = async (
  evidenceRoot: string,
  references: readonly z.infer<typeof durableReferenceSchema>[],
): Promise<void> => {
  const pointers = references.map(({ pointer }) => pointer);
  if (new Set(pointers).size !== pointers.length) {
    fail("Durable evidence records must not share one payload pointer.");
  }
  const expectedDirectories = new Set<string>();
  for (const pointer of pointers) {
    let parent = dirname(pointer).replaceAll("\\", "/");
    while (parent !== "." && parent !== "payloads") {
      expectedDirectories.add(parent);
      parent = dirname(parent).replaceAll("\\", "/");
    }
  }
  const observed = await readPayloadNamespace(evidenceRoot);
  const unexpectedFile = observed.files.find((pointer) => !pointers.includes(pointer));
  const missingFile = pointers.find((pointer) => !observed.files.includes(pointer));
  const unexpectedDirectory = observed.directories.find(
    (pointer) => !expectedDirectories.has(pointer),
  );
  if (
    unexpectedFile !== undefined ||
    missingFile !== undefined ||
    unexpectedDirectory !== undefined
  ) {
    fail(
      `Evidence namespace has an unexpected payload entry: ${unexpectedFile ?? unexpectedDirectory ?? missingFile}`,
    );
  }
};

const readAttemptRecords = async (root: string, scenarioId: string): Promise<AttemptRecord[]> => {
  const names = await readDirectory(attemptRoot(root, scenarioId));
  if (names.some((name) => !/^\d{2,}-\d{2,}\.json$/u.test(name))) {
    fail(`Scenario runner namespace contains an unexpected Attempt entry: ${scenarioId}.`);
  }
  const records = await Promise.all(
    names.map(async (name) => {
      const record =
        (await readRecord(join(attemptRoot(root, scenarioId), name), attemptRecordSchema)) ??
        fail(`Attempt record disappeared during inspection: ${scenarioId}/${name}`);
      if (name !== basename(attemptPath(root, scenarioId, record.turn, record.attempt))) {
        fail(`Attempt filename contradicts its record identity: ${scenarioId}/${name}.`);
      }
      return record;
    }),
  );
  return records.sort((left, right) => left.turn - right.turn || left.attempt - right.attempt);
};

const readTurnRecords = async (root: string, scenarioId: string): Promise<TurnRecord[]> => {
  const names = await readDirectory(turnRoot(root, scenarioId));
  if (names.some((name) => !/^\d{2,}\.json$/u.test(name))) {
    fail(`Scenario runner namespace contains an unexpected Turn entry: ${scenarioId}.`);
  }
  const records = await Promise.all(
    names.map(async (name) => {
      const record =
        (await readRecord(join(turnRoot(root, scenarioId), name), turnRecordSchema)) ??
        fail(`Turn record disappeared during inspection: ${scenarioId}/${name}`);
      if (name !== basename(turnPath(root, scenarioId, record.turn))) {
        fail(`Turn filename contradicts its record identity: ${scenarioId}/${name}.`);
      }
      return record;
    }),
  );
  return records.sort((left, right) => left.turn - right.turn);
};

export const inspectLiveMatrixEvidenceRecords = async (evidenceRootInput: string) => {
  const evidenceRoot = resolve(evidenceRootInput);
  assertOnlyNames(evidenceRoot, await readDirectory(evidenceRoot), [
    "generation.json",
    "scenarios",
    "coordinator",
    "payloads",
  ]);
  const generation =
    (await readRecord(generationPath(evidenceRoot), generationRecordSchema)) ??
    fail("Generation record is unavailable.");
  assertOnlyNames(
    coordinatorRoot(evidenceRoot),
    await readDirectory(coordinatorRoot(evidenceRoot)),
    [
      "scenario-results",
      "matrix-result.json",
      "generation-terminal.json",
      "convergence-review.json",
    ],
  );
  const observedScenarioNamespaces = await readDirectory(join(evidenceRoot, "scenarios"));
  const unexpectedScenario = observedScenarioNamespaces.find(
    (scenarioId) => !generation.scenarioIds.includes(scenarioId),
  );
  if (unexpectedScenario !== undefined) {
    fail(`Generation contains an unexpected Scenario namespace: ${unexpectedScenario}.`);
  }

  const scenarios: ScenarioRecord[] = [];
  const attempts: AttemptRecord[] = [];
  const turns: TurnRecord[] = [];
  for (const [scenarioIndex, scenarioId] of generation.scenarioIds.entries()) {
    const root = scenarioRoot(evidenceRoot, scenarioId);
    const names = await readDirectory(root);
    assertOnlyNames(root, names, ["scenario.json", "attempts", "turns"]);
    const scenario = await readRecord(scenarioPath(evidenceRoot, scenarioId), scenarioRecordSchema);
    const scenarioAttempts = await readAttemptRecords(evidenceRoot, scenarioId);
    const scenarioTurns = await readTurnRecords(evidenceRoot, scenarioId);
    if (scenario === undefined && (scenarioAttempts.length > 0 || scenarioTurns.length > 0)) {
      fail(`Scenario ${scenarioId} has child records without its parent.`);
    }
    if (
      scenario !== undefined &&
      (scenario.writer !== `scenario-runner:${scenarioId}` ||
        scenario.ordinal !== scenarioIndex + 1 ||
        scenario.generationId !== generation.generationId ||
        scenario.generationRecordId !== generation.recordId ||
        scenario.scenarioId !== scenarioId)
    ) {
      fail(`Scenario ${scenarioId} has invalid writer, ordinal, or parent closure.`);
    }
    for (const attempt of scenarioAttempts) {
      const sameTurn = scenarioAttempts.filter(({ turn }) => turn === attempt.turn);
      const index = sameTurn.findIndex(({ recordId }) => recordId === attempt.recordId);
      if (
        scenario === undefined ||
        attempt.writer !== `scenario-runner:${scenarioId}` ||
        attempt.ordinal !== attempt.attempt ||
        attempt.attempt !== index + 1 ||
        attempt.previousAttemptRecordId !==
          (index === 0 ? undefined : sameTurn[index - 1]?.recordId) ||
        attempt.generationId !== generation.generationId ||
        attempt.generationRecordId !== generation.recordId ||
        attempt.scenarioRecordId !== scenario.recordId ||
        attempt.scenarioId !== scenarioId ||
        attempt.turn > scenario.declaredTurnCount
      ) {
        fail(`Attempt record chain has invalid writer, ordinal, or parent closure: ${scenarioId}.`);
      }
    }
    for (const [turnIndex, turn] of scenarioTurns.entries()) {
      const citedAttempts = scenarioAttempts.filter(
        ({ turn: attemptTurn }) => attemptTurn === turn.turn,
      );
      if (
        scenario === undefined ||
        turn.writer !== `scenario-runner:${scenarioId}` ||
        turn.ordinal !== turnIndex + 1 ||
        turn.turn !== turnIndex + 1 ||
        turn.generationId !== generation.generationId ||
        turn.generationRecordId !== generation.recordId ||
        turn.scenarioRecordId !== scenario.recordId ||
        turn.scenarioId !== scenarioId ||
        JSON.stringify(turn.attemptRecordIds) !==
          JSON.stringify(citedAttempts.map(({ recordId }) => recordId)) ||
        turn.terminalAttemptRecordId !== citedAttempts.at(-1)?.recordId
      ) {
        fail(`Turn record chain has invalid writer, ordinal, or pointer closure: ${scenarioId}.`);
      }
    }
    if (scenarioTurns.length > 0) {
      const openAttempts = scenarioAttempts.filter(
        ({ turn }) => !scenarioTurns.some((record) => record.turn === turn),
      );
      if (openAttempts.some(({ turn }) => turn !== scenarioTurns.length + 1)) {
        fail(`Scenario ${scenarioId} has an impossible Attempt lifecycle.`);
      }
    }
    if (scenario !== undefined) scenarios.push(scenario);
    attempts.push(...scenarioAttempts);
    turns.push(...scenarioTurns);
  }

  const resultNames = await readDirectory(scenarioResultRoot(evidenceRoot));
  const expectedResultNames = generation.scenarioIds.map((scenarioId) => `${scenarioId}.json`);
  if (resultNames.some((name) => !expectedResultNames.includes(name))) {
    fail("Coordinator namespace contains an unexpected Scenario Result writer overlap.");
  }
  const scenarioResults = (
    await Promise.all(
      generation.scenarioIds.map((scenarioId) =>
        readRecord(scenarioResultPath(evidenceRoot, scenarioId), scenarioResultRecordSchema),
      ),
    )
  ).filter((record): record is ScenarioResultRecord => record !== undefined);
  for (const result of scenarioResults) {
    const index = generation.scenarioIds.indexOf(result.scenarioId);
    const scenario = scenarios.find(({ scenarioId }) => scenarioId === result.scenarioId);
    const scenarioTurns = turns.filter(({ scenarioId }) => scenarioId === result.scenarioId);
    if (
      scenario === undefined ||
      result.writer !== "coordinator" ||
      result.ordinal !== index + 1 ||
      result.generationId !== generation.generationId ||
      result.generationRecordId !== generation.recordId ||
      result.scenarioRecordId !== scenario.recordId ||
      scenarioTurns.length !== scenario.declaredTurnCount ||
      JSON.stringify(result.turnRecordIds) !==
        JSON.stringify(scenarioTurns.map(({ recordId }) => recordId))
    ) {
      fail(`Scenario Result does not close the exact Scenario record chain: ${result.scenarioId}.`);
    }
    const payload = await scenarioPayloadIdentity(evidenceRoot, result.evidence);
    assertScenarioPayloadClosure(
      payload,
      generation,
      scenario ?? fail(`Scenario Result parent is unavailable: ${result.scenarioId}.`),
      result.outcome,
    );
  }

  const convergenceReview = await readRecord(
    convergencePath(evidenceRoot),
    convergenceReviewRecordSchema,
  );
  const matrixResult = await readRecord(matrixResultPath(evidenceRoot), matrixResultRecordSchema);
  const terminal = await readRecord(terminalPath(evidenceRoot), terminalRecordSchema);
  const exactResultIds = generation.scenarioIds.map(
    (scenarioId) =>
      scenarioResults.find((result) => result.scenarioId === scenarioId)?.recordId ?? "missing",
  );
  if (
    matrixResult !== undefined &&
    (scenarioResults.length !== generation.scenarioIds.length ||
      matrixResult.generationId !== generation.generationId ||
      matrixResult.generationRecordId !== generation.recordId ||
      JSON.stringify(matrixResult.scenarioResultRecordIds) !== JSON.stringify(exactResultIds))
  ) {
    fail("Matrix Result does not close the exact registered Scenario Result set.");
  }
  if (matrixResult !== undefined) {
    const payload = await matrixPayloadIdentity(
      evidenceRoot,
      matrixResult.evidence,
      generation.scenarioIds,
    );
    await assertMatrixPayloadClosure(
      evidenceRoot,
      generation,
      scenarioResults,
      payload,
      matrixResult.evidence.pointer,
    );
  }
  if (
    terminal !== undefined &&
    (matrixResult === undefined ||
      terminal.generationId !== generation.generationId ||
      terminal.generationRecordId !== generation.recordId ||
      terminal.matrixResultRecordId !== matrixResult.recordId)
  ) {
    fail("Generation Terminal does not close the exact Matrix Result.");
  }
  if (
    convergenceReview !== undefined &&
    (terminal === undefined ||
      convergenceReview.generationId !== generation.generationId ||
      convergenceReview.generationRecordId !== generation.recordId ||
      convergenceReview.terminalRecordId !== terminal.recordId ||
      JSON.stringify(convergenceReview.scenarioResultRecordIds) !== JSON.stringify(exactResultIds))
  ) {
    fail(
      "Convergence Review does not close the terminal Generation and exact Scenario Result set.",
    );
  }
  if (convergenceReview !== undefined) {
    const payload = await convergencePayloadIdentity(evidenceRoot, convergenceReview.evidence);
    if (
      payload.generationId !== generation.generationId ||
      payload.terminalRecordId !== convergenceReview.terminalRecordId ||
      JSON.stringify(payload.scenarioResultRecordIds) !== JSON.stringify(exactResultIds)
    ) {
      fail("Convergence Review payload identity contradicts its record.");
    }
  }
  await assertPayloadNamespaceClosed(evidenceRoot, [
    ...scenarioResults.map(({ evidence }) => evidence),
    ...(matrixResult === undefined ? [] : [matrixResult.evidence]),
    ...(convergenceReview === undefined ? [] : [convergenceReview.evidence]),
  ]);

  let nextMissingRecord =
    terminal === undefined || convergenceReview !== undefined
      ? "fresh-generation-required"
      : "convergence-review";
  if (terminal === undefined) {
    nextMissingRecord = "generation-terminal";
    if (matrixResult === undefined) nextMissingRecord = "matrix-result";
    for (const scenarioId of [...generation.scenarioIds].reverse()) {
      const scenario = scenarios.find((record) => record.scenarioId === scenarioId);
      const result = scenarioResults.find((record) => record.scenarioId === scenarioId);
      if (result === undefined) nextMissingRecord = `scenario-result:${scenarioId}`;
      if (scenario !== undefined) {
        const scenarioTurns = turns.filter((record) => record.scenarioId === scenarioId);
        const scenarioAttempts = attempts.filter((record) => record.scenarioId === scenarioId);
        for (let turn = scenario.declaredTurnCount; turn >= 1; turn -= 1) {
          if (!scenarioTurns.some((record) => record.turn === turn)) {
            nextMissingRecord = scenarioAttempts.some((record) => record.turn === turn)
              ? `turn:${scenarioId}:${turn}`
              : `attempt:${scenarioId}:${turn}:1`;
          }
        }
      }
      if (scenario === undefined) nextMissingRecord = `scenario:${scenarioId}`;
    }
  }
  return Object.freeze({
    schemaVersion: 1 as const,
    generationId: generation.generationId,
    lifecycle: terminal === undefined ? ("active" as const) : ("completed" as const),
    nextMissingRecord,
    records: Object.freeze({
      generation,
      scenarios: Object.freeze(scenarios),
      attempts: Object.freeze(attempts),
      turns: Object.freeze(turns),
      scenarioResults: Object.freeze(scenarioResults),
      convergenceReview,
      matrixResult,
      terminal,
    }),
  });
};

const requireGeneration = async (root: string, generationId: string): Promise<GenerationRecord> => {
  const generation =
    (await readRecord(generationPath(root), generationRecordSchema)) ??
    fail("Generation record is unavailable.");
  if (generation.generationId !== generationId)
    fail("Generation identity contradicts the writer request.");
  return generation;
};

export const createLiveMatrixGenerationRecord = async (input: {
  evidenceRoot: string;
  generationId: string;
  scenarioIds: readonly string[];
  packageIdentitySha256: string;
  matrixDefinitionSha256: string;
  harnessIdentitySha256: string;
  admissionIdentitySha256: string;
  predecessor?: z.input<typeof predecessorSchema>;
}): Promise<GenerationRecord> => {
  const root = resolve(input.evidenceRoot);
  await mkdir(root, { recursive: true });
  const existingNames = await readDirectory(root);
  if (existingNames.length > 0 && !existingNames.includes("generation.json"))
    fail("Fresh Generation evidence root must be empty.");
  const record = buildRecord(generationRecordSchema, {
    schemaVersion: 1,
    recordType: "generation",
    writer: "coordinator",
    ordinal: 1,
    generationId: input.generationId,
    scenarioIds: [...input.scenarioIds],
    packageIdentitySha256: input.packageIdentitySha256,
    matrixDefinitionSha256: input.matrixDefinitionSha256,
    harnessIdentitySha256: input.harnessIdentitySha256,
    admissionIdentitySha256: input.admissionIdentitySha256,
    ...(input.predecessor === undefined ? {} : { predecessor: input.predecessor }),
  });
  return publishRecord(root, generationPath(root), generationRecordSchema, record);
};

export const createLiveMatrixScenarioRecord = async (input: {
  evidenceRoot: string;
  generationId: string;
  scenarioId: string;
  definitionSha256: string;
  fixtureSha256: string;
  declaredTurnCount: number;
}): Promise<ScenarioRecord> => {
  const root = resolve(input.evidenceRoot);
  const generation = await requireGeneration(root, input.generationId);
  const index = generation.scenarioIds.indexOf(input.scenarioId);
  if (index < 0) fail(`Scenario is not registered in this Generation: ${input.scenarioId}.`);
  const record = buildRecord(scenarioRecordSchema, {
    schemaVersion: 1,
    recordType: "scenario",
    writer: `scenario-runner:${input.scenarioId}`,
    ordinal: index + 1,
    generationId: generation.generationId,
    generationRecordId: generation.recordId,
    scenarioId: input.scenarioId,
    definitionSha256: input.definitionSha256,
    fixtureSha256: input.fixtureSha256,
    declaredTurnCount: input.declaredTurnCount,
  });
  return publishRecord(root, scenarioPath(root, input.scenarioId), scenarioRecordSchema, record);
};

export const createLiveMatrixAttemptRecord = async (input: {
  evidenceRoot: string;
  generationId: string;
  scenarioId: string;
  turn: number;
  attempt: number;
  promptSha256: string;
  runtimeIdentitySha256: string;
}): Promise<AttemptRecord> => {
  const root = resolve(input.evidenceRoot);
  const generation = await requireGeneration(root, input.generationId);
  const scenario =
    (await readRecord(scenarioPath(root, input.scenarioId), scenarioRecordSchema)) ??
    fail("Attempt requires its Scenario parent.");
  const attempts = (await readAttemptRecords(root, input.scenarioId)).filter(
    ({ turn }) => turn === input.turn,
  );
  const priorTurns = await readTurnRecords(root, input.scenarioId);
  if (
    scenario.generationRecordId !== generation.recordId ||
    input.turn > scenario.declaredTurnCount ||
    input.turn !== priorTurns.length + 1 ||
    input.attempt !== attempts.length + 1
  ) {
    fail("Attempt ordinal or Scenario parent is inconsistent.");
  }
  const record = buildRecord(attemptRecordSchema, {
    schemaVersion: 1,
    recordType: "attempt",
    writer: `scenario-runner:${input.scenarioId}`,
    ordinal: input.attempt,
    generationId: generation.generationId,
    generationRecordId: generation.recordId,
    scenarioId: input.scenarioId,
    scenarioRecordId: scenario.recordId,
    turn: input.turn,
    attempt: input.attempt,
    ...(attempts.at(-1) === undefined
      ? {}
      : { previousAttemptRecordId: attempts.at(-1)?.recordId }),
    promptSha256: input.promptSha256,
    runtimeIdentitySha256: input.runtimeIdentitySha256,
  });
  return publishRecord(
    root,
    attemptPath(root, input.scenarioId, input.turn, input.attempt),
    attemptRecordSchema,
    record,
  );
};

export const createLiveMatrixTurnRecord = async (input: {
  evidenceRoot: string;
  generationId: string;
  scenarioId: string;
  turn: number;
  attemptRecordIds: readonly string[];
  terminalAttemptRecordId: string;
  observationSha256: string;
  terminalBoundary: string;
}): Promise<TurnRecord> => {
  const root = resolve(input.evidenceRoot);
  const generation = await requireGeneration(root, input.generationId);
  const scenario =
    (await readRecord(scenarioPath(root, input.scenarioId), scenarioRecordSchema)) ??
    fail("Turn requires its Scenario parent.");
  const priorTurns = await readTurnRecords(root, input.scenarioId);
  const attempts = (await readAttemptRecords(root, input.scenarioId)).filter(
    ({ turn }) => turn === input.turn,
  );
  const exactAttemptIds = attempts.map(({ recordId }) => recordId);
  if (
    input.turn !== priorTurns.length + 1 ||
    input.turn > scenario.declaredTurnCount ||
    attempts.length === 0 ||
    JSON.stringify(input.attemptRecordIds) !== JSON.stringify(exactAttemptIds) ||
    input.terminalAttemptRecordId !== exactAttemptIds.at(-1)
  ) {
    fail("Turn does not close the exact Attempt record chain.");
  }
  const record = buildRecord(turnRecordSchema, {
    schemaVersion: 1,
    recordType: "turn",
    writer: `scenario-runner:${input.scenarioId}`,
    ordinal: input.turn,
    generationId: generation.generationId,
    generationRecordId: generation.recordId,
    scenarioId: input.scenarioId,
    scenarioRecordId: scenario.recordId,
    turn: input.turn,
    attemptRecordIds: [...input.attemptRecordIds],
    terminalAttemptRecordId: input.terminalAttemptRecordId,
    observationSha256: input.observationSha256,
    terminalBoundary: input.terminalBoundary,
  });
  return publishRecord(
    root,
    turnPath(root, input.scenarioId, input.turn),
    turnRecordSchema,
    record,
  );
};

export const createLiveMatrixScenarioResultRecord = async (input: {
  evidenceRoot: string;
  generationId: string;
  scenarioId: string;
  outcome: "pass" | "fail" | "blocked" | "not-run";
  evidence: z.input<typeof durableReferenceSchema>;
  turnRecordIds: readonly string[];
}): Promise<ScenarioResultRecord> => {
  const root = resolve(input.evidenceRoot);
  const generation = await requireGeneration(root, input.generationId);
  const index = generation.scenarioIds.indexOf(input.scenarioId);
  const scenario =
    (await readRecord(scenarioPath(root, input.scenarioId), scenarioRecordSchema)) ??
    fail("Scenario Result requires its Scenario parent.");
  const turns = await readTurnRecords(root, input.scenarioId);
  if (
    index < 0 ||
    turns.length !== scenario.declaredTurnCount ||
    JSON.stringify(input.turnRecordIds) !== JSON.stringify(turns.map(({ recordId }) => recordId))
  ) {
    fail("Scenario Result does not close the exact complete Turn set.");
  }
  const evidence = durableReferenceSchema.parse(input.evidence);
  const payload = await scenarioPayloadIdentity(root, evidence);
  assertScenarioPayloadClosure(payload, generation, scenario, input.outcome);
  const record = buildRecord(scenarioResultRecordSchema, {
    schemaVersion: 1,
    recordType: "scenario-result",
    writer: "coordinator",
    ordinal: index + 1,
    generationId: generation.generationId,
    generationRecordId: generation.recordId,
    scenarioId: input.scenarioId,
    scenarioRecordId: scenario.recordId,
    outcome: input.outcome,
    evidence,
    turnRecordIds: [...input.turnRecordIds],
  });
  return publishRecord(
    root,
    scenarioResultPath(root, input.scenarioId),
    scenarioResultRecordSchema,
    record,
  );
};

const exactScenarioResults = async (
  root: string,
  generation: GenerationRecord,
): Promise<ScenarioResultRecord[]> =>
  Promise.all(
    generation.scenarioIds.map(
      async (scenarioId) =>
        (await readRecord(scenarioResultPath(root, scenarioId), scenarioResultRecordSchema)) ??
        fail(`Coordinator requires Scenario Result: ${scenarioId}.`),
    ),
  );

export const createLiveMatrixConvergenceReviewRecord = async (input: {
  evidenceRoot: string;
  generationId: string;
  scenarioResultRecordIds: readonly string[];
  terminalRecordId: string;
  evidence: z.input<typeof durableReferenceSchema>;
}): Promise<ConvergenceReviewRecord> => {
  const root = resolve(input.evidenceRoot);
  const generation = await requireGeneration(root, input.generationId);
  const results = await exactScenarioResults(root, generation);
  const terminal =
    (await readRecord(terminalPath(root), terminalRecordSchema)) ??
    fail("Convergence Review requires the terminal Generation parent.");
  if (
    JSON.stringify(input.scenarioResultRecordIds) !==
    JSON.stringify(results.map(({ recordId }) => recordId))
  ) {
    fail("Convergence Review requires the exact registered Scenario Result set.");
  }
  if (input.terminalRecordId !== terminal.recordId) {
    fail("Convergence Review contradicts the terminal Generation parent.");
  }
  const evidence = durableReferenceSchema.parse(input.evidence);
  const payload = await convergencePayloadIdentity(root, evidence);
  if (
    payload.generationId !== generation.generationId ||
    payload.terminalRecordId !== terminal.recordId ||
    JSON.stringify(payload.scenarioResultRecordIds) !==
      JSON.stringify(results.map(({ recordId }) => recordId))
  ) {
    fail("Convergence Review payload identity contradicts its record.");
  }
  const record = buildRecord(convergenceReviewRecordSchema, {
    schemaVersion: 1,
    recordType: "convergence-review",
    writer: "coordinator",
    ordinal: 1,
    generationId: generation.generationId,
    generationRecordId: generation.recordId,
    terminalRecordId: terminal.recordId,
    scenarioResultRecordIds: [...input.scenarioResultRecordIds],
    evidence,
  });
  return publishRecord(root, convergencePath(root), convergenceReviewRecordSchema, record);
};

export const createLiveMatrixMatrixResultRecord = async (input: {
  evidenceRoot: string;
  generationId: string;
  scenarioResultRecordIds: readonly string[];
  evidence: z.input<typeof durableReferenceSchema>;
}): Promise<MatrixResultRecord> => {
  const root = resolve(input.evidenceRoot);
  const generation = await requireGeneration(root, input.generationId);
  const results = await exactScenarioResults(root, generation);
  if (
    JSON.stringify(input.scenarioResultRecordIds) !==
    JSON.stringify(results.map(({ recordId }) => recordId))
  ) {
    fail("Matrix Result requires the exact registered Scenario Result set.");
  }
  const evidence = durableReferenceSchema.parse(input.evidence);
  const payload = await matrixPayloadIdentity(root, evidence, generation.scenarioIds);
  await assertMatrixPayloadClosure(root, generation, results, payload, evidence.pointer);
  const record = buildRecord(matrixResultRecordSchema, {
    schemaVersion: 1,
    recordType: "matrix-result",
    writer: "coordinator",
    ordinal: 1,
    generationId: generation.generationId,
    generationRecordId: generation.recordId,
    scenarioResultRecordIds: [...input.scenarioResultRecordIds],
    evidence,
  });
  return publishRecord(root, matrixResultPath(root), matrixResultRecordSchema, record);
};

export const createLiveMatrixTerminalRecord = async (input: {
  evidenceRoot: string;
  generationId: string;
  matrixResultRecordId: string;
  disposition: "completed";
}): Promise<TerminalRecord> => {
  const root = resolve(input.evidenceRoot);
  const generation = await requireGeneration(root, input.generationId);
  const matrix =
    (await readRecord(matrixResultPath(root), matrixResultRecordSchema)) ??
    fail("Generation Terminal requires its Matrix Result parent.");
  if (matrix.recordId !== input.matrixResultRecordId) {
    fail("Generation Terminal contradicts its Matrix Result parent.");
  }
  const record = buildRecord(terminalRecordSchema, {
    schemaVersion: 1,
    recordType: "generation-terminal",
    writer: "coordinator",
    ordinal: 1,
    generationId: generation.generationId,
    generationRecordId: generation.recordId,
    matrixResultRecordId: input.matrixResultRecordId,
    disposition: input.disposition,
  });
  return publishRecord(root, terminalPath(root), terminalRecordSchema, record);
};

const forbiddenDurableKeys = new Set([
  "token",
  "tokens",
  "credential",
  "credentials",
  "secret",
  "secrets",
  "transcript",
  "transcripts",
  "session",
  "sessionid",
  "sessionidentity",
  "operatorconfig",
  "operatorconfiguration",
  "runtimepath",
  "runtimeroot",
  "privatekey",
  "apikey",
  "accesskey",
  "sshkey",
  "signingkey",
]);
const forbiddenDurableKeyParts = new Set([
  "token",
  "tokens",
  "credential",
  "credentials",
  "secret",
  "secrets",
  "transcript",
  "transcripts",
  "session",
  "password",
  "authorization",
  "cookie",
]);
const durableKeyParts = (key: string): readonly string[] =>
  key
    .replace(/([a-z0-9])([A-Z])/gu, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/gu)
    .filter((part) => part.length > 0);
const normalizeDurableKey = (key: string): string => durableKeyParts(key).join("");
const machinePrivatePath =
  /(?:^|[\s=,:;<>("'`[{])(?:~\/|\/(?:Users|home|private|var|tmp|Volumes|Library|Applications|System|usr|opt|etc|root|workspace|workspaces|mnt|srv)\/[^\s"'`\]})>]+|[A-Za-z]:[\\/][^\s"'`\]})>]+)/u;
const machinePrivateFileUrl = /(?:^|[^A-Za-z0-9+.-])file:\//iu;

const assertSecretFreeDurableValue = (value: unknown, path = "evidence"): void => {
  if (typeof value === "string") {
    if (machinePrivatePath.test(value) || machinePrivateFileUrl.test(value))
      fail(`Durable evidence contains a machine-private path: ${path}.`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      assertSecretFreeDurableValue(item, `${path}[${index}]`);
    });
    return;
  }
  if (value === null || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (
      forbiddenDurableKeys.has(normalizeDurableKey(key)) ||
      durableKeyParts(key).some((part) => forbiddenDurableKeyParts.has(part))
    )
      fail(`Durable evidence contains a private field: ${path}.${key}.`);
    assertSecretFreeDurableValue(child, `${path}.${key}`);
  }
};

const publicationCompletionSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("scenario-result"),
      generationId: generationIdSchema,
      scenarioId: scenarioIdSchema,
      outcome: outcomeSchema,
      turnRecordIds: z.array(recordIdSchema).min(1),
    })
    .strict(),
  z
    .object({
      kind: z.literal("matrix-result-terminal"),
      generationId: generationIdSchema,
      scenarioResultRecordIds: z.array(recordIdSchema).min(1),
    })
    .strict(),
]);
const publicationIntentSchema = z
  .object({
    schemaVersion: z.literal(1),
    publicationId: publicationIdSchema,
    evidenceRootIdentitySha256: digestSchema,
    pointer: pointerSchema,
    stagedSha256: digestSchema,
    cleanupScopes: z
      .array(
        z.object({ root: z.string().min(1), pointers: z.array(pointerSchema).max(16) }).strict(),
      )
      .max(4),
    completion: publicationCompletionSchema.optional(),
  })
  .strict()
  .superRefine((intent, context) => {
    if (intent.completion !== undefined && !intent.pointer.startsWith("payloads/")) {
      context.addIssue({
        code: "custom",
        path: ["pointer"],
        message: "Formal completion evidence must stay inside payloads/.",
      });
    }
  });
const publicationEnvelopeSchema = publicationIntentSchema
  .extend({ stagedBytesBase64: z.string().min(1) })
  .strict();
const phaseReceiptSchema = z
  .object({
    schemaVersion: z.literal(1),
    phase: z.enum(["scan", "cleanup", "publication"]),
    publicationId: publicationIdSchema,
    evidenceRootIdentitySha256: digestSchema,
    pointer: pointerSchema,
    stagedSha256: digestSchema,
  })
  .strict();

const publicationControlRoot = (controlRoot: string, publicationId: string): string =>
  join(resolve(controlRoot), "publications", publicationIdSchema.parse(publicationId));

const resolveCleanupScope = async (input: {
  controlRoot: string;
  root: string;
  pointers: readonly string[];
}): Promise<{ readonly root: string; readonly pointers: readonly string[] }> => {
  if (!isAbsolute(input.root)) fail("Private cleanup root must be absolute.");
  const cleanupRoot = await realpath(resolve(input.root));
  const protectedPaths = new Set([
    resolve("/"),
    resolve(homedir()),
    resolve(process.cwd()),
    resolve(input.controlRoot),
  ]);
  if (protectedPaths.has(cleanupRoot)) fail(`Unsafe private cleanup root: ${cleanupRoot}.`);
  const cleanupPointers = await Promise.all(
    input.pointers.map(async (rawPointer) => {
      const pointer = pointerSchema.parse(rawPointer);
      const lexical = resolve(cleanupRoot, pointer);
      for (const protectedPath of protectedPaths) {
        const protectedRelation = relative(lexical, protectedPath);
        if (
          protectedRelation === "" ||
          (!protectedRelation.startsWith("..") && !isAbsolute(protectedRelation))
        ) {
          fail(`Private cleanup target contains a protected root: ${pointer}.`);
        }
      }
      let exact: string;
      try {
        exact = await realpath(lexical);
      } catch (error) {
        if (isMissing(error)) return pointer;
        throw error;
      }
      const relation = relative(cleanupRoot, exact);
      if (
        relation === "" ||
        relation.startsWith("..") ||
        relation.startsWith(`..${sep}`) ||
        isAbsolute(relation)
      ) {
        fail(`Private cleanup pointer escapes its root: ${pointer}.`);
      }
      for (const protectedPath of protectedPaths) {
        const protectedRelation = relative(exact, protectedPath);
        if (
          protectedRelation === "" ||
          (!protectedRelation.startsWith("..") && !isAbsolute(protectedRelation))
        ) {
          fail(`Private cleanup target contains a protected root: ${pointer}.`);
        }
      }
      const controlRelation = relative(exact, resolve(input.controlRoot));
      if (
        controlRelation === "" ||
        (!controlRelation.startsWith("..") && !isAbsolute(controlRelation))
      ) {
        fail("Private cleanup target cannot contain publication control.");
      }
      return pointer;
    }),
  );
  return Object.freeze({ root: cleanupRoot, pointers: Object.freeze(cleanupPointers) });
};

export const stageLiveMatrixDurableEvidence = async (input: {
  controlRoot: string;
  evidenceRoot: string;
  publicationId: string;
  pointer: string;
  value: unknown;
  cleanupScopes: readonly Readonly<{ root: string; pointers: readonly string[] }>[];
  completion?: z.input<typeof publicationCompletionSchema>;
}) => {
  assertSecretFreeDurableValue(input.value);
  const publicationId = publicationIdSchema.parse(input.publicationId);
  const pointer =
    input.completion === undefined
      ? pointerSchema.parse(input.pointer)
      : durablePointerSchema.parse(input.pointer);
  const root = publicationControlRoot(input.controlRoot, publicationId);
  const stagedPath = join(root, "envelope.json");
  const evidenceRootIdentitySha256 = sha256(await realpath(resolve(input.evidenceRoot)));
  const bytes = `${JSON.stringify(input.value, null, 2)}\n`;
  const cleanupScopes = await Promise.all(
    input.cleanupScopes.map((scope) =>
      resolveCleanupScope({ controlRoot: input.controlRoot, ...scope }),
    ),
  );
  const intent = publicationIntentSchema.parse({
    schemaVersion: 1,
    publicationId,
    evidenceRootIdentitySha256,
    pointer,
    stagedSha256: sha256(bytes),
    cleanupScopes,
    ...(input.completion === undefined ? {} : { completion: input.completion }),
  });
  const envelope = publicationEnvelopeSchema.parse({
    ...intent,
    stagedBytesBase64: Buffer.from(bytes).toString("base64"),
  });
  await mkdir(root, { recursive: true });
  await createOnceBytes(stagedPath, `${JSON.stringify(envelope, null, 2)}\n`);
  return Object.freeze({ publicationId, pointer, stagedPath, stagedSha256: intent.stagedSha256 });
};

const readPhaseReceipt = async (path: string) => {
  try {
    return phaseReceiptSchema.parse(JSON.parse(await readFile(path, "utf8")));
  } catch (error) {
    if (isMissing(error)) return undefined;
    throw error;
  }
};

const verifyPhaseReceipt = (
  receipt: z.infer<typeof phaseReceiptSchema>,
  intent: z.infer<typeof publicationIntentSchema>,
  phase: "scan" | "cleanup" | "publication",
): void => {
  if (
    receipt.phase !== phase ||
    receipt.publicationId !== intent.publicationId ||
    receipt.evidenceRootIdentitySha256 !== intent.evidenceRootIdentitySha256 ||
    receipt.pointer !== intent.pointer ||
    receipt.stagedSha256 !== intent.stagedSha256
  ) {
    fail(`Private ${phase} receipt contradicts its staged evidence.`);
  }
};

const writePhaseReceipt = async (
  path: string,
  intent: z.infer<typeof publicationIntentSchema>,
  phase: "scan" | "cleanup" | "publication",
): Promise<void> => {
  const receipt = phaseReceiptSchema.parse({
    schemaVersion: 1,
    phase,
    publicationId: intent.publicationId,
    evidenceRootIdentitySha256: intent.evidenceRootIdentitySha256,
    pointer: intent.pointer,
    stagedSha256: intent.stagedSha256,
  });
  await createOnceBytes(path, `${JSON.stringify(receipt, null, 2)}\n`);
};

export const recoverLiveMatrixEvidencePublication = async (input: {
  controlRoot: string;
  evidenceRoot: string;
  publicationId: string;
  configPath: string;
  program?: string;
  crashAfter?: "scan" | "cleanup" | "publish" | "scenario-result" | "matrix-result" | "terminal";
}) => {
  const root = publicationControlRoot(input.controlRoot, input.publicationId);
  const envelope = publicationEnvelopeSchema.parse(
    JSON.parse(await readFile(join(root, "envelope.json"), "utf8")),
  );
  const { stagedBytesBase64, ...intentInput } = envelope;
  const intent = publicationIntentSchema.parse(intentInput);
  const evidenceRoot = await realpath(resolve(input.evidenceRoot));
  if (sha256(evidenceRoot) !== intent.evidenceRootIdentitySha256) {
    fail("Publication recovery Evidence Bundle identity mismatch.");
  }
  const scanReceiptPath = join(root, "scan.json");
  const cleanupReceiptPath = join(root, "cleanup.json");
  const publicationReceiptPath = join(root, "publication.json");
  const target = resolve(evidenceRoot, intent.pointer);
  const targetRelation = relative(evidenceRoot, target);
  if (
    targetRelation === "" ||
    targetRelation.startsWith("..") ||
    targetRelation.startsWith(`..${sep}`) ||
    isAbsolute(targetRelation)
  ) {
    fail("Durable evidence target escapes its publication root.");
  }

  const publicationReceipt = await readPhaseReceipt(publicationReceiptPath);
  const stagedBytes = Buffer.from(stagedBytesBase64, "base64");
  if (stagedBytes.toString("base64") !== stagedBytesBase64)
    fail("Live Matrix staging envelope bytes are not canonical base64.");
  if (sha256(stagedBytes) !== intent.stagedSha256)
    fail("Live Matrix staged evidence digest mismatch.");
  assertSecretFreeDurableValue(JSON.parse(stagedBytes.toString("utf8")));

  let scanReceipt = await readPhaseReceipt(scanReceiptPath);
  if (scanReceipt === undefined) {
    const scanned = scanLiveScenarioDurableEvidence({
      value: JSON.parse(stagedBytes.toString("utf8")),
      configPath: resolve(input.configPath),
      ...(input.program === undefined ? {} : { program: input.program }),
    });
    if (!Buffer.from(scanned, "utf8").equals(stagedBytes)) {
      fail("Gitleaks scan did not preserve the exact staged durable bytes.");
    }
    await writePhaseReceipt(scanReceiptPath, intent, "scan");
    scanReceipt = await readPhaseReceipt(scanReceiptPath);
  }
  verifyPhaseReceipt(scanReceipt ?? fail("Secret scan receipt is unavailable."), intent, "scan");
  if (input.crashAfter === "scan") fail("Injected crash after scan.");

  let cleanupReceipt = await readPhaseReceipt(cleanupReceiptPath);
  if (cleanupReceipt === undefined) {
    for (const storedScope of intent.cleanupScopes) {
      const cleanup = await resolveCleanupScope({
        controlRoot: input.controlRoot,
        root: storedScope.root,
        pointers: storedScope.pointers,
      });
      for (const pointer of cleanup.pointers) {
        const targetPath = resolve(cleanup.root, pointer);
        await rm(targetPath, { recursive: true, force: true });
        if (await pathExists(targetPath)) fail(`Private evidence cleanup failed: ${pointer}.`);
      }
    }
    await writePhaseReceipt(cleanupReceiptPath, intent, "cleanup");
    cleanupReceipt = await readPhaseReceipt(cleanupReceiptPath);
  }
  verifyPhaseReceipt(
    cleanupReceipt ?? fail("Private cleanup receipt is unavailable."),
    intent,
    "cleanup",
  );
  if (input.crashAfter === "cleanup") fail("Injected crash after cleanup.");

  const candidate = join(
    dirname(target),
    `.publication-${intent.publicationId}-${intent.stagedSha256}-${randomUUID()}.candidate`,
  );
  if (publicationReceipt === undefined) {
    await mkdir(dirname(target), { recursive: true });
    await writeFileAtomic(candidate, stagedBytes, { mode: 0o600, fsync: true });
    try {
      await link(candidate, target);
    } catch (error) {
      if (
        !(error instanceof Error && "code" in error) ||
        !["EEXIST", "ENOENT"].includes(String(error.code))
      ) {
        throw error;
      }
      const targetState = await lstat(target);
      if (
        !targetState.isFile() ||
        targetState.isSymbolicLink() ||
        !(await readFile(target)).equals(stagedBytes)
      ) {
        fail("Durable evidence target has an unexpected writer overlap.");
      }
    }
    if (!(await readFile(target)).equals(stagedBytes))
      fail("Durable evidence exact publication readback mismatch.");
    if (input.crashAfter === "publish") fail("Injected crash after publish.");
    await writePhaseReceipt(publicationReceiptPath, intent, "publication");
  }
  const finalReceipt =
    (await readPhaseReceipt(publicationReceiptPath)) ?? fail("Publication receipt is unavailable.");
  verifyPhaseReceipt(finalReceipt, intent, "publication");
  if (!(await readFile(target)).equals(stagedBytes))
    fail("Published durable evidence digest mismatch.");
  let scenarioResultRecordId: string | undefined;
  let matrixResultRecordId: string | undefined;
  let terminalRecordId: string | undefined;
  if (intent.completion?.kind === "scenario-result") {
    const result = await createLiveMatrixScenarioResultRecord({
      evidenceRoot,
      generationId: intent.completion.generationId,
      scenarioId: intent.completion.scenarioId,
      outcome: intent.completion.outcome,
      evidence: { pointer: intent.pointer, sha256: intent.stagedSha256 },
      turnRecordIds: intent.completion.turnRecordIds,
    });
    scenarioResultRecordId = result.recordId;
    if (input.crashAfter === "scenario-result") fail("Injected crash after Scenario Result.");
  } else if (intent.completion?.kind === "matrix-result-terminal") {
    const matrix = await createLiveMatrixMatrixResultRecord({
      evidenceRoot,
      generationId: intent.completion.generationId,
      scenarioResultRecordIds: intent.completion.scenarioResultRecordIds,
      evidence: { pointer: intent.pointer, sha256: intent.stagedSha256 },
    });
    matrixResultRecordId = matrix.recordId;
    if (input.crashAfter === "matrix-result") fail("Injected crash after Matrix Result.");
    const terminal = await createLiveMatrixTerminalRecord({
      evidenceRoot,
      generationId: intent.completion.generationId,
      matrixResultRecordId: matrix.recordId,
      disposition: "completed",
    });
    terminalRecordId = terminal.recordId;
    if (input.crashAfter === "terminal") fail("Injected crash after Generation Terminal.");
  }
  await Promise.all(
    (await readdir(dirname(target)))
      .filter((name) =>
        name.startsWith(`.publication-${intent.publicationId}-${intent.stagedSha256}-`),
      )
      .map((name) => rm(join(dirname(target), name), { force: true })),
  );
  return Object.freeze({
    state: "published" as const,
    pointer: intent.pointer,
    sha256: intent.stagedSha256,
    target,
    ...(scenarioResultRecordId === undefined ? {} : { scenarioResultRecordId }),
    ...(matrixResultRecordId === undefined ? {} : { matrixResultRecordId }),
    ...(terminalRecordId === undefined ? {} : { terminalRecordId }),
  });
};
