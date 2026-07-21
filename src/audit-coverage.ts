export type PlanningAuditCoverage = "complete" | "incomplete";

export const isPlanningAuditCoverageConsistent = (
  coverage: PlanningAuditCoverage,
  skippedTargets: readonly string[],
): boolean => (coverage === "complete" ? skippedTargets.length === 0 : skippedTargets.length > 0);
