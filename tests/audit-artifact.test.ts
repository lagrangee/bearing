import { expect, test } from "bun:test";
import { decodeBearingRecordGeneration } from "../src/bearing-record-decoder";
import { normalizeNativeSource } from "../src/native-work";

const analyzeFixture = (locator: string, source: string) => {
  const record = { ...normalizeNativeSource(locator, source), bytes: Buffer.from(source) };
  const decoded = decodeBearingRecordGeneration({
    fingerprint: FINGERPRINT,
    records: [record],
  });
  const result = decoded.records[0];
  if (result === undefined) throw new Error("Test fixture must decode as a Bearing Record.");
  return result.analysis;
};

const FINGERPRINT = `sha256:${"a".repeat(64)}`;
const locator = ".bearing/state/planning-audit.md";
const source = (body: string): string => `---
Type: planning-audit
ID: planning-audit:current
Title: Current Audit
Generated at: 2026-07-14T09:00:00+0800
Inputs: []
Input fingerprint: ${FINGERPRINT}
Coverage: complete
Skipped targets: []
---

${body}
`;
const finding = (title: string, promotion = ""): string => `### ${title}

The accepted horizon and current work need a semantic decision boundary.

#### Affected References

- \`roadmap:bearing-product-evolution\`

#### Evidence Sources

- \`.bearing/state/roadmaps/bearing-product-evolution.md\`

#### Consequence

The project needs an explicit review path.

#### Confidence Boundary

The Audit does not accept or resolve that decision.${promotion}`;

test("blocks a Planning Audit whose whole findings body is invalid", () => {
  const analysis = analyzeFixture(locator, source("# Planning Audit\n\n## Finding"));

  expect(analysis.nodes).toEqual([]);
  expect(analysis.diagnostics).toEqual([
    {
      code: "invalid-planning-audit-body",
      impact: "blocking",
      target: locator,
      message: "Planning Audit requires the exact Findings body structure.",
    },
  ]);
});

test("retains trusted findings and scopes malformed finding diagnostics", () => {
  const trusted = finding(
    "Promoted question",
    "\n\n#### Promotion\n\nAlignment Check: `alignment-check:gate-coherence`",
  );
  const malformed = finding("Malformed question").replace(
    "#### Confidence Boundary",
    "#### Confidence",
  );
  const analysis = analyzeFixture(
    locator,
    source(`# Planning Audit\n\n## Findings\n\n${trusted}\n\n${malformed}`),
  );

  expect(analysis.nodes).toEqual([{ id: "planning-audit:current", locator }]);
  expect(analysis.references).toEqual([
    {
      source: `${locator}#finding-1`,
      target: "roadmap:bearing-product-evolution",
    },
    {
      source: `${locator}#finding-1`,
      target: "alignment-check:gate-coherence",
    },
  ]);
  expect(analysis.diagnostics).toEqual([
    {
      code: "invalid-planning-audit-finding",
      impact: "non-blocking",
      target: `${locator}#finding-2`,
      message: "Planning Audit finding 2 does not match the exact finding structure.",
    },
  ]);
});
