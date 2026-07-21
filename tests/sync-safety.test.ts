import { describe, expect, test } from "bun:test";
import { access, link, lstat, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runSync } from "../src/sync";
import { createValidBearingRepo, makeTemporaryDirectory, writeFixture } from "./helpers";

describe("bearing sync", () => {
  test("rejects a cache directory symlink before writing", async () => {
    const root = await createValidBearingRepo();
    const outside = await createValidBearingRepo();
    await symlink(outside, join(root, ".bearing/cache"));

    await expect(runSync(root)).rejects.toThrow("Bearing cache boundary cannot be a symbolic link");
    await expect(access(join(outside, "sync-report.md"))).rejects.toThrow();
  });

  test("does not follow the former predictable sync staging path", async () => {
    const root = await createValidBearingRepo();
    const outside = await makeTemporaryDirectory("bearing-sync-staging-");
    const outsideFile = join(outside, "outside.txt");
    const reportPath = join(root, ".bearing/cache/sync-report.md");
    const formerTemporary = `${reportPath}.${process.pid}.tmp`;
    await mkdir(join(root, ".bearing/cache"), { recursive: true });
    await writeFile(outsideFile, "outside bytes\n");
    await symlink(outsideFile, formerTemporary);

    await runSync(root);

    expect(await readFile(outsideFile, "utf8")).toBe("outside bytes\n");
    expect((await lstat(reportPath)).isSymbolicLink()).toBe(false);
  });

  test("rejects a repository root that does not exist", async () => {
    const parent = await createValidBearingRepo();
    await expect(runSync(join(parent, "missing"))).rejects.toThrow(
      "Repository root is unavailable",
    );
  });

  test("diagnoses an external Effort symlink before reading its target", async () => {
    const root = await createValidBearingRepo();
    const outside = await createValidBearingRepo();
    const linkedEffort = join(root, ".scratch/escape/effort.md");
    await mkdir(join(root, ".scratch/escape"), { recursive: true });
    await symlink(outside, linkedEffort);

    const result = await runSync(root);

    expect(result.inputs).not.toContain(".scratch/escape/effort.md");
    expect(result.diagnostics).toContainEqual({
      code: "repository-input-outside-boundary",
      impact: "blocking",
      target: ".scratch/escape/effort.md",
      message: "Repository input is unavailable or resolves outside the repository.",
    });
  });

  test("reports one diagnostic when the native work root is blocked", async () => {
    const root = await createValidBearingRepo();
    const outside = await makeTemporaryDirectory("bearing-external-work-root-");
    await rm(join(root, ".scratch"), { recursive: true });
    await symlink(outside, join(root, ".scratch"));

    const result = await runSync(root);

    expect(
      result.diagnostics.filter(
        (diagnostic) =>
          diagnostic.code === "repository-input-outside-boundary" &&
          diagnostic.target === ".scratch",
      ),
    ).toHaveLength(1);
  });

  test.each([
    ".bearing/state/project-summary.md",
    "CONTEXT.md",
    ".scratch/work/issues/01-finish.md",
  ])("isolates a source file hard-linked to another repository: %s", async (locator) => {
    const root = await createValidBearingRepo();
    const outside = await makeTemporaryDirectory("bearing-shared-input-");
    const target = join(root, locator);
    const foreign = join(outside, "foreign.md");
    await writeFile(foreign, "FOREIGN_REPOSITORY_SECRET\n");
    await rm(target);
    await link(foreign, target);

    const result = await runSync(root);
    const sitemap = await readFile(result.sitemapPath, "utf8");

    expect(result.inputs).not.toContain(locator);
    expect(result.diagnostics).toContainEqual({
      code: "repository-input-shared-file",
      impact: "blocking",
      target: locator,
      message: "Repository input must be one unlinked regular file.",
    });
    expect(sitemap).not.toContain("FOREIGN_REPOSITORY_SECRET");
  });

  test("keeps a repository-local Asset directory readable", async () => {
    const root = await createValidBearingRepo();
    await writeFixture(
      root,
      ".scratch/work/effort.md",
      `---
Type: effort
ID: effort:test
Title: Test Effort
Roadmap: roadmap:test
Target gate: gate:test
Authorities: []
Citations:
  - Asset: asset:directory
    Note: This directory is a repository-local evidence input.
---

# Effort: Test

## Intent

Exercise a repository-local directory Asset.

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
  - ID: asset:directory
    Title: Directory Asset
    Kind: reference
    Location: evidence/directory
    Owner: effort:test
    Producer:
      Kind: agent-surface
      Name: test
    Lifecycle source: native
---

# Asset Registry
`,
    );
    await writeFixture(root, "evidence/directory/result.bin", new Uint8Array([0, 1, 2]));

    const result = await runSync(root);

    expect(result.inputs).toContain("evidence/directory/result.bin");
    expect(result.diagnostics).not.toContainEqual(
      expect.objectContaining({ target: "evidence/directory" }),
    );
  });

  test("diagnoses an external cited Asset directory even when it is empty", async () => {
    const root = await createValidBearingRepo();
    const outside = await makeTemporaryDirectory("bearing-external-asset-");
    await writeFixture(
      root,
      ".scratch/work/effort.md",
      `---
Type: effort
ID: effort:test
Title: Test Effort
Roadmap: roadmap:test
Target gate: gate:test
Authorities: []
Citations:
  - Asset: asset:outside
    Note: This input is deliberately outside the repository.
---

# Effort: Test

## Intent

Exercise the sync contract.

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
  - ID: asset:outside
    Title: Outside Asset
    Kind: reference
    Location: linked-asset
    Owner: effort:test
    Producer:
      Kind: agent-surface
      Name: test
    Lifecycle source: native
---

# Asset Registry
`,
    );
    await symlink(outside, join(root, "linked-asset"));

    const result = await runSync(root);

    expect(result.diagnostics).toContainEqual({
      code: "repository-input-outside-boundary",
      impact: "blocking",
      target: "linked-asset",
      message: "Repository input is unavailable or resolves outside the repository.",
    });
  });

  test("isolates a wrong-shaped optional state directory", async () => {
    const root = await createValidBearingRepo();
    await writeFixture(root, ".bearing/state/alignment-checks", "not a directory\n");

    const result = await runSync(root);
    const sitemap = await readFile(result.sitemapPath, "utf8");

    expect(result.diagnostics).toContainEqual({
      code: "invalid-input-directory",
      impact: "blocking",
      target: ".bearing/state/alignment-checks",
      message: "Repository input must be a directory.",
    });
    expect(sitemap).toContain("`roadmap:test` | Test Roadmap | active");
  });

  test("isolates a wrong-shaped expected file", async () => {
    const root = await createValidBearingRepo();
    const summary = join(root, ".bearing/state/project-summary.md");
    await rm(summary);
    await mkdir(summary);

    const result = await runSync(root);
    const sitemap = await readFile(result.sitemapPath, "utf8");

    expect(result.diagnostics).toContainEqual({
      code: "invalid-input-file",
      impact: "blocking",
      target: ".bearing/state/project-summary.md",
      message: "Repository input must be a file.",
    });
    expect(sitemap).toContain("`roadmap:test` | Test Roadmap | active");
  });

  test("isolates a wrong-shaped native work root", async () => {
    const root = await createValidBearingRepo();
    await rm(join(root, ".scratch"), { recursive: true });
    await writeFile(join(root, ".scratch"), "not a directory\n");

    const result = await runSync(root);
    const sitemap = await readFile(result.sitemapPath, "utf8");

    expect(result.diagnostics).toContainEqual({
      code: "invalid-input-directory",
      impact: "blocking",
      target: ".scratch",
      message: "Repository input must be a directory.",
    });
    expect(sitemap).toContain("`roadmap:test` | Test Roadmap | active");
  });

  test("isolates a wrong-shaped Effort file", async () => {
    const root = await createValidBearingRepo();
    const effort = join(root, ".scratch/broken/effort.md");
    await mkdir(effort, { recursive: true });

    const result = await runSync(root);
    const sitemap = await readFile(result.sitemapPath, "utf8");

    expect(result.diagnostics).toContainEqual({
      code: "invalid-input-file",
      impact: "blocking",
      target: ".scratch/broken/effort.md",
      message: "Repository input must be a file.",
    });
    expect(sitemap).toContain("`effort:test` | Test Effort | resolved");
  });
});
