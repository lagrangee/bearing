import { describe, expect, test } from "bun:test";
import { runSync } from "../src/sync";
import { prepareSync } from "../src/sync-plan";
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

    const result = await runSync(root, {
      providerObservationIntent: "initial-baseline",
    });

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
      "---\nType: effort\nLifecycle: active\nPlanned at: null\nActivated at: null\nID: [unterminated\n---\n\n# Broken\n",
    );

    const result = await runSync(root, {
      providerObservationIntent: "initial-baseline",
    });

    expect(result.inputs).toContain(".bearing/state/roadmaps/test.md");
    expect(result.diagnostics).toContainEqual({
      code: "malformed-bearing-yaml",
      impact: "blocking",
      target: ".bearing/state/efforts/broken.md",
      message: "Bearing frontmatter is not valid YAML.",
    });
  });

  test("reports duplicate Stable IDs and preserves claimed work with unresolved blockers", async () => {
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

Status: claimed

## Question

What remains?
`,
    );
    await writeFixture(
      root,
      ".scratch/work/issues/03-claimed.md",
      `# Claimed

Type: task

Blocked by: 02

Status: claimed

## Question

Should this have been claimed?
`,
    );

    const result = await prepareSync(root, {
      providerObservationIntent: "initial-baseline",
    });

    expect(result.diagnostics.filter((item) => item.code === "duplicate-stable-id")).toHaveLength(
      2,
    );
    const capture = result.providerObservations[0];
    if (capture === undefined || (capture.state !== "available" && capture.state !== "partial")) {
      throw new Error("Expected a provider capture.");
    }
    expect(
      capture.projection.graph.blockedBy.map((relation) => ({
        blocked: String(relation.blocked),
        blocker: String(relation.blocker),
        evidence: relation.evidence,
      })),
    ).toContainEqual({
      blocked: ".scratch/work/issues/03-claimed.md",
      blocker: ".scratch/work/issues/02-blocked.md",
      evidence: "matt-contract",
    });
    expect(capture.projection.wayfinderTickets).toContainEqual(
      expect.objectContaining({
        ref: ".scratch/work/issues/03-claimed.md",
        claim: { state: "claimed" },
        lifecycle: { state: "open" },
      }),
    );
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

    const result = await runSync(root, {
      providerObservationIntent: "initial-baseline",
    });
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
