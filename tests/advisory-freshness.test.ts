import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { fingerprintFiles } from "../src/fingerprint";
import { parseFrontmatter } from "../src/frontmatter";
import { runSync } from "../src/sync";
import { createValidBearingRepo, writeFixture } from "./helpers";

const writeAudit = async (root: string, fingerprint: string): Promise<void> => {
  await writeFixture(
    root,
    ".bearing/state/planning-audit.md",
    `---
Type: planning-audit
ID: planning-audit:current
Title: Current Audit
Generated at: 2026-07-13T20:00:00+0800
Inputs:
  - .bearing/state/project-summary.md
Input fingerprint: ${fingerprint}
Coverage: complete
Skipped targets: []
---

# Planning Audit

## Findings

No material findings.
`,
  );
};

const writeGuidance = async (
  root: string,
  inputs: readonly string[],
  fingerprint: string,
): Promise<void> => {
  const inputLines = inputs.map((input) => `  - ${input}`).join("\n");
  await writeFixture(
    root,
    ".bearing/state/next-work-guidance.md",
    `---
Type: next-work-guidance
ID: next-work-guidance:current
Title: Current Guidance
Generated at: 2026-07-13T20:00:00+0800
Inputs:
${inputLines}
Input fingerprint: ${fingerprint}
Semantic coverage: absent
---

# Next Work Guidance

## Primary Recommendation

### Continue the Roadmap

Advance the current focused Gate.

#### Supporting References

- \`roadmap:test\`

## Alternatives

### Inspect the Gate

Review its remaining exit criteria.

#### Supporting References

- \`gate:test\`

### Review the native Map

Inspect the current Effort frontier.

#### Supporting References

- \`.scratch/work/map.md\`
`,
  );
};

test("Sync computes and persists advisory freshness independently", async () => {
  const root = await createValidBearingRepo();
  const summary = await fingerprintFiles(root, [".bearing/state/project-summary.md"]);
  const roadmap = await fingerprintFiles(root, [".bearing/state/roadmaps/test.md"]);
  await writeAudit(root, summary.fingerprint);
  await writeGuidance(root, roadmap.inputs, roadmap.fingerprint);

  const current = await runSync(root);
  expect(current.advisoryFreshness).toEqual({
    "planning-audit:current": "current",
    "next-work-guidance:current": "current",
  });

  await writeFixture(root, ".bearing/state/project-summary.md", "changed\n");
  const mixed = await runSync(root);
  expect(mixed.advisoryFreshness).toEqual({
    "planning-audit:current": "stale",
    "next-work-guidance:current": "current",
  });
  const sitemap = parseFrontmatter(await readFile(mixed.sitemapPath, "utf8"));
  expect(sitemap.ok).toBe(true);
  if (!sitemap.ok) throw new Error("Expected a valid Sitemap envelope.");
  expect(sitemap.data["Advisory freshness"]).toEqual(mixed.advisoryFreshness);
});

test("Sync records unknown when a valid advisory basis cannot be checked", async () => {
  const root = await createValidBearingRepo();
  await writeGuidance(root, ["docs/missing.md"], `sha256:${"a".repeat(64)}`);

  const result = await runSync(root);

  expect(result.advisoryFreshness).toEqual({ "next-work-guidance:current": "unknown" });
  expect(await readFile(result.sitemapPath, "utf8")).toContain(
    "`next-work-guidance:current` | Current Guidance | unknown",
  );
});

test("Sync preserves freshness for a contained advisory basis outside Sitemap discovery", async () => {
  const root = await createValidBearingRepo();
  await writeFixture(root, "notes/advisory-basis.md", "# Advisory basis\n");
  const basis = await fingerprintFiles(root, ["notes/advisory-basis.md"]);
  await writeGuidance(root, basis.inputs, basis.fingerprint);

  const result = await runSync(root);

  expect(result.advisoryFreshness).toEqual({ "next-work-guidance:current": "current" });
  expect(result.inputs).toContain("notes/advisory-basis.md");
});
