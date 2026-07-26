import { beforeAll, describe, expect, test } from "bun:test";
import { access, mkdir, readFile, symlink, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { writeInstallTarget } from "../src/installer";
import { setupRepository } from "../src/repo-setup";
import { planRepositoryIntegration } from "../src/repository-integration-plan";
import { makeTemporaryDirectory } from "./helpers";

const runSetupCli = async (
  repoRoot: string,
  homeDir: string,
  extraArgs: readonly string[],
): Promise<Readonly<{ stdout: string; stderr: string; exitCode: number }>> => {
  const child = Bun.spawn(
    [
      "node",
      join(process.cwd(), "dist/cli.js"),
      "setup",
      "--repo",
      repoRoot,
      "--surface",
      "agent-skills",
      ...extraArgs,
    ],
    {
      env: { ...process.env, HOME: homeDir },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { stdout, stderr, exitCode };
};

const writeMattProviderFixture = async (
  repoRoot: string,
  options: Readonly<{
    contract?: string;
    surfaces?: readonly ("agent-skills" | "claude")[];
  }> = {},
): Promise<string> => {
  const contractLocator = "docs/agents/issue-tracker.md";
  await mkdir(join(repoRoot, "docs/agents"), { recursive: true });
  await writeFile(
    join(repoRoot, contractLocator),
    options.contract ?? "# Issue tracker: Local Markdown\n\nProvider contract: `matt-skills/v1`\n",
  );
  for (const surface of options.surfaces ?? ["agent-skills"]) {
    await writeFile(
      join(repoRoot, surface === "agent-skills" ? "AGENTS.md" : "CLAUDE.md"),
      `Work-management contract: \`${contractLocator}\`\n`,
    );
  }
  return contractLocator;
};

describe("repository integration planning CLI", () => {
  beforeAll(async () => {
    const result = await Bun.build({
      entrypoints: [join(process.cwd(), "src/cli.ts")],
      outdir: join(process.cwd(), "dist"),
      target: "node",
    });
    if (!result.success) throw new Error("Repository integration tests could not build the CLI.");
  });

  test("plans a Fresh repository without mutating it", async () => {
    const repoRoot = await makeTemporaryDirectory("bearing-plan-fresh-");
    const homeDir = await makeTemporaryDirectory("bearing-plan-home-");
    const agentsPath = join(repoRoot, "AGENTS.md");
    const originalAgents = "# User-owned instructions\n";
    await writeFile(agentsPath, originalAgents);

    const result = await runSetupCli(repoRoot, homeDir, ["--plan"]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    const plan = JSON.parse(result.stdout);
    expect(plan).toMatchObject({
      planVersion: 1,
      lifecycle: { kind: "fresh" },
      canApply: false,
      stages: {
        externalPrerequisites: {
          owner: "external-capabilities",
          mutation: "outside-repository-apply-unit",
          items: [
            {
              capability: "bearing-package",
              owner: "package-manager",
              state: "satisfied",
            },
            {
              capability: "matt-work-model-provider",
              owner: "matt-skills",
              state: "not-evaluated",
            },
          ],
        },
        repositoryApplyUnit: {
          owner: "bearing-setup",
          atomic: true,
          rollback: "restore-previous-repository-bytes",
        },
        projectCatalog: {
          owner: "bearing-project-catalog",
          order: "after-repository-validation",
          rollback: "independent",
        },
      },
    });
    expect(plan.stages.repositoryApplyUnit.targets).toEqual([
      ".bearing/executor-profiles/generic-agent.md",
      ".bearing/manifest.json",
      ".bearing/provider.json",
      "AGENTS.md",
    ]);
    expect(await readFile(agentsPath, "utf8")).toBe(originalAgents);
    await expect(access(join(repoRoot, ".bearing"))).rejects.toThrow();
    await expect(access(join(homeDir, ".bearing"))).rejects.toThrow();
  });

  test("plans an accepted Fresh Matt provider without a Generic repository profile", async () => {
    const repoRoot = await makeTemporaryDirectory("bearing-plan-fresh-provider-");
    const contractLocator = await writeMattProviderFixture(repoRoot);

    const plan = await planRepositoryIntegration({
      repoRoot,
      packageRoot: process.cwd(),
      surfaces: ["agent-skills"],
      profiles: [],
      provider: {
        key: "matt-skills/v1",
        contractLocator,
      },
    });

    expect(plan).toMatchObject({
      lifecycle: { kind: "fresh" },
      canApply: true,
      stages: {
        externalPrerequisites: {
          items: [
            { capability: "bearing-package", state: "satisfied" },
            { capability: "matt-work-model-provider", state: "satisfied" },
          ],
        },
      },
    });
    expect(plan.stages.repositoryApplyUnit.targets).toEqual([
      ".bearing/manifest.json",
      ".bearing/provider.json",
      "AGENTS.md",
    ]);
  });

  test("applies one Fresh provider-aware repository unit before Catalog registration", async () => {
    const repoRoot = await makeTemporaryDirectory("bearing-setup-fresh-provider-");
    const homeDir = await makeTemporaryDirectory("bearing-setup-fresh-home-");
    const contractLocator = await writeMattProviderFixture(repoRoot);
    const unselectedBytes = "# Claude-owned instructions\n";
    await writeFile(join(repoRoot, "CLAUDE.md"), unselectedBytes);

    const result = await runSetupCli(repoRoot, homeDir, ["--provider-contract", contractLocator]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("Outcome: applied");
    expect(result.stdout).toContain("Repository: applied");
    expect(result.stdout).toContain("Catalog: applied");
    expect(JSON.parse(await readFile(join(repoRoot, ".bearing/manifest.json"), "utf8"))).toEqual({
      schemaVersion: 1,
      packageVersion: "0.1.0",
      status: "active",
      surfaces: ["agent-skills"],
      executorProfiles: [],
    });
    expect(JSON.parse(await readFile(join(repoRoot, ".bearing/provider.json"), "utf8"))).toEqual({
      schemaVersion: 1,
      provider: "matt-skills/v1",
      contractLocator,
    });
    await expect(
      access(join(repoRoot, ".bearing/executor-profiles/generic-agent.md")),
    ).rejects.toThrow();
    expect(await readFile(join(repoRoot, "AGENTS.md"), "utf8")).toContain("bearing:managed-start");
    expect(await readFile(join(repoRoot, "CLAUDE.md"), "utf8")).toBe(unselectedBytes);
    expect(await readFile(join(repoRoot, ".bearing/cache/sync-report.md"), "utf8")).toContain(
      "No structural diagnostics.",
    );
  });

  test("fails closed before repository writes for an unsupported provider contract", async () => {
    const repoRoot = await makeTemporaryDirectory("bearing-setup-unsupported-provider-");
    const homeDir = await makeTemporaryDirectory("bearing-setup-unsupported-home-");
    const contractLocator = await writeMattProviderFixture(repoRoot, {
      contract: "# Unsupported tracker contract\n",
    });

    const result = await runSetupCli(repoRoot, homeDir, ["--provider-contract", contractLocator]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Matt provider contract is unsupported");
    await expect(access(join(repoRoot, ".bearing"))).rejects.toThrow();
    expect(await readFile(join(repoRoot, "AGENTS.md"), "utf8")).toBe(
      `Work-management contract: \`${contractLocator}\`\n`,
    );
    await expect(access(join(homeDir, ".bearing"))).rejects.toThrow();
  });

  test("requires the selected Agent Surface to point to the exact supported contract", async () => {
    const missingPointerRoot = await makeTemporaryDirectory("bearing-setup-missing-pointer-");
    const contractLocator = "docs/agents/issue-tracker.md";
    await mkdir(join(missingPointerRoot, "docs/agents"), { recursive: true });
    await writeFile(
      join(missingPointerRoot, contractLocator),
      "# Issue tracker: Local Markdown\n\nProvider contract: `matt-skills/v1`\n",
    );
    await writeFile(
      join(missingPointerRoot, "AGENTS.md"),
      `Example only; do not configure \`${contractLocator}\` here.\n`,
    );
    const missingPointerPlan = await planRepositoryIntegration({
      repoRoot: missingPointerRoot,
      packageRoot: process.cwd(),
      surfaces: ["agent-skills"],
      profiles: [],
      provider: { key: "matt-skills/v1", contractLocator },
    });
    expect(missingPointerPlan.canApply).toBe(false);
    expect(missingPointerPlan.stages.externalPrerequisites.items[1]?.state).toBe("not-evaluated");

    const divergentRoot = await makeTemporaryDirectory("bearing-setup-divergent-pointer-");
    const firstLocator = await writeMattProviderFixture(divergentRoot);
    const secondLocator = "docs/agents/other-tracker.md";
    await writeFile(
      join(divergentRoot, secondLocator),
      "# Issue tracker: GitHub Issues\n\nProvider contract: `matt-skills/v1`\n",
    );
    await writeFile(
      join(divergentRoot, "CLAUDE.md"),
      `Work-management contract: \`${secondLocator}\`\n`,
    );
    const divergentPlan = await planRepositoryIntegration({
      repoRoot: divergentRoot,
      packageRoot: process.cwd(),
      surfaces: ["agent-skills", "claude"],
      profiles: [],
      provider: { key: "matt-skills/v1", contractLocator: firstLocator },
    });
    expect(divergentPlan.canApply).toBe(false);
    expect(divergentPlan.stages.externalPrerequisites.items[1]?.state).toBe("not-evaluated");
  });

  test("rejects a decoy provider marker and an unavailable registration plan", async () => {
    const decoyRoot = await makeTemporaryDirectory("bearing-setup-decoy-provider-");
    const contractLocator = await writeMattProviderFixture(decoyRoot, {
      contract:
        "# Example documentation\n\nProvider contract: `matt-skills/v1`\n\nThis is not a tracker contract.\n",
    });
    const decoyPlan = await planRepositoryIntegration({
      repoRoot: decoyRoot,
      packageRoot: process.cwd(),
      surfaces: ["agent-skills"],
      profiles: [],
      provider: { key: "matt-skills/v1", contractLocator },
    });
    expect(decoyPlan.canApply).toBe(false);

    const profileRoot = await makeTemporaryDirectory("bearing-setup-profile-before-ticket14-");
    const profileContract = await writeMattProviderFixture(profileRoot);
    const profilePlan = await planRepositoryIntegration({
      repoRoot: profileRoot,
      packageRoot: process.cwd(),
      surfaces: ["agent-skills"],
      profiles: ["matt-implement"],
      provider: { key: "matt-skills/v1", contractLocator: profileContract },
    });
    expect(profilePlan.canApply).toBe(false);
    expect(profilePlan.blockers).toContainEqual(
      expect.objectContaining({ code: "unsupported-executor-registration" }),
    );
  });

  test("requires a provider contract for public Apply and never reactivates implicitly", async () => {
    const homeDir = await makeTemporaryDirectory("bearing-setup-provider-required-home-");
    const freshRoot = await makeTemporaryDirectory("bearing-setup-provider-required-fresh-");
    const freshResult = await runSetupCli(freshRoot, homeDir, []);
    expect(freshResult.exitCode).toBe(1);
    expect(freshResult.stderr).toContain("requires a selected-surface Matt provider contract");
    await expect(access(join(freshRoot, ".bearing"))).rejects.toThrow();

    const deactivatedRoot = await makeTemporaryDirectory(
      "bearing-setup-provider-required-deactivated-",
    );
    const manifest = `${JSON.stringify({
      schemaVersion: 1,
      packageVersion: "0.1.0",
      status: "deactivated",
      surfaces: ["agent-skills"],
      executorProfiles: [],
    })}\n`;
    await mkdir(join(deactivatedRoot, ".bearing"), { recursive: true });
    await writeFile(join(deactivatedRoot, ".bearing/manifest.json"), manifest);
    const deactivatedResult = await runSetupCli(deactivatedRoot, homeDir, []);
    expect(deactivatedResult.exitCode).toBe(1);
    expect(await readFile(join(deactivatedRoot, ".bearing/manifest.json"), "utf8")).toBe(manifest);
  });

  test("revalidates the provider contract immediately before the repository Apply Unit", async () => {
    const repoRoot = await makeTemporaryDirectory("bearing-setup-provider-race-");
    const contractLocator = await writeMattProviderFixture(repoRoot);
    const contractPath = join(repoRoot, contractLocator);

    await expect(
      setupRepository(
        {
          repoRoot,
          packageRoot: process.cwd(),
          surfaces: ["agent-skills"],
          profiles: [],
          provider: { key: "matt-skills/v1", contractLocator },
        },
        {
          afterPlan: async () => {
            await writeFile(contractPath, "# Contract changed after review\n");
          },
        },
      ),
    ).rejects.toThrow("provider contract changed");

    await expect(access(join(repoRoot, ".bearing"))).rejects.toThrow();
    expect(await readFile(join(repoRoot, "AGENTS.md"), "utf8")).toBe(
      `Work-management contract: \`${contractLocator}\`\n`,
    );
  });

  test("reports Catalog failure separately after preserving a valid Fresh repository Apply", async () => {
    const repoRoot = await makeTemporaryDirectory("bearing-setup-catalog-partial-");
    const homeDir = await makeTemporaryDirectory("bearing-setup-catalog-partial-home-");
    const contractLocator = await writeMattProviderFixture(repoRoot);
    await mkdir(join(homeDir, ".bearing"), { recursive: true });
    await writeFile(join(homeDir, ".bearing/catalog.json"), "{ invalid\n");

    const result = await runSetupCli(repoRoot, homeDir, ["--provider-contract", contractLocator]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("Outcome: partial");
    expect(result.stdout).toContain("Repository: applied");
    expect(result.stdout).toContain("Catalog: failed");
    expect(result.stderr).toContain("Catalog registration failed");
    expect(
      JSON.parse(await readFile(join(repoRoot, ".bearing/manifest.json"), "utf8")),
    ).toMatchObject({ status: "active", executorProfiles: [] });
  });

  test("rolls back the Fresh Apply Unit when post-write repository validation fails", async () => {
    const repoRoot = await makeTemporaryDirectory("bearing-setup-post-write-validation-");
    const contractLocator = await writeMattProviderFixture(repoRoot);

    await expect(
      setupRepository(
        {
          repoRoot,
          packageRoot: process.cwd(),
          surfaces: ["agent-skills"],
          profiles: [],
          provider: { key: "matt-skills/v1", contractLocator },
        },
        {
          writeTarget: async (plan, ordinal) => {
            await writeInstallTarget(plan, ordinal);
            if (plan.target.endsWith(".bearing/provider.json")) {
              await writeFile(plan.target, "{ invalid post-write bytes\n");
            }
          },
        },
      ),
    ).rejects.toThrow("all written targets were restored");

    await expect(access(join(repoRoot, ".bearing"))).rejects.toThrow();
    expect(await readFile(join(repoRoot, "AGENTS.md"), "utf8")).toBe(
      `Work-management contract: \`${contractLocator}\`\n`,
    );
  });

  test("rolls back when the provider contract changes during repository writes", async () => {
    const repoRoot = await makeTemporaryDirectory("bearing-setup-provider-write-race-");
    const contractLocator = await writeMattProviderFixture(repoRoot);
    const contractPath = join(repoRoot, contractLocator);

    await expect(
      setupRepository(
        {
          repoRoot,
          packageRoot: process.cwd(),
          surfaces: ["agent-skills"],
          profiles: [],
          provider: { key: "matt-skills/v1", contractLocator },
        },
        {
          writeTarget: async (plan, ordinal) => {
            await writeInstallTarget(plan, ordinal);
            if (ordinal === 0) await writeFile(contractPath, "# Contract changed during Apply\n");
          },
        },
      ),
    ).rejects.toThrow("all written targets were restored");

    await expect(access(join(repoRoot, ".bearing"))).rejects.toThrow();
    expect(await readFile(contractPath, "utf8")).toBe("# Contract changed during Apply\n");
  });

  test("rolls back configuration and cache targets together when Sync writing fails", async () => {
    const repoRoot = await makeTemporaryDirectory("bearing-setup-sync-write-failure-");
    const contractLocator = await writeMattProviderFixture(repoRoot);

    await expect(
      setupRepository(
        {
          repoRoot,
          packageRoot: process.cwd(),
          surfaces: ["agent-skills"],
          profiles: [],
          provider: { key: "matt-skills/v1", contractLocator },
        },
        {
          writeTarget: async (plan, ordinal) => {
            if (plan.target.endsWith(".bearing/cache/sync-receipt.json")) {
              throw new Error("injected Sync target failure");
            }
            await writeInstallTarget(plan, ordinal);
          },
        },
      ),
    ).rejects.toThrow("all written targets were restored");

    await expect(access(join(repoRoot, ".bearing"))).rejects.toThrow();
    expect(await readFile(join(repoRoot, "AGENTS.md"), "utf8")).toBe(
      `Work-management contract: \`${contractLocator}\`\n`,
    );
  });

  test("safe readback rejects a post-write target replacement without following it", async () => {
    const repoRoot = await makeTemporaryDirectory("bearing-setup-readback-replacement-");
    const outsideRoot = await makeTemporaryDirectory("bearing-setup-readback-outside-");
    const externalTarget = join(outsideRoot, "external-provider.json");
    const contractLocator = await writeMattProviderFixture(repoRoot);
    await writeFile(externalTarget, "external bytes\n");

    await expect(
      setupRepository(
        {
          repoRoot,
          packageRoot: process.cwd(),
          surfaces: ["agent-skills"],
          profiles: [],
          provider: { key: "matt-skills/v1", contractLocator },
        },
        {
          writeTarget: async (plan, ordinal) => {
            await writeInstallTarget(plan, ordinal);
            if (plan.target.endsWith(".bearing/provider.json")) {
              await unlink(plan.target);
              await symlink(externalTarget, plan.target);
            }
          },
        },
      ),
    ).rejects.toThrow("all written targets were restored");

    await expect(access(join(repoRoot, ".bearing"))).rejects.toThrow();
    expect(await readFile(externalTarget, "utf8")).toBe("external bytes\n");
  });

  test("returns an immutable planning result", async () => {
    const repoRoot = await makeTemporaryDirectory("bearing-plan-frozen-");
    const plan = await planRepositoryIntegration({
      repoRoot,
      packageRoot: process.cwd(),
      surfaces: ["agent-skills"],
      profiles: ["generic-agent"],
    });

    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.lifecycle)).toBe(true);
    expect(Object.isFrozen(plan.stages)).toBe(true);
    expect(Object.isFrozen(plan.stages.repositoryApplyUnit)).toBe(true);
    expect(Object.isFrozen(plan.stages.repositoryApplyUnit.targets)).toBe(true);
    expect(Object.isFrozen(plan.stages.repositoryApplyUnit.preconditions)).toBe(true);
  });

  test("validates surfaces and profile keys before deriving repository targets", async () => {
    const repoRoot = await makeTemporaryDirectory("bearing-plan-inputs-");

    await expect(
      planRepositoryIntegration({
        repoRoot,
        packageRoot: process.cwd(),
        surfaces: [],
        profiles: ["generic-agent"],
      }),
    ).rejects.toThrow("Select at least one Agent Surface");
    await expect(
      planRepositoryIntegration({
        repoRoot,
        packageRoot: process.cwd(),
        surfaces: ["agent-skills"],
        profiles: ["../../outside"],
      }),
    ).rejects.toThrow();
  });

  test("classifies Active, Deactivated, and Invalid repositories from inspectable facts", async () => {
    const homeDir = await makeTemporaryDirectory("bearing-plan-home-");
    const activeRoot = await makeTemporaryDirectory("bearing-plan-active-");
    const deactivatedRoot = await makeTemporaryDirectory("bearing-plan-deactivated-");
    const invalidRoot = await makeTemporaryDirectory("bearing-plan-invalid-");
    const baseManifest = {
      schemaVersion: 1,
      packageVersion: "0.1.0",
      surfaces: ["agent-skills"],
      executorProfiles: ["generic-agent"],
    };

    await mkdir(join(activeRoot, ".bearing/state"), { recursive: true });
    await writeFile(
      join(activeRoot, ".bearing/manifest.json"),
      `${JSON.stringify(baseManifest)}\n`,
    );
    await mkdir(join(deactivatedRoot, ".bearing/state"), { recursive: true });
    await writeFile(
      join(deactivatedRoot, ".bearing/manifest.json"),
      `${JSON.stringify({ ...baseManifest, status: "deactivated" })}\n`,
    );
    await mkdir(join(invalidRoot, ".bearing/state"), { recursive: true });
    await writeFile(join(invalidRoot, ".bearing/state/accepted.md"), "retained truth\n");

    const activeResult = await runSetupCli(activeRoot, homeDir, ["--plan"]);
    const deactivatedResult = await runSetupCli(deactivatedRoot, homeDir, ["--plan"]);
    const invalidResult = await runSetupCli(invalidRoot, homeDir, ["--plan"]);

    expect(activeResult.exitCode).toBe(0);
    expect(JSON.parse(activeResult.stdout)).toMatchObject({
      lifecycle: { kind: "active", legacyTransitionRequired: true },
      canApply: false,
    });
    expect(deactivatedResult.exitCode).toBe(0);
    expect(JSON.parse(deactivatedResult.stdout)).toMatchObject({
      lifecycle: { kind: "deactivated", legacyTransitionRequired: false },
      canApply: false,
    });
    expect(invalidResult.exitCode).toBe(0);
    expect(JSON.parse(invalidResult.stdout)).toMatchObject({
      lifecycle: { kind: "invalid-or-unsupported" },
      canApply: false,
    });
    expect(await readFile(join(invalidRoot, ".bearing/state/accepted.md"), "utf8")).toBe(
      "retained truth\n",
    );
  });

  test("classifies retained configuration without a manifest as Invalid", async () => {
    const repoRoot = await makeTemporaryDirectory("bearing-plan-orphaned-config-");
    await mkdir(join(repoRoot, ".bearing/executor-profiles"), { recursive: true });
    const profilePath = join(repoRoot, ".bearing/executor-profiles/custom.md");
    await writeFile(profilePath, "# Retained user configuration\n");

    const plan = await planRepositoryIntegration({
      repoRoot,
      packageRoot: process.cwd(),
      surfaces: ["agent-skills"],
      profiles: ["generic-agent"],
    });

    expect(plan).toMatchObject({
      lifecycle: { kind: "invalid-or-unsupported" },
      canApply: false,
    });
    expect(await readFile(profilePath, "utf8")).toBe("# Retained user configuration\n");
  });

  test("leaves an unselected Agent Surface outside the Apply Unit", async () => {
    const repoRoot = await makeTemporaryDirectory("bearing-plan-unselected-");
    const homeDir = await makeTemporaryDirectory("bearing-plan-home-");
    const block = `<!-- bearing:managed-start -->
For every project request, load and follow the global \`bearing\` skill as the governing runbook.
<!-- bearing:managed-end -->
`;
    await mkdir(join(repoRoot, ".bearing/state"), { recursive: true });
    await writeFile(
      join(repoRoot, ".bearing/manifest.json"),
      `${JSON.stringify({
        schemaVersion: 1,
        packageVersion: "0.1.0",
        surfaces: ["agent-skills", "claude"],
        executorProfiles: ["generic-agent"],
      })}\n`,
    );
    await writeFile(join(repoRoot, "AGENTS.md"), block);
    await writeFile(join(repoRoot, "CLAUDE.md"), `# Claude rules\n\n${block}`);

    const result = await runSetupCli(repoRoot, homeDir, ["--plan"]);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout).stages.repositoryApplyUnit.targets).toEqual([
      ".bearing/executor-profiles/generic-agent.md",
      ".bearing/manifest.json",
      ".bearing/provider.json",
      "AGENTS.md",
    ]);
    expect(await readFile(join(repoRoot, "CLAUDE.md"), "utf8")).toContain("bearing:managed-start");
  });

  test("fails the plan closed on an unsafe target without following or changing it", async () => {
    const repoRoot = await makeTemporaryDirectory("bearing-plan-unsafe-");
    const homeDir = await makeTemporaryDirectory("bearing-plan-home-");
    const outsideRoot = await makeTemporaryDirectory("bearing-plan-outside-");
    const externalAgents = join(outsideRoot, "AGENTS.md");
    await writeFile(externalAgents, "# External bytes\n");
    await symlink(externalAgents, join(repoRoot, "AGENTS.md"));

    const result = await runSetupCli(repoRoot, homeDir, ["--plan"]);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      canApply: false,
      blockers: [
        {
          code: "unsafe-repository-target",
          target: "AGENTS.md",
        },
      ],
    });
    expect(await readFile(externalAgents, "utf8")).toBe("# External bytes\n");
    await expect(access(join(repoRoot, ".bearing"))).rejects.toThrow();
  });

  test("fails the plan closed before following a nested repository symlink", async () => {
    const repoRoot = await makeTemporaryDirectory("bearing-plan-nested-link-");
    const outsideRoot = await makeTemporaryDirectory("bearing-plan-nested-outside-");
    const externalProfiles = join(outsideRoot, "executor-profiles");
    const externalProfile = join(externalProfiles, "generic-agent.md");
    await mkdir(join(repoRoot, ".bearing"));
    await mkdir(externalProfiles);
    await writeFile(externalProfile, "# External profile bytes\n");
    await symlink(externalProfiles, join(repoRoot, ".bearing/executor-profiles"));

    const plan = await planRepositoryIntegration({
      repoRoot,
      packageRoot: process.cwd(),
      surfaces: ["agent-skills"],
      profiles: ["generic-agent"],
    });

    expect(plan).toMatchObject({
      lifecycle: { kind: "invalid-or-unsupported" },
      canApply: false,
      blockers: [
        {
          code: "unsafe-repository-target",
          target: ".bearing/executor-profiles/generic-agent.md",
        },
      ],
    });
    expect(await readFile(externalProfile, "utf8")).toBe("# External profile bytes\n");
  });

  test("refuses an Apply when a planned target changes before precondition re-read", async () => {
    const repoRoot = await makeTemporaryDirectory("bearing-plan-race-");
    const agentsPath = join(repoRoot, "AGENTS.md");
    await writeFile(agentsPath, "# Before planning\n");

    await expect(
      setupRepository(
        {
          repoRoot,
          packageRoot: process.cwd(),
          surfaces: ["agent-skills"],
          profiles: ["generic-agent"],
        },
        {
          afterPlan: async () => {
            await writeFile(agentsPath, "# Concurrent user edit\n");
          },
        },
      ),
    ).rejects.toThrow("changed after repository integration planning");

    expect(await readFile(agentsPath, "utf8")).toBe("# Concurrent user edit\n");
    await expect(access(join(repoRoot, ".bearing"))).rejects.toThrow();
  });

  test("restores prior bytes and removes created namespaces when repository Apply fails", async () => {
    const repoRoot = await makeTemporaryDirectory("bearing-plan-rollback-");
    const agentsPath = join(repoRoot, "AGENTS.md");
    const originalAgents = "# Preserve these instructions\n";
    await writeFile(agentsPath, originalAgents);

    await expect(
      setupRepository(
        {
          repoRoot,
          packageRoot: process.cwd(),
          surfaces: ["agent-skills"],
          profiles: ["generic-agent"],
        },
        {
          writeTarget: async (plan, ordinal) => {
            if (ordinal === 1) throw new Error("injected second-target failure");
            await writeInstallTarget(plan, ordinal);
          },
        },
      ),
    ).rejects.toThrow("all written targets were restored");

    expect(await readFile(agentsPath, "utf8")).toBe(originalAgents);
    await expect(access(join(repoRoot, ".bearing"))).rejects.toThrow();
  });
});
