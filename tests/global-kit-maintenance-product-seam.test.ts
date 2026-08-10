import { expect, test } from "bun:test";
import { access, mkdir, readFile, readlink, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { installPackedProduct } from "./product-seams/installed-product";

const absent = async (target: string): Promise<void> => {
  await expect(access(target)).rejects.toThrow();
};

test("packed terminal wizard owns global kit maintenance without repository lifecycle effects", async () => {
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

    const cancelled = await product.runTerminal([], "q\n", { observeRoots: [home, repository] });
    expect(cancelled.exitCode).toBe(0);
    expect(cancelled.stdout).toContain("Global Kit maintenance");
    expect(cancelled.stdout).toContain("Outcome: cancelled");
    expect(cancelled.effects).toEqual({ created: [], changed: [], removed: [] });

    const installed = await product.runTerminal([], "1\n", { observeRoots: [home, repository] });
    expect(installed.exitCode).toBe(0);
    expect(installed.stdout).toContain("Action: Install");
    expect(installed.stdout).toContain("Outcome: applied");
    expect(await readlink(cli)).toBe(join(current, "dist/cli.js"));
    expect(await readlink(skill)).toBe(join(current, "skills/bearing"));

    const updated = await product.runTerminal([], "2\n", { observeRoots: [home, repository] });
    expect(updated.exitCode).toBe(0);
    expect(updated.stdout).toContain("Action: Update");
    expect(updated.stdout).toContain("Outcome: no-op");
    expect(updated.effects).toEqual({ created: [], changed: [], removed: [] });

    await rm(cli);
    const repaired = await product.runTerminal([], "3\n", { observeRoots: [home, repository] });
    expect(repaired.exitCode).toBe(0);
    expect(repaired.stdout).toContain("Action: Repair");
    expect(repaired.stdout).toContain("Outcome: applied");
    expect(await readlink(cli)).toBe(join(current, "dist/cli.js"));

    const catalog = join(home, ".bearing/catalog.sqlite");
    const nativeWork = join(repository, ".scratch/work.md");
    const unmanagedSurfaceEntry = join(home, ".claude/skills/bearing");
    await mkdir(join(repository, ".scratch"), { recursive: true });
    await mkdir(join(home, ".claude/skills"), { recursive: true });
    await writeFile(catalog, "catalog sentinel\n");
    await writeFile(nativeWork, "native work\n");
    await writeFile(unmanagedSurfaceEntry, "user-owned Claude entry\n");

    const uninstalled = await product.runTerminal([], "4\n", {
      observeRoots: [home, repository],
    });
    expect(uninstalled.exitCode).toBe(0);
    expect(uninstalled.stdout).toContain("Action: Global Uninstall");
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

    const repeatedUninstall = await product.runTerminal([], "4\n", {
      observeRoots: [home, repository],
    });
    expect(repeatedUninstall.exitCode).toBe(0);
    expect(repeatedUninstall.stdout).toContain("Outcome: no-op");
    expect(repeatedUninstall.effects).toEqual({ created: [], changed: [], removed: [] });

    await mkdir(join(home, ".agents/skills"), { recursive: true });
    await writeFile(skill, "user-owned skill\n");
    const conflicted = await product.runTerminal([], "1\n", { observeRoots: [home, repository] });
    expect(conflicted.exitCode).not.toBe(0);
    expect(`${conflicted.stdout}\n${conflicted.stderr}`).toContain(
      "conflicts with existing content",
    );
    expect(await readFile(skill, "utf8")).toBe("user-owned skill\n");
    await absent(current);
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
