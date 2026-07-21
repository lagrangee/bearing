import type { AdvisoryFreshness } from "../types";
import { classifyGuidanceAuditRelation } from "./advisory-relation";
import { projectAuditFindings } from "./audit-findings";
import { type ParsedCanonicalRecord, parseCanonicalRecord } from "./canonical-record";
import type {
  AlignmentCheck,
  CollectionProjection,
  NextWorkGuidance,
  PlanningAudit,
  PlanningReview,
  ProjectionIssue,
  SingletonProjection,
  SourceRecord,
} from "./contract";
import type { SnapshotSourceInput } from "./projection-input";
import { nextWorkGuidanceSchema, planningAuditSchema } from "./schema";
import { createSourceRecord } from "./source-records";

type Input = Readonly<{
  records: readonly SnapshotSourceInput[];
  sitemapFingerprint: string;
  advisoryFreshness: AdvisoryFreshness;
  checks: CollectionProjection<AlignmentCheck>;
  reviews: CollectionProjection<PlanningReview>;
}>;
type AdvisoryProjection = Readonly<{
  audit: SingletonProjection<PlanningAudit>;
  guidance: SingletonProjection<NextWorkGuidance>;
  sources: readonly SourceRecord[];
}>;

const recordFor = (
  input: Input,
  type: "planning-audit" | "next-work-guidance",
): SnapshotSourceInput | undefined => input.records.find((record) => record.type === type);
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
    checks: input.checks,
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

const guidanceProjection = (
  input: Input,
  audit: SingletonProjection<PlanningAudit>,
): Readonly<{
  projection: SingletonProjection<NextWorkGuidance>;
  sources: readonly SourceRecord[];
}> => {
  const record = recordFor(input, "next-work-guidance");
  if (record === undefined) return { projection: { validity: "absent" }, sources: [] };
  const parsed = parseCanonicalRecord(record);
  if (!parsed.ok) return { projection: invalid(parsed.issue), sources: [parsed.source] };
  if (parsed.value.data.Type !== "next-work-guidance") {
    return {
      projection: invalid(bodyIssue(parsed.value, "invalid-next-work-guidance")),
      sources: [parsed.value.source],
    };
  }
  const body = parsed.value.content;
  if (body.kind !== "next-work-guidance" || !body.result.ok) {
    return {
      projection: invalid(bodyIssue(parsed.value, "invalid-next-work-guidance-body")),
      sources: [parsed.value.source],
    };
  }
  const itemSources = ["primary", "alternative-1", "alternative-2"].map((fragment) =>
    createSourceRecord(input.sitemapFingerprint, {
      kind: "canonical",
      locator: parsed.value.locator,
      fragment,
      binding: {
        role: "guidance-item",
        identity: `${parsed.value.data.ID}#${fragment}`,
      },
    }),
  );
  const primarySource = itemSources[0];
  const firstSource = itemSources[1];
  const secondSource = itemSources[2];
  if (primarySource === undefined || firstSource === undefined || secondSource === undefined) {
    return {
      projection: invalid(bodyIssue(parsed.value, "invalid-next-work-guidance-body")),
      sources: [parsed.value.source],
    };
  }
  const item = (value: (typeof body.result.value.alternatives)[number], source: SourceRecord) => ({
    title: value.title,
    rationale: value.rationale,
    supportingReferences: value.supportingReferences,
    source: source.reference,
  });
  const projected = nextWorkGuidanceSchema.safeParse({
    id: parsed.value.data.ID,
    generatedAt: parsed.value.data["Generated at"],
    semanticFreshness: input.advisoryFreshness[parsed.value.data.ID] ?? "unknown",
    semanticCoverage: parsed.value.data["Semantic coverage"],
    ...(parsed.value.data["Based on audit"] === undefined
      ? {}
      : { basedOnAuditId: parsed.value.data["Based on audit"] }),
    primary: item(body.result.value.primary, primarySource),
    alternatives: [
      item(body.result.value.alternatives[0], firstSource),
      item(body.result.value.alternatives[1], secondSource),
    ],
    source: parsed.value.source.reference,
  });
  if (!projected.success) {
    return {
      projection: invalid(bodyIssue(parsed.value, "invalid-next-work-guidance-projection")),
      sources: [parsed.value.source, ...itemSources],
    };
  }
  const relationProblem = classifyGuidanceAuditRelation(projected.data, audit);
  if (relationProblem === undefined) {
    return {
      projection: { validity: "available", value: projected.data },
      sources: [parsed.value.source, ...itemSources],
    };
  }
  return {
    projection: {
      validity: "partial",
      value: projected.data,
      issues: [
        {
          ...relationProblem,
          target: parsed.value.locator,
          source: parsed.value.source.reference,
        },
      ],
    },
    sources: [parsed.value.source, ...itemSources],
  };
};

export const buildAdvisoryProjection = (input: Input): AdvisoryProjection => {
  const audit = auditProjection(input);
  const guidance = guidanceProjection(input, audit.projection);
  return {
    audit: audit.projection,
    guidance: guidance.projection,
    sources: [...audit.sources, ...guidance.sources],
  };
};
