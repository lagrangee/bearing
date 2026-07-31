import type { AssetContentObservation } from "../asset-inputs";
import type {
  DecodedBearingRecord,
  DecodedBearingRecordGeneration,
} from "../bearing-record-decoder";
import type { NativeScopeDiscoveryView } from "../native-scope-discovery";
import type { PlanningGraph } from "../planning-graph";
import type { ProviderObservationSelection } from "../provider-observation-store";
import type { MattSkillsV1ProviderObservation } from "../providers/matt-skills-v1/capture";
import type { AdvisoryFreshness, StructuralDiagnostic } from "../types";

export type ProjectSnapshotBuildInput = Readonly<{
  repoRoot: string;
  packageVersion: string;
  sitemapFingerprint: string;
  diagnostics: readonly StructuralDiagnostic[];
  advisoryFreshness: AdvisoryFreshness;
  decoded: DecodedBearingRecordGeneration;
  providerObservations: readonly MattSkillsV1ProviderObservation[];
  providerObservationSelections?: readonly ProviderObservationSelection[];
  nativeScopeDiscovery?: NativeScopeDiscoveryView;
  assetContentObservations: readonly AssetContentObservation[];
  planningGraph: PlanningGraph;
}>;

export type SnapshotSourceInput = DecodedBearingRecord;
