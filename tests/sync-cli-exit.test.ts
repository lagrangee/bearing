import { beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { createValidBearingRepo, writeFixture } from "./helpers";

const runSyncCli = async (repoRoot: string) => {
  const child = Bun.spawn(
    ["node", join(process.cwd(), "dist/cli.js"), "sync", "--repo", repoRoot],
    { stdout: "pipe", stderr: "pipe" },
  );
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { stdout, stderr, exitCode };
};

describe("bearing sync CLI exit status", () => {
  beforeAll(async () => {
    const result = await Bun.build({
      entrypoints: [join(process.cwd(), "src/cli.ts")],
      outdir: join(process.cwd(), "dist"),
      target: "node",
    });
    if (!result.success) throw new Error("Sync CLI tests could not build the CLI fixture.");
  });

  test("returns nonzero when structural diagnostics include a blocker", async () => {
    const repoRoot = await createValidBearingRepo();
    await writeFixture(
      repoRoot,
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

    const result = await runSyncCli(repoRoot);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toMatch(/Diagnostics: [1-9]\d*/u);
    expect(result.stderr).toBe("");
  });

  test("keeps exit zero when every structural diagnostic is non-blocking", async () => {
    const repoRoot = await createValidBearingRepo();
    await writeFixture(
      repoRoot,
      ".scratch/work/issues/02-open.md",
      `# Open

Type: task

Status: claimed

## Question

What remains?
`,
    );
    await writeFixture(
      repoRoot,
      ".scratch/work/issues/03-claimed.md",
      `# Claimed

Type: task

Blocked by: 02

Status: claimed

## Question

Should this remain claimed?
`,
    );

    const result = await runSyncCli(repoRoot);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Diagnostics: 0");
    expect(result.stderr).toBe("");
  });
});
