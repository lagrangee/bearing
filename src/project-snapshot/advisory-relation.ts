type AuditBasis = Readonly<{
  semanticFreshness: "current" | "stale" | "unknown";
  coverage: "complete" | "incomplete";
}>;

type AuditProjection =
  | Readonly<{ validity: "available" | "partial"; value: AuditBasis }>
  | Readonly<{ validity: "absent" | "invalid" }>;

type GuidanceBasis = Readonly<{
  semanticCoverage: "absent" | "partial" | "complete";
  basedOnAuditId?: "planning-audit:current" | undefined;
}>;

export const GUIDANCE_AUDIT_RELATION_PROBLEMS = {
  unavailable: {
    code: "unavailable-next-work-guidance-audit-basis",
    message: "Next Work Guidance depends on an unavailable Planning Audit.",
  },
  incompatible: {
    code: "incompatible-next-work-guidance-audit-basis",
    message: "Next Work Guidance semantic coverage does not match its Planning Audit basis.",
  },
} as const;

export type GuidanceAuditRelationProblem =
  (typeof GUIDANCE_AUDIT_RELATION_PROBLEMS)[keyof typeof GUIDANCE_AUDIT_RELATION_PROBLEMS];

export const classifyGuidanceAuditRelation = (
  guidance: GuidanceBasis,
  audit: AuditProjection,
): GuidanceAuditRelationProblem | undefined => {
  if (guidance.basedOnAuditId === undefined) return undefined;
  if (!("value" in audit)) {
    return GUIDANCE_AUDIT_RELATION_PROBLEMS.unavailable;
  }
  const expectedCoverage = audit.value.coverage === "complete" ? "complete" : "partial";
  return audit.value.semanticFreshness === "current" &&
    guidance.semanticCoverage === expectedCoverage
    ? undefined
    : GUIDANCE_AUDIT_RELATION_PROBLEMS.incompatible;
};
