import { expect, test } from "bun:test";
import { buildAdvisoryProjection } from "../src/project-snapshot/advisory";
import { createAuditFindingId } from "../src/project-snapshot/audit-findings";
import { buildDecisionProjection } from "../src/project-snapshot/decisions";
import { runSync } from "../src/sync";
import { createValidBearingRepo, writeFixture } from "./helpers";
import {
  buildProjectSnapshotForTest as buildProjectSnapshot,
  decodeSourceFixtures,
} from "./project-snapshot-fixture";

const BASIS = `sha256:${"d".repeat(64)}`;
const AUDIT_LOCATOR = ".bearing/state/planning-audit.md";
const finding = (
  title: string,
  options: Readonly<{ promotion?: string; malformed?: boolean }> = {},
): string => `### ${title}

The project has one material question that remains advisory.

#### Affected References

- \`roadmap:test\`

#### Evidence Sources

- \`.scratch/evidence/${title.toLowerCase().replaceAll(" ", "-")}.md\`

#### Consequence

The question should remain visible until its evidence is reviewed.

#### ${options.malformed === true ? "Confidence" : "Confidence Boundary"}

The finding does not establish that a decision has been accepted.${
  options.promotion === undefined
    ? ""
    : `

#### Promotion

${options.promotion}`
}`;

const auditRecord = (
  body: string,
  options: Readonly<{ coverage?: "complete" | "incomplete"; skipped?: string }> = {},
) => ({
  locator: AUDIT_LOCATOR,
  source: `---
Type: planning-audit
ID: planning-audit:current
Generated at: 2026-07-14T10:00:00+0800
Inputs: []
Input fingerprint: sha256:${"a".repeat(64)}
Coverage: ${options.coverage ?? "complete"}
Skipped targets: ${options.skipped === undefined ? "[]" : `\n  - ${options.skipped}`}
---

# Planning Audit

## Findings

${body}
`,
});

const checkRecord = (status: "open" | "resolved") => ({
  locator: ".bearing/state/alignment-checks/portal.md",
  source: `---
Type: alignment-check
ID: alignment-check:portal
Title: Confirm the Portal direction
Status: ${status}
Target: roadmap:test
Inputs: []
Input fingerprint: sha256:${"b".repeat(64)}
${
  status === "resolved"
    ? `Resolution:
  Accepted decision: Alignment is confirmed.
  Rationale: The reviewed direction is accepted.
  Changed references: []`
    : ""
}
---

# Alignment Check
`,
});

const reviewRecord = (status: "pending" | "completed") => ({
  locator: ".bearing/state/planning-reviews/portfolio.md",
  source: `---
Type: planning-review
ID: planning-review:portfolio
Title: Review the portfolio direction
Status: ${status}
Scope: Whole project
Inputs: []
Input fingerprint: sha256:${"c".repeat(64)}
${
  status === "completed"
    ? `Resolution:
  Accepted decision: Continue the current direction.
  Rationale: The current balance is accepted.
  Changed references: []`
    : ""
}
---

# Planning Review
`,
});

const project = (
  body: string,
  decisionRecords: readonly Readonly<{ locator: string; source: string }>[] = [],
) => {
  const records = decodeSourceFixtures([auditRecord(body), ...decisionRecords], BASIS);
  const decisions = buildDecisionProjection({ records, sitemapFingerprint: BASIS });
  return {
    decisions,
    advisory: buildAdvisoryProjection({
      records,
      sitemapFingerprint: BASIS,
      advisoryFreshness: { "planning-audit:current": "current" },
      checks: decisions.checks,
      reviews: decisions.reviews,
    }),
  };
};

test("projects the exact zero-findings Audit without inventing Sources", () => {
  const projected = project("No material findings.").advisory;
  expect(projected.audit).toMatchObject({
    validity: "available",
    value: { coverage: "complete", skippedTargets: [], findings: [] },
  });
  expect(projected.sources).toHaveLength(1);
});

test("projects stable findings, evidence Sources, and canonical promotion IDs", () => {
  const { advisory, decisions } = project(
    [
      finding("Scoped direction", {
        promotion: "Alignment Check: `alignment-check:portal`",
      }),
      finding("Portfolio balance", {
        promotion: "Planning Review: `planning-review:portfolio`",
      }),
    ].join("\n\n"),
    [checkRecord("resolved"), reviewRecord("completed")],
  );
  expect(decisions.checks.validity).toBe("available");
  expect(decisions.reviews).toMatchObject({
    validity: "available",
    items: [{ id: "planning-review:portfolio" }],
  });
  expect(advisory.audit).toMatchObject({
    validity: "available",
    value: {
      findings: [
        {
          id: createAuditFindingId(BASIS, AUDIT_LOCATOR, "finding-1"),
          promotion: { kind: "alignment-check", id: "alignment-check:portal" },
        },
        {
          id: createAuditFindingId(BASIS, AUDIT_LOCATOR, "finding-2"),
          promotion: { kind: "planning-review", id: "planning-review:portfolio" },
        },
      ],
    },
  });
  expect(advisory.sources).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        kind: "canonical",
        displayLocator: AUDIT_LOCATOR,
        fragment: "finding-1",
        binding: expect.objectContaining({ role: "audit-finding" }),
      }),
      expect.objectContaining({
        kind: "evidence",
        displayLocator: ".scratch/evidence/scoped-direction.md",
      }),
    ]),
  );
  expect(decisions.attention).toEqual([]);
});

test("retains trustworthy findings and scopes each malformed finding", () => {
  const projected = project(
    `${finding("Trusted direction")}\n\n${finding("Malformed direction", { malformed: true })}`,
  ).advisory;
  expect(projected.audit).toMatchObject({
    validity: "partial",
    value: { findings: [{ title: "Trusted direction" }] },
    issues: [
      {
        code: "invalid-planning-audit-finding",
        target: `${AUDIT_LOCATOR}#finding-2`,
        message: "Planning Audit finding 2 does not match the exact finding structure.",
      },
    ],
  });
});

test("invalidates an Audit when every authored finding is malformed", () => {
  const projected = project(finding("Malformed direction", { malformed: true })).advisory;
  expect(projected.audit).toMatchObject({
    validity: "invalid",
    issues: [
      {
        code: "invalid-planning-audit-body",
        target: AUDIT_LOCATOR,
        message: "Planning Audit requires the exact Findings body structure.",
      },
    ],
  });
});

test("retains a finding but makes the Audit partial when its promotion is unavailable", () => {
  const projected = project(
    finding("Missing decision", {
      promotion: "Alignment Check: `alignment-check:missing`",
    }),
  ).advisory;
  expect(projected.audit).toMatchObject({
    validity: "partial",
    value: {
      findings: [
        {
          title: "Missing decision",
          promotion: { kind: "alignment-check", id: "alignment-check:missing" },
        },
      ],
    },
    issues: [
      {
        code: "unavailable-audit-promotion",
        target: `${AUDIT_LOCATOR}#finding-1`,
        message: "Planning Audit promotion target is unavailable.",
      },
    ],
  });
});

test("keeps Attention owned only by canonical unresolved decisions", () => {
  const { decisions, advisory } = project(
    finding("Open decision", {
      promotion: "Alignment Check: `alignment-check:portal`",
    }),
    [checkRecord("open")],
  );
  expect(advisory.audit).toMatchObject({ validity: "available" });
  expect(decisions.attention).toHaveLength(1);
  expect(decisions.attention[0]).toMatchObject({
    kind: "alignment-check",
    id: "alignment-check:portal",
  });
  expect("attention" in advisory).toBe(false);
});

test("builds findings and de-duplicated Attention through the complete Snapshot producer", async () => {
  const root = await createValidBearingRepo();
  const body = [
    finding("Scoped direction", {
      promotion: "Alignment Check: `alignment-check:portal`",
    }),
    finding("Portfolio balance", {
      promotion: "Planning Review: `planning-review:portfolio`",
    }),
  ].join("\n\n");
  await writeFixture(root, AUDIT_LOCATOR, auditRecord(body).source);
  await writeFixture(root, checkRecord("open").locator, checkRecord("open").source);
  await writeFixture(root, reviewRecord("completed").locator, reviewRecord("completed").source);
  const sync = await runSync(root, {
    providerObservationIntent: "initial-baseline",
  });
  expect(sync.diagnostics).toEqual([]);
  const snapshot = await buildProjectSnapshot({
    repoRoot: root,
    packageVersion: "0.0.0-test",
    inputs: sync.inputs,
    sitemapFingerprint: sync.fingerprint,
    diagnostics: sync.diagnostics,
    advisoryFreshness: sync.advisoryFreshness,
  });
  expect(snapshot.audit).toMatchObject({
    validity: "available",
    value: {
      findings: [
        { promotion: { kind: "alignment-check", id: "alignment-check:portal" } },
        { promotion: { kind: "planning-review", id: "planning-review:portfolio" } },
      ],
    },
  });
  expect(snapshot.attention).toMatchObject([
    { kind: "alignment-check", id: "alignment-check:portal" },
  ]);
  expect(snapshot.sources.some((source) => source.kind === "evidence")).toBe(true);
});
