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

test("requires an Audit input for partial or complete Guidance coverage", () => {
  // Given: Guidance declares the current Audit as its semantic basis.
  const withoutAuditInput = {
    ...auditBasedGuidance,
    Inputs: [".bearing/state/project-summary.md"],
  };

  // When / Then: only an exact declared Audit input satisfies the source contract.
  expect(bearingSchema.safeParse(auditBasedGuidance).success).toBe(true);
  expect(bearingSchema.safeParse(withoutAuditInput).success).toBe(false);
  expect(
    bearingSchema.safeParse({ ...withoutAuditInput, "Semantic coverage": "partial" }).success,
  ).toBe(false);
});

test("rejects an Audit input for absent coverage and requires normalized unique Inputs", () => {
  // Given: the same structural Audit locator appears in impossible source states.
  const absentWithAuditInput = {
    ...auditBasedGuidance,
    "Semantic coverage": "absent",
    "Based on audit": undefined,
  };

  // When / Then: coverage, basis, and the normalized input set remain one coherent contract.
  expect(bearingSchema.safeParse(absentWithAuditInput).success).toBe(false);
  expect(
    bearingSchema.safeParse({
      ...auditBasedGuidance,
      Inputs: [".bearing/state/planning-audit.md", ".bearing/state/planning-audit.md"],
    }).success,
  ).toBe(false);
  expect(
    bearingSchema.safeParse({
      ...auditBasedGuidance,
      Inputs: [".bearing/state/../state/planning-audit.md"],
    }).success,
  ).toBe(false);
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
