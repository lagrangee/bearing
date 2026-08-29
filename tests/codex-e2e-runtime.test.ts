import { describe, expect, test } from "bun:test";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  realpath,
  writeFile,
} from "node:fs/promises";
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
  readCodexE2EModelAvailability,
} from "../scripts/codex-e2e-runtime";

const fakeModelProgram = async (input: {
  root: string;
  stdout: string;
  stderr?: string;
  exitCode?: number;
}) => {
  const program = join(input.root, "fake-codex");
  const capture = join(input.root, "probe.json");
  const stdoutPath = `${program}.stdout`;
  const stderrPath = `${program}.stderr`;
  await writeFile(stdoutPath, input.stdout);
  if (input.stderr !== undefined) await writeFile(stderrPath, input.stderr);
  await writeFile(
    program,
    [
      "#!/bin/sh",
      'stdin_bytes=$(wc -c | tr -d " \\n")',
      `printf '%s\\n' "$(printf '%s\\n' "$@")" > ${JSON.stringify(`${capture}.args`)}`,
      `printf '%s\\n' "$HOME" > ${JSON.stringify(`${capture}.home`)}`,
      `printf '%s\\n' "$CODEX_HOME" > ${JSON.stringify(`${capture}.codex-home`)}`,
      `printf '%s\\n' "$stdin_bytes" > ${JSON.stringify(`${capture}.stdin`)}`,
      `/bin/cat ${JSON.stringify(stdoutPath)}`,
      ...(input.stderr === undefined ? [] : [`/bin/cat ${JSON.stringify(stderrPath)} >&2`]),
      `exit ${input.exitCode ?? 0}`,
      "",
    ].join("\n"),
  );
  await chmod(program, 0o755);
  return { program, capture };
};

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
      writeAllowedPaths: [],
    });
    for (const step of [launch.initial, launch.resume]) {
      expect(step.arguments).toContain('default_permissions="bearing_live_journey"');
      expect(step.arguments).toContain(
        'permissions.bearing_live_journey={workspace_roots={"/tmp/repository"=true,"/tmp/agent-home"=true},filesystem={":root"="read",":workspace_roots"="write","/tmp/repository/.git"="write","/tmp/source"="deny","/tmp/source/validation/live-journey/registry.json"="deny","/tmp/agent-home/.codex/auth.json"="deny"},network={enabled=false}}',
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
      writeAllowedPaths: [],
      skipGitRepositoryCheck: true,
    });
    expect(nonProjectLaunch.initial.arguments).toContain("--skip-git-repo-check");
    expect(() =>
      codexE2ELaunchContract({
        repositoryRoot: "/tmp/repository",
        isolatedHome: "/tmp/agent-home",
        codexHome: "relative-codex-home",
        disabledOperatorSkillPaths: [],
        readDeniedPaths: ["/tmp/source"],
        writeAllowedPaths: [],
      }),
    ).toThrow("permission paths must be non-empty absolute paths");
  });

  test("reads exact model availability without starting Agent behavior", async () => {
    const root = await mkdtemp(join(tmpdir(), "bearing-codex-model-probe-"));
    const isolatedHome = join(root, "isolated-home");
    const codexHome = join(isolatedHome, ".codex");
    const stdout = `${JSON.stringify({
      models: [
        {
          slug: CODEX_E2E_RUNTIME.model,
          supported_reasoning_levels: [
            { effort: "medium", description: "Medium" },
            { effort: CODEX_E2E_RUNTIME.reasoningEffort, description: "High" },
          ],
          display_name: "Fixture model",
        },
      ],
    })}\n`;
    const fake = await fakeModelProgram({ root, stdout });

    const receipt = await readCodexE2EModelAvailability({
      program: fake.program,
      isolatedHome,
      codexHome,
    });

    expect(receipt).toEqual({
      catalogIdentitySha256: new Bun.CryptoHasher("sha256").update(stdout).digest("hex"),
      model: CODEX_E2E_RUNTIME.model,
      reasoningEffort: CODEX_E2E_RUNTIME.reasoningEffort,
    });
    expect(await readFile(`${fake.capture}.args`, "utf8")).toBe("debug\nmodels\n");
    expect(await readFile(`${fake.capture}.home`, "utf8")).toBe(`${isolatedHome}\n`);
    expect(await readFile(`${fake.capture}.codex-home`, "utf8")).toBe(`${codexHome}\n`);
    expect(await readFile(`${fake.capture}.stdin`, "utf8")).toBe("0\n");
  });

  test("fails closed when the model or exact reasoning effort is unavailable", async () => {
    const root = await mkdtemp(join(tmpdir(), "bearing-codex-model-unavailable-"));
    const unavailableModel = await fakeModelProgram({
      root,
      stdout: JSON.stringify({
        models: [{ slug: "another-model", supported_reasoning_levels: [{ effort: "high" }] }],
      }),
    });
    await expect(
      readCodexE2EModelAvailability({
        program: unavailableModel.program,
        isolatedHome: root,
        codexHome: join(root, ".codex"),
      }),
    ).rejects.toThrow(`model is unavailable: ${CODEX_E2E_RUNTIME.model}`);

    const effortRoot = await mkdtemp(join(tmpdir(), "bearing-codex-effort-unavailable-"));
    const unavailableEffort = await fakeModelProgram({
      root: effortRoot,
      stdout: JSON.stringify({
        models: [
          {
            slug: CODEX_E2E_RUNTIME.model,
            supported_reasoning_levels: [{ effort: "medium" }],
          },
        ],
      }),
    });
    await expect(
      readCodexE2EModelAvailability({
        program: unavailableEffort.program,
        isolatedHome: effortRoot,
        codexHome: join(effortRoot, ".codex"),
      }),
    ).rejects.toThrow(`reasoning effort is unavailable: ${CODEX_E2E_RUNTIME.reasoningEffort}`);
  });

  test("fails closed for malformed model catalogs and failed commands", async () => {
    const root = await mkdtemp(join(tmpdir(), "bearing-codex-model-invalid-"));
    const malformed = await fakeModelProgram({ root, stdout: "not-json\n" });
    await expect(
      readCodexE2EModelAvailability({
        program: malformed.program,
        isolatedHome: root,
        codexHome: join(root, ".codex"),
      }),
    ).rejects.toThrow("untrusted model catalog");

    const commandRoot = await mkdtemp(join(tmpdir(), "bearing-codex-model-command-"));
    const failed = await fakeModelProgram({
      root: commandRoot,
      stdout: JSON.stringify({ models: [] }),
      stderr: "catalog lookup failed\n",
      exitCode: 17,
    });
    await expect(
      readCodexE2EModelAvailability({
        program: failed.program,
        isolatedHome: commandRoot,
        codexHome: join(commandRoot, ".codex"),
      }),
    ).rejects.toThrow("failed with exit 17");
  });

  test("copies authentication into launcher-owned runtime state without exposing the operator locator", async () => {
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
    expect((await lstat(join(agentCodexHome, "auth.json"))).isFile()).toBe(true);
    expect((await lstat(join(agentCodexHome, "auth.json"))).mode & 0o777).toBe(0o400);
    expect(await realpath(join(agentCodexHome, "auth.json"))).not.toBe(await realpath(authSource));
    await expect(readlink(join(agentCodexHome, "auth.json"))).rejects.toThrow();
    expect(await readFile(join(agentCodexHome, "auth.json"), "utf8")).toBe("{}\n");
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
