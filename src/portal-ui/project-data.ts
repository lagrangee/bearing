import type { z } from "zod";
import type {
  AssetProjection,
  AttentionItem,
  Authority,
  CollectionProjection,
  Effort,
  GenerationDiagnostic,
  MilestoneGate,
  PlanningAudit,
  PlanningLineageProjection,
  PlanningReview,
  ProjectBrief,
  ProjectSummary,
  Roadmap,
  RoadmapIndex,
  SingletonProjection,
  SourceRecord,
} from "../project-generation/contract";
import type { providerObservationSelectionSchema } from "../provider-evidence-contract";
import type { mattSkillsV1ProviderObservationSchema } from "../providers/matt-skills-v1/schema";

type DeepReadonly<Value> = Value extends
  | string
  | number
  | boolean
  | bigint
  | symbol
  | null
  | undefined
  ? Value
  : Value extends readonly unknown[]
    ? { readonly [Key in keyof Value]: DeepReadonly<Value[Key]> }
    : Value extends object
      ? { readonly [Key in keyof Value]: DeepReadonly<Value[Key]> }
      : Value;

type ProviderObservation = DeepReadonly<z.infer<typeof mattSkillsV1ProviderObservationSchema>>;
type ProviderSelection = DeepReadonly<z.infer<typeof providerObservationSelectionSchema>>;

type ProjectContext = Readonly<{
  summary: SingletonProjection<ProjectSummary>;
  attentionCount?: number | undefined;
}>;

export type OverviewModelData = ProjectContext &
  Readonly<{
    attention: readonly AttentionItem[];
    brief: SingletonProjection<ProjectBrief>;
    roadmapIndex: SingletonProjection<RoadmapIndex>;
    roadmaps: CollectionProjection<Roadmap>;
    gates: CollectionProjection<MilestoneGate>;
    efforts: CollectionProjection<Effort>;
    reviews: CollectionProjection<PlanningReview>;
    diagnostics: readonly GenerationDiagnostic[];
    sources: readonly SourceRecord[];
  }>;
export type OverviewProjectData = OverviewModelData &
  Readonly<{ section: "overview"; attentionCount: number }>;

export type RoadmapsModelData = ProjectContext &
  Readonly<{
    roadmapIndex: SingletonProjection<RoadmapIndex>;
    roadmaps: CollectionProjection<Roadmap>;
    gates: CollectionProjection<MilestoneGate>;
    sources: readonly SourceRecord[];
  }>;
export type RoadmapsProjectData = RoadmapsModelData &
  Readonly<{ section: "roadmaps"; attentionCount: number }>;

export type AssetsModelData = ProjectContext &
  Readonly<{
    roadmaps: CollectionProjection<Roadmap>;
    gates: CollectionProjection<MilestoneGate>;
    efforts: CollectionProjection<Effort>;
    authorities: CollectionProjection<Authority>;
    assets: CollectionProjection<AssetProjection>;
    reviews: CollectionProjection<PlanningReview>;
    referenceTitles?: readonly Readonly<{ reference: string; title: string }>[] | undefined;
    sources: readonly SourceRecord[];
  }>;
export type AssetsProjectData = AssetsModelData &
  Readonly<{ section: "assets"; attentionCount: number }>;

export type AuditModelData = ProjectContext &
  Readonly<{
    audit: SingletonProjection<PlanningAudit>;
    reviews: CollectionProjection<PlanningReview>;
  }>;
export type AuditProjectData = AuditModelData &
  Readonly<{ section: "audit"; attentionCount: number }>;

export type LineageModelData = ProjectContext &
  Readonly<{
    roadmaps: CollectionProjection<Roadmap>;
    gates: CollectionProjection<MilestoneGate>;
    efforts: CollectionProjection<Effort>;
    authorities: CollectionProjection<Authority>;
    assets: CollectionProjection<AssetProjection>;
    reviews: CollectionProjection<PlanningReview>;
    lineage: PlanningLineageProjection;
    providerObservations: readonly ProviderObservation[];
    providerObservationSelections: readonly ProviderSelection[];
    providerDetailEvidences: Readonly<{
      observations: readonly ProviderObservation[];
      selections: readonly ProviderSelection[];
    }>;
    referenceTitles?: readonly Readonly<{ reference: string; title: string }>[] | undefined;
    diagnostics: readonly GenerationDiagnostic[];
    sources: readonly SourceRecord[];
    nativeTargetState?: "covered-missing" | "unavailable" | undefined;
    assetSourceProbe?:
      | Readonly<{ kind: "external"; href: string; verification: "unverified" }>
      | Readonly<{
          kind: "local";
          locator: string;
          availability: "file" | "directory" | "missing" | "unreadable" | "unsafe";
        }>
      | undefined;
  }>;

export type LineageProjectData = LineageModelData &
  Readonly<{
    section: "lineage";
    attentionCount: number;
    target?: Readonly<{ kind: string; id: string }> | undefined;
  }>;

export type ProjectData =
  | OverviewProjectData
  | RoadmapsProjectData
  | AssetsProjectData
  | AuditProjectData
  | LineageProjectData;
