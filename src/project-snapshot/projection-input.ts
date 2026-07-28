import type { AssetContentObservation } from "../asset-inputs";
import type {
  DecodedBearingRecord,
  DecodedBearingRecordGeneration,
} from "../bearing-record-decoder";
import type { PlanningGraph } from "../planning-graph";
import type { MattSkillsV1ScopeCapture } from "../providers/matt-skills-v1/capture";
import type { AdvisoryFreshness, StructuralDiagnostic } from "../types";

export type ProjectSnapshotBuildInput = Readonly<{
  repoRoot: string;
  packageVersion: string;
  sitemapFingerprint: string;
  diagnostics: readonly StructuralDiagnostic[];
  advisoryFreshness: AdvisoryFreshness;
  decoded: DecodedBearingRecordGeneration;
  providerCaptures: readonly MattSkillsV1ScopeCapture[];
  assetContentObservations: readonly AssetContentObservation[];
  planningGraph: PlanningGraph;
}>;

export type SnapshotSourceInput = DecodedBearingRecord;
