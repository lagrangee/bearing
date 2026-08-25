import { expect, test } from "bun:test";
import { access, mkdir, readFile, readlink, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { installPackedProduct } from "./product-seams/installed-product";

const absent = async (target: string): Promise<void> => {
  await expect(access(target)).rejects.toThrow();
};

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
