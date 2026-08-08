import type { AssetContentObservation } from "../asset-inputs";
import type {
  DecodedBearingRecord,
  DecodedBearingRecordGeneration,
} from "../bearing-record-decoder";
import type { ProjectCompilationProjectionBundle } from "../project-compilation-projection";
import type { ProviderObservationSelection } from "../provider-evidence-selection";
import type { MattSkillsV1ProviderObservation } from "../providers/matt-skills-v1/capture";
import type { AdvisoryFreshness, StructuralDiagnostic } from "../types";

export type ProjectGenerationBuildInput = Readonly<{
  repoRoot: string;
  packageVersion: string;
  basisFingerprint: string;
  diagnostics: readonly StructuralDiagnostic[];
  advisoryFreshness: AdvisoryFreshness;
  decoded: DecodedBearingRecordGeneration;
  providerObservations: readonly MattSkillsV1ProviderObservation[];
  providerObservationSelections?: readonly ProviderObservationSelection[];
  providerDetailEvidenceObservations?: readonly MattSkillsV1ProviderObservation[];
  providerDetailEvidenceSelections?: readonly ProviderObservationSelection[];
  assetContentObservations: readonly AssetContentObservation[];
  projectProjections: ProjectCompilationProjectionBundle;
}>;

export type SnapshotSourceInput = DecodedBearingRecord;
