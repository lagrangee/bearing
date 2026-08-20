import { expect, test } from "bun:test";
import { access, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readReleaseTarGz } from "../scripts/release-archive";
import { writeStandardMattLocalRepository, writeValidBearingState } from "./helpers";

type CommandResult = Readonly<{
  exitCode: number;
  stdout: string;
  stderr: string;
}>;

const run = async (
  command: readonly string[],
  environment: Readonly<Record<string, string>>,
  cwd = process.cwd(),
): Promise<CommandResult> => {
  const processHandle = Bun.spawn([...command], {
    cwd,
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
  let configuredRoot: string | undefined;
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
    const archiveEntries = await readReleaseTarGz(tarball);
    const archiveFiles = new Map(
      archiveEntries.filter((entry) => entry.type === "file").map((entry) => [entry.path, entry]),
    );
    const packedAssetManifest = archiveFiles.get("package/dist/portal/asset-manifest.json");
    if (packedAssetManifest === undefined) throw new Error("Packed Portal manifest is absent.");
    const assetManifest = JSON.parse(packedAssetManifest.bytes.toString("utf8")) as {
      readonly assets: readonly Readonly<{ path: string }>[];
    };
    const portalFiles = [
      "package/dist/portal/asset-manifest.json",
      ...assetManifest.assets.map((asset) => `package/dist/portal/${asset.path}`),
    ];
    expect([...archiveFiles.keys()].sort()).toEqual(
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
        "package/docs/cli.md",
        "package/docs/cli.zh-CN.md",
        "package/docs/data-and-security.md",
        "package/docs/data-and-security.zh-CN.md",
        "package/docs/agent-installation.md",
        "package/docs/everyday-workflows.md",
        "package/docs/everyday-workflows.zh-CN.md",
        "package/docs/getting-started.md",
        "package/docs/getting-started.zh-CN.md",
        "package/docs/troubleshooting.md",
        "package/docs/troubleshooting.zh-CN.md",
        "package/package.json",
        "package/skills/bearing/SKILL.md",
        "package/skills/bearing/references/contracts/canonical-mutation.md",
        "package/skills/bearing/references/journeys/catalog.md",
        "package/skills/bearing/references/journeys/configure-active.md",
        "package/skills/bearing/references/journeys/configure-deactivate.md",
        "package/skills/bearing/references/journeys/configure-fresh.md",
        "package/skills/bearing/references/journeys/configure-reactivate.md",
        "package/skills/bearing/references/journeys/configure-unsupported.md",
        "package/skills/bearing/references/journeys/configure.md",
        "package/skills/bearing/references/journeys/execution.md",
        "package/skills/bearing/references/journeys/feature-intake.md",
        "package/skills/bearing/references/journeys/native-work.md",
        "package/skills/bearing/references/journeys/next-work.md",
        "package/skills/bearing/references/journeys/project-orientation.md",
        "package/skills/bearing/references/journeys/scope-review.md",
        "package/skills/bearing/references/journeys/update.md",
        "package/skills/bearing/references/owners/asset.md",
        "package/skills/bearing/references/owners/authority.md",
        "package/skills/bearing/references/owners/effort.md",
        "package/skills/bearing/references/owners/milestone-gate.md",
        "package/skills/bearing/references/owners/planning-audit.md",
        "package/skills/bearing/references/owners/planning-review.md",
        "package/skills/bearing/references/owners/project-brief.md",
        "package/skills/bearing/references/owners/project-summary.md",
        "package/skills/bearing/references/owners/roadmap.md",
      ].sort(),
    );
    const packedText = (path: string): string => {
      const entry = archiveFiles.get(path);
      if (entry === undefined) throw new Error(`Packed file is absent: ${path}`);
      return entry.bytes.toString("utf8");
    };
    const packedSkill = packedText("package/skills/bearing/SKILL.md");
    expect(packedSkill).toContain("$HOME/.bearing/bin/bearing");
    expect(packedSkill).toContain("there is no separate entry preflight");
    expect(packedSkill).not.toMatch(/before the first command.*(?:--version|command -v)/isu);
    const packedWorkflows = packedText("package/docs/everyday-workflows.md");
    expect(packedWorkflows).toContain("explicit or high-confidence material relationship");
    expect(packedWorkflows).toContain("owner-specific recommendation");
    expect(packedWorkflows).toContain("does not require a scope disposition");
    expect(packedWorkflows).toMatch(/An ordinary feature\s+continues through normal delivery/u);
    const packedChineseWorkflows = packedText("package/docs/everyday-workflows.zh-CN.md");
    expect(packedChineseWorkflows).toContain("显式或高置信的实质关联");
    expect(packedChineseWorkflows).toContain("owner-specific 的建议");
    expect(packedChineseWorkflows).toContain("不要求 scope disposition");
    expect(packedChineseWorkflows).toContain("直接继续普通 delivery");
    for (const path of ["package/docs/cli.md", "package/docs/cli.zh-CN.md"]) {
      const cli = packedText(path);
      expect(cli).toMatch(
        /reasonable material planning or governance relevance|合理的实质 planning 或 governance relevance/u,
      );
      expect(cli).not.toContain("material new-feature request");
    }
    const activeProductFiles = [...archiveFiles.entries()].filter(
      ([path]) =>
        path === "package/dist/cli.js" ||
        path === "package/package.json" ||
        path === "package/README.md" ||
        path === "package/README.zh-CN.md" ||
        path.startsWith("package/dist/portal/") ||
        path.startsWith("package/docs/") ||
        path.startsWith("package/skills/"),
    );
    const retiredProductSurface =
      /(?:project-sitemap\.md|sync-report\.md|sync-receipt\.json|project-generation\.json|provider-observations\.json|provider-detail-selections\.json|inspect-benchmark-|benchmark:(?:sync|inspect)|--(?:initialize-provider-observations|benchmark-metrics-file|portal-entry|persist-provider-observations)|\/api\/v1\/projects\/[^\s`"']*\/(?:sync|inspect-native-scope|reconcile-native)|\bbearing sync\b|\bthen Sync\b|\bSetup\b|\b(?:SyncOperationInstrumentation|SyncOperationMetricsSnapshot|createSyncOperationInstrumentation|syncing|topbar-sync|sync-control|sync-failure-detail)\b)/u;
    expect(
      activeProductFiles.flatMap(([path, entry]) => {
        const match = entry.bytes.toString("utf8").match(retiredProductSurface);
        return match === null ? [] : [`${path}: ${match[0]}`];
      }),
    ).toEqual([]);

    const executed = await run(
      ["npm", "exec", "--yes", "--offline", `--package=${tarball}`, "--", "bearing", "--version"],
      {
        HOME: homeDirectory,
        npm_config_cache: join(root, "exec-cache"),
        npm_config_update_notifier: "false",
        npm_config_loglevel: "error",
      },
      root,
    );
    expect(executed.exitCode).toBe(0);
    expect(executed.stdout).toBe("0.1.1\n");
    expect(executed.stderr).toBe("");

    const help = await run(
      ["npm", "exec", "--yes", "--offline", `--package=${tarball}`, "--", "bearing", "--help"],
      {
        HOME: homeDirectory,
        npm_config_cache: join(root, "exec-cache"),
        npm_config_update_notifier: "false",
        npm_config_loglevel: "error",
      },
    );
    expect(help.exitCode).toBe(0);
    expect(help.stdout).toContain("bearing install [--surface <agent-skills|claude>]");
    expect(help.stdout).not.toMatch(/^\s*bearing sync\b/mu);
    expect(help.stdout).not.toContain("benchmark:");

    const retiredCommand = await run(
      ["npm", "exec", "--yes", "--offline", `--package=${tarball}`, "--", "bearing", "sync"],
      {
        HOME: homeDirectory,
        npm_config_cache: join(root, "exec-cache"),
        npm_config_update_notifier: "false",
        npm_config_loglevel: "error",
      },
      root,
    );
    expect(retiredCommand.exitCode).toBe(1);
    expect(retiredCommand.stderr).toBe("Unknown command. Run bearing --help.\n");

    const bundleInstallCommand = [
      "npm",
      "exec",
      "--yes",
      "--offline",
      `--package=${tarball}`,
      "--",
      "bearing",
      "install",
    ];
    const bundleInstalled = await run(bundleInstallCommand, {
      HOME: homeDirectory,
      npm_config_cache: join(root, "exec-cache"),
      npm_config_update_notifier: "false",
      npm_config_loglevel: "error",
    });
    expect(bundleInstalled.exitCode).toBe(0);
    expect(bundleInstalled.stdout).toContain("Outcome: applied");
    await access(join(homeDirectory, ".bearing/kit/current/skills/bearing/SKILL.md"));
    await expect(access(join(homeDirectory, ".agents/skills/bearing"))).rejects.toThrow();
    await expect(access(join(homeDirectory, ".claude/skills/bearing"))).rejects.toThrow();

    const installCommand = [
      ...bundleInstallCommand,
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
    const bundledCanonicalMutation = await readFile(
      join(
        homeDirectory,
        ".bearing/kit/current/skills/bearing/references/contracts/canonical-mutation.md",
      ),
      "utf8",
    );
    expect(bundledCanonicalMutation).toMatch(
      /Agent-authored candidate[\s\S]*re-read[\s\S]*precondition[\s\S]*bearing inspect/iu,
    );
    const bundledProjectOrientation = await readFile(
      join(
        homeDirectory,
        ".bearing/kit/current/skills/bearing/references/journeys/project-orientation.md",
      ),
      "utf8",
    );
    expect(bundledProjectOrientation).toMatch(/Orientation is a read-only Agent synthesis/iu);
    expect(bundledProjectOrientation).toMatch(/Project Summary draft[\s\S]*future Roadmap/iu);
    expect(bundledProjectOrientation).toMatch(/ordered Gate candidates/iu);

    configuredRoot = await mkdtemp(join(root, "fresh-local-repository-"));
    await writeStandardMattLocalRepository(configuredRoot);
    await expect(access(join(configuredRoot, ".bearing"))).rejects.toThrow();
    const configureArguments = [
      join(homeDirectory, ".bearing/bin/bearing"),
      "configure",
      "plan",
      "--intent",
      "activate",
      "--repo",
      configuredRoot,
      "--surface",
      "agent-skills",
      "--provider-contract",
      "docs/agents/issue-tracker.md",
      "--executor-mode",
      "skip",
    ];
    const planned = await run(configureArguments, { HOME: homeDirectory });
    expect(planned.exitCode, planned.stderr).toBe(0);
    const planToken = (JSON.parse(planned.stdout) as { sealedPlanToken?: unknown }).sealedPlanToken;
    if (typeof planToken !== "string") throw new Error("Configure plan returned no seal.");
    const configured = await run(
      [
        join(homeDirectory, ".bearing/bin/bearing"),
        "configure",
        "apply",
        ...configureArguments.slice(3),
        "--plan-token",
        planToken,
      ],
      { HOME: homeDirectory },
    );
    expect(configured.exitCode, configured.stderr).toBe(0);
    expect(JSON.parse(configured.stdout)).toMatchObject({ outcome: "applied" });
    await access(join(configuredRoot, ".bearing/manifest.json"));
    await expect(
      access(join(configuredRoot, ".bearing/executor-profiles/generic-agent.md")),
    ).rejects.toThrow();
    await expect(access(join(configuredRoot, ".agents/skills/bearing/SKILL.md"))).rejects.toThrow();
    await writeValidBearingState(configuredRoot);

    const cli = join(homeDirectory, ".bearing/bin/bearing");
    const rebuilt = await run([cli, "cache", "rebuild", "--repo", configuredRoot], {
      HOME: homeDirectory,
    });
    const verified = await run([cli, "provider", "verify", "--all", "--repo", configuredRoot], {
      HOME: homeDirectory,
    });
    const firstInspection = await run([cli, "inspect", "project", "--repo", configuredRoot], {
      HOME: homeDirectory,
    });
    const secondInspection = await run([cli, "inspect", "project", "--repo", configuredRoot], {
      HOME: homeDirectory,
    });
    expect(rebuilt.exitCode, rebuilt.stderr || rebuilt.stdout).toBe(0);
    expect(verified.exitCode, verified.stderr || verified.stdout).toBe(0);
    expect(firstInspection.exitCode, firstInspection.stderr || firstInspection.stdout).toBe(0);
    expect(secondInspection.exitCode, secondInspection.stderr || secondInspection.stdout).toBe(0);
    expect(JSON.parse(firstInspection.stdout)).toMatchObject({ outcome: "complete" });
    expect(JSON.parse(secondInspection.stdout)).toMatchObject({ outcome: "complete" });
    await access(join(configuredRoot, ".bearing/cache/project-read-model.sqlite"));

    const portalPort = await reservePort();
    const portal = Bun.spawn(
      [join(homeDirectory, ".bearing/bin/bearing"), "portal", "--port", String(portalPort)],
      {
        cwd: root,
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
    const catalogBody = (await catalog.json()) as {
      readonly state: string;
      readonly entries: readonly Readonly<{
        entryId: string;
        displayName: string;
        availability: string;
      }>[];
    };
    expect(catalogBody).toMatchObject({
      state: "ready",
      entries: [{ displayName: configuredRoot.split("/").at(-1), availability: "available" }],
    });
    expect(await application.text()).toContain("Bearing Portal");
    expect(browserAsset.status).toBe(200);
    const entryId = catalogBody.entries[0]?.entryId;
    if (entryId === undefined) throw new Error("Packaged Portal Catalog contains no project.");
    const firstRead = await fetch(
      `http://127.0.0.1:${portalPort}/api/v1/projects/${entryId}/read-model`,
    );
    const firstReadBody = JSON.parse(await firstRead.text()) as {
      readonly state: string;
      readonly rows?: Readonly<{
        section: string;
        objects: readonly unknown[];
      }>;
    };
    expect(firstRead.status).toBe(200);
    expect(firstReadBody.state).toBe("ready");
    if (
      firstReadBody.rows === undefined ||
      !Array.isArray(firstReadBody.rows.objects) ||
      firstReadBody.rows.section !== "overview"
    ) {
      throw new Error(`Packaged Portal returned no typed rows: ${JSON.stringify(firstReadBody)}`);
    }
    expect(firstReadBody.rows.objects.length > 0).toBe(true);
    expect(JSON.stringify(firstReadBody.rows)).not.toContain("basisFingerprint");
    expect(JSON.stringify(firstReadBody.rows)).not.toContain("providerEvidence");
    expect(firstReadBody).not.toHaveProperty("snapshot");
    const cookie = firstRead.headers.get("set-cookie");
    const csrf = firstRead.headers.get("x-bearing-csrf-token");
    if (cookie === null || csrf === null) throw new Error("Packaged Portal created no session.");
    const removedRoute = await fetch(
      `http://127.0.0.1:${portalPort}/api/v1/projects/${entryId}/sync`,
      {
        method: "POST",
        headers: {
          Cookie: cookie,
          "Content-Type": "application/json",
          "X-Bearing-CSRF-Token": csrf,
        },
        body: JSON.stringify({ version: 1, mode: "ensure-current" }),
      },
    );
    const removedRouteBody = await removedRoute.json();
    expect(removedRoute.status).toBe(404);
    expect(removedRouteBody).toEqual({
      code: "not-found",
      message: "No such Portal product action.",
    });
    portal.kill("SIGTERM");
    expect(await portal.exited).toBe(0);
    ready.reader.releaseLock();

    const inspectOutputs = await Promise.all(
      (["roadmap:test", "gate:test", "effort:test"] as const).map(async (id) => {
        const result = await run(
          [
            join(homeDirectory, ".bearing/bin/bearing"),
            "inspect",
            id,
            "--repo",
            configuredRoot as string,
          ],
          { HOME: homeDirectory },
        );
        expect(result.exitCode, result.stderr).toBe(0);
        expect(result.stderr).toBe("");
        return JSON.parse(result.stdout) as {
          readonly outcome: string;
          readonly result: Readonly<{
            target: Readonly<{ kind: string; value: Readonly<{ id: string }> }>;
            revision: Readonly<{ generationFingerprint: string }>;
          }>;
        };
      }),
    );
    expect(inspectOutputs.map((output) => output.outcome)).toEqual([
      "complete",
      "complete",
      "complete",
    ]);
    expect(inspectOutputs.map((output) => output.result.target)).toEqual([
      { kind: "roadmap", value: expect.objectContaining({ id: "roadmap:test" }) },
      { kind: "gate", value: expect.objectContaining({ id: "gate:test" }) },
      { kind: "effort", value: expect.objectContaining({ id: "effort:test" }) },
    ]);
    expect(
      new Set(inspectOutputs.map((output) => output.result.revision.generationFingerprint)),
    ).toHaveLength(1);

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
      root,
    );
    expect(rejected.exitCode).toBe(1);
    expect(rejected.stderr).toBe("Unknown command. Run bearing --help.\n");
    expect(rejected.stderr).not.toContain("sensitive-input");
  } finally {
    if (configuredRoot !== undefined) await rm(configuredRoot, { recursive: true, force: true });
    await rm(root, { recursive: true, force: true });
  }
}, 60_000);
