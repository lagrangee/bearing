import { expect, test } from "bun:test";
import { access, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createValidBearingRepo } from "./helpers";

type CommandResult = Readonly<{
  exitCode: number;
  stdout: string;
  stderr: string;
}>;

const run = async (
  command: readonly string[],
  environment: Readonly<Record<string, string>>,
): Promise<CommandResult> => {
  const processHandle = Bun.spawn([...command], {
    cwd: process.cwd(),
    env: { ...process.env, ...environment },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    processHandle.exited,
    new Response(processHandle.stdout).text(),
    new Response(processHandle.stderr).text(),
  ]);
  return { exitCode, stdout, stderr };
};

const reservePort = async (): Promise<number> => {
  const reservation = createServer();
  await new Promise<void>((resolve) => reservation.listen(0, "127.0.0.1", resolve));
  const address = reservation.address();
  if (address === null || typeof address === "string") throw new Error("No package test port.");
  await new Promise<void>((resolve, reject) =>
    reservation.close((error) => (error === undefined ? resolve() : reject(error))),
  );
  return address.port;
};

const waitForReady = async (
  stdout: ReadableStream<Uint8Array>,
): Promise<Readonly<{ line: string; reader: ReadableStreamDefaultReader<Uint8Array> }>> => {
  const reader = stdout.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  while (true) {
    const result = await reader.read();
    if (result.done) throw new Error(`Packaged Portal exited before ready: ${buffered}`);
    buffered += decoder.decode(result.value, { stream: true });
    const lineEnd = buffered.indexOf("\n");
    if (lineEnd !== -1) return { line: buffered.slice(0, lineEnd), reader };
  }
};

test("the packed CLI runs through offline local npm exec", async () => {
  const root = await mkdtemp(join(tmpdir(), "bearing-package-test-"));
  const packDirectory = join(root, "pack");
  const homeDirectory = join(root, "home");
  let syncRoot: string | undefined;
  await mkdir(packDirectory);
  await mkdir(homeDirectory);
  try {
    const packed = await run(["npm", "pack", "--pack-destination", packDirectory], {
      npm_config_cache: join(root, "pack-cache"),
    });
    expect(packed.exitCode).toBe(0);
    const filename = packed.stdout.trim().split("\n").at(-1);
    if (filename === undefined || filename.length === 0) {
      throw new Error(`npm pack did not return a tarball name: ${packed.stderr}`);
    }
    const tarball = join(packDirectory, filename);
    const listing = await run(["tar", "-tzf", tarball], {});
    expect(listing.exitCode).toBe(0);
    const packedAssetManifest = await run(
      ["tar", "-xOf", tarball, "package/dist/portal/asset-manifest.json"],
      {},
    );
    expect(packedAssetManifest.exitCode).toBe(0);
    const assetManifest = JSON.parse(packedAssetManifest.stdout) as {
      readonly assets: readonly Readonly<{ path: string }>[];
    };
    const portalFiles = [
      "package/dist/portal/asset-manifest.json",
      ...assetManifest.assets.map((asset) => `package/dist/portal/${asset.path}`),
    ];
    expect(listing.stdout.trim().split("\n").sort()).toEqual(
      [
        "package/CHANGELOG.md",
        "package/CODE_OF_CONDUCT.md",
        "package/CONTRIBUTING.md",
        "package/LICENSE",
        "package/README.md",
        "package/README.zh-CN.md",
        "package/SECURITY.md",
        "package/THIRD_PARTY_NOTICES",
        "package/dist/bundle-dependencies.json",
        "package/dist/cli.js",
        ...portalFiles,
        "package/docs/agents/bearing/executor-profiles/README.md",
        "package/docs/agents/bearing/protocol.md",
        "package/docs/cli.md",
        "package/docs/cli.zh-CN.md",
        "package/docs/data-and-security.md",
        "package/docs/data-and-security.zh-CN.md",
        "package/docs/everyday-workflows.md",
        "package/docs/everyday-workflows.zh-CN.md",
        "package/docs/getting-started.md",
        "package/docs/getting-started.zh-CN.md",
        "package/docs/troubleshooting.md",
        "package/docs/troubleshooting.zh-CN.md",
        "package/package.json",
        "package/skills/bearing-alignment-check/SKILL.md",
        "package/skills/bearing-milestone-gate/SKILL.md",
        "package/skills/bearing-next-work/SKILL.md",
        "package/skills/bearing-planning-audit/SKILL.md",
        "package/skills/bearing-planning-review/SKILL.md",
        "package/skills/bearing-roadmap/SKILL.md",
        "package/skills/bearing-setup/SKILL.md",
        "package/skills/bearing-summary/SKILL.md",
        "package/skills/bearing/SKILL.md",
        "package/skills/bearing/references/branch-manifest.yaml",
        "package/skills/bearing/references/branches/alignment-check.md",
        "package/skills/bearing/references/branches/milestone-gate.md",
        "package/skills/bearing/references/branches/next-work.md",
        "package/skills/bearing/references/branches/planning-audit.md",
        "package/skills/bearing/references/branches/planning-review.md",
        "package/skills/bearing/references/branches/roadmap.md",
        "package/skills/bearing/references/branches/setup.md",
        "package/skills/bearing/references/branches/summary.md",
        "package/skills/bearing/references/shared/artifact-registration.md",
        "package/skills/bearing/references/shared/executor-continuation.md",
        "package/skills/bearing/references/shared/planning-transaction.md",
        "package/skills/bearing/references/shared/typed-inspection.md",
        "package/templates/executor-profiles/generic-agent.md",
        "package/templates/executor-profiles/matt-implement.md",
        "package/templates/executor-profiles/omo-start-work.md",
        "package/templates/executor-profiles/superpowers-executing-plans.md",
        "package/templates/executor-profiles/superpowers-subagent-driven-development.md",
      ].sort(),
    );

    const executed = await run(
      ["npm", "exec", "--yes", "--offline", `--package=${tarball}`, "--", "bearing", "--version"],
      {
        HOME: homeDirectory,
        npm_config_cache: join(root, "exec-cache"),
        npm_config_update_notifier: "false",
        npm_config_loglevel: "error",
      },
    );
    expect(executed.exitCode).toBe(0);
    expect(executed.stdout).toBe("0.1.0\n");
    expect(executed.stderr).toBe("");

    const installCommand = [
      "npm",
      "exec",
      "--yes",
      "--offline",
      `--package=${tarball}`,
      "--",
      "bearing",
      "install",
      "--surface",
      "agent-skills",
      "--surface",
      "claude",
    ];
    const installed = await run(installCommand, {
      HOME: homeDirectory,
      npm_config_cache: join(root, "exec-cache"),
      npm_config_update_notifier: "false",
      npm_config_loglevel: "error",
    });
    expect(installed.exitCode).toBe(0);
    expect(installed.stdout).toContain("Outcome: applied");
    expect(installed.stdout).toContain("Changed targets:");

    const repeated = await run(installCommand, {
      HOME: homeDirectory,
      npm_config_cache: join(root, "exec-cache"),
      npm_config_update_notifier: "false",
      npm_config_loglevel: "error",
    });
    expect(repeated.exitCode).toBe(0);
    expect(repeated.stdout).toContain("Outcome: no-op");
    expect(repeated.stdout).toContain("Changed targets: 0");
    for (const surfaceRoot of [".agents/skills", ".claude/skills"]) {
      await access(join(homeDirectory, surfaceRoot, "bearing", "SKILL.md"));
      await expect(
        access(join(homeDirectory, surfaceRoot, "bearing-summary", "SKILL.md")),
      ).rejects.toThrow();
    }
    const installedBearingSkill = await readFile(
      join(homeDirectory, ".agents/skills/bearing/SKILL.md"),
      "utf8",
    );
    const bundledBearingSkill = await readFile(
      join(homeDirectory, ".bearing/kit/current/skills/bearing/SKILL.md"),
      "utf8",
    );
    expect(installedBearingSkill).toBe(bundledBearingSkill);
    const bundledTypedInspection = await readFile(
      join(
        homeDirectory,
        ".bearing/kit/current/skills/bearing/references/shared/typed-inspection.md",
      ),
      "utf8",
    );
    expect(bundledTypedInspection).toContain(
      "$HOME/.bearing/bin/bearing inspect <roadmap|gate|effort> <stable-id> --repo <repo-root>",
    );
    expect(bundledTypedInspection).toMatch(/`complete`[\s\S]*`partial`[\s\S]*`invalid`/u);
    expect(bundledTypedInspection).toContain("skills-only runtime");

    syncRoot = await createValidBearingRepo();
    const retainedState = join(root, "package-fixture-state");
    const retainedScratch = join(root, "package-fixture-scratch");
    await rename(join(syncRoot, ".bearing/state"), retainedState);
    await rename(join(syncRoot, ".scratch"), retainedScratch);
    await rm(join(syncRoot, ".bearing"), { recursive: true });
    await writeFile(
      join(syncRoot, "docs/agents/issue-tracker.md"),
      "# Issue tracker: Local Markdown\n\nProvider contract: `matt-skills/v1`\n",
    );
    await writeFile(
      join(syncRoot, "AGENTS.md"),
      "Work-management contract: `docs/agents/issue-tracker.md`\n",
    );
    const setupCommand = [
      join(homeDirectory, ".bearing/bin/bearing"),
      "setup",
      "--repo",
      syncRoot,
      "--surface",
      "agent-skills",
      "--provider-contract",
      "docs/agents/issue-tracker.md",
    ];
    const setup = await run(setupCommand, { HOME: homeDirectory });
    expect(setup.exitCode, setup.stderr).toBe(0);
    expect(setup.stdout).toContain("Outcome: applied");
    await access(join(syncRoot, ".bearing/manifest.json"));
    await expect(
      access(join(syncRoot, ".bearing/executor-profiles/generic-agent.md")),
    ).rejects.toThrow();
    await expect(access(join(syncRoot, ".agents/skills/bearing/SKILL.md"))).rejects.toThrow();
    await rename(retainedState, join(syncRoot, ".bearing/state"));
    await rename(retainedScratch, join(syncRoot, ".scratch"));

    const portalPort = await reservePort();
    const portal = Bun.spawn(
      [join(homeDirectory, ".bearing/bin/bearing"), "portal", "--port", String(portalPort)],
      {
        env: { ...process.env, HOME: homeDirectory },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const ready = await waitForReady(portal.stdout);
    expect(ready.line).toBe(`Bearing Portal ready: http://127.0.0.1:${portalPort}`);
    const health = await fetch(`http://127.0.0.1:${portalPort}/healthz`);
    const catalog = await fetch(`http://127.0.0.1:${portalPort}/api/v1/catalog`);
    const application = await fetch(`http://127.0.0.1:${portalPort}/`);
    const firstAsset = assetManifest.assets[0];
    if (firstAsset === undefined) throw new Error("Packed Portal contains no browser assets.");
    const browserAsset = await fetch(`http://127.0.0.1:${portalPort}/${firstAsset.path}`);
    expect(await health.json()).toMatchObject({ state: "ready" });
    expect(await catalog.json()).toMatchObject({
      state: "ready",
      entries: [{ displayName: syncRoot.split("/").at(-1), availability: "available" }],
    });
    expect(await application.text()).toContain("Bearing Portal");
    expect(browserAsset.status).toBe(200);
    portal.kill("SIGTERM");
    expect(await portal.exited).toBe(0);
    ready.reader.releaseLock();

    const syncCommand = [join(homeDirectory, ".bearing/bin/bearing"), "sync", "--repo", syncRoot];
    const firstSync = await run(syncCommand, { HOME: homeDirectory });
    const secondSync = await run(syncCommand, { HOME: homeDirectory });
    expect(firstSync.exitCode).toBe(0);
    expect(firstSync.stdout).toContain("Diagnostics: 0");
    expect(firstSync.stdout).toContain("Outcome: applied");
    expect(secondSync.exitCode).toBe(0);
    expect(secondSync.stdout).toContain("Outcome: no-op");
    await access(join(syncRoot, ".bearing/cache/sync-report.md"));
    await access(join(syncRoot, ".bearing/cache/project-sitemap.md"));

    const inspectOutputs = await Promise.all(
      (
        [
          ["roadmap", "roadmap:test"],
          ["gate", "gate:test"],
          ["effort", "effort:test"],
        ] as const
      ).map(async ([kind, id]) => {
        const result = await run(
          [
            join(homeDirectory, ".bearing/bin/bearing"),
            "inspect",
            kind,
            id,
            "--repo",
            syncRoot as string,
          ],
          { HOME: homeDirectory },
        );
        expect(result.exitCode, result.stderr).toBe(0);
        expect(result.stderr).toBe("");
        return JSON.parse(result.stdout) as {
          readonly state: string;
          readonly fingerprint: string;
          readonly target: Readonly<{ kind: string; id: string }>;
        };
      }),
    );
    expect(inspectOutputs.map((output) => output.state)).toEqual([
      "complete",
      "complete",
      "complete",
    ]);
    expect(inspectOutputs.map((output) => output.target)).toEqual([
      { kind: "roadmap", id: "roadmap:test" },
      { kind: "gate", id: "gate:test" },
      { kind: "effort", id: "effort:test" },
    ]);
    expect(new Set(inspectOutputs.map((output) => output.fingerprint))).toHaveLength(1);

    const rejected = await run(
      [
        "npm",
        "exec",
        "--yes",
        "--offline",
        `--package=${tarball}`,
        "--",
        "bearing",
        "sensitive-input",
      ],
      {
        HOME: homeDirectory,
        npm_config_cache: join(root, "exec-cache"),
        npm_config_update_notifier: "false",
        npm_config_loglevel: "error",
      },
    );
    expect(rejected.exitCode).toBe(1);
    expect(rejected.stderr).toBe("Unknown command. Run bearing --help.\n");
    expect(rejected.stderr).not.toContain("sensitive-input");
  } finally {
    if (syncRoot !== undefined) await rm(syncRoot, { recursive: true, force: true });
    await rm(root, { recursive: true, force: true });
  }
}, 20_000);
