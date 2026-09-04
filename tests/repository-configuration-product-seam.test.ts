import { expect, test } from "bun:test";
import {
  access,
  chmod,
  cp,
  mkdir,
  readdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { BEARING_DEVELOPMENT_POINTER, BEARING_POINTER } from "../src/agent-surface-entry";
import { renderExecutionProfile } from "../src/executor-registration";
import {
  assertRepositoryTargetPreconditionsCurrent,
  captureRepositoryTargetPreconditions,
} from "../src/repository-integration-plan";
import { writeStandardMattLocalRepository, writeValidBearingState } from "./helpers";
import { type InstalledProduct, installPackedProduct } from "./product-seams/installed-product";

const sourceRoot = join(import.meta.dirname, "..");

const runProcess = async (
  command: readonly string[],
  options: Readonly<{ cwd: string; environment?: NodeJS.ProcessEnv }>,
) => {
  const child = Bun.spawn([...command], {
    cwd: options.cwd,
    env: { ...process.env, ...options.environment },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { exitCode, stdout, stderr };
};

const createDevelopmentSourceProduct = async (root: string) => {
  await mkdir(root);
  for (const locator of [
    "dist",
    "index.html",
    "package-lock.json",
    "package.json",
    "scripts",
    "skills/bearing",
    "skills/bearing-dev",
    "src",
    "tsconfig.json",
    "vite.config.ts",
  ]) {
    await cp(join(sourceRoot, locator), join(root, locator), { recursive: true });
  }
  await mkdir(join(root, ".agents/skills"), { recursive: true });
  await symlink("../../skills/bearing-dev", join(root, ".agents/skills/bearing-dev"));
  for (const args of [
    ["init", "--quiet"],
    ["add", "."],
    [
      "-c",
      "user.name=Bearing Test",
      "-c",
      "user.email=test@example.invalid",
      "commit",
      "--quiet",
      "-m",
      "fixture",
    ],
  ]) {
    const result = await runProcess(["git", ...args], { cwd: root });
    if (result.exitCode !== 0) throw new Error(result.stderr);
  }
  const homeDir = join(root, "home");
  await mkdir(homeDir);
  return {
    root,
    run: (args: readonly string[]) =>
      runProcess(["node", join(root, "dist/cli.js"), ...args], {
        cwd: root,
        environment: { HOME: homeDir },
      }),
  };
};

const makeFreshRepository = async (root: string): Promise<void> => {
  await mkdir(join(root, "docs/agents"), { recursive: true });
  await writeFile(
    join(root, "docs/agents/issue-tracker.md"),
    `# Issue tracker: Local Markdown

## Conventions

- One feature per directory.

## When a skill says "publish to the issue tracker"

Create a Markdown file.

## When a skill says "fetch the relevant ticket"

Read the referenced file.

## Wayfinding operations

Use one Map with child tickets.
`,
  );
  await writeFile(
    join(root, "AGENTS.md"),
    [
      "# Agent instructions",
      "",
      "## Agent skills",
      "",
      "### Issue tracker",
      "",
      "Issues and PRDs use the repository tracker. See `docs/agents/issue-tracker.md`.",
      "",
    ].join("\n"),
  );
};

const activateArguments = (root: string): readonly string[] => [
  "--intent",
  "activate",
  "--repo",
  root,
  "--surface",
  "agent-skills",
  "--provider-contract",
  "docs/agents/issue-tracker.md",
  "--executor-mode",
  "skip",
];

const plan = async (
  product: InstalledProduct,
  args: readonly string[],
): Promise<Readonly<Record<string, unknown>>> => {
  const result = await product.run(["configure", "plan", ...args]);
  expect(result.exitClass, `${result.stderr}\n${result.stdout}`).toBe("success");
  return JSON.parse(result.stdout) as Readonly<Record<string, unknown>>;
};

const apply = async (product: InstalledProduct, args: readonly string[], token: string) =>
  product.run(["configure", "apply", ...args, "--plan-token", token], {
    environment: { BEARING_PORT: "1" },
  });

const readSqliteUserVersion = async (path: string): Promise<number> => {
  const child = Bun.spawn(
    [
      "node",
      "--input-type=module",
      "--eval",
      "import { DatabaseSync } from 'node:sqlite'; const db = new DatabaseSync(process.argv[1], { readOnly: true }); process.stdout.write(String(db.prepare('PRAGMA user_version').get().user_version)); db.close();",
      path,
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  if (exitCode !== 0) throw new Error(stderr);
  return Number(stdout);
};

const snapshotOwnerBytes = async (root: string): Promise<ReadonlyMap<string, Buffer>> => {
  const snapshot = new Map<string, Buffer>();
  const visit = async (locator: string): Promise<void> => {
    for (const entry of (await readdir(join(root, locator), { withFileTypes: true })).sort(
      (left, right) => left.name.localeCompare(right.name, "en"),
    )) {
      const child = join(locator, entry.name);
      if (entry.isDirectory()) await visit(child);
      else if (entry.isFile()) snapshot.set(child, await readFile(join(root, child)));
      else throw new Error(`Preserved owner path is not a regular file or directory: ${child}`);
    }
  };
  snapshot.set(".bearing/provider.json", await readFile(join(root, ".bearing/provider.json")));
  snapshot.set("AGENTS.md", await readFile(join(root, "AGENTS.md")));
  for (const locator of [".bearing/state", ".bearing/executor-profiles", ".scratch/work"]) {
    await visit(locator);
  }
  return snapshot;
};

test("Repository Configuration selects Development Runtime without public fallback", async () => {
  const product = await installPackedProduct();
  const root = join(product.root, "development-repository");
  await makeFreshRepository(root);
  const args = [...activateArguments(root), "--runtime", "development"];
  try {
    const reviewed = await plan(product, args);
    expect(reviewed).toMatchObject({
      acceptedDesiredConfiguration: { runtime: "development" },
    });
    const token = reviewed["sealedPlanToken"];
    if (typeof token !== "string") throw new Error("Configure plan returned no seal.");
    const applied = await apply(product, args, token);
    expect(applied.exitClass, applied.stderr).toBe("success");
    expect(JSON.parse(await readFile(join(root, ".bearing/manifest.json"), "utf8"))).toMatchObject({
      runtime: "development",
    });
    expect(await readFile(join(root, "AGENTS.md"), "utf8")).toContain(BEARING_DEVELOPMENT_POINTER);

    const blocked = await product.run(["inspect", "project", "--repo", root], {
      observeRoots: [root, product.homeDir],
    });
    expect(blocked.exitClass).toBe("product-outcome");
    expect(JSON.parse(blocked.stdout)).toMatchObject({
      outcome: "unfulfilled",
      diagnostics: [{ code: "development-runtime-binding-missing" }],
    });
    expect(blocked.effects).toEqual({ created: [], changed: [], removed: [] });

    const configurationBlocked = await product.run(["configure", "inspect", "--repo", root], {
      observeRoots: [root, product.homeDir],
    });
    expect(configurationBlocked.exitClass).toBe("product-outcome");
    expect(JSON.parse(configurationBlocked.stdout)).toMatchObject({
      outcome: "unfulfilled",
      diagnostics: [{ code: "development-runtime-binding-missing" }],
    });
    expect(configurationBlocked.effects).toEqual({ created: [], changed: [], removed: [] });
  } finally {
    await rm(product.root, { recursive: true, force: true });
  }
});

test("packed Repository Configuration seals one exact Fresh write set and applies it without provider acquisition", async () => {
  const product = await installPackedProduct();
  const root = join(product.root, "fresh-repository");
  await makeFreshRepository(root);
  const args = activateArguments(root);
  try {
    const bare = await product.run(["configure"], { observeRoots: [root, product.homeDir] });
    expect(bare.exitClass).toBe("success");
    expect(bare.stdout).toContain("Repository Configuration is Agent-led");
    expect(bare.effects).toEqual({ created: [], changed: [], removed: [] });

    const inspected = await product.run(["configure", "inspect", "--repo", root], {
      observeRoots: [root, product.homeDir],
    });
    expect(inspected.exitClass, inspected.stderr).toBe("success");
    expect(inspected.effects).toEqual({ created: [], changed: [], removed: [] });
    expect(JSON.parse(inspected.stdout)).toMatchObject({
      command: "configure-inspect",
      lifecycle: { state: "fresh", removalRequired: false },
      currentSelections: { surfaces: [], executorProfiles: [] },
      machineFacts: { manifest: "missing", cache: "missing", catalog: "ready" },
    });

    const prematureInspect = await product.run(["inspect", "project", "--repo", root], {
      observeRoots: [root],
    });
    expect(prematureInspect.exitClass).toBe("product-outcome");
    expect(prematureInspect.stderr).toMatch(/requires an Active Repository Configuration/iu);
    expect(prematureInspect.effects).toEqual({ created: [], changed: [], removed: [] });
    const prematureRebuild = await product.run(["cache", "rebuild", "--repo", root], {
      observeRoots: [root],
    });
    expect(prematureRebuild.exitClass).toBe("product-outcome");
    expect(prematureRebuild.stderr).toMatch(/requires an Active Repository Configuration/iu);
    expect(prematureRebuild.effects).toEqual({ created: [], changed: [], removed: [] });

    const incomplete = await product.run([
      "configure",
      "plan",
      "--intent",
      "activate",
      "--repo",
      root,
    ]);
    expect(incomplete.exitClass).toBe("product-outcome");
    const incompletePlan = JSON.parse(incomplete.stdout);
    expect(incompletePlan.unresolvedChoices).toEqual(["agent-surfaces", "provider", "executor"]);
    expect(incompletePlan).not.toHaveProperty("sealedPlanToken");

    const reviewed = await plan(product, args);
    expect(reviewed).toMatchObject({
      command: "configure-plan",
      intent: "activate",
      canApply: true,
      repositoryApplyUnit: {
        owner: "bearing-repository-configuration",
        atomic: true,
        rollback: "restore-previous-repository-bytes",
      },
      catalogStage: {
        action: "upsert",
        order: "after-repository-validation",
        rollback: "independent",
      },
    });
    expect(reviewed["repositoryApplyUnit"]).toMatchObject({
      targets: expect.arrayContaining([
        ".bearing/manifest.json",
        ".bearing/provider.json",
        ".bearing/cache/project-read-model.sqlite",
        "AGENTS.md",
      ]),
    });
    const token = reviewed["sealedPlanToken"];
    if (typeof token !== "string") throw new Error("Configure plan returned no seal.");
    expect(token).toMatch(/^sha256:[0-9a-f]{64}$/u);

    const applied = await apply(product, args, token);
    expect(applied.exitClass, applied.stderr).toBe("success");
    const output = JSON.parse(applied.stdout);
    expect(output).toMatchObject({
      command: "configure-apply",
      intent: "activate",
      outcome: "applied",
      repository: {
        outcome: "applied",
        readModel: { acquisitionCount: 0, missingEvidenceScopes: [] },
      },
      catalog: { outcome: "applied" },
      portalHandoff: {
        state: "absent",
        guidance: "run-bearing-portal-in-separate-terminal",
      },
    });
    const manifest = JSON.parse(await readFile(join(root, ".bearing/manifest.json"), "utf8"));
    expect(manifest).toEqual({
      schemaVersion: 2,
      packageVersion: "0.1.2-dev",
      status: "active",
      runtime: "stable",
      surfaces: ["agent-skills"],
      executorProfiles: [],
    });
    const exactAgentSurface = await readFile(join(root, "AGENTS.md"), "utf8");
    expect(exactAgentSurface).toContain(BEARING_POINTER);
    const driftedAgentSurface = exactAgentSurface.replace(
      BEARING_POINTER,
      `${BEARING_POINTER} Changed outside the managed pointer.`,
    );
    expect(driftedAgentSurface).not.toBe(exactAgentSurface);
    await writeFile(join(root, "AGENTS.md"), driftedAgentSurface);
    const drifted = await product.run(["configure", "inspect", "--repo", root], {
      observeRoots: [root, product.homeDir],
    });
    expect(drifted.exitClass, drifted.stderr).toBe("success");
    expect(JSON.parse(drifted.stdout)).toMatchObject({
      installedCapabilityEvidence: {
        managedPointers: { "agent-skills": "drifted" },
      },
    });
    await writeFile(join(root, "AGENTS.md"), exactAgentSurface);
    expect(
      await readSqliteUserVersion(join(root, ".bearing/cache/project-read-model.sqlite")),
    ).toBeGreaterThan(0);
    const readModelBytes = await readFile(join(root, ".bearing/cache/project-read-model.sqlite"));
    const activePlan = await plan(product, args);
    const activeToken = activePlan["sealedPlanToken"];
    if (typeof activeToken !== "string") throw new Error("Active plan returned no seal.");
    const activeNoOp = await apply(product, args, activeToken);
    expect(activeNoOp.exitClass, activeNoOp.stderr).toBe("success");
    const activeNoOpOutput = JSON.parse(activeNoOp.stdout);
    expect(activeNoOpOutput).toMatchObject({
      outcome: "no-op",
      repository: { outcome: "no-op" },
      catalog: { outcome: "no-op" },
    });
    expect(activeNoOpOutput).not.toHaveProperty("portalHandoff");
    expect(await readFile(join(root, ".bearing/cache/project-read-model.sqlite"))).toEqual(
      readModelBytes,
    );
    await expect(access(join(root, ".bearing/state/roadmaps"))).rejects.toThrow();
    await expect(access(join(root, ".scratch"))).rejects.toThrow();
  } finally {
    await product.dispose();
  }
}, 60_000);

test("Configure Apply rejects a stale seal without writing and deactivation preserves owned state", async () => {
  const product = await installPackedProduct();
  const root = join(product.root, "lifecycle-repository");
  await makeFreshRepository(root);
  const args = activateArguments(root);
  try {
    const reviewed = await plan(product, args);
    const token = reviewed["sealedPlanToken"];
    if (typeof token !== "string") throw new Error("Configure plan returned no seal.");
    await writeFile(
      join(root, "AGENTS.md"),
      `${await readFile(join(root, "AGENTS.md"), "utf8")}# race\n`,
    );
    const stale = await apply(product, args, token);
    expect(stale.exitClass).toBe("product-outcome");
    expect(stale.stderr).toMatch(/stale|reviewed write set/iu);
    await expect(access(join(root, ".bearing/manifest.json"))).rejects.toThrow();

    const current = await plan(product, args);
    const currentToken = current["sealedPlanToken"];
    if (typeof currentToken !== "string") throw new Error("Configure plan returned no seal.");
    expect((await apply(product, args, currentToken)).exitClass).toBe("success");
    await mkdir(join(root, ".bearing/state"), { recursive: true });
    await writeFile(join(root, ".bearing/state/retained.md"), "retained\n");
    await mkdir(join(root, ".scratch/work"), { recursive: true });
    await writeFile(join(root, ".scratch/work/native.md"), "native\n");

    const readModelPath = join(root, ".bearing/cache/project-read-model.sqlite");
    const readModelBeforeExecutorRemoval = await readFile(readModelPath);
    const manifestPath = join(root, ".bearing/manifest.json");
    const manifestWithProfile = JSON.parse(await readFile(manifestPath, "utf8"));
    manifestWithProfile.executorProfiles = ["legacy-profile"];
    await writeFile(manifestPath, `${JSON.stringify(manifestWithProfile, null, 2)}\n`);
    await mkdir(join(root, ".bearing/executor-profiles"), { recursive: true });
    await writeFile(
      join(root, ".bearing/executor-profiles/legacy-profile.md"),
      "retained profile\n",
    );
    const removeExecutorArgs = [
      "--intent",
      "activate",
      "--repo",
      root,
      "--surface",
      "agent-skills",
      "--provider-contract",
      "docs/agents/issue-tracker.md",
      "--executor-mode",
      "configure",
      "--remove-executor",
      "legacy-profile",
    ] as const;
    const removeExecutorPlan = await plan(product, removeExecutorArgs);
    const removeExecutorToken = removeExecutorPlan["sealedPlanToken"];
    if (typeof removeExecutorToken !== "string") {
      throw new Error("Executor removal plan returned no seal.");
    }
    const removedExecutor = await apply(product, removeExecutorArgs, removeExecutorToken);
    expect(removedExecutor.exitClass, removedExecutor.stderr).toBe("success");
    expect(await readFile(readModelPath)).toEqual(readModelBeforeExecutorRemoval);
    await expect(
      access(join(root, ".bearing/executor-profiles/legacy-profile.md")),
    ).rejects.toThrow();
    expect(await readFile(join(root, ".bearing/state/retained.md"), "utf8")).toBe("retained\n");
    expect(await readFile(join(root, ".scratch/work/native.md"), "utf8")).toBe("native\n");

    const deactivateArgs = ["--intent", "deactivate", "--repo", root] as const;
    const deactivation = await plan(product, deactivateArgs);
    expect(deactivation).toMatchObject({
      canApply: true,
      catalogStage: { action: "unregister" },
      preservationEffects: expect.arrayContaining([
        "canonical Bearing State",
        "Provider Configuration",
        "native work",
      ]),
    });
    const deactivateToken = deactivation["sealedPlanToken"];
    if (typeof deactivateToken !== "string") throw new Error("Deactivate plan returned no seal.");
    const deactivated = await apply(product, deactivateArgs, deactivateToken);
    expect(deactivated.exitClass, deactivated.stderr).toBe("success");
    expect(JSON.parse(deactivated.stdout)).toMatchObject({
      command: "configure-apply",
      intent: "deactivate",
      repository: { outcome: "applied" },
      catalog: { outcome: "applied" },
    });
    expect(JSON.parse(await readFile(join(root, ".bearing/manifest.json"), "utf8"))).toMatchObject({
      status: "deactivated",
    });
    expect(await readFile(join(root, ".bearing/provider.json"), "utf8")).toContain(
      "matt-skills/v1",
    );
    expect(await readFile(join(root, ".bearing/state/retained.md"), "utf8")).toBe("retained\n");
    expect(await readFile(join(root, ".scratch/work/native.md"), "utf8")).toBe("native\n");
    expect(await readFile(join(root, "AGENTS.md"), "utf8")).not.toContain(BEARING_POINTER);
    await expect(access(join(root, ".bearing/cache"))).rejects.toThrow();
    const deactivatedRebuild = await product.run(["cache", "rebuild", "--repo", root], {
      observeRoots: [root],
    });
    expect(deactivatedRebuild.exitClass).toBe("product-outcome");
    expect(deactivatedRebuild.stderr).toMatch(/requires an Active Repository Configuration/iu);
    expect(deactivatedRebuild.effects).toEqual({ created: [], changed: [], removed: [] });
    const prematureProvider = await product.run([
      "provider",
      "capture",
      "--repo",
      root,
      "--scope",
      ".scratch/work",
    ]);
    expect(prematureProvider.exitClass).toBe("product-outcome");
    expect(prematureProvider.stderr).toMatch(/requires an Active Repository Configuration/iu);
    await expect(access(join(root, ".bearing/cache"))).rejects.toThrow();
  } finally {
    await product.dispose();
  }
}, 60_000);

test("Configure Plan seals deselected managed pointer removals", async () => {
  const product = await installPackedProduct();
  const root = join(product.root, "surface-repository");
  await makeFreshRepository(root);
  await writeFile(
    join(root, "CLAUDE.md"),
    "# Claude instructions\n\n## Agent skills\n\n### Issue tracker\n\nWork-management contract: `docs/agents/issue-tracker.md`\n",
  );
  const bothSurfaceArgs = [...activateArguments(root), "--surface", "claude"] as const;
  try {
    const firstPlan = await plan(product, bothSurfaceArgs);
    const firstToken = firstPlan["sealedPlanToken"];
    if (typeof firstToken !== "string") throw new Error("Initial plan returned no seal.");
    expect((await apply(product, bothSurfaceArgs, firstToken)).exitClass).toBe("success");
    expect(await readFile(join(root, "CLAUDE.md"), "utf8")).toContain(BEARING_POINTER);

    const narrowed = await plan(product, activateArguments(root));
    expect(narrowed["repositoryApplyUnit"]).toMatchObject({
      targets: expect.arrayContaining(["AGENTS.md", "CLAUDE.md"]),
      preconditions: expect.arrayContaining([expect.objectContaining({ target: "CLAUDE.md" })]),
    });
    const narrowedToken = narrowed["sealedPlanToken"];
    if (typeof narrowedToken !== "string") throw new Error("Narrowed plan returned no seal.");
    expect((await apply(product, activateArguments(root), narrowedToken)).exitClass).toBe(
      "success",
    );
    expect(await readFile(join(root, "CLAUDE.md"), "utf8")).not.toContain(BEARING_POINTER);
  } finally {
    await product.dispose();
  }
}, 60_000);

test("repository rollback and Catalog partial outcomes remain separate and resumable", async () => {
  const product = await installPackedProduct();
  const rollbackRoot = join(product.root, "rollback-repository");
  const partialRoot = join(product.root, "partial-repository");
  await Promise.all([makeFreshRepository(rollbackRoot), makeFreshRepository(partialRoot)]);
  try {
    await mkdir(join(rollbackRoot, ".bearing/cache/project-read-model.sqlite"), {
      recursive: true,
    });
    const rollbackArgs = activateArguments(rollbackRoot);
    const rollbackPlan = await plan(product, rollbackArgs);
    const rollbackToken = rollbackPlan["sealedPlanToken"];
    if (typeof rollbackToken !== "string") throw new Error("Rollback plan returned no seal.");
    const rejected = await apply(product, rollbackArgs, rollbackToken);
    expect(rejected.exitClass).toBe("product-outcome");
    await expect(access(join(rollbackRoot, ".bearing/manifest.json"))).rejects.toThrow();
    expect(await readFile(join(rollbackRoot, "AGENTS.md"), "utf8")).not.toContain(BEARING_POINTER);

    const partialArgs = activateArguments(partialRoot);
    const partialPlan = await plan(product, partialArgs);
    const partialToken = partialPlan["sealedPlanToken"];
    if (typeof partialToken !== "string") throw new Error("Partial plan returned no seal.");
    await mkdir(join(product.homeDir, ".bearing/catalog.sqlite"), { recursive: true });
    const partial = await apply(product, partialArgs, partialToken);
    expect(partial.exitClass).toBe("product-outcome");
    expect(JSON.parse(partial.stdout)).toMatchObject({
      outcome: "partial",
      repository: { outcome: "applied" },
      catalog: { outcome: "failed" },
      resumption: {
        operation: "repository-configuration",
        intent: "activate",
        pendingStage: "catalog-upsert",
        nextAction: "plan-and-apply-current-configuration",
      },
    });
    expect(
      JSON.parse(await readFile(join(partialRoot, ".bearing/manifest.json"), "utf8")),
    ).toMatchObject({
      status: "active",
    });
    await rm(join(product.homeDir, ".bearing/catalog.sqlite"), { recursive: true });
    const resumedPlan = await plan(product, partialArgs);
    const resumedToken = resumedPlan["sealedPlanToken"];
    if (typeof resumedToken !== "string") throw new Error("Resumption plan returned no seal.");
    const resumed = await apply(product, partialArgs, resumedToken);
    expect(resumed.exitClass, resumed.stderr).toBe("success");
    expect(JSON.parse(resumed.stdout)).toMatchObject({
      outcome: "applied",
      repository: { outcome: "no-op" },
      catalog: { outcome: "applied" },
    });
  } finally {
    await product.dispose();
  }
}, 60_000);

test("Repository target requires explicit Runtime and preserves Stable and Development separation", async () => {
  const product = await installPackedProduct();
  const root = join(product.root, "unsupported-repository");
  await makeFreshRepository(root);
  await mkdir(join(root, ".bearing"), { recursive: true });
  await writeFile(
    join(root, ".bearing/manifest.json"),
    `${JSON.stringify({ schemaVersion: 99, status: "active" })}\n`,
  );
  try {
    const inspected = await product.run(["configure", "inspect", "--repo", root]);
    expect(inspected.exitClass).toBe("success");
    expect(JSON.parse(inspected.stdout)).toMatchObject({
      lifecycle: { state: "kit-update-required", removalRequired: false },
    });
    const planned = await product.run(["configure", "plan", ...activateArguments(root)]);
    expect(planned.exitClass).toBe("product-outcome");
    expect(JSON.parse(planned.stdout).blockers[0].message).toMatch(/newer Bearing Kit/iu);

    const stableTarget = {
      schemaVersion: 2,
      packageVersion: "0.1.2-dev",
      status: "active",
      runtime: "stable",
      surfaces: ["agent-skills"],
      executorProfiles: [],
    } as const;
    await writeFile(join(root, ".bearing/manifest.json"), `${JSON.stringify(stableTarget)}\n`);
    const activeStable = await product.run(["configure", "inspect", "--repo", root]);
    expect(activeStable.exitClass, activeStable.stderr).toBe("success");
    expect(JSON.parse(activeStable.stdout)).toMatchObject({
      lifecycle: { state: "active", removalRequired: false },
      currentSelections: { runtime: "stable" },
    });

    await writeFile(
      join(root, ".bearing/manifest.json"),
      `${JSON.stringify({ ...stableTarget, status: "deactivated" })}\n`,
    );
    const deactivatedStable = await product.run(["configure", "inspect", "--repo", root]);
    expect(deactivatedStable.exitClass, deactivatedStable.stderr).toBe("success");
    expect(JSON.parse(deactivatedStable.stdout)).toMatchObject({
      lifecycle: { state: "deactivated", removalRequired: false },
      currentSelections: { runtime: "stable" },
    });

    await writeFile(
      join(root, ".bearing/manifest.json"),
      `${JSON.stringify({ ...stableTarget, packageVersion: "0.1.3" })}\n`,
    );
    const newerPackage = await product.run(["configure", "inspect", "--repo", root]);
    expect(newerPackage.exitClass, newerPackage.stderr).toBe("success");
    expect(JSON.parse(newerPackage.stdout)).toMatchObject({
      lifecycle: { state: "kit-update-required", removalRequired: false },
    });

    const { runtime: _runtime, ...missingRuntimeTarget } = stableTarget;
    await writeFile(
      join(root, ".bearing/manifest.json"),
      `${JSON.stringify(missingRuntimeTarget)}\n`,
    );
    const missingRuntime = await product.run(["configure", "inspect", "--repo", root]);
    expect(missingRuntime.exitClass, missingRuntime.stderr).toBe("success");
    const missingRuntimeInspection = JSON.parse(missingRuntime.stdout) as Readonly<{
      currentSelections: Readonly<Record<string, unknown>>;
      installedCapabilityEvidence: Readonly<Record<string, unknown>>;
      lifecycle: Readonly<Record<string, unknown>>;
      machineFacts: Readonly<Record<string, unknown>>;
    }>;
    expect(missingRuntimeInspection).toMatchObject({
      lifecycle: { state: "unsupported", removalRequired: false },
      currentSelections: { surfaces: [], executorProfiles: [] },
    });
    expect(missingRuntimeInspection.currentSelections["runtime"]).toBeUndefined();
    expect(
      missingRuntimeInspection.installedCapabilityEvidence["providerContract"],
    ).toBeUndefined();
    expect(missingRuntimeInspection.installedCapabilityEvidence["managedPointers"]).toBeUndefined();
    expect(missingRuntimeInspection.machineFacts["catalog"]).toBeUndefined();
    expect(missingRuntime.stdout).not.toContain('"runtime": "stable"');
    const unresolvedRuntime = await product.run(["runtime", "inspect", "--repo", root]);
    expect(unresolvedRuntime.exitClass).toBe("product-outcome");
    expect(JSON.parse(unresolvedRuntime.stdout)).toMatchObject({
      outcome: "recovery-required",
      diagnostics: [{ code: "repository-runtime-target-invalid" }],
    });

    const developmentProduct = await createDevelopmentSourceProduct(
      join(product.root, "development-source-product"),
    );
    await writeStandardMattLocalRepository(developmentProduct.root);
    const developmentArguments = [
      ...activateArguments(developmentProduct.root),
      "--runtime",
      "development",
    ];
    const sourcePlan = await developmentProduct.run(["configure", "plan", ...developmentArguments]);
    expect(sourcePlan.exitCode, sourcePlan.stderr).toBe(0);
    const sourcePlanValue = JSON.parse(sourcePlan.stdout) as Readonly<{
      sealedPlanToken?: unknown;
    }>;
    expect(typeof sourcePlanValue.sealedPlanToken).toBe("string");
    const sourceApply = await developmentProduct.run([
      "configure",
      "apply",
      ...developmentArguments,
      "--plan-token",
      sourcePlanValue.sealedPlanToken as string,
    ]);
    expect(sourceApply.exitCode, sourceApply.stderr).toBe(0);
    const bootstrap = await developmentProduct.run([
      "runtime",
      "bootstrap",
      "--repo",
      developmentProduct.root,
    ]);
    expect(bootstrap.exitCode, bootstrap.stderr).toBe(0);
    await writeValidBearingState(developmentProduct.root);
    const capture = await developmentProduct.run([
      "provider",
      "capture",
      "--scope",
      ".scratch/work",
      "--repo",
      developmentProduct.root,
    ]);
    expect(capture.exitCode, capture.stderr).toBe(0);
    const profileKey = "agent-skills-fixture";
    await mkdir(join(developmentProduct.root, ".bearing/executor-profiles"), { recursive: true });
    await writeFile(
      join(developmentProduct.root, `.bearing/executor-profiles/${profileKey}.md`),
      renderExecutionProfile({
        profileKey,
        displayName: "/fixture",
        surface: "agent-skills",
        capabilityLocator: "agent-skills:fixture",
        nativeArtifacts: ["Verified implementation output."],
        writebackBehavior: "Record the verified execution outcome.",
      }),
    );
    const preservedBefore = await snapshotOwnerBytes(developmentProduct.root);
    await writeFile(
      join(developmentProduct.root, ".bearing/manifest.json"),
      `${JSON.stringify({
        schemaVersion: 1,
        packageVersion: "0.1.1",
        status: "active",
        runtime: "development",
        surfaces: ["agent-skills"],
        executorProfiles: [profileKey],
      })}\n`,
    );

    const developmentLineStart = await developmentProduct.run([
      "configure",
      "inspect",
      "--repo",
      developmentProduct.root,
    ]);
    expect(developmentLineStart.exitCode, developmentLineStart.stderr).toBe(0);
    expect(JSON.parse(developmentLineStart.stdout)).toMatchObject({
      lifecycle: {
        state: "repository-update-required",
        removalRequired: false,
        update: {
          source: { schemaVersion: 1, packageVersion: "0.1.1" },
          target: {
            manifest: {
              schemaVersion: 2,
              packageVersion: "0.1.2-dev",
              status: "active",
              runtime: "development",
              surfaces: ["agent-skills"],
              executorProfiles: [profileKey],
            },
            writeDomains: {
              canonical: [".bearing/manifest.json"],
              disposable: [".bearing/cache/development/project-read-model.sqlite"],
            },
          },
          guide: "references/journeys/update.md",
        },
      },
    });
    const developmentLinePlan = await developmentProduct.run([
      "configure",
      "plan",
      ...developmentArguments,
    ]);
    expect(developmentLinePlan.exitCode).toBe(1);
    expect(JSON.parse(developmentLinePlan.stdout).blockers[0].message).toMatch(
      /Agent-guided repository update.*Human confirmation/iu,
    );
    expect(
      JSON.parse(await readFile(join(developmentProduct.root, ".bearing/manifest.json"), "utf8")),
    ).toEqual({
      schemaVersion: 1,
      packageVersion: "0.1.1",
      status: "active",
      runtime: "development",
      surfaces: ["agent-skills"],
      executorProfiles: [profileKey],
    });

    await writeFile(
      join(developmentProduct.root, ".bearing/manifest.json"),
      `${JSON.stringify({
        schemaVersion: 1,
        packageVersion: "0.1.2-dev",
        status: "active",
        runtime: "development",
        surfaces: ["agent-skills"],
        executorProfiles: [profileKey],
      })}\n`,
    );
    const samePackageOlderSchema = await developmentProduct.run([
      "configure",
      "inspect",
      "--repo",
      developmentProduct.root,
    ]);
    expect(samePackageOlderSchema.exitCode, samePackageOlderSchema.stderr).toBe(0);
    expect(JSON.parse(samePackageOlderSchema.stdout)).toMatchObject({
      lifecycle: {
        state: "repository-update-required",
        removalRequired: false,
        update: {
          source: { schemaVersion: 1, packageVersion: "0.1.2-dev" },
          target: { manifest: { schemaVersion: 2, packageVersion: "0.1.2-dev" } },
        },
      },
    });

    await writeFile(
      join(developmentProduct.root, ".bearing/manifest.json"),
      `${JSON.stringify({
        schemaVersion: 2,
        packageVersion: "0.1.2-dev",
        status: "active",
        runtime: "development",
        surfaces: ["agent-skills"],
        executorProfiles: [profileKey],
      })}\n`,
    );
    const rebuilt = await developmentProduct.run([
      "cache",
      "rebuild",
      "--repo",
      developmentProduct.root,
    ]);
    expect(rebuilt.exitCode, rebuilt.stderr).toBe(0);
    expect(JSON.parse(rebuilt.stdout)).toMatchObject({
      outcome: "complete",
      diagnostics: [],
      result: { acquisitionCount: 0 },
    });
    await access(
      join(developmentProduct.root, ".bearing/cache/development/project-read-model.sqlite"),
    );
    expect(
      await readSqliteUserVersion(
        join(developmentProduct.root, ".bearing/cache/development/project-read-model.sqlite"),
      ),
    ).toBeGreaterThan(0);
    const diagnostics = await developmentProduct.run([
      "inspect",
      "diagnostics",
      "--repo",
      developmentProduct.root,
    ]);
    expect(diagnostics.exitCode, diagnostics.stderr).toBe(0);
    expect(JSON.parse(diagnostics.stdout)).toMatchObject({ outcome: "complete", diagnostics: [] });
    const activeDevelopment = await developmentProduct.run([
      "configure",
      "inspect",
      "--repo",
      developmentProduct.root,
    ]);
    expect(activeDevelopment.exitCode, activeDevelopment.stderr).toBe(0);
    expect(JSON.parse(activeDevelopment.stdout)).toMatchObject({
      lifecycle: { state: "active", removalRequired: false },
      currentSelections: { runtime: "development", surfaces: ["agent-skills"] },
      runtime: { channel: "development" },
    });
    expect(await snapshotOwnerBytes(developmentProduct.root)).toEqual(preservedBefore);
    const resumedPlan = await developmentProduct.run([
      "configure",
      "plan",
      ...developmentArguments,
      "--retain-executor",
      profileKey,
    ]);
    expect(resumedPlan.exitCode, `${resumedPlan.stderr}\n${resumedPlan.stdout}`).toBe(0);
    expect(JSON.parse(resumedPlan.stdout)).toMatchObject({
      canApply: true,
      acceptedDesiredConfiguration: { runtime: "development" },
    });

    await writeFile(
      join(root, ".bearing/manifest.json"),
      `${JSON.stringify({
        schemaVersion: 1,
        packageVersion: "0.1.1",
        status: "active",
        surfaces: ["agent-skills"],
        executorProfiles: [],
      })}\n`,
    );
    const stableOldConfiguration = await product.run(["configure", "inspect", "--repo", root]);
    expect(stableOldConfiguration.exitClass).toBe("success");
    expect(JSON.parse(stableOldConfiguration.stdout)).toMatchObject({
      lifecycle: {
        state: "repository-update-required",
        removalRequired: false,
        update: {
          source: { packageVersion: "0.1.1" },
          target: { manifest: { packageVersion: "0.1.2-dev", runtime: "stable" } },
        },
      },
    });

    await writeFile(
      join(root, ".bearing/manifest.json"),
      `${JSON.stringify({
        schemaVersion: 1,
        packageVersion: "0.1.0",
        surfaces: ["agent-skills"],
        executorProfiles: [],
      })}\n`,
    );
    const oldPreview = await product.run(["configure", "inspect", "--repo", root]);
    expect(oldPreview.exitClass).toBe("success");
    expect(JSON.parse(oldPreview.stdout)).toMatchObject({
      lifecycle: { state: "unsupported", removalRequired: false },
    });

    await writeFile(
      join(root, ".bearing/manifest.json"),
      `${JSON.stringify({
        schemaVersion: 1,
        packageVersion: "0.1.0",
        status: "active",
        surfaces: ["agent-skills"],
        executorProfiles: [],
      })}\n`,
    );
    const mixedPreview = await product.run(["configure", "inspect", "--repo", root]);
    expect(mixedPreview.exitClass).toBe("success");
    expect(JSON.parse(mixedPreview.stdout)).toMatchObject({
      lifecycle: {
        state: "repository-update-required",
        removalRequired: false,
        update: {
          source: { packageVersion: "0.1.0" },
          target: { manifest: { packageVersion: "0.1.2-dev", runtime: "stable" } },
        },
      },
    });

    for (const duplicateManifest of [
      {
        schemaVersion: 1,
        packageVersion: "0.1.0",
        surfaces: ["agent-skills", "agent-skills"],
        executorProfiles: [],
      },
      {
        schemaVersion: 1,
        packageVersion: "0.1.0",
        surfaces: ["agent-skills"],
        executorProfiles: ["default", "default"],
      },
    ]) {
      await writeFile(
        join(root, ".bearing/manifest.json"),
        `${JSON.stringify(duplicateManifest)}\n`,
      );
      const duplicate = await product.run(["configure", "inspect", "--repo", root]);
      expect(duplicate.exitClass).toBe("success");
      expect(JSON.parse(duplicate.stdout)).toMatchObject({
        lifecycle: { state: "unsupported", removalRequired: false },
      });
    }

    await writeFile(
      join(root, ".bearing/manifest.json"),
      `${JSON.stringify({ schemaVersion: 1, packageVersion: "0.1.0", surfaces: [] })}\n`,
    );
    const unsupported = await product.run(["configure", "inspect", "--repo", root]);
    expect(unsupported.exitClass).toBe("success");
    expect(JSON.parse(unsupported.stdout)).toMatchObject({
      lifecycle: { state: "unsupported", removalRequired: false },
    });

    for (const command of ["setup", "activation", "deactivate", "purge"]) {
      const result = await product.run([command, "--repo", root]);
      expect(result.exitClass).toBe("product-outcome");
      expect(result.stderr).toContain("Unknown command");
    }
    const help = await product.run(["--help"]);
    expect(help.stdout).toContain("bearing configure inspect");
    expect(help.stdout).not.toMatch(/bearing (?:setup|activation|deactivate|purge)\b/u);
  } finally {
    await product.dispose();
  }
}, 60_000);

test("active Repository Update follows the installed target contract and retries the original operation", async () => {
  const product = await installPackedProduct();
  const root = join(product.root, "active-repository-update");
  const nativeReference = ".scratch/work/issues/01-finish.md";
  await writeStandardMattLocalRepository(root);
  const args = activateArguments(root);
  try {
    const reviewed = await plan(product, args);
    const token = reviewed["sealedPlanToken"];
    if (typeof token !== "string") throw new Error("Configure plan returned no seal.");
    const applied = await apply(product, args, token);
    expect(applied.exitClass, applied.stderr).toBe("success");

    await writeValidBearingState(root);
    const profileKey = "agent-skills-fixture";
    await mkdir(join(root, ".bearing/executor-profiles"), { recursive: true });
    await writeFile(
      join(root, `.bearing/executor-profiles/${profileKey}.md`),
      renderExecutionProfile({
        profileKey,
        displayName: "/fixture",
        surface: "agent-skills",
        capabilityLocator: "agent-skills:fixture",
        nativeArtifacts: ["Verified implementation output."],
        writebackBehavior: "Record the verified execution outcome.",
      }),
    );
    await writeFile(
      join(root, ".bearing/manifest.json"),
      `${JSON.stringify({
        schemaVersion: 2,
        packageVersion: "0.1.2-dev",
        status: "active",
        runtime: "stable",
        surfaces: ["agent-skills"],
        executorProfiles: [profileKey],
      })}\n`,
    );
    const prepared = await product.run(["cache", "rebuild", "--repo", root]);
    expect(prepared.exitClass, prepared.stderr).toBe("success");
    const captured = await product.run([
      "provider",
      "capture",
      "--scope",
      ".scratch/work",
      "--repo",
      root,
    ]);
    expect(captured.exitClass, captured.stderr).toBe("success");
    const baseline = await product.run(["inspect", "--native", nativeReference, "--repo", root]);
    expect(baseline.exitClass, baseline.stderr).toBe("success");
    const baselineBinding = JSON.parse(baseline.stdout).result.binding;
    expect(baselineBinding).toMatchObject({ effectiveFreshness: "current" });

    const preservedBefore = await snapshotOwnerBytes(root);
    await writeFile(
      join(root, ".bearing/manifest.json"),
      `${JSON.stringify({
        schemaVersion: 1,
        packageVersion: "0.1.1",
        status: "active",
        surfaces: ["agent-skills"],
        executorProfiles: [profileKey],
      })}\n`,
    );

    const originalAttempt = await product.run(
      ["inspect", "--native", nativeReference, "--repo", root],
      { observeRoots: [root] },
    );
    expect(originalAttempt.exitClass).toBe("product-outcome");
    expect(originalAttempt.stderr).toMatch(/repository-update-required/iu);
    expect(originalAttempt.effects).toEqual({ created: [], changed: [], removed: [] });

    const inspected = await product.run(["configure", "inspect", "--repo", root], {
      observeRoots: [root],
    });
    expect(inspected.exitClass, inspected.stderr).toBe("success");
    expect(inspected.effects).toEqual({ created: [], changed: [], removed: [] });
    const inspection = JSON.parse(inspected.stdout);
    expect(inspection).toMatchObject({
      lifecycle: {
        state: "repository-update-required",
        update: {
          source: { schemaVersion: 1, packageVersion: "0.1.1" },
          target: {
            requiredManifestFields: [
              "schemaVersion",
              "packageVersion",
              "status",
              "runtime",
              "surfaces",
              "executorProfiles",
            ],
            manifest: {
              schemaVersion: 2,
              packageVersion: "0.1.2-dev",
              status: "active",
              runtime: "stable",
              surfaces: ["agent-skills"],
              executorProfiles: [profileKey],
            },
            semanticInvariants: expect.arrayContaining([
              "preserve-bearing-state-bytes",
              "preserve-provider-configuration-bytes",
              "preserve-execution-profile-bytes",
              "preserve-managed-instruction-bytes",
              "zero-native-work-writes",
              "preserve-provider-evidence-freshness-and-failure",
              "zero-provider-acquisition",
            ]),
            writeDomains: {
              canonical: [".bearing/manifest.json"],
              disposable: [".bearing/cache/project-read-model.sqlite"],
            },
            validation: expect.arrayContaining([
              "target-manifest",
              "project-read-model-rebuild",
              "repository-lifecycle",
              "repository-diagnostics",
              "original-operation-retry",
            ]),
          },
          guide: "references/journeys/update.md",
        },
      },
    });

    await writeFile(
      join(root, ".bearing/manifest.json"),
      `${JSON.stringify(inspection.lifecycle.update.target.manifest)}\n`,
    );
    const rebuilt = await product.run(["cache", "rebuild", "--repo", root]);
    expect(rebuilt.exitClass, rebuilt.stderr).toBe("success");
    expect(JSON.parse(rebuilt.stdout)).toMatchObject({
      outcome: "complete",
      result: { acquisitionCount: 0, missingEvidenceScopes: [] },
      diagnostics: [],
    });
    expect(await snapshotOwnerBytes(root)).toEqual(preservedBefore);

    const diagnostics = await product.run(["inspect", "diagnostics", "--repo", root]);
    expect(diagnostics.exitClass, diagnostics.stderr).toBe("success");
    expect(JSON.parse(diagnostics.stdout)).toMatchObject({ outcome: "complete", diagnostics: [] });
    const lifecycle = await product.run(["configure", "inspect", "--repo", root]);
    expect(lifecycle.exitClass, lifecycle.stderr).toBe("success");
    expect(JSON.parse(lifecycle.stdout)).toMatchObject({
      lifecycle: { state: "active", removalRequired: false },
      currentSelections: {
        runtime: "stable",
        surfaces: ["agent-skills"],
        executorProfiles: [profileKey],
      },
    });

    const retried = await product.run(["inspect", "--native", nativeReference, "--repo", root]);
    expect(retried.exitClass, retried.stderr).toBe("success");
    expect(JSON.parse(retried.stdout)).toMatchObject({
      outcome: "complete",
      result: {
        binding: {
          observationId: baselineBinding.observationId,
          effectiveFreshness: "current",
        },
      },
    });
  } finally {
    await product.dispose();
  }
}, 60_000);

test("deactivated Repository Update preserves lifecycle and leaves the active read model absent", async () => {
  const product = await installPackedProduct();
  const root = join(product.root, "deactivated-repository-update");
  await makeFreshRepository(root);
  await mkdir(join(root, ".bearing/state"), { recursive: true });
  await writeFile(join(root, ".bearing/state/preserved.md"), "preserved\n");
  await writeFile(
    join(root, ".bearing/manifest.json"),
    `${JSON.stringify({
      schemaVersion: 1,
      packageVersion: "0.1.1",
      status: "deactivated",
      surfaces: ["agent-skills"],
      executorProfiles: [],
    })}\n`,
  );
  try {
    const inspected = await product.run(["configure", "inspect", "--repo", root], {
      observeRoots: [root],
    });
    expect(inspected.exitClass, inspected.stderr).toBe("success");
    expect(inspected.effects).toEqual({ created: [], changed: [], removed: [] });
    const inspection = JSON.parse(inspected.stdout);
    expect(inspection).toMatchObject({
      lifecycle: {
        state: "repository-update-required",
        update: {
          source: { packageVersion: "0.1.1", status: "deactivated" },
          target: {
            manifest: {
              schemaVersion: 2,
              packageVersion: "0.1.2-dev",
              status: "deactivated",
              runtime: "stable",
              surfaces: ["agent-skills"],
              executorProfiles: [],
            },
            semanticInvariants: expect.arrayContaining([
              "preserve-status",
              "no-active-project-read-model-creation",
              "reactivation-requires-separate-repository-configuration",
            ]),
            writeDomains: { canonical: [".bearing/manifest.json"], disposable: [] },
            validation: expect.not.arrayContaining([
              "project-read-model-rebuild",
              "repository-diagnostics",
              "original-operation-retry",
            ]),
          },
        },
      },
    });

    await writeFile(
      join(root, ".bearing/manifest.json"),
      `${JSON.stringify(inspection.lifecycle.update.target.manifest)}\n`,
    );
    const target = await product.run(["configure", "inspect", "--repo", root]);
    expect(target.exitClass, target.stderr).toBe("success");
    expect(JSON.parse(target.stdout)).toMatchObject({
      lifecycle: { state: "deactivated", removalRequired: false },
    });
    await expect(access(join(root, ".bearing/cache/project-read-model.sqlite"))).rejects.toThrow();
    expect(await readFile(join(root, ".bearing/state/preserved.md"), "utf8")).toBe("preserved\n");

    const rebuild = await product.run(["cache", "rebuild", "--repo", root], {
      observeRoots: [root],
    });
    expect(rebuild.exitClass).toBe("product-outcome");
    expect(rebuild.stderr).toMatch(/requires an Active Repository Configuration/iu);
    expect(rebuild.effects).toEqual({ created: [], changed: [], removed: [] });

    const reactivation = await product.run(["configure", "plan", ...activateArguments(root)]);
    expect(reactivation.exitClass, reactivation.stderr).toBe("success");
    expect(JSON.parse(reactivation.stdout)).toMatchObject({
      lifecycle: { state: "deactivated" },
      canApply: true,
    });
    const stillDeactivated = await product.run(["configure", "inspect", "--repo", root]);
    expect(JSON.parse(stillDeactivated.stdout)).toMatchObject({
      lifecycle: { state: "deactivated" },
    });
  } finally {
    await product.dispose();
  }
}, 60_000);

test("unsafe Repository Update sources return actionable no-write outcomes", async () => {
  const product = await installPackedProduct();
  const scenarios = [
    {
      name: "corrupt",
      source: "{not-json\n",
      expectedState: "unsupported",
      reason: /not valid JSON/iu,
      nextAction: /verified backup|repository recovery/iu,
    },
    {
      name: "unreadable",
      source: `${JSON.stringify({
        schemaVersion: 1,
        packageVersion: "0.1.1",
        status: "active",
        surfaces: ["agent-skills"],
        executorProfiles: [],
      })}\n`,
      unreadable: true,
      expectedState: "unsupported",
      reason: /access is unavailable/iu,
      nextAction: /filesystem owner|readable access/iu,
    },
    {
      name: "ambiguous",
      source: `${JSON.stringify({
        schemaVersion: 1,
        packageVersion: "0.1.1",
        status: "active",
        surfaces: ["agent-skills", "agent-skills"],
        executorProfiles: [],
      })}\n`,
      expectedState: "unsupported",
      reason: /surface selections are invalid or ambiguous/iu,
      nextAction: /semantic owner/iu,
    },
    {
      name: "invalid-development",
      source: `${JSON.stringify({
        schemaVersion: 1,
        packageVersion: "0.1.1",
        status: "ambiguous",
        runtime: "development",
        surfaces: ["agent-skills"],
        executorProfiles: [],
      })}\n`,
      expectedState: "unsupported",
      reason: /lifecycle status is missing or ambiguous/iu,
      nextAction: /semantic owner/iu,
      plan: true,
    },
    {
      name: "expanded-authority",
      source: `${JSON.stringify({
        schemaVersion: 1,
        packageVersion: "0.1.1",
        status: "active",
        surfaces: ["agent-skills"],
        executorProfiles: [],
        inheritedAuthority: "write-native-work",
      })}\n`,
      expectedState: "unsupported",
      reason: /outside the target contract[\s\S]*inheritedAuthority/iu,
      nextAction: /separate authority|semantic owner/iu,
    },
    {
      name: "newer",
      source: `${JSON.stringify({ schemaVersion: 99, status: "active" })}\n`,
      expectedState: "kit-update-required",
      reason: /newer Bearing schema 99/iu,
      nextAction: /separately authorized Global Kit Update/iu,
    },
    {
      name: "newer-schema-one",
      source: `${JSON.stringify({
        schemaVersion: 1,
        packageVersion: "0.1.3",
        status: "active",
        surfaces: ["agent-skills"],
        executorProfiles: [],
      })}\n`,
      expectedState: "kit-update-required",
      reason: /newer Bearing package 0\.1\.3/iu,
      nextAction: /separately authorized Global Kit Update/iu,
    },
  ] as const;
  try {
    for (const scenario of scenarios) {
      const root = join(product.root, `unsafe-${scenario.name}`);
      await makeFreshRepository(root);
      await mkdir(join(root, ".bearing"));
      const manifestPath = join(root, ".bearing/manifest.json");
      await writeFile(manifestPath, scenario.source);
      if ("unreadable" in scenario && scenario.unreadable) await chmod(manifestPath, 0o000);
      const inspected = await product.run(["configure", "inspect", "--repo", root], {
        ...("unreadable" in scenario && scenario.unreadable ? {} : { observeRoots: [root] }),
      });
      expect(inspected.exitClass, `${scenario.name}: ${inspected.stderr}`).toBe("success");
      if (!("unreadable" in scenario && scenario.unreadable)) {
        expect(inspected.effects).toEqual({ created: [], changed: [], removed: [] });
      }
      const lifecycle = JSON.parse(inspected.stdout).lifecycle;
      expect(lifecycle).toMatchObject({ state: scenario.expectedState, noWrite: true });
      expect(lifecycle.reason).toMatch(scenario.reason);
      expect(lifecycle.nextAction).toMatch(scenario.nextAction);
      if ("plan" in scenario && scenario.plan) {
        const planned = await product.run(["configure", "plan", ...activateArguments(root)], {
          observeRoots: [root],
        });
        expect(planned.exitClass, planned.stderr).toBe("product-outcome");
        expect(planned.effects).toEqual({ created: [], changed: [], removed: [] });
        expect(JSON.parse(planned.stdout)).toMatchObject({
          canApply: false,
          blockers: [
            {
              code: "unsafe-repository-target",
              message: expect.stringMatching(/no-write result[\s\S]*separate Human authority/iu),
            },
          ],
        });
      }
      if ("unreadable" in scenario && scenario.unreadable) {
        await chmod(manifestPath, 0o600);
        expect(await readFile(manifestPath, "utf8")).toBe(scenario.source);
      }
    }

    const root = join(product.root, "unsafe-symbolic-link");
    await makeFreshRepository(root);
    await mkdir(join(root, ".bearing"));
    const outside = join(product.root, "outside-manifest.json");
    await writeFile(outside, "{}\n");
    await symlink(outside, join(root, ".bearing/manifest.json"));
    const unsafe = await product.run(["configure", "inspect", "--repo", root], {
      observeRoots: [root],
    });
    expect(unsafe.exitClass, unsafe.stderr).toBe("success");
    expect(unsafe.effects).toEqual({ created: [], changed: [], removed: [] });
    const unsafeLifecycle = JSON.parse(unsafe.stdout).lifecycle;
    expect(unsafeLifecycle).toMatchObject({ state: "unsupported", noWrite: true });
    expect(unsafeLifecycle.reason).toMatch(/safe single-link regular file/iu);
    expect(unsafeLifecycle.nextAction).toMatch(/filesystem owner|safe repository manifest/iu);
  } finally {
    await product.dispose();
  }
}, 60_000);

test("declined and stale accepted Repository Update candidates preserve current repository bytes", async () => {
  const product = await installPackedProduct();
  const root = join(product.root, "declined-and-changed-repository-update");
  await makeFreshRepository(root);
  await mkdir(join(root, ".bearing/state"), { recursive: true });
  await mkdir(join(root, ".bearing/executor-profiles"), { recursive: true });
  await writeFile(join(root, ".bearing/state/preserved.md"), "state\n");
  await writeFile(join(root, ".bearing/provider.json"), "provider\n");
  await writeFile(join(root, ".bearing/executor-profiles/preserved.md"), "profile\n");
  const manifestPath = join(root, ".bearing/manifest.json");
  const firstSource = {
    schemaVersion: 1,
    packageVersion: "0.1.1",
    status: "active",
    surfaces: ["agent-skills"],
    executorProfiles: [],
  } as const;
  await writeFile(manifestPath, `${JSON.stringify(firstSource)}\n`);
  try {
    const inspected = await product.run(["configure", "inspect", "--repo", root], {
      observeRoots: [root],
    });
    expect(inspected.exitClass, inspected.stderr).toBe("success");
    expect(inspected.effects).toEqual({ created: [], changed: [], removed: [] });
    const firstCandidate = JSON.parse(inspected.stdout).lifecycle.update.target.manifest;
    expect(JSON.parse(await readFile(manifestPath, "utf8"))).toEqual(firstSource);
    const acceptedPreconditions = await captureRepositoryTargetPreconditions(await realpath(root), [
      ".bearing/manifest.json",
    ]);

    const changedSource = { ...firstSource, status: "deactivated" as const };
    await writeFile(manifestPath, `${JSON.stringify(changedSource)}\n`);
    await expect(
      assertRepositoryTargetPreconditionsCurrent(await realpath(root), acceptedPreconditions),
    ).rejects.toThrow(/Repository target changed after repository integration planning/iu);
    expect(JSON.parse(await readFile(manifestPath, "utf8"))).toEqual(changedSource);

    const reevaluated = await product.run(["configure", "inspect", "--repo", root], {
      observeRoots: [root],
    });
    expect(reevaluated.exitClass, reevaluated.stderr).toBe("success");
    expect(reevaluated.effects).toEqual({ created: [], changed: [], removed: [] });
    const secondCandidate = JSON.parse(reevaluated.stdout).lifecycle.update.target.manifest;
    expect(secondCandidate).not.toEqual(firstCandidate);
    expect(secondCandidate).toMatchObject({ status: "deactivated" });
    expect(JSON.parse(await readFile(manifestPath, "utf8"))).toEqual(changedSource);
    expect(await readFile(join(root, ".bearing/state/preserved.md"), "utf8")).toBe("state\n");
    expect(await readFile(join(root, ".bearing/provider.json"), "utf8")).toBe("provider\n");
    expect(await readFile(join(root, ".bearing/executor-profiles/preserved.md"), "utf8")).toBe(
      "profile\n",
    );
  } finally {
    await product.dispose();
  }
}, 60_000);

test("a blocked post-target rebuild preserves the target and reports one resumption point", async () => {
  const product = await installPackedProduct();
  const root = join(product.root, "post-target-rebuild-blocker");
  await makeFreshRepository(root);
  const targetManifest = {
    schemaVersion: 2,
    packageVersion: "0.1.2-dev",
    status: "active",
    runtime: "stable",
    surfaces: ["agent-skills"],
    executorProfiles: [],
  } as const;
  await mkdir(join(root, ".bearing/cache/project-read-model.sqlite"), { recursive: true });
  await writeFile(join(root, ".bearing/manifest.json"), `${JSON.stringify(targetManifest)}\n`);
  try {
    const rebuilt = await product.run(["cache", "rebuild", "--repo", root], {
      observeRoots: [root],
    });
    expect(rebuilt.exitClass).toBe("product-outcome");
    expect(rebuilt.effects).toEqual({ created: [], changed: [], removed: [] });
    const rebuildReceipt = JSON.parse(rebuilt.stdout);
    expect(rebuildReceipt).toMatchObject({
      outcome: "recovery-required",
      result: {
        acquisitionCount: 0,
        resumptionPoint: "project-read-model-rebuild",
      },
    });
    expect(rebuildReceipt.result.reason).toMatch(/unsafe/iu);
    expect(JSON.parse(await readFile(join(root, ".bearing/manifest.json"), "utf8"))).toEqual(
      targetManifest,
    );
    const lifecycle = await product.run(["configure", "inspect", "--repo", root]);
    expect(JSON.parse(lifecycle.stdout)).toMatchObject({ lifecycle: { state: "active" } });
  } finally {
    await product.dispose();
  }
}, 60_000);
