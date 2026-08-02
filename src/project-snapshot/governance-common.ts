import type { BearingArtifact, DecodedBearingRecordContent } from "../bearing-record-decoder";
import type { StructuralDiagnostic } from "../types";
import { type ParsedCanonicalRecord, parseCanonicalRecord } from "./canonical-record";
import type { CollectionProjection, ProjectionIssue, SourceRecord } from "./contract";
import type { SnapshotSourceInput } from "./projection-input";

export type GovernanceInput = Readonly<{
  records: readonly SnapshotSourceInput[];
  sitemapFingerprint: string;
  diagnostics: readonly StructuralDiagnostic[];
}>;
export type GovernanceType = "roadmap" | "milestone-gate" | "effort" | "authority";
export type BuildResult<T> = Readonly<{
  item?: T;
  issue?: ProjectionIssue;
  source: SourceRecord;
}>;
type ProjectOrientationRecordType = "project-summary" | "project-brief";
type ParsedProjectOrientationRecord<T extends ProjectOrientationRecordType> =
  ParsedCanonicalRecord &
    Readonly<{
      data: Extract<BearingArtifact, { Type: T }>;
      content: Extract<DecodedBearingRecordContent, { kind: "sections" }>;
    }>;
export type ProjectOrientationRecordResult<T extends ProjectOrientationRecordType> =
  | Readonly<{ validity: "absent" }>
  | Readonly<{ validity: "invalid"; issues: readonly ProjectionIssue[] }>
  | Readonly<{ validity: "available"; record: ParsedProjectOrientationRecord<T> }>;

export const compareUtf8 = (left: string, right: string): number =>
  Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
export const citations = (data: {
  Citations?: readonly { Asset: string; Note: string }[] | undefined;
}) => (data.Citations ?? []).map((citation) => ({ assetId: citation.Asset, note: citation.Note }));
export const bodyIssue = (record: ParsedCanonicalRecord, code: string): ProjectionIssue => ({
  code,
  target: record.locator,
  message: "Bearing source body does not match its exact semantic section contract.",
  source: record.source.reference,
});
export const projectOrientationRecord = <T extends ProjectOrientationRecordType>(
  input: GovernanceInput,
  type: T,
): ProjectOrientationRecordResult<T> => {
  const source = input.records.find((candidate) => candidate.type === type);
  if (source === undefined) return { validity: "absent" };
  const parsed = parseCanonicalRecord(source);
  if (!parsed.ok) return { validity: "invalid", issues: [parsed.issue] };
  if (parsed.value.data.Type !== type) {
    return { validity: "invalid", issues: [bodyIssue(parsed.value, `invalid-${type}`)] };
  }
  if (parsed.value.content.kind !== "sections") {
    return { validity: "invalid", issues: [bodyIssue(parsed.value, `invalid-${type}-body`)] };
  }
  return {
    validity: "available",
    record: parsed.value as ParsedProjectOrientationRecord<T>,
  };
};
export const collection = <T>(results: readonly BuildResult<T>[]): CollectionProjection<T> => {
  const items = results.flatMap((result) => (result.item === undefined ? [] : [result.item]));
  const issues = results.flatMap((result) => (result.issue === undefined ? [] : [result.issue]));
  if (issues.length === 0) return { validity: "available", items };
  return items.length === 0
    ? { validity: "invalid", issues }
    : { validity: "partial", items, issues };
};
export const parsedFor = (
  input: GovernanceInput,
  type: GovernanceType,
): BuildResult<ParsedCanonicalRecord>[] =>
  input.records
    .filter((record) => record.type === type)
    .map((record) => {
      const parsed = parseCanonicalRecord(record);
      if (!parsed.ok) return { issue: parsed.issue, source: parsed.source };
      const diagnostic = input.diagnostics.find(
        (candidate) =>
          candidate.impact === "blocking" &&
          candidate.target === record.locator &&
          candidate.code !== "duplicate-stable-id",
      );
      return diagnostic === undefined
        ? { item: parsed.value, source: parsed.value.source }
        : {
            issue: {
              code: diagnostic.code,
              target: record.locator,
              message: "Bearing source has a blocking structural diagnostic.",
              source: parsed.value.source.reference,
            },
            source: parsed.value.source,
          };
    });
export const failedResult = <T>(result: BuildResult<ParsedCanonicalRecord>): BuildResult<T> => ({
  source: result.source,
  ...(result.issue === undefined ? {} : { issue: result.issue }),
});
export const exactProse = (
  record: ParsedCanonicalRecord,
  _required: readonly string[],
  section: string,
): string | undefined => {
  return record.content.kind === "sections" && typeof record.content.values[section] === "string"
    ? record.content.values[section]
    : undefined;
};
export const exactList = (
  record: ParsedCanonicalRecord,
  _required: readonly string[],
  section: string,
): readonly string[] | undefined => {
  const value = record.content.kind === "sections" ? record.content.values[section] : undefined;
  return Array.isArray(value) ? value : undefined;
};
export const governanceSources = (input: GovernanceInput): readonly SourceRecord[] =>
  input.records.flatMap((record) => {
    const type = record.type;
    return type === "project-summary" ||
      type === "project-brief" ||
      type === "roadmap-index" ||
      type === "roadmap" ||
      type === "milestone-gate" ||
      type === "effort" ||
      type === "authority"
      ? [parseCanonicalRecord(record)].map((parsed) =>
          parsed.ok ? parsed.value.source : parsed.source,
        )
      : [];
  });
