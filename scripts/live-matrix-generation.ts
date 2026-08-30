import { z } from "zod";
import { CODEX_E2E_RUNTIME } from "./codex-e2e-runtime";
import { LIVE_MATRIX_CONCURRENCY } from "./live-matrix-scheduler";

const digestSchema = z.string().regex(/^[0-9a-f]{64}$/u);
const generationIdSchema = z.string().uuid();
const scenarioIdSchema = z.string().regex(/^[A-Z]+(?:-[A-Z]+)*-\d{2}$/u);
const timestampSchema = z.string().datetime({ offset: true });

const preparedScenarioReadbackSchema = z
  .object({
    generationId: generationIdSchema,
    scenarioId: scenarioIdSchema,
    fixtureSha256: digestSchema,
    skillsSha256: digestSchema,
    permissionOutcome: z.literal("passed"),
    githubBaselineSha256: digestSchema.optional(),
  })
  .strict();

export type LiveMatrixPreparedScenarioReadback = z.infer<typeof preparedScenarioReadbackSchema>;

const generationBasisValueSchema = z
  .object({
    schemaVersion: z.literal(1),
    generationId: generationIdSchema,
    staticPreflight: z.literal("complete"),
    package: z
      .object({
        evidenceClass: z.enum(["local-rehearsal", "release-candidate"]),
        identitySha256: digestSchema,
      })
      .strict(),
    registryDefinitionSha256: digestSchema,
    fixtureDefinitionSha256: digestSchema,
    harnessIdentitySha256: digestSchema,
    startedAt: timestampSchema,
    runtime: z
      .object({
        model: z.literal(CODEX_E2E_RUNTIME.model),
        reasoningEffort: z.literal(CODEX_E2E_RUNTIME.reasoningEffort),
        concurrency: z.literal(LIVE_MATRIX_CONCURRENCY),
      })
      .strict(),
    selectedScenarioIds: z.array(scenarioIdSchema).min(1),
    preparedScenarios: z.array(preparedScenarioReadbackSchema).min(1),
  })
  .strict();

const generationBasisSchema = generationBasisValueSchema.superRefine((basis, context) => {
  const selectedScenarioIds = new Set<string>();
  for (const [index, scenarioId] of basis.selectedScenarioIds.entries()) {
    if (selectedScenarioIds.has(scenarioId)) {
      context.addIssue({
        code: "custom",
        path: ["selectedScenarioIds", index],
        message: `Selected Scenario appears more than once: ${scenarioId}.`,
      });
    }
    selectedScenarioIds.add(scenarioId);
  }

  const preparedScenarioIds = new Set<string>();
  for (const [index, readback] of basis.preparedScenarios.entries()) {
    if (readback.generationId !== basis.generationId) {
      context.addIssue({
        code: "custom",
        path: ["preparedScenarios", index, "generationId"],
        message: "Prepared Scenario readback is not fresh for this Generation.",
      });
    }
    if (!selectedScenarioIds.has(readback.scenarioId)) {
      context.addIssue({
        code: "custom",
        path: ["preparedScenarios", index, "scenarioId"],
        message: `Prepared Scenario was not selected: ${readback.scenarioId}.`,
      });
    }
    if (preparedScenarioIds.has(readback.scenarioId)) {
      context.addIssue({
        code: "custom",
        path: ["preparedScenarios", index, "scenarioId"],
        message: `Scenario was prepared more than once: ${readback.scenarioId}.`,
      });
    }
    preparedScenarioIds.add(readback.scenarioId);
  }

  for (const [index, scenarioId] of basis.selectedScenarioIds.entries()) {
    if (!preparedScenarioIds.has(scenarioId)) {
      context.addIssue({
        code: "custom",
        path: ["selectedScenarioIds", index],
        message: `Selected Scenario was not prepared: ${scenarioId}.`,
      });
    }
  }
});

export type LiveMatrixGenerationBasis = z.infer<typeof generationBasisValueSchema>;

const generationBasisInputSchema = generationBasisValueSchema
  .omit({ schemaVersion: true, runtime: true })
  .strict();

export const parseLiveMatrixGenerationBasis = (input: unknown): LiveMatrixGenerationBasis =>
  generationBasisSchema.parse(input);

export const createLiveMatrixGenerationBasis = (input: unknown): LiveMatrixGenerationBasis => {
  const value = generationBasisInputSchema.parse(input);
  const basis = parseLiveMatrixGenerationBasis({
    schemaVersion: 1,
    ...value,
    runtime: {
      model: CODEX_E2E_RUNTIME.model,
      reasoningEffort: CODEX_E2E_RUNTIME.reasoningEffort,
      concurrency: LIVE_MATRIX_CONCURRENCY,
    },
  });
  const preparedByScenarioId = new Map(
    basis.preparedScenarios.map((readback) => [readback.scenarioId, readback]),
  );
  return Object.freeze(
    parseLiveMatrixGenerationBasis({
      ...basis,
      preparedScenarios: basis.selectedScenarioIds.map((scenarioId) =>
        preparedByScenarioId.get(scenarioId),
      ),
    }),
  );
};

const generationDispositionSchema = z.discriminatedUnion("disposition", [
  z
    .object({
      generationId: generationIdSchema,
      disposition: z.literal("valid"),
      freshGenerationRequired: z.literal(false),
    })
    .strict(),
  z
    .object({
      generationId: generationIdSchema,
      disposition: z.literal("invalid"),
      freshGenerationRequired: z.literal(true),
    })
    .strict(),
  z
    .object({
      generationId: generationIdSchema,
      disposition: z.literal("crashed"),
      freshGenerationRequired: z.literal(true),
    })
    .strict(),
]);

export type LiveMatrixGenerationDisposition = z.infer<typeof generationDispositionSchema>;

export const parseLiveMatrixGenerationDisposition = (
  input: unknown,
): LiveMatrixGenerationDisposition => generationDispositionSchema.parse(input);

export const createLiveMatrixGenerationDisposition = (
  basis: unknown,
  disposition: "valid" | "invalid" | "crashed",
): LiveMatrixGenerationDisposition => {
  const generation = parseLiveMatrixGenerationBasis(basis);
  return Object.freeze(
    parseLiveMatrixGenerationDisposition({
      generationId: generation.generationId,
      disposition,
      freshGenerationRequired: disposition !== "valid",
    }),
  );
};
