import { expect, test } from "bun:test";
import { bearingSchema } from "../src/schema-definitions";

const FINGERPRINT = `sha256:${"a".repeat(64)}`;
const auditBasedGuidance = {
  Type: "next-work-guidance",
  ID: "next-work-guidance:current",
  "Generated at": "2026-07-13T20:01:00+0800",
  Inputs: [".bearing/state/planning-audit.md"],
  "Input fingerprint": FINGERPRINT,
  "Semantic coverage": "complete",
  "Based on audit": "planning-audit:current",
};
const completeAudit = {
  Type: "planning-audit",
  ID: "planning-audit:current",
  "Generated at": "2026-07-14T09:00:00+0800",
  Inputs: [".bearing/state/roadmap-index.md"],
  "Input fingerprint": FINGERPRINT,
  Coverage: "complete",
  "Skipped targets": [],
};
const pendingReview = {
  Type: "planning-review",
  ID: "planning-review:sequence",
  Title: "Review sequence",
  Status: "pending",
  Question: "Should the sequence change?",
  Scope: "project",
  Inputs: [],
  "Input fingerprint": FINGERPRINT,
};
const completedResolution = {
  "Accepted decision": "Keep the sequence.",
  "Accepted at": "2026-08-08T00:00:00.000Z",
  Rationale: "The current sequence remains valid.",
  "Changed references": ["roadmap:test"],
};

test("rejects the retired persisted Next Work Guidance record", () => {
  expect(bearingSchema.safeParse(auditBasedGuidance).success).toBe(false);
});

test("keeps Planning Audit coverage and skipped targets exact", () => {
  expect(bearingSchema.safeParse(completeAudit).success).toBe(true);
  expect(
    bearingSchema.safeParse({
      ...completeAudit,
      "Skipped targets": ["roadmap:bearing-product-evolution"],
    }).success,
  ).toBe(false);
  expect(bearingSchema.safeParse({ ...completeAudit, Coverage: "incomplete" }).success).toBe(false);
  expect(
    bearingSchema.safeParse({
      ...completeAudit,
      Coverage: "incomplete",
      "Skipped targets": ["roadmap:bearing-product-evolution"],
    }).success,
  ).toBe(true);
});

test("requires unique safe Planning Audit inputs and skipped targets", () => {
  const incomplete = {
    ...completeAudit,
    Coverage: "incomplete",
    "Skipped targets": [".scratch/work/map.md"],
  };

  expect(
    bearingSchema.safeParse({
      ...incomplete,
      "Skipped targets": [".scratch/work/map.md", ".scratch/work/map.md"],
    }).success,
  ).toBe(false);
  expect(
    bearingSchema.safeParse({ ...incomplete, "Skipped targets": ["../outside.md"] }).success,
  ).toBe(false);
});

test("keeps Planning Review status and Resolution lifecycle exact", () => {
  expect(bearingSchema.safeParse(pendingReview).success).toBe(true);
  expect(
    bearingSchema.safeParse({
      ...pendingReview,
      Status: "completed",
      Resolution: completedResolution,
    }).success,
  ).toBe(true);
  expect(
    bearingSchema.safeParse({ ...pendingReview, Resolution: completedResolution }).success,
  ).toBe(false);
  expect(bearingSchema.safeParse({ ...pendingReview, Status: "completed" }).success).toBe(false);
});
