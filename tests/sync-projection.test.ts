import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { runSync } from "../src/sync";
import { createValidBearingRepo, writeFixture } from "./helpers";

const runInitialSync = (root: string) =>
  runSync(root, { providerObservationIntent: "initial-baseline" });

describe("bearing sync", () => {
  test("writes byte-stable report and sitemap projections and ignores cache changes", async () => {
    const root = await createValidBearingRepo();

    const first = await runInitialSync(root);
    const firstBytes = await readFile(first.reportPath);
    const firstSitemap = await readFile(first.sitemapPath);
    await writeFixture(root, ".bearing/cache/noise.txt", "disposable\n");
    const second = await runSync(root);
    const secondBytes = await readFile(second.reportPath);
    const secondSitemap = await readFile(second.sitemapPath);

    expect(first.changed).toBe(true);
    expect(second.changed).toBe(false);
    expect(second.fingerprint).toBe(first.fingerprint);
    expect(second.inputs).toEqual(first.inputs);
    expect(secondBytes).toEqual(firstBytes);
    expect(secondSitemap).toEqual(firstSitemap);
    expect(second.diagnostics).toEqual([]);
  });

  test("projects each addressable planning and native work object into the sitemap", async () => {
    const root = await createValidBearingRepo();

    const result = await runInitialSync(root);
    const sitemap = await readFile(result.sitemapPath, "utf8");

    expect(sitemap).toContain("# Bearing Project Sitemap");
    expect(sitemap).toContain("`project-summary:current` | Test Project | current");
    expect(sitemap).toContain("`roadmap:test` | Test Roadmap | active");
    expect(sitemap).toContain("`gate:test` | Test Gate | active");
    expect(sitemap).toContain("`effort:test` | Test Effort | active");
    expect(sitemap).toContain("`.scratch/work/map.md` | Wayfinder Map: Test | resolved");
    expect(sitemap).toContain("`.scratch/work/issues/01-finish.md` | Finish | resolved-on-route");
    expect(sitemap).toContain("roadmap: `roadmap:test`");
    expect(sitemap).toContain("target-gate: `gate:test`");
    expect(sitemap).toContain("source: `.bearing/state/roadmaps/test.md`");
    expect(sitemap).toContain("Gate readiness: `gate:test` = not-ready");
    expect(sitemap).toContain("Attention: 0 blocking diagnostic(s)");
  });

  test("reconciles a direct canonical edit into the sitemap", async () => {
    const root = await createValidBearingRepo();
    const first = await runInitialSync(root);
    const firstSitemap = await readFile(first.sitemapPath, "utf8");
    await writeFixture(
      root,
      ".bearing/state/roadmaps/test.md",
      `---
Type: roadmap
ID: roadmap:test
Title: Renamed Roadmap
Status: active
Focused gate: gate:test
Gate order:
  - gate:test
---

# Roadmap: Renamed

## Intent

Prove reconciliation.
`,
    );

    const second = await runSync(root);
    const secondSitemap = await readFile(second.sitemapPath, "utf8");

    expect(second.changed).toBe(true);
    expect(secondSitemap).not.toEqual(firstSitemap);
    expect(secondSitemap).toContain("`roadmap:test` | Renamed Roadmap | active");
  });

  test("uses the manifest and Project Summary without repository-local Bearing package inputs", async () => {
    const root = await createValidBearingRepo();

    const result = await runInitialSync(root);

    expect(result.inputs).toContain(".bearing/manifest.json");
    expect(result.inputs).toContain(".bearing/state/project-summary.md");
    expect(
      result.inputs.filter(
        (input) => input.startsWith(".bearing/kit/") || input.startsWith("docs/agents/bearing/"),
      ),
    ).toEqual([]);
  });

  test("ignores 0.1.0 Effort sidecars during normal runtime discovery", async () => {
    const root = await createValidBearingRepo();
    await writeFixture(
      root,
      ".scratch/legacy/effort.md",
      `---
Type: effort
Lifecycle: active
Planned at: null
Activated at: null
ID: effort:legacy
Title: Legacy Effort
Roadmap: roadmap:test
Target gate: gate:test
Authorities: []
Citations: []
---

# Effort: Legacy
`,
    );

    const result = await runInitialSync(root);
    const sitemap = await readFile(result.sitemapPath, "utf8");

    expect(result.inputs).not.toContain(".scratch/legacy/effort.md");
    expect(sitemap).not.toContain("effort:legacy");
    expect(result.diagnostics).toEqual([]);
  });

  test("omits readiness action signals for terminal Gates", async () => {
    const root = await createValidBearingRepo();
    await writeFixture(
      root,
      ".bearing/state/milestone-gates/terminal.md",
      `---
Type: milestone-gate
ID: gate:terminal
Title: Terminal Gate
Roadmap: roadmap:test
Status: superseded
Effort order: []
---

# Milestone Gate: Terminal

## Intent

Preserve historical context.

## Exit Criteria

- No longer applicable.
`,
    );

    const result = await runInitialSync(root);
    const sitemap = await readFile(result.sitemapPath, "utf8");

    expect(sitemap).toContain("`gate:terminal` | Terminal Gate | superseded");
    expect(sitemap).not.toContain("Gate readiness: `gate:terminal`");
  });
});
