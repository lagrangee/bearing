import { beforeAll, describe, expect, test } from "bun:test";
import { access, lstat, readFile, readlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { installKit } from "../src/installer";
import { setupRepository } from "../src/repo-setup";
import { makeTemporaryDirectory } from "./helpers";

const skillNames = [
  "bearing",
  "bearing-setup",
  "bearing-summary",
  "bearing-roadmap",
  "bearing-milestone-gate",
  "bearing-alignment-check",
  "bearing-planning-audit",
  "bearing-planning-review",
  "bearing-next-work",
] as const;

describe("Bearing kit installer", () => {
  beforeAll(async () => {
    const result = await Bun.build({
      entrypoints: [join(process.cwd(), "src/cli.ts")],
      outdir: join(process.cwd(), "dist"),
      target: "node",
    });
    if (!result.success)
      throw new Error("Installer tests could not build the package CLI fixture.");
  });

  test("installs the package bundle, CLI, and owned skill symlinks at user scope", async () => {
    const homeDir = await makeTemporaryDirectory("bearing-home-");
    const packageRoot = process.cwd();

    const result = await installKit({
      homeDir,
      packageRoot,
      surfaces: ["agent-skills", "claude"],
    });

    expect(result.outcome).toBe("applied");
    await access(join(homeDir, ".bearing/bin/bearing"));
    await access(join(homeDir, ".bearing/kit/current/docs/agents/bearing/protocol.md"));
    for (const skillName of skillNames) {
      const canonical = join(homeDir, ".bearing/kit/current/skills", skillName);
      for (const surfaceRoot of [".agents/skills", ".claude/skills"]) {
        const surfaceSkill = join(homeDir, surfaceRoot, skillName);
        expect((await lstat(surfaceSkill)).isSymbolicLink()).toBe(true);
        expect(await readlink(surfaceSkill)).toBe(canonical);
        await access(join(surfaceSkill, "SKILL.md"));
      }
    }

    const rerun = await installKit({
      homeDir,
      packageRoot,
      surfaces: ["agent-skills", "claude"],
    });
    expect(rerun.outcome).toBe("no-op");
    expect(rerun.changedTargets).toEqual([]);
  });

  test("enables a repository without copying protocol or skills into it", async () => {
    const repoRoot = await makeTemporaryDirectory("bearing-project-");
    await writeFile(join(repoRoot, "AGENTS.md"), "# Project rules\n");
    await writeFile(join(repoRoot, "CLAUDE.md"), "# Claude rules\n");

    const result = await setupRepository({
      repoRoot,
      packageRoot: process.cwd(),
      surfaces: ["agent-skills", "claude"],
      profiles: ["generic-agent"],
    });

    expect(result.outcome).toBe("applied");
    const manifest = JSON.parse(await readFile(join(repoRoot, ".bearing/manifest.json"), "utf8"));
    expect(manifest).toMatchObject({
      schemaVersion: 1,
      packageVersion: "0.1.0",
      surfaces: ["agent-skills", "claude"],
      executorProfiles: ["generic-agent"],
    });
    await access(join(repoRoot, ".bearing/executor-profiles/generic-agent.md"));
    const pointer =
      "For every project request, load and follow the global `bearing` skill as the governing runbook.";
    expect(await readFile(join(repoRoot, "AGENTS.md"), "utf8")).toContain(pointer);
    expect(await readFile(join(repoRoot, "CLAUDE.md"), "utf8")).toContain(pointer);
    await expect(access(join(repoRoot, ".bearing/kit/protocol.md"))).rejects.toThrow();
    await expect(access(join(repoRoot, ".agents/skills/bearing/SKILL.md"))).rejects.toThrow();
    await expect(access(join(repoRoot, ".claude/skills/bearing/SKILL.md"))).rejects.toThrow();

    const rerun = await setupRepository({
      repoRoot,
      packageRoot: process.cwd(),
      surfaces: ["agent-skills", "claude"],
      profiles: ["generic-agent"],
    });
    expect(rerun.outcome).toBe("no-op");
  });

  test("preserves a project-owned customized executor profile", async () => {
    const repoRoot = await makeTemporaryDirectory("bearing-project-");
    const profile = join(repoRoot, ".bearing/executor-profiles/generic-agent.md");
    await setupRepository({
      repoRoot,
      packageRoot: process.cwd(),
      surfaces: ["agent-skills"],
      profiles: ["generic-agent"],
    });
    await writeFile(profile, "# User-owned profile\n");

    const reconciled = await setupRepository({
      repoRoot,
      packageRoot: process.cwd(),
      surfaces: ["agent-skills", "claude"],
      profiles: ["generic-agent"],
    });

    expect(reconciled.outcome).toBe("applied");
    expect(await readFile(profile, "utf8")).toBe("# User-owned profile\n");
    expect(await readFile(join(repoRoot, "CLAUDE.md"), "utf8")).toContain("global `bearing`");
  });
});
