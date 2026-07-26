import { describe, expect, test } from "bun:test";
import { access, mkdir, mkdtemp, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  finalizeFixtureSnapshot,
  G1_LIVE_JOURNEYS,
  G1_LIVE_PLAN_ID,
  G1_LIVE_SURFACES,
  G1_MATT_SKILL_CLOSURE,
  surfaceLaunchContract,
} from "../scripts/g1-live-fixture";

describe("G1 live fixture recipe", () => {
  test("pins the complete versioned matrix and bounded external skill closure", () => {
    expect(G1_LIVE_PLAN_ID).toBe("bearing-0.1.1-g1-live-v1");
    expect(G1_LIVE_JOURNEYS).toEqual([
      "L1-positive",
      "L1-negative",
      "L2-positive",
      "L2-negative",
      "L3-positive",
      "L3-negative",
      "L4-positive",
      "L4-negative",
      "L5-positive",
      "L5-negative",
      "L6-positive",
      "L6-negative",
      "L7-positive",
      "L7-negative",
    ]);
    expect(G1_LIVE_SURFACES).toEqual(["codex", "claude-code"]);
    expect(G1_MATT_SKILL_CLOSURE).toEqual([
      "setup-matt-pocock-skills",
      "wayfinder",
      "implement",
      "tdd",
      "code-review",
    ]);
  });

  test("separates Codex identity reuse from each isolated fixture home", () => {
    expect(
      surfaceLaunchContract({
        surface: "codex",
        repositoryRoot: "/private/tmp/g1/repo",
        isolatedHome: "/private/tmp/g1/home",
        codexHome: "/Users/example/.codex",
      }),
    ).toEqual({
      mode: "codex-exec",
      identityHome: "/Users/example/.codex",
      initial:
        'env HOME="/private/tmp/g1/home" CODEX_HOME="/Users/example/.codex" codex exec --ignore-user-config --sandbox workspace-write --add-dir "/private/tmp/g1/home" --cd "/private/tmp/g1/repo" --json',
      resume:
        'env HOME="/private/tmp/g1/home" CODEX_HOME="/Users/example/.codex" codex exec resume --ignore-user-config --json <session-id>',
    });
  });

  test("refuses equal or canonical-alias targets before creating fixture state", async () => {
    const parent = await mkdtemp("/tmp/bearing-g1-targets-");
    const codexHome = join(parent, "codex-home");
    await mkdir(codexHome);
    const canonicalParent = await realpath(parent);
    const target = join(parent, "same-target");
    const canonicalAlias = join(canonicalParent, "same-target");
    const common = [
      "--surface",
      "codex",
      "--tarball",
      join(parent, "unused.tgz"),
      "--matt-skills-root",
      join(parent, "unused-skills"),
      "--matt-contract-source",
      join(parent, "unused-contract.md"),
      "--codex-home",
      codexHome,
    ] as const;

    const run = async (
      journey: string,
      root: string,
      home: string,
      manifest = join(parent, "manifest.json"),
    ) => {
      const child = Bun.spawn(
        [
          process.execPath,
          "scripts/g1-live-fixture.ts",
          "--journey",
          journey,
          "--root",
          root,
          "--home",
          home,
          "--manifest",
          manifest,
          ...common,
        ],
        { cwd: process.cwd(), stdout: "pipe", stderr: "pipe" },
      );
      const [stderr, exitCode] = await Promise.all([
        new Response(child.stderr).text(),
        child.exited,
      ]);
      return { stderr, exitCode };
    };

    const equal = await run("L1-positive", target, target);
    const aliased = await run("L1-positive", target, canonicalAlias);
    const l3Root = join(parent, "l3-root");
    const l3Collision = await run(
      "L3-positive",
      l3Root,
      join(parent, "l3-home"),
      `${l3Root}.matt-prerequisite.md`,
    );
    const l6Root = join(parent, "l6-root");
    const l6Collision = await run(
      "L6-positive",
      l6Root,
      join(parent, "l6-home"),
      `${l6Root}.external-payload.md`,
    );

    expect(equal.exitCode).toBe(1);
    expect(equal.stderr).toContain("must be independent canonical paths");
    expect(aliased.exitCode).toBe(1);
    expect(aliased.stderr).toContain("must be independent canonical paths");
    expect(l3Collision.exitCode).toBe(1);
    expect(l3Collision.stderr).toContain("must be independent canonical paths");
    expect(l6Collision.exitCode).toBe(1);
    expect(l6Collision.stderr).toContain("must be independent canonical paths");
    await expect(access(target)).rejects.toThrow();
    await expect(access(l3Root)).rejects.toThrow();
    await expect(access(l6Root)).rejects.toThrow();
  });

  test("normalizes disposable Sync receipts before producing stable repository digests", async () => {
    const parent = await mkdtemp("/tmp/bearing-g1-digests-");
    const first = join(parent, "first");
    const second = join(parent, "second");
    for (const [root, completedAt] of [
      [first, "2026-07-26T01:00:00.000Z"],
      [second, "2026-07-26T02:00:00.000Z"],
    ] as const) {
      await mkdir(join(root, ".bearing/cache"), { recursive: true });
      await writeFile(join(root, "stable.md"), "# Stable fixture\n");
      await writeFile(
        join(root, ".bearing/cache/sync-receipt.json"),
        `${JSON.stringify({ completedAt })}\n`,
      );
    }

    const firstSnapshot = await finalizeFixtureSnapshot(first, true);
    const secondSnapshot = await finalizeFixtureSnapshot(second, true);

    expect(firstSnapshot).toEqual(secondSnapshot);
    await expect(access(join(first, ".bearing/cache/sync-receipt.json"))).rejects.toThrow();
    await expect(access(join(second, ".bearing/cache/sync-receipt.json"))).rejects.toThrow();
  });
});
