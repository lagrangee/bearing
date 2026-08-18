import { describe, expect, test } from "bun:test";
import { lstat, mkdir, mkdtemp, readFile, readlink, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertCodexE2EOutputIsolation,
  assertIsolatedCodexHomeControlLinks,
  CODEX_E2E_RUNTIME,
  codexE2ELaunchContract,
  codexE2ERuntimeArguments,
  createCodexE2EEvidenceRecord,
  prepareIsolatedCodexHome,
} from "../scripts/codex-e2e-runtime";

describe("repository Codex E2E policy", () => {
  test("keeps one fixed runtime owner and rejects caller overrides", () => {
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
    expect(() => codexE2ERuntimeArguments({ model: "fallback" })).toThrow(
      "does not accept runtime overrides",
    );
    const launch = codexE2ELaunchContract({
      repositoryRoot: "/tmp/repository",
      isolatedHome: "/tmp/agent-home",
      codexHome: "/tmp/agent-home/.codex",
      disabledOperatorSkillPaths: [],
      readDeniedPaths: ["/tmp/source", "/tmp/source/validation/live-journey/registry.json"],
    });
    for (const step of [launch.initial, launch.resume]) {
      expect(step.arguments).toContain('default_permissions="bearing_live_journey"');
      expect(step.arguments).toContain(
        'permissions.bearing_live_journey={workspace_roots={"/tmp/repository"=true,"/tmp/agent-home"=true},filesystem={":root"="read",":workspace_roots"="write","/tmp/repository/.git"="write","/tmp/source"="deny","/tmp/source/validation/live-journey/registry.json"="deny"},network={enabled=false}}',
      );
      expect(step.arguments).not.toContain("--sandbox");
      expect(step.arguments).not.toContain('sandbox_mode="workspace-write"');
      expect(step.arguments).not.toContain("sandbox_workspace_write.network_access=false");
    }
    expect(launch.initial.arguments).toContain("--strict-config");
    expect(launch.resume.arguments).toContain("--strict-config");
    expect(launch.initial.arguments).not.toContain('network_access="enabled"');
    expect(launch.resume.arguments).not.toContain('network_access="enabled"');
    expect(launch.initial.arguments).not.toContain("--skip-git-repo-check");
    const nonProjectLaunch = codexE2ELaunchContract({
      repositoryRoot: "/tmp/non-project",
      isolatedHome: "/tmp/agent-home",
      codexHome: "/tmp/agent-home/.codex",
      disabledOperatorSkillPaths: [],
      readDeniedPaths: ["/tmp/source", "/tmp/source/validation/live-journey/registry.json"],
      skipGitRepositoryCheck: true,
    });
    expect(nonProjectLaunch.initial.arguments).toContain("--skip-git-repo-check");
  });

  test("uses only isolated runtime state plus one read-only authentication link", async () => {
    const root = await mkdtemp(join(tmpdir(), "bearing-isolated-codex-home-"));
    const operatorCodexHome = join(root, "operator-codex-home");
    const isolatedHome = join(root, "agent-home");
    await Promise.all([mkdir(operatorCodexHome), mkdir(isolatedHome)]);
    const authSource = join(operatorCodexHome, "auth.json");
    await writeFile(authSource, "{}\n");

    const agentCodexHome = await prepareIsolatedCodexHome({
      operatorCodexHome,
      isolatedHome,
    });

    expect(agentCodexHome).toBe(await realpath(join(isolatedHome, ".codex")));
    expect((await lstat(join(agentCodexHome, "auth.json"))).isSymbolicLink()).toBe(true);
    expect(await readlink(join(agentCodexHome, "auth.json"))).toBe("../.runtime-auth/auth.json");
    expect(await realpath(join(agentCodexHome, "auth.json"))).toBe(await realpath(authSource));
    expect((await lstat(join(agentCodexHome, "skills"))).isSymbolicLink()).toBe(true);
    expect(await realpath(join(agentCodexHome, "skills"))).toBe(
      await realpath(join(isolatedHome, "skill-directory")),
    );
    expect((await lstat(join(isolatedHome, ".shell"))).isDirectory()).toBe(true);
    await expect(assertIsolatedCodexHomeControlLinks(isolatedHome)).resolves.toBeUndefined();
    await expect(readFile(join(agentCodexHome, "config.toml"), "utf8")).rejects.toThrow();
  });

  test("rejects the operator configuration path in Journey output", () => {
    expect(() =>
      assertCodexE2EOutputIsolation({
        stdout: "HOME=/private/tmp/agent-home\n",
        stderr: "",
        operatorCodexHome: "/Users/operator/.codex",
      }),
    ).not.toThrow();
    expect(() =>
      assertCodexE2EOutputIsolation({
        stdout: "lrwx auth.json -> /Users/operator/.codex/auth.json\n",
        stderr: "",
        operatorCodexHome: "/Users/operator/.codex",
      }),
    ).toThrow("operator configuration path");
  });

  test("records only the required exact-candidate and runtime evidence", () => {
    expect(
      createCodexE2EEvidenceRecord({
        sourceCommit: "a".repeat(40),
        packageFile: "lagrangee-bearing-0.1.1.tgz",
        packageSha256: "b".repeat(64),
        codexCliVersion: "codex-cli 1.2.3",
        invocationStarted: true,
        terminalBoundary: "completed:orientation-declined",
      }),
    ).toEqual({
      candidate: {
        sourceCommit: "a".repeat(40),
        packageFile: "lagrangee-bearing-0.1.1.tgz",
        packageSha256: "b".repeat(64),
      },
      codex: {
        cliVersion: "codex-cli 1.2.3",
        requestedModel: "gpt-5.6-luna",
        requestedReasoningEffort: "high",
        invocationStarted: true,
        terminalBoundary: "completed:orientation-declined",
      },
    });
    expect(() =>
      createCodexE2EEvidenceRecord({
        sourceCommit: "HEAD",
        packageFile: "candidate.tgz",
        packageSha256: "b".repeat(64),
        codexCliVersion: "codex-cli 1.2.3",
        invocationStarted: false,
        terminalBoundary: "blocked:model-unavailable",
      }),
    ).toThrow("full lowercase commit");
  });

  test("documents the repository-wide fail-closed Scenario boundary", async () => {
    const policy = await readFile("docs/agents/codex-e2e.md", "utf8");
    expect(policy).toContain("Every Codex E2E Scenario must run with:");
    expect(policy).toContain("Model: `gpt-5.6-luna`");
    expect(policy).toContain("Reasoning effort: `high`");
    expect(policy).toContain("Do not use another model as a fallback");
    expect(policy).toContain("denies direct sandbox network access");
    expect(policy).toMatch(/bounded\s+runner-owned capability/u);
    expect(policy).toContain("authenticated messages over one fixed");
    expect(policy).toContain("socket collision is a harness failure");
    expect(policy).toContain("Unix-domain socket");
    expect(policy).toContain("resumed, retried, negative, reproduction, and release launch");
    expect(policy).toContain("Historical reports remain historical");
  });
});
