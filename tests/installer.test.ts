import { beforeAll, describe, expect, test } from "bun:test";
import { access, lstat, mkdir, readFile, readlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { BEARING_POINTER } from "../src/agent-surface-entry";
import { installKit } from "../src/installer";
import { setupRepository } from "../src/repo-setup";
import { LOCAL_MATT_CONTRACT, makeTemporaryDirectory, standardMattAgentSurface } from "./helpers";

const publicSkillNames = ["bearing"] as const;
const internalCompatibilitySkillNames = [
  "bearing-setup",
  "bearing-summary",
  "bearing-roadmap",
  "bearing-milestone-gate",
  "bearing-alignment-check",
  "bearing-planning-audit",
  "bearing-planning-review",
  "bearing-next-work",
] as const;

const writeMattProviderFixture = async (
  repoRoot: string,
  surfaces: readonly ("agent-skills" | "claude")[],
): Promise<string> => {
  const contractLocator = "docs/agents/issue-tracker.md";
  await mkdir(join(repoRoot, "docs/agents"), { recursive: true });
  await writeFile(join(repoRoot, contractLocator), LOCAL_MATT_CONTRACT);
  for (const surface of surfaces) {
    const target = join(repoRoot, surface === "agent-skills" ? "AGENTS.md" : "CLAUDE.md");
    const existing = await readFile(target, "utf8");
    await writeFile(
      target,
      `${existing.trimEnd()}\n\n${standardMattAgentSurface(contractLocator)}`,
    );
  }
  return contractLocator;
};

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
    await access(
      join(
        homeDir,
        ".bearing/kit/current/skills/bearing/references/contracts/canonical-mutation.md",
      ),
    );
    await access(
      join(homeDir, ".bearing/kit/current/skills/bearing/references/journeys/configure.md"),
    );
    for (const skillName of publicSkillNames) {
      const canonical = join(homeDir, ".bearing/kit/current/skills", skillName);
      for (const surfaceRoot of [".agents/skills", ".claude/skills"]) {
        const surfaceSkill = join(homeDir, surfaceRoot, skillName);
        expect((await lstat(surfaceSkill)).isSymbolicLink()).toBe(true);
        expect(await readlink(surfaceSkill)).toBe(canonical);
        await access(join(surfaceSkill, "SKILL.md"));
      }
    }
    for (const skillName of internalCompatibilitySkillNames) {
      await expect(
        access(join(homeDir, ".bearing/kit/current/skills", skillName, "SKILL.md")),
      ).rejects.toThrow();
      for (const surfaceRoot of [".agents/skills", ".claude/skills"]) {
        await expect(access(join(homeDir, surfaceRoot, skillName))).rejects.toThrow();
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

  test("fails closed on a user-owned public skill conflict before installing the branch package", async () => {
    const homeDir = await makeTemporaryDirectory("bearing-home-conflict-");
    const conflict = join(homeDir, ".agents/skills/bearing");
    await mkdir(join(homeDir, ".agents/skills"), { recursive: true });
    await writeFile(conflict, "user-owned skill entry\n");

    await expect(
      installKit({
        homeDir,
        packageRoot: process.cwd(),
        surfaces: ["agent-skills"],
      }),
    ).rejects.toThrow("conflicts with existing content");

    expect(await readFile(conflict, "utf8")).toBe("user-owned skill entry\n");
    await expect(access(join(homeDir, ".bearing/kit/current/package.json"))).rejects.toThrow();
  });

  test("enables a provider-backed repository without copying package contracts, skills, or profiles", async () => {
    const repoRoot = await makeTemporaryDirectory("bearing-project-");
    await writeFile(join(repoRoot, "AGENTS.md"), "# Project rules\n");
    await writeFile(join(repoRoot, "CLAUDE.md"), "# Claude rules\n");
    const contractLocator = await writeMattProviderFixture(repoRoot, ["agent-skills", "claude"]);

    const result = await setupRepository({
      repoRoot,
      packageRoot: process.cwd(),
      surfaces: ["agent-skills", "claude"],
      profiles: [],
      provider: { key: "matt-skills/v1", contractLocator },
    });

    expect(result.outcome).toBe("applied");
    const manifest = JSON.parse(await readFile(join(repoRoot, ".bearing/manifest.json"), "utf8"));
    expect(manifest).toMatchObject({
      schemaVersion: 1,
      status: "active",
      surfaces: ["agent-skills", "claude"],
      executorProfiles: [],
    });
    await expect(access(join(repoRoot, ".bearing/executor-profiles"))).rejects.toThrow();
    const pointer = BEARING_POINTER;
    expect(await readFile(join(repoRoot, "AGENTS.md"), "utf8")).toContain(pointer);
    expect(await readFile(join(repoRoot, "CLAUDE.md"), "utf8")).toContain(pointer);
    await expect(access(join(repoRoot, ".bearing/kit/protocol.md"))).rejects.toThrow();
    await expect(access(join(repoRoot, ".agents/skills/bearing/SKILL.md"))).rejects.toThrow();
    await expect(access(join(repoRoot, ".claude/skills/bearing/SKILL.md"))).rejects.toThrow();

    const rerun = await setupRepository({
      repoRoot,
      packageRoot: process.cwd(),
      surfaces: ["agent-skills", "claude"],
      profiles: [],
      provider: { key: "matt-skills/v1", contractLocator },
    });
    expect(rerun.outcome).toBe("no-op");
  });

  test("rejects the removed fixed-profile compatibility path without mutating the repository", async () => {
    const repoRoot = await makeTemporaryDirectory("bearing-project-");
    const agentsPath = join(repoRoot, "AGENTS.md");
    await writeFile(agentsPath, "# Project rules\n");

    await expect(
      setupRepository({
        repoRoot,
        packageRoot: process.cwd(),
        surfaces: ["agent-skills"],
        profiles: ["generic-agent"],
      }),
    ).rejects.toThrow("requires a selected-surface Matt provider contract");

    expect(await readFile(agentsPath, "utf8")).toBe("# Project rules\n");
    await expect(access(join(repoRoot, ".bearing"))).rejects.toThrow();
  });
});
