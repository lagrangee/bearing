import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareReleaseCandidateNotes } from "../scripts/prepare-preview-release";

const repoRoot = join(import.meta.dirname, "..");

test("finalizes one 0.1.1 package identity and matching dated release notes", async () => {
  const [packageMetadata, packageLock, changelog] = await Promise.all([
    readFile(join(repoRoot, "package.json"), "utf8").then(JSON.parse) as Promise<{
      readonly name: string;
      readonly version: string;
    }>,
    readFile(join(repoRoot, "package-lock.json"), "utf8").then(JSON.parse) as Promise<{
      readonly version: string;
      readonly packages: Readonly<Record<string, { readonly version?: string }>>;
    }>,
    readFile(join(repoRoot, "CHANGELOG.md"), "utf8"),
  ]);

  expect(packageMetadata).toMatchObject({ name: "@lagrangee/bearing", version: "0.1.1" });
  expect(packageLock.version).toBe("0.1.1");
  expect(packageLock.packages[""]?.version).toBe("0.1.1");
  expect(changelog).toContain("## 0.1.1 - 2026-08-12");
  expect(changelog).not.toContain("## 0.1.1 - Unreleased");
  const releaseSection = changelog
    .match(/## 0\.1\.1 - 2026-08-12\n([\s\S]*?)(?=\n## |$)/u)?.[1]
    ?.trim();
  if (releaseSection === undefined) throw new Error("0.1.1 changelog section is missing");

  const output = await mkdtemp(join(tmpdir(), "bearing-release-notes-"));
  const notesPath = join(output, "release-notes.md");
  try {
    const notes = await prepareReleaseCandidateNotes({
      repositoryRoot: repoRoot,
      expectedPackage: "@lagrangee/bearing",
      expectedVersion: "0.1.1",
      notesPath,
    });
    expect(await readFile(notesPath, "utf8")).toBe(`${notes}\n`);
    expect(notes).toBe(releaseSection);
    expect(notes).toStartWith("Bearing 0.1.1 strengthens the Public Preview");
    expect(notes).toContain(
      "does not migrate, downgrade, dual-read, or apply compatibility fallback",
    );
    expect(notes).toMatch(/explicit user-authorized removal[\s\S]*Fresh Setup/u);
  } finally {
    await rm(output, { recursive: true, force: true });
  }
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
