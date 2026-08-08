import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { fingerprintFiles } from "../src/fingerprint";
import { parseMarkdownEnvelope } from "../src/markdown-document";
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

test("Sync computes and persists Planning Audit freshness", async () => {
  const root = await createValidBearingRepo();
  const summary = await fingerprintFiles(root, [".bearing/state/project-summary.md"]);
  await writeAudit(root, summary.fingerprint);

  const current = await runSync(root);
  expect(current.advisoryFreshness).toEqual({ "planning-audit:current": "current" });

  await writeFixture(root, ".bearing/state/project-summary.md", "changed\n");
  const mixed = await runSync(root);
  expect(mixed.advisoryFreshness).toEqual({ "planning-audit:current": "stale" });
  const sitemap = parseMarkdownEnvelope(await readFile(mixed.sitemapPath, "utf8"));
  expect(sitemap.ok).toBe(true);
  if (!sitemap.ok) throw new Error("Expected a valid Sitemap envelope.");
  expect(sitemap.data["Advisory freshness"]).toEqual(mixed.advisoryFreshness);
});

test("Sync records unknown when a valid Audit basis cannot be checked", async () => {
  const root = await createValidBearingRepo();
  await writeFixture(
    root,
    ".bearing/state/planning-audit.md",
    `---
Type: planning-audit
ID: planning-audit:current
Title: Current Audit
Generated at: 2026-07-13T20:00:00+0800
Inputs:
  - docs/missing.md
Input fingerprint: sha256:${"a".repeat(64)}
Coverage: complete
Skipped targets: []
---

# Planning Audit

## Findings

No material findings.
`,
  );

  const result = await runSync(root);

  expect(result.advisoryFreshness).toEqual({ "planning-audit:current": "unknown" });
  expect(await readFile(result.sitemapPath, "utf8")).toContain(
    "`planning-audit:current` | Current Audit | unknown",
  );
});

test("Sync preserves freshness for a contained advisory basis outside Sitemap discovery", async () => {
  const root = await createValidBearingRepo();
  await writeFixture(root, "notes/advisory-basis.md", "# Advisory basis\n");
  const basis = await fingerprintFiles(root, ["notes/advisory-basis.md"]);
  await writeAudit(root, basis.fingerprint);
  const audit = await readFile(`${root}/.bearing/state/planning-audit.md`, "utf8");
  await writeFixture(
    root,
    ".bearing/state/planning-audit.md",
    audit.replace(".bearing/state/project-summary.md", "notes/advisory-basis.md"),
  );

  const result = await runSync(root);

  expect(result.advisoryFreshness).toEqual({ "planning-audit:current": "current" });
  expect(result.inputs).toContain("notes/advisory-basis.md");
});
