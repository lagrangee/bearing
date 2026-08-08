import { describe, expect, test } from "bun:test";
import { access, mkdir, mkdtemp, realpath, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { CODEX_E2E_RUNTIME, codexE2ERuntimeArguments } from "../scripts/codex-e2e-runtime";
import {
  driftManagedPointer,
  finalizeFixtureSnapshot,
  G1_LIVE_JOURNEYS,
  G1_LIVE_PLAN_ID,
  G1_LIVE_SURFACES,
  G1_MATT_SKILL_CLOSURE,
  inspectCodexOperatorContext,
  instructionBytes,
  repositoryConfigurationActivationArguments,
  serializeG1LiveSkillInvocation,
  surfaceLaunchContract,
} from "../scripts/g1-live-fixture";
import { BEARING_POINTER } from "../src/agent-surface-entry";

describe("G1 live fixture recipe", () => {
  test("places the Matt contract pointer in the supported Agent skills section", () => {
    expect(instructionBytes("docs/agents/issue-tracker.md")).toContain(`## Agent skills

### Issue tracker

Work-management contract: \`docs/agents/issue-tracker.md\``);
  });

  test("uses the repository-wide fail-closed Codex E2E runtime identity", () => {
    expect(CODEX_E2E_RUNTIME).toEqual({
      model: "gpt-5.6-luna",
      reasoningEffort: "high",
    });
    expect(codexE2ERuntimeArguments()).toEqual([
      "--model",
      "gpt-5.6-luna",
      "--config",
      'model_reasoning_effort="high"',
    ]);
    expect(() =>
      codexE2ERuntimeArguments({ model: "different-model", reasoningEffort: "low" }),
    ).toThrow("does not accept runtime overrides");
  });

  test("activates live fixtures through Repository Configuration", () => {
    expect(repositoryConfigurationActivationArguments("codex", "/private/tmp/g1/repo")).toEqual([
      "--intent",
      "activate",
      "--repo",
      "/private/tmp/g1/repo",
      "--surface",
      "agent-skills",
      "--provider-contract",
      "docs/agents/issue-tracker.md",
      "--executor-mode",
      "skip",
    ]);
  });

  test("injects current managed pointer drift and fails closed when the pointer is absent", () => {
    const current = `Before\n${BEARING_POINTER}\nAfter\n`;
    const drifted = driftManagedPointer(current);

    expect(drifted).not.toBe(current);
    expect(drifted).toContain(`DRIFTED: ${BEARING_POINTER}`);
    expect(() => driftManagedPointer("no managed pointer here\n")).toThrow(
      "current pointer is absent",
    );
  });

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

  test("serializes explicit skill invocation for each raw live-runner surface", () => {
    expect(serializeG1LiveSkillInvocation("codex", "implement", "执行 Ticket 01-add-alpha。")).toBe(
      "$implement 执行 Ticket 01-add-alpha。",
    );
    expect(
      serializeG1LiveSkillInvocation("claude-code", "implement", "执行 Ticket 01-add-alpha。"),
    ).toBe("/implement 执行 Ticket 01-add-alpha。");
  });

  test("separates Codex identity reuse from each isolated fixture home", () => {
    expect(
      surfaceLaunchContract({
        surface: "codex",
        repositoryRoot: "/private/tmp/g1/repo $()",
        isolatedHome: "/private/tmp/g1/home `touch nope`",
        codexHome: "/Users/example/.codex",
        disabledOperatorSkillPaths: [
          "/Users/example/.codex/skills/operator-one/SKILL.md",
          "/Users/example/.codex/skills/operator-two/SKILL.md",
        ],
      }),
    ).toEqual({
      mode: "codex-exec",
      codexHome: "/Users/example/.codex",
      environment: {
        HOME: "/private/tmp/g1/home `touch nope`",
        CODEX_HOME: "/Users/example/.codex",
      },
      initial: {
        program: "codex",
        arguments: [
          "exec",
          "--model",
          "gpt-5.6-luna",
          "--config",
          'model_reasoning_effort="high"',
          "--ignore-user-config",
          "--ignore-rules",
          "-c",
          'approval_policy="on-request"',
          "-c",
          'approvals_reviewer="auto_review"',
          "--sandbox",
          "workspace-write",
          "--add-dir",
          "/private/tmp/g1/home `touch nope`",
          "--cd",
          "/private/tmp/g1/repo $()",
          "--json",
          "--disable",
          "apps",
          "--disable",
          "browser_use",
          "--disable",
          "browser_use_external",
          "--disable",
          "chronicle",
          "--disable",
          "computer_use",
          "--disable",
          "goals",
          "--disable",
          "hooks",
          "--disable",
          "image_generation",
          "--disable",
          "memories",
          "--disable",
          "plugin_sharing",
          "--disable",
          "plugins",
          "--disable",
          "skill_mcp_dependency_install",
          "--disable",
          "tool_suggest",
          "--disable",
          "workspace_dependencies",
          "-c",
          'skills.config=[{path="/Users/example/.codex/skills/operator-one/SKILL.md",enabled=false},{path="/Users/example/.codex/skills/operator-two/SKILL.md",enabled=false}]',
        ],
        appendPromptAsFinalArgument: true,
      },
      resume: {
        program: "codex",
        arguments: [
          "exec",
          "resume",
          "--model",
          "gpt-5.6-luna",
          "--config",
          'model_reasoning_effort="high"',
          "--ignore-user-config",
          "--ignore-rules",
          "-c",
          'approval_policy="on-request"',
          "-c",
          'approvals_reviewer="auto_review"',
          "-c",
          'sandbox_mode="workspace-write"',
          "-c",
          'sandbox_workspace_write.writable_roots=["/private/tmp/g1/home `touch nope`"]',
          "--json",
          "--disable",
          "apps",
          "--disable",
          "browser_use",
          "--disable",
          "browser_use_external",
          "--disable",
          "chronicle",
          "--disable",
          "computer_use",
          "--disable",
          "goals",
          "--disable",
          "hooks",
          "--disable",
          "image_generation",
          "--disable",
          "memories",
          "--disable",
          "plugin_sharing",
          "--disable",
          "plugins",
          "--disable",
          "skill_mcp_dependency_install",
          "--disable",
          "tool_suggest",
          "--disable",
          "workspace_dependencies",
          "-c",
          'skills.config=[{path="/Users/example/.codex/skills/operator-one/SKILL.md",enabled=false},{path="/Users/example/.codex/skills/operator-two/SKILL.md",enabled=false}]',
          "<session-id>",
        ],
        appendPromptAsFinalArgument: true,
      },
    });
  });

  test("pins the unavoidable global instruction and disables every operator skill", async () => {
    const parent = await mkdtemp("/tmp/bearing-g1-codex-context-");
    const codexHome = join(parent, "codex-home");
    const externalSkill = join(parent, "external-skill");
    await mkdir(join(codexHome, "skills/operator-one"), { recursive: true });
    await mkdir(externalSkill);
    await writeFile(join(codexHome, "AGENTS.md"), "Use Chinese.\n");
    await writeFile(join(codexHome, "skills/operator-one/SKILL.md"), "# Skill One\n");
    await writeFile(join(externalSkill, "SKILL.md"), "# Skill Two\n");
    await symlink(externalSkill, join(codexHome, "skills/operator-two"));
    await symlink(externalSkill, join(codexHome, "skills/operator-two-alias"));

    const context = await inspectCodexOperatorContext(codexHome);

    expect(context.globalInstructions).toEqual({
      locator: join(codexHome, "AGENTS.md"),
      sha256: "a3dcc9dd40627dc6cf32830c62ed2cb1cb9f07a88a92043a0722e2e2ea36f128",
    });
    expect(context.disabledSkills).toEqual([
      {
        locator: join(codexHome, "skills/operator-one/SKILL.md"),
        sha256: "a305ff986d19bfad5e180afde9f0b0c37894a786745aefe25efb609b95df427f",
      },
      {
        locator: join(codexHome, "skills/operator-two-alias/SKILL.md"),
        sha256: "a7532ede7f7d174f0440e23d31ee7e9fdd35496c485757064b745636ac4efee0",
      },
      {
        locator: join(codexHome, "skills/operator-two/SKILL.md"),
        sha256: "a7532ede7f7d174f0440e23d31ee7e9fdd35496c485757064b745636ac4efee0",
      },
    ]);
    expect(context.fingerprint).toMatch(/^[0-9a-f]{64}$/);
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

    expect(equal.exitCode).toBe(1);
    expect(equal.stderr).toContain("must be independent canonical paths");
    expect(aliased.exitCode).toBe(1);
    expect(aliased.stderr).toContain("must be independent canonical paths");
    expect(l3Collision.exitCode).toBe(1);
    expect(l3Collision.stderr).toContain("must be independent canonical paths");
    await expect(access(target)).rejects.toThrow();
    await expect(access(l3Root)).rejects.toThrow();
  });

  test("includes exact disposable Project Read Model bytes in repository digests", async () => {
    const parent = await mkdtemp("/tmp/bearing-g1-digests-");
    const first = join(parent, "first");
    const second = join(parent, "second");
    for (const [root, bytes] of [
      [first, "first read model\n"],
      [second, "second read model\n"],
    ] as const) {
      await mkdir(join(root, ".bearing/cache"), { recursive: true });
      await writeFile(join(root, "stable.md"), "# Stable fixture\n");
      await writeFile(join(root, ".bearing/cache/project-read-model.sqlite"), bytes);
    }

    const firstSnapshot = await finalizeFixtureSnapshot(first);
    const secondSnapshot = await finalizeFixtureSnapshot(second);

    expect(firstSnapshot).not.toEqual(secondSnapshot);
    await access(join(first, ".bearing/cache/project-read-model.sqlite"));
    await access(join(second, ".bearing/cache/project-read-model.sqlite"));
  });
});
