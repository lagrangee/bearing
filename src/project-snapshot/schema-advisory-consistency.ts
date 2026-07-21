import type { RefinementCtx } from "zod";
import {
  classifyGuidanceAuditRelation,
  GUIDANCE_AUDIT_RELATION_PROBLEMS,
} from "./advisory-relation";

type ProjectionIssue = Readonly<{
  code: string;
  target: string;
  message: string;
  source?: string | undefined;
}>;

type Singleton<T> =
  | Readonly<{ validity: "available"; value: T }>
  | Readonly<{ validity: "partial"; value: T; issues: readonly ProjectionIssue[] }>
  | Readonly<{ validity: "absent" | "invalid" }>;

type AuditBasis = Readonly<{
  semanticFreshness: "current" | "stale" | "unknown";
  coverage: "complete" | "incomplete";
}>;

type GuidanceBasis = Readonly<{
  semanticCoverage: "absent" | "partial" | "complete";
  basedOnAuditId?: "planning-audit:current" | undefined;
  source: string;
}>;

type AdvisorySnapshot = Readonly<{
  audit: Singleton<AuditBasis>;
  guidance: Singleton<GuidanceBasis>;
  sources: readonly Readonly<{ reference: string; displayLocator: string }>[];
}>;

export const validateAdvisoryConsistency = (
  snapshot: AdvisorySnapshot,
  context: RefinementCtx,
): void => {
  const guidanceProjection = snapshot.guidance;
  if (guidanceProjection.validity !== "available" && guidanceProjection.validity !== "partial") {
    return;
  }
  const guidance = guidanceProjection.value;
  const problem = classifyGuidanceAuditRelation(guidance, snapshot.audit);
  if (guidanceProjection.validity === "available") {
    if (problem !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["guidance"],
        message: "Available Guidance requires a current compatible Audit basis.",
      });
    }
    return;
  }
  const relationCodes = new Set<string>(
    Object.values(GUIDANCE_AUDIT_RELATION_PROBLEMS).map((candidate) => candidate.code),
  );
  if (problem === undefined) {
    if (guidanceProjection.issues.some((candidate) => relationCodes.has(candidate.code))) {
      context.addIssue({
        code: "custom",
        path: ["guidance", "issues"],
        message: "Guidance cannot retain an advisory relation issue after its basis is compatible.",
      });
    }
    return;
  }
  const locator = snapshot.sources.find(
    (record) => record.reference === guidance.source,
  )?.displayLocator;
  const hasExactIssue = guidanceProjection.issues.some(
    (candidate) =>
      candidate.code === problem.code &&
      candidate.message === problem.message &&
      candidate.source === guidance.source &&
      candidate.target === locator,
  );
  if (!hasExactIssue) {
    context.addIssue({
      code: "custom",
      path: ["guidance", "issues"],
      message: "Partial Guidance must retain its exact Audit relation issue.",
    });
  }
};
