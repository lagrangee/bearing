import { describe, expect, test } from "bun:test";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  realpath,
  symlink,
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
  inspectCodexE2EToolchain,
  prepareCodexE2EShellEnvironment,
  prepareIsolatedCodexHome,
  readCodexE2EModelAvailability,
  redactCodexE2EEphemeralCapabilities,
} from "../scripts/codex-e2e-runtime";

const fixtureToolchain = Object.freeze({
  nodeExecutable: "/opt/node/bin/node",
  nodeBin: "/opt/node/bin",
  nodeInstallRoot: "/opt/node",
  openSslConfig: "/System/Library/OpenSSL/openssl.cnf",
  selectedDeveloperDirectory: "/Library/Developer/CommandLineTools",
  gitExecutable: "/Library/Developer/CommandLineTools/usr/bin/git",
  path: "/opt/node/bin:/Library/Developer/CommandLineTools/usr/bin:/usr/bin:/bin:/usr/sbin:/sbin",
});

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
  test("keeps one fixed runtime owner and rejects caller overrides", async () => {
    expect(CODEX_E2E_RUNTIME).toEqual({
      model: "gpt-5.6-luna",
      reasoningEffort: "high",
      fastMode: true,
    });
    expect(codexE2ERuntimeArguments()).toEqual([
      "--model",
      "gpt-5.6-luna",
      "--config",
      'model_reasoning_effort="high"',
      "--enable",
      "fast_mode",
    ]);
    expect(() => codexE2ERuntimeArguments({ model: "fallback" })).toThrow(
      "does not accept runtime overrides",
    );
    const runtimeRoot = await realpath(await mkdtemp(join(tmpdir(), "bearing-e2e-runtime-")));
    const runtimeTempDirectory = join(runtimeRoot, "tmp");
    const boundedNpmControlRoot = join(runtimeRoot, "bounded-update-capability");
    await Promise.all([mkdir(runtimeTempDirectory), mkdir(boundedNpmControlRoot)]);
    const launch = codexE2ELaunchContract({
      repositoryRoot: "/tmp/repository",
      isolatedHome: "/tmp/agent-home",
      codexHome: "/tmp/agent-home/.codex",
      runtimeTempDirectory,
      toolchain: fixtureToolchain,
      disabledOperatorSkillPaths: [],
      boundedNpmControlRoot,
      readDeniedPaths: ["/tmp/source", "/tmp/source/validation/live-journey/registry.json"],
      writeAllowedPaths: [],
    });
    expect(launch.environment).toMatchObject({
      DEVELOPER_DIR: fixtureToolchain.selectedDeveloperDirectory,
      npm_config_script_shell: "/bin/bash",
    });
    for (const step of [launch.initial, launch.resume]) {
      expect(step.arguments).toContain('default_permissions="bearing_live_journey"');
      expect(step.arguments).toContain(
        `permissions.bearing_live_journey={workspace_roots={"/tmp/repository"=true,"/tmp/agent-home"=true},filesystem={":minimal"="read",":workspace_roots"="write","/tmp/repository/.git"="write",${JSON.stringify(runtimeTempDirectory)}="write","/opt/node"="read","/System/Library/OpenSSL/openssl.cnf"="read","/Library/Developer/CommandLineTools"="read",${JSON.stringify(boundedNpmControlRoot)}="read","/tmp/source"="deny","/tmp/source/validation/live-journey/registry.json"="deny","/tmp/agent-home/.codex/auth.json"="deny"},network={enabled=false}}`,
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
      runtimeTempDirectory: "/tmp/runtime/tmp",
      toolchain: fixtureToolchain,
      disabledOperatorSkillPaths: [],
      readDeniedPaths: ["/tmp/source", "/tmp/source/validation/live-journey/registry.json"],
      writeAllowedPaths: [],
      skipGitRepositoryCheck: true,
    });
    expect(nonProjectLaunch.initial.arguments).toContain("--skip-git-repo-check");
    expect(nonProjectLaunch.initial.arguments.join("\n")).not.toContain(boundedNpmControlRoot);
    const symlinkRuntimeRoot = await realpath(
      await mkdtemp(join(tmpdir(), "bearing-read-symlink-")),
    );
    const symlinkRuntimeTemp = join(symlinkRuntimeRoot, "tmp");
    const symlinkControlRoot = join(symlinkRuntimeRoot, "bounded-update-capability");
    await mkdir(symlinkRuntimeTemp);
    await symlink(boundedNpmControlRoot, symlinkControlRoot);
    expect(() =>
      codexE2ELaunchContract({
        repositoryRoot: "/tmp/repository",
        isolatedHome: "/tmp/agent-home",
        codexHome: "relative-codex-home",
        runtimeTempDirectory: "/tmp/runtime/tmp",
        toolchain: fixtureToolchain,
        disabledOperatorSkillPaths: [],
        readDeniedPaths: ["/tmp/source"],
        writeAllowedPaths: [],
      }),
    ).toThrow("permission paths must be non-empty absolute paths");
    expect(() =>
      codexE2ELaunchContract({
        repositoryRoot: "/tmp/repository",
        isolatedHome: "/tmp/agent-home",
        codexHome: "/tmp/agent-home/.codex",
        runtimeTempDirectory: symlinkRuntimeTemp,
        toolchain: fixtureToolchain,
        disabledOperatorSkillPaths: [],
        boundedNpmControlRoot: symlinkControlRoot,
        readDeniedPaths: ["/tmp/source"],
        writeAllowedPaths: [],
      }),
    ).toThrow("bounded npm control root must be the canonical runtime directory");
    expect(() =>
      codexE2ELaunchContract({
        repositoryRoot: "/tmp/repository",
        isolatedHome: "/tmp/agent-home",
        codexHome: "/tmp/agent-home/.codex",
        runtimeTempDirectory: symlinkRuntimeTemp,
        toolchain: fixtureToolchain,
        disabledOperatorSkillPaths: [],
        boundedNpmControlRoot,
        readDeniedPaths: ["/tmp/source"],
        writeAllowedPaths: [],
      }),
    ).toThrow("bounded npm control root must be the canonical runtime directory");
  });

  test("binds one canonical Node and minimal Darwin runtime dependency", async () => {
    if (process.platform !== "darwin") return;
    const toolchain = await inspectCodexE2EToolchain();
    expect(toolchain.nodeExecutable).toBe(await realpath(Bun.which("node") ?? "node"));
    expect(toolchain.nodeExecutable).toBe(join(toolchain.nodeInstallRoot, "bin", "node"));
    expect(toolchain.path.split(":")[0]).toBe(toolchain.nodeBin);
    expect(toolchain.path.split(":")[1]).toBe("/Library/Developer/CommandLineTools/usr/bin");
    expect(toolchain.openSslConfig).toBe("/System/Library/OpenSSL/openssl.cnf");
    const xcodeSelect = Bun.spawnSync(["/usr/bin/xcode-select", "-p"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(xcodeSelect.exitCode).toBe(0);
    expect(toolchain.selectedDeveloperDirectory).toBe(
      await realpath(xcodeSelect.stdout.toString().trim()),
    );
    expect(toolchain.gitExecutable).toBe(join(toolchain.selectedDeveloperDirectory, "usr/bin/git"));
    const git = Bun.spawnSync(["/usr/bin/git", "--version"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(git.exitCode).toBe(0);
    expect(git.stdout.toString()).toStartWith("git version ");
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
    const canonicalPath = "/opt/node/bin:/opt/developer/usr/bin:/usr/bin:/bin";
    await prepareCodexE2EShellEnvironment({ isolatedHome, path: canonicalPath });

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
    expect(await readFile(join(isolatedHome, ".shell/.zprofile"), "utf8")).toBe(
      `export PATH=${JSON.stringify(canonicalPath)}\n`,
    );
    await expect(
      assertIsolatedCodexHomeControlLinks(isolatedHome, canonicalPath),
    ).resolves.toBeUndefined();
    await expect(readFile(join(agentCodexHome, "config.toml"), "utf8")).rejects.toThrow();
  });

  test("rejects the operator configuration path in Journey output", () => {
    expect(() =>
      assertCodexE2EOutputIsolation({
        stdout: "HOME=/private/tmp/agent-home\nCODEX_HOME=/private/tmp/agent-home/.codex\n",
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
    expect(() =>
      assertCodexE2EOutputIsolation({
        stdout: "broker=ephemeral-auth\n",
        stderr: "",
        operatorCodexHome: "/Users/operator/.codex",
        ephemeralCapabilityValues: ["ephemeral-auth"],
      }),
    ).toThrow("ephemeral capability value");
    const redacted = redactCodexE2EEphemeralCapabilities(
      "socket=/private/tmp/broker.sock auth=ephemeral-auth auth=ephemeral-auth",
      ["/private/tmp/broker.sock", "ephemeral-auth", "ephemeral-auth", ""],
    );
    expect(redacted).toBe(
      "socket=<ephemeral-capability-redacted> auth=<ephemeral-capability-redacted> auth=<ephemeral-capability-redacted>",
    );
    expect(() =>
      assertCodexE2EOutputIsolation({
        stdout: redacted,
        stderr: "",
        operatorCodexHome: "/Users/operator/.codex",
        ephemeralCapabilityValues: ["/private/tmp/broker.sock", "ephemeral-auth"],
      }),
    ).not.toThrow();
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
        requestedFastMode: true,
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

  test("documents the repository-wide adaptive Matrix boundary", async () => {
    const policy = await readFile("docs/agents/codex-e2e.md", "utf8");
    expect(policy).toContain("Every Scenario launches Codex explicitly with:");
    expect(policy).toContain("model `gpt-5.6-luna`");
    expect(policy).toContain("reasoning effort `high`");
    expect(policy).toContain("Do not inherit these values from operator configuration");
    expect(policy).toContain(
      "Every Scenario receives a fresh repository, Agent home, runtime home",
    );
    expect(policy).toContain("The current top-level Codex is the sole Human Orchestrator");
    expect(policy).toContain("At most four Scenarios may be active");
    expect(policy).toContain("resume only the same conversation before a semantic result exists");
    expect(policy).toMatch(
      /short-lived broker for the configured private validation\s+repository/u,
    );
    expect(policy).toContain("Durable evidence has three levels:");
    expect(policy).toContain("one `generation.json` basis");
    expect(policy).toContain("one result per Scenario");
    expect(policy).toContain(
      "one Matrix result citing the exact Generation and Scenario result set",
    );
    expect(policy).toContain("There is no fixed-Turn runner");
    expect(policy).toContain("A semantic result cannot be restarted, retried, or resampled");
    expect(policy).toContain(
      "Matrix output has no deterministic relationship to Candidate readiness",
    );
  });
});
