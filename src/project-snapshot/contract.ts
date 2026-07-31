import type { z } from "zod";
import type { MattSkillsV1ProviderObservation } from "../providers/matt-skills-v1/capture";
import {
  type alignmentCheckSchema,
  type assetProjectionSchema,
  type attentionItemSchema,
  type auditFindingSchema,
  type authoritySchema,
  type effortSchema,
  type gateSchema,
  type guidanceItemSchema,
  type nextWorkGuidanceSchema,
  PROJECT_SNAPSHOT_VERSION,
  type planningAuditSchema,
  type planningReviewSchema,
  type projectionIssueSchema,
  type projectSnapshotSchema,
  type projectSummarySchema,
  type roadmapSchema,
  type structuralDiagnosticSchema,
} from "./schema";
import type { nativeScopeDiscoveryProjectionSchema } from "./schema-native-scope-discovery";
import type {
  planningLineageProjectionSchema,
  planningLineageRelationSchema,
  planningLineageSubjectProjectionSchema,
} from "./schema-planning-lineage";
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

export { PROJECT_SNAPSHOT_VERSION };
export type ProjectSnapshot = DeepReadonly<z.infer<typeof projectSnapshotSchema>>;
export type ProjectSnapshotInput = DeepReadonly<z.input<typeof projectSnapshotSchema>>;
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
export type RoadmapIndex = DeepReadonly<z.infer<typeof roadmapIndexSchema>>;
export type Roadmap = DeepReadonly<z.infer<typeof roadmapSchema>>;
export type MilestoneGate = DeepReadonly<z.infer<typeof gateSchema>>;
export type Effort = DeepReadonly<z.infer<typeof effortSchema>>;
export type Authority = DeepReadonly<z.infer<typeof authoritySchema>>;
export type AssetProjection = DeepReadonly<z.infer<typeof assetProjectionSchema>>;
export type AlignmentCheck = DeepReadonly<z.infer<typeof alignmentCheckSchema>>;
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
export type GuidanceItem = DeepReadonly<z.infer<typeof guidanceItemSchema>>;
export type NextWorkGuidance = DeepReadonly<z.infer<typeof nextWorkGuidanceSchema>>;
export type ProviderScopeObservation = DeepReadonly<MattSkillsV1ProviderObservation>;
export type NativeScopeDiscoveryProjection = DeepReadonly<
  z.infer<typeof nativeScopeDiscoveryProjectionSchema>
>;
export type SnapshotDiagnostic = DeepReadonly<z.infer<typeof structuralDiagnosticSchema>>;
export type AttentionItem = DeepReadonly<z.infer<typeof attentionItemSchema>>;
export type SourceRecord = DeepReadonly<z.infer<typeof sourceRecordSchema>>;
export type {
  SourceBinding,
  SourceBindingRole,
  SourceKind,
  SourceReference,
  SourceReferenceSeed,
} from "./source-schema";
