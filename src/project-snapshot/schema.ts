import { z } from "zod";
import { providerObservationSelectionSchema } from "../provider-observation-contract";
import { mattNativeScopeKey } from "../providers/matt-skills-v1/native-subject";
import { mattSkillsV1ProviderObservationSchema } from "../providers/matt-skills-v1/schema";
import { bearingSourceEventTimeSchema } from "../source-event-time";
import { uniqueIdentityArraySchema } from "./projection-identity";
import { assetProjectionSchema } from "./schema-asset";
import { planningAuditSchema } from "./schema-audit";
import { projectBriefSchema } from "./schema-brief";
import { validateProjectSnapshotConsistency } from "./schema-consistency";
import { nativeScopeInspectionProjectionSchema } from "./schema-native-scope-inspection";
import { citedNodeShape, titledSourceShape } from "./schema-node";
import { planningLineageProjectionSchema } from "./schema-planning-lineage";
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
export { projectBriefSchema } from "./schema-brief";
export { planningLineageProjectionSchema } from "./schema-planning-lineage";
export { diagnosticReferenceSchema } from "./schema-primitives";
export { projectionIssueSchema } from "./schema-projection";
export { projectSummarySchema } from "./schema-summary";
export const PROJECT_SNAPSHOT_VERSION = 15 as const;
const resolutionSchema = z.strictObject({
  acceptedDecision: semanticPlainTextSchema,
  acceptedAt: bearingSourceEventTimeSchema,
  rationale: semanticPlainTextSchema,
  changedReferences: z.array(planningReferenceSchema),
});
export const roadmapSchema = z
  .strictObject({
    id: roadmapIdSchema,
    ...citedNodeShape,
    intent: semanticPlainTextSchema,
    lifecycle: z.enum(["active", "completed", "superseded"]),
    startedAt: bearingSourceEventTimeSchema,
    completedAt: bearingSourceEventTimeSchema.optional(),
    supersededAt: bearingSourceEventTimeSchema.optional(),
    focusedGateId: gateIdSchema.nullable(),
    gateOrder: uniqueIdentityArraySchema(gateIdSchema, (gateId) => gateId),
    horizon: z.enum(["active-horizon", "exhausted", "unknown"]),
    effortIds: uniqueIdentityArraySchema(effortIdSchema, (effortId) => effortId),
  })
  .superRefine((roadmap, context) => {
    if ((roadmap.lifecycle === "completed") !== (roadmap.completedAt !== undefined)) {
      context.addIssue({
        code: "custom",
        path: ["completedAt"],
        message: "Roadmap completion time applicability must match lifecycle.",
      });
    }
    if ((roadmap.lifecycle === "superseded") !== (roadmap.supersededAt !== undefined)) {
      context.addIssue({
        code: "custom",
        path: ["supersededAt"],
        message: "Roadmap supersession time applicability must match lifecycle.",
      });
    }
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
    plannedAt: bearingSourceEventTimeSchema,
    activatedAt: bearingSourceEventTimeSchema.optional(),
    supersededAt: bearingSourceEventTimeSchema.optional(),
    readiness: z.enum(["unknown", "not-ready", "ready-for-review"]),
    horizonState: z.enum(["passed", "focused", "planned", "superseded", "unknown"]),
    effortIds: uniqueIdentityArraySchema(effortIdSchema, (effortId) => effortId),
    passage: z
      .strictObject({
        acceptedDecision: semanticPlainTextSchema,
        acceptedAt: bearingSourceEventTimeSchema,
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
    if (gate.lifecycle === "planned" && gate.activatedAt !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["activatedAt"],
        message: "A planned Gate cannot have an activation event.",
      });
    }
    if (
      (gate.lifecycle === "active" || gate.lifecycle === "passed") &&
      gate.activatedAt === undefined
    ) {
      context.addIssue({
        code: "custom",
        path: ["activatedAt"],
        message: "An active or passed Gate requires its activation event.",
      });
    }
    if ((gate.lifecycle === "superseded") !== (gate.supersededAt !== undefined)) {
      context.addIssue({
        code: "custom",
        path: ["supersededAt"],
        message: "Gate supersession time applicability must match lifecycle.",
      });
    }
  });
const effortConclusionSchema = z
  .strictObject({
    disposition: z.enum(["completed", "withdrawn", "superseded"]),
    rationale: semanticPlainTextSchema,
    concludedAt: bearingSourceEventTimeSchema,
    replacementEffortId: effortIdSchema.optional(),
  })
  .superRefine((conclusion, context) => {
    if (conclusion.disposition === "superseded" && conclusion.replacementEffortId === undefined) {
      context.addIssue({
        code: "custom",
        path: ["replacementEffortId"],
        message: "A superseded Effort conclusion requires its replacement Effort.",
      });
    }
    if (conclusion.disposition !== "superseded" && conclusion.replacementEffortId !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["replacementEffortId"],
        message: "Only a superseded Effort conclusion may name a replacement Effort.",
      });
    }
  });
export const effortSchema = z
  .strictObject({
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
    lifecycle: z.enum(["planned", "active", "concluded"]),
    plannedAt: bearingSourceEventTimeSchema,
    activatedAt: bearingSourceEventTimeSchema.optional(),
    conclusion: effortConclusionSchema.optional(),
  })
  .superRefine((effort, context) => {
    if (effort.lifecycle === "planned") {
      if (effort.activatedAt !== undefined) {
        context.addIssue({
          code: "custom",
          path: ["activatedAt"],
          message: "A planned Effort cannot have an activation event.",
        });
      }
      if (effort.conclusion !== undefined) {
        context.addIssue({
          code: "custom",
          path: ["conclusion"],
          message: "A planned Effort cannot have a conclusion.",
        });
      }
      return;
    }
    if (effort.activatedAt === undefined) {
      context.addIssue({
        code: "custom",
        path: ["activatedAt"],
        message: "An active or concluded Effort requires its activation event.",
      });
    }
    if (effort.lifecycle === "active" && effort.conclusion !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["conclusion"],
        message: "An active Effort cannot have a conclusion.",
      });
    }
    if (effort.lifecycle === "concluded" && effort.conclusion === undefined) {
      context.addIssue({
        code: "custom",
        path: ["conclusion"],
        message: "A concluded Effort requires its explicit conclusion.",
      });
    }
  });
export const authoritySchema = z.strictObject({
  id: authorityIdSchema,
  ...citedNodeShape,
  scope: semanticPlainTextSchema,
  baselineAssetIds: z.array(assetIdSchema),
  adoptions: uniqueIdentityArraySchema(
    z.strictObject({
      assetId: assetIdSchema,
      decisionReference: z.union([checkIdSchema, reviewIdSchema]),
    }),
    (adoption) => adoption.assetId,
  ),
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
    brief: singletonProjectionSchema(projectBriefSchema),
    roadmapIndex: singletonProjectionSchema(roadmapIndexSchema),
    roadmaps: collectionProjectionSchema(roadmapSchema, (roadmap) => roadmap.id),
    gates: collectionProjectionSchema(gateSchema, (gate) => gate.id),
    efforts: collectionProjectionSchema(effortSchema, (effort) => effort.id),
    authorities: collectionProjectionSchema(authoritySchema, (authority) => authority.id),
    assets: collectionProjectionSchema(assetProjectionSchema, (asset) => asset.id),
    checks: collectionProjectionSchema(alignmentCheckSchema, (check) => check.id),
    reviews: collectionProjectionSchema(planningReviewSchema, (review) => review.id),
    lineage: planningLineageProjectionSchema,
    audit: singletonProjectionSchema(planningAuditSchema),
    guidance: singletonProjectionSchema(nextWorkGuidanceSchema),
    providerObservations: uniqueIdentityArraySchema(
      mattSkillsV1ProviderObservationSchema,
      (capture) => mattNativeScopeKey(capture.binding),
    ),
    providerObservationSelections: uniqueIdentityArraySchema(
      providerObservationSelectionSchema,
      mattNativeScopeKey,
    ),
    nativeScopeInspections: nativeScopeInspectionProjectionSchema,
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
