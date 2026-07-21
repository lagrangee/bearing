import type { AssetContentObservation } from "../asset-inputs";
import type {
  DecodedBearingRecord,
  DecodedBearingRecordGeneration,
} from "../bearing-record-decoder";
import type { NativeSourceRecord } from "../native-work";
import type { PlanningGraph } from "../planning-graph";
import type { AdvisoryFreshness, StructuralDiagnostic } from "../types";

export type ProjectSnapshotBuildInput = Readonly<{
  repoRoot: string;
  packageVersion: string;
  sitemapFingerprint: string;
  diagnostics: readonly StructuralDiagnostic[];
  advisoryFreshness: AdvisoryFreshness;
  decoded: DecodedBearingRecordGeneration;
  nativeRecords: readonly NativeSourceRecord[];
  assetContentObservations: readonly AssetContentObservation[];
  planningGraph: PlanningGraph;
}>;

export type SnapshotSourceInput = DecodedBearingRecord;
