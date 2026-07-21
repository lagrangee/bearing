import type {
  AlignmentCheck,
  AuditFinding,
  PlanningReview,
  ProjectSnapshot,
  SourceRecord,
  SourceReference,
} from "../project-snapshot/contract";
import type { ProjectInspectorSelection } from "./project-inspector";

type AuditPromotion = NonNullable<AuditFinding["promotion"]>;

export type AuditDecisionRelation = Readonly<{
  available: boolean;
  id: string;
  kind: AuditPromotion["kind"];
  source: SourceRecord | undefined;
  status: string | undefined;
  title: string | undefined;
}>;

export type ProjectAuditFindingRow = Readonly<{
  evidence: readonly Readonly<{
    reference: SourceReference;
    source: SourceRecord | undefined;
  }>[];
  finding: AuditFinding;
  promotion: AuditDecisionRelation | undefined;
  source: SourceRecord | undefined;
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
  sources: ReadonlyMap<string, SourceRecord>,
): AuditDecisionRelation | undefined => {
  if (promotion === undefined) return undefined;
  const decision =
    promotion.kind === "alignment-check" ? checks.get(promotion.id) : reviews.get(promotion.id);
  return {
    available: decision !== undefined,
    id: promotion.id,
    kind: promotion.kind,
    source: decision === undefined ? undefined : sources.get(decision.source),
    status: decision?.status,
    title: decision?.title,
  };
};

export const buildProjectAuditModel = (snapshot: ProjectSnapshot): ProjectAuditModel => {
  if (snapshot.audit.validity === "absent") return { state: "absent" };
  if (snapshot.audit.validity === "invalid") {
    return { state: "invalid", issueCount: snapshot.audit.issues.length };
  }
  const sources = new Map(snapshot.sources.map((source) => [source.reference, source]));
  const checks = new Map(trustedItems(snapshot.checks).map((check) => [String(check.id), check]));
  const reviews = new Map(
    trustedItems(snapshot.reviews).map((review) => [String(review.id), review]),
  );
  const audit = snapshot.audit.value;
  const readable = {
    coverage: audit.coverage,
    findings: audit.findings.map((finding) => ({
      finding,
      source: sources.get(finding.source),
      evidence: finding.evidenceSourceReferences.map((reference) => ({
        reference,
        source: sources.get(reference),
      })),
      promotion: decisionRelation(finding.promotion, checks, reviews, sources),
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

const evidenceLabel = (evidence: ProjectAuditFindingRow["evidence"][number]): string =>
  evidence.source === undefined
    ? `Locator unavailable · Source ${evidence.reference}`
    : `${evidence.source.displayLocator} · Source ${evidence.reference}`;

export const findingInspection = (row: ProjectAuditFindingRow): ProjectInspectorSelection => {
  const decision = row.promotion;
  const decisionLabel =
    decision === undefined ? "Advisory finding" : decisionKindLabel(decision.kind);
  return {
    eyebrow: `Audit Finding · ${decisionLabel}`,
    title: row.finding.title,
    detail: row.finding.summary,
    source: row.source,
    facts: [
      { label: "Finding ID", value: row.finding.id, code: true },
      { label: "Decision path", value: decisionLabel },
      ...(decision === undefined
        ? []
        : [
            { label: "Decision ID", value: decision.id, code: true },
            {
              label: "Decision title",
              value: decision.title ?? "Unavailable in the current Snapshot",
            },
            { label: "Decision status", value: decision.status ?? "Unavailable" },
            {
              label: "Decision source",
              value: decision.source?.displayLocator ?? "Unavailable in the current Snapshot",
            },
            ...(decision.source === undefined
              ? []
              : [
                  {
                    label: "Decision Source ref",
                    value: decision.source.reference,
                    code: true,
                  },
                ]),
          ]),
    ],
    sections: [
      { title: "Affected references", items: row.finding.affectedReferences },
      {
        title: "Evidence",
        body: "Display-only Source provenance; no file capability is granted.",
        items: row.evidence.map(evidenceLabel),
      },
      { title: "Consequence", body: row.finding.consequence },
      { title: "Confidence boundary", body: row.finding.confidenceBoundary },
    ],
  };
};
