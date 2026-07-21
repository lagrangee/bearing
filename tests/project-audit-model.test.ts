import { expect, test } from "bun:test";
import { buildProjectAuditModel, findingInspection } from "../src/portal-ui/project-audit-model";
import type { ProjectSnapshot } from "../src/project-snapshot/contract";
import {
  AUDIT_FINDING_ID,
  createAbsentProjectAuditFixture,
  createInvalidProjectAuditFixture,
  createPartialProjectAuditFixture,
  createProjectAuditFixture,
  createUnavailableAuditPromotionFixture,
  createZeroProjectAuditFixture,
} from "./fixtures/project-audit";

test("preserves Audit finding order and resolves its canonical decision path", () => {
  const model = buildProjectAuditModel(createProjectAuditFixture());

  expect(model.state).toBe("available");
  if (model.state !== "available") throw new Error("Expected available Audit.");
  expect(model.generatedAt).toBe("2026-07-14T09:30:00+08:00");
  expect(model.semanticFreshness).toBe("stale");
  expect(model.coverage).toBe("incomplete");
  expect(model.skippedTargets).toEqual(["authority:architecture"]);
  expect(model.findings.map((row) => row.finding.title)).toEqual([
    "Portal direction needs a decision path",
  ]);
  expect(model.findings[0]?.promotion).toMatchObject({
    available: true,
    kind: "alignment-check",
    id: "alignment-check:portal",
    title: "Confirm the Portal revision",
    status: "open",
    source: { displayLocator: ".bearing/state/alignment-checks/portal.md" },
  });
});

test("resolves a completed Planning Review without turning its Audit finding into Attention", () => {
  const snapshot = createProjectAuditFixture();
  if (
    snapshot.audit.validity !== "available" ||
    snapshot.reviews.validity === "invalid" ||
    snapshot.reviews.items[0] === undefined
  ) {
    throw new Error("Expected Audit and Planning Review fixtures.");
  }
  const finding = snapshot.audit.value.findings[0];
  if (finding === undefined) throw new Error("Expected one finding.");
  const review = snapshot.reviews.items[0];
  const completed = {
    ...snapshot,
    reviews: { ...snapshot.reviews, items: [{ ...review, status: "completed" as const }] },
    audit: {
      validity: "available",
      value: {
        ...snapshot.audit.value,
        findings: [
          {
            ...finding,
            promotion: { kind: "planning-review" as const, id: review.id },
          },
        ],
      },
    },
    attention: snapshot.attention.filter(
      (item) => item.kind !== "planning-review" || item.id !== review.id,
    ),
  } as ProjectSnapshot;

  const model = buildProjectAuditModel(completed);
  if (model.state !== "available") throw new Error("Expected available Audit.");
  expect(model.findings[0]?.promotion).toMatchObject({
    available: true,
    kind: "planning-review",
    id: "planning-review:sequence",
    title: "Review the current sequence",
    status: "completed",
    source: { displayLocator: ".bearing/state/planning-reviews/sequence.md" },
  });
  expect(completed.attention.some((item) => item.kind === "planning-review")).toBe(false);
});

test("builds a provenance-only finding inspection with explicit confidence boundaries", () => {
  const model = buildProjectAuditModel(createProjectAuditFixture());
  if (model.state !== "available") throw new Error("Expected available Audit.");
  const row = model.findings[0];
  if (row === undefined) throw new Error("Expected one finding.");

  expect(findingInspection(row)).toMatchObject({
    eyebrow: "Audit Finding · Alignment Check",
    title: "Portal direction needs a decision path",
    detail: "The accepted direction and current implementation need an explicit review.",
    source: { displayLocator: ".bearing/state/planning-audit.md" },
    facts: [
      { label: "Finding ID", value: AUDIT_FINDING_ID, code: true },
      { label: "Decision path", value: "Alignment Check" },
      { label: "Decision ID", value: "alignment-check:portal", code: true },
      { label: "Decision title", value: "Confirm the Portal revision" },
      { label: "Decision status", value: "open" },
      {
        label: "Decision source",
        value: ".bearing/state/alignment-checks/portal.md",
      },
      {
        label: "Decision Source ref",
        value: expect.stringMatching(/^source:[0-9a-f]{64}$/u),
        code: true,
      },
    ],
  });
  expect(findingInspection(row).sections).toEqual([
    {
      title: "Affected references",
      items: ["roadmap:portal", ".scratch/portal/map.md"],
    },
    {
      title: "Evidence",
      body: "Display-only Source provenance; no file capability is granted.",
      items: [expect.stringContaining(".bearing/state/roadmaps/portal.md · Source source:")],
    },
    {
      title: "Consequence",
      body: "The question should remain visible until the Check is resolved.",
    },
    {
      title: "Confidence boundary",
      body: "The Audit does not decide whether the revision is accepted.",
    },
  ]);
});

test("distinguishes absent, invalid, zero-finding, and trustworthy partial Audits", () => {
  const snapshot = createProjectAuditFixture();
  expect(buildProjectAuditModel({ ...snapshot, audit: { validity: "absent" } })).toEqual({
    state: "absent",
  });
  expect(
    buildProjectAuditModel({
      ...snapshot,
      audit: {
        validity: "invalid",
        issues: [{ code: "invalid-planning-audit", target: "audit", message: "Audit is invalid." }],
      },
    } as ProjectSnapshot),
  ).toEqual({ state: "invalid", issueCount: 1 });

  if (snapshot.audit.validity !== "available") throw new Error("Expected available Audit.");
  const zero = buildProjectAuditModel({
    ...snapshot,
    audit: { validity: "available", value: { ...snapshot.audit.value, findings: [] } },
  });
  expect(zero.state === "available" && zero.findings).toEqual([]);

  const partial = buildProjectAuditModel({
    ...snapshot,
    audit: {
      validity: "partial",
      value: snapshot.audit.value,
      issues: [
        {
          code: "invalid-audit-finding",
          target: ".bearing/state/planning-audit.md#finding-2",
          message: "One finding is unavailable.",
        },
      ],
    },
  } as ProjectSnapshot);
  expect(partial.state).toBe("partial");
  expect(partial.state === "partial" && partial.issueCount).toBe(1);
  expect(partial.state === "partial" && partial.findings).toHaveLength(1);
});

test("keeps a schema-valid unavailable promotion visible without losing evidence", () => {
  const model = buildProjectAuditModel(createUnavailableAuditPromotionFixture());
  if (model.state !== "partial") throw new Error("Expected partial Audit.");
  const row = model.findings[0];
  if (row === undefined) throw new Error("Expected retained finding.");

  expect(row.promotion).toMatchObject({
    available: false,
    id: "alignment-check:portal",
    title: undefined,
    status: undefined,
  });
  expect(
    findingInspection(row).sections?.find((section) => section.title === "Evidence")?.items,
  ).toEqual([expect.stringContaining(".bearing/state/roadmaps/portal.md · Source source:")]);
  expect(findingInspection(row).facts).toContainEqual({
    label: "Decision status",
    value: "Unavailable",
  });
});

test("keeps every deterministic browser Audit fixture inside the public Snapshot schema", () => {
  expect(
    [
      createAbsentProjectAuditFixture(),
      createProjectAuditFixture(),
      createZeroProjectAuditFixture(),
      createPartialProjectAuditFixture(),
      createUnavailableAuditPromotionFixture(),
      createInvalidProjectAuditFixture(),
    ].map((snapshot) => snapshot.audit.validity),
  ).toEqual(["absent", "available", "available", "partial", "partial", "invalid"]);
});
