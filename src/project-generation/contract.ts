import type { z } from "zod";
import type { MattSkillsV1ProviderObservation } from "../providers/matt-skills-v1/capture";
import {
  type assetProjectionSchema,
  type attentionItemSchema,
  type auditFindingSchema,
  type authoritySchema,
  type effortSchema,
  type gateSchema,
  PROJECT_GENERATION_VERSION,
  type planningAuditSchema,
  type planningReviewSchema,
  type projectBriefSchema,
  type projectGenerationSchema,
  type projectionIssueSchema,
  type projectSummarySchema,
  type roadmapSchema,
  type structuralDiagnosticSchema,
} from "./schema";
import type {
  planningLineageProjectionSchema,
  planningLineageRelationSchema,
  planningLineageSubjectProjectionSchema,
} from "./schema-planning-lineage";
import type { providerDetailEvidenceProjectionSchema } from "./schema-provider-detail-selection";
import type { roadmapIndexSchema } from "./schema-roadmap-index";
import type { sourceRecordSchema } from "./source-schema";

type Primitive = string | number | boolean | bigint | symbol | null | undefined;
type DeepReadonly<T> = T extends Primitive
  ? T
  : T extends readonly [unknown, ...unknown[]]
    ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
    : T extends readonly (infer Item)[]
      ? readonly DeepReadonly<Item>[]
      : T extends object
        ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
        : T;

export { PROJECT_GENERATION_VERSION };
export type ProjectGeneration = DeepReadonly<z.infer<typeof projectGenerationSchema>>;
export type ProjectGenerationInput = DeepReadonly<z.input<typeof projectGenerationSchema>>;
export type ProjectionIssue = DeepReadonly<z.infer<typeof projectionIssueSchema>>;
export type ProjectionValidity = "available" | "absent" | "partial" | "invalid";
export type SemanticFreshness = "current" | "stale" | "unknown";
export type SingletonProjection<T> =
  | Readonly<{ validity: "available"; value: T }>
  | Readonly<{ validity: "absent" }>
  | Readonly<{ validity: "partial"; value: T; issues: readonly ProjectionIssue[] }>
  | Readonly<{ validity: "invalid"; issues: readonly ProjectionIssue[] }>;
export type CollectionProjection<T> =
  | Readonly<{ validity: "available"; items: readonly T[] }>
  | Readonly<{
      validity: "partial";
      items: readonly T[];
      issues: readonly ProjectionIssue[];
    }>
  | Readonly<{ validity: "invalid"; issues: readonly ProjectionIssue[] }>;
export type ProjectSummary = DeepReadonly<z.infer<typeof projectSummarySchema>>;
export type ProjectBrief = DeepReadonly<z.infer<typeof projectBriefSchema>>;
export type RoadmapIndex = DeepReadonly<z.infer<typeof roadmapIndexSchema>>;
export type Roadmap = DeepReadonly<z.infer<typeof roadmapSchema>>;
export type MilestoneGate = DeepReadonly<z.infer<typeof gateSchema>>;
export type Effort = DeepReadonly<z.infer<typeof effortSchema>>;
export type Authority = DeepReadonly<z.infer<typeof authoritySchema>>;
export type AssetProjection = DeepReadonly<z.infer<typeof assetProjectionSchema>>;
export type PlanningReview = DeepReadonly<z.infer<typeof planningReviewSchema>>;
export type AuditFinding = DeepReadonly<z.infer<typeof auditFindingSchema>>;
export type PlanningAudit = DeepReadonly<z.infer<typeof planningAuditSchema>>;
export type PlanningLineageProjection = DeepReadonly<
  z.infer<typeof planningLineageProjectionSchema>
>;
export type PlanningLineageRelation = DeepReadonly<z.infer<typeof planningLineageRelationSchema>>;
export type PlanningLineageSubjectProjection = DeepReadonly<
  z.infer<typeof planningLineageSubjectProjectionSchema>
>;
export type ProviderScopeObservation = DeepReadonly<MattSkillsV1ProviderObservation>;
export type ProviderDetailEvidenceProjection = DeepReadonly<
  z.infer<typeof providerDetailEvidenceProjectionSchema>
>;
export type GenerationDiagnostic = DeepReadonly<z.infer<typeof structuralDiagnosticSchema>>;
export type AttentionItem = DeepReadonly<z.infer<typeof attentionItemSchema>>;
export type SourceRecord = DeepReadonly<z.infer<typeof sourceRecordSchema>>;
export type {
  SourceBinding,
  SourceBindingRole,
  SourceKind,
  SourceReference,
  SourceReferenceSeed,
} from "./source-schema";
