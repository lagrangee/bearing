import { expect, test } from "bun:test";
import { access, mkdir, readFile, readlink, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { installPackedProduct } from "./product-seams/installed-product";

const absent = async (target: string): Promise<void> => {
  await expect(access(target)).rejects.toThrow();
};

test("packed install detects complete Skill Directories and accepts a three-surface keyboard selection", async () => {
  const product = await installPackedProduct();
  const home = product.homeDir;
  const currentSkill = join(home, ".bearing/kit/current/skills/bearing");
  const agentSkills = join(home, ".agents/skills");
  const claudeSkills = join(home, ".claude/skills");
  const workbuddySkills = join(home, ".workbuddy/skills");

  try {
    await Promise.all([
      mkdir(agentSkills, { recursive: true }),
      mkdir(join(home, ".claude"), { recursive: true }),
      mkdir(join(home, ".workbuddy"), { recursive: true }),
    ]);

    const zeroSelected = await product.runTerminal(["install"], "\r", {
      observeRoots: [home],
    });
    expect(zeroSelected.exitClass).toBe("success");
    expect(zeroSelected.stdout).toContain(agentSkills);
    expect(zeroSelected.stdout).not.toContain(claudeSkills);
    expect(zeroSelected.stdout).not.toContain(workbuddySkills);
    expect(zeroSelected.stdout).toMatch(/up\/down[\s\S]*Space[\s\S]*Enter/iu);
    await absent(join(agentSkills, "bearing"));
    await absent(claudeSkills);
    await absent(workbuddySkills);

    await Promise.all([
      mkdir(claudeSkills, { recursive: true }),
      mkdir(workbuddySkills, { recursive: true }),
    ]);
    const allSelected = await product.runTerminal(["install"], " \u001b[B \u001b[B \r", {
      observeRoots: [home],
    });
    expect(allSelected.exitClass).toBe("success");
    for (const root of [agentSkills, claudeSkills, workbuddySkills]) {
      expect(allSelected.stdout).toContain(root);
      expect(await readlink(join(root, "bearing"))).toBe(currentSkill);
    }
    expect(allSelected.stdout).toContain("Agent Surface Integration:");
    expect(allSelected.stdout).toContain("agent-skills: applied");
    expect(allSelected.stdout).toContain("claude: applied");
    expect(allSelected.stdout).toContain("workbuddy: applied");
  } finally {
    await product.dispose();
  }
}, 60_000);

test("packed install repairs owned links and isolates each surface conflict after Kit success", async () => {
  const product = await installPackedProduct();
  const home = product.homeDir;
  const current = join(home, ".bearing/kit/current");
  const currentSkill = join(current, "skills/bearing");
  const targets = {
    "agent-skills": join(home, ".agents/skills/bearing"),
    claude: join(home, ".claude/skills/bearing"),
    workbuddy: join(home, ".workbuddy/skills/bearing"),
  };
  const external = join(product.root, "user-owned-skill");

  try {
    await Promise.all([
      mkdir(join(home, ".agents/skills"), { recursive: true }),
      mkdir(join(home, ".claude/skills"), { recursive: true }),
      mkdir(join(home, ".workbuddy/skills"), { recursive: true }),
      mkdir(external),
    ]);
    const installed = await product.run(["install"], { observeRoots: [home] });
    expect(installed.exitClass).toBe("success");

    await symlink(join(home, ".bearing/kit/0.1.1/skills/bearing"), targets["agent-skills"], "dir");
    await symlink(external, targets.claude, "dir");
    const partial = await product.run(
      ["install", "--surface", "agent-skills", "--surface", "claude", "--surface", "workbuddy"],
      { observeRoots: [home] },
    );
    expect(partial.exitClass).toBe("product-outcome");
    expect(partial.stdout).toContain("Outcome: partial");
    expect(partial.stdout).toContain("Global Kit: no-op");
    expect(partial.stdout).toContain("agent-skills: applied");
    expect(partial.stdout).toContain("claude: conflict");
    expect(partial.stdout).toContain("workbuddy: applied");
    expect(await readlink(targets["agent-skills"])).toBe(currentSkill);
    expect(await readlink(targets.claude)).toBe(external);
    expect(await readlink(targets.workbuddy)).toBe(currentSkill);
    await access(current);

    const currentOwned = await product.run(["install", "--surface", "agent-skills"], {
      observeRoots: [home],
    });
    expect(currentOwned.exitClass).toBe("success");
    expect(currentOwned.stdout).toContain("Outcome: no-op");
    expect(currentOwned.stdout).toContain("agent-skills: no-op");

    await rm(targets.claude);
    await writeFile(targets.claude, "user-owned file\n");
    const regularFile = await product.run(["install", "--surface", "claude"]);
    expect(regularFile.exitClass).toBe("product-outcome");
    expect(regularFile.stdout).toContain("Regular file is preserved");
    expect(await readFile(targets.claude, "utf8")).toBe("user-owned file\n");

    await rm(targets.claude);
    await mkdir(targets.claude);
    const directory = await product.run(["install", "--surface", "claude"]);
    expect(directory.exitClass).toBe("product-outcome");
    expect(directory.stdout).toContain("Directory is preserved");

    await rm(targets.claude, { recursive: true });
    const namespaceLookalike = join(home, ".bearing/kit/not-skills/bearing");
    await symlink(namespaceLookalike, targets.claude, "dir");
    const lookalike = await product.run(["install", "--surface", "claude"]);
    expect(lookalike.exitClass).toBe("product-outcome");
    expect(lookalike.stdout).toContain("Non-owned symbolic link is preserved");
    expect(await readlink(targets.claude)).toBe(namespaceLookalike);

    await rm(join(home, ".workbuddy/skills"), { recursive: true });
    const missing = await product.run(["install", "--surface", "workbuddy"]);
    expect(missing.exitClass).toBe("product-outcome");
    expect(missing.stdout).toContain("Skill Directory is not an existing directory");
    await absent(join(home, ".workbuddy/skills"));
    await access(current);
  } finally {
    await product.dispose();
  }
}, 60_000);

test("packed CLI keeps help read-only and exposes explicit Global Kit primitives", async () => {
  const product = await installPackedProduct();
  const home = product.homeDir;
  const repository = join(product.root, "repository");
  const current = join(home, ".bearing/kit/current");
  const cli = join(home, ".bearing/bin/bearing");
  const skill = join(home, ".agents/skills/bearing");

  try {
    await Promise.all([
      mkdir(join(repository, ".bearing/state"), { recursive: true }),
      mkdir(join(repository, ".bearing/integration"), { recursive: true }),
      mkdir(join(repository, ".bearing/executor-profiles"), { recursive: true }),
      mkdir(join(repository, "evidence"), { recursive: true }),
    ]);
    await writeFile(join(repository, ".bearing/state/project-summary.md"), "canonical state\n");
    await writeFile(
      join(repository, ".bearing/integration/provider.json"),
      "provider configuration\n",
    );
    await writeFile(join(repository, ".bearing/executor-profiles/agent.json"), "profile\n");
    await writeFile(join(repository, "evidence/artifact.md"), "durable artifact\n");

    const help = await product.run([], { observeRoots: [home, repository] });
    expect(help.exitCode).toBe(0);
    expect(help.stdout).toContain("Usage:");
    expect(help.stdout).toContain("bearing install");
    expect(help.stdout).toContain("bearing uninstall");
    expect(help.stdout).not.toContain("maintenance wizard");
    expect(help.stdout).not.toContain("Repair");
    expect(help.effects).toEqual({ created: [], changed: [], removed: [] });

    const installed = await product.run(["install"], { observeRoots: [home, repository] });
    expect(installed.exitCode).toBe(0);
    expect(installed.stdout).toContain("Outcome: applied");
    expect(installed.stdout).toContain('export PATH="$HOME/.bearing/bin:$PATH"');
    expect(installed.stdout).toMatch(/current session/iu);
    expect(installed.stdout).toMatch(/startup profile/iu);
    expect(await readlink(cli)).toBe(join(current, "dist/cli.js"));
    await absent(skill);
    expect(
      [
        ...installed.effects.created,
        ...installed.effects.changed,
        ...installed.effects.removed,
      ].filter((locator) => locator.startsWith("root-1/")),
    ).toEqual([]);

    await mkdir(join(home, ".agents/skills"), { recursive: true });
    const integrated = await product.run(["install", "--surface", "agent-skills"], {
      observeRoots: [home, repository],
    });
    expect(integrated.exitCode).toBe(0);
    expect(await readlink(skill)).toBe(join(current, "skills/bearing"));
    expect(
      [
        ...integrated.effects.created,
        ...integrated.effects.changed,
        ...integrated.effects.removed,
      ].filter((locator) => locator.startsWith("root-1/")),
    ).toEqual([]);

    const catalog = join(home, ".bearing/catalog.sqlite");
    const nativeWork = join(repository, ".scratch/work.md");
    const unmanagedSurfaceEntry = join(home, ".claude/skills/bearing");
    await mkdir(join(repository, ".scratch"), { recursive: true });
    await mkdir(join(home, ".claude/skills"), { recursive: true });
    await writeFile(catalog, "catalog sentinel\n");
    await writeFile(nativeWork, "native work\n");
    await writeFile(unmanagedSurfaceEntry, "user-owned Claude entry\n");

    const uninstalled = await product.run(["uninstall"], {
      observeRoots: [home, repository],
    });
    expect(uninstalled.exitCode).toBe(0);
    expect(uninstalled.stdout).toContain("Outcome: applied");
    await absent(current);
    await absent(cli);
    await absent(skill);
    expect(await readFile(catalog, "utf8")).toBe("catalog sentinel\n");
    expect(await readFile(join(repository, ".bearing/state/project-summary.md"), "utf8")).toBe(
      "canonical state\n",
    );
    expect(await readFile(join(repository, ".bearing/integration/provider.json"), "utf8")).toBe(
      "provider configuration\n",
    );
    expect(await readFile(join(repository, ".bearing/executor-profiles/agent.json"), "utf8")).toBe(
      "profile\n",
    );
    expect(await readFile(join(repository, "evidence/artifact.md"), "utf8")).toBe(
      "durable artifact\n",
    );
    expect(await readFile(nativeWork, "utf8")).toBe("native work\n");
    expect(await readFile(unmanagedSurfaceEntry, "utf8")).toBe("user-owned Claude entry\n");
    expect(
      [
        ...uninstalled.effects.created,
        ...uninstalled.effects.changed,
        ...uninstalled.effects.removed,
      ].filter((locator) => locator.startsWith("root-1/")),
    ).toEqual([]);

    const repeatedUninstall = await product.run(["uninstall"], {
      observeRoots: [home, repository],
    });
    expect(repeatedUninstall.exitCode).toBe(0);
    expect(repeatedUninstall.stdout).toContain("Outcome: no-op");
    expect(repeatedUninstall.effects).toEqual({ created: [], changed: [], removed: [] });

    await mkdir(join(home, ".agents/skills"), { recursive: true });
    await writeFile(skill, "user-owned skill\n");
    const conflicted = await product.run(["install", "--surface", "agent-skills"], {
      observeRoots: [home, repository],
    });
    expect(conflicted.exitCode).not.toBe(0);
    expect(`${conflicted.stdout}\n${conflicted.stderr}`).toContain("Regular file is preserved");
    expect(await readFile(skill, "utf8")).toBe("user-owned skill\n");
    await access(current);
    await rm(skill);

    const explicit = await product.run(["install", "--surface", "agent-skills"], {
      observeRoots: [home, repository],
    });
    expect(explicit.exitCode).toBe(0);
    expect(explicit.stdout).toContain("Outcome: applied");
    expect(explicit.stdout).not.toContain("Select an action");
    expect(await readlink(skill)).toBe(join(current, "skills/bearing"));
  } finally {
    await product.dispose();
  }
}, 60_000);

test("packed exact-candidate install blocks older and unverifiable current Kits without writes", async () => {
  const product = await installPackedProduct();
  const home = product.homeDir;
  const installedPackage = join(home, ".bearing/kit/current/package.json");

  try {
    const installed = await product.run(["install"], { observeRoots: [home] });
    expect(installed.exitCode).toBe(0);
    const metadata = JSON.parse(await readFile(installedPackage, "utf8"));

    await writeFile(installedPackage, `${JSON.stringify({ ...metadata, version: "0.2.0" })}\n`);
    const older = await product.run(["install"], { observeRoots: [home] });
    expect(older.exitCode).not.toBe(0);
    expect(older.stderr).toContain("Older Candidate Blocked");
    expect(older.stderr).toContain("0.2.0");
    expect(older.stderr).toContain(metadata.version);
    expect(older.stderr).not.toContain("confirm-downgrade");
    expect(older.effects).toEqual({ created: [], changed: [], removed: [] });

    await writeFile(
      installedPackage,
      `${JSON.stringify({ ...metadata, name: "not-the-bearing-package" })}\n`,
    );
    const wrongIdentity = await product.run(["install"], { observeRoots: [home] });
    expect(wrongIdentity.exitCode).not.toBe(0);
    expect(wrongIdentity.stderr).toContain("Current Kit Unverifiable");
    expect(wrongIdentity.stderr).toContain(installedPackage);
    expect(wrongIdentity.effects).toEqual({ created: [], changed: [], removed: [] });

    await writeFile(installedPackage, "{untrustworthy\n");
    const unverifiable = await product.run(["install"], { observeRoots: [home] });
    expect(unverifiable.exitCode).not.toBe(0);
    expect(unverifiable.stderr).toContain("Current Kit Unverifiable");
    expect(unverifiable.stderr).toContain(installedPackage);
    expect(unverifiable.stderr).toContain("bearing uninstall");
    expect(unverifiable.stderr).toContain("Fresh Install");
    expect(unverifiable.stderr).not.toContain("Repair");
    expect(unverifiable.effects).toEqual({ created: [], changed: [], removed: [] });
    expect(await readFile(installedPackage, "utf8")).toBe("{untrustworthy\n");
  } finally {
    await product.dispose();
  }
}, 60_000);
