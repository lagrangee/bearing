import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { runSync } from "../src/sync";
import { createValidBearingRepo, writeFixture } from "./helpers";

describe("sync governance review regressions", () => {
  test("projects native Map and Ticket files from an unbound scope", async () => {
    const root = await createValidBearingRepo();
    await writeFixture(
      root,
      ".scratch/unbound/map.md",
      `# Wayfinder Map: Unbound\n\nType: wayfinder:map\nStatus: active\n\n## Not yet specified\n`,
    );
    await writeFixture(
      root,
      ".scratch/unbound/issues/01-ready.md",
      `# Ready Without Binding\n\nType: task\nStatus: open\n\n## Question\n\nWhat changes?\n`,
    );

    const result = await runSync(root);
    const sitemap = await readFile(result.sitemapPath, "utf8");

    expect(sitemap).toContain("`.scratch/unbound/map.md` | Unbound | active");
    expect(sitemap).toContain(
      "`.scratch/unbound/issues/01-ready.md` | Ready Without Binding | open",
    );
    expect(sitemap).not.toContain("source: `.scratch/unbound/effort.md`");
  });

  test("diagnoses invalid manifest and advisory snapshot schemas", async () => {
    const root = await createValidBearingRepo();
    await writeFixture(
      root,
      ".bearing/manifest.json",
      `${JSON.stringify({ schemaVersion: 1, packageVersion: "", surfaces: [], executorProfiles: [] })}\n`,
    );
    await writeFixture(
      root,
      ".bearing/state/planning-audit.md",
      `---\nType: planning-audit\nID: planning-audit:wrong\nGenerated at: now\nInputs: []\nInput fingerprint: sha256:${"a".repeat(64)}\nCoverage: impossible\nSkipped targets: []\n---\n\n# Audit\n`,
    );
    await writeFixture(
      root,
      ".bearing/state/next-work-guidance.md",
      `---\nType: next-work-guidance\nID: next-work-guidance:current\nGenerated at: now\nInputs: []\nInput fingerprint: sha256:${"b".repeat(64)}\nSemantic coverage: complete\n---\n\n# Guidance\n\n## Primary Recommendation\n\nContinue.\n\n## Alternatives\n\n1. One.\n2. Two.\n`,
    );

    const result = await runSync(root);
    const targets = result.diagnostics.map((diagnostic) => diagnostic.target);
    const sitemap = await readFile(result.sitemapPath, "utf8");

    expect(targets).toContain(".bearing/manifest.json");
    expect(targets).toContain(".bearing/state/planning-audit.md");
    expect(targets).toContain(".bearing/state/next-work-guidance.md");
    expect(sitemap).toContain("`invalid:.bearing/state/planning-audit.md` | Audit | invalid");
    expect(sitemap).toContain(
      "`invalid:.bearing/state/next-work-guidance.md` | Guidance | invalid",
    );
    expect(sitemap).not.toContain("`planning-audit:wrong`");
    expect(sitemap).not.toContain("`next-work-guidance:current`");
  });

  test("diagnoses duplicate manifest selections", async () => {
    const root = await createValidBearingRepo();
    await writeFixture(
      root,
      ".bearing/manifest.json",
      `${JSON.stringify({
        schemaVersion: 1,
        packageVersion: "0.0.0-test",
        surfaces: ["agent-skills", "agent-skills"],
        executorProfiles: ["generic-agent", "generic-agent"],
      })}\n`,
    );

    const result = await runSync(root);

    expect(result.diagnostics).toContainEqual({
      code: "invalid-bearing-manifest",
      impact: "blocking",
      target: ".bearing/manifest.json",
      message: "Bearing manifest does not match its package-owned schema.",
    });
  });

  test("diagnoses Next Work Guidance with more than two alternatives", async () => {
    const root = await createValidBearingRepo();
    await writeFixture(
      root,
      ".bearing/state/next-work-guidance.md",
      `---\nType: next-work-guidance\nID: next-work-guidance:current\nGenerated at: now\nInputs: []\nInput fingerprint: sha256:${"b".repeat(64)}\nSemantic coverage: absent\n---\n\n# Guidance\n\n## Primary Recommendation\n\n### Continue\n\nContinue the current work.\n\n#### Supporting References\n\n- \`roadmap:test\`\n\n## Alternatives\n\n### First\n\nUse the first alternative.\n\n#### Supporting References\n\n- \`roadmap:test\`\n\n### Second\n\nUse the second alternative.\n\n#### Supporting References\n\n- \`roadmap:test\`\n\n### Third\n\nUse the third alternative.\n\n#### Supporting References\n\n- \`roadmap:test\`\n`,
    );

    const result = await runSync(root);

    expect(result.diagnostics).toContainEqual({
      code: "invalid-next-work-alternatives",
      impact: "blocking",
      target: ".bearing/state/next-work-guidance.md",
      message: "Next Work Guidance permits zero to two Alternatives.",
    });
  });

  test("diagnoses prose-shaped Next Work Guidance instead of inferring item semantics", async () => {
    const root = await createValidBearingRepo();
    await writeFixture(
      root,
      ".bearing/state/next-work-guidance.md",
      `---\nType: next-work-guidance\nID: next-work-guidance:current\nGenerated at: now\nInputs: []\nInput fingerprint: sha256:${"b".repeat(64)}\nSemantic coverage: absent\n---\n\n# Guidance\n\n## Primary Recommendation\n\nContinue.\n\n## Alternatives\n\n1. One.\n2. Two.\n`,
    );

    const result = await runSync(root);

    expect(result.diagnostics).toContainEqual({
      code: "invalid-next-work-body",
      impact: "blocking",
      target: ".bearing/state/next-work-guidance.md",
      message:
        "Next Work Guidance requires exact Title, Rationale, and Supporting References structure.",
    });
  });

  test("validates an Audit promotion as a scoped canonical reference", async () => {
    const root = await createValidBearingRepo();
    await writeFixture(
      root,
      ".bearing/state/planning-audit.md",
      `---
Type: planning-audit
ID: planning-audit:current
Title: Current Audit
Generated at: 2026-07-14T09:00:00Z
Inputs: []
Input fingerprint: sha256:${"a".repeat(64)}
Coverage: complete
Skipped targets: []
---

# Planning Audit

## Findings

### Gate coherence needs a decision path

The active Gate and current work expose a material semantic question.

#### Affected References

- \`gate:test\`

#### Evidence Sources

- \`.bearing/state/milestone-gates/test.md\`

#### Consequence

The project needs an explicit scoped decision point.

#### Confidence Boundary

The Audit does not accept or resolve the question.

#### Promotion

Alignment Check: \`alignment-check:missing\`
`,
    );

    const result = await runSync(root);

    expect(result.diagnostics).toContainEqual({
      code: "broken-canonical-reference",
      impact: "blocking",
      target: ".bearing/state/planning-audit.md#finding-1",
      message: "Canonical Reference does not resolve.",
    });
  });

  test("Fog prevents ready-for-review even when a Map is marked resolved", async () => {
    const root = await createValidBearingRepo();
    await writeFixture(
      root,
      ".scratch/work/map.md",
      `# Wayfinder Map: Test\n\nType: wayfinder:map\nStatus: resolved\n\n## Not yet specified\n\n- A material question remains.\n`,
    );

    const result = await runSync(root);
    const sitemap = await readFile(result.sitemapPath, "utf8");

    expect(sitemap).toContain("Gate readiness: `gate:test` = not-ready");
  });

  test("blocking work diagnostics make contributing Gate readiness unknown", async () => {
    const root = await createValidBearingRepo();
    await writeFixture(
      root,
      ".scratch/work/issues/02-invalid.md",
      `# Invalid\n\nType: task\nStatus: invented\n\n## Question\n\nCan this be classified?\n`,
    );

    const result = await runSync(root);
    const sitemap = await readFile(result.sitemapPath, "utf8");

    expect(result.diagnostics).toContainEqual({
      code: "unsupported-tracker-status",
      impact: "blocking",
      target: ".scratch/work/issues/02-invalid.md",
      message: "Tracker-native Ticket Status is not supported.",
    });
    expect(sitemap).toContain("Gate readiness: `gate:test` = unknown");
  });

  test("diagnoses missing native blockers and inconsistent Roadmap-Gate-Effort topology", async () => {
    const root = await createValidBearingRepo();
    await writeFixture(
      root,
      ".bearing/state/roadmap-index.md",
      `---\nType: roadmap-index\nRoadmaps:\n  - roadmap:test\n  - roadmap:other\n---\n\n# Roadmap Index\n`,
    );
    await writeFixture(
      root,
      ".bearing/state/roadmaps/other.md",
      `---\nType: roadmap\nID: roadmap:other\nTitle: Other\nStatus: active\nFocused gate: null\nGate order: []\n---\n\n# Roadmap: Other\n\n## Intent\n\nOwn another horizon.\n`,
    );
    await writeFixture(
      root,
      ".bearing/state/milestone-gates/test.md",
      `---\nType: milestone-gate\nID: gate:test\nTitle: Test Gate\nRoadmap: roadmap:other\nStatus: active\n---\n\n# Gate\n\n## Intent\n\nMismatch.\n\n## Exit Criteria\n\n- Resolve.\n`,
    );
    await writeFixture(
      root,
      ".scratch/work/issues/02-missing-blocker.md",
      `# Missing Blocker\n\nType: task\nStatus: open\nBlocked by: 99\n\n## Question\n\nWhere is the blocker?\n`,
    );

    const result = await runSync(root);
    const codes = result.diagnostics.map((diagnostic) => diagnostic.code);

    expect(codes).toContain("gate-roadmap-mismatch");
    expect(codes).toContain("effort-roadmap-gate-mismatch");
    expect(codes).toContain("missing-ticket-blocker");
  });
});
