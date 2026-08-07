import { z } from "zod";
import {
  authoritySchema,
  effortSchema,
  gateSchema,
  planningReviewSchema,
  roadmapSchema,
  structuralDiagnosticSchema,
} from "../project-snapshot/schema";
import { assetProjectionSchema } from "../project-snapshot/schema-asset";
import { projectBriefSchema } from "../project-snapshot/schema-brief";
import {
  planningLineageParentPathSchema,
  planningLineageRelationSchema,
  planningLineageSemanticSectionSchema,
} from "../project-snapshot/schema-planning-lineage";
import { projectSummarySchema } from "../project-snapshot/schema-summary";
import { sourceRecordSchema } from "../project-snapshot/source-schema";

export const PROJECT_READ_MODEL_STORAGE_VERSION = 1 as const;
export const PROJECT_READ_MODEL_PROJECTION_VERSION = 1 as const;
export const PROJECT_INSPECT_ENVELOPE_VERSION = 1 as const;

export const projectReadModelReceiptSchema = z.strictObject({
  basisFingerprint: z.string().regex(/^sha256:[0-9a-f]{64}$/u),
  publishedAt: z.string().datetime({ offset: true }),
  publicationCount: z.number().int().positive(),
});

export type ProjectReadModelReceipt = Readonly<z.infer<typeof projectReadModelReceiptSchema>>;

export const planningReferenceSchema = z
  .string()
  .refine(
    (reference) =>
      /^(?:roadmap|gate|effort|asset|authority|planning-review):[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(
        reference,
      ) ||
      reference === "project-summary:current" ||
      reference === "project-brief:current",
    { message: "Expected one supported stable planning reference." },
  );

export type ProjectInspectRequest =
  | Readonly<{ kind: "project" }>
  | Readonly<{ kind: "planning-reference"; reference: string }>
  | Readonly<{ kind: "diagnostics" }>;

export type ProjectInspectOutcome =
  | "complete"
  | "partial"
  | "unfulfilled"
  | "recovery-required"
  | "need-update";

export type ProjectInspectEnvelope = Readonly<{
  schemaVersion: typeof PROJECT_INSPECT_ENVELOPE_VERSION;
  command: "inspect";
  outcome: ProjectInspectOutcome;
  request: ProjectInspectRequest;
  generation?: ProjectReadModelReceipt;
  result?: ProjectInspectResult;
  diagnostics: readonly z.infer<typeof structuralDiagnosticSchema>[];
}>;

export const projectContextResultSchema = z.strictObject({
  basis: z.strictObject({
    fingerprint: z.string().regex(/^sha256:[0-9a-f]{64}$/u),
    publicationCount: z.number().int().positive(),
    publishedAt: z.string().datetime({ offset: true }),
  }),
  summary: z.union([
    z.strictObject({ validity: z.literal("available"), value: projectSummarySchema }),
    z.strictObject({ validity: z.enum(["absent", "invalid"]) }),
  ]),
  brief: z.union([
    z.strictObject({ validity: z.literal("available"), value: projectBriefSchema }),
    z.strictObject({ validity: z.enum(["absent", "invalid"]) }),
  ]),
  sources: z.array(sourceRecordSchema).max(100),
  roadmapFocus: z
    .array(
      z.strictObject({
        roadmap: z.strictObject({
          id: z.string(),
          title: z.string(),
          lifecycle: z.string(),
        }),
        focusedGate: z
          .strictObject({
            id: z.string(),
            title: z.string(),
            lifecycle: z.string(),
            readiness: z.string(),
          })
          .optional(),
      }),
    )
    .max(50),
  scopeOutline: z
    .array(
      z.strictObject({
        effortId: z.string(),
        title: z.string(),
        lifecycle: z.string(),
        targetGateId: z.string(),
        binding: z.union([
          z.strictObject({ state: z.literal("bound"), nativeScope: z.string() }),
          z.strictObject({ state: z.literal("attention"), reason: z.string() }),
        ]),
      }),
    )
    .max(100),
  attentionCount: z.number().int().nonnegative(),
  diagnosticCounts: z.strictObject({
    blocking: z.number().int().nonnegative(),
    nonBlocking: z.number().int().nonnegative(),
  }),
  deeperReads: z.array(planningReferenceSchema),
});

export const projectReadModelObjectSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("project-summary"), value: projectSummarySchema }),
  z.strictObject({ kind: z.literal("project-brief"), value: projectBriefSchema }),
  z.strictObject({ kind: z.literal("roadmap"), value: roadmapSchema }),
  z.strictObject({ kind: z.literal("gate"), value: gateSchema }),
  z.strictObject({ kind: z.literal("effort"), value: effortSchema }),
  z.strictObject({ kind: z.literal("authority"), value: authoritySchema }),
  z.strictObject({ kind: z.literal("asset"), value: assetProjectionSchema }),
  z.strictObject({ kind: z.literal("planning-review"), value: planningReviewSchema }),
]);

export const planningInspectResultSchema = z.strictObject({
  target: projectReadModelObjectSchema,
  directRelations: z.array(planningLineageRelationSchema),
  coverage: z.union([
    z.strictObject({ state: z.literal("unavailable") }),
    z.strictObject({
      state: z.literal("available"),
      parentPath: planningLineageParentPathSchema,
      semanticSections: z.array(planningLineageSemanticSectionSchema),
    }),
  ]),
  diagnostics: z.array(structuralDiagnosticSchema),
  revision: z.strictObject({
    generationFingerprint: z.string().regex(/^sha256:[0-9a-f]{64}$/u),
    source: sourceRecordSchema.optional(),
  }),
});

export type ProjectContextResult = Readonly<z.infer<typeof projectContextResultSchema>>;
export type PlanningInspectResult = Readonly<z.infer<typeof planningInspectResultSchema>>;
export type ProjectInspectResult =
  | ProjectContextResult
  | PlanningInspectResult
  | readonly z.infer<typeof structuralDiagnosticSchema>[]
  | Readonly<{ reason: string }>;
