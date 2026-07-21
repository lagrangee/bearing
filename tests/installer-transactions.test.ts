import { beforeAll, describe, expect, test } from "bun:test";
import { access, chmod, lstat, mkdir, readFile, stat, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { buildInstallPlans } from "../src/install-manifest";
import { applyInstallPlans, installKit, writeInstallTarget } from "../src/installer";
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

  test("does not leave a partial surface install when preflight fails", async () => {
    const homeDir = await makeTemporaryDirectory("bearing-home-");
    const packageRoot = process.cwd();
    await mkdir(join(homeDir, ".claude"), { recursive: true });
    await writeFile(join(homeDir, ".claude/skills"), "occupied\n");

    await expect(
      installKit({ homeDir, packageRoot, surfaces: ["agent-skills", "claude"] }),
    ).rejects.toThrow("Installation target is not a directory");
    await expect(access(join(homeDir, ".agents/skills/bearing/SKILL.md"))).rejects.toThrow();
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
});
