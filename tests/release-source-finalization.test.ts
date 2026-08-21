import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const repoRoot = join(import.meta.dirname, "..");

test("retains the published 0.1.1 release history on the development line", async () => {
  const changelog = await readFile(join(repoRoot, "CHANGELOG.md"), "utf8");
  expect(changelog).toContain("## 0.1.1 - 2026-08-12");
  expect(changelog).not.toContain("## 0.1.1 - Unreleased");
  const releaseSection = changelog
    .match(/## 0\.1\.1 - 2026-08-12\n([\s\S]*?)(?=\n## |$)/u)?.[1]
    ?.trim();
  if (releaseSection === undefined) throw new Error("0.1.1 changelog section is missing");

  expect(releaseSection).toStartWith("Bearing 0.1.1 strengthens the Public Preview");
  expect(releaseSection).toMatch(
    /exact 0\.1\.0 repository source[\s\S]*Repository Update[\s\S]*semantic update guide/u,
  );
  expect(releaseSection).toMatch(
    /Canonical state[\s\S]*byte-for-byte unchanged[\s\S]*rebuilds[\s\S]*Project Read Model/u,
  );
  expect(releaseSection).toMatch(/Unknown, corrupt, or unmatched old state[\s\S]*Unsupported/u);
  expect(releaseSection).toMatch(/does not provide a generic migration engine[\s\S]*dual-read/u);
});

test("keeps the release-facing entry points in one tracked source basis", async () => {
  const releaseFacingPaths = [
    "README.md",
    "README.zh-CN.md",
    "docs/agent-installation.md",
    "demo/index.html",
    "SECURITY.md",
    ".github/ISSUE_TEMPLATE/bug_report.yml",
  ] as const;
  const tracked = spawnSync(
    "git",
    ["-C", repoRoot, "ls-files", "--error-unmatch", ...releaseFacingPaths],
    {
      encoding: "utf8",
    },
  );
  expect(tracked.status).toBe(0);
  expect(tracked.stdout.trim().split("\n").sort()).toEqual([...releaseFacingPaths].sort());

  const [readme, readmeZh, agentGuide, demo, security, bugTemplate] = await Promise.all(
    releaseFacingPaths.map((path) => readFile(join(repoRoot, path), "utf8")),
  );
  for (const source of [readme, readmeZh, demo]) {
    expect(source).toContain("https://github.com/lagrangee/bearing/discussions/categories/q-a");
    expect(source).toContain("https://github.com/lagrangee/bearing/discussions/categories/ideas");
    expect(source).toContain("https://github.com/lagrangee/bearing/security/advisories/new");
  }
  expect(readme).toContain("docs/agent-installation.md");
  expect(readmeZh).toContain("docs/agent-installation.md");
  expect(agentGuide).toContain("npx --yes @lagrangee/bearing@<resolved-version> install");
  expect(agentGuide).toContain("use `/bearing setup` there");
  expect(security).toContain("https://github.com/lagrangee/bearing/security/advisories/new");
  expect(bugTemplate).toContain("placeholder: 0.1.1");
  expect(bugTemplate).not.toContain("placeholder: 0.1.0");
});
