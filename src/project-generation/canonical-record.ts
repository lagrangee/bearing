import type { z } from "zod";
import type { DecodedBearingRecord } from "../bearing-record-decoder";
import type { bearingSchema } from "../schema-definitions";
import type { ProjectionIssue, SourceRecord } from "./contract";

export type BearingArtifact = z.infer<typeof bearingSchema>;
export type ParsedCanonicalRecord = DecodedBearingRecord &
  Readonly<{
    trust: "available" | "partial";
    data: BearingArtifact;
  }>;
export type CanonicalRecordResult =
  | Readonly<{ ok: true; value: ParsedCanonicalRecord }>
  | Readonly<{ ok: false; issue: ProjectionIssue; source: SourceRecord }>;

export const parseCanonicalRecord = (record: DecodedBearingRecord): CanonicalRecordResult => {
  if (record.trust !== "invalid" && record.data !== undefined) {
    return { ok: true, value: record as ParsedCanonicalRecord };
  }
  const diagnostic = record.diagnostics.find((candidate) => candidate.impact === "blocking");
  return {
    ok: false,
    source: record.source,
    issue: {
      code: diagnostic?.code ?? "invalid-bearing-record",
      target: record.locator,
      message: diagnostic?.message ?? "Bearing Record is unavailable to the normalized projection.",
      source: record.source.reference,
    },
  };
};
