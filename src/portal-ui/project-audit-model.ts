import type { AuditFinding, PlanningReview } from "../project-snapshot/contract";
import type { AuditModelData } from "./project-data";

type AuditPromotion = NonNullable<AuditFinding["promotion"]>;

export type AuditDecisionRelation = Readonly<{
  available: boolean;
  id: string;
  kind: "planning-review";
  status: "pending" | "completed" | undefined;
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

type CurrentAudit =
  | Readonly<{ state: "absent" }>
  | Readonly<{ state: "invalid"; issueCount: number }>
  | (ReadableAudit & Readonly<{ state: "available" }>)
  | (ReadableAudit & Readonly<{ state: "partial"; issueCount: number }>);

export type ProjectAuditModel = Readonly<{
  current: CurrentAudit;
  pendingReviews: readonly PlanningReview[];
  completedReviews: readonly PlanningReview[];
}>;

const trustedItems = <Item>(
  projection:
    | Readonly<{ validity: "available" | "partial"; items: readonly Item[] }>
    | Readonly<{ validity: "invalid" }>,
): readonly Item[] => (projection.validity === "invalid" ? [] : projection.items);

const decisionRelation = (
  promotion: AuditPromotion | undefined,
  reviews: ReadonlyMap<string, PlanningReview>,
): AuditDecisionRelation | undefined => {
  if (promotion === undefined) return undefined;
  const decision = reviews.get(promotion.id);
  return {
    available: decision !== undefined,
    id: promotion.id,
    kind: "planning-review",
    status: decision?.status,
    title: decision?.title,
  };
};

export const buildProjectAuditModel = (snapshot: AuditModelData): ProjectAuditModel => {
  const reviewItems = trustedItems(snapshot.reviews);
  const reviews = new Map(reviewItems.map((review) => [String(review.id), review]));
  const pendingReviews = reviewItems.filter((review) => review.status === "pending");
  const completedReviews = reviewItems.filter((review) => review.status === "completed");
  if (snapshot.audit.validity === "absent") {
    return { current: { state: "absent" }, pendingReviews, completedReviews };
  }
  if (snapshot.audit.validity === "invalid") {
    return {
      current: { state: "invalid", issueCount: snapshot.audit.issues.length },
      pendingReviews,
      completedReviews,
    };
  }
  const audit = snapshot.audit.value;
  const readable = {
    coverage: audit.coverage,
    findings: audit.findings.map((finding) => ({
      finding,
      promotion: decisionRelation(finding.promotion, reviews),
    })),
    generatedAt: audit.generatedAt,
    semanticFreshness: audit.semanticFreshness,
    skippedTargets: audit.skippedTargets,
  };
  const current =
    snapshot.audit.validity === "partial"
      ? { ...readable, state: "partial" as const, issueCount: snapshot.audit.issues.length }
      : { ...readable, state: "available" as const };
  return { current, pendingReviews, completedReviews };
};
