import type { AdvisoryFreshness } from "../types";
import { projectAuditFindings } from "./audit-findings";
import { type ParsedCanonicalRecord, parseCanonicalRecord } from "./canonical-record";
import type {
  CollectionProjection,
  PlanningAudit,
  PlanningReview,
  ProjectionIssue,
  SingletonProjection,
  SourceRecord,
} from "./contract";
import type { SnapshotSourceInput } from "./projection-input";
import { planningAuditSchema } from "./schema";

type Input = Readonly<{
  records: readonly SnapshotSourceInput[];
  sitemapFingerprint: string;
  advisoryFreshness: AdvisoryFreshness;
  reviews: CollectionProjection<PlanningReview>;
}>;
type AdvisoryProjection = Readonly<{
  audit: SingletonProjection<PlanningAudit>;
  sources: readonly SourceRecord[];
}>;

const recordFor = (input: Input, type: "planning-audit"): SnapshotSourceInput | undefined =>
  input.records.find((record) => record.type === type);
const invalid = <T>(issue: ProjectionIssue): SingletonProjection<T> => ({
  validity: "invalid",
  issues: [issue],
});
const bodyIssue = (record: ParsedCanonicalRecord, code: string): ProjectionIssue => ({
  code,
  target: record.locator,
  message: "Advisory body does not match its exact semantic authoring contract.",
  source: record.source.reference,
});

const auditProjection = (
  input: Input,
): Readonly<{
  projection: SingletonProjection<PlanningAudit>;
  sources: readonly SourceRecord[];
}> => {
  const record = recordFor(input, "planning-audit");
  if (record === undefined) return { projection: { validity: "absent" }, sources: [] };
  const parsed = parseCanonicalRecord(record);
  if (!parsed.ok) return { projection: invalid(parsed.issue), sources: [parsed.source] };
  if (parsed.value.data.Type !== "planning-audit") {
    return {
      projection: invalid(bodyIssue(parsed.value, "invalid-planning-audit")),
      sources: [parsed.value.source],
    };
  }
  const body = parsed.value.content;
  if (body.kind !== "planning-audit" || !body.result.ok) {
    return {
      projection: invalid({
        code: "invalid-planning-audit-body",
        target: parsed.value.locator,
        message: "Planning Audit requires the exact Findings body structure.",
        source: parsed.value.source.reference,
      }),
      sources: [parsed.value.source],
    };
  }
  const findingProjection = projectAuditFindings({
    sitemapFingerprint: input.sitemapFingerprint,
    auditLocator: parsed.value.locator,
    auditSource: parsed.value.source.reference,
    findings: body.result.value.findings,
    invalidFindings: body.result.value.invalidFindings,
    reviews: input.reviews,
  });
  const projected = planningAuditSchema.safeParse({
    id: parsed.value.data.ID,
    generatedAt: parsed.value.data["Generated at"],
    semanticFreshness: input.advisoryFreshness[parsed.value.data.ID] ?? "unknown",
    coverage: parsed.value.data.Coverage,
    skippedTargets: parsed.value.data["Skipped targets"],
    findings: findingProjection.findings,
    source: parsed.value.source.reference,
  });
  return {
    projection: projected.success
      ? findingProjection.issues.length === 0
        ? { validity: "available", value: projected.data }
        : { validity: "partial", value: projected.data, issues: findingProjection.issues }
      : invalid(bodyIssue(parsed.value, "invalid-planning-audit-projection")),
    sources: [parsed.value.source, ...findingProjection.sources],
  };
};

export const buildAdvisoryProjection = (input: Input): AdvisoryProjection => {
  const audit = auditProjection(input);
  return {
    audit: audit.projection,
    sources: audit.sources,
  };
};
