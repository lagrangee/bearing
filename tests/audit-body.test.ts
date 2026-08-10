import { expect, test } from "bun:test";
import { parsePlanningAuditBody } from "../src/audit-body";

const plainFinding = (title: string): string => `### ${title}

The current relation remains semantically coherent.

#### Affected References

- \`roadmap:bearing-product-evolution\`

#### Evidence Sources

- \`.bearing/state/roadmaps/bearing-product-evolution.md\`

#### Consequence

Current work can retain the accepted planning boundary.

#### Confidence Boundary

The finding does not prove implementation completion.`;

const auditWith = (...findings: readonly string[]): string => `# Planning Audit

## Findings

${findings.join("\n\n")}
`;

test("accepts the exact zero-findings sentinel", () => {
  const body = `# Planning Audit

## Findings

No material findings.
`;

  expect(parsePlanningAuditBody(body)).toEqual({
    ok: true,
    value: { findings: [], invalidFindings: [] },
  });
});

test("parses one exact finding without inventing a promotion", () => {
  const fragment = `### Gate coherence remains clear

The active Gate still matches the accepted Roadmap horizon.

#### Affected References

- \`gate:bearing-g2-agent-surface-loop-proven\`
- \`.scratch/planning-skills-validation/map.md\`

#### Evidence Sources

- \`.bearing/state/milestone-gates/bearing-g2-agent-surface-loop-proven.md\`
- \`.scratch/planning-skills-validation/map.md\`

#### Consequence

Current work can continue against the existing Gate boundary.

#### Confidence Boundary

This finding does not establish that the Gate exit criteria have been met.`;
  const body = `# Planning Audit

## Findings

${fragment}
`;

  expect(parsePlanningAuditBody(body)).toEqual({
    ok: true,
    value: {
      findings: [
        {
          ordinal: 1,
          fragment: "finding-1",
          title: "Gate coherence remains clear",
          summary: "The active Gate still matches the accepted Roadmap horizon.",
          affectedReferences: [
            "gate:bearing-g2-agent-surface-loop-proven",
            ".scratch/planning-skills-validation/map.md",
          ],
          evidenceSources: [
            ".bearing/state/milestone-gates/bearing-g2-agent-surface-loop-proven.md",
            ".scratch/planning-skills-validation/map.md",
          ],
          consequence: "Current work can continue against the existing Gate boundary.",
          confidenceBoundary:
            "This finding does not establish that the Gate exit criteria have been met.",
        },
      ],
      invalidFindings: [],
    },
  });
});

test("parses the two exact optional promotion relations", () => {
  const finding = (title: string, promotion: string): string => `### ${title}

The semantic finding remains advisory until a decision path is opened.

#### Affected References

- \`roadmap:bearing-product-evolution\`

#### Evidence Sources

- \`.bearing/state/roadmaps/bearing-product-evolution.md\`

#### Consequence

The question needs an explicit decision boundary.

#### Confidence Boundary

The audit does not decide the question.

#### Promotion

${promotion}`;
  const body = `# Planning Audit

## Findings

${finding("A scoped question", "Planning Review: `planning-review:gate-coherence`")}

${finding("A project-wide question", "Planning Review: `planning-review:portfolio-balance`")}
`;

  const result = parsePlanningAuditBody(body);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("Expected a trustworthy mixed-promotion Audit.");
  expect(result.value.findings.map(({ promotion }) => promotion)).toEqual([
    { kind: "planning-review", target: "planning-review:gate-coherence" },
    { kind: "planning-review", target: "planning-review:portfolio-balance" },
  ]);
});

test("isolates one malformed finding with its stable ordinal source fragment", () => {
  const malformed = plainFinding("Malformed relation").replace(
    "#### Evidence Sources",
    "#### Evidence Source",
  );
  const result = parsePlanningAuditBody(auditWith(plainFinding("Trusted relation"), malformed));

  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("Expected the trustworthy finding to survive.");
  expect(result.value.findings.map(({ ordinal, title }) => ({ ordinal, title }))).toEqual([
    { ordinal: 1, title: "Trusted relation" },
  ]);
  expect(result.value.invalidFindings).toEqual([{ ordinal: 2, fragment: "finding-2" }]);
});

test("makes the whole body invalid when every finding is malformed", () => {
  const first = plainFinding("Missing evidence").replace("#### Evidence Sources", "#### Source");
  const second = `${plainFinding("Bad promotion")}\n\n#### Promotion\n\nReview: \`planning-review:balance\``;

  expect(parsePlanningAuditBody(auditWith(first, second))).toEqual({
    ok: false,
    reason: "all-findings-invalid",
    invalidFindings: [
      { ordinal: 1, fragment: "finding-1" },
      { ordinal: 2, fragment: "finding-2" },
    ],
  });
});

test("rejects near headings, duplicate references, traversal, markup, and extra structure", () => {
  const valid = plainFinding("Exact finding");
  const invalidBodies = [
    auditWith(valid).replace("## Findings", "## Finding"),
    auditWith(valid).replace("#### Evidence Sources", "#### Evidence Source"),
    auditWith(valid).replace(
      "- `roadmap:bearing-product-evolution`",
      "- `roadmap:bearing-product-evolution`\n- `roadmap:bearing-product-evolution`",
    ),
    auditWith(valid).replace(
      ".bearing/state/roadmaps/bearing-product-evolution.md",
      ".bearing/state/../outside.md",
    ),
    auditWith(valid).replace(
      "The current relation remains semantically coherent.",
      "The **current relation** remains semantically coherent.",
    ),
    auditWith(valid).replace(
      "The current relation remains semantically coherent.",
      "The current relation remains semantically coherent.\n\nSeverity: high",
    ),
    `${auditWith(valid)}\n## Appendix\n`,
    auditWith(valid).replace(
      "#### Confidence Boundary",
      "#### Risk\n\nHigh.\n\n#### Confidence Boundary",
    ),
    auditWith(valid).replace("## Findings\n\n", "## Findings\n\nNo material findings.\n\n"),
  ];

  for (const body of invalidBodies) expect(parsePlanningAuditBody(body).ok).toBe(false);
});
