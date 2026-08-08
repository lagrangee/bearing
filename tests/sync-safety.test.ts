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

  test("does not inspect or mutate the removed Native Scope Discovery cache path", async () => {
    const root = await createValidBearingRepo();
    const removedPath = join(root, ".bearing/cache/native-scope-discovery.json");
    await mkdir(removedPath, { recursive: true });

    await runSync(root);

    expect((await lstat(removedPath)).isDirectory()).toBe(true);
  });

  test("rejects a repository root that does not exist", async () => {
    const parent = await createValidBearingRepo();
    await expect(runSync(join(parent, "missing"))).rejects.toThrow(
      "Repository root is unavailable",
    );
  });

  test("diagnoses an external canonical Effort symlink before reading its target", async () => {
    const root = await createValidBearingRepo();
    const outside = await createValidBearingRepo();
    const linkedEffort = join(root, ".bearing/state/efforts/escape.md");
    await symlink(outside, linkedEffort);

    const result = await runSync(root);

    expect(result.inputs).not.toContain(".bearing/state/efforts/escape.md");
    expect(result.diagnostics).toContainEqual({
      code: "unsupported-input-shape",
      impact: "blocking",
      target: ".bearing/state/efforts/escape.md",
      message: "Repository input has an unsupported filesystem shape.",
    });
  });

  test("reports one diagnostic when the native work root is blocked", async () => {
    const root = await createValidBearingRepo();
    const outside = await makeTemporaryDirectory("bearing-external-work-root-");
    await rm(join(root, ".scratch"), { recursive: true });
    await symlink(outside, join(root, ".scratch"));

    const result = await runSync(root, {
      providerObservationIntent: "initial-baseline",
    });

    expect(
      result.diagnostics.filter(
        (diagnostic) =>
          diagnostic.code === "matt.local.scope.invalid" && diagnostic.target === ".scratch/work",
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

    const result = await runSync(root, {
      providerObservationIntent: "initial-baseline",
    });
    const sitemap = await readFile(result.sitemapPath, "utf8");

    expect(result.inputs).not.toContain(locator);
    expect(result.diagnostics).toContainEqual(
      locator.startsWith(".scratch/")
        ? {
            code: "matt.local.input.unsafe",
            impact: "blocking",
            target: locator,
            message:
              "Local Markdown input failed containment, symlink, file-type or identity safety.",
          }
        : {
            code: "repository-input-shared-file",
            impact: "blocking",
            target: locator,
            message: "Repository input must be one unlinked regular file.",
          },
    );
    expect(sitemap).not.toContain("FOREIGN_REPOSITORY_SECRET");
  });

  test("isolates a wrong-shaped optional state directory", async () => {
    const root = await createValidBearingRepo();
    await writeFixture(root, ".bearing/state/planning-reviews", "not a directory\n");

    const result = await runSync(root);
    const sitemap = await readFile(result.sitemapPath, "utf8");

    expect(result.diagnostics).toContainEqual({
      code: "invalid-input-directory",
      impact: "blocking",
      target: ".bearing/state/planning-reviews",
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

    const result = await runSync(root, {
      providerObservationIntent: "initial-baseline",
    });
    const sitemap = await readFile(result.sitemapPath, "utf8");

    expect(result.diagnostics).toContainEqual({
      code: "matt.local.scope.invalid",
      impact: "blocking",
      target: ".scratch/work",
      message: "Local scope failed repository containment, symlink or file-type validation.",
    });
    expect(sitemap).toContain("`roadmap:test` | Test Roadmap | active");
  });

  test("isolates a wrong-shaped canonical Effort file", async () => {
    const root = await createValidBearingRepo();
    const effort = join(root, ".bearing/state/efforts/broken.md");
    await mkdir(effort, { recursive: true });

    const result = await runSync(root);
    const sitemap = await readFile(result.sitemapPath, "utf8");

    expect(result.diagnostics).toContainEqual({
      code: "invalid-input-file",
      impact: "blocking",
      target: ".bearing/state/efforts/broken.md",
      message: "Repository input must be a file.",
    });
    expect(sitemap).toContain("`effort:test` | Test Effort | active");
  });
});
