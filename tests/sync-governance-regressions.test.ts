import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { runSync as runBearingSync } from "../src/sync";
import { createValidBearingRepo, writeFixture } from "./helpers";

const runSync = (root: string) =>
  runBearingSync(root, { providerObservationIntent: "initial-baseline" });

describe("sync governance review regressions", () => {
  test("does not globally discover native work from an unbound scope", async () => {
    const root = await createValidBearingRepo();
    await writeFixture(
      root,
      ".scratch/unbound/map.md",
      `# Wayfinder Map: Unbound\n\nStatus: active\n\n## Destination\n\nRemain unbound.\n\n## Fog\n`,
    );
    await writeFixture(
      root,
      ".scratch/unbound/issues/01-ready.md",
      `# Ready Without Binding\n\nType: task\n\nStatus: claimed\n\n## Question\n\nWhat changes?\n`,
    );

    const result = await runSync(root);
    const sitemap = await readFile(result.sitemapPath, "utf8");

    expect(result.inputs).not.toContain(".scratch/unbound/map.md");
    expect(result.inputs).not.toContain(".scratch/unbound/issues/01-ready.md");
    expect(sitemap).not.toContain(".scratch/unbound");
  });

  test("fails closed before advisory inspection when the manifest is invalid", async () => {
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
    await expect(runSync(root)).rejects.toThrow(/requires an Active Repository Configuration/iu);
  });

  test("fails closed when the manifest has duplicate selections", async () => {
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

    await expect(runSync(root)).rejects.toThrow(/requires an Active Repository Configuration/iu);
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

Planning Review: \`planning-review:missing\`
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
    const map = await readFile(`${root}/.scratch/work/map.md`, "utf8");
    await writeFixture(
      root,
      ".scratch/work/map.md",
      map.replace("## Fog\n", "## Fog\n\n- A material question remains.\n"),
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
      `# Invalid\n\nType: task\n\nStatus: invented\n\n## Question\n\nCan this be classified?\n`,
    );

    const result = await runSync(root);
    const sitemap = await readFile(result.sitemapPath, "utf8");

    expect(result.diagnostics).toContainEqual({
      code: "matt.local.lifecycle.unknown",
      impact: "blocking",
      target: ".scratch/work/issues/02-invalid.md",
      message: "Wayfinder Status must be claimed or resolved.",
    });
    expect(sitemap).toContain("Gate readiness: `gate:test` = unknown");
  });

  test("diagnoses Gate Effort order that does not exactly cover current contributors", async () => {
    const root = await createValidBearingRepo();
    const gatePath = ".bearing/state/milestone-gates/test.md";
    const gate = await readFile(`${root}/${gatePath}`, "utf8");
    await writeFixture(
      root,
      gatePath,
      gate.replace("Effort order:\n  - effort:test", "Effort order: []"),
    );

    const result = await runSync(root);

    expect(result.diagnostics).toContainEqual({
      code: "gate-effort-order-mismatch",
      impact: "blocking",
      target: gatePath,
      message: "Gate Effort order must exactly cover current contributors: gate:test.",
    });
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
      `---\nType: milestone-gate\nID: gate:test\nTitle: Test Gate\nRoadmap: roadmap:other\nStatus: active\nEffort order:\n  - effort:test\n---\n\n# Gate\n\n## Intent\n\nMismatch.\n\n## Exit Criteria\n\n- Resolve.\n`,
    );
    await writeFixture(
      root,
      ".scratch/work/issues/02-missing-blocker.md",
      `# Missing Blocker\n\nType: task\n\nBlocked by: 99\n\nStatus: claimed\n\n## Question\n\nWhere is the blocker?\n`,
    );

    const result = await runSync(root);
    const codes = result.diagnostics.map((diagnostic) => diagnostic.code);

    expect(codes).toContain("gate-roadmap-mismatch");
    expect(codes).toContain("effort-roadmap-gate-mismatch");
    expect(codes).toContain("matt.local.relation.broken");
  });
});
