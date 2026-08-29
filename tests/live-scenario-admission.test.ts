import { describe, expect, test } from "bun:test";
import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  discardLiveScenarioGenerationAdmission,
  prepareLiveScenarioGenerationAdmission,
  validateLiveScenarioAdmissionReadbacks,
} from "../scripts/live-scenario-admission";
import {
  loadLiveScenarioRegistry,
  parseLiveScenarioRegistry,
} from "../scripts/live-scenario-registry";
import { liveScenarioDefinitionDigest } from "../scripts/live-scenario-runner";
import { localRehearsalWorktreeDigest } from "../scripts/local-rehearsal-identity";
import { sha256File } from "../scripts/release-digest";

const registryPath = "tests/fixtures/live-scenario-admission-registry.json";
const generationId = "11111111-1111-4111-8111-111111111111";
const digest = (value: string): string => value.repeat(64);

const contractIdentities = {
  packageIdentitySha256: digest("1"),
  matrixDefinitionSha256: digest("2"),
  harnessIdentitySha256: digest("3"),
  fixtureDefinitionsSha256: digest("4"),
  matrixSkillSetSha256: digest("5"),
  agentSurfaceAdaptersSha256: digest("6"),
  capabilityAdaptersSha256: digest("7"),
  resourceDefinitionsSha256: digest("8"),
  executionConfigurationSha256: digest("9"),
} as const;

const contractReadback = (
  scenario: Awaited<ReturnType<typeof loadLiveScenarioRegistry>>["scenarios"][number],
) => ({
  schemaVersion: 1,
  generationId,
  scenarioId: scenario.id,
  fixture: {
    profile: scenario.composition.fixtureProfile,
    definitionsIdentitySha256: contractIdentities.fixtureDefinitionsSha256,
    materializationIdentitySha256: digest("a"),
    startingStateSha256: digest("b"),
  },
  skillTopology: {
    skillSetIdentitySha256: contractIdentities.matrixSkillSetSha256,
    observed: scenario.composition.skills.map(({ skill, role }) => ({
      skill,
      role,
      state: role === "prerequisite" ? ("available" as const) : ("absent" as const),
      ...(role === "prerequisite"
        ? { contentIdentitySha256: digest("c"), entrypointIdentitySha256: digest("d") }
        : {}),
    })),
  },
  agentSurface: {
    profile: scenario.composition.agentSurfaceProfile,
    adaptersIdentitySha256: contractIdentities.agentSurfaceAdaptersSha256,
    agentHomeIdentitySha256: digest(scenario.id === "TEST-01" ? "e" : "f"),
  },
  capability: {
    profile: scenario.composition.capabilityProfile,
    adaptersIdentitySha256: contractIdentities.capabilityAdaptersSha256,
    resourceDefinitionsIdentitySha256: contractIdentities.resourceDefinitionsSha256,
    resourceKeys: [...scenario.composition.resourceKeys],
    available: true,
  },
  execution: {
    model: scenario.composition.model,
    reasoningEffort: scenario.composition.reasoningEffort,
    timeProfile: scenario.composition.timeProfile,
    configurationIdentitySha256: contractIdentities.executionConfigurationSha256,
    modelAvailable: true,
  },
  isolation: {
    stateIdentitySha256: digest(scenario.id === "TEST-01" ? "0" : "a"),
    freshAgentHome: true,
    coordinatorControlDenied: true,
    siblingRuntimesDenied: true,
    generalNetworkDenied: true,
  },
  priorState: { session: false, transcript: false, agentDecision: false, result: false },
});

const createFixture = async (
  mode:
    | "admitted"
    | "model-unavailable"
    | "permission-failure"
    | "stale-fixture"
    | "ambient-skill" = "admitted",
  selectedRegistryPath = registryPath,
) => {
  const root = await mkdtemp(join(tmpdir(), "bearing-admission-test-"));
  const packageRoot = join(root, "package-root");
  const tarball = join(root, "bearing.tgz");
  const operatorCodexHome = join(root, "operator-codex-home");
  const workspaceRoot = join(root, "generation-workspace");
  const generationRoot = join(root, "generation-records");
  const fakeCodex = join(root, "codex-fixture");
  const permissionProfilesCaptureRoot = join(root, "permission-profiles");
  await Promise.all([
    mkdir(join(packageRoot, "package/docs"), { recursive: true }),
    mkdir(operatorCodexHome),
    mkdir(permissionProfilesCaptureRoot),
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
  printf '%s\n' "$4" > ${JSON.stringify(permissionProfilesCaptureRoot)}/"$$"
  ${mode === "permission-failure" ? "exit 17" : ":"}
  ${mode === "stale-fixture" ? `touch "$PWD/admission-drift.txt"` : ":"}
  ${
    mode === "ambient-skill"
      ? `mkdir -p "$HOME/skill-directory/wayfinder"; printf '# Ambient\\n' > "$HOME/skill-directory/wayfinder/SKILL.md"`
      : ":"
  }
  exit 0
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
  const matrixDefinitionSha256 = await liveScenarioDefinitionDigest({
    sourceRoot: process.cwd(),
    registryPath: selectedRegistryPath,
  });
  return {
    root,
    workspaceRoot,
    generationRoot,
    operatorCodexHome,
    permissionProfilesCaptureRoot,
    fakeCodex,
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
      matrixDefinitionSha256,
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
    generationEvidenceRoot: fixture.generationRoot,
    codexProgram: fixture.fakeCodex,
  });
  return { fixture, result } as const;
};

describe("Live Matrix declarative Generation Admission", () => {
  test("requires finite Composition for every tracked Scenario", async () => {
    const tracked = await loadLiveScenarioRegistry("validation/live-journey/registry.json");
    expect(tracked.scenarios).toHaveLength(25);
    expect(
      tracked.scenarios.every(
        ({ composition }) =>
          composition.model === "gpt-5.6-luna" &&
          composition.reasoningEffort === "high" &&
          composition.timeProfile === "standard" &&
          composition.agentSurfaceProfile === "codex",
      ),
    ).toBe(true);
    const scenario = tracked.scenarios[0];
    if (scenario === undefined) throw new Error("Tracked Scenario is unavailable.");
    expect(() =>
      parseLiveScenarioRegistry({
        schemaVersion: 1,
        scenarios: [{ ...scenario, composition: { ...scenario.composition, setup: "hook.sh" } }],
      }),
    ).toThrow();
  });

  test("fails closed for unknown profile, missing identity, stale readback, undeclared resource, and invalid reusable Basis", async () => {
    const registry = await loadLiveScenarioRegistry(registryPath);
    const readbacks = registry.scenarios.map(contractReadback);
    const validate = (overrides: Readonly<Record<string, unknown>> = {}) =>
      validateLiveScenarioAdmissionReadbacks({
        generationId,
        registry,
        identities: contractIdentities,
        compositionReadbacks: readbacks,
        ...overrides,
      });
    const codes = (result: ReturnType<typeof validateLiveScenarioAdmissionReadbacks>) => {
      if (result.outcome !== "preflight blocked") throw new Error("Expected preflight block.");
      return result.diagnostics.map(({ code }) => code);
    };

    const unknownProfile = validate({
      registry: {
        ...registry,
        scenarios: [
          {
            ...registry.scenarios[0],
            composition: {
              ...registry.scenarios[0]?.composition,
              fixtureProfile: "unknown-profile",
            },
          },
        ],
      },
    });
    expect(codes(unknownProfile)).toContain("invalid-registry");

    const { harnessIdentitySha256: _missing, ...missingIdentity } = contractIdentities;
    expect(codes(validate({ identities: missingIdentity }))).toContain("missing-identity");

    const stale = {
      ...readbacks[0],
      generationId: "22222222-2222-4222-8222-222222222222",
    };
    expect(codes(validate({ compositionReadbacks: [stale, readbacks[1]] }))).toContain(
      "stale-readback",
    );

    const undeclared = {
      ...readbacks[0],
      capability: {
        ...readbacks[0]?.capability,
        resourceKeys: ["github-validation-repository"],
      },
    };
    expect(codes(validate({ compositionReadbacks: [undeclared, readbacks[1]] }))).toContain(
      "undeclared-resource",
    );

    const admitted = validate();
    if (admitted.outcome !== "admitted") throw new Error("Expected valid contract Admission.");
    expect(
      codes(
        validate({
          reusableBasis: { ...admitted.basis, identitySha256: digest("f") },
        }),
      ),
    ).toContain("invalid-reusable-basis");
  });

  test("materializes and admits every registered Scenario before creating a Generation record", async () => {
    const { fixture, result } = await prepare();
    expect(result).toMatchObject({
      outcome: "admitted",
      generationId,
      basisVerification: "fresh",
      agentBehaviorStarted: false,
      activeGenerationCreated: false,
      externalEffectsObserved: false,
      compositionReadbacks: [
        { scenarioId: "TEST-01", identitySha256: expect.stringMatching(/^[0-9a-f]{64}$/) },
        { scenarioId: "TEST-02", identitySha256: expect.stringMatching(/^[0-9a-f]{64}$/) },
      ],
    });
    if (result.outcome !== "admitted") throw new Error("Expected admitted Generation.");
    expect(result.preparedScenarios).toHaveLength(2);
    const permissionProfiles = await Promise.all(
      (await readdir(fixture.permissionProfilesCaptureRoot)).map((entry) =>
        readFile(join(fixture.permissionProfilesCaptureRoot, entry), "utf8"),
      ),
    );
    expect(permissionProfiles).toHaveLength(result.preparedScenarios.length);
    const operatorDeny = `${JSON.stringify(await realpath(fixture.operatorCodexHome))}="deny"`;
    expect(permissionProfiles.every((profile) => profile.includes(operatorDeny))).toBe(true);
    await expect(access(join(fixture.workspaceRoot, "model-readback-home"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(new Set(result.preparedScenarios.map(({ paths }) => paths.runtimeRoot)).size).toBe(2);
    await expect(access(fixture.generationRoot)).rejects.toMatchObject({ code: "ENOENT" });
    await Promise.all(
      result.preparedScenarios.map(async ({ paths }) => {
        expect(await readFile(paths.manifest, "utf8")).toContain(generationId);
        expect(await readFile(paths.manifest, "utf8")).not.toContain("admission-drift");
      }),
    );
    await discardLiveScenarioGenerationAdmission({
      workspaceRoot: result.workspaceRoot,
      preparedScenarios: result.preparedScenarios,
    });
  });

  test("reuses only an exact static Basis while rebuilding every Scenario runtime", async () => {
    const { fixture, result: first } = await prepare();
    if (first.outcome !== "admitted") throw new Error("Expected first Admission.");
    const firstRuntimeRoots = first.preparedScenarios.map(({ paths }) => paths.runtimeRoot);
    const reusedWorkspace = await prepareLiveScenarioGenerationAdmission({
      sourceRoot: process.cwd(),
      workspaceRoot: first.workspaceRoot,
      operatorCodexHome: fixture.operatorCodexHome,
      registryPath,
      generationId: "33333333-3333-4333-8333-333333333333",
      package: fixture.package,
      generationEvidenceRoot: fixture.generationRoot,
      codexProgram: fixture.fakeCodex,
      reusableBasis: first.basis,
    });
    expect(reusedWorkspace).toMatchObject({
      outcome: "preflight blocked",
      diagnostics: [{ code: "reused-runtime-state" }],
    });
    await discardLiveScenarioGenerationAdmission({
      workspaceRoot: first.workspaceRoot,
      preparedScenarios: first.preparedScenarios,
    });

    const nextWorkspaceRoot = join(fixture.root, "next-generation-workspace");
    const second = await prepareLiveScenarioGenerationAdmission({
      sourceRoot: process.cwd(),
      workspaceRoot: nextWorkspaceRoot,
      operatorCodexHome: fixture.operatorCodexHome,
      registryPath,
      generationId: "22222222-2222-4222-8222-222222222222",
      package: fixture.package,
      generationEvidenceRoot: fixture.generationRoot,
      codexProgram: fixture.fakeCodex,
      reusableBasis: first.basis,
    });
    expect(second).toMatchObject({
      outcome: "admitted",
      basisVerification: "reused",
      basis: { identitySha256: first.basis.identitySha256 },
    });
    if (second.outcome !== "admitted") throw new Error("Expected reused Admission Basis.");
    expect(second.preparedScenarios.map(({ paths }) => paths.runtimeRoot)).not.toEqual(
      firstRuntimeRoots,
    );
    expect(second.compositionReadbacks.map(({ identitySha256 }) => identitySha256)).not.toEqual(
      first.compositionReadbacks.map(({ identitySha256 }) => identitySha256),
    );
    await discardLiveScenarioGenerationAdmission({
      workspaceRoot: second.workspaceRoot,
      preparedScenarios: second.preparedScenarios,
    });

    const changedFixture = await createFixture();
    const changedPackage = await prepareLiveScenarioGenerationAdmission({
      sourceRoot: process.cwd(),
      workspaceRoot: changedFixture.workspaceRoot,
      operatorCodexHome: changedFixture.operatorCodexHome,
      registryPath,
      generationId: "44444444-4444-4444-8444-444444444444",
      package: { ...changedFixture.package, sourceHead: "changed-fixture-head" },
      generationEvidenceRoot: changedFixture.generationRoot,
      codexProgram: changedFixture.fakeCodex,
      reusableBasis: first.basis,
    });
    expect(changedPackage).toMatchObject({ outcome: "admitted", basisVerification: "fresh" });
    if (changedPackage.outcome !== "admitted") throw new Error("Expected fresh Admission Basis.");
    await discardLiveScenarioGenerationAdmission({
      workspaceRoot: changedPackage.workspaceRoot,
      preparedScenarios: changedPackage.preparedScenarios,
    });
  }, 20_000);

  test("blocks unavailable model before materialization and leaves no Generation or runtime", async () => {
    const { fixture, result } = await prepare("model-unavailable");
    expect(result).toMatchObject({
      outcome: "preflight blocked",
      agentBehaviorStarted: false,
      activeGenerationCreated: false,
      externalEffectsObserved: false,
      diagnostics: [{ code: "model-unavailable" }],
    });
    await expect(access(fixture.workspaceRoot)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(access(fixture.generationRoot)).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("turns invalid registry or missing package identity into no-write preflight blocks", async () => {
    const fixture = await createFixture();
    for (const invalid of [
      {
        registryPath: "tests/fixtures/live-scenario-admission-invalid-registry.json",
        package: fixture.package,
        code: "invalid-registry",
        workspaceRoot: join(fixture.root, "invalid-registry-workspace"),
      },
      {
        registryPath,
        package: {},
        code: "missing-identity",
        workspaceRoot: join(fixture.root, "missing-package-workspace"),
      },
    ] as const) {
      const result = await prepareLiveScenarioGenerationAdmission({
        sourceRoot: process.cwd(),
        workspaceRoot: invalid.workspaceRoot,
        operatorCodexHome: fixture.operatorCodexHome,
        registryPath: invalid.registryPath,
        generationId,
        package: invalid.package,
        generationEvidenceRoot: fixture.generationRoot,
        codexProgram: fixture.fakeCodex,
      });
      expect(result).toMatchObject({
        outcome: "preflight blocked",
        diagnostics: [{ code: invalid.code }],
      });
      await expect(access(invalid.workspaceRoot)).rejects.toMatchObject({ code: "ENOENT" });
      await expect(access(fixture.generationRoot)).rejects.toMatchObject({ code: "ENOENT" });
    }
  });

  test("blocks a real fixture drift, ambient Skill, or permission failure and cleans every runtime", async () => {
    for (const mode of ["stale-fixture", "ambient-skill", "permission-failure"] as const) {
      const { fixture, result } = await prepare(mode);
      expect(result.outcome).toBe("preflight blocked");
      if (result.outcome !== "preflight blocked") {
        throw new Error("Expected blocked Generation.");
      }
      expect(result.diagnostics.map(({ code }) => code)).toContain(
        mode === "ambient-skill" ? "ambient-skill" : "invalid-readback",
      );
      await expect(access(fixture.workspaceRoot)).rejects.toMatchObject({ code: "ENOENT" });
      await expect(access(fixture.generationRoot)).rejects.toMatchObject({ code: "ENOENT" });
    }
  }, 30_000);

  test("reports a missing required capability as typed preflight block without remote work", async () => {
    const githubRegistryPath = "tests/fixtures/live-scenario-admission-github-registry.json";
    const { fixture, result } = await prepare("admitted", githubRegistryPath);
    expect(result).toMatchObject({
      outcome: "preflight blocked",
      agentBehaviorStarted: false,
      activeGenerationCreated: false,
      externalEffectsObserved: false,
      diagnostics: [{ code: "capability-unavailable", scenarioId: "TEST-03" }],
    });
    await expect(access(fixture.workspaceRoot)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(access(fixture.generationRoot)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
