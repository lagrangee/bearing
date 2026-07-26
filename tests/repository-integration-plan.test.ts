import { beforeAll, describe, expect, test } from "bun:test";
import { access, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
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
      canApply: true,
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
      "AGENTS.md",
    ]);
    expect(await readFile(agentsPath, "utf8")).toBe(originalAgents);
    await expect(access(join(repoRoot, ".bearing"))).rejects.toThrow();
    await expect(access(join(homeDir, ".bearing"))).rejects.toThrow();
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
      canApply: true,
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

  test("includes removal of an existing managed block on an unselected surface", async () => {
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
      "AGENTS.md",
      "CLAUDE.md",
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
