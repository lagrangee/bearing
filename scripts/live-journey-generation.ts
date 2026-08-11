import { basename, isAbsolute } from "node:path";
import { z } from "zod";
import matrixDefinition from "../validation/live-journey/matrix.json";
import { CODEX_E2E_RUNTIME } from "./codex-e2e-runtime";

const fail = (message: string): never => {
  throw new Error(message);
};

const trackedMatrixSchema = z
  .object({
    schemaVersion: z.literal(1),
    journeys: z.array(
      z
        .object({
          id: z.string().min(1),
          name: z.string().min(1),
          cases: z.array(z.object({ id: z.string().min(1), name: z.string().min(1) }).strict()),
        })
        .strict(),
    ),
  })
  .strict();
const trackedMatrix = trackedMatrixSchema.parse(matrixDefinition);
const journeyIds = Object.freeze(trackedMatrix.journeys.map(({ id }) => id));
const caseIds = Object.freeze(
  trackedMatrix.journeys.flatMap((journey) => journey.cases.map(({ id }) => id)),
);
const caseIdsByJourney = new Map(
  trackedMatrix.journeys.map((journey) => [
    journey.id,
    Object.freeze(journey.cases.map(({ id }) => id)),
  ]),
);
if (journeyIds.length !== 3 || caseIds.length !== 18 || new Set(caseIds).size !== caseIds.length) {
  fail("Tracked Live Journey Matrix must define three Journeys and 18 unique Cases.");
}

export const liveJourneyCaseIds = Object.freeze(
  Object.fromEntries(caseIdsByJourney) as Readonly<Record<string, readonly string[]>>,
);

const journeyIdSchema = z.string().refine((value) => journeyIds.includes(value));
const caseIdSchema = z.string().refine((value) => caseIds.includes(value));
export const liveJourneyOutcomeSchema = z.enum(["pass", "fail", "blocked", "not-run"]);
const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/u);
export const liveJourneyEvidencePointerSchema = z
  .string()
  .trim()
  .min(1)
  .max(300)
  .refine(
    (value) =>
      !isAbsolute(value) &&
      !/^[A-Za-z]:[\\/]/u.test(value) &&
      !value.split(/[\\/]/u).includes("..") &&
      !value
        .split(/[\\/]/u)
        .map((segment) => segment.toLowerCase())
        .some(
          (segment) =>
            segment.includes("transcript") ||
            segment.includes("session") ||
            segment.startsWith("operator-config"),
        ),
    "Evidence pointers must stay relative to the Matrix workspace.",
  );
const judgmentBasisSchema = z
  .string()
  .trim()
  .min(1)
  .max(600)
  .refine(
    (value) => !/[\r\n]/u.test(value) && !value.includes(String.fromCharCode(0)),
    "Judgment basis must be one bounded line.",
  )
  .refine(
    (value) =>
      !/(?:\/Users\/|\/home\/|\/private\/|\/var\/folders\/|[A-Za-z]:\\Users\\)/u.test(value),
    "Judgment basis must not contain a machine-specific private path.",
  );

const workflowSchema = z
  .object({
    name: z.string().min(1),
    runId: z.string().min(1),
    runAttempt: z.number().int().positive(),
  })
  .strict();
const candidateArtifactSchema = z
  .object({
    path: z.string().min(1),
    file: z.string().min(1),
    sha256: sha256Schema,
  })
  .strict();

export const liveMatrixCandidateSchema = z
  .object({
    packageName: z.literal("@lagrangee/bearing"),
    packageVersion: z.string().min(1),
    sourceCommit: z.string().min(1),
    workflow: workflowSchema,
    artifact: candidateArtifactSchema,
    matrixDefinitionSha256: sha256Schema,
  })
  .strict()
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

const boundedCandidateSchema = z
  .object({
    packageName: z.literal("@lagrangee/bearing"),
    packageVersion: z.string().min(1),
    sourceCommit: z.string().min(1),
    workflow: workflowSchema,
    artifact: z
      .object({
        file: z.string().min(1),
        sha256: sha256Schema,
      })
      .strict(),
    matrixDefinitionSha256: sha256Schema,
  })
  .strict();

const codexSchema = z
  .object({
    cliVersion: z.string().trim().min(1),
    requestedModel: z.literal(CODEX_E2E_RUNTIME.model),
    requestedReasoningEffort: z.literal(CODEX_E2E_RUNTIME.reasoningEffort),
  })
  .strict();

const blockDispositionSchema = z
  .object({
    reason: z.enum(["model", "network", "credential", "harness"]),
    testedBehaviorStarted: z.literal(false),
  })
  .strict();

const caseResultSchema = z
  .object({
    caseId: caseIdSchema,
    outcome: liveJourneyOutcomeSchema,
    judgmentBasis: judgmentBasisSchema,
    observationPointers: z.array(liveJourneyEvidencePointerSchema).min(1).max(24),
    failurePointer: liveJourneyEvidencePointerSchema.optional(),
    block: blockDispositionSchema.optional(),
  })
  .strict()
  .superRefine((entry, context) => {
    if ((entry.outcome === "blocked") !== (entry.block !== undefined)) {
      context.addIssue({
        code: "custom",
        message: "Only a pre-behavior blocked Case requires one bounded block disposition.",
      });
    }
  });

const journeyResultSchema = z
  .object({
    schemaVersion: z.literal(1),
    generationId: z.string().uuid(),
    journey: journeyIdSchema,
    candidate: boundedCandidateSchema,
    codex: codexSchema,
    coordinatorIdentity: z.string().trim().min(1).max(200),
    fixtureSha256: sha256Schema,
    durationMs: z.number().int().nonnegative().safe(),
    outcome: z.enum(["pass", "not-pass"]),
    cases: z.array(caseResultSchema),
    remoteIntegrity: z
      .object({
        repositoryIdentitySha256: sha256Schema,
        sha256: sha256Schema,
      })
      .strict()
      .optional(),
  })
  .strict();

const journeyResultReferenceSchema = z
  .object({
    result: journeyResultSchema,
    pointer: liveJourneyEvidencePointerSchema,
    sha256: sha256Schema,
  })
  .strict();

const finalCaseSchema = z
  .object({
    caseId: caseIdSchema,
    journey: journeyIdSchema,
    outcome: liveJourneyOutcomeSchema,
    judgmentBasis: judgmentBasisSchema,
    evidencePointers: z.array(liveJourneyEvidencePointerSchema).min(1).max(24),
    failurePointer: liveJourneyEvidencePointerSchema.optional(),
    block: blockDispositionSchema.optional(),
  })
  .strict();

const generationResultSchema = z
  .object({
    schemaVersion: z.literal(1),
    generationId: z.string().uuid(),
    candidate: boundedCandidateSchema,
    matrixDefinitionSha256: sha256Schema,
    codex: codexSchema,
    coordinatorIdentity: z.string().trim().min(1).max(200),
    semanticEvaluationAuthority: z.literal("coordinating-agent"),
    durationMs: z.number().int().nonnegative().safe(),
    terminalOutcome: z.enum(["pass", "not-pass"]),
    releasePrerequisiteSatisfied: z.boolean(),
    journeys: z.array(
      z
        .object({
          journey: journeyIdSchema,
          outcome: z.enum(["pass", "not-pass"]),
          durationMs: z.number().int().nonnegative().safe(),
          fixtureSha256: sha256Schema,
          result: z
            .object({ pointer: liveJourneyEvidencePointerSchema, sha256: sha256Schema })
            .strict(),
        })
        .strict(),
    ),
    cases: z.array(finalCaseSchema),
  })
  .strict();

const assertLiveJourneyGenerationResult = (
  result: z.infer<typeof generationResultSchema>,
): void => {
  if (result.matrixDefinitionSha256 !== result.candidate.matrixDefinitionSha256) {
    fail("Matrix result definition digest does not match its Candidate identity.");
  }
  const observedJourneys = result.journeys.map(({ journey }) => journey);
  if (
    observedJourneys.length !== journeyIds.length ||
    new Set(observedJourneys).size !== journeyIds.length ||
    journeyIds.some((journey) => !observedJourneys.includes(journey))
  ) {
    fail("Matrix result requires each Journey exactly once.");
  }
  const observedCases = result.cases.map(({ caseId }) => caseId);
  if (
    observedCases.length !== caseIds.length ||
    new Set(observedCases).size !== caseIds.length ||
    caseIds.some((caseId) => !observedCases.includes(caseId))
  ) {
    fail("Matrix result requires each Case exactly once.");
  }
  for (const entry of result.cases) {
    if (!caseIdsByJourney.get(entry.journey)?.includes(entry.caseId)) {
      fail(`Matrix Case is assigned to the wrong Journey: ${entry.caseId}.`);
    }
  }
  for (const journey of result.journeys) {
    const expectedOutcome = result.cases
      .filter((entry) => entry.journey === journey.journey)
      .every(({ outcome }) => outcome === "pass")
      ? "pass"
      : "not-pass";
    if (journey.outcome !== expectedOutcome) {
      fail(`Matrix Journey outcome contradicts its Case results: ${journey.journey}.`);
    }
  }
  const releasePrerequisiteSatisfied = result.cases.every(({ outcome }) => outcome === "pass");
  if (
    result.releasePrerequisiteSatisfied !== releasePrerequisiteSatisfied ||
    result.terminalOutcome !== (releasePrerequisiteSatisfied ? "pass" : "not-pass")
  ) {
    fail("Matrix terminal outcome contradicts its Case results.");
  }
};

export const parseLiveJourneyGenerationResult = (value: unknown) => {
  const result = generationResultSchema.parse(value);
  assertLiveJourneyGenerationResult(result);
  return result;
};

const schemaEncoding = (value: unknown): string => JSON.stringify(value);

export const validateLiveJourneyVerdicts = (journeyInput: string, input: readonly unknown[]) => {
  const journey = journeyIdSchema.parse(journeyInput);
  const verdicts = z.array(caseResultSchema).parse(input);
  const required = caseIdsByJourney.get(journey) ?? fail(`Unknown Matrix Journey: ${journey}.`);
  const observed = verdicts.map(({ caseId }) => caseId);
  if (
    observed.length !== required.length ||
    new Set(observed).size !== required.length ||
    required.some((caseId) => !observed.includes(caseId))
  ) {
    fail(`Coordinator evaluation requires each ${journey} Case exactly once.`);
  }
  return verdicts;
};

export const createLiveJourneyEvaluation = (input: {
  generationId: string;
  journey: string;
  candidate: LiveMatrixCandidate;
  codexCliVersion: string;
  coordinatorIdentity: string;
  fixtureSha256: string;
  durationMs: number;
  verdicts: readonly unknown[];
}) => {
  const generationId = z.string().uuid().parse(input.generationId);
  const journey = journeyIdSchema.parse(input.journey);
  const candidate = liveMatrixCandidateSchema.parse(input.candidate);
  const codex = codexSchema.parse({
    cliVersion: input.codexCliVersion,
    requestedModel: CODEX_E2E_RUNTIME.model,
    requestedReasoningEffort: CODEX_E2E_RUNTIME.reasoningEffort,
  });
  const coordinatorIdentity = z.string().trim().min(1).max(200).parse(input.coordinatorIdentity);
  const fixtureSha256 = sha256Schema.parse(input.fixtureSha256);
  const durationMs = z.number().int().nonnegative().safe().parse(input.durationMs);
  const verdicts = validateLiveJourneyVerdicts(journey, input.verdicts);
  return Object.freeze({
    schemaVersion: 1 as const,
    generationId,
    journey,
    candidate: Object.freeze({
      packageName: candidate.packageName,
      packageVersion: candidate.packageVersion,
      sourceCommit: candidate.sourceCommit,
      workflow: Object.freeze(candidate.workflow),
      artifact: Object.freeze({ file: candidate.artifact.file, sha256: candidate.artifact.sha256 }),
      matrixDefinitionSha256: candidate.matrixDefinitionSha256,
    }),
    codex: Object.freeze(codex),
    coordinatorIdentity,
    fixtureSha256,
    durationMs,
    outcome: verdicts.every(({ outcome }) => outcome === "pass")
      ? ("pass" as const)
      : ("not-pass" as const),
    cases: Object.freeze(verdicts.map((verdict) => Object.freeze(verdict))),
  });
};

const assertCompleteJourney = (result: z.infer<typeof journeyResultSchema>): void => {
  const required =
    caseIdsByJourney.get(result.journey) ?? fail(`Unknown Matrix Journey: ${result.journey}.`);
  const observed = result.cases.map(({ caseId }) => caseId);
  if (
    observed.length !== required.length ||
    new Set(observed).size !== required.length ||
    required.some((caseId) => !observed.includes(caseId))
  ) {
    fail(`Coordinator evaluation requires each ${result.journey} Case exactly once.`);
  }
  const expectedOutcome = result.cases.every(({ outcome }) => outcome === "pass")
    ? "pass"
    : "not-pass";
  if (result.outcome !== expectedOutcome) {
    fail(`Journey outcome contradicts its Coordinator Case verdicts: ${result.journey}.`);
  }
};

export const createLiveJourneyGenerationResult = (input: {
  journeyResults: readonly unknown[];
}) => {
  const references = z.array(journeyResultReferenceSchema).parse(input.journeyResults);
  if (
    references.length !== journeyIds.length ||
    new Set(references.map(({ result }) => result.journey)).size !== journeyIds.length ||
    journeyIds.some((journey) => !references.some(({ result }) => result.journey === journey))
  ) {
    fail("One Matrix result requires each Journey exactly once.");
  }
  if (new Set(references.map(({ pointer }) => pointer)).size !== references.length) {
    fail("Each Journey result requires one unique bounded evidence pointer.");
  }

  const ordered = journeyIds.map(
    (journey) =>
      references.find(({ result }) => result.journey === journey) ??
      fail(`Journey result is unavailable: ${journey}.`),
  );
  for (const { result } of ordered) assertCompleteJourney(result);

  const first = ordered[0] ?? fail("Matrix Journey results are unavailable.");
  const generationId = first.result.generationId;
  const candidate = first.result.candidate;
  const codex = first.result.codex;
  const coordinatorIdentity = first.result.coordinatorIdentity;
  if (ordered.some(({ result }) => result.generationId !== generationId)) {
    fail("All Journeys must belong to the same Matrix generation.");
  }
  if (
    ordered.some(({ result }) => schemaEncoding(result.candidate) !== schemaEncoding(candidate))
  ) {
    fail("All Journeys must use the same Candidate identity.");
  }
  if (ordered.some(({ result }) => schemaEncoding(result.codex) !== schemaEncoding(codex))) {
    fail("All Journeys must use the same Codex launch identity.");
  }
  if (ordered.some(({ result }) => result.coordinatorIdentity !== coordinatorIdentity)) {
    fail("All Journeys must use the same Coordinator identity.");
  }

  const cases = ordered.flatMap(({ result }) =>
    result.cases.map(({ observationPointers, ...entry }) => ({
      ...entry,
      journey: result.journey,
      evidencePointers: observationPointers,
    })),
  );
  const durationMs = ordered.reduce((total, { result }) => total + result.durationMs, 0);
  if (!Number.isSafeInteger(durationMs)) fail("Matrix generation duration exceeds safe bounds.");
  const releasePrerequisiteSatisfied =
    cases.length === 18 && cases.every(({ outcome }) => outcome === "pass");

  return parseLiveJourneyGenerationResult({
    schemaVersion: 1,
    generationId,
    candidate,
    matrixDefinitionSha256: candidate.matrixDefinitionSha256,
    codex,
    coordinatorIdentity,
    semanticEvaluationAuthority: "coordinating-agent",
    durationMs,
    terminalOutcome: releasePrerequisiteSatisfied ? "pass" : "not-pass",
    releasePrerequisiteSatisfied,
    journeys: ordered.map(({ result, pointer, sha256 }) => ({
      journey: result.journey,
      outcome: result.outcome,
      durationMs: result.durationMs,
      fixtureSha256: result.fixtureSha256,
      result: { pointer, sha256 },
    })),
    cases,
  });
};

const requiredGitleaksVersion = "8.30.1";

export const scanLiveJourneyDurableEvidence = (input: {
  value: unknown;
  configPath: string;
}): string => {
  const bytes = `${JSON.stringify(input.value, null, 2)}\n`;
  const version = Bun.spawnSync(["gitleaks", "version"], { stdout: "pipe", stderr: "pipe" });
  if (version.exitCode !== 0 || version.stdout.toString().trim() !== requiredGitleaksVersion) {
    fail(`Durable Matrix evidence requires Gitleaks ${requiredGitleaksVersion}.`);
  }
  const scan = Bun.spawnSync(
    ["gitleaks", "stdin", "--config", input.configPath, "--no-banner", "--no-color", "--redact"],
    { stdin: Buffer.from(bytes, "utf8"), stdout: "pipe", stderr: "pipe" },
  );
  if (scan.exitCode !== 0) {
    fail("Durable Live Journey evidence failed the required Gitleaks scan.");
  }
  return bytes;
};

export const assertJourneyRerunEligibility = (input: {
  generation: unknown;
  journey: string;
  freshFixtureSha256: string;
  candidate: unknown;
  matrixDefinitionSha256: string;
}) => {
  const generation = parseLiveJourneyGenerationResult(input.generation);
  const journey = journeyIdSchema.parse(input.journey);
  const candidate = boundedCandidateSchema.parse(input.candidate);
  const freshFixtureSha256 = sha256Schema.parse(input.freshFixtureSha256);
  const matrixDefinitionSha256 = sha256Schema.parse(input.matrixDefinitionSha256);
  const cases = generation.cases.filter((entry) => entry.journey === journey);

  if (schemaEncoding(candidate) !== schemaEncoding(generation.candidate)) {
    fail("A Journey rerun must use the same Candidate identity.");
  }
  if (
    matrixDefinitionSha256 !== generation.matrixDefinitionSha256 ||
    matrixDefinitionSha256 !== candidate.matrixDefinitionSha256
  ) {
    fail("A Journey rerun must use the same Matrix identity.");
  }
  const priorFixtureSha256 =
    generation.journeys.find((entry) => entry.journey === journey)?.fixtureSha256 ??
    fail(`Matrix Journey is unavailable: ${journey}.`);
  if (priorFixtureSha256 === freshFixtureSha256) {
    fail("A Journey rerun requires a fresh fixture.");
  }
  if (
    cases.length === 0 ||
    !cases.some(({ outcome }) => outcome === "blocked") ||
    cases.some(({ outcome }) => outcome === "pass" || outcome === "fail")
  ) {
    fail("A Journey with semantic outcomes cannot be resampled inside one generation.");
  }
  const reasons = new Set(
    cases.flatMap((entry) => (entry.block === undefined ? [] : [entry.block.reason])),
  );
  if (reasons.size !== 1) {
    fail("A blocked Journey rerun requires one result-bound infrastructure reason.");
  }
  const reason =
    reasons.values().next().value ?? fail("A blocked Journey rerun reason is unavailable.");

  return Object.freeze({
    generationId: generation.generationId,
    journey,
    reason,
    freshFixtureSha256,
  });
};
