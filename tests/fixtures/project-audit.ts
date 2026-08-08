import { buildAdvisoryProjection } from "../../src/project-generation/advisory";
import {
  createAuditFindingId,
  INVALID_AUDIT_FINDING_CODE,
  invalidAuditFindingMessage,
  UNAVAILABLE_AUDIT_PROMOTION_CODE,
  UNAVAILABLE_AUDIT_PROMOTION_MESSAGE,
} from "../../src/project-generation/audit-findings";
import type { ProjectGeneration } from "../../src/project-generation/contract";
import { buildDecisionProjection } from "../../src/project-generation/decisions";
import { projectGenerationSchema } from "../../src/project-generation/schema";
import { createSourceRecord } from "../../src/project-generation/source-records";
import { withRebuiltPlanningLineage } from "../planning-lineage-fixture";
import { decodeSourceFixtures } from "../project-generation-fixture";
import { createProjectOverviewFixture } from "./project-overview";

const AUDIT_LOCATOR = ".bearing/state/planning-audit.md";
const AUDIT_FINDING_FRAGMENT = "finding-1";
export const AUDIT_FINDING_ID = createAuditFindingId(
  `sha256:${"b".repeat(64)}`,
  AUDIT_LOCATOR,
  AUDIT_FINDING_FRAGMENT,
);

export const createProjectAuditFixture = (): ProjectGeneration => {
  const snapshot = createProjectOverviewFixture();
  const review =
    snapshot.reviews.validity === "invalid"
      ? undefined
      : snapshot.reviews.items.find((candidate) => candidate.id === "planning-review:sequence");
  if (review === undefined) throw new Error("Expected Planning Review fixture.");
  const findingSource = createSourceRecord(snapshot.basis.basisFingerprint, {
    kind: "canonical",
    locator: AUDIT_LOCATOR,
    fragment: AUDIT_FINDING_FRAGMENT,
    binding: { role: "audit-finding", identity: AUDIT_FINDING_ID },
  });
  const evidenceSource = createSourceRecord(snapshot.basis.basisFingerprint, {
    kind: "evidence",
    locator: ".bearing/state/roadmaps/portal.md",
  });
  if (snapshot.audit.validity !== "available") throw new Error("Expected Audit fixture.");
  return projectGenerationSchema.parse({
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
            consequence: "The question should remain visible until the Review is completed.",
            confidenceBoundary: "The Audit does not decide whether the revision is accepted.",
            promotion: { kind: "planning-review", id: review.id },
          },
        ],
      },
    },
    sources: [...snapshot.sources, findingSource, evidenceSource],
  });
};

const withAudit = (
  snapshot: ProjectGeneration,
  audit: ProjectGeneration["audit"],
): ProjectGeneration => projectGenerationSchema.parse({ ...snapshot, audit });

export const createAbsentProjectAuditFixture = (): ProjectGeneration =>
  withAudit(createProjectOverviewFixture(), { validity: "absent" });

export const createZeroProjectAuditFixture = (): ProjectGeneration => {
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

export const createPartialProjectAuditFixture = (): ProjectGeneration => {
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

export const createUnavailableAuditPromotionFixture = (): ProjectGeneration => {
  const snapshot = createProjectAuditFixture();
  if (snapshot.audit.validity !== "available") throw new Error("Expected Audit fixture.");
  const finding = snapshot.audit.value.findings[0];
  if (finding === undefined) throw new Error("Expected one Audit finding.");
  return projectGenerationSchema.parse(
    withRebuiltPlanningLineage({
      ...snapshot,
      reviews: { validity: "available", items: [] },
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
        (item) => !(item.kind === "planning-review" && item.id === "planning-review:sequence"),
      ),
    }),
  );
};

export const createInvalidProjectAuditFixture = (): ProjectGeneration => {
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

export const createMissingGeneratedTimeAuditFixture = (): ProjectGeneration => {
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
    snapshot.basis.basisFingerprint,
  );
  const decisions = buildDecisionProjection({
    records,
    basisFingerprint: snapshot.basis.basisFingerprint,
  });
  const advisory = buildAdvisoryProjection({
    records,
    basisFingerprint: snapshot.basis.basisFingerprint,
    advisoryFreshness: {},
    reviews: decisions.reviews,
  });
  const projectedReferences = new Set(advisory.sources.map((source) => source.reference));
  return projectGenerationSchema.parse({
    ...snapshot,
    audit: advisory.audit,
    sources: [
      ...snapshot.sources.filter((source) => !projectedReferences.has(source.reference)),
      ...advisory.sources,
    ],
  });
};
