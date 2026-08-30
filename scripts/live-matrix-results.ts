import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { dirname, isAbsolute, posix, relative, resolve, sep } from "node:path";
import { z } from "zod";
import {
  type LiveMatrixGenerationBasis,
  parseLiveMatrixGenerationBasis,
} from "./live-matrix-generation";
import { liveScenarioIdSchema } from "./live-scenario-registry";

export const LIVE_MATRIX_COORDINATOR_AUTHORITY = "coordinator" as const;
export const LIVE_MATRIX_SLOW_OBSERVATION_MS = 10 * 60 * 1_000;

const fail = (message: string): never => {
  throw new Error(message);
};

const digestSchema = z.string().regex(/^[0-9a-f]{64}$/u);
const generationIdSchema = z.string().uuid();
const timestampSchema = z.string().datetime({ offset: true });
const outcomeSchema = z.enum(["pass", "fail", "blocked"]);

const uniqueScenarioIdsSchema = z
  .array(liveScenarioIdSchema)
  .min(1)
  .superRefine((scenarioIds, context) => {
    if (new Set(scenarioIds).size !== scenarioIds.length) {
      context.addIssue({
        code: "custom",
        message: "Live Matrix Scenario identities must be unique.",
      });
    }
  });

const durablePointerSchema = z
  .string()
  .trim()
  .min(1)
  .max(240)
  .superRefine((pointer, context) => {
    const segments = pointer.split("/");
    const unsafe =
      pointer.includes("\\") ||
      pointer.startsWith("/") ||
      /^[A-Za-z]:/u.test(pointer) ||
      posix.normalize(pointer) !== pointer ||
      segments.some((segment) => segment === "" || segment === "." || segment === "..");
    if (unsafe) {
      context.addIssue({
        code: "custom",
        message: "Live Matrix evidence pointers must be normalized relative paths.",
      });
    }
    if (
      segments.some((segment) =>
        /^(?:credentials?|raw-transcripts?|sessions?)(?:[._-]|$)/iu.test(segment),
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "Live Matrix results cannot point to credential, raw transcript, or session data.",
      });
    }
  });

export const liveMatrixEvidencePointerSchema = z
  .object({
    evidenceClass: z.literal("observation"),
    pointer: durablePointerSchema,
    sha256: digestSchema,
  })
  .strict();

const boundedEvidencePointersSchema = z
  .array(liveMatrixEvidencePointerSchema)
  .max(8)
  .superRefine((pointers, context) => {
    if (new Set(pointers.map(({ pointer }) => pointer)).size !== pointers.length) {
      context.addIssue({
        code: "custom",
        message: "Live Matrix evidence pointers must be unique.",
      });
    }
  });

export const liveMatrixTurnTimingSchema = z
  .object({
    turnNumber: z.number().int().positive().safe(),
    startedAt: timestampSchema,
    endedAt: timestampSchema,
    durationMs: z.number().int().nonnegative().safe(),
  })
  .strict()
  .superRefine((turn, context) => {
    if (turn.durationMs !== Date.parse(turn.endedAt) - Date.parse(turn.startedAt)) {
      context.addIssue({
        code: "custom",
        path: ["durationMs"],
        message: "Live Matrix Turn duration must equal endedAt minus startedAt.",
      });
    }
  });

export type LiveMatrixTurnTiming = z.infer<typeof liveMatrixTurnTimingSchema>;

const durableResultReferenceSchema = z
  .object({ pointer: durablePointerSchema, sha256: digestSchema })
  .strict();

export const liveMatrixScenarioTerminalResultSchema = z
  .object({
    schemaVersion: z.literal(1),
    generationId: generationIdSchema,
    scenarioId: liveScenarioIdSchema,
    semanticEvaluationAuthority: z.literal(LIVE_MATRIX_COORDINATOR_AUTHORITY),
    outcome: outcomeSchema,
    rationale: z.string().trim().min(1).max(800),
    evidence: boundedEvidencePointersSchema,
    turns: z
      .array(liveMatrixTurnTimingSchema)
      .min(1, "Every terminal Live Matrix Scenario requires at least one Turn."),
    startedAt: timestampSchema,
    endedAt: timestampSchema,
    durationMs: z.number().int().nonnegative().safe(),
  })
  .strict()
  .superRefine((result, context) => {
    result.turns.forEach((turn, index) => {
      if (turn.turnNumber !== index + 1) {
        context.addIssue({
          code: "custom",
          path: ["turns", index, "turnNumber"],
          message: "Live Matrix Turn numbers must be contiguous and start at one.",
        });
      }
      if (
        Date.parse(turn.startedAt) < Date.parse(result.startedAt) ||
        Date.parse(turn.endedAt) > Date.parse(result.endedAt)
      ) {
        context.addIssue({
          code: "custom",
          path: ["turns", index],
          message: "Live Matrix Turn timestamps must stay within the Scenario window.",
        });
      }
    });
    const durationMs = Date.parse(result.endedAt) - Date.parse(result.startedAt);
    if (durationMs < 0 || result.durationMs !== durationMs) {
      context.addIssue({
        code: "custom",
        path: ["durationMs"],
        message: "Live Matrix Scenario duration must equal endedAt minus startedAt.",
      });
    }
  });

export type LiveMatrixScenarioTerminalResult = z.infer<
  typeof liveMatrixScenarioTerminalResultSchema
>;

export const parseLiveMatrixScenarioTerminalResult = (
  input: unknown,
): LiveMatrixScenarioTerminalResult =>
  Object.freeze(liveMatrixScenarioTerminalResultSchema.parse(input));

export const createLiveMatrixScenarioTerminalResult = (input: {
  generationId: string;
  scenarioId: string;
  outcome: "pass" | "fail" | "blocked";
  rationale: string;
  evidence: readonly z.input<typeof liveMatrixEvidencePointerSchema>[];
  turns: readonly {
    turnNumber: number;
    startedAt: string;
    endedAt: string;
  }[];
  startedAt: string;
  endedAt: string;
}): LiveMatrixScenarioTerminalResult =>
  parseLiveMatrixScenarioTerminalResult({
    schemaVersion: 1,
    generationId: input.generationId,
    scenarioId: input.scenarioId,
    semanticEvaluationAuthority: LIVE_MATRIX_COORDINATOR_AUTHORITY,
    outcome: input.outcome,
    rationale: input.rationale,
    evidence: input.evidence,
    turns: input.turns.map((turn) => ({
      ...turn,
      durationMs: Date.parse(turn.endedAt) - Date.parse(turn.startedAt),
    })),
    startedAt: input.startedAt,
    endedAt: input.endedAt,
    durationMs: Date.parse(input.endedAt) - Date.parse(input.startedAt),
  });

const matrixScenarioSummarySchema = z
  .object({
    scenarioId: liveScenarioIdSchema,
    outcome: outcomeSchema,
    rationale: z.string().trim().min(1).max(800),
    startedAt: timestampSchema,
    endedAt: timestampSchema,
    durationMs: z.number().int().nonnegative().safe(),
    slowObservation: z.boolean(),
    turns: z.array(liveMatrixTurnTimingSchema.extend({ slowObservation: z.boolean() }).strict()),
    result: durableResultReferenceSchema,
  })
  .strict();

const slowObservationSchema = z.discriminatedUnion("scope", [
  z
    .object({
      scope: z.literal("scenario"),
      scenarioId: liveScenarioIdSchema,
      durationMs: z.number().int().nonnegative().safe(),
      thresholdMs: z.literal(LIVE_MATRIX_SLOW_OBSERVATION_MS),
    })
    .strict(),
  z
    .object({
      scope: z.literal("turn"),
      scenarioId: liveScenarioIdSchema,
      turnNumber: z.number().int().positive().safe(),
      durationMs: z.number().int().nonnegative().safe(),
      thresholdMs: z.literal(LIVE_MATRIX_SLOW_OBSERVATION_MS),
    })
    .strict(),
]);

const matrixReportSchema = z
  .object({
    peakConcurrency: z.number().int().min(1).max(4).safe(),
    scenarioCount: z.number().int().positive().safe(),
    passCount: z.number().int().nonnegative().safe(),
    nonPassCount: z.number().int().nonnegative().safe(),
    failures: z.array(liveScenarioIdSchema),
    blocked: z.array(liveScenarioIdSchema),
    slowObservations: z.array(slowObservationSchema),
  })
  .strict();

export const liveMatrixResultSchema = z
  .object({
    schemaVersion: z.literal(1),
    generationId: generationIdSchema,
    evidenceClass: z.enum(["local-rehearsal", "release-candidate"]),
    semanticEvaluationAuthority: z.literal(LIVE_MATRIX_COORDINATOR_AUTHORITY),
    generationBasis: durableResultReferenceSchema,
    startedAt: timestampSchema,
    endedAt: timestampSchema,
    durationMs: z.number().int().nonnegative().safe(),
    peakConcurrency: z.number().int().min(1).max(4).safe(),
    terminalOutcome: z.enum(["pass", "not-pass"]),
    releasePrerequisiteSatisfied: z.boolean(),
    scenarios: z.array(matrixScenarioSummarySchema).min(1),
    report: matrixReportSchema,
  })
  .strict();

export type LiveMatrixResult = z.infer<typeof liveMatrixResultSchema>;

const expectedReport = (
  scenarios: readonly z.infer<typeof matrixScenarioSummarySchema>[],
  peakConcurrency: number,
) => {
  const failures = scenarios
    .filter(({ outcome }) => outcome === "fail")
    .map(({ scenarioId }) => scenarioId);
  const blocked = scenarios
    .filter(({ outcome }) => outcome === "blocked")
    .map(({ scenarioId }) => scenarioId);
  return {
    peakConcurrency,
    scenarioCount: scenarios.length,
    passCount: scenarios.filter(({ outcome }) => outcome === "pass").length,
    nonPassCount: scenarios.filter(({ outcome }) => outcome !== "pass").length,
    failures,
    blocked,
    slowObservations: scenarios.flatMap((scenario) => [
      ...(scenario.slowObservation
        ? [
            {
              scope: "scenario" as const,
              scenarioId: scenario.scenarioId,
              durationMs: scenario.durationMs,
              thresholdMs: LIVE_MATRIX_SLOW_OBSERVATION_MS,
            },
          ]
        : []),
      ...scenario.turns
        .filter(({ slowObservation }) => slowObservation)
        .map(({ turnNumber, durationMs }) => ({
          scope: "turn" as const,
          scenarioId: scenario.scenarioId,
          turnNumber,
          durationMs,
          thresholdMs: LIVE_MATRIX_SLOW_OBSERVATION_MS,
        })),
    ]),
  };
};

const assertExactScenarioSet = (
  observedScenarioIds: readonly string[],
  requiredScenarioIds: readonly string[],
): void => {
  const required = uniqueScenarioIdsSchema.parse([...requiredScenarioIds]);
  if (
    observedScenarioIds.length !== required.length ||
    new Set(observedScenarioIds).size !== observedScenarioIds.length ||
    required.some((scenarioId) => !observedScenarioIds.includes(scenarioId))
  ) {
    fail("Live Matrix result requires each registered Scenario exactly once.");
  }
};

export const parseLiveMatrixResultForScenarioIds = (
  input: unknown,
  requiredScenarioIds: readonly string[],
): LiveMatrixResult => {
  const result = liveMatrixResultSchema.parse(input);
  const observedScenarioIds = result.scenarios.map(({ scenarioId }) => scenarioId);
  assertExactScenarioSet(observedScenarioIds, requiredScenarioIds);
  if (JSON.stringify(observedScenarioIds) !== JSON.stringify(requiredScenarioIds)) {
    fail("Live Matrix Scenario summaries must follow registry order.");
  }
  if (
    new Set(result.scenarios.map(({ result: reference }) => reference.pointer)).size !==
    result.scenarios.length
  ) {
    fail("Live Matrix Scenario result pointers must be unique.");
  }
  const durationMs = Date.parse(result.endedAt) - Date.parse(result.startedAt);
  if (
    durationMs < 0 ||
    result.durationMs !== durationMs ||
    result.scenarios.some(
      (scenario) =>
        scenario.durationMs !== Date.parse(scenario.endedAt) - Date.parse(scenario.startedAt) ||
        scenario.slowObservation !== scenario.durationMs > LIVE_MATRIX_SLOW_OBSERVATION_MS ||
        Date.parse(scenario.startedAt) < Date.parse(result.startedAt) ||
        Date.parse(scenario.endedAt) > Date.parse(result.endedAt) ||
        scenario.turns.length === 0 ||
        scenario.turns.some(
          (turn, index) =>
            turn.turnNumber !== index + 1 ||
            turn.durationMs !== Date.parse(turn.endedAt) - Date.parse(turn.startedAt) ||
            turn.slowObservation !== turn.durationMs > LIVE_MATRIX_SLOW_OBSERVATION_MS ||
            Date.parse(turn.startedAt) < Date.parse(scenario.startedAt) ||
            Date.parse(turn.endedAt) > Date.parse(scenario.endedAt),
        ),
    )
  ) {
    fail("Live Matrix timestamps, durations, or slow observations contradict each other.");
  }
  if (result.peakConcurrency > result.scenarios.length) {
    fail("Live Matrix peak concurrency contradicts the observed Scenario execution.");
  }
  const allPass = result.scenarios.every(({ outcome }) => outcome === "pass");
  if (
    result.terminalOutcome !== (allPass ? "pass" : "not-pass") ||
    result.releasePrerequisiteSatisfied !==
      (result.evidenceClass === "release-candidate" && allPass) ||
    JSON.stringify(result.report) !==
      JSON.stringify(expectedReport(result.scenarios, result.peakConcurrency))
  ) {
    fail("Live Matrix terminal summary contradicts its complete Scenario ledger.");
  }
  return Object.freeze(result);
};

const scenarioResultReferenceSchema = z
  .object({
    result: z.unknown(),
    reference: durableResultReferenceSchema,
  })
  .strict();

export const createLiveMatrixResult = (input: {
  generationBasis: unknown;
  generationBasisReference: z.input<typeof durableResultReferenceSchema>;
  registeredScenarioIds: readonly string[];
  scenarioResults: readonly z.input<typeof scenarioResultReferenceSchema>[];
  peakConcurrency: number;
  endedAt: string;
}): LiveMatrixResult => {
  const generationBasis = parseLiveMatrixGenerationBasis(input.generationBasis);
  const requiredScenarioIds = uniqueScenarioIdsSchema.parse([...input.registeredScenarioIds]);
  if (JSON.stringify(generationBasis.selectedScenarioIds) !== JSON.stringify(requiredScenarioIds)) {
    fail("Live Matrix Generation basis does not bind the exact registry Scenario order.");
  }
  const references = z
    .array(scenarioResultReferenceSchema)
    .parse(input.scenarioResults)
    .map(({ result, reference }) => ({
      result: parseLiveMatrixScenarioTerminalResult(result),
      reference,
    }));
  assertExactScenarioSet(
    references.map(({ result }) => result.scenarioId),
    requiredScenarioIds,
  );
  if (references.some(({ result }) => result.generationId !== generationBasis.generationId)) {
    fail("Live Matrix Scenario result identity contradicts its Generation basis.");
  }
  const observationPointers = references.flatMap(({ result }) =>
    result.evidence.map(({ pointer }) => pointer),
  );
  if (new Set(observationPointers).size !== observationPointers.length) {
    fail("Live Matrix Scenario observation pointers must be globally unique.");
  }
  const ordered = requiredScenarioIds.map((scenarioId) => {
    const observed =
      references.find(({ result }) => result.scenarioId === scenarioId) ??
      fail(`Live Matrix Scenario result is unavailable: ${scenarioId}.`);
    return {
      scenarioId,
      outcome: observed.result.outcome,
      rationale: observed.result.rationale,
      startedAt: observed.result.startedAt,
      endedAt: observed.result.endedAt,
      durationMs: observed.result.durationMs,
      slowObservation: observed.result.durationMs > LIVE_MATRIX_SLOW_OBSERVATION_MS,
      turns: observed.result.turns.map((turn) => ({
        ...turn,
        slowObservation: turn.durationMs > LIVE_MATRIX_SLOW_OBSERVATION_MS,
      })),
      result: observed.reference,
    };
  });
  const allPass = ordered.every(({ outcome }) => outcome === "pass");
  return parseLiveMatrixResultForScenarioIds(
    {
      schemaVersion: 1,
      generationId: generationBasis.generationId,
      evidenceClass: generationBasis.package.evidenceClass,
      semanticEvaluationAuthority: LIVE_MATRIX_COORDINATOR_AUTHORITY,
      generationBasis: input.generationBasisReference,
      startedAt: generationBasis.startedAt,
      endedAt: input.endedAt,
      durationMs: Date.parse(input.endedAt) - Date.parse(generationBasis.startedAt),
      peakConcurrency: input.peakConcurrency,
      terminalOutcome: allPass ? "pass" : "not-pass",
      releasePrerequisiteSatisfied:
        generationBasis.package.evidenceClass === "release-candidate" && allPass,
      scenarios: ordered,
      report: expectedReport(ordered, input.peakConcurrency),
    },
    requiredScenarioIds,
  );
};

const readDurableReference = async (
  outputRoot: string,
  reference: z.infer<typeof durableResultReferenceSchema>,
  label: string,
): Promise<Readonly<{ bytes: Buffer; path: string }>> => {
  const path = await realpath(resolve(outputRoot, reference.pointer));
  const relation = relative(outputRoot, path);
  if (
    relation === "" ||
    relation === ".." ||
    relation.startsWith(`..${sep}`) ||
    isAbsolute(relation)
  ) {
    fail(`${label} escapes its Matrix evidence root.`);
  }
  const bytes = await readFile(path);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (sha256 !== reference.sha256) {
    fail(`${label} digest mismatch.`);
  }
  return Object.freeze({ bytes, path });
};

export const verifyLiveMatrixScenarioEvidence = async (
  outputRoot: string,
  input: unknown,
): Promise<LiveMatrixScenarioTerminalResult> => {
  const result = parseLiveMatrixScenarioTerminalResult(input);
  await Promise.all(
    result.evidence.map((reference) =>
      readDurableReference(
        outputRoot,
        reference,
        `Live Matrix Scenario observation ${result.scenarioId}/${reference.pointer}`,
      ),
    ),
  );
  return result;
};

export const verifyLiveMatrixResult = async (
  path: string,
  requiredScenarioIds: readonly string[],
): Promise<
  Readonly<{
    matrix: LiveMatrixResult;
    generationBasis: LiveMatrixGenerationBasis;
  }>
> => {
  const matrixPath = await realpath(resolve(path));
  const outputRoot = dirname(matrixPath);
  const matrix = parseLiveMatrixResultForScenarioIds(
    JSON.parse(await readFile(matrixPath, "utf8")),
    requiredScenarioIds,
  );
  if (matrix.scenarios.some(({ result }) => result.pointer === matrix.generationBasis.pointer)) {
    fail("Live Matrix Generation and Scenario result pointers must be distinct.");
  }

  const generationBytes = await readDurableReference(
    outputRoot,
    matrix.generationBasis,
    "Live Matrix Generation basis",
  );
  const generationBasis = parseLiveMatrixGenerationBasis(
    JSON.parse(generationBytes.bytes.toString("utf8")),
  );
  const scenarioResults = await Promise.all(
    matrix.scenarios.map(async (scenario) => {
      const resultBytes = await readDurableReference(
        outputRoot,
        scenario.result,
        `Live Matrix Scenario result ${scenario.scenarioId}`,
      );
      const result = await verifyLiveMatrixScenarioEvidence(
        outputRoot,
        JSON.parse(resultBytes.bytes.toString("utf8")),
      );
      if (result.scenarioId !== scenario.scenarioId) {
        fail(`Live Matrix Scenario result pointer has the wrong identity: ${scenario.scenarioId}.`);
      }
      return Object.freeze({ result, reference: scenario.result });
    }),
  );
  const recreated = createLiveMatrixResult({
    generationBasis,
    generationBasisReference: matrix.generationBasis,
    registeredScenarioIds: requiredScenarioIds,
    scenarioResults,
    peakConcurrency: matrix.peakConcurrency,
    endedAt: matrix.endedAt,
  });
  if (JSON.stringify(recreated) !== JSON.stringify(matrix)) {
    fail("Live Matrix summary contradicts its cited Generation or Scenario results.");
  }
  return Object.freeze({ matrix, generationBasis });
};
