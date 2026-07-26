import { beforeAll, describe, expect, test } from "bun:test";
import { mkdir, readFile, rename, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { registerAsset } from "../src/asset-registration";
import { parseFrontmatter } from "../src/frontmatter";
import { createValidBearingRepo, makeTemporaryDirectory } from "./helpers";

const runAssetRegistration = async (
  repoRoot: string,
  overrides: readonly string[] = [],
  environment: Readonly<Record<string, string>> = {},
): Promise<Readonly<{ stdout: string; stderr: string; exitCode: number }>> => {
  const defaults = [
    "--repo",
    repoRoot,
    "--id",
    "asset:test-execution",
    "--title",
    "Test execution evidence",
    "--kind",
    "execution-evidence",
    "--location",
    ".scratch/work/evidence.md",
    "--owner",
    "effort:test",
    "--producer-kind",
    "executor-profile",
    "--producer-name",
    "generic-agent",
    "--produced-for",
    ".scratch/work/issues/09.md",
  ];
  const overridden = new Set(overrides.filter((value) => value.startsWith("--")));
  const args: string[] = [];
  for (let index = 0; index < defaults.length; index += 2) {
    const key = defaults[index];
    const value = defaults[index + 1];
    if (key !== undefined && value !== undefined && !overridden.has(key)) {
      args.push(key, value);
    }
  }
  const child = Bun.spawn(
    ["node", join(process.cwd(), "dist/cli.js"), "asset", "register", ...args, ...overrides],
    { stdout: "pipe", stderr: "pipe", env: { ...process.env, ...environment } },
  );
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { stdout, stderr, exitCode };
};

const registryAssets = async (root: string): Promise<readonly Record<string, unknown>[]> => {
  const parsed = parseFrontmatter(await readFile(join(root, ".bearing/state/assets.md"), "utf8"));
  if (!parsed.ok || !Array.isArray(parsed.data["Assets"])) {
    throw new Error("Expected a valid Asset Registry fixture.");
  }
  return parsed.data["Assets"] as readonly Record<string, unknown>[];
};

describe("typed Asset Registration Route CLI", () => {
  beforeAll(async () => {
    const result = await Bun.build({
      entrypoints: [join(process.cwd(), "src/cli.ts")],
      outdir: join(process.cwd(), "dist"),
      target: "node",
    });
    if (!result.success) throw new Error("Asset registration tests could not build the CLI.");
  });

  test("registers one factual Asset and returns an idempotent no-op on exact replay", async () => {
    const root = await createValidBearingRepo();
    await writeFile(join(root, ".scratch/work/evidence.md"), "# Durable evidence\n");

    const first = await runAssetRegistration(root);
    expect(first.exitCode).toBe(0);
    expect(first.stderr).toBe("");
    expect(JSON.parse(first.stdout)).toMatchObject({
      outcome: "applied",
      assetId: "asset:test-execution",
      sync: { diagnostics: 0 },
    });
    expect(await registryAssets(root)).toEqual([
      {
        ID: "asset:test-execution",
        Title: "Test execution evidence",
        Kind: "execution-evidence",
        Location: ".scratch/work/evidence.md",
        Owner: "effort:test",
        Producer: {
          Kind: "executor-profile",
          Name: "generic-agent",
        },
        "Lifecycle source": "native",
        "Produced for": ".scratch/work/issues/09.md",
      },
    ]);
    const bytesAfterFirst = await readFile(join(root, ".bearing/state/assets.md"));

    const replay = await runAssetRegistration(root);
    expect(replay.exitCode).toBe(0);
    expect(JSON.parse(replay.stdout)).toEqual({
      outcome: "no-op",
      assetId: "asset:test-execution",
    });
    expect(await readFile(join(root, ".bearing/state/assets.md"))).toEqual(bytesAfterFirst);
  });

  test("fails closed on a conflicting ID or invalid producer provenance", async () => {
    const root = await createValidBearingRepo();
    await writeFile(join(root, ".scratch/work/evidence.md"), "# Durable evidence\n");
    expect((await runAssetRegistration(root)).exitCode).toBe(0);
    const accepted = await readFile(join(root, ".bearing/state/assets.md"));

    const conflict = await runAssetRegistration(root, ["--title", "Conflicting title"]);
    expect(conflict.exitCode).not.toBe(0);
    expect(conflict.stderr).toContain("already registered with different metadata");
    expect(await readFile(join(root, ".bearing/state/assets.md"))).toEqual(accepted);

    const invalid = await runAssetRegistration(root, ["--producer-kind", "task"]);
    expect(invalid.exitCode).not.toBe(0);
    expect(await readFile(join(root, ".bearing/state/assets.md"))).toEqual(accepted);

    for (const [ordinal, producerName] of [
      "claude",
      "codex-cli",
      "gemini-2",
      "gpt5",
      "llama-3",
      "o3",
      "opus-4",
      "sonnet-4",
      "task-123",
      "thread-123",
      "command-run",
    ].entries()) {
      const transientName = await runAssetRegistration(root, [
        "--id",
        `asset:transient-name-${ordinal}`,
        "--kind",
        "verification-report",
        "--producer-kind",
        "agent-capability",
        "--producer-name",
        producerName,
      ]);
      expect(transientName.exitCode).not.toBe(0);
      expect(await readFile(join(root, ".bearing/state/assets.md"))).toEqual(accepted);
    }

    for (const [ordinal, producerReference] of [
      "thread:123",
      "prefix:thread:123",
      "bash -lc test",
      "cargo test",
    ].entries()) {
      const transientReference = await runAssetRegistration(root, [
        "--id",
        `asset:transient-reference-${ordinal}`,
        "--producer-reference",
        producerReference,
      ]);
      expect(transientReference.exitCode).not.toBe(0);
      expect(await readFile(join(root, ".bearing/state/assets.md"))).toEqual(accepted);
    }

    const nonexistentCommit = await runAssetRegistration(root, [
      "--id",
      "asset:nonexistent-commit",
      "--producer-reference",
      "commit:deadbee",
    ]);
    expect(nonexistentCommit.exitCode).not.toBe(0);
    expect(nonexistentCommit.stderr).toContain("Producer commit does not exist");
    expect(await readFile(join(root, ".bearing/state/assets.md"))).toEqual(accepted);
  });

  test("does not read through a symlinked Bearing State parent", async () => {
    const root = await createValidBearingRepo();
    const outside = await createValidBearingRepo();
    const statePath = join(root, ".bearing/state");
    const externalState = join(outside, ".bearing/state");
    const externalRegistry = join(externalState, "assets.md");
    const externalBytes = await readFile(externalRegistry);
    await rename(statePath, join(root, ".bearing/state-original"));
    await symlink(externalState, statePath);

    const result = await runAssetRegistration(root);

    expect(result.exitCode).not.toBe(0);
    expect(await readFile(externalRegistry)).toEqual(externalBytes);
  });

  test("re-reads Registry bytes immediately before the first write", async () => {
    const root = await createValidBearingRepo();
    const registryPath = join(root, ".bearing/state/assets.md");
    const concurrent = `${await readFile(registryPath, "utf8")}\nConcurrent user note.\n`;

    await expect(
      registerAsset(
        {
          repoRoot: root,
          id: "asset:race",
          title: "Race evidence",
          kind: "verification-report",
          location: ".scratch/work/evidence.md",
          owner: "effort:test",
          producer: { kind: "agent-capability", name: "bearing" },
        },
        {
          beforeRegistrySnapshot: async () => {
            await writeFile(registryPath, concurrent);
          },
        },
      ),
    ).rejects.toThrow("before Registry mutation");

    expect(await readFile(registryPath, "utf8")).toBe(concurrent);
    expect(await registryAssets(root)).toEqual([]);
  });

  test("accepts direct and symlink-installed Agent Surface capabilities plus a user source", async () => {
    const root = await createValidBearingRepo();

    const result = await runAssetRegistration(root, [
      "--kind",
      "verification-report",
      "--producer-kind",
      "agent-capability",
      "--producer-name",
      "bearing",
      "--produced-for",
      ".scratch/work/issues/09.md",
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(await registryAssets(root)).toContainEqual(
      expect.objectContaining({
        Producer: {
          Kind: "agent-capability",
          Name: "bearing",
        },
      }),
    );

    const surfaceHome = await makeTemporaryDirectory("bearing-agent-surface-");
    const thirdPartyCapability = await makeTemporaryDirectory("bearing-capability-");
    await writeFile(join(thirdPartyCapability, "SKILL.md"), "# Third-party capability\n");
    await mkdir(join(surfaceHome, ".agents/skills"), { recursive: true });
    await symlink(thirdPartyCapability, join(surfaceHome, ".agents/skills/third-party-capability"));
    const symlinkedResult = await runAssetRegistration(
      root,
      [
        "--id",
        "asset:symlinked-capability",
        "--kind",
        "verification-report",
        "--producer-kind",
        "agent-capability",
        "--producer-name",
        "third-party-capability",
        "--produced-for",
        ".scratch/work/issues/09.md",
      ],
      { HOME: surfaceHome },
    );
    expect(symlinkedResult.exitCode).toBe(0);
    expect(await registryAssets(root)).toContainEqual(
      expect.objectContaining({
        Producer: {
          Kind: "agent-capability",
          Name: "third-party-capability",
        },
      }),
    );

    await writeFile(join(root, ".scratch/work/user-source.md"), "# User source\n");
    const userResult = await runAssetRegistration(root, [
      "--id",
      "asset:user-source",
      "--kind",
      "verification-report",
      "--producer-kind",
      "external-source",
      "--producer-name",
      "user",
      "--producer-reference",
      ".scratch/work/user-source.md",
      "--produced-for",
      ".scratch/work/issues/09.md",
    ]);
    expect(userResult.exitCode).toBe(0);
    expect(await registryAssets(root)).toContainEqual(
      expect.objectContaining({
        Producer: {
          Kind: "external-source",
          Name: "user",
          Reference: ".scratch/work/user-source.md",
        },
      }),
    );
  });

  test("rolls Registry bytes back when protected Sync cannot commit", async () => {
    const root = await createValidBearingRepo();
    const registryPath = join(root, ".bearing/state/assets.md");
    const before = await readFile(registryPath);
    await mkdir(join(root, ".bearing/cache"), { recursive: true });
    await mkdir(join(root, ".bearing/cache/project-sitemap.md"));

    const result = await runAssetRegistration(root);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("Asset registration failed");
    expect(await readFile(registryPath)).toEqual(before);
    expect(await registryAssets(root)).toEqual([]);
  });
});
