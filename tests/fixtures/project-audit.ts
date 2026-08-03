import { buildAdvisoryProjection } from "../../src/project-snapshot/advisory";
import {
  createAuditFindingId,
  INVALID_AUDIT_FINDING_CODE,
  invalidAuditFindingMessage,
  UNAVAILABLE_AUDIT_PROMOTION_CODE,
  UNAVAILABLE_AUDIT_PROMOTION_MESSAGE,
} from "../../src/project-snapshot/audit-findings";
import type { ProjectSnapshot } from "../../src/project-snapshot/contract";
import { buildDecisionProjection } from "../../src/project-snapshot/decisions";
import { projectSnapshotSchema } from "../../src/project-snapshot/schema";
import { createSourceRecord } from "../../src/project-snapshot/source-records";
import { withRebuiltPlanningLineage } from "../planning-lineage-fixture";
import { decodeSourceFixtures } from "../project-snapshot-fixture";
import { createProjectOverviewFixture } from "./project-overview";

const AUDIT_LOCATOR = ".bearing/state/planning-audit.md";
const AUDIT_FINDING_FRAGMENT = "finding-1";
export const AUDIT_FINDING_ID = createAuditFindingId(
  `sha256:${"b".repeat(64)}`,
  AUDIT_LOCATOR,
  AUDIT_FINDING_FRAGMENT,
);

export const createProjectAuditFixture = (): ProjectSnapshot => {
  const snapshot = createProjectOverviewFixture();
  const check =
    snapshot.checks.validity === "invalid"
      ? undefined
      : snapshot.checks.items.find((candidate) => candidate.id === "alignment-check:portal");
  if (check === undefined) throw new Error("Expected Alignment Check fixture.");
  const findingSource = createSourceRecord(snapshot.basis.sitemapFingerprint, {
    kind: "canonical",
    locator: AUDIT_LOCATOR,
    fragment: AUDIT_FINDING_FRAGMENT,
    binding: { role: "audit-finding", identity: AUDIT_FINDING_ID },
  });
  const evidenceSource = createSourceRecord(snapshot.basis.sitemapFingerprint, {
    kind: "evidence",
    locator: ".bearing/state/roadmaps/portal.md",
  });
  if (snapshot.audit.validity !== "available") throw new Error("Expected Audit fixture.");
  return projectSnapshotSchema.parse({
    ...snapshot,
    audit: {
      validity: "available",
      value: {
        ...snapshot.audit.value,
        generatedAt: "2026-07-14T09:30:00+08:00",
        semanticFreshness: "stale",
        coverage: "incomplete",
        skippedTargets: ["authority:architecture"],
        findings: [
          {
            id: AUDIT_FINDING_ID,
            title: "Portal direction needs a decision path",
            source: findingSource.reference,
            summary: "The accepted direction and current implementation need an explicit review.",
            affectedReferences: ["roadmap:portal", ".scratch/portal/map.md"],
            evidenceSourceReferences: [evidenceSource.reference],
            consequence: "The question should remain visible until the Check is resolved.",
            confidenceBoundary: "The Audit does not decide whether the revision is accepted.",
            promotion: { kind: "alignment-check", id: check.id },
          },
        ],
      },
    },
    guidance: { validity: "absent" },
    sources: [...snapshot.sources, findingSource, evidenceSource],
  });
};

const withAudit = (snapshot: ProjectSnapshot, audit: ProjectSnapshot["audit"]): ProjectSnapshot =>
  projectSnapshotSchema.parse({ ...snapshot, audit, guidance: { validity: "absent" } });

export const createAbsentProjectAuditFixture = (): ProjectSnapshot =>
  withAudit(createProjectOverviewFixture(), { validity: "absent" });

export const createZeroProjectAuditFixture = (): ProjectSnapshot => {
  const snapshot = createProjectAuditFixture();
  if (snapshot.audit.validity !== "available") throw new Error("Expected Audit fixture.");
  return withAudit(snapshot, {
    validity: "available",
    value: {
      ...snapshot.audit.value,
      semanticFreshness: "current",
      coverage: "complete",
      skippedTargets: [],
      findings: [],
    },
  });
};

export const createPartialProjectAuditFixture = (): ProjectSnapshot => {
  const snapshot = createProjectAuditFixture();
  if (snapshot.audit.validity !== "available") throw new Error("Expected Audit fixture.");
  return withAudit(snapshot, {
    validity: "partial",
    value: snapshot.audit.value,
    issues: [
      {
        code: INVALID_AUDIT_FINDING_CODE,
        target: `${AUDIT_LOCATOR}#finding-2`,
        message: invalidAuditFindingMessage(2),
        source: snapshot.audit.value.source,
      },
    ],
  });
};

export const createUnavailableAuditPromotionFixture = (): ProjectSnapshot => {
  const snapshot = createProjectAuditFixture();
  if (snapshot.audit.validity !== "available") throw new Error("Expected Audit fixture.");
  const finding = snapshot.audit.value.findings[0];
  if (finding === undefined) throw new Error("Expected one Audit finding.");
  return projectSnapshotSchema.parse(
    withRebuiltPlanningLineage({
      ...snapshot,
      checks: { validity: "available", items: [] },
      audit: {
        validity: "partial",
        value: snapshot.audit.value,
        issues: [
          {
            code: UNAVAILABLE_AUDIT_PROMOTION_CODE,
            target: `${AUDIT_LOCATOR}#${AUDIT_FINDING_FRAGMENT}`,
            message: UNAVAILABLE_AUDIT_PROMOTION_MESSAGE,
            source: finding.source,
          },
        ],
      },
      attention: snapshot.attention.filter(
        (item) => !(item.kind === "alignment-check" && item.id === "alignment-check:portal"),
      ),
    }),
  );
};

export const createInvalidProjectAuditFixture = (): ProjectSnapshot => {
  const snapshot = createProjectAuditFixture();
  return withAudit(snapshot, {
    validity: "invalid",
    issues: [
      {
        code: "invalid-planning-audit",
        target: AUDIT_LOCATOR,
        message: "Planning Audit cannot be normalized.",
      },
    ],
  });
};

export const createMissingGeneratedTimeAuditFixture = (): ProjectSnapshot => {
  const snapshot = createProjectAuditFixture();
  const records = decodeSourceFixtures(
    [
      {
        locator: AUDIT_LOCATOR,
        source: `---
Type: planning-audit
ID: planning-audit:current
Inputs: []
Input fingerprint: sha256:${"a".repeat(64)}
Coverage: complete
Skipped targets: []
---

# Planning Audit

## Findings

No material findings.
`,
      },
    ],
    snapshot.basis.sitemapFingerprint,
  );
  const decisions = buildDecisionProjection({
    records,
    sitemapFingerprint: snapshot.basis.sitemapFingerprint,
  });
  const advisory = buildAdvisoryProjection({
    records,
    sitemapFingerprint: snapshot.basis.sitemapFingerprint,
    advisoryFreshness: {},
    checks: decisions.checks,
    reviews: decisions.reviews,
  });
  const projectedReferences = new Set(advisory.sources.map((source) => source.reference));
  return projectSnapshotSchema.parse({
    ...snapshot,
    audit: advisory.audit,
    guidance: { validity: "absent" },
    sources: [
      ...snapshot.sources.filter((source) => !projectedReferences.has(source.reference)),
      ...advisory.sources,
    ],
  });
};
