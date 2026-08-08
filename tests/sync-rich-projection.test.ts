import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { runSync } from "../src/sync";
import { createValidBearingRepo, writeFixture } from "./helpers";

describe("bearing sync", () => {
  test("projects governance history, advisory snapshots, citations, and native dependencies", async () => {
    const root = await createValidBearingRepo();
    const fingerprint = `sha256:${"a".repeat(64)}`;
    await writeFixture(
      root,
      ".bearing/state/efforts/test.md",
      `---
Type: effort
Lifecycle: active
Planned at: null
Activated at: null
ID: effort:test
Title: Test Effort
Roadmap: roadmap:test
Target gate: gate:test
Authorities:
  - authority:product-design
Citations:
  - Asset: asset:design
    Note: The current mock governs this effort.
Work binding:
  Provider: matt-skills/v1
  Native scope: .scratch/work
---

# Effort: Test

## Intent

Exercise the complete sitemap.

## Work

- [Map](map.md)
`,
    );
    await writeFixture(
      root,
      ".bearing/state/assets.md",
      `---
Type: asset-registry
Assets:
  - ID: asset:design
    Title: Current Mock
    Kind: design
    Location: .scratch/work/map.md
    Owner: effort:test
    Producer:
      Kind: planning-skill
      Name: prototype
    Lifecycle source: registry
    Disposition: available
---

# Asset Registry
`,
    );
    await writeFixture(
      root,
      ".bearing/state/authorities/product-design.md",
      `---
Type: authority
ID: authority:product-design
Title: Product Design
Baseline:
  - asset:design
---

# Product Design Authority

## Scope

Product interaction design.

## Current Baseline

The current mock.
`,
    );
    await writeFixture(
      root,
      ".bearing/state/planning-reviews/balance.md",
      `---
Type: planning-review
ID: planning-review:balance
Title: Portfolio balance
Status: pending
Question: Should the project keep its current portfolio balance?
Scope: project
Inputs: []
Input fingerprint: ${fingerprint}
---

# Planning Review: Balance
`,
    );
    await writeFixture(
      root,
      ".bearing/state/planning-audit.md",
      `---
Type: planning-audit
ID: planning-audit:current
Title: Current Audit
Generated at: 2026-07-12T09:00:00Z
Inputs: []
Input fingerprint: ${fingerprint}
Coverage: complete
Skipped targets: []
---

# Planning Audit

## Findings

No material findings.
`,
    );
    await writeFixture(
      root,
      ".scratch/work/issues/02-follow-up.md",
      `# Follow Up

Type: task

Blocked by: 01

Status: claimed

## Question

What follows the completed fixture?
`,
    );

    const result = await runSync(root, {
      providerObservationIntent: "initial-baseline",
    });
    const sitemap = await readFile(result.sitemapPath, "utf8");

    expect(sitemap).toContain("`authority:product-design` | Product Design | current");
    expect(sitemap).toContain("`asset:design` | Current Mock | available");
    expect(sitemap).toContain("citation-count=1");
    expect(sitemap).toContain("`planning-review:balance` | Portfolio balance | pending");
    expect(sitemap).toContain("`planning-audit:current` | Current Audit | stale");
    expect(sitemap).toContain("blocked-by: `.scratch/work/issues/01-finish.md`");
    expect(sitemap).toContain("Attention: 0 blocking diagnostic(s), 1 pending planning review(s).");
    expect(sitemap).toContain("Gate readiness: `gate:test` = not-ready");
  });
});
