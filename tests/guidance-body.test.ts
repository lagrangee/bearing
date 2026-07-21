import { expect, test } from "bun:test";
import { parseNextWorkGuidanceBody } from "../src/guidance-body";

const validBody = `# Next Work Guidance

## Primary Recommendation

### Finish the Project Snapshot seam

Build the shared semantic projection before adding more destinations.

#### Supporting References

- \`.scratch/example-work/issues/11-complete-project-overview.md\`
- \`roadmap:bearing-product-evolution\`

## Alternatives

### Inspect the current Roadmap horizon

Verify that the focused Gate still expresses the accepted sequence.

#### Supporting References

- \`roadmap:bearing-product-evolution\`

### Run a Planning Audit

Use a whole-project semantic review after the projection is trustworthy.

#### Supporting References

- \`gate:bearing-g3-web-visualization-value-proven\`
`;

test("parses exact Guidance title, rationale, and supporting-reference structure", () => {
  expect(parseNextWorkGuidanceBody(validBody)).toEqual({
    ok: true,
    value: {
      primary: {
        title: "Finish the Project Snapshot seam",
        rationale: "Build the shared semantic projection before adding more destinations.",
        supportingReferences: [
          ".scratch/example-work/issues/11-complete-project-overview.md",
          "roadmap:bearing-product-evolution",
        ],
      },
      alternatives: [
        {
          title: "Inspect the current Roadmap horizon",
          rationale: "Verify that the focused Gate still expresses the accepted sequence.",
          supportingReferences: ["roadmap:bearing-product-evolution"],
        },
        {
          title: "Run a Planning Audit",
          rationale: "Use a whole-project semantic review after the projection is trustworthy.",
          supportingReferences: ["gate:bearing-g3-web-visualization-value-proven"],
        },
      ],
    },
  });
});

test("rejects prose-shaped, near-match, duplicate, and reference-free Guidance", () => {
  const cases = [
    validBody.replace(
      "### Finish the Project Snapshot seam\n",
      "Finish the Project Snapshot seam.\n",
    ),
    validBody.replace("#### Supporting References", "#### Evidence"),
    validBody.replace("## Alternatives", "## Alternative"),
    validBody.replace("## Alternatives", "##  Alternatives"),
    validBody.replace(
      "## Alternatives",
      "## Primary Recommendation\n\n### Duplicate\n\nDuplicate.\n\n#### Supporting References\n\n- `roadmap:duplicate`\n\n## Alternatives",
    ),
    validBody.replace(
      "#### Supporting References\n\n- `roadmap:bearing-product-evolution`\n\n### Run a Planning Audit",
      "#### Supporting References\n\n### Run a Planning Audit",
    ),
  ];

  for (const body of cases) expect(parseNextWorkGuidanceBody(body).ok).toBe(false);
});

test("requires exactly two structured Alternatives", () => {
  const oneAlternative = validBody.replace(/\n### Run a Planning Audit[\s\S]*$/u, "\n");
  const result = parseNextWorkGuidanceBody(oneAlternative);
  expect(result).toEqual({ ok: false, reason: "alternatives-count" });
});

test("rejects markup in Guidance titles and rationales without rejecting reference syntax", () => {
  // Given: each candidate puts obvious markup in a normalized title or rationale only.
  const markedUpBodies = [
    validBody.replace(
      "### Finish the Project Snapshot seam",
      "### Finish the `Project Snapshot` seam",
    ),
    validBody.replace(
      "Build the shared semantic projection before adding more destinations.",
      "Build the [shared projection][projection] before adding more destinations.",
    ),
    validBody.replace(
      "Build the shared semantic projection before adding more destinations.",
      "> Build the shared semantic projection before adding more destinations.",
    ),
    validBody.replace(
      "Build the shared semantic projection before adding more destinations.",
      "~~~text\nBuild the shared semantic projection.\n~~~",
    ),
    validBody.replace(
      "Build the shared semantic projection before adding more destinations.",
      "    Build the shared semantic projection.",
    ),
    validBody.replace(
      "Build the shared semantic projection before adding more destinations.",
      "Build the shared projection. <!-- private note -->",
    ),
    validBody.replace(
      "Build the shared semantic projection before adding more destinations.",
      "Build **the shared\nsemantic projection** before adding more destinations.",
    ),
  ];

  // When / Then: Guidance becomes scoped-invalid at its parser boundary.
  for (const body of markedUpBodies) {
    expect(parseNextWorkGuidanceBody(body)).toEqual({
      ok: false,
      reason: "invalid-structure",
    });
  }

  expect(parseNextWorkGuidanceBody(validBody).ok).toBe(true);
});
