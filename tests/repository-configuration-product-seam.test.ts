import { expect, test } from "bun:test";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { BEARING_POINTER } from "../src/agent-surface-entry";
import { type InstalledProduct, installPackedProduct } from "./product-seams/installed-product";

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
    expect(manifest).toMatchObject({ status: "active", executorProfiles: [] });
    expect(await readFile(join(root, "AGENTS.md"), "utf8")).toContain(BEARING_POINTER);
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

test("unsupported Preview state is removal-required and legacy lifecycle commands are absent", async () => {
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
      lifecycle: { state: "unsupported", removalRequired: true },
    });
    const planned = await product.run(["configure", "plan", ...activateArguments(root)]);
    expect(planned.exitClass).toBe("product-outcome");
    const body = JSON.parse(planned.stdout);
    expect(body.canApply).toBe(false);
    expect(body.blockers[0].message).toMatch(/removal-required.*Agent-reviewed platform removal/iu);
    expect(body).not.toHaveProperty("sealedPlanToken");

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
