import type { AlignmentCheck, AuditFinding, PlanningReview } from "../project-snapshot/contract";
import type { AuditModelData } from "./project-data";

type AuditPromotion = NonNullable<AuditFinding["promotion"]>;

export type AuditDecisionRelation = Readonly<{
  available: boolean;
  id: string;
  kind: AuditPromotion["kind"];
  status: string | undefined;
  title: string | undefined;
}>;

export type ProjectAuditFindingRow = Readonly<{
  finding: AuditFinding;
  promotion: AuditDecisionRelation | undefined;
}>;

type ReadableAudit = Readonly<{
  coverage: "complete" | "incomplete";
  findings: readonly ProjectAuditFindingRow[];
  generatedAt: string;
  semanticFreshness: "current" | "stale" | "unknown";
  skippedTargets: readonly string[];
}>;

export type ProjectAuditModel =
  | Readonly<{ state: "absent" }>
  | Readonly<{ state: "invalid"; issueCount: number }>
  | (ReadableAudit & Readonly<{ state: "available" }>)
  | (ReadableAudit & Readonly<{ state: "partial"; issueCount: number }>);

const trustedItems = <Item>(
  projection:
    | Readonly<{ validity: "available" | "partial"; items: readonly Item[] }>
    | Readonly<{ validity: "invalid" }>,
): readonly Item[] => (projection.validity === "invalid" ? [] : projection.items);

const decisionRelation = (
  promotion: AuditPromotion | undefined,
  checks: ReadonlyMap<string, AlignmentCheck>,
  reviews: ReadonlyMap<string, PlanningReview>,
): AuditDecisionRelation | undefined => {
  if (promotion === undefined) return undefined;
  const decision =
    promotion.kind === "alignment-check" ? checks.get(promotion.id) : reviews.get(promotion.id);
  return {
    available: decision !== undefined,
    id: promotion.id,
    kind: promotion.kind,
    status: decision?.status,
    title: decision?.title,
  };
};

export const buildProjectAuditModel = (snapshot: AuditModelData): ProjectAuditModel => {
  if (snapshot.audit.validity === "absent") return { state: "absent" };
  if (snapshot.audit.validity === "invalid") {
    return { state: "invalid", issueCount: snapshot.audit.issues.length };
  }
  const checks = new Map(trustedItems(snapshot.checks).map((check) => [String(check.id), check]));
  const reviews = new Map(
    trustedItems(snapshot.reviews).map((review) => [String(review.id), review]),
  );
  const audit = snapshot.audit.value;
  const readable = {
    coverage: audit.coverage,
    findings: audit.findings.map((finding) => ({
      finding,
      promotion: decisionRelation(finding.promotion, checks, reviews),
    })),
    generatedAt: audit.generatedAt,
    semanticFreshness: audit.semanticFreshness,
    skippedTargets: audit.skippedTargets,
  };
  return snapshot.audit.validity === "partial"
    ? { ...readable, state: "partial", issueCount: snapshot.audit.issues.length }
    : { ...readable, state: "available" };
};

export const decisionKindLabel = (kind: AuditPromotion["kind"]): string =>
  kind === "alignment-check" ? "Alignment Check" : "Planning Review";
