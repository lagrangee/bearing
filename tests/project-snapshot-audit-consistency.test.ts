import { expect, test } from "bun:test";
import { createAuditFindingId } from "../src/project-snapshot/audit-findings";
import type { ProjectSnapshotInput } from "../src/project-snapshot/contract";
import { projectSnapshotSchema } from "../src/project-snapshot/schema";
import { createSourceRecord } from "../src/project-snapshot/source-records";
import { createProjectOverviewFixture } from "./fixtures/project-overview";

const AUDIT_LOCATOR = ".bearing/state/planning-audit.md";

const findingSnapshot = () => {
  const snapshot = createProjectOverviewFixture();
  const id = createAuditFindingId(snapshot.basis.sitemapFingerprint, AUDIT_LOCATOR, "finding-1");
  const findingSource = createSourceRecord(snapshot.basis.sitemapFingerprint, {
    kind: "canonical",
    locator: AUDIT_LOCATOR,
    fragment: "finding-1",
    binding: { role: "audit-finding", identity: id },
  });
  const evidenceSource = createSourceRecord(snapshot.basis.sitemapFingerprint, {
    kind: "evidence",
    locator: ".scratch/evidence/audit.md",
  });
  if (snapshot.audit.validity !== "available") throw new Error("Expected Audit fixture.");
  return {
    ...snapshot,
    audit: {
      validity: "available",
      value: {
        ...snapshot.audit.value,
        findings: [
          {
            id,
            title: "Portal direction needs a decision path",
            source: findingSource.reference,
            summary: "The implementation exposes one material project question.",
            affectedReferences: ["roadmap:portal"],
            evidenceSourceReferences: [evidenceSource.reference],
            consequence: "The question remains visible until the evidence is reviewed.",
            confidenceBoundary: "The Audit does not accept or resolve the decision.",
            promotion: { kind: "planning-review", id: "planning-review:sequence" },
          },
        ],
      },
    },
    sources: [...snapshot.sources, findingSource, evidenceSource],
  } as const;
};

const parses = (snapshot: unknown): boolean => projectSnapshotSchema.safeParse(snapshot).success;

test("accepts a finding whose identity, Sources, promotion, and Attention are exact", () => {
  const snapshot = findingSnapshot();
  expect(parses(snapshot)).toBe(true);
  expect(snapshot.attention.filter((item) => item.kind === "planning-review")).toHaveLength(1);
});

test("rejects forged finding identity, primary Source, evidence Source, and basis", () => {
  const snapshot = findingSnapshot();
  if (snapshot.audit.validity !== "available") throw new Error("Expected Audit.");
  const finding = snapshot.audit.value.findings[0];
  const forgedEvidence = createSourceRecord(snapshot.basis.sitemapFingerprint, {
    kind: "canonical",
    locator: ".scratch/evidence/audit.md",
  });
  const wrongBasisEvidence = createSourceRecord(`sha256:${"e".repeat(64)}`, {
    kind: "evidence",
    locator: ".scratch/evidence/audit.md",
  });
  const variants: readonly ProjectSnapshotInput[] = [
    {
      ...snapshot,
      audit: {
        validity: "available",
        value: {
          ...snapshot.audit.value,
          findings: [{ ...finding, id: `audit-finding:${"f".repeat(64)}` }],
        },
      },
    },
    {
      ...snapshot,
      audit: {
        validity: "available",
        value: {
          ...snapshot.audit.value,
          findings: [{ ...finding, source: snapshot.audit.value.source }],
        },
      },
    },
    {
      ...snapshot,
      audit: {
        validity: "available",
        value: {
          ...snapshot.audit.value,
          findings: [{ ...finding, evidenceSourceReferences: [forgedEvidence.reference] }],
        },
      },
      sources: [...snapshot.sources, forgedEvidence],
    },
    {
      ...snapshot,
      audit: {
        validity: "available",
        value: {
          ...snapshot.audit.value,
          findings: [{ ...finding, evidenceSourceReferences: [wrongBasisEvidence.reference] }],
        },
      },
      sources: [...snapshot.sources, wrongBasisEvidence],
    },
  ];
  for (const variant of variants) expect(parses(variant)).toBe(false);
});

test("rejects duplicate finding, affected, evidence, and skipped identities", () => {
  const snapshot = findingSnapshot();
  if (snapshot.audit.validity !== "available") throw new Error("Expected Audit.");
  const finding = snapshot.audit.value.findings[0];
  const variants = [
    {
      ...snapshot,
      audit: {
        validity: "available",
        value: { ...snapshot.audit.value, findings: [finding, finding] },
      },
    },
    {
      ...snapshot,
      audit: {
        validity: "available",
        value: {
          ...snapshot.audit.value,
          findings: [{ ...finding, affectedReferences: ["roadmap:portal", "roadmap:portal"] }],
        },
      },
    },
    {
      ...snapshot,
      audit: {
        validity: "available",
        value: {
          ...snapshot.audit.value,
          findings: [
            {
              ...finding,
              evidenceSourceReferences: [
                finding.evidenceSourceReferences[0],
                finding.evidenceSourceReferences[0],
              ],
            },
          ],
        },
      },
    },
    {
      ...snapshot,
      audit: {
        validity: "available",
        value: {
          ...snapshot.audit.value,
          coverage: "incomplete",
          skippedTargets: ["roadmap:portal", "roadmap:portal"],
        },
      },
    },
  ];
  for (const variant of variants) expect(parses(variant)).toBe(false);
});

test("enforces the exact coverage and skipped-target invariant", () => {
  const snapshot = findingSnapshot();
  if (snapshot.audit.validity !== "available") throw new Error("Expected Audit.");
  expect(
    parses({
      ...snapshot,
      audit: {
        validity: "available",
        value: { ...snapshot.audit.value, coverage: "complete", skippedTargets: ["gate:one"] },
      },
    }),
  ).toBe(false);
  expect(
    parses({
      ...snapshot,
      audit: {
        validity: "available",
        value: { ...snapshot.audit.value, coverage: "incomplete", skippedTargets: [] },
      },
    }),
  ).toBe(false);
});

test("requires unresolved promotions to make the Audit partial with the exact issue", () => {
  const snapshot = findingSnapshot();
  if (snapshot.audit.validity !== "available") throw new Error("Expected Audit.");
  const finding = snapshot.audit.value.findings[0];
  const unavailable = {
    ...snapshot.audit.value,
    findings: [
      {
        ...finding,
        promotion: { kind: "planning-review", id: "planning-review:missing" },
      },
    ],
  } as const;
  const exactIssue = {
    code: "unavailable-audit-promotion",
    target: `${AUDIT_LOCATOR}#finding-1`,
    message: "Planning Audit promotion target is unavailable.",
    source: finding.source,
  };
  expect(parses({ ...snapshot, audit: { validity: "available", value: unavailable } })).toBe(false);
  expect(
    parses({
      ...snapshot,
      audit: { validity: "partial", value: unavailable, issues: [exactIssue] },
    }),
  ).toBe(true);
  expect(
    parses({
      ...snapshot,
      audit: {
        validity: "partial",
        value: unavailable,
        issues: [{ ...exactIssue, message: "Decision unavailable." }],
      },
    }),
  ).toBe(false);
});

test("accepts an exact malformed-finding issue and rejects unexplained partial state", () => {
  const snapshot = findingSnapshot();
  if (snapshot.audit.validity !== "available") throw new Error("Expected Audit.");
  const issue = {
    code: "invalid-planning-audit-finding",
    target: `${AUDIT_LOCATOR}#finding-2`,
    message: "Planning Audit finding 2 does not match the exact finding structure.",
    source: snapshot.audit.value.source,
  };
  expect(
    parses({
      ...snapshot,
      audit: { validity: "partial", value: snapshot.audit.value, issues: [issue] },
    }),
  ).toBe(true);
  expect(
    parses({
      ...snapshot,
      audit: {
        validity: "partial",
        value: snapshot.audit.value,
        issues: [{ code: "other", target: "audit", message: "Unknown issue." }],
      },
    }),
  ).toBe(false);
});

test("requires available finding fragments to be contiguous from finding-1", () => {
  const snapshot = findingSnapshot();
  if (snapshot.audit.validity !== "available") throw new Error("Expected Audit.");
  const fragment = "finding-2";
  const id = createAuditFindingId(snapshot.basis.sitemapFingerprint, AUDIT_LOCATOR, fragment);
  const source = createSourceRecord(snapshot.basis.sitemapFingerprint, {
    kind: "canonical",
    locator: AUDIT_LOCATOR,
    fragment,
    binding: { role: "audit-finding", identity: id },
  });
  const shifted = {
    ...snapshot.audit.value,
    findings: [{ ...snapshot.audit.value.findings[0], id, source: source.reference }],
  };
  const sources = [...snapshot.sources, source];
  expect(parses({ ...snapshot, audit: { validity: "available", value: shifted }, sources })).toBe(
    false,
  );
  const firstInvalid = {
    code: "invalid-planning-audit-finding",
    target: `${AUDIT_LOCATOR}#finding-1`,
    message: "Planning Audit finding 1 does not match the exact finding structure.",
    source: snapshot.audit.value.source,
  };
  expect(
    parses({
      ...snapshot,
      audit: { validity: "partial", value: shifted, issues: [firstInvalid] },
      sources,
    }),
  ).toBe(true);
});

test("rejects reordered available findings and partial Audits without a survivor", () => {
  const snapshot = findingSnapshot();
  if (snapshot.audit.validity !== "available") throw new Error("Expected Audit.");
  const first = snapshot.audit.value.findings[0];
  const secondId = createAuditFindingId(
    snapshot.basis.sitemapFingerprint,
    AUDIT_LOCATOR,
    "finding-2",
  );
  const secondSource = createSourceRecord(snapshot.basis.sitemapFingerprint, {
    kind: "canonical",
    locator: AUDIT_LOCATOR,
    fragment: "finding-2",
    binding: { role: "audit-finding", identity: secondId },
  });
  const second = { ...first, id: secondId, source: secondSource.reference };
  expect(
    parses({
      ...snapshot,
      audit: {
        validity: "available",
        value: { ...snapshot.audit.value, findings: [second, first] },
      },
      sources: [...snapshot.sources, secondSource],
    }),
  ).toBe(false);
  expect(
    parses({
      ...snapshot,
      audit: {
        validity: "partial",
        value: { ...snapshot.audit.value, findings: [] },
        issues: [
          {
            code: "invalid-planning-audit-finding",
            target: `${AUDIT_LOCATOR}#finding-1`,
            message: "Planning Audit finding 1 does not match the exact finding structure.",
            source: snapshot.audit.value.source,
          },
        ],
      },
    }),
  ).toBe(false);
});

test("rejects promotion issue duplication and malformed-finding ordinal gaps", () => {
  const snapshot = findingSnapshot();
  if (snapshot.audit.validity !== "available") throw new Error("Expected Audit.");
  const finding = snapshot.audit.value.findings[0];
  const unavailable = {
    ...snapshot.audit.value,
    findings: [
      {
        ...finding,
        promotion: { kind: "alignment-check", id: "alignment-check:missing" },
      },
    ],
  } as const;
  const relationIssue = {
    code: "unavailable-audit-promotion",
    target: `${AUDIT_LOCATOR}#finding-1`,
    message: "Planning Audit promotion target is unavailable.",
    source: finding.source,
  };
  expect(
    parses({
      ...snapshot,
      audit: {
        validity: "partial",
        value: unavailable,
        issues: [relationIssue, relationIssue],
      },
    }),
  ).toBe(false);
  expect(
    parses({
      ...snapshot,
      audit: {
        validity: "partial",
        value: snapshot.audit.value,
        issues: [
          {
            code: "invalid-planning-audit-finding",
            target: `${AUDIT_LOCATOR}#finding-3`,
            message: "Planning Audit finding 3 does not match the exact finding structure.",
            source: snapshot.audit.value.source,
          },
        ],
      },
    }),
  ).toBe(false);
});

test("rejects a promotion kind whose ID belongs to the other decision collection", () => {
  const snapshot = findingSnapshot();
  if (snapshot.audit.validity !== "available") throw new Error("Expected Audit.");
  const finding = snapshot.audit.value.findings[0];
  expect(
    parses({
      ...snapshot,
      audit: {
        validity: "available",
        value: {
          ...snapshot.audit.value,
          findings: [
            {
              ...finding,
              promotion: { kind: "alignment-check", id: "planning-review:sequence" },
            },
          ],
        },
      },
    }),
  ).toBe(false);
});
