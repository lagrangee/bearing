import { describe, expect, test } from "bun:test";
import { access, chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  discardLiveScenarioGenerationAdmission,
  prepareLiveScenarioGenerationAdmission,
} from "../scripts/live-scenario-admission";
import {
  digestLiveScenarioFixtureSet,
  loadLiveScenarioRegistry,
} from "../scripts/live-scenario-registry";
import {
  liveScenarioDefinitionDigest,
  verifyLiveScenarioGeneration,
} from "../scripts/live-scenario-runner";
import { localRehearsalWorktreeDigest } from "../scripts/local-rehearsal-identity";
import { sha256File } from "../scripts/release-digest";

const registryPath = "tests/fixtures/live-scenario-admission-registry.json";
const prerequisiteRegistryPath =
  "tests/fixtures/live-scenario-admission-prerequisite-registry.json";
const generationId = "11111111-1111-4111-8111-111111111111";

const createFixture = async (
  mode: "admitted" | "model-unavailable" | "permission-failure" = "admitted",
  selectedRegistryPath = registryPath,
) => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "bearing-admission-test-")));
  const packageRoot = join(root, "package-root");
  const tarball = join(root, "bearing.tgz");
  const operatorCodexHome = join(root, "operator-codex-home");
  const workspaceRoot = join(root, "generation-workspace");
  const fakeCodex = join(root, "codex-fixture");
  const permissionProbeCapture = join(root, "permission-probe-arguments.txt");
  await Promise.all([
    mkdir(join(packageRoot, "package/docs"), { recursive: true }),
    mkdir(operatorCodexHome),
  ]);
  await Promise.all([
    writeFile(join(packageRoot, "package/docs/agent-installation.md"), "# Install\n"),
    writeFile(
      join(packageRoot, "package/package.json"),
      '{"name":"@lagrangee/bearing","version":"0.1.2-dev"}\n',
    ),
    writeFile(join(operatorCodexHome, "auth.json"), "{}\n"),
    writeFile(
      fakeCodex,
      `#!/bin/sh
if [ "$1" = "debug" ] && [ "$2" = "models" ]; then
  ${
    mode === "model-unavailable"
      ? `printf '%s\\n' '{"models":[]}'`
      : `printf '%s\\n' '{"models":[{"slug":"gpt-5.6-luna","supported_reasoning_levels":[{"effort":"high"}]}]}'`
  }
  exit 0
fi
if [ "$1" = "sandbox" ]; then
  printf '%s\\n' "$@" >> ${JSON.stringify(permissionProbeCapture)}
  ${mode === "permission-failure" ? "exit 17" : "exit 0"}
fi
exit 64
`,
    ),
  ]);
  await chmod(fakeCodex, 0o755);
  const packed = Bun.spawnSync(["tar", "-czf", tarball, "package"], {
    cwd: packageRoot,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (packed.exitCode !== 0) throw new Error(packed.stderr.toString());
  return {
    root,
    workspaceRoot,
    operatorCodexHome,
    fakeCodex,
    permissionProbeCapture,
    package: {
      evidenceClass: "local-rehearsal" as const,
      packageName: "@lagrangee/bearing" as const,
      packageVersion: "0.1.2-dev",
      sourceHead: "fixture-head",
      worktreeSha256: await localRehearsalWorktreeDigest(process.cwd()),
      artifact: {
        path: tarball,
        file: "bearing.tgz",
        sha256: await sha256File(tarball),
      },
      matrixDefinitionSha256: await liveScenarioDefinitionDigest({
        sourceRoot: process.cwd(),
        registryPath: selectedRegistryPath,
      }),
    },
  };
};

const prepare = async (
  mode: Parameters<typeof createFixture>[0] = "admitted",
  selectedRegistryPath = registryPath,
) => {
  const fixture = await createFixture(mode, selectedRegistryPath);
  const result = await prepareLiveScenarioGenerationAdmission({
    sourceRoot: process.cwd(),
    workspaceRoot: fixture.workspaceRoot,
    operatorCodexHome: fixture.operatorCodexHome,
    registryPath: selectedRegistryPath,
    generationId,
    package: fixture.package,
    codexProgram: fixture.fakeCodex,
  });
  return { fixture, result } as const;
};

describe("Live Matrix Generation preflight", () => {
  test("keeps tracked Scenario runtime composition finite", async () => {
    const tracked = await loadLiveScenarioRegistry("validation/live-journey/registry.json");
    expect(tracked.scenarios.length).toBeGreaterThan(0);
    expect(
      tracked.scenarios.every(
        ({ composition }) =>
          composition.model === "gpt-5.6-luna" &&
          composition.reasoningEffort === "high" &&
          composition.timeProfile === "standard",
      ),
    ).toBe(true);
  });

  test("prepares every selected Scenario and returns the sole Generation basis", async () => {
    const { fixture, result } = await prepare();
    expect(result).toMatchObject({
      outcome: "admitted",
      generationId,
      generationBasis: {
        schemaVersion: 1,
        generationId,
        staticPreflight: "complete",
        runtime: { model: "gpt-5.6-luna", reasoningEffort: "high", concurrency: 4 },
        selectedScenarioIds: ["TEST-01", "TEST-02"],
      },
      agentBehaviorStarted: false,
      activeGenerationCreated: false,
      externalEffectsObserved: false,
    });
    if (result.outcome !== "admitted") throw new Error("Expected admitted Generation.");
    expect(result.generationBasis.fixtureDefinitionSha256).toBe(
      await digestLiveScenarioFixtureSet({
        sourceRoot: process.cwd(),
        registry: await loadLiveScenarioRegistry(registryPath),
        scenarioIds: ["TEST-01", "TEST-02"],
      }),
    );
    expect(result.preparedScenarios).toHaveLength(2);
    expect(result.generationBasis.preparedScenarios).toHaveLength(2);
    const probedProfiles = (await readFile(fixture.permissionProbeCapture, "utf8"))
      .split("\n")
      .filter((argument) => argument.startsWith("permissions.bearing_live_journey="));
    const launchedProfiles = result.preparedScenarios
      .map(({ launch }) =>
        launch.initial.arguments.find((argument) =>
          argument.startsWith("permissions.bearing_live_journey="),
        ),
      )
      .filter((profile): profile is string => profile !== undefined);
    expect(launchedProfiles).toHaveLength(result.preparedScenarios.length);
    expect(probedProfiles).toEqual(launchedProfiles);
    for (const prepared of result.preparedScenarios) {
      expect(JSON.parse(await readFile(prepared.paths.manifest, "utf8"))).not.toHaveProperty(
        "admission",
      );
      await expect(verifyLiveScenarioGeneration(prepared.paths.manifest)).resolves.toBeDefined();
    }
    await discardLiveScenarioGenerationAdmission(result);
  });

  test("denies one shared runtime container without enumerating ambient roots", async () => {
    const runtimeContainer = join(await realpath(tmpdir()), "bearing-live-scenario-runtimes");
    await mkdir(runtimeContainer, { recursive: true });
    const ambientRoot = await mkdtemp(join(runtimeContainer, "ambient-"));
    try {
      const { result } = await prepare();
      if (result.outcome !== "admitted") throw new Error("Expected admitted Generation.");
      for (const prepared of result.preparedScenarios) {
        expect(prepared.paths.runtimeDenyRoots).toEqual([runtimeContainer]);
        expect(dirname(prepared.paths.runtimeRoot)).toBe(runtimeContainer);
        expect(prepared.launch.initial.arguments.join("\n")).toContain(runtimeContainer);
        expect(prepared.launch.initial.arguments.join("\n")).not.toContain(ambientRoot);
      }
      await discardLiveScenarioGenerationAdmission(result);
    } finally {
      await rm(ambientRoot, { recursive: true, force: true });
    }
  });

  test("rejects a malformed Codex item boundary without writing an execution handoff", async () => {
    const { fixture, result } = await prepare();
    if (result.outcome !== "admitted") throw new Error("Expected admitted Generation.");
    const generationPath = join(fixture.workspaceRoot, "generation.json");
    await writeFile(generationPath, `${JSON.stringify(result.generationBasis, null, 2)}\n`, {
      flag: "wx",
    });
    await writeFile(
      fixture.fakeCodex,
      `#!/bin/sh
if [ "$1" = "--version" ]; then
  printf '%s\n' 'codex-fixture 1'
  exit 0
fi
printf '%s\n' '{"type":"thread.started","thread_id":"11111111-1111-4111-8111-111111111111"}'
printf '%s\n' '{"type":"turn.started"}'
printf '%s\n' '{"type":"item.started","item":{"type":"command_execution"}}'
printf '%s\n' '{"type":"turn.completed"}'
exit 0
`,
    );

    try {
      const run = Bun.spawnSync(
        [
          process.execPath,
          "scripts/run-live-journey.ts",
          "run-generation",
          "--generation",
          generationPath,
        ],
        { cwd: process.cwd(), stdout: "pipe", stderr: "pipe" },
      );
      expect(run.exitCode).not.toBe(0);
      expect(run.stderr.toString()).toContain("Live Matrix Generation is invalid");
      await expect(access(join(fixture.workspaceRoot, "execution.json"))).rejects.toMatchObject({
        code: "ENOENT",
      });

      const scenarioOutput = join(fixture.root, "scenario-result.json");
      const evaluation = Bun.spawnSync(
        [
          process.execPath,
          "scripts/run-live-journey.ts",
          "evaluate-scenario",
          "--generation",
          generationPath,
          "--manifest",
          result.preparedScenarios[0]?.paths.manifest ?? "missing-manifest",
          "--verdicts",
          join(fixture.root, "missing-verdict.json"),
          "--output",
          scenarioOutput,
        ],
        { cwd: process.cwd(), stdout: "pipe", stderr: "pipe" },
      );
      expect(evaluation.exitCode).not.toBe(0);
      await expect(access(scenarioOutput)).rejects.toMatchObject({ code: "ENOENT" });

      const matrixOutput = join(fixture.root, "matrix-result.json");
      const completion = Bun.spawnSync(
        [
          process.execPath,
          "scripts/run-live-journey.ts",
          "complete-matrix",
          "--source-root",
          process.cwd(),
          "--registry",
          join(process.cwd(), registryPath),
          "--results",
          join(fixture.root, "missing-results"),
          "--generation",
          generationPath,
          "--output",
          matrixOutput,
        ],
        { cwd: process.cwd(), stdout: "pipe", stderr: "pipe" },
      );
      expect(completion.exitCode).not.toBe(0);
      await expect(access(matrixOutput)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await discardLiveScenarioGenerationAdmission(result);
    }
  });

  test("blocks an unavailable model before Scenario preparation and cleans the workspace", async () => {
    const { fixture, result } = await prepare("model-unavailable");
    expect(result).toMatchObject({
      outcome: "preflight blocked",
      diagnostics: [{ code: "model-unavailable" }],
      agentBehaviorStarted: false,
    });
    await expect(access(fixture.workspaceRoot)).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("blocks invalid registry and package inputs without creating a workspace", async () => {
    const fixture = await createFixture();
    for (const input of [
      {
        registryPath: "tests/fixtures/live-scenario-admission-invalid-registry.json",
        package: fixture.package,
        code: "invalid-registry",
      },
      { registryPath, package: {}, code: "invalid-package" },
    ] as const) {
      const workspaceRoot = join(fixture.root, `blocked-${input.code}`);
      const result = await prepareLiveScenarioGenerationAdmission({
        sourceRoot: process.cwd(),
        workspaceRoot,
        operatorCodexHome: fixture.operatorCodexHome,
        registryPath: input.registryPath,
        generationId,
        package: input.package,
        codexProgram: fixture.fakeCodex,
      });
      expect(result).toMatchObject({
        outcome: "preflight blocked",
        diagnostics: [{ code: input.code }],
      });
      await expect(access(workspaceRoot)).rejects.toMatchObject({ code: "ENOENT" });
    }
  });

  test("requires the explicit prerequisite root and every declared Skill before preparation", async () => {
    const fixture = await createFixture("admitted", prerequisiteRegistryPath);
    const missingRoot = await prepareLiveScenarioGenerationAdmission({
      sourceRoot: process.cwd(),
      workspaceRoot: fixture.workspaceRoot,
      operatorCodexHome: fixture.operatorCodexHome,
      registryPath: prerequisiteRegistryPath,
      scenarioIds: ["TEST-SKILL-01"],
      generationId,
      package: fixture.package,
      codexProgram: fixture.fakeCodex,
    });
    expect(missingRoot).toMatchObject({
      outcome: "preflight blocked",
      diagnostics: [{ code: "prerequisite-skill-unavailable", scenarioId: "TEST-SKILL-01" }],
    });

    const emptySkillRoot = join(fixture.root, "empty-skills");
    await mkdir(emptySkillRoot);
    const missingSkill = await prepareLiveScenarioGenerationAdmission({
      sourceRoot: process.cwd(),
      workspaceRoot: join(fixture.root, "missing-skill-workspace"),
      operatorCodexHome: fixture.operatorCodexHome,
      registryPath: prerequisiteRegistryPath,
      scenarioIds: ["TEST-SKILL-01"],
      generationId,
      package: fixture.package,
      prerequisiteSkillRoot: emptySkillRoot,
      codexProgram: fixture.fakeCodex,
    });
    expect(missingSkill).toMatchObject({
      outcome: "preflight blocked",
      diagnostics: [{ code: "prerequisite-skill-unavailable", scenarioId: "TEST-SKILL-01" }],
    });
  });

  test("cleans all prepared runtimes when a permission probe fails", async () => {
    const { fixture, result } = await prepare("permission-failure");
    expect(result).toMatchObject({
      outcome: "preflight blocked",
      diagnostics: [{ code: "permission-failure", scenarioId: "TEST-01" }],
      activeGenerationCreated: false,
    });
    await expect(access(fixture.workspaceRoot)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(access(join(fixture.workspaceRoot, "generation.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  test("blocks a missing GitHub capability before workspace creation", async () => {
    const githubRegistry = "tests/fixtures/live-scenario-admission-github-registry.json";
    const { fixture, result } = await prepare("admitted", githubRegistry);
    expect(result).toMatchObject({
      outcome: "preflight blocked",
      diagnostics: [{ code: "capability-unavailable", scenarioId: "TEST-03" }],
    });
    await expect(access(fixture.workspaceRoot)).rejects.toMatchObject({ code: "ENOENT" });
    await rm(fixture.root, { recursive: true, force: true });
  });
});
