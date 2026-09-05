import { beforeAll, describe, expect, test } from "bun:test";
import {
  access,
  chmod,
  lstat,
  mkdir,
  readdir,
  readFile,
  readlink,
  rename,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { buildInstallPlans } from "../src/install-manifest";
import {
  applyInstallPlans,
  installKit,
  uninstallGlobalKit,
  writeInstallTarget,
} from "../src/installer";
import { makeTemporaryDirectory } from "./helpers";

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

  test("keeps successful surfaces and the Kit when another surface conflicts", async () => {
    const homeDir = await makeTemporaryDirectory("bearing-home-");
    const packageRoot = process.cwd();
    await mkdir(join(homeDir, ".agents/skills"), { recursive: true });
    await mkdir(join(homeDir, ".claude"), { recursive: true });
    await writeFile(join(homeDir, ".claude/skills"), "occupied\n");

    const result = await installKit({
      homeDir,
      packageRoot,
      surfaces: ["agent-skills", "claude"],
    });

    expect(result.outcome).toBe("partial");
    expect(result.surfaceResults).toMatchObject([
      { surface: "agent-skills", outcome: "applied" },
      { surface: "claude", outcome: "conflict" },
    ]);
    await access(join(homeDir, ".bearing/kit/current/package.json"));
    await access(join(homeDir, ".agents/skills/bearing/SKILL.md"));
    expect(await readFile(join(homeDir, ".claude/skills"), "utf8")).toBe("occupied\n");
  });

  test("restores targets when a later write fails", async () => {
    const homeDir = await makeTemporaryDirectory("bearing-home-");
    const existingTarget = join(homeDir, ".bearing/transaction/first.txt");
    const newTarget = join(homeDir, ".bearing/transaction/second.txt");
    const failedTarget = join(homeDir, ".bearing/transaction/third.txt");
    await mkdir(join(homeDir, ".bearing/transaction"), { recursive: true });
    await writeFile(existingTarget, "user-owned bytes\n");
    const plans = [
      { target: existingTarget, bytes: Buffer.from("replacement\n"), executable: false },
      { target: newTarget, bytes: Buffer.from("new bytes\n"), executable: false },
      { target: failedTarget, bytes: Buffer.from("never written\n"), executable: false },
    ];
    let writes = 0;

    await expect(
      applyInstallPlans(homeDir, plans, async (plan, ordinal) => {
        writes += 1;
        if (writes === 3) throw new Error("injected third-write failure");
        await writeInstallTarget(plan, ordinal);
      }),
    ).rejects.toThrow("all written targets were restored");

    expect(writes).toBe(3);
    expect(await readFile(existingTarget, "utf8")).toBe("user-owned bytes\n");
    await expect(access(newTarget)).rejects.toThrow();
    await expect(access(failedTarget)).rejects.toThrow();
  });

  test("restores the exact original file mode", async () => {
    const homeDir = await makeTemporaryDirectory("bearing-home-");
    const existingTarget = join(homeDir, ".bearing/transaction/private.txt");
    const failedTarget = join(homeDir, ".bearing/transaction/fail.txt");
    await mkdir(join(homeDir, ".bearing/transaction"), { recursive: true });
    await writeFile(existingTarget, "private bytes\n");
    await chmod(existingTarget, 0o600);
    let writes = 0;

    await expect(
      applyInstallPlans(
        homeDir,
        [
          { target: existingTarget, bytes: Buffer.from("replacement\n"), executable: false },
          { target: failedTarget, bytes: Buffer.from("fail\n"), executable: false },
        ],
        async (plan, ordinal) => {
          writes += 1;
          if (writes === 2) throw new Error("injected failure");
          await writeInstallTarget(plan, ordinal);
        },
      ),
    ).rejects.toThrow("all written targets were restored");

    expect((await stat(existingTarget)).mode & 0o777).toBe(0o600);
  });

  test("rolls back a target when its writer fails after making the write visible", async () => {
    const homeDir = await makeTemporaryDirectory("bearing-home-");
    const target = join(homeDir, ".bearing/transaction/late-failure.txt");

    await expect(
      applyInstallPlans(
        homeDir,
        [{ target, bytes: Buffer.from("written\n"), executable: false }],
        async (plan, ordinal) => {
          await writeInstallTarget(plan, ordinal);
          throw new Error("post-write validation failed");
        },
      ),
    ).rejects.toThrow("all written targets were restored");

    await expect(access(target)).rejects.toThrow();
  });

  test("does not follow the former predictable installer staging path", async () => {
    const homeDir = await makeTemporaryDirectory("bearing-home-");
    const target = join(homeDir, ".bearing/transaction/target.txt");
    const outside = await makeTemporaryDirectory("bearing-install-staging-");
    const outsideFile = join(outside, "outside.txt");
    await mkdir(join(homeDir, ".bearing/transaction"), { recursive: true });
    await writeFile(outsideFile, "outside bytes\n");
    await symlink(outsideFile, `${target}.${process.pid}.0.tmp`);

    await applyInstallPlans(homeDir, [
      { target, bytes: Buffer.from("installed bytes\n"), executable: false },
    ]);

    expect(await readFile(outsideFile, "utf8")).toBe("outside bytes\n");
    expect((await lstat(target)).isSymbolicLink()).toBe(false);
    expect(await readFile(target, "utf8")).toBe("installed bytes\n");
  });

  test("removes transaction-created directories after rollback", async () => {
    const homeDir = await makeTemporaryDirectory("bearing-home-");
    const plans = await buildInstallPlans({
      homeDir,
      packageRoot: process.cwd(),
      surfaces: ["agent-skills"],
    });
    let writes = 0;

    await expect(
      applyInstallPlans(homeDir, plans, async (plan, ordinal) => {
        writes += 1;
        if (writes === 3) throw new Error("injected third-write failure");
        await writeInstallTarget(plan, ordinal);
      }),
    ).rejects.toThrow("all written targets were restored");

    await expect(access(join(homeDir, ".agents"))).rejects.toThrow();
    await expect(access(join(homeDir, ".bearing"))).rejects.toThrow();
  });

  test.each([
    { ancestor: ".agents", entry: "skills/bearing", source: "skills/bearing" },
    { ancestor: ".agents/skills", entry: "bearing", source: "skills/bearing" },
    { ancestor: ".bearing/bin", entry: "bearing", source: "dist/cli.js" },
  ])("preserves owned entries when $ancestor links outside HOME", async ({
    ancestor,
    entry,
    source,
  }) => {
    const fixtureRoot = await makeTemporaryDirectory("bearing-uninstall-containment-");
    const homeDir = join(fixtureRoot, "home");
    const outside = join(fixtureRoot, "home-outside");
    await mkdir(join(homeDir, ".agents/skills"), { recursive: true });
    await installKit({ homeDir, packageRoot: process.cwd(), surfaces: ["agent-skills"] });
    await rename(join(homeDir, ancestor), outside);
    await symlink(outside, join(homeDir, ancestor), "dir");
    await writeFile(join(outside, "sentinel.txt"), "outside sibling sentinel\n");

    await expect(uninstallGlobalKit(homeDir)).rejects.toThrow(
      `Installation target cannot use a symbolic link: ${join(homeDir, ancestor)}`,
    );

    expect(await readlink(join(outside, entry))).toBe(
      join(homeDir, ".bearing/kit/current", source),
    );
    expect(await readFile(join(outside, "sentinel.txt"), "utf8")).toBe(
      "outside sibling sentinel\n",
    );
    await access(join(homeDir, ".bearing/bin/bearing"));
    await access(join(homeDir, ".bearing/kit/current/package.json"));
    expect(await readdir(join(homeDir, ".bearing/kit"))).toEqual(["current"]);
  });

  test("uninstalls contained owned entries and preserves foreign entries with linked ancestors", async () => {
    const fixtureRoot = await makeTemporaryDirectory("bearing-uninstall-ownership-");
    const homeDir = join(fixtureRoot, "home");
    const outside = join(fixtureRoot, "home-outside");
    await mkdir(join(homeDir, ".agents/skills"), { recursive: true });
    await installKit({ homeDir, packageRoot: process.cwd(), surfaces: ["agent-skills"] });
    await mkdir(join(outside, "skills"), { recursive: true });
    await symlink(outside, join(homeDir, ".claude"), "dir");
    const foreignSource = join(outside, "other-skill");
    await symlink(foreignSource, join(outside, "skills/bearing"), "dir");
    await writeFile(join(outside, "sentinel.txt"), "foreign sibling sentinel\n");
    await mkdir(join(homeDir, ".workbuddy/skills"), { recursive: true });
    await writeFile(join(homeDir, ".workbuddy/skills/bearing"), "user-owned skill\n");

    const result = await uninstallGlobalKit(homeDir);

    expect(result).toEqual({
      outcome: "applied",
      removedTargets: [".agents/skills/bearing", ".bearing/bin/bearing", ".bearing/kit/current"],
    });
    for (const target of result.removedTargets) {
      await expect(lstat(join(homeDir, target))).rejects.toMatchObject({ code: "ENOENT" });
    }
    expect(await readlink(join(outside, "skills/bearing"))).toBe(foreignSource);
    expect(await readFile(join(outside, "sentinel.txt"), "utf8")).toBe(
      "foreign sibling sentinel\n",
    );
    expect(await readFile(join(homeDir, ".workbuddy/skills/bearing"), "utf8")).toBe(
      "user-owned skill\n",
    );

    expect(await uninstallGlobalKit(homeDir)).toEqual({ outcome: "no-op", removedTargets: [] });
    await expect(lstat(join(homeDir, ".bearing/kit"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  test.each([
    "absent",
    "empty",
  ])("leaves an %s HOME unchanged when there is no owned target", async (state) => {
    const fixtureRoot = await makeTemporaryDirectory("bearing-uninstall-noop-");
    const homeDir = join(fixtureRoot, "home");
    if (state === "empty") await mkdir(homeDir);

    expect(await uninstallGlobalKit(homeDir)).toEqual({ outcome: "no-op", removedTargets: [] });

    expect(await readdir(fixtureRoot)).toEqual(state === "empty" ? ["home"] : []);
    if (state === "empty") expect(await readdir(homeDir)).toEqual([]);
  });

  test("reports exact cleanup locations and permits a later exact-candidate Fresh Install", async () => {
    const homeDir = await makeTemporaryDirectory("bearing-home-uninstall-cleanup-");
    await installKit({ homeDir, packageRoot: process.cwd(), surfaces: ["agent-skills"] });

    await expect(
      uninstallGlobalKit(homeDir, {
        removeDetachedBundle: async () => {
          throw new Error("injected cleanup failure");
        },
      }),
    ).rejects.toThrow(/Outcome: partial[\s\S]*\.uninstall-bundle-[\s\S]*\.uninstall-links-/u);
    await expect(access(join(homeDir, ".bearing/kit/current"))).rejects.toThrow();
    await expect(access(join(homeDir, ".bearing/bin/bearing"))).rejects.toThrow();
    await expect(access(join(homeDir, ".agents/skills/bearing"))).rejects.toThrow();

    await mkdir(join(homeDir, ".agents/skills"), { recursive: true });
    const freshInstall = await installKit({
      homeDir,
      packageRoot: process.cwd(),
      surfaces: ["agent-skills"],
    });
    expect(freshInstall.outcome).toBe("applied");
    await access(join(homeDir, ".bearing/kit/current/package.json"));
    await access(join(homeDir, ".bearing/bin/bearing"));
    await access(join(homeDir, ".agents/skills/bearing/SKILL.md"));
  });
});
