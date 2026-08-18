import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { z } from "zod";
import trackedRegistryDefinition from "../validation/live-journey/registry.json";
import { CODEX_E2E_RUNTIME } from "./codex-e2e-runtime";
import { type LiveScenarioPackage, liveScenarioPackageSchema } from "./live-scenario-evidence";
import {
  type LiveScenarioEvaluation,
  type LiveScenarioRegistry,
  liveScenarioEvidencePointerSchema,
  parseLiveScenarioEvaluation,
  parseLiveScenarioRegistry,
} from "./live-scenario-registry";

const fail = (message: string): never => {
  throw new Error(message);
};

const digestSchema = z.string().regex(/^[0-9a-f]{64}$/u);
const scenarioIdSchema = z.string().regex(/^[A-Z]+-\d{2}$/u);
const boundedArtifactSchema = z.object({ file: z.string().min(1), sha256: digestSchema }).strict();
const boundedPackageSchema = z.discriminatedUnion("evidenceClass", [
  z
    .object({
      evidenceClass: z.literal("local-rehearsal"),
      packageName: z.literal("@lagrangee/bearing"),
      packageVersion: z.string().min(1),
      sourceHead: z.string().min(1),
      worktreeSha256: digestSchema,
      artifact: boundedArtifactSchema,
      matrixDefinitionSha256: digestSchema,
    })
    .strict(),
  z
    .object({
      evidenceClass: z.literal("release-candidate"),
      packageName: z.literal("@lagrangee/bearing"),
      packageVersion: z.string().min(1),
      sourceCommit: z.string().min(1),
      workflow: z
        .object({
          name: z.string().min(1),
          runId: z.string().min(1),
          runAttempt: z.number().int().positive(),
        })
        .strict(),
      artifact: boundedArtifactSchema,
      matrixDefinitionSha256: digestSchema,
    })
    .strict(),
]);
const codexSchema = z
  .object({
    cliVersion: z.string().trim().min(1),
    requestedModel: z.literal(CODEX_E2E_RUNTIME.model),
    requestedReasoningEffort: z.literal(CODEX_E2E_RUNTIME.reasoningEffort),
  })
  .strict();
const remoteIntegritySchema = z
  .object({
    repositoryIdentitySha256: digestSchema,
    authorizedCandidateIssueCount: z.number().int().nonnegative().safe(),
    integritySha256: digestSchema,
  })
  .strict();
const attemptDispositionSchema = z
  .object({
    schemaVersion: z.literal(1),
    turn: z.number().int().positive(),
    reason: z.enum(["model", "network", "credential", "harness"]),
    testedBehaviorStarted: z.boolean(),
    priorObservation: z
      .object({ pointer: liveScenarioEvidencePointerSchema, sha256: digestSchema })
      .strict(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.reason !== "harness" && value.testedBehaviorStarted) {
      context.addIssue({
        code: "custom",
        path: ["testedBehaviorStarted"],
        message: "Only a harness repair may retry after rejected behavior started.",
      });
    }
  });

export const parseLiveScenarioAttemptDisposition = (input: unknown) =>
  attemptDispositionSchema.parse(input);
const liveScenarioResultSchema = z
  .object({
    schemaVersion: z.literal(1),
    evidenceClass: z.enum(["local-rehearsal", "release-candidate"]),
    generationId: z.string().uuid(),
    scenarioId: scenarioIdSchema,
    package: boundedPackageSchema,
    matrixDefinitionSha256: digestSchema,
    codex: codexSchema,
    coordinatorIdentity: z.string().trim().min(1).max(200),
    startingStateSha256: digestSchema,
    durationMs: z.number().int().nonnegative().safe(),
    attempts: z.array(attemptDispositionSchema).max(64),
    remoteIntegrity: remoteIntegritySchema.optional(),
    evaluation: z.unknown(),
  })
  .strict();

export const liveScenarioPackageEvidenceIdentity = (input: LiveScenarioPackage) =>
  input.evidenceClass === "release-candidate"
    ? {
        evidenceClass: input.evidenceClass,
        packageName: input.packageName,
        packageVersion: input.packageVersion,
        sourceCommit: input.sourceCommit,
        workflow: input.workflow,
        artifact: { file: input.artifact.file, sha256: input.artifact.sha256 },
        matrixDefinitionSha256: input.matrixDefinitionSha256,
      }
    : {
        evidenceClass: input.evidenceClass,
        packageName: input.packageName,
        packageVersion: input.packageVersion,
        sourceHead: input.sourceHead,
        worktreeSha256: input.worktreeSha256,
        artifact: { file: input.artifact.file, sha256: input.artifact.sha256 },
        matrixDefinitionSha256: input.matrixDefinitionSha256,
      };

export type LiveScenarioResult = Omit<z.infer<typeof liveScenarioResultSchema>, "evaluation"> & {
  readonly evaluation: LiveScenarioEvaluation;
};

export const parseLiveScenarioResult = (input: unknown): LiveScenarioResult => {
  const parsed = liveScenarioResultSchema.parse(input);
  const evaluation = parseLiveScenarioEvaluation(parsed.evaluation);
  if (
    parsed.scenarioId !== evaluation.scenarioId ||
    parsed.evidenceClass !== parsed.package.evidenceClass ||
    parsed.matrixDefinitionSha256 !== parsed.package.matrixDefinitionSha256 ||
    parsed.coordinatorIdentity !== evaluation.coordinatorIdentity
  ) {
    fail("Live Scenario result identity contradicts its evaluation or package.");
  }
  return Object.freeze({ ...parsed, evaluation });
};

export const createLiveScenarioResult = (input: {
  evidenceClass: "local-rehearsal" | "release-candidate";
  generationId: string;
  package: unknown;
  matrixDefinitionSha256: string;
  codexCliVersion: string;
  coordinatorIdentity: string;
  startingStateSha256: string;
  durationMs: number;
  evaluation: unknown;
  remoteIntegrity?: unknown;
  attempts?: readonly unknown[];
}): LiveScenarioResult => {
  const matrixPackage = liveScenarioPackageSchema.parse(input.package);
  const evaluation = parseLiveScenarioEvaluation(input.evaluation);
  return parseLiveScenarioResult({
    schemaVersion: 1,
    evidenceClass: input.evidenceClass,
    generationId: input.generationId,
    scenarioId: evaluation.scenarioId,
    package: liveScenarioPackageEvidenceIdentity(matrixPackage),
    matrixDefinitionSha256: input.matrixDefinitionSha256,
    codex: {
      cliVersion: input.codexCliVersion,
      requestedModel: CODEX_E2E_RUNTIME.model,
      requestedReasoningEffort: CODEX_E2E_RUNTIME.reasoningEffort,
    },
    coordinatorIdentity: input.coordinatorIdentity,
    startingStateSha256: input.startingStateSha256,
    durationMs: input.durationMs,
    attempts: input.attempts ?? [],
    remoteIntegrity: input.remoteIntegrity,
    evaluation,
  });
};

const resultReferenceSchema = z
  .object({
    result: z.unknown(),
    pointer: liveScenarioEvidencePointerSchema,
    sha256: digestSchema,
  })
  .strict();

const matrixScenarioSchema = z
  .object({
    scenarioId: scenarioIdSchema,
    outcome: z.enum(["pass", "fail", "blocked", "not-run"]),
    durationMs: z.number().int().nonnegative().safe(),
    startingStateSha256: digestSchema,
    attempts: z.array(attemptDispositionSchema).max(64),
    remoteIntegrity: remoteIntegritySchema.optional(),
    rationale: z.string().trim().min(1).max(800),
    result: z.object({ pointer: liveScenarioEvidencePointerSchema, sha256: digestSchema }).strict(),
  })
  .strict();

const liveScenarioMatrixResultSchema = z
  .object({
    schemaVersion: z.literal(1),
    evidenceClass: z.enum(["local-rehearsal", "release-candidate"]),
    generationId: z.string().uuid(),
    package: boundedPackageSchema,
    matrixDefinitionSha256: digestSchema,
    codex: codexSchema,
    coordinatorIdentity: z.string().trim().min(1).max(200),
    semanticEvaluationAuthority: z.literal("coordinating-agent"),
    durationMs: z.number().int().nonnegative().safe(),
    terminalOutcome: z.enum(["pass", "not-pass"]),
    releasePrerequisiteSatisfied: z.boolean(),
    scenarios: z.array(matrixScenarioSchema),
  })
  .strict();

const trackedRegistry = parseLiveScenarioRegistry(trackedRegistryDefinition);

export const parseLiveScenarioMatrixResult = (input: unknown) => {
  const result = liveScenarioMatrixResultSchema.parse(input);
  if (
    result.evidenceClass !== result.package.evidenceClass ||
    result.matrixDefinitionSha256 !== result.package.matrixDefinitionSha256
  ) {
    fail("Matrix result identity contradicts its bounded package.");
  }
  const requiredIds = trackedRegistry.scenarios.map(({ id }) => id);
  const observedIds = result.scenarios.map(({ scenarioId }) => scenarioId);
  if (
    observedIds.length !== requiredIds.length ||
    new Set(observedIds).size !== requiredIds.length ||
    requiredIds.some((scenarioId) => !observedIds.includes(scenarioId))
  ) {
    fail("Matrix result requires each tracked Live Scenario exactly once.");
  }
  for (const scenario of trackedRegistry.scenarios) {
    const observed = result.scenarios.find(({ scenarioId }) => scenarioId === scenario.id);
    const requiresRemoteIntegrity = scenario.fixture.materializer === "active-github-repository";
    if ((observed?.remoteIntegrity !== undefined) !== requiresRemoteIntegrity) {
      fail(`Matrix remote integrity evidence contradicts its Scenario: ${scenario.id}.`);
    }
  }
  const allPass = result.scenarios.every(({ outcome }) => outcome === "pass");
  if (
    result.durationMs !==
      result.scenarios.reduce((total, scenario) => total + scenario.durationMs, 0) ||
    result.terminalOutcome !== (allPass ? "pass" : "not-pass") ||
    result.releasePrerequisiteSatisfied !==
      (result.evidenceClass === "release-candidate" && allPass)
  ) {
    fail("Matrix terminal evidence contradicts its Scenario results.");
  }
  return Object.freeze(result);
};

export const createLiveScenarioMatrixResult = (input: {
  registry: LiveScenarioRegistry;
  scenarioResults: readonly unknown[];
}) => {
  const references = z
    .array(resultReferenceSchema)
    .parse(input.scenarioResults)
    .map((reference) => ({ ...reference, result: parseLiveScenarioResult(reference.result) }));
  const requiredIds = input.registry.scenarios.map(({ id }) => id);
  const observedIds = references.map(({ result }) => result.scenarioId);
  if (
    observedIds.length !== requiredIds.length ||
    new Set(observedIds).size !== requiredIds.length ||
    requiredIds.some((scenarioId) => !observedIds.includes(scenarioId))
  ) {
    fail("Matrix result requires each registered Live Scenario exactly once.");
  }
  const first = references[0]?.result ?? fail("Matrix has no Scenario results.");
  const identity = JSON.stringify({
    evidenceClass: first.evidenceClass,
    generationId: first.generationId,
    package: first.package,
    matrixDefinitionSha256: first.matrixDefinitionSha256,
    codex: first.codex,
    coordinatorIdentity: first.coordinatorIdentity,
  });
  for (const { result } of references) {
    const observedIdentity = JSON.stringify({
      evidenceClass: result.evidenceClass,
      generationId: result.generationId,
      package: result.package,
      matrixDefinitionSha256: result.matrixDefinitionSha256,
      codex: result.codex,
      coordinatorIdentity: result.coordinatorIdentity,
    });
    if (observedIdentity !== identity) {
      fail("Matrix Scenario results do not share one exact identity.");
    }
  }
  for (const scenario of input.registry.scenarios) {
    const result = references.find(
      (reference) => reference.result.scenarioId === scenario.id,
    )?.result;
    const requiresRemoteIntegrity = scenario.fixture.materializer === "active-github-repository";
    if ((result?.remoteIntegrity !== undefined) !== requiresRemoteIntegrity) {
      fail(`Live Scenario remote integrity evidence contradicts its fixture: ${scenario.id}.`);
    }
  }
  if (new Set(references.map(({ pointer }) => pointer)).size !== references.length) {
    fail("Matrix Scenario result pointers must be unique.");
  }
  const ordered = requiredIds.map((scenarioId) => {
    const reference =
      references.find(({ result }) => result.scenarioId === scenarioId) ??
      fail(`Live Scenario result is unavailable: ${scenarioId}.`);
    return Object.freeze({
      scenarioId,
      outcome: reference.result.evaluation.outcome,
      durationMs: reference.result.durationMs,
      startingStateSha256: reference.result.startingStateSha256,
      attempts: reference.result.attempts,
      remoteIntegrity: reference.result.remoteIntegrity,
      rationale: reference.result.evaluation.rationale,
      result: Object.freeze({ pointer: reference.pointer, sha256: reference.sha256 }),
    });
  });
  const allPass = ordered.every(({ outcome }) => outcome === "pass");
  const terminalOutcome = allPass ? ("pass" as const) : ("not-pass" as const);
  return parseLiveScenarioMatrixResult({
    schemaVersion: 1 as const,
    evidenceClass: first.evidenceClass,
    generationId: first.generationId,
    package: first.package,
    matrixDefinitionSha256: first.matrixDefinitionSha256,
    codex: first.codex,
    coordinatorIdentity: first.coordinatorIdentity,
    semanticEvaluationAuthority: "coordinating-agent" as const,
    durationMs: ordered.reduce((total, scenario) => total + scenario.durationMs, 0),
    terminalOutcome,
    releasePrerequisiteSatisfied:
      first.evidenceClass === "release-candidate" && terminalOutcome === "pass",
    scenarios: Object.freeze(ordered),
  });
};

export const verifyLiveScenarioMatrixResult = async (path: string) => {
  const matrixPath = await realpath(resolve(path));
  const outputRoot = dirname(matrixPath);
  const parsed = parseLiveScenarioMatrixResult(JSON.parse(await readFile(matrixPath, "utf8")));
  const scenarioResults = await Promise.all(
    parsed.scenarios.map(async (scenario) => {
      const resultPath = await realpath(resolve(outputRoot, scenario.result.pointer));
      const relation = relative(outputRoot, resultPath);
      if (relation === "" || relation.startsWith("..") || isAbsolute(relation)) {
        fail(`Matrix Scenario result escapes its evidence root: ${scenario.scenarioId}.`);
      }
      const bytes = await readFile(resultPath);
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      if (sha256 !== scenario.result.sha256) {
        fail(`Matrix Scenario result digest mismatch: ${scenario.scenarioId}.`);
      }
      const result = parseLiveScenarioResult(JSON.parse(bytes.toString("utf8")));
      if (result.scenarioId !== scenario.scenarioId) {
        fail(`Matrix Scenario result pointer has the wrong identity: ${scenario.scenarioId}.`);
      }
      return { result, pointer: scenario.result.pointer, sha256 };
    }),
  );
  const recreated = createLiveScenarioMatrixResult({
    registry: trackedRegistry,
    scenarioResults,
  });
  if (JSON.stringify(recreated) !== JSON.stringify(parsed)) {
    fail("Matrix summary contradicts its cited Scenario results.");
  }
  return parsed;
};
