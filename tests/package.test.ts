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
        "package/docs/everyday-workflows.md",
        "package/docs/everyday-workflows.zh-CN.md",
        "package/docs/getting-started.md",
        "package/docs/getting-started.zh-CN.md",
        "package/docs/troubleshooting.md",
        "package/docs/troubleshooting.zh-CN.md",
        "package/package.json",
        "package/skills/bearing/SKILL.md",
        "package/skills/bearing/references/branch-manifest.yaml",
        "package/skills/bearing/references/branches/alignment-check.md",
        "package/skills/bearing/references/branches/asset-lifecycle.md",
        "package/skills/bearing/references/branches/effort-lifecycle.md",
        "package/skills/bearing/references/branches/milestone-gate.md",
        "package/skills/bearing/references/branches/next-work.md",
        "package/skills/bearing/references/branches/planning-audit.md",
        "package/skills/bearing/references/branches/planning-review.md",
        "package/skills/bearing/references/branches/roadmap.md",
        "package/skills/bearing/references/branches/setup.md",
        "package/skills/bearing/references/branches/summary.md",
        "package/skills/bearing/references/shared/artifact-registration.md",
        "package/skills/bearing/references/shared/executor-continuation.md",
        "package/skills/bearing/references/shared/governance-disposition.md",
        "package/skills/bearing/references/shared/planning-transaction.md",
        "package/skills/bearing/references/shared/project-brief-refresh.md",
        "package/skills/bearing/references/shared/project-orientation.md",
        "package/skills/bearing/references/shared/typed-inspection.md",
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
    const bundledProjectOrientation = await readFile(
      join(
        homeDirectory,
        ".bearing/kit/current/skills/bearing/references/shared/project-orientation.md",
      ),
      "utf8",
    );
    expect(bundledProjectOrientation).toContain("Project Orientation is read-only");
    expect(bundledProjectOrientation).toMatch(
      /Project Summary draft[\s\S]*future Roadmap horizons[\s\S]*candidate Gates/iu,
    );

    syncRoot = await mkdtemp(join(root, "fresh-local-repository-"));
    await writeStandardMattLocalRepository(syncRoot);
    await expect(access(join(syncRoot, ".bearing"))).rejects.toThrow();
    const configureArguments = [
      join(homeDirectory, ".bearing/bin/bearing"),
      "configure",
      "plan",
      "--intent",
      "activate",
      "--repo",
      syncRoot,
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
    await access(join(syncRoot, ".bearing/manifest.json"));
    await expect(
      access(join(syncRoot, ".bearing/executor-profiles/generic-agent.md")),
    ).rejects.toThrow();
    await expect(access(join(syncRoot, ".agents/skills/bearing/SKILL.md"))).rejects.toThrow();
    await writeValidBearingState(syncRoot);

    const syncCommand = [join(homeDirectory, ".bearing/bin/bearing"), "sync", "--repo", syncRoot];
    const firstSync = await run([...syncCommand, "--initialize-provider-observations"], {
      HOME: homeDirectory,
    });
    const secondSync = await run(syncCommand, { HOME: homeDirectory });
    expect(firstSync.exitCode, firstSync.stderr || firstSync.stdout).toBe(0);
    expect(firstSync.stdout).toContain("Diagnostics: 0");
    expect(firstSync.stdout).toContain("Provider observations: initial-baseline/acquired");
    expect(firstSync.stdout).toContain("Outcome: applied");
    expect(secondSync.exitCode).toBe(0);
    expect(secondSync.stdout).toContain("Outcome: no-op");
    await access(join(syncRoot, ".bearing/cache/sync-report.md"));
    await access(join(syncRoot, ".bearing/cache/project-sitemap.md"));

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
      entries: [{ displayName: syncRoot.split("/").at(-1), availability: "available" }],
    });
    expect(await application.text()).toContain("Bearing Portal");
    expect(browserAsset.status).toBe(200);
    const entryId = catalogBody.entries[0]?.entryId;
    if (entryId === undefined) throw new Error("Packaged Portal Catalog contains no project.");
    const firstSnapshot = await fetch(
      `http://127.0.0.1:${portalPort}/api/v1/projects/${entryId}/snapshot`,
    );
    const cookie = firstSnapshot.headers.get("set-cookie");
    const csrf = firstSnapshot.headers.get("x-bearing-csrf-token");
    if (cookie === null || csrf === null) throw new Error("Packaged Portal created no session.");
    const portalSync = await fetch(
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
    const portalSyncBody = (await portalSync.json()) as {
      readonly state: string;
      readonly view?: Readonly<{
        cache: Readonly<{
          snapshot: Readonly<{
            state: string;
            snapshot?: Readonly<{
              basis: Readonly<{ sitemapFingerprint: string }>;
              providerObservations: readonly Readonly<{
                id: string;
              }>[];
              providerObservationSelections: readonly Readonly<{
                observationId: string | null;
              }>[];
              maps?: unknown;
              tickets?: unknown;
            }>;
          }>;
        }>;
      }>;
    };
    expect(portalSync.status).toBe(200);
    expect(portalSyncBody).toMatchObject({
      state: "completed",
      view: { cache: { snapshot: { state: "available" } } },
    });
    const packagedSnapshot = portalSyncBody.view?.cache.snapshot.snapshot;
    if (packagedSnapshot === undefined) throw new Error("Packaged Portal returned no Snapshot.");
    expect(packagedSnapshot.providerObservations).toHaveLength(1);
    expect(packagedSnapshot.providerObservationSelections[0]?.observationId).toBe(
      packagedSnapshot.providerObservations[0]?.id,
    );
    expect(packagedSnapshot).not.toHaveProperty("maps");
    expect(packagedSnapshot).not.toHaveProperty("tickets");
    portal.kill("SIGTERM");
    expect(await portal.exited).toBe(0);
    ready.reader.releaseLock();

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
}, 60_000);
