import { z } from "zod";
import { isPlanningAuditCoverageConsistent } from "../audit-coverage";
import { uniqueIdentityArraySchema } from "./projection-identity";
import { titledSourceShape } from "./schema-node";
import {
  auditFindingIdSchema,
  nonEmptyStringSchema,
  planningReferenceSchema,
  reviewIdSchema,
  semanticFreshnessSchema,
  semanticPlainTextSchema,
} from "./schema-primitives";
import { sourceReferenceSchema } from "./source-schema";

const auditPromotionSchema = z.strictObject({
  kind: z.literal("planning-review"),
  id: reviewIdSchema,
});
const affectedReferencesSchema = uniqueIdentityArraySchema(
  planningReferenceSchema,
  (reference) => reference,
).refine((references) => references.length > 0, {
  message: "An Audit finding requires at least one affected reference.",
});
const evidenceReferencesSchema = uniqueIdentityArraySchema(
  sourceReferenceSchema,
  (reference) => reference,
).refine((references) => references.length > 0, {
  message: "An Audit finding requires at least one evidence Source Reference.",
});

export const auditFindingSchema = z.strictObject({
  id: auditFindingIdSchema,
  ...titledSourceShape,
  summary: semanticPlainTextSchema,
  affectedReferences: affectedReferencesSchema,
  evidenceSourceReferences: evidenceReferencesSchema,
  consequence: semanticPlainTextSchema,
  confidenceBoundary: semanticPlainTextSchema,
  promotion: auditPromotionSchema.optional(),
});

export const planningAuditSchema = z
  .strictObject({
    id: z.literal("planning-audit:current"),
    generatedAt: nonEmptyStringSchema,
    semanticFreshness: semanticFreshnessSchema,
    coverage: z.enum(["complete", "incomplete"]),
    skippedTargets: uniqueIdentityArraySchema(planningReferenceSchema, (reference) => reference),
    findings: uniqueIdentityArraySchema(auditFindingSchema, (finding) => finding.id),
    source: sourceReferenceSchema,
  })
  .superRefine((audit, context) => {
    if (isPlanningAuditCoverageConsistent(audit.coverage, audit.skippedTargets)) return;
    context.addIssue({
      code: "custom",
      path: ["skippedTargets"],
      message: "Audit coverage must match its skipped targets.",
    });
  });
