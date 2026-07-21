import { type ParsedCanonicalRecord, parseCanonicalRecord } from "./canonical-record";
import type {
  AlignmentCheck,
  AttentionItem,
  CollectionProjection,
  PlanningReview,
  ProjectionIssue,
  SourceRecord,
} from "./contract";
import { isolateDuplicateIdentities } from "./projection-identity";
import type { SnapshotSourceInput } from "./projection-input";
import { alignmentCheckSchema, attentionItemSchema, planningReviewSchema } from "./schema";

type Input = Readonly<{
  records: readonly SnapshotSourceInput[];
  sitemapFingerprint: string;
}>;
type Result<T> = Readonly<{ item?: T; issue?: ProjectionIssue; source: SourceRecord }>;
type DecisionProjection = Readonly<{
  checks: CollectionProjection<AlignmentCheck>;
  reviews: CollectionProjection<PlanningReview>;
  attention: readonly AttentionItem[];
  sources: readonly SourceRecord[];
}>;

const compareUtf8 = (left: string, right: string): number =>
  Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
const citations = (data: { Citations?: readonly { Asset: string; Note: string }[] | undefined }) =>
  (data.Citations ?? []).map((citation) => ({ assetId: citation.Asset, note: citation.Note }));
const resolution = (
  value:
    | Readonly<{
        "Accepted decision": string;
        Rationale: string;
        "Changed references": readonly string[];
      }>
    | undefined,
) =>
  value === undefined
    ? {}
    : {
        resolution: {
          acceptedDecision: value["Accepted decision"],
          rationale: value.Rationale,
          changedReferences: value["Changed references"],
        },
      };
const collection = <T>(results: readonly Result<T>[]): CollectionProjection<T> => {
  const items = results.flatMap((result) => (result.item === undefined ? [] : [result.item]));
  const issues = results.flatMap((result) => (result.issue === undefined ? [] : [result.issue]));
  if (issues.length === 0) return { validity: "available", items };
  return items.length === 0
    ? { validity: "invalid", issues }
    : { validity: "partial", items, issues };
};
const parse = (
  input: Input,
  type: "alignment-check" | "planning-review",
): Result<ParsedCanonicalRecord>[] =>
  input.records
    .filter((record) => record.type === type)
    .map((record) => {
      const parsed = parseCanonicalRecord(record);
      return parsed.ok
        ? { item: parsed.value, source: parsed.value.source }
        : { issue: parsed.issue, source: parsed.source };
    });
const failedResult = <T>(result: Result<ParsedCanonicalRecord>): Result<T> => ({
  source: result.source,
  ...(result.issue === undefined ? {} : { issue: result.issue }),
});

const checks = (input: Input): Result<AlignmentCheck>[] =>
  parse(input, "alignment-check")
    .map((result): Result<AlignmentCheck> => {
      const record = result.item;
      if (record === undefined || record.data.Type !== "alignment-check") {
        return failedResult(result);
      }
      const projected = alignmentCheckSchema.safeParse({
        id: record.data.ID,
        title: record.data.Title,
        source: record.source.reference,
        citations: citations(record.data),
        status: record.data.Status,
        target: record.data.Target,
        ...resolution(record.data.Resolution),
      });
      return projected.success
        ? { source: record.source, item: projected.data }
        : {
            source: record.source,
            issue: {
              code: "invalid-alignment-check-projection",
              target: record.locator,
              message: "Alignment Check cannot be normalized.",
              source: record.source.reference,
            },
          };
    })
    .sort((left, right) => compareUtf8(left.item?.id ?? "", right.item?.id ?? ""));
const reviews = (input: Input): Result<PlanningReview>[] =>
  parse(input, "planning-review")
    .map((result): Result<PlanningReview> => {
      const record = result.item;
      if (record === undefined || record.data.Type !== "planning-review") {
        return failedResult(result);
      }
      const projected = planningReviewSchema.safeParse({
        id: record.data.ID,
        title: record.data.Title,
        source: record.source.reference,
        citations: citations(record.data),
        status: record.data.Status,
        scope: record.data.Scope,
        ...resolution(record.data.Resolution),
      });
      return projected.success
        ? { source: record.source, item: projected.data }
        : {
            source: record.source,
            issue: {
              code: "invalid-planning-review-projection",
              target: record.locator,
              message: "Planning Review cannot be normalized.",
              source: record.source.reference,
            },
          };
    })
    .sort((left, right) => compareUtf8(left.item?.id ?? "", right.item?.id ?? ""));

export const buildDecisionProjection = (input: Input): DecisionProjection => {
  const checkResults = isolateDuplicateIdentities(checks(input), (check) => check.id);
  const reviewResults = isolateDuplicateIdentities(reviews(input), (review) => review.id);
  const attention: AttentionItem[] = [];
  for (const result of checkResults) {
    if (result.item?.status === "open") {
      attention.push(
        attentionItemSchema.parse({
          kind: "alignment-check",
          id: result.item.id,
          title: result.item.title,
          source: result.item.source,
        }),
      );
    }
  }
  for (const result of reviewResults) {
    if (result.item?.status === "pending") {
      attention.push(
        attentionItemSchema.parse({
          kind: "planning-review",
          id: result.item.id,
          title: result.item.title,
          source: result.item.source,
        }),
      );
    }
  }
  return {
    checks: collection(checkResults),
    reviews: collection(reviewResults),
    attention,
    sources: [...checkResults, ...reviewResults].map((result) => result.source),
  };
};
