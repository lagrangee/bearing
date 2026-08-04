import { beforeAll, describe, expect, test } from "bun:test";
import { access, mkdir, readFile, symlink, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { BEARING_POINTER } from "../src/agent-surface-entry";
import {
  type ExecutorNominationAssessment,
  resolveExecutorNomination,
  resolveExecutorWritebackProfile,
} from "../src/executor-registration";
import { writeInstallTarget } from "../src/installer";
import { setupRepository } from "../src/repo-setup";
import { planRepositoryIntegration } from "../src/repository-integration-plan";
import { standardGitHubMattContract } from "./fixtures/github-matt-api";
import { LOCAL_MATT_CONTRACT, makeTemporaryDirectory, standardMattAgentSurface } from "./helpers";

const runSetupCli = async (
  repoRoot: string,
  homeDir: string,
  extraArgs: readonly string[],
  surfaces: readonly ("agent-skills" | "claude")[] = ["agent-skills"],
): Promise<Readonly<{ stdout: string; stderr: string; exitCode: number }>> => {
  const child = Bun.spawn(
    [
      "node",
      join(process.cwd(), "dist/cli.js"),
      "setup",
      "--repo",
      repoRoot,
      ...surfaces.flatMap((surface) => ["--surface", surface]),
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

const runLifecycleCli = async (
  repoRoot: string,
  homeDir: string,
  command: "deactivate" | "purge",
  extraArgs: readonly string[] = [],
): Promise<Readonly<{ stdout: string; stderr: string; exitCode: number }>> => {
  const child = Bun.spawn(
    ["node", join(process.cwd(), "dist/cli.js"), command, "--repo", repoRoot, ...extraArgs],
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

const writeExecutorSkillFixture = async (
  homeDir: string,
  surface: "agent-skills" | "claude",
  name: string,
  body: string,
): Promise<void> => {
  const surfaceRoot = surface === "agent-skills" ? ".agents/skills" : ".claude/skills";
  const directory = join(homeDir, surfaceRoot, name);
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, "SKILL.md"),
    `---
name: ${name}
description: "${name} executor"
---

${body}
`,
  );
};

const executorAssessment = (
  capabilityLocator: string,
  executionOwnershipEvidence: string,
  finalWritebackEvidence: string,
): ExecutorNominationAssessment => ({
  capabilityLocator,
  conclusion: "owns-end-to-end-execution-and-final-writeback",
  requiredReferences: [],
  executionOwnershipEvidence,
  finalWritebackEvidence,
  nativeArtifacts: [
    {
      description: "Execution outcome produced by the nominated executor.",
      evidence: finalWritebackEvidence,
    },
  ],
  writebackBehavior: {
    description: "Complete the final writeback declared by the nominated executor.",
    evidence: finalWritebackEvidence,
  },
});

const executorAssessmentArgs = (
  capabilityLocator: string,
  executionOwnershipEvidence: string,
  finalWritebackEvidence: string,
): readonly string[] => [
  "--executor-assessment",
  JSON.stringify(
    executorAssessment(capabilityLocator, executionOwnershipEvidence, finalWritebackEvidence),
  ),
];

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
    options.contract ??
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
  for (const surface of options.surfaces ?? ["agent-skills"]) {
    await writeFile(
      join(repoRoot, surface === "agent-skills" ? "AGENTS.md" : "CLAUDE.md"),
      standardMattAgentSurface(contractLocator),
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

  test("accepts the standard Matt GitHub block without a marker or standalone pointer", async () => {
    const repoRoot = await makeTemporaryDirectory("bearing-plan-standard-github-");
    const contractLocator = "docs/agents/issue-tracker.md";
    const standardContract = `# Issue tracker: GitHub

Issues and PRDs for this repo live as GitHub issues. Use the \`gh\` CLI for all operations.

## Conventions

- Read an issue with \`gh issue view\`.

## Pull requests as a triage surface

**PRs as a request surface: no.**

## When a skill says "publish to the issue tracker"

Create a GitHub issue.

## When a skill says "fetch the relevant ticket"

Run \`gh issue view <number> --comments\`.

## Wayfinding operations

Use one issue with child issues.
`;
    const standardSurface = `# Repository instructions

## Agent skills

### Issue tracker

Issues and PRDs live as GitHub issues. See \`${contractLocator}\`.

### Triage labels

Use the repository mappings.
`;
    await mkdir(join(repoRoot, "docs/agents"), { recursive: true });
    await writeFile(join(repoRoot, contractLocator), standardContract);
    await writeFile(join(repoRoot, "AGENTS.md"), standardSurface);
    const contractBefore = await readFile(join(repoRoot, contractLocator));
    const surfaceBefore = await readFile(join(repoRoot, "AGENTS.md"));

    const plan = await planRepositoryIntegration({
      repoRoot,
      packageRoot: process.cwd(),
      surfaces: ["agent-skills"],
      profiles: [],
      provider: { key: "matt-skills/v1", contractLocator },
    });

    expect(plan.canApply).toBe(true);
    expect(plan.stages.externalPrerequisites.items[1]?.state).toBe("satisfied");
    expect(await readFile(join(repoRoot, contractLocator))).toEqual(contractBefore);
    expect(await readFile(join(repoRoot, "AGENTS.md"))).toEqual(surfaceBefore);
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

  test("applies zero, one, or multiple accepted surface-scoped Executor Registrations", async () => {
    const codexRoot = await makeTemporaryDirectory("bearing-setup-codex-executor-");
    const codexHome = await makeTemporaryDirectory("bearing-setup-codex-executor-home-");
    const codexContract = await writeMattProviderFixture(codexRoot);
    await writeExecutorSkillFixture(
      codexHome,
      "agent-skills",
      "implement",
      "Implement the work from its spec through verification, then commit your work.",
    );
    await writeExecutorSkillFixture(
      codexHome,
      "agent-skills",
      "execute-plan",
      "Execute the plan end to end and publish the final completion report.",
    );

    const codexResult = await runSetupCli(codexRoot, codexHome, [
      "--provider-contract",
      codexContract,
      "--executor",
      "agent-skills:implement",
      ...executorAssessmentArgs(
        "agent-skills:implement",
        "Implement the work from its spec through verification",
        "commit your work",
      ),
      "--executor",
      "agent-skills:execute-plan",
      ...executorAssessmentArgs(
        "agent-skills:execute-plan",
        "Execute the plan end to end",
        "publish the final completion report",
      ),
    ]);
    expect(codexResult.exitCode).toBe(0);
    expect(
      JSON.parse(await readFile(join(codexRoot, ".bearing/manifest.json"), "utf8")),
    ).toMatchObject({
      executorProfiles: ["agent-skills-execute-plan", "agent-skills-implement"],
    });
    expect(
      await readFile(
        join(codexRoot, ".bearing/executor-profiles/agent-skills-implement.md"),
        "utf8",
      ),
    ).toContain("Capability locator: agent-skills:implement");
    await expect(
      resolveExecutorWritebackProfile(codexRoot, "agent-skills:implement"),
    ).resolves.toMatchObject({
      profileKey: "agent-skills-implement",
      matchedRegistration: true,
      reconciliationScope: "execution-evidence-only",
      authorizesNativeTerminalWriteback: false,
    });
    await expect(
      resolveExecutorWritebackProfile(codexRoot, "claude:unregistered-executor"),
    ).resolves.toMatchObject({
      profileKey: "generic-agent",
      matchedRegistration: false,
      reconciliationScope: "execution-evidence-only",
      authorizesNativeTerminalWriteback: false,
      disclosure: expect.stringMatching(
        /no specialized Executor Registration matched[\s\S]*evidence reconciliation only[\s\S]*no native Ticket lifecycle authority/iu,
      ),
    });

    const claudeRoot = await makeTemporaryDirectory("bearing-setup-claude-executor-");
    const claudeHome = await makeTemporaryDirectory("bearing-setup-claude-executor-home-");
    const claudeContract = await writeMattProviderFixture(claudeRoot, {
      surfaces: ["claude"],
    });
    await writeExecutorSkillFixture(
      claudeHome,
      "claude",
      "execute-plan",
      "Execute the plan and own the final writeback.",
    );
    const claudeResult = await runSetupCli(
      claudeRoot,
      claudeHome,
      [
        "--provider-contract",
        claudeContract,
        "--executor",
        "claude:execute-plan",
        ...executorAssessmentArgs(
          "claude:execute-plan",
          "Execute the plan",
          "own the final writeback",
        ),
      ],
      ["claude"],
    );
    expect(claudeResult.exitCode).toBe(0);
    expect(
      JSON.parse(await readFile(join(claudeRoot, ".bearing/manifest.json"), "utf8")),
    ).toMatchObject({ surfaces: ["claude"], executorProfiles: ["claude-execute-plan"] });
    expect(await readFile(join(claudeRoot, "CLAUDE.md"), "utf8")).toContain(
      "bearing:managed-start",
    );
    await expect(
      resolveExecutorWritebackProfile(claudeRoot, "claude:execute-plan"),
    ).resolves.toMatchObject({
      profileKey: "claude-execute-plan",
      matchedRegistration: true,
    });
  });

  test("keeps an invalid optional nomination skippable and makes no partial writes", async () => {
    const repoRoot = await makeTemporaryDirectory("bearing-setup-invalid-executor-");
    const homeDir = await makeTemporaryDirectory("bearing-setup-invalid-executor-home-");
    const contractLocator = await writeMattProviderFixture(repoRoot);
    await writeExecutorSkillFixture(
      homeDir,
      "agent-skills",
      "tdd",
      "Use test-driven development and run focused tests.",
    );

    const invalid = await runSetupCli(repoRoot, homeDir, [
      "--provider-contract",
      contractLocator,
      "--executor",
      "agent-skills:tdd",
    ]);
    expect(invalid.exitCode).toBe(1);
    expect(invalid.stderr).toContain("semantic assessments must match");
    await expect(access(join(repoRoot, ".bearing"))).rejects.toThrow();

    const skipped = await runSetupCli(repoRoot, homeDir, ["--provider-contract", contractLocator]);
    expect(skipped.exitCode).toBe(0);
    expect(
      JSON.parse(await readFile(join(repoRoot, ".bearing/manifest.json"), "utf8")),
    ).toMatchObject({ executorProfiles: [] });
  });

  test("revalidates a nominated executor contract through the complete Apply Unit", async () => {
    const repoRoot = await makeTemporaryDirectory("bearing-setup-executor-race-");
    const homeDir = await makeTemporaryDirectory("bearing-setup-executor-race-home-");
    const contractLocator = await writeMattProviderFixture(repoRoot);
    await writeExecutorSkillFixture(
      homeDir,
      "agent-skills",
      "implement",
      "Implement the work through verification, then commit your work.",
    );
    const registration = await resolveExecutorNomination(
      homeDir,
      "agent-skills:implement",
      executorAssessment(
        "agent-skills:implement",
        "Implement the work through verification",
        "commit your work",
      ),
    );
    const skillPath = join(homeDir, ".agents/skills/implement/SKILL.md");

    await expect(
      setupRepository(
        {
          repoRoot,
          packageRoot: process.cwd(),
          surfaces: ["agent-skills"],
          profiles: [registration.profileKey],
          registrations: [registration],
          executorHomeDir: homeDir,
          provider: { key: "matt-skills/v1", contractLocator },
        },
        {
          writeTarget: async (plan, ordinal) => {
            await writeInstallTarget(plan, ordinal);
            if (ordinal === 0) {
              await writeFile(
                skillPath,
                `---
name: implement
description: "changed helper"
---

Review an existing patch.
`,
              );
            }
          },
        },
      ),
    ).rejects.toThrow("all written targets were restored");

    await expect(access(join(repoRoot, ".bearing"))).rejects.toThrow();
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
      standardMattAgentSurface(contractLocator),
    );
    await expect(access(join(homeDir, ".bearing"))).rejects.toThrow();
  });

  test("requires the selected Agent Surface to point to the exact supported contract", async () => {
    const missingPointerRoot = await makeTemporaryDirectory("bearing-setup-missing-pointer-");
    const contractLocator = "docs/agents/issue-tracker.md";
    await mkdir(join(missingPointerRoot, "docs/agents"), { recursive: true });
    await writeFile(join(missingPointerRoot, contractLocator), LOCAL_MATT_CONTRACT);
    await writeFile(
      join(missingPointerRoot, "AGENTS.md"),
      `## Documentation

### Issue tracker

Example only; do not configure \`${contractLocator}\` here.
`,
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
    await writeFile(join(divergentRoot, secondLocator), standardGitHubMattContract);
    await writeFile(join(divergentRoot, "CLAUDE.md"), standardMattAgentSurface(secondLocator));
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
    const unavailableRegistration = {
      profileKey: "agent-skills-implement",
      displayName: "/implement",
      surface: "agent-skills" as const,
      capabilityLocator: "agent-skills:implement",
      nativeArtifacts: ["Implementation changes."],
      writebackBehavior: "Commit the completed work.",
      assessment: executorAssessment(
        "agent-skills:implement",
        "Implement the work.",
        "Commit the completed work.",
      ),
      sourceContractSnapshot: "unavailable-test-snapshot",
    };
    const profilePlan = await planRepositoryIntegration({
      repoRoot: profileRoot,
      packageRoot: process.cwd(),
      surfaces: ["agent-skills"],
      profiles: [unavailableRegistration.profileKey],
      registrations: [unavailableRegistration],
      provider: { key: "matt-skills/v1", contractLocator: profileContract },
    });
    expect(profilePlan.canApply).toBe(false);
    expect(profilePlan.blockers).toContainEqual(
      expect.objectContaining({
        code: "unsupported-executor-registration",
        message: expect.stringMatching(/Agent Surface home/iu),
      }),
    );

    const missingExecutorHome = await makeTemporaryDirectory("bearing-setup-profile-missing-home-");
    const unavailablePlan = await planRepositoryIntegration({
      repoRoot: profileRoot,
      packageRoot: process.cwd(),
      surfaces: ["agent-skills"],
      profiles: [unavailableRegistration.profileKey],
      registrations: [unavailableRegistration],
      executorHomeDir: missingExecutorHome,
      provider: { key: "matt-skills/v1", contractLocator: profileContract },
    });
    expect(unavailablePlan.canApply).toBe(false);
    expect(unavailablePlan.blockers).toContainEqual(
      expect.objectContaining({
        code: "unsupported-executor-registration",
        message: expect.stringMatching(/unavailable/iu),
      }),
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
      standardMattAgentSurface(contractLocator),
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
    expect(result.stderr).toContain("Completed: repository Setup Apply");
    expect(result.stderr).toContain("Pending: Project Catalog registration");
    expect(result.stderr).toContain("Persistent external effects:");
    expect(result.stderr).toContain("Resumption point:");
    expect(
      JSON.parse(await readFile(join(repoRoot, ".bearing/manifest.json"), "utf8")),
    ).toMatchObject({ status: "active", executorProfiles: [] });
  });

  test("returns a byte-preserving Active exact no-op without replaying Fresh Setup", async () => {
    const repoRoot = await makeTemporaryDirectory("bearing-setup-active-exact-");
    const homeDir = await makeTemporaryDirectory("bearing-setup-active-exact-home-");
    const contractLocator = await writeMattProviderFixture(repoRoot);
    const args = ["--provider-contract", contractLocator] as const;

    expect((await runSetupCli(repoRoot, homeDir, args)).exitCode).toBe(0);
    const manifestBefore = await readFile(join(repoRoot, ".bearing/manifest.json"));
    const agentsBefore = await readFile(join(repoRoot, "AGENTS.md"));
    const receiptBefore = await readFile(join(repoRoot, ".bearing/cache/sync-receipt.json"));

    const exact = await runSetupCli(repoRoot, homeDir, args);

    expect(exact).toMatchObject({ exitCode: 0, stderr: "" });
    expect(exact.stdout).toContain("Outcome: no-op");
    expect(exact.stdout).toContain("Repository: no-op");
    expect(exact.stdout).toContain("Catalog: no-op");
    expect(await readFile(join(repoRoot, ".bearing/manifest.json"))).toEqual(manifestBefore);
    expect(await readFile(join(repoRoot, "AGENTS.md"))).toEqual(agentsBefore);
    expect(await readFile(join(repoRoot, ".bearing/cache/sync-receipt.json"))).toEqual(
      receiptBefore,
    );
  });

  test("reports exact Active drift when repair is declined and applies only after confirmation", async () => {
    const repoRoot = await makeTemporaryDirectory("bearing-setup-active-repair-");
    const homeDir = await makeTemporaryDirectory("bearing-setup-active-repair-home-");
    const contractLocator = await writeMattProviderFixture(repoRoot);
    const args = ["--provider-contract", contractLocator] as const;
    expect((await runSetupCli(repoRoot, homeDir, args)).exitCode).toBe(0);
    const receiptBefore = await readFile(join(repoRoot, ".bearing/cache/sync-receipt.json"));
    const drifted = standardMattAgentSurface(contractLocator);
    await writeFile(join(repoRoot, "AGENTS.md"), drifted);

    const declined = await runSetupCli(repoRoot, homeDir, args);

    expect(declined.exitCode).toBe(1);
    expect(declined.stderr).toContain("Active repository is degraded at: AGENTS.md");
    expect(declined.stderr).toContain("--confirm-repair");
    expect(await readFile(join(repoRoot, "AGENTS.md"), "utf8")).toBe(drifted);

    const repaired = await runSetupCli(repoRoot, homeDir, [...args, "--confirm-repair"]);
    expect(repaired.exitCode).toBe(0);
    expect(repaired.stdout).toContain("Repository: applied");
    expect(repaired.stdout).toContain("Changed targets: 1");
    expect(await readFile(join(repoRoot, "AGENTS.md"), "utf8")).toContain("bearing:managed-start");
    expect(await readFile(join(repoRoot, ".bearing/cache/sync-receipt.json"))).toEqual(
      receiptBefore,
    );
  });

  test("revalidates unchanged profiles without replay and requires explicit profile changes", async () => {
    const repoRoot = await makeTemporaryDirectory("bearing-setup-profile-disposition-");
    const homeDir = await makeTemporaryDirectory("bearing-setup-profile-disposition-home-");
    const contractLocator = await writeMattProviderFixture(repoRoot);
    await writeExecutorSkillFixture(
      homeDir,
      "agent-skills",
      "implement",
      "Implement the work through verification and commit the completed work.",
    );
    const registrationArgs = [
      "--provider-contract",
      contractLocator,
      "--executor",
      "agent-skills:implement",
      ...executorAssessmentArgs(
        "agent-skills:implement",
        "Implement the work through verification",
        "commit the completed work",
      ),
    ] as const;
    expect((await runSetupCli(repoRoot, homeDir, registrationArgs)).exitCode).toBe(0);

    const omitted = await runSetupCli(repoRoot, homeDir, ["--provider-contract", contractLocator]);
    expect(omitted.exitCode).toBe(1);
    expect(omitted.stderr).toContain("require a current semantic revalidation assessment");

    const revalidated = await runSetupCli(repoRoot, homeDir, registrationArgs);
    expect(revalidated.exitCode).toBe(0);
    expect(revalidated.stdout).toContain("Outcome: no-op");

    await unlink(join(homeDir, ".agents/skills/implement/SKILL.md"));
    const unavailable = await runSetupCli(repoRoot, homeDir, registrationArgs);
    expect(unavailable.exitCode).toBe(1);
    expect(unavailable.stderr).toContain("unavailable");

    const retained = await runSetupCli(repoRoot, homeDir, [
      "--provider-contract",
      contractLocator,
      "--retain-executor",
      "agent-skills-implement",
    ]);
    expect(retained.exitCode).toBe(0);
    expect(retained.stdout).toContain("Outcome: no-op");

    const declinedRemoval = await runSetupCli(repoRoot, homeDir, [
      "--provider-contract",
      contractLocator,
      "--remove-executor",
      "agent-skills-implement",
    ]);
    expect(declinedRemoval.exitCode).toBe(1);
    expect(declinedRemoval.stderr).toContain("--confirm-repair");

    const manifestBeforeRemoval = await readFile(join(repoRoot, ".bearing/manifest.json"));
    const profilePath = join(repoRoot, ".bearing/executor-profiles/agent-skills-implement.md");
    const profileBeforeRemoval = await readFile(profilePath);
    await expect(
      setupRepository(
        {
          repoRoot,
          packageRoot: process.cwd(),
          surfaces: ["agent-skills"],
          profiles: [],
          removeProfiles: ["agent-skills-implement"],
          confirmRepair: true,
          provider: { key: "matt-skills/v1", contractLocator },
        },
        {
          writeTarget: async (plan, ordinal) => {
            if (plan.target.endsWith(".bearing/cache/sync-receipt.json")) {
              throw new Error("injected profile removal transaction failure");
            }
            await writeInstallTarget(plan, ordinal);
          },
        },
      ),
    ).rejects.toThrow("all written targets were restored");
    expect(await readFile(join(repoRoot, ".bearing/manifest.json"))).toEqual(manifestBeforeRemoval);
    expect(await readFile(profilePath)).toEqual(profileBeforeRemoval);

    const removed = await runSetupCli(repoRoot, homeDir, [
      "--provider-contract",
      contractLocator,
      "--remove-executor",
      "agent-skills-implement",
      "--confirm-repair",
    ]);
    expect(removed.exitCode).toBe(0);
    expect(
      JSON.parse(await readFile(join(repoRoot, ".bearing/manifest.json"), "utf8")),
    ).toMatchObject({ executorProfiles: [] });
    await expect(
      access(join(repoRoot, ".bearing/executor-profiles/agent-skills-implement.md")),
    ).rejects.toThrow();
  });

  test("runs a real reversible deactivate and explicit reactivation lifecycle idempotently", async () => {
    const repoRoot = await makeTemporaryDirectory("bearing-setup-reactivate-");
    const homeDir = await makeTemporaryDirectory("bearing-setup-reactivate-home-");
    const contractLocator = await writeMattProviderFixture(repoRoot);
    const args = ["--provider-contract", contractLocator] as const;
    expect((await runSetupCli(repoRoot, homeDir, args)).exitCode).toBe(0);
    await mkdir(join(repoRoot, ".bearing/state"), { recursive: true });
    await writeFile(join(repoRoot, ".bearing/state/accepted.md"), "accepted truth\n");
    const providerBefore = await readFile(join(repoRoot, ".bearing/provider.json"));

    const deactivated = await runLifecycleCli(repoRoot, homeDir, "deactivate");
    expect(deactivated).toMatchObject({ exitCode: 0, stderr: "" });
    expect(deactivated.stdout).toContain("Repository: applied");
    expect(
      JSON.parse(await readFile(join(repoRoot, ".bearing/manifest.json"), "utf8")),
    ).toMatchObject({ status: "deactivated" });
    expect(await readFile(join(repoRoot, ".bearing/provider.json"))).toEqual(providerBefore);
    expect(await readFile(join(repoRoot, ".bearing/state/accepted.md"), "utf8")).toBe(
      "accepted truth\n",
    );
    await expect(access(join(repoRoot, ".bearing/cache"))).rejects.toThrow();

    const implicit = await runSetupCli(repoRoot, homeDir, args);
    expect(implicit.exitCode).toBe(1);
    expect(implicit.stderr).toContain("--confirm-reactivate");

    const reactivated = await runSetupCli(repoRoot, homeDir, [...args, "--confirm-reactivate"]);
    expect(reactivated.exitCode).toBe(0);
    expect(reactivated.stdout).toContain("Repository: applied");
    expect(
      JSON.parse(await readFile(join(repoRoot, ".bearing/manifest.json"), "utf8")),
    ).toMatchObject({ status: "active" });
    expect(await readFile(join(repoRoot, "AGENTS.md"), "utf8")).toContain(BEARING_POINTER);
    expect(await readFile(join(repoRoot, ".bearing/state/accepted.md"), "utf8")).toBe(
      "accepted truth\n",
    );

    const exact = await runSetupCli(repoRoot, homeDir, args);
    expect(exact.exitCode).toBe(0);
    expect(exact.stdout).toContain("Outcome: no-op");
  });

  test("reports repository completion and pending Catalog cleanup as a lifecycle split outcome", async () => {
    const repoRoot = await makeTemporaryDirectory("bearing-deactivate-catalog-split-");
    const homeDir = await makeTemporaryDirectory("bearing-deactivate-catalog-split-home-");
    const contractLocator = await writeMattProviderFixture(repoRoot);
    expect(
      (await runSetupCli(repoRoot, homeDir, ["--provider-contract", contractLocator])).exitCode,
    ).toBe(0);
    await writeFile(join(homeDir, ".bearing/catalog.json"), "{ invalid\n");

    const result = await runLifecycleCli(repoRoot, homeDir, "deactivate");

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("Outcome: partial");
    expect(result.stdout).toContain("Repository: applied");
    expect(result.stdout).toContain("Catalog: failed");
    expect(result.stderr).toContain("Catalog removal failed");
    expect(result.stderr).toContain("Completed: repository lifecycle apply");
    expect(result.stderr).toContain("Pending: Project Catalog removal");
    expect(result.stderr).toContain("Persistent external effects:");
    expect(result.stderr).toContain("Resumption point:");
    expect(
      JSON.parse(await readFile(join(repoRoot, ".bearing/manifest.json"), "utf8")),
    ).toMatchObject({ status: "deactivated" });
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
      standardMattAgentSurface(contractLocator),
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
      standardMattAgentSurface(contractLocator),
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

  test("contracts legacy manifests and classifies dependency-invalid Deactivated and Invalid repositories from inspectable facts", async () => {
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
      lifecycle: { kind: "invalid-or-unsupported" },
      recoveryDiagnosis: {
        classification: "legacy-cutover",
        blockers: [{ cause: "recognized-older-schema" }],
      },
      canApply: false,
    });
    expect(deactivatedResult.exitCode).toBe(0);
    expect(JSON.parse(deactivatedResult.stdout)).toMatchObject({
      lifecycle: { kind: "invalid-or-unsupported" },
      recoveryDiagnosis: {
        blockers: [
          { cause: "owner-dependency", unsafeInputs: [".bearing/provider.json"] },
          {
            cause: "owner-dependency",
            unsafeInputs: [".bearing/executor-profiles/generic-agent.md"],
          },
        ],
      },
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
    const contractLocator = await writeMattProviderFixture(repoRoot);
    await writeFile(
      agentsPath,
      `# Before planning\n\n${standardMattAgentSurface(contractLocator)}`,
    );

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
            await writeFile(agentsPath, "# Concurrent user edit\n");
          },
        },
      ),
    ).rejects.toThrow("changed after Fresh Setup review");

    expect(await readFile(agentsPath, "utf8")).toBe("# Concurrent user edit\n");
    await expect(access(join(repoRoot, ".bearing"))).rejects.toThrow();
  });

  test("restores prior bytes and removes created namespaces when repository Apply fails", async () => {
    const repoRoot = await makeTemporaryDirectory("bearing-plan-rollback-");
    const agentsPath = join(repoRoot, "AGENTS.md");
    const contractLocator = await writeMattProviderFixture(repoRoot);
    const originalAgents = `# Preserve these instructions\n\n${standardMattAgentSurface(contractLocator)}`;
    await writeFile(agentsPath, originalAgents);

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
