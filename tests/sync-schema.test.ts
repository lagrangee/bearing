import { describe, expect, test } from "bun:test";
import { runSync } from "../src/sync";
import { createValidBearingRepo, writeFixture } from "./helpers";

describe("bearing sync", () => {
  test("diagnoses a Project Summary with missing required synthesis sections", async () => {
    const root = await createValidBearingRepo();
    await writeFixture(
      root,
      ".bearing/state/project-summary.md",
      `---
Type: project-summary
ID: project-summary:current
Title: Incomplete Summary
---

# Project Summary

## Purpose

Only one section exists.
`,
    );

    const result = await runSync(root);

    expect(result.diagnostics).toContainEqual({
      code: "missing-required-section",
      impact: "blocking",
      target: ".bearing/state/project-summary.md",
      message: "Bearing artifact is missing ## Current Design.",
    });
  });

  test("isolates malformed Bearing YAML without blanking healthy objects", async () => {
    const root = await createValidBearingRepo();
    await writeFixture(
      root,
      ".bearing/state/efforts/broken.md",
      "---\nType: effort\nID: [unterminated\n---\n\n# Broken\n",
    );

    const result = await runSync(root);

    expect(result.inputs).toContain(".bearing/state/roadmaps/test.md");
    expect(result.diagnostics).toContainEqual({
      code: "malformed-bearing-yaml",
      impact: "blocking",
      target: ".bearing/state/efforts/broken.md",
      message: "Bearing frontmatter is not valid YAML.",
    });
  });

  test("reports duplicate Stable IDs and claimed work with unresolved blockers", async () => {
    const root = await createValidBearingRepo();
    await writeFixture(
      root,
      ".bearing/state/roadmaps/duplicate.md",
      `---
Type: roadmap
ID: roadmap:test
Title: Duplicate
Status: completed
Focused gate: null
Gate order: []
---

# Roadmap: Duplicate

## Intent

Conflict with the fixture.
`,
    );
    await writeFixture(
      root,
      ".scratch/work/issues/02-blocked.md",
      `# Blocked

Type: task
Status: open

## Question

What remains?
`,
    );
    await writeFixture(
      root,
      ".scratch/work/issues/03-claimed.md",
      `# Claimed

Type: task
Status: claimed
Blocked by: 02

## Question

Should this have been claimed?
`,
    );

    const result = await runSync(root);

    expect(result.diagnostics.filter((item) => item.code === "duplicate-stable-id")).toHaveLength(
      2,
    );
    expect(result.diagnostics).toContainEqual({
      code: "claimed-with-unresolved-blocker",
      impact: "non-blocking",
      target: ".scratch/work/issues/03-claimed.md",
      message: "Claimed Ticket still depends on an unresolved Ticket.",
    });
  });

  test("rejects empty Stable ID slugs and retains an invalid Sitemap shell", async () => {
    const root = await createValidBearingRepo();
    await writeFixture(
      root,
      ".bearing/state/roadmaps/empty.md",
      `---
Type: roadmap
ID: "roadmap:"
Title: Empty ID
Status: completed
Focused gate: null
Gate order: []
---

# Roadmap: Empty ID

## Intent

This ID is invalid.
`,
    );

    const result = await runSync(root);
    const sitemap = await Bun.file(result.sitemapPath).text();

    expect(result.diagnostics).toContainEqual({
      code: "invalid-bearing-schema",
      impact: "blocking",
      target: ".bearing/state/roadmaps/empty.md",
      message: "Bearing frontmatter does not match its minimum schema.",
    });
    expect(sitemap).toContain("`invalid:.bearing/state/roadmaps/empty.md` | Empty ID | invalid");
    expect(sitemap).not.toContain("`roadmap:` | Empty ID");
  });
});
