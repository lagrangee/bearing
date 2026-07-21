import type { RefinementCtx } from "zod";
import {
  createAuditFindingId,
  INVALID_AUDIT_FINDING_CODE,
  invalidAuditFindingMessage,
  UNAVAILABLE_AUDIT_PROMOTION_CODE,
  UNAVAILABLE_AUDIT_PROMOTION_MESSAGE,
} from "./audit-findings";
import type { SourceBindingRole, SourceKind } from "./source-schema";

type ProjectionIssue = Readonly<{
  code: string;
  target: string;
  message: string;
  source?: string | undefined;
}>;
type Collection<T> =
  | Readonly<{ validity: "available"; items: readonly T[] }>
  | Readonly<{ validity: "partial"; items: readonly T[]; issues: readonly ProjectionIssue[] }>
  | Readonly<{ validity: "invalid"; issues: readonly ProjectionIssue[] }>;
type Singleton<T> =
  | Readonly<{ validity: "available"; value: T }>
  | Readonly<{ validity: "partial"; value: T; issues: readonly ProjectionIssue[] }>
  | Readonly<{ validity: "absent" | "invalid" }>;
type SourceRecord = Readonly<{
  reference: string;
  kind: SourceKind;
  displayLocator: string;
  fragment?: string | undefined;
  binding?: Readonly<{ role: SourceBindingRole; identity: string }> | undefined;
}>;
type Finding = Readonly<{
  id: string;
  source: string;
  evidenceSourceReferences: readonly string[];
  promotion?:
    | Readonly<{
        kind: "alignment-check" | "planning-review";
        id: string;
      }>
    | undefined;
}>;
type Audit = Readonly<{ source: string; findings: readonly Finding[] }>;

export type AuditConsistencySnapshot = Readonly<{
  basis: Readonly<{ sitemapFingerprint: string }>;
  checks: Collection<Readonly<{ id: string }>>;
  reviews: Collection<Readonly<{ id: string }>>;
  audit: Singleton<Audit>;
  sources: readonly SourceRecord[];
}>;

const trustedItems = <T>(collection: Collection<T>): readonly T[] =>
  collection.validity === "invalid" ? [] : collection.items;
const addIssue = (context: RefinementCtx, path: readonly (string | number)[], message: string) => {
  context.addIssue({ code: "custom", path: [...path], message });
};
const issueKey = (issue: ProjectionIssue): string =>
  JSON.stringify([issue.code, issue.target, issue.message, issue.source ?? null]);
const fragmentOrdinal = (fragment: string | undefined): number | undefined => {
  const matched = /^finding-([1-9][0-9]*)$/u.exec(fragment ?? "");
  return matched === null ? undefined : Number(matched[1]);
};

const promotionAvailable = (finding: Finding, snapshot: AuditConsistencySnapshot): boolean => {
  if (finding.promotion === undefined) return true;
  const collection =
    finding.promotion.kind === "alignment-check" ? snapshot.checks : snapshot.reviews;
  return trustedItems(collection).some((decision) => decision.id === finding.promotion?.id);
};

const validateFinding = (
  finding: Finding,
  position: number,
  auditLocator: string,
  snapshot: AuditConsistencySnapshot,
  index: ReadonlyMap<string, SourceRecord>,
  context: RefinementCtx,
): number | undefined => {
  const path = ["audit", "value", "findings", position] as const;
  const source = index.get(finding.source);
  const ordinal = fragmentOrdinal(source?.fragment);
  const expectedId =
    source?.fragment === undefined
      ? undefined
      : createAuditFindingId(snapshot.basis.sitemapFingerprint, auditLocator, source.fragment);
  if (
    source === undefined ||
    source.kind !== "canonical" ||
    source.displayLocator !== auditLocator ||
    source.binding?.role !== "audit-finding" ||
    source.binding.identity !== finding.id ||
    ordinal === undefined ||
    expectedId !== finding.id
  ) {
    addIssue(
      context,
      [...path, "source"],
      "Audit finding identity and Source binding must match its current basis and fragment.",
    );
  }
  for (const [evidencePosition, reference] of finding.evidenceSourceReferences.entries()) {
    const evidence = index.get(reference);
    if (
      evidence === undefined ||
      evidence.kind !== "evidence" ||
      evidence.fragment !== undefined ||
      evidence.binding !== undefined
    ) {
      addIssue(
        context,
        [...path, "evidenceSourceReferences", evidencePosition],
        "Audit evidence must resolve to one display-only evidence Source Record.",
      );
    }
  }
  return ordinal;
};

const exactPromotionIssue = (
  locator: string,
  finding: Finding,
  source: SourceRecord,
): ProjectionIssue => ({
  code: UNAVAILABLE_AUDIT_PROMOTION_CODE,
  target: `${locator}#${source.fragment}`,
  message: UNAVAILABLE_AUDIT_PROMOTION_MESSAGE,
  source: finding.source,
});

const invalidFindingOrdinal = (
  issue: ProjectionIssue,
  locator: string,
  auditSource: string,
): number | undefined => {
  const escaped = locator.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const matched = new RegExp(`^${escaped}#finding-([1-9][0-9]*)$`, "u").exec(issue.target);
  const ordinal = matched === null ? undefined : Number(matched[1]);
  return issue.code === INVALID_AUDIT_FINDING_CODE &&
    ordinal !== undefined &&
    issue.message === invalidAuditFindingMessage(ordinal) &&
    issue.source === auditSource
    ? ordinal
    : undefined;
};

const exactOrdinalCoverage = (ordinals: readonly number[]): boolean => {
  if (ordinals.length === 0) return true;
  const unique = new Set(ordinals);
  const maximum = Math.max(...ordinals);
  return unique.size === ordinals.length && maximum === ordinals.length;
};
const strictlyIncreasing = (ordinals: readonly number[]): boolean =>
  ordinals.every((ordinal, index) => index === 0 || ordinal > (ordinals[index - 1] ?? 0));

export const validateAuditConsistency = (
  snapshot: AuditConsistencySnapshot,
  context: RefinementCtx,
): void => {
  if (snapshot.audit.validity !== "available" && snapshot.audit.validity !== "partial") return;
  const audit = snapshot.audit.value;
  const index = new Map(snapshot.sources.map((source) => [source.reference, source]));
  const auditSource = index.get(audit.source);
  if (auditSource === undefined) return;
  const locator = auditSource.displayLocator;
  const findingOrdinals: number[] = [];
  const expectedPromotionIssues = new Map<string, ProjectionIssue>();
  for (const [position, finding] of audit.findings.entries()) {
    const ordinal = validateFinding(finding, position, locator, snapshot, index, context);
    if (ordinal !== undefined) findingOrdinals.push(ordinal);
    const source = index.get(finding.source);
    if (!promotionAvailable(finding, snapshot) && source !== undefined) {
      const issue = exactPromotionIssue(locator, finding, source);
      expectedPromotionIssues.set(issueKey(issue), issue);
    }
  }
  if (snapshot.audit.validity === "available") {
    if (expectedPromotionIssues.size > 0) {
      addIssue(context, ["audit"], "Available Audit promotions must resolve canonically.");
    }
    if (!exactOrdinalCoverage(findingOrdinals) || !strictlyIncreasing(findingOrdinals)) {
      addIssue(
        context,
        ["audit", "value", "findings"],
        "Available Audit finding fragments must be exact.",
      );
    }
    return;
  }
  const invalidOrdinals: number[] = [];
  const actualKeys = new Set<string>();
  for (const [position, issue] of snapshot.audit.issues.entries()) {
    const key = issueKey(issue);
    const invalidOrdinal = invalidFindingOrdinal(issue, locator, audit.source);
    if (invalidOrdinal !== undefined) invalidOrdinals.push(invalidOrdinal);
    else if (!expectedPromotionIssues.has(key)) {
      addIssue(
        context,
        ["audit", "issues", position],
        "Partial Audit issues must match producer output.",
      );
    }
    if (actualKeys.has(key)) {
      addIssue(context, ["audit", "issues", position], "Partial Audit issues must be unique.");
    }
    actualKeys.add(key);
  }
  for (const key of expectedPromotionIssues.keys()) {
    if (!actualKeys.has(key)) {
      addIssue(
        context,
        ["audit", "issues"],
        "Partial Audit must retain each exact promotion issue.",
      );
    }
  }
  if (audit.findings.length === 0) {
    addIssue(context, ["audit", "value", "findings"], "Partial Audit must retain one finding.");
  }
  if (
    !strictlyIncreasing(findingOrdinals) ||
    !exactOrdinalCoverage([...findingOrdinals, ...invalidOrdinals])
  ) {
    addIssue(context, ["audit", "issues"], "Partial Audit finding fragments must be exact.");
  }
};
