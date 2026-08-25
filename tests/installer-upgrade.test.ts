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
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import packageMetadata from "../package.json";
import {
  applyInstallPlans,
  assertCandidateIsNotOlder,
  comparePackageVersions,
  detectInstallSurfaces,
  installKit,
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

  test("rejects a symbolic-link home root", async () => {
    const parent = await makeTemporaryDirectory("bearing-home-parent-");
    const outside = await makeTemporaryDirectory("bearing-home-outside-");
    const linkedHome = join(parent, "linked-home");
    await symlink(outside, linkedHome);

    await expect(
      installKit({
        homeDir: linkedHome,
        packageRoot: process.cwd(),
        surfaces: ["agent-skills"],
      }),
    ).rejects.toThrow("Installation home cannot be a symbolic link");
    await expect(access(join(outside, ".agents/skills/bearing/SKILL.md"))).rejects.toThrow();
  });

  test("rejects a target outside the selected home", async () => {
    const homeDir = await makeTemporaryDirectory("bearing-home-");
    const outside = await makeTemporaryDirectory("bearing-home-prefix-");
    const target = join(outside, "outside.txt");

    await expect(
      applyInstallPlans(homeDir, [
        { target, bytes: Buffer.from("outside write\n"), executable: false },
      ]),
    ).rejects.toThrow("Installation target is outside the selected home");
    await expect(access(target)).rejects.toThrow();
  });

  test("preserves conflicting Agent Surface skill content", async () => {
    const homeDir = await makeTemporaryDirectory("bearing-home-");
    const target = join(homeDir, ".agents/skills/bearing/SKILL.md");
    await mkdir(join(homeDir, ".agents/skills/bearing"), { recursive: true });
    await writeFile(target, "user-owned skill\n");

    const result = await installKit({
      homeDir,
      packageRoot: process.cwd(),
      surfaces: ["agent-skills"],
    });
    expect(result.outcome).toBe("partial");
    expect(result.surfaceResults).toMatchObject([{ surface: "agent-skills", outcome: "conflict" }]);
    expect(await readFile(target, "utf8")).toBe("user-owned skill\n");
    await access(join(homeDir, ".bearing/bin/bearing"));
  });

  test("updates the canonical bundle while preserving owned Agent Surface symlinks", async () => {
    const homeDir = await makeTemporaryDirectory("bearing-home-");
    const surfaceTarget = join(homeDir, ".agents/skills/bearing");
    const bundleTarget = join(homeDir, ".bearing/kit/current/skills/bearing/SKILL.md");
    const bundleDirectory = join(homeDir, ".bearing/kit/current/skills/bearing");
    await mkdir(bundleDirectory, { recursive: true });
    await mkdir(join(homeDir, ".agents/skills"), { recursive: true });
    await writeFile(bundleTarget, "old package bytes\n");
    await symlink(bundleDirectory, surfaceTarget, "dir");

    const result = await applyInstallPlans(homeDir, [
      { target: bundleTarget, bytes: Buffer.from("new package bytes\n"), executable: false },
      { kind: "symlink", target: surfaceTarget, source: bundleDirectory },
    ]);

    expect(result.outcome).toBe("applied");
    expect(await readFile(bundleTarget, "utf8")).toBe("new package bytes\n");
    expect(await readFile(join(surfaceTarget, "SKILL.md"), "utf8")).toBe("new package bytes\n");
  });

  test("bundle rollback preserves an existing owned Agent Surface link", async () => {
    const homeDir = await makeTemporaryDirectory("bearing-home-");
    await mkdir(join(homeDir, ".agents/skills"), { recursive: true });
    await installKit({ homeDir, packageRoot: process.cwd(), surfaces: ["agent-skills"] });
    const surfaceTarget = join(homeDir, ".agents/skills/bearing");
    await writeFile(join(homeDir, ".bearing/kit/current/old-only.txt"), "old bytes\n");

    await expect(
      installKit(
        {
          homeDir,
          packageRoot: process.cwd(),
          surfaces: ["agent-skills"],
        },
        {
          afterCurrentMoved: async () => {
            throw new Error("injected switch failure");
          },
        },
      ),
    ).rejects.toThrow("previous complete bundle was restored");

    expect(await readlink(surfaceTarget)).toBe(
      join(homeDir, ".bearing/kit/current/skills/bearing"),
    );
    await access(join(homeDir, ".bearing/kit/current/package.json"));
    await access(join(surfaceTarget, "SKILL.md"));
  });

  test("never overwrites a concurrent legacy recovery staging path", async () => {
    const homeDir = await makeTemporaryDirectory("bearing-home-");
    await installKit({ homeDir, packageRoot: process.cwd(), surfaces: ["agent-skills"] });
    const cliTarget = join(homeDir, ".bearing/bin/bearing");
    const cliSource = join(homeDir, ".bearing/kit/current/dist/cli.js");
    const legacyBytes = await readFile(cliSource);
    await rm(cliTarget);
    await writeFile(cliTarget, legacyBytes);
    await chmod(cliTarget, 0o755);

    await expect(
      installKit(
        { homeDir, packageRoot: process.cwd(), surfaces: ["agent-skills"] },
        {
          afterCurrentMoved: async () => {
            const kitRoot = join(homeDir, ".bearing/kit");
            const transaction = (await readdir(kitRoot)).find((entry) =>
              entry.startsWith(".link-transaction-"),
            );
            if (transaction === undefined) throw new Error("missing link transaction");
            await writeFile(
              join(kitRoot, transaction, "rollback-1-file"),
              "concurrent recovery content\n",
            );
          },
        },
      ),
    ).rejects.toThrow("installation and complete-bundle recovery both failed");

    const transaction = (await readdir(join(homeDir, ".bearing/kit"))).find((entry) =>
      entry.startsWith(".link-transaction-"),
    );
    expect(transaction).toBeDefined();
    expect(
      await readFile(
        join(homeDir, ".bearing/kit", transaction as string, "rollback-1-file"),
        "utf8",
      ),
    ).toBe("concurrent recovery content\n");
  });

  test("rejects an Agent Surface symlink that points outside the Bearing bundle", async () => {
    const homeDir = await makeTemporaryDirectory("bearing-home-");
    const target = join(homeDir, ".agents/skills/bearing");
    const outside = await makeTemporaryDirectory("bearing-outside-skill-");
    await mkdir(join(homeDir, ".agents/skills"), { recursive: true });
    await symlink(outside, target, "dir");

    const result = await installKit({
      homeDir,
      packageRoot: process.cwd(),
      surfaces: ["agent-skills"],
    });
    expect(result.outcome).toBe("partial");
    expect(result.surfaceResults[0]?.message).toContain("Non-owned symbolic link is preserved");
    await access(join(homeDir, ".bearing/bin/bearing"));
  });

  test("rejects linked installation ancestors without external writes", async () => {
    const homeDir = await makeTemporaryDirectory("bearing-home-");
    const outside = await makeTemporaryDirectory("bearing-outside-");
    await symlink(outside, join(homeDir, ".agents"));

    const result = await installKit({
      homeDir,
      packageRoot: process.cwd(),
      surfaces: ["agent-skills"],
    });
    expect(result.outcome).toBe("partial");
    expect(result.surfaceResults[0]?.message).toContain(
      "Skill Directory is not an existing directory",
    );
    await expect(access(join(outside, "skills/bearing/SKILL.md"))).rejects.toThrow();
  });

  test("isolates a surface directory replaced after preflight without writing outside home", async () => {
    const homeDir = await makeTemporaryDirectory("bearing-home-");
    const outside = await makeTemporaryDirectory("bearing-outside-");
    const agentSkills = join(homeDir, ".agents/skills");
    const parkedAgentSkills = join(homeDir, ".agents/parked-skills");
    const workbuddySkill = join(homeDir, ".workbuddy/skills/bearing");
    await Promise.all([
      mkdir(agentSkills, { recursive: true }),
      mkdir(join(homeDir, ".workbuddy/skills"), { recursive: true }),
    ]);

    const result = await installKit(
      {
        homeDir,
        packageRoot: process.cwd(),
        surfaces: ["agent-skills", "workbuddy"],
      },
      {
        beforeSurfaceWrite: async (surface) => {
          if (surface !== "agent-skills") return;
          await rename(agentSkills, parkedAgentSkills);
          await symlink(outside, agentSkills, "dir");
        },
      },
    );

    expect(result.outcome).toBe("partial");
    expect(result.surfaceResults).toMatchObject([
      { surface: "agent-skills", outcome: "conflict" },
      { surface: "workbuddy", outcome: "applied" },
    ]);
    await expect(access(join(outside, "bearing"))).rejects.toThrow();
    await expect(access(join(parkedAgentSkills, "bearing"))).rejects.toThrow();
    await access(join(workbuddySkill, "SKILL.md"));
    await access(join(homeDir, ".bearing/kit/current/package.json"));
  });

  test("rolls back a surface directory replaced after its final precondition check", async () => {
    const homeDir = await makeTemporaryDirectory("bearing-home-");
    const outside = await makeTemporaryDirectory("bearing-outside-");
    const agentSkills = join(homeDir, ".agents/skills");
    const parkedAgentSkills = join(homeDir, ".agents/parked-skills");
    const workbuddySkill = join(homeDir, ".workbuddy/skills/bearing");
    await Promise.all([
      mkdir(agentSkills, { recursive: true }),
      mkdir(join(homeDir, ".workbuddy/skills"), { recursive: true }),
    ]);

    const result = await installKit(
      {
        homeDir,
        packageRoot: process.cwd(),
        surfaces: ["agent-skills", "workbuddy"],
      },
      {
        afterSurfacePreconditionCheck: async (surface) => {
          if (surface !== "agent-skills") return;
          await rename(agentSkills, parkedAgentSkills);
          await symlink(outside, agentSkills, "dir");
        },
      },
    );

    expect(result.outcome).toBe("partial");
    expect(result.surfaceResults).toMatchObject([
      { surface: "agent-skills", outcome: "conflict" },
      { surface: "workbuddy", outcome: "applied" },
    ]);
    await expect(access(join(outside, "bearing"))).rejects.toThrow();
    await expect(access(join(parkedAgentSkills, "bearing"))).rejects.toThrow();
    await access(join(workbuddySkill, "SKILL.md"));
    await access(join(homeDir, ".bearing/kit/current/package.json"));
  });

  test("isolates an unreadable detected surface and keeps later known surfaces", async () => {
    const homeDir = await makeTemporaryDirectory("bearing-home-");
    const inaccessible = join(homeDir, ".agents");
    const workbuddySkills = join(homeDir, ".workbuddy/skills");
    await Promise.all([
      mkdir(join(inaccessible, "skills"), { recursive: true }),
      mkdir(workbuddySkills, { recursive: true }),
    ]);
    await chmod(inaccessible, 0o000);
    try {
      expect(await detectInstallSurfaces(homeDir)).toEqual([
        { surface: "workbuddy", path: workbuddySkills },
      ]);
    } finally {
      await chmod(inaccessible, 0o700);
    }
  });

  test("switches the complete current bundle and routes the CLI through it", async () => {
    const homeDir = await makeTemporaryDirectory("bearing-home-");
    await mkdir(join(homeDir, ".agents/skills"), { recursive: true });
    await installKit({ homeDir, packageRoot: process.cwd(), surfaces: ["agent-skills"] });
    const stale = join(homeDir, ".bearing/kit/current/stale-old-release.txt");
    await writeFile(stale, "old-only\n");

    const result = await installKit({
      homeDir,
      packageRoot: process.cwd(),
      surfaces: ["agent-skills"],
    });

    expect(result.outcome).toBe("applied");
    await expect(access(stale)).rejects.toThrow();
    const cli = join(homeDir, ".bearing/bin/bearing");
    expect((await lstat(cli)).isSymbolicLink()).toBe(true);
    expect(await readlink(cli)).toBe(join(homeDir, ".bearing/kit/current/dist/cli.js"));
    await access(join(homeDir, ".bearing/kit/current/skills/bearing/SKILL.md"));
  });

  test("restores the previous complete bundle when directory switching fails", async () => {
    const homeDir = await makeTemporaryDirectory("bearing-home-");
    await mkdir(join(homeDir, ".agents/skills"), { recursive: true });
    await installKit({ homeDir, packageRoot: process.cwd(), surfaces: ["agent-skills"] });
    const previous = join(homeDir, ".bearing/kit/current/previous-release-marker.txt");
    await writeFile(previous, "previous complete bundle\n");

    await expect(
      installKit(
        { homeDir, packageRoot: process.cwd(), surfaces: ["agent-skills"] },
        {
          afterCurrentMoved: () => {
            throw new Error("injected switch failure");
          },
        },
      ),
    ).rejects.toThrow("previous complete bundle was restored");

    expect(await readFile(previous, "utf8")).toBe("previous complete bundle\n");
    await access(join(homeDir, ".bearing/kit/current/dist/cli.js"));
    await access(join(homeDir, ".agents/skills/bearing/SKILL.md"));
    expect(await readlink(join(homeDir, ".bearing/bin/bearing"))).toBe(
      join(homeDir, ".bearing/kit/current/dist/cli.js"),
    );
  });

  test("validates the final target and restores the previous complete bundle on mismatch", async () => {
    const homeDir = await makeTemporaryDirectory("bearing-home-");
    await installKit({ homeDir, packageRoot: process.cwd(), surfaces: [] });
    const previous = join(homeDir, ".bearing/kit/current/previous-release-marker.txt");
    await writeFile(previous, "previous complete bundle\n");

    await expect(
      installKit(
        { homeDir, packageRoot: process.cwd(), surfaces: [] },
        {
          afterCurrentMoved: async () => {
            const kitRoot = join(homeDir, ".bearing/kit");
            const staging = (await readdir(kitRoot)).find((entry) => entry.startsWith(".staged-"));
            if (staging === undefined) throw new Error("missing staged candidate");
            await writeFile(join(kitRoot, staging, "package.json"), "{tampered\n");
          },
        },
      ),
    ).rejects.toThrow("previous complete bundle was restored");

    expect(await readFile(previous, "utf8")).toBe("previous complete bundle\n");
    expect(
      JSON.parse(await readFile(join(homeDir, ".bearing/kit/current/package.json"), "utf8")),
    ).toMatchObject({ version: packageMetadata.version });
  });

  test("repairs a missing executable bit instead of treating the bundle as current", async () => {
    const homeDir = await makeTemporaryDirectory("bearing-home-");
    await mkdir(join(homeDir, ".agents/skills"), { recursive: true });
    await installKit({ homeDir, packageRoot: process.cwd(), surfaces: ["agent-skills"] });
    const cli = join(homeDir, ".bearing/kit/current/dist/cli.js");
    await chmod(cli, 0o644);

    const result = await installKit({
      homeDir,
      packageRoot: process.cwd(),
      surfaces: ["agent-skills"],
    });

    expect(result.outcome).toBe("applied");
    expect((await stat(cli)).mode & 0o111).not.toBe(0);
  });

  test("fails closed when the current package manifest is missing", async () => {
    const homeDir = await makeTemporaryDirectory("bearing-home-");
    await installKit({ homeDir, packageRoot: process.cwd(), surfaces: ["agent-skills"] });
    const installedPackage = join(homeDir, ".bearing/kit/current/package.json");
    await rm(installedPackage);

    await expect(
      installKit({ homeDir, packageRoot: process.cwd(), surfaces: ["agent-skills"] }),
    ).rejects.toThrow("Current Kit Unverifiable");
    await expect(access(installedPackage)).rejects.toThrow();
  });

  test("fails closed when the current package manifest is malformed", async () => {
    const homeDir = await makeTemporaryDirectory("bearing-home-");
    await installKit({ homeDir, packageRoot: process.cwd(), surfaces: ["agent-skills"] });
    const installedPackage = join(homeDir, ".bearing/kit/current/package.json");
    await writeFile(installedPackage, "{malformed\n");

    await expect(
      installKit({ homeDir, packageRoot: process.cwd(), surfaces: ["agent-skills"] }),
    ).rejects.toThrow("Current Kit Unverifiable");
    expect(await readFile(installedPackage, "utf8")).toBe("{malformed\n");
  });

  test("uses SemVer ordering and blocks every older candidate", () => {
    expect(comparePackageVersions("0.1.0-rc.2", "0.1.0-rc.10")).toBeLessThan(0);
    expect(
      comparePackageVersions("0.1.0-99999999999999999999", "0.1.0-100000000000000000000"),
    ).toBeLessThan(0);
    expect(comparePackageVersions("0.1.0-rc.10", "0.1.0")).toBeLessThan(0);
    expect(comparePackageVersions("0.1.1", "0.1.0")).toBeGreaterThan(0);
    expect(() => assertCandidateIsNotOlder("0.1.0-rc.1", "0.1.0")).toThrow(
      "Older Candidate Blocked",
    );
    expect(() => assertCandidateIsNotOlder("0.1.0", "0.1.1")).toThrow("Older Candidate Blocked");
    expect(() => assertCandidateIsNotOlder("0.1.9", "0.2.0")).toThrow("Older Candidate Blocked");
    expect(() => assertCandidateIsNotOlder("0.1.0", "0.3.0")).toThrow("Older Candidate Blocked");
    expect(() => assertCandidateIsNotOlder("0.9.0", "1.0.0")).toThrow("Older Candidate Blocked");
    expect(() => assertCandidateIsNotOlder("0.1.1", "0.1.0")).not.toThrow();
    expect(() => comparePackageVersions("0.1.0-01", "0.1.0")).toThrow(
      "package version is not supported",
    );
    expect(() => comparePackageVersions("v0.1.0", "0.1.0")).toThrow(
      "package version is not supported",
    );
  });

  test("blocks a whole-bundle downgrade without an override", async () => {
    const homeDir = await makeTemporaryDirectory("bearing-home-");
    await installKit({ homeDir, packageRoot: process.cwd(), surfaces: ["agent-skills"] });
    const installedPackage = join(homeDir, ".bearing/kit/current/package.json");
    const metadata = JSON.parse(await readFile(installedPackage, "utf8"));
    await writeFile(installedPackage, `${JSON.stringify({ ...metadata, version: "0.2.0" })}\n`);

    await expect(
      installKit({ homeDir, packageRoot: process.cwd(), surfaces: ["agent-skills"] }),
    ).rejects.toThrow("Older Candidate Blocked");
    expect(JSON.parse(await readFile(installedPackage, "utf8")).version).toBe("0.2.0");
  });
});
