import { expect, test } from "bun:test";
import { buildProjectAuditModel } from "../src/portal-ui/project-audit-model";
import type { ProjectSnapshot } from "../src/project-snapshot/contract";
import {
  createAbsentProjectAuditFixture,
  createInvalidProjectAuditFixture,
  createMissingGeneratedTimeAuditFixture,
  createPartialProjectAuditFixture,
  createProjectAuditFixture,
  createUnavailableAuditPromotionFixture,
  createZeroProjectAuditFixture,
} from "./fixtures/project-audit";

test("preserves Audit finding order and resolves its canonical decision path", () => {
  const model = buildProjectAuditModel(createProjectAuditFixture());

  expect(model.current.state).toBe("available");
  if (model.current.state !== "available") throw new Error("Expected available Audit.");
  expect(model.current.generatedAt).toBe("2026-07-14T09:30:00+08:00");
  expect(model.current.semanticFreshness).toBe("stale");
  expect(model.current.coverage).toBe("incomplete");
  expect(model.current.skippedTargets).toEqual(["authority:architecture"]);
  expect(model.current.findings.map((row) => row.finding.title)).toEqual([
    "Portal direction needs a decision path",
  ]);
  expect(model.current.findings[0]?.promotion).toMatchObject({
    available: true,
    kind: "planning-review",
    id: "planning-review:sequence",
    title: "Review the current sequence",
    status: "pending",
  });
  expect(model.pendingReviews.map((review) => String(review.id))).toEqual([
    "planning-review:sequence",
  ]);
  expect(model.completedReviews).toEqual([]);
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
  if (model.current.state !== "available") throw new Error("Expected available Audit.");
  expect(model.current.findings[0]?.promotion).toMatchObject({
    available: true,
    kind: "planning-review",
    id: "planning-review:sequence",
    title: "Review the current sequence",
    status: "completed",
  });
  expect(completed.attention.some((item) => item.kind === "planning-review")).toBe(false);
});

test("distinguishes absent, invalid, zero-finding, and trustworthy partial Audits", () => {
  const snapshot = createProjectAuditFixture();
  expect(buildProjectAuditModel({ ...snapshot, audit: { validity: "absent" } })).toMatchObject({
    current: { state: "absent" },
  });
  expect(
    buildProjectAuditModel({
      ...snapshot,
      audit: {
        validity: "invalid",
        issues: [{ code: "invalid-planning-audit", target: "audit", message: "Audit is invalid." }],
      },
    } as ProjectSnapshot),
  ).toMatchObject({ current: { state: "invalid", issueCount: 1 } });

  if (snapshot.audit.validity !== "available") throw new Error("Expected available Audit.");
  const zero = buildProjectAuditModel({
    ...snapshot,
    audit: { validity: "available", value: { ...snapshot.audit.value, findings: [] } },
  });
  expect(zero.current.state === "available" && zero.current.findings).toEqual([]);

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
  expect(partial.current.state).toBe("partial");
  expect(partial.current.state === "partial" && partial.current.issueCount).toBe(1);
  expect(partial.current.state === "partial" && partial.current.findings).toHaveLength(1);
});

test("keeps a schema-valid unavailable promotion visible without inventing a target", () => {
  const model = buildProjectAuditModel(createUnavailableAuditPromotionFixture());
  if (model.current.state !== "partial") throw new Error("Expected partial Audit.");
  const row = model.current.findings[0];
  if (row === undefined) throw new Error("Expected retained finding.");

  expect(row.promotion).toMatchObject({
    available: false,
    id: "planning-review:sequence",
    title: undefined,
    status: undefined,
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
      createMissingGeneratedTimeAuditFixture(),
    ].map((snapshot) => snapshot.audit.validity),
  ).toEqual(["absent", "available", "available", "partial", "partial", "invalid", "invalid"]);
}, 30_000);

test("projects a missing authored Generated time through the real source decoder", () => {
  const snapshot = createMissingGeneratedTimeAuditFixture();

  expect(snapshot.audit).toMatchObject({
    validity: "invalid",
    issues: [
      {
        code: "invalid-bearing-schema",
        target: ".bearing/state/planning-audit.md",
      },
    ],
  });
});
