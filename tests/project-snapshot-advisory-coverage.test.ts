import { expect, test } from "bun:test";
import { buildAdvisoryProjection } from "../src/project-snapshot/advisory";
import { decodeSourceFixtures } from "./project-snapshot-fixture";

const BASIS = `sha256:${"c".repeat(64)}`;
const auditSource = (coverage: "complete" | "incomplete") => `---
Type: planning-audit
ID: planning-audit:current
Generated at: 2026-07-13T20:00:00+0800
Inputs: []
Input fingerprint: sha256:${"a".repeat(64)}
Coverage: ${coverage}
Skipped targets: ${coverage === "complete" ? "[]" : "\n  - roadmap:test"}
---

# Planning Audit

## Findings

No material findings.
`;
const guidanceSource = (coverage: "complete" | "partial") => `---
Type: next-work-guidance
ID: next-work-guidance:current
Generated at: 2026-07-13T20:01:00+0800
Inputs:
  - .bearing/state/planning-audit.md
Input fingerprint: sha256:${"b".repeat(64)}
Semantic coverage: ${coverage}
Based on audit: planning-audit:current
---

# Next Work Guidance

## Primary Recommendation

### Continue the current Gate

Use the audited project horizon.

#### Supporting References

- \`gate:test\`

## Alternatives

### Inspect the Roadmap

Review the accepted sequence.

#### Supporting References

- \`roadmap:test\`

### Review the native Map

Inspect the current work frontier.

#### Supporting References

- \`.scratch/work/map.md\`
`;

type Scenario = Readonly<{
  auditCoverage: "complete" | "incomplete";
  guidanceCoverage: "complete" | "partial";
  auditFreshness: "current" | "stale" | "unknown";
}>;

const project = (scenario: Scenario) =>
  buildAdvisoryProjection({
    records: decodeSourceFixtures(
      [
        {
          locator: ".bearing/state/planning-audit.md",
          source: auditSource(scenario.auditCoverage),
        },
        {
          locator: ".bearing/state/next-work-guidance.md",
          source: guidanceSource(scenario.guidanceCoverage),
        },
      ],
      BASIS,
    ),
    sitemapFingerprint: BASIS,
    advisoryFreshness: {
      "planning-audit:current": scenario.auditFreshness,
      "next-work-guidance:current": "current",
    },
    checks: { validity: "available", items: [] },
    reviews: { validity: "available", items: [] },
  });

const expectIncompatibleBasis = (scenario: Scenario): void => {
  const projected = project(scenario);
  expect(projected.audit.validity).toBe("available");
  expect(projected.guidance).toEqual({
    validity: "partial",
    value: expect.objectContaining({ semanticCoverage: scenario.guidanceCoverage }),
    issues: [
      expect.objectContaining({
        code: "incompatible-next-work-guidance-audit-basis",
        message: "Next Work Guidance semantic coverage does not match its Planning Audit basis.",
      }),
    ],
  });
};

test("requires Guidance coverage to match a current Audit coverage", () => {
  // Given / When / Then: complete and partial claims cannot invert the current Audit result.
  expectIncompatibleBasis({
    auditCoverage: "incomplete",
    guidanceCoverage: "complete",
    auditFreshness: "current",
  });
  expectIncompatibleBasis({
    auditCoverage: "complete",
    guidanceCoverage: "partial",
    auditFreshness: "current",
  });
  expect(
    project({
      auditCoverage: "complete",
      guidanceCoverage: "complete",
      auditFreshness: "current",
    }).guidance.validity,
  ).toBe("available");
  expect(
    project({
      auditCoverage: "incomplete",
      guidanceCoverage: "partial",
      auditFreshness: "current",
    }).guidance.validity,
  ).toBe("available");
});

test("rejects semantic coverage based on a non-current Audit", () => {
  // Given / When / Then: stale and unknown Audit truth cannot support a coverage claim.
  for (const auditFreshness of ["stale", "unknown"] as const) {
    expectIncompatibleBasis({
      auditCoverage: "complete",
      guidanceCoverage: "complete",
      auditFreshness,
    });
  }
});
