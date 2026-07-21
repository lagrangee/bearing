import type { AuditBodyFinding, InvalidAuditFinding } from "../audit-body";
import { sha256Hex } from "../sha256";
import type {
  AlignmentCheck,
  CollectionProjection,
  PlanningReview,
  ProjectionIssue,
  SourceRecord,
  SourceReference,
} from "./contract";
import { auditFindingIdSchema } from "./schema-primitives";
import { createSourceRecord, mergeSourceRecords } from "./source-records";

export const INVALID_AUDIT_FINDING_CODE = "invalid-planning-audit-finding";
export const UNAVAILABLE_AUDIT_PROMOTION_CODE = "unavailable-audit-promotion";
export const UNAVAILABLE_AUDIT_PROMOTION_MESSAGE =
  "Planning Audit promotion target is unavailable.";

export const invalidAuditFindingMessage = (ordinal: number): string =>
  `Planning Audit finding ${ordinal} does not match the exact finding structure.`;

export const createAuditFindingId = (
  sitemapFingerprint: string,
  auditLocator: string,
  fragment: string,
) =>
  auditFindingIdSchema.parse(
    `audit-finding:${sha256Hex(JSON.stringify([sitemapFingerprint, auditLocator, fragment]))}`,
  );

type Decisions = Readonly<{
  checks: CollectionProjection<AlignmentCheck>;
  reviews: CollectionProjection<PlanningReview>;
}>;
type ProjectedFinding = Readonly<{
  id: ReturnType<typeof createAuditFindingId>;
  title: string;
  source: SourceReference;
  summary: string;
  affectedReferences: readonly string[];
  evidenceSourceReferences: readonly SourceReference[];
  consequence: string;
  confidenceBoundary: string;
  promotion?:
    | Readonly<{ kind: "alignment-check"; id: string }>
    | Readonly<{ kind: "planning-review"; id: string }>;
}>;
type Input = Decisions &
  Readonly<{
    sitemapFingerprint: string;
    auditLocator: string;
    auditSource: SourceReference;
    findings: readonly AuditBodyFinding[];
    invalidFindings: readonly InvalidAuditFinding[];
  }>;

const promotionAvailable = (finding: AuditBodyFinding, decisions: Decisions): boolean => {
  if (finding.promotion === undefined) return true;
  if (finding.promotion.kind === "alignment-check") {
    return (
      decisions.checks.validity !== "invalid" &&
      decisions.checks.items.some((decision) => decision.id === finding.promotion?.target)
    );
  }
  return (
    decisions.reviews.validity !== "invalid" &&
    decisions.reviews.items.some((decision) => decision.id === finding.promotion?.target)
  );
};

const invalidFindingIssue = (
  locator: string,
  source: SourceReference,
  finding: InvalidAuditFinding,
): ProjectionIssue => ({
  code: INVALID_AUDIT_FINDING_CODE,
  target: `${locator}#${finding.fragment}`,
  message: invalidAuditFindingMessage(finding.ordinal),
  source,
});

export const projectAuditFindings = (
  input: Input,
): Readonly<{
  findings: readonly ProjectedFinding[];
  issues: readonly ProjectionIssue[];
  sources: readonly SourceRecord[];
}> => {
  const sources: SourceRecord[] = [];
  const issues = input.invalidFindings.map((finding) =>
    invalidFindingIssue(input.auditLocator, input.auditSource, finding),
  );
  const findings = input.findings.map((finding): ProjectedFinding => {
    const id = createAuditFindingId(input.sitemapFingerprint, input.auditLocator, finding.fragment);
    const findingSource = createSourceRecord(input.sitemapFingerprint, {
      kind: "canonical",
      locator: input.auditLocator,
      fragment: finding.fragment,
      binding: { role: "audit-finding", identity: id },
    });
    const evidenceSources = finding.evidenceSources.map((locator) =>
      createSourceRecord(input.sitemapFingerprint, { kind: "evidence", locator }),
    );
    sources.push(findingSource, ...evidenceSources);
    if (!promotionAvailable(finding, input)) {
      issues.push({
        code: UNAVAILABLE_AUDIT_PROMOTION_CODE,
        target: `${input.auditLocator}#${finding.fragment}`,
        message: UNAVAILABLE_AUDIT_PROMOTION_MESSAGE,
        source: findingSource.reference,
      });
    }
    return {
      id,
      title: finding.title,
      source: findingSource.reference,
      summary: finding.summary,
      affectedReferences: finding.affectedReferences,
      evidenceSourceReferences: evidenceSources.map((source) => source.reference),
      consequence: finding.consequence,
      confidenceBoundary: finding.confidenceBoundary,
      ...(finding.promotion === undefined
        ? {}
        : { promotion: { kind: finding.promotion.kind, id: finding.promotion.target } }),
    };
  });
  return { findings, issues, sources: mergeSourceRecords([sources]) };
};
