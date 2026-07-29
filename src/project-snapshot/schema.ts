import { z } from "zod";
import { mattSkillsV1ScopeCaptureSchema } from "../providers/matt-skills-v1/schema";
import { uniqueIdentityArraySchema } from "./projection-identity";
import { assetProjectionSchema } from "./schema-asset";
import { planningAuditSchema } from "./schema-audit";
import { validateProjectSnapshotConsistency } from "./schema-consistency";
import { citedNodeShape, titledSourceShape } from "./schema-node";
import {
  assetIdSchema,
  authorityIdSchema,
  checkIdSchema,
  diagnosticReferenceSchema,
  effortIdSchema,
  fingerprintSchema,
  gateIdSchema,
  nonEmptyStringSchema,
  planningReferenceSchema,
  reviewIdSchema,
  roadmapIdSchema,
  semanticFreshnessSchema,
  semanticPlainTextSchema,
} from "./schema-primitives";
import { collectionProjectionSchema, singletonProjectionSchema } from "./schema-projection";
import { roadmapIndexSchema } from "./schema-roadmap-index";
import { projectSummarySchema } from "./schema-summary";
import { sourceRecordSchema, sourceReferenceSchema } from "./source-schema";

export { assetProjectionSchema } from "./schema-asset";
export { auditFindingSchema, planningAuditSchema } from "./schema-audit";
export { diagnosticReferenceSchema } from "./schema-primitives";
export { projectionIssueSchema } from "./schema-projection";
export { projectSummarySchema } from "./schema-summary";
export const PROJECT_SNAPSHOT_VERSION = 3 as const;
const resolutionSchema = z.strictObject({
  acceptedDecision: semanticPlainTextSchema,
  rationale: semanticPlainTextSchema,
  changedReferences: z.array(planningReferenceSchema),
});
export const roadmapSchema = z.strictObject({
  id: roadmapIdSchema,
  ...citedNodeShape,
  intent: semanticPlainTextSchema,
  lifecycle: z.enum(["active", "completed", "superseded"]),
  focusedGateId: gateIdSchema.nullable(),
  gateOrder: uniqueIdentityArraySchema(gateIdSchema, (gateId) => gateId),
  horizon: z.enum(["active-horizon", "exhausted", "unknown"]),
  effortIds: uniqueIdentityArraySchema(effortIdSchema, (effortId) => effortId),
});
export const gateSchema = z
  .strictObject({
    id: gateIdSchema,
    ...citedNodeShape,
    intent: semanticPlainTextSchema,
    exitCriteria: uniqueIdentityArraySchema(semanticPlainTextSchema, (criterion) => criterion).min(
      1,
    ),
    roadmapId: roadmapIdSchema,
    lifecycle: z.enum(["planned", "active", "passed", "superseded"]),
    readiness: z.enum(["unknown", "not-ready", "ready-for-review"]),
    horizonState: z.enum(["passed", "focused", "planned", "superseded", "unknown"]),
    effortIds: uniqueIdentityArraySchema(effortIdSchema, (effortId) => effortId),
    passage: z
      .strictObject({
        acceptedDecision: semanticPlainTextSchema,
        rationale: semanticPlainTextSchema,
        evidenceAssetIds: uniqueIdentityArraySchema(assetIdSchema, (assetId) => assetId),
        exceptions: uniqueIdentityArraySchema(semanticPlainTextSchema, (exception) => exception),
      })
      .optional(),
  })
  .superRefine((gate, context) => {
    if (gate.lifecycle === "passed" && gate.passage === undefined) {
      context.addIssue({
        code: "custom",
        path: ["passage"],
        message: "A passed Gate requires its accepted Passage record.",
      });
    }
    if (
      (gate.lifecycle === "planned" || gate.lifecycle === "active") &&
      gate.passage !== undefined
    ) {
      context.addIssue({
        code: "custom",
        path: ["passage"],
        message: "A planned or active Gate cannot have a Passage record.",
      });
    }
  });
export const effortSchema = z.strictObject({
  id: effortIdSchema,
  ...citedNodeShape,
  intent: semanticPlainTextSchema,
  roadmapId: roadmapIdSchema,
  targetGateId: gateIdSchema,
  authorityIds: uniqueIdentityArraySchema(authorityIdSchema, (authorityId) => authorityId),
  workBinding: z
    .strictObject({
      provider: z.literal("matt-skills/v1"),
      nativeScope: z.string().min(1),
    })
    .optional(),
  derivedState: z.enum(["active", "resolved", "unknown"]),
});
export const authoritySchema = z.strictObject({
  id: authorityIdSchema,
  ...citedNodeShape,
  scope: semanticPlainTextSchema,
  baselineAssetIds: z.array(assetIdSchema),
});
export const alignmentCheckSchema = z.strictObject({
  id: checkIdSchema,
  ...citedNodeShape,
  status: z.enum(["open", "resolved"]),
  target: planningReferenceSchema,
  resolution: resolutionSchema.optional(),
});
export const planningReviewSchema = z.strictObject({
  id: reviewIdSchema,
  ...citedNodeShape,
  status: z.enum(["pending", "completed"]),
  scope: semanticPlainTextSchema,
  resolution: resolutionSchema.optional(),
});

export const guidanceItemSchema = z.strictObject({
  ...titledSourceShape,
  rationale: semanticPlainTextSchema,
  supportingReferences: z.array(planningReferenceSchema).min(1),
});
export const nextWorkGuidanceSchema = z
  .strictObject({
    id: z.literal("next-work-guidance:current"),
    generatedAt: nonEmptyStringSchema,
    semanticFreshness: semanticFreshnessSchema,
    semanticCoverage: z.enum(["absent", "partial", "complete"]),
    basedOnAuditId: z.literal("planning-audit:current").optional(),
    primary: guidanceItemSchema,
    alternatives: z.array(guidanceItemSchema).max(2),
    source: sourceReferenceSchema,
  })
  .superRefine((guidance, context) => {
    const basedOnAudit = guidance.basedOnAuditId;
    if (guidance.semanticCoverage === "absent" && basedOnAudit !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["basedOnAuditId"],
        message: "Absent semantic coverage cannot reference an Audit.",
      });
    }
    if (guidance.semanticCoverage !== "absent" && basedOnAudit === undefined) {
      context.addIssue({
        code: "custom",
        path: ["basedOnAuditId"],
        message: "Partial or complete semantic coverage requires the current Audit.",
      });
    }
  });
export const structuralDiagnosticSchema = z.strictObject({
  reference: diagnosticReferenceSchema,
  code: nonEmptyStringSchema,
  impact: z.enum(["blocking", "non-blocking"]),
  target: nonEmptyStringSchema,
  message: semanticPlainTextSchema,
  source: sourceReferenceSchema.optional(),
});
type DecisionKind = "alignment-check" | "planning-review";
const decisionAttention = <K extends DecisionKind, I extends z.ZodType>(kind: K, id: I) =>
  z.strictObject({ kind: z.literal(kind), id, ...titledSourceShape });
export const attentionItemSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("structural-diagnostic"),
    diagnosticReference: diagnosticReferenceSchema,
  }),
  decisionAttention("alignment-check", checkIdSchema),
  decisionAttention("planning-review", reviewIdSchema),
]);

export const projectSnapshotSchema = z
  .strictObject({
    schemaVersion: z.literal(PROJECT_SNAPSHOT_VERSION),
    producer: z.strictObject({ packageVersion: nonEmptyStringSchema }),
    basis: z.strictObject({ sitemapVersion: z.literal(1), sitemapFingerprint: fingerprintSchema }),
    summary: singletonProjectionSchema(projectSummarySchema),
    roadmapIndex: singletonProjectionSchema(roadmapIndexSchema),
    roadmaps: collectionProjectionSchema(roadmapSchema, (roadmap) => roadmap.id),
    gates: collectionProjectionSchema(gateSchema, (gate) => gate.id),
    efforts: collectionProjectionSchema(effortSchema, (effort) => effort.id),
    authorities: collectionProjectionSchema(authoritySchema, (authority) => authority.id),
    assets: collectionProjectionSchema(assetProjectionSchema, (asset) => asset.id),
    checks: collectionProjectionSchema(alignmentCheckSchema, (check) => check.id),
    reviews: collectionProjectionSchema(planningReviewSchema, (review) => review.id),
    audit: singletonProjectionSchema(planningAuditSchema),
    guidance: singletonProjectionSchema(nextWorkGuidanceSchema),
    providerCaptures: uniqueIdentityArraySchema(
      mattSkillsV1ScopeCaptureSchema,
      (capture) => `${capture.provider}:${capture.binding.nativeScope}`,
    ),
    diagnostics: uniqueIdentityArraySchema(
      structuralDiagnosticSchema,
      (diagnostic) => diagnostic.reference,
    ),
    attention: uniqueIdentityArraySchema(attentionItemSchema, (item) =>
      "diagnosticReference" in item ? item.diagnosticReference : `${item.kind}:${item.id}`,
    ),
    sources: uniqueIdentityArraySchema(sourceRecordSchema, (source) => source.reference),
  })
  .superRefine(validateProjectSnapshotConsistency);
