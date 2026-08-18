import { describe, expect, test } from "bun:test";
import {
  access,
  chmod,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertJourneyAgentPrompt,
  createCodexJourneyEnvironment,
} from "../scripts/live-journey-matrix";
import {
  readLiveScenarioPackageBasis,
  scanLiveScenarioDurableEvidence,
  writeLiveScenarioPackageBasis,
} from "../scripts/live-scenario-evidence";
import {
  createLiveScenarioMatrixResult,
  createLiveScenarioResult,
  parseLiveScenarioAttemptDisposition,
} from "../scripts/live-scenario-generation";
import { materializeGitHubLiveScenarioPlanningState } from "../scripts/live-scenario-product";
import {
  createLiveScenarioEvaluation,
  loadLiveScenarioRegistry,
  materializeLiveScenarioFixture,
} from "../scripts/live-scenario-registry";
import {
  assertExactCandidateSourceCheckout,
  assertLiveScenarioSourceCurrent,
  deriveLiveScenarioGitHubScopeKey,
  installGitHubScenarioProviderContract,
  liveScenarioCandidateDefinitionDigest,
  liveScenarioDefinitionDigest,
  prepareLiveScenarioGeneration,
  verifyLiveScenarioGeneration,
} from "../scripts/live-scenario-runner";
import { localRehearsalWorktreeDigest } from "../scripts/local-rehearsal-identity";
import { sha256File } from "../scripts/release-digest";
import { createLocalMarkdownMattProvider } from "../src/providers/matt-skills-v1/local-markdown";

const expectedScenarioIds = [
  "INSTALL-01",
  "ENTRY-01",
  "ENTRY-02",
  "ENTRY-03",
  "CONFIG-01",
  "CONFIG-02",
  "CONFIG-03",
  "CONFIG-04",
  "CONFIG-05",
  "CONFIG-06",
  "GUIDE-01",
  "GUIDE-02",
  "PLAN-01",
  "PLAN-02",
  "PLAN-03",
  "INTAKE-01",
  "NATIVE-01",
  "DELIVERY-01",
  "DELIVERY-02",
  "STOP-01",
  "STOP-02",
  "STOP-03",
  "CATALOG-01",
] as const;

const rejectingGitleaksPath = async (root: string): Promise<string> => {
  const bin = join(root, "rejecting-gitleaks-bin");
  await mkdir(bin);
  const program = join(bin, "gitleaks");
  await writeFile(
    program,
    '#!/bin/sh\nif [ "$1" = "version" ]; then echo 8.30.1; exit 0; fi\nexit 1\n',
  );
  await chmod(program, 0o755);
  return `${bin}:${process.env["PATH"] ?? "/usr/bin:/bin"}`;
};

const acceptingGitleaksPath = async (root: string): Promise<string> => {
  const bin = join(root, "accepting-gitleaks-bin");
  await mkdir(bin);
  const program = join(bin, "gitleaks");
  await writeFile(
    program,
    '#!/bin/sh\nif [ "$1" = "version" ]; then echo 8.30.1; exit 0; fi\nif [ "$1" = "stdin" ]; then cat >/dev/null; exit 0; fi\nexit 64\n',
  );
  await chmod(program, 0o755);
  return `${bin}:${process.env["PATH"] ?? "/usr/bin:/bin"}`;
};

const recordingCodexPermissionProbe = async (root: string): Promise<string> => {
  const program = join(root, "codex-permission-probe");
  await writeFile(
    program,
    '#!/bin/sh\nprintf \'%s\\n\' "$@" > "$0.args"\n[ "$1" = "sandbox" ] || exit 64\n',
  );
  await chmod(program, 0o755);
  return program;
};

describe("independent Agent Live scenarios", () => {
  test("keeps current Scenario identity and operator secrets outside Agent input", () => {
    expect(() =>
      assertJourneyAgentPrompt("Please complete ENTRY-01.", ["INSTALL-01", "ENTRY-01"]),
    ).toThrow("black-box");
    expect(
      assertJourneyAgentPrompt("Please complete the installation request.", [
        "INSTALL-01",
        "ENTRY-01",
      ]),
    ).toBe("Please complete the installation request.");

    const installationEntry = "/private/tmp/formal-generation/INSTALL-01/README.local.md";
    const installationPrompt = `Please install Bearing from ${installationEntry}.`;
    expect(
      assertJourneyAgentPrompt(installationPrompt, ["INSTALL-01", "ENTRY-01"], [installationEntry]),
    ).toBe(installationPrompt);
    expect(() =>
      assertJourneyAgentPrompt(
        `${installationPrompt} This is Scenario INSTALL-01.`,
        ["INSTALL-01", "ENTRY-01"],
        [installationEntry],
      ),
    ).toThrow("black-box");
    for (const privateTerm of [
      "pass criteria",
      "expected command",
      "expected files",
      "matrix case",
    ]) {
      expect(() =>
        assertJourneyAgentPrompt(
          `${installationPrompt} The ${privateTerm} stays private.`,
          ["INSTALL-01", "ENTRY-01"],
          [installationEntry],
        ),
      ).toThrow("black-box");
    }
    expect(() =>
      assertJourneyAgentPrompt(installationPrompt, ["INSTALL-01", "ENTRY-01"], [""]),
    ).toThrow("black-box");

    const environment = createCodexJourneyEnvironment(
      {
        PATH: "/usr/bin:/bin",
        LANG: "en_US.UTF-8",
        GH_TOKEN: "operator-secret",
        MATRIX_PASS_CRITERIA: "private criteria",
      },
      { HOME: "/isolated/home", CODEX_HOME: "/isolated/home/.codex" },
    );
    expect(environment).toMatchObject({
      HOME: "/isolated/home",
      CODEX_HOME: "/isolated/home/.codex",
      LANG: "en_US.UTF-8",
    });
    expect(environment).not.toHaveProperty("GH_TOKEN");
    expect(environment).not.toHaveProperty("MATRIX_PASS_CRITERIA");
  });

  test("fails durable evidence closed when the required secret scanner rejects bytes", async () => {
    const root = await mkdtemp(join(tmpdir(), "bearing-live-scenario-gitleaks-"));
    const scanner = join(root, "gitleaks");
    await writeFile(
      scanner,
      '#!/bin/sh\nif [ "$1" = "version" ]; then echo 8.30.1; exit 0; fi\nexit 1\n',
    );
    await chmod(scanner, 0o755);
    expect(() =>
      scanLiveScenarioDurableEvidence({
        value: { token: "ghp_secret_value" },
        configPath: ".gitleaks.toml",
        program: scanner,
      }),
    ).toThrow("Gitleaks scan");

    const wrongVersion = join(root, "wrong-gitleaks");
    await writeFile(wrongVersion, "#!/bin/sh\necho 8.29.0\n");
    await chmod(wrongVersion, 0o755);
    expect(() =>
      scanLiveScenarioDurableEvidence({
        value: { safe: true },
        configPath: ".gitleaks.toml",
        program: wrongVersion,
      }),
    ).toThrow("requires Gitleaks 8.30.1");
  });

  test("keeps retired scripted Journey definitions out of the reusable Matrix", async () => {
    for (const locator of [
      "validation/live-journey/legacy-matrix.json",
      "validation/live-journey/journeys/legacy-clean-installation-and-local-loop.md",
      "validation/live-journey/journeys/legacy-github-and-active-reconciliation.md",
      "validation/live-journey/journeys/legacy-safety-and-lifecycle.md",
    ]) {
      await expect(access(locator)).rejects.toMatchObject({ code: "ENOENT" });
    }

    const help = Bun.spawnSync([process.execPath, "scripts/run-live-journey.ts", "--help"], {
      cwd: process.cwd(),
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(help.exitCode).toBe(0);
    expect(help.stdout.toString()).toContain("prepare-scenario");
    expect(help.stdout.toString()).not.toContain("prepare-clean");
    expect(help.stdout.toString()).not.toContain("prepare-github");
    expect(help.stdout.toString()).not.toContain("prepare-safety");
  });

  test("binds formal Candidate Matrix definitions to the exact source commit without requiring a clean checkout", async () => {
    const root = await mkdtemp(join(tmpdir(), "bearing-candidate-matrix-source-"));
    const registryPath = "validation/live-journey/registry.json";
    const fixtureRoot = join(root, "validation/live-journey/fixtures/base");
    const registry = `${JSON.stringify({
      schemaVersion: 1,
      scenarios: [
        {
          id: "TEST-01",
          name: "Candidate definition fixture",
          fixture: {
            source: "validation/live-journey/fixtures/base",
            materializer: "fresh-repository",
          },
          prompts: ["Complete the fixture request."],
          requiredOutcomes: ["The request is complete."],
          forbiddenOutcomes: ["The request is broadened."],
        },
      ],
    })}\n`;
    await mkdir(fixtureRoot, { recursive: true });
    await Promise.all([
      writeFile(join(root, registryPath), registry),
      writeFile(join(fixtureRoot, "README.md"), "# Candidate fixture\n"),
      writeFile(join(root, "unrelated.txt"), "clean\n"),
      writeFile(
        join(root, ".gitignore"),
        "validation/live-journey/fixtures/ignored-definition.txt\n",
      ),
    ]);
    const git = (...args: string[]) => {
      const result = Bun.spawnSync(["git", ...args], { cwd: root, stdout: "pipe", stderr: "pipe" });
      if (result.exitCode !== 0) throw new Error(result.stderr.toString());
      return result.stdout.toString().trim();
    };
    git("init", "-q");
    git("add", ".");
    git(
      "-c",
      "user.name=Bearing Matrix",
      "-c",
      "user.email=matrix@example.invalid",
      "commit",
      "-qm",
      "Candidate definition fixture",
    );
    const sourceCommit = git("rev-parse", "HEAD");
    const cleanDigest = await liveScenarioCandidateDefinitionDigest({
      sourceRoot: root,
      registryPath,
      sourceCommit,
    });

    await Promise.all([
      writeFile(join(root, "unrelated.txt"), "dirty but unrelated\n"),
      writeFile(join(root, "unrelated-new.txt"), "untracked but unrelated\n"),
    ]);
    expect(
      await liveScenarioCandidateDefinitionDigest({ sourceRoot: root, registryPath, sourceCommit }),
    ).toBe(cleanDigest);

    await writeFile(join(root, registryPath), registry.replace("Candidate definition", "Changed"));
    await expect(
      liveScenarioCandidateDefinitionDigest({ sourceRoot: root, registryPath, sourceCommit }),
    ).rejects.toThrow("exact Candidate source commit");
    await writeFile(join(root, registryPath), registry);

    const untrackedDefinition = join(fixtureRoot, "untracked-definition.txt");
    await writeFile(untrackedDefinition, "untracked\n");
    await expect(
      liveScenarioCandidateDefinitionDigest({ sourceRoot: root, registryPath, sourceCommit }),
    ).rejects.toThrow("exact Candidate source commit");
    await rm(untrackedDefinition);

    await writeFile(join(fixtureRoot, "ignored-definition.txt"), "ignored\n");
    await expect(
      liveScenarioCandidateDefinitionDigest({ sourceRoot: root, registryPath, sourceCommit }),
    ).rejects.toThrow("exact Candidate source commit");
  });

  test("requires the formal Candidate source checkout to match its exact commit", async () => {
    const root = await mkdtemp(join(tmpdir(), "bearing-candidate-source-"));
    await Promise.all([
      writeFile(join(root, "tracked.ts"), "export const candidate = true;\n"),
      writeFile(join(root, ".gitignore"), "AGENTS.md\n"),
    ]);
    const git = (...args: string[]) => {
      const result = Bun.spawnSync(["git", ...args], { cwd: root, stdout: "pipe", stderr: "pipe" });
      if (result.exitCode !== 0) throw new Error(result.stderr.toString());
      return result.stdout.toString().trim();
    };
    git("init", "-q");
    git("add", ".");
    git(
      "-c",
      "user.name=Bearing Matrix",
      "-c",
      "user.email=matrix@example.invalid",
      "commit",
      "-qm",
      "Candidate source fixture",
    );
    const sourceCommit = git("rev-parse", "HEAD");

    await expect(
      assertExactCandidateSourceCheckout({ sourceRoot: root, sourceCommit }),
    ).resolves.toBeUndefined();
    await expect(
      assertLiveScenarioSourceCurrent(root, {
        evidenceClass: "release-candidate",
        sourceCommit,
      }),
    ).rejects.toThrow("executing runner checkout");
    await writeFile(join(root, "AGENTS.md"), "local agent context\n");
    await expect(
      assertExactCandidateSourceCheckout({ sourceRoot: root, sourceCommit }),
    ).resolves.toBeUndefined();

    await writeFile(join(root, "tracked.ts"), "export const candidate = false;\n");
    await expect(
      assertExactCandidateSourceCheckout({ sourceRoot: root, sourceCommit }),
    ).rejects.toThrow("exact Candidate source commit");
    await writeFile(join(root, "tracked.ts"), "export const candidate = true;\n");
    await writeFile(join(root, "untracked-release-workflow.ts"), "export {};\n");
    await expect(
      assertExactCandidateSourceCheckout({ sourceRoot: root, sourceCommit }),
    ).rejects.toThrow("exact Candidate source commit");
  });

  test("keeps local rehearsal identity stable across harness-only repair", async () => {
    const root = await mkdtemp(join(tmpdir(), "bearing-local-rehearsal-source-"));
    await Promise.all([
      mkdir(join(root, "src"), { recursive: true }),
      mkdir(join(root, "scripts"), { recursive: true }),
      mkdir(join(root, "tests"), { recursive: true }),
    ]);
    await Promise.all([
      writeFile(join(root, "src/product.ts"), "export const product = true;\n"),
      writeFile(join(root, "scripts/live-scenario-runner.ts"), "export const harness = 1;\n"),
      writeFile(join(root, "tests/harness.test.ts"), "export const test = 1;\n"),
    ]);
    const git = (...args: string[]) => {
      const result = Bun.spawnSync(["git", ...args], { cwd: root, stdout: "pipe", stderr: "pipe" });
      if (result.exitCode !== 0) throw new Error(result.stderr.toString());
      return result.stdout.toString().trim();
    };
    git("init", "-q");
    git("add", ".");
    git(
      "-c",
      "user.name=Bearing Matrix",
      "-c",
      "user.email=matrix@example.invalid",
      "commit",
      "-qm",
      "Local rehearsal source fixture",
    );
    const initial = await localRehearsalWorktreeDigest(root);

    await Promise.all([
      writeFile(join(root, "scripts/live-scenario-runner.ts"), "export const harness = 2;\n"),
      writeFile(join(root, "tests/new-harness.test.ts"), "export const test = 2;\n"),
    ]);
    expect(await localRehearsalWorktreeDigest(root)).toBe(initial);

    await writeFile(join(root, "src/product.ts"), "export const product = false;\n");
    expect(await localRehearsalWorktreeDigest(root)).not.toBe(initial);
  });

  test("binds generated package-basis bytes before Scenario preparation", async () => {
    const root = await mkdtemp(join(tmpdir(), "bearing-package-basis-"));
    const path = join(root, "local-rehearsal-package.json");
    await writeLiveScenarioPackageBasis(path, {
      schemaVersion: 1,
      evidenceClass: "local-rehearsal",
      packageName: "@lagrangee/bearing",
      packageVersion: "0.1.1",
      sourceHead: "a".repeat(40),
      worktreeSha256: "b".repeat(64),
      artifact: {
        path: join(root, "bearing.tgz"),
        file: "bearing.tgz",
        sha256: "c".repeat(64),
      },
      matrixDefinitionSha256: "d".repeat(64),
    });
    await expect(readLiveScenarioPackageBasis(path)).resolves.toMatchObject({
      evidenceClass: "local-rehearsal",
      packageVersion: "0.1.1",
    });

    await writeFile(path, (await readFile(path, "utf8")).replace("0.1.1", "0.1.2"));
    await expect(readLiveScenarioPackageBasis(path)).rejects.toThrow("digest mismatch");
  });

  test("uses a bounded exact GitHub scope key while retaining full identity inputs", () => {
    const input = {
      packageVersion: "0.1.1",
      sourceIdentity: "abcdef0123456789",
      packIdentity: "123456/1",
      artifactSha256: "a".repeat(64),
      matrixDefinitionSha256: "b".repeat(64),
      generationId: "11111111-1111-4111-8111-111111111111",
      journeyAttempt: 1,
    };
    const scopeKey = deriveLiveScenarioGitHubScopeKey(input);

    expect(scopeKey).toMatch(/^bearing-live-0-1-1-[0-9a-f]{20}$/u);
    expect(deriveLiveScenarioGitHubScopeKey(input)).toBe(scopeKey);
    expect(deriveLiveScenarioGitHubScopeKey({ ...input, journeyAttempt: 2 })).not.toBe(scopeKey);
    expect(
      deriveLiveScenarioGitHubScopeKey({ ...input, matrixDefinitionSha256: "c".repeat(64) }),
    ).not.toBe(scopeKey);
  });

  test("exposes one Scenario-oriented runner interface", () => {
    const result = Bun.spawnSync([process.execPath, "scripts/run-live-journey.ts", "--help"], {
      cwd: process.cwd(),
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain("prepare-scenario");
    expect(result.stdout.toString()).toContain("--journey-attempt");
    expect(result.stdout.toString()).toContain("model|network|credential|harness");
    expect(result.stdout.toString()).toContain("run-scenario-turn");
    expect(result.stdout.toString()).toContain("evaluate-scenario");
    expect(result.stdout.toString()).toContain("complete-matrix");
    expect(result.stdout.toString()).toContain("preflight-matrix");
    expect(result.stdout.toString()).toContain("matrix-status");
    expect(result.stdout.toString()).not.toContain("--coordinator-identity");
    expect(result.stdout.toString()).not.toContain("prepare-clean");
    expect(result.stdout.toString()).not.toContain("prepare-github");
    expect(result.stdout.toString()).not.toContain("prepare-safety");
    expect(result.stdout.toString()).not.toContain("Legacy three-Journey");
  });

  test("records a bounded harness retry after rejected behavior", () => {
    expect(
      parseLiveScenarioAttemptDisposition({
        schemaVersion: 1,
        turn: 2,
        reason: "harness",
        testedBehaviorStarted: true,
        priorObservation: {
          pointer: "observations/turn-02-attempt-01.json",
          sha256: "a".repeat(64),
        },
      }),
    ).toMatchObject({ reason: "harness", testedBehaviorStarted: true });
    expect(() =>
      parseLiveScenarioAttemptDisposition({
        schemaVersion: 1,
        turn: 2,
        reason: "network",
        testedBehaviorStarted: true,
        priorObservation: {
          pointer: "observations/turn-02-attempt-01.json",
          sha256: "a".repeat(64),
        },
      }),
    ).toThrow();
  });

  test("loads the complete semantic registry without the retired long-Journey identities", async () => {
    const registry = await loadLiveScenarioRegistry("validation/live-journey/registry.json");

    expect(registry.schemaVersion).toBe(1);
    expect(registry.scenarios.map(({ id }) => id)).toEqual([...expectedScenarioIds]);
    expect(registry.scenarios.every(({ prompts }) => prompts.length > 0)).toBe(true);
    expect(registry.scenarios.every(({ requiredOutcomes }) => requiredOutcomes.length > 0)).toBe(
      true,
    );
    expect(registry.scenarios.every(({ forbiddenOutcomes }) => forbiddenOutcomes.length > 0)).toBe(
      true,
    );
    expect(JSON.stringify(registry)).not.toMatch(/CLEAN-|GITHUB-|SAFETY-/u);
    expect(JSON.stringify(registry)).not.toMatch(/\.scratch\/<effort>|field lines|spec\.md/iu);

    const explicitNextWork = registry.scenarios.find(({ id }) => id === "GUIDE-02");
    expect(explicitNextWork?.name).toMatch(/Explicit Next Work/iu);
    expect(explicitNextWork?.prompts.join("\n")).toMatch(/Bearing/iu);

    const incompleteAcceptance = registry.scenarios.find(({ id }) => id === "STOP-03");
    expect(incompleteAcceptance?.prompts).toHaveLength(2);
    expect(incompleteAcceptance?.prompts[0]).toMatch(/candidate|候选/iu);
    expect(incompleteAcceptance?.prompts[1]).toMatch(/尚未|没有.*决定|未接受/iu);

    const ambiguousNative = registry.scenarios.find(({ id }) => id === "STOP-01");
    expect(ambiguousNative?.prompts).toHaveLength(1);
    expect(ambiguousNative?.prompts[0]).toMatch(/Bearing/iu);
    expect(ambiguousNative?.prompts[0]).toContain("`Update output`");

    const githubDelivery = registry.scenarios.find(({ id }) => id === "DELIVERY-02");
    expect(githubDelivery?.prompts.join("\n")).toMatch(/ready[\s\S]*label|label[\s\S]*ready/iu);
    expect(githubDelivery?.prompts.join("\n")).toMatch(
      /现有|current[\s\S]*label formatting[\s\S]*(Roadmap|Gate)/iu,
    );
    expect(githubDelivery?.prompts.join("\n")).toMatch(/不要新增 Roadmap 或 Gate/iu);
    expect(githubDelivery?.prompts.join("\n")).not.toMatch(
      /candidate marker|GITHUB_SCOPE|bearing-live-|验证标识/iu,
    );

    const githubProviderContract = await readFile(
      "validation/live-journey/fixtures/github-provider/docs/agents/issue-tracker.md",
      "utf8",
    );
    expect(githubProviderContract).toMatch(/human-readable business (?:name|title)/iu);
    expect(githubProviderContract).not.toMatch(/supplied Candidate scope key/iu);

    const kitUpdate = registry.scenarios.find(({ id }) => id === "CONFIG-06");
    expect(kitUpdate?.fixture.materializer).toBe("kit-update-required-repository");
    expect(kitUpdate?.requiredOutcomes.join("\n")).toMatch(
      /Kit Update Required[\s\S]*repository[\s\S]*unchanged/iu,
    );
    expect(kitUpdate?.forbiddenOutcomes.join("\n")).toMatch(
      /Repository Update Required[\s\S]*Global Kit maintenance[\s\S]*consent/iu,
    );
  });

  test("preflights every Fixture while reserving semantic review for the Coordinator", () => {
    const result = Bun.spawnSync(
      [
        process.execPath,
        "scripts/run-live-journey.ts",
        "preflight-matrix",
        "--source-root",
        process.cwd(),
        "--registry",
        "validation/live-journey/registry.json",
      ],
      { cwd: process.cwd(), stdout: "pipe", stderr: "pipe" },
    );

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout.toString())).toMatchObject({
      scenarioCount: expectedScenarioIds.length,
      fixtureAssertionsVerified: [{ scenarioId: "ENTRY-03", count: 1 }],
      semanticReviewRequired: true,
      semanticReviewScenarioIds: [...expectedScenarioIds],
    });
  });

  test("reports bounded Matrix progress and the next incomplete Scenario", async () => {
    const registry = await loadLiveScenarioRegistry("validation/live-journey/registry.json");
    const scenario = registry.scenarios.find(({ id }) => id === "ENTRY-01");
    if (scenario === undefined) throw new Error("ENTRY-01 is unavailable.");
    const root = await mkdtemp(join(tmpdir(), "bearing-live-scenario-status-"));
    const results = join(root, "results");
    await mkdir(results);
    await mkdir(join(root, "ENTRY-02"));
    const matrixDefinitionSha256 = await liveScenarioDefinitionDigest({
      sourceRoot: process.cwd(),
      registryPath: "validation/live-journey/registry.json",
    });
    const sourceHead = Bun.spawnSync(["git", "rev-parse", "HEAD"], {
      cwd: process.cwd(),
      stdout: "pipe",
    })
      .stdout.toString()
      .trim();
    const artifactPath = join(root, "bearing.tgz");
    await writeFile(artifactPath, "frozen local rehearsal package\n");
    const artifactSha256 = await sha256File(artifactPath);
    const matrixPackage = {
      evidenceClass: "local-rehearsal" as const,
      packageName: "@lagrangee/bearing",
      packageVersion: "0.1.1",
      sourceHead,
      worktreeSha256: await localRehearsalWorktreeDigest(process.cwd()),
      artifact: {
        path: artifactPath,
        file: "bearing.tgz",
        sha256: artifactSha256,
      },
      matrixDefinitionSha256,
    };
    await writeFile(
      join(root, "ENTRY-02", "scenario-manifest.json"),
      `${JSON.stringify({
        generationId: "2e3f0d28-2415-46a6-a46e-f99218f8c721",
        evidenceClass: "local-rehearsal",
        matrixDefinitionSha256,
        package: matrixPackage,
      })}\n`,
    );
    const evaluation = createLiveScenarioEvaluation({
      scenario,
      outcome: "pass",
      coordinatorIdentity: "codex-coordinator",
      rationale: "The ordinary request completed without Bearing governance work.",
      requiredOutcomeObservations: scenario.requiredOutcomes.map((requirement) => ({
        requirement,
        observed: true,
        evidencePointers: ["observations/turn-01.json"],
      })),
      forbiddenOutcomeObservations: scenario.forbiddenOutcomes.map((requirement) => ({
        requirement,
        observed: false,
        evidencePointers: ["observations/turn-01.json"],
      })),
    });
    const result = createLiveScenarioResult({
      evidenceClass: "local-rehearsal",
      generationId: "2e3f0d28-2415-46a6-a46e-f99218f8c721",
      package: matrixPackage,
      matrixDefinitionSha256,
      codexCliVersion: "codex-cli-fixture",
      coordinatorIdentity: "codex-coordinator",
      startingStateSha256: "d".repeat(64),
      durationMs: 100,
      evaluation,
    });
    await writeFile(join(results, "ENTRY-01.json"), `${JSON.stringify(result)}\n`);

    const inspected = Bun.spawnSync(
      [
        process.execPath,
        "scripts/run-live-journey.ts",
        "matrix-status",
        "--source-root",
        process.cwd(),
        "--registry",
        "validation/live-journey/registry.json",
        "--generation-root",
        root,
      ],
      { cwd: process.cwd(), stdout: "pipe", stderr: "pipe" },
    );

    expect(inspected.exitCode).toBe(0);
    expect(JSON.parse(inspected.stdout.toString())).toMatchObject({
      generationId: "2e3f0d28-2415-46a6-a46e-f99218f8c721",
      completed: 1,
      total: expectedScenarioIds.length,
      completedScenarioIds: ["ENTRY-01"],
      preparedScenarioIds: ["ENTRY-02"],
      nextScenarioId: "INSTALL-01",
      matrixComplete: false,
      matrixDefinitionCurrent: true,
      packageCurrent: true,
      refineReasons: [],
    });
  });

  test("requests workflow refinement after thirty minutes without a bounded result", async () => {
    const root = await mkdtemp(join(tmpdir(), "bearing-live-scenario-stalled-status-"));
    const prepared = join(root, "ENTRY-01", "scenario-manifest.json");
    await mkdir(join(root, "ENTRY-01"));
    await writeFile(
      prepared,
      `${JSON.stringify({
        generationId: "11111111-1111-4111-8111-111111111111",
        evidenceClass: "local-rehearsal",
        matrixDefinitionSha256: "a".repeat(64),
        package: {
          evidenceClass: "local-rehearsal",
          packageName: "@lagrangee/bearing",
          packageVersion: "0.1.1",
          sourceHead: "obsolete-head",
          worktreeSha256: "b".repeat(64),
          artifact: {
            path: join(root, "obsolete.tgz"),
            file: "obsolete.tgz",
            sha256: "c".repeat(64),
          },
          matrixDefinitionSha256: "a".repeat(64),
        },
      })}\n`,
    );
    const stale = new Date(Date.now() - 31 * 60 * 1_000);
    await utimes(prepared, stale, stale);

    const inspected = Bun.spawnSync(
      [
        process.execPath,
        "scripts/run-live-journey.ts",
        "matrix-status",
        "--source-root",
        process.cwd(),
        "--registry",
        "validation/live-journey/registry.json",
        "--generation-root",
        root,
      ],
      { cwd: process.cwd(), stdout: "pipe", stderr: "pipe" },
    );

    expect(inspected.exitCode).toBe(0);
    expect(JSON.parse(inspected.stdout.toString())).toMatchObject({
      generationId: "11111111-1111-4111-8111-111111111111",
      completed: 0,
      preparedScenarioIds: ["ENTRY-01"],
      matrixDefinitionCurrent: false,
      packageCurrent: false,
      refineReasons: [
        "matrix-definition-changed",
        "package-or-source-changed",
        "no-bounded-result-for-30-minutes",
      ],
    });
  });

  test("documents the independent Scenario workflow without the retired long-Journey contract", async () => {
    const [policy, generation, runbook, runner] = await Promise.all([
      readFile("docs/agents/codex-e2e.md", "utf8"),
      readFile("validation/live-journey/generation.md", "utf8"),
      readFile("docs/agents/release-live-journey.md", "utf8"),
      readFile("scripts/run-live-journey.ts", "utf8"),
    ]);

    expect(policy).toContain("independent behavior-driven Scenarios");
    expect(policy).toContain("Coordinating Agent is the only semantic evaluation authority");
    expect(generation).toContain("prepare-local-rehearsal");
    expect(generation).toContain("preflight-matrix");
    expect(generation).toContain("matrix-status");
    expect(generation).toContain("5, 10, 15, and 20");
    expect(generation).toContain("30 minutes");
    expect(generation).toContain("second identity-changing repair");
    expect(generation).toContain("same failure class twice");
    expect(generation).toContain("## Product-change evidence gate");
    expect(generation).toContain("exact package and isolated runtime");
    expect(generation).toContain("violates a documented Bearing product contract");
    expect(generation).toContain("Judge from the user's observable outcome");
    expect(generation).toMatch(
      /file choice, command order, wording, or\s+confirmation count is not a failure/u,
    );
    expect(generation).toContain("stabilization probe");
    expect(generation).toContain("prepare-candidate-package");
    expect(generation).toContain("prepare-scenario");
    expect(generation).toContain("--journey-attempt");
    expect(generation).toContain("run-scenario-turn");
    expect(generation).toContain("evaluate-scenario");
    expect(generation).toContain("complete-matrix");
    expect(generation).toContain("authorizedRemoteIssueNumbers");
    expect(runner).not.toMatch(/filter\(\(issue\) => issue\.candidateScoped\)/u);
    expect(`${policy}\n${generation}\n${runbook}`).not.toMatch(
      /three-Journey|18-Case|all 18 Cases|Clean, GitHub, and Safety/iu,
    );
  });

  test("keeps the Local Markdown baseline provider-valid at its deterministic seam", async () => {
    const root = await mkdtemp(join(tmpdir(), "bearing-live-scenario-provider-"));
    const repository = join(root, "repository");
    await cp("validation/live-journey/fixtures/safety-lifecycle", repository, {
      recursive: true,
    });
    const result = await createLocalMarkdownMattProvider({
      repoRoot: repository,
      contractLocator: "docs/agents/issue-tracker.md",
      triageLocator: "docs/agents/triage-labels.md",
      clock: () => new Date("2026-08-16T00:00:00Z"),
    }).capture({ provider: "matt-skills/v1", nativeScope: ".scratch/label-delivery" });

    expect(result.state).toBe("available");
    expect(result.coverage.assessment).toBe("complete");
    expect(result.diagnostics).toEqual([]);
  });

  test("makes the GitHub native relation mechanism explicit in its provider fixture", async () => {
    const contract = await readFile(
      "validation/live-journey/fixtures/github-provider/docs/agents/issue-tracker.md",
      "utf8",
    );
    expect(contract).toContain("GitHub's REST API");
    expect(contract).toContain("/sub_issues");
    expect(contract).toContain("/dependencies/blocked_by");
    expect(contract).toContain("integer `sub_issue_id` field");
    expect(contract).toContain("integer `issue_id` field");
    expect(contract).toMatch(/Each target database ID must belong to this repository/iu);
    expect(contract).not.toMatch(/Journey broker|runner|harness/iu);
    expect(contract).toMatch(/Do not use GraphQL/iu);
    expect(contract).toMatch(/body fallback as a substitute/iu);
    expect(contract).toMatch(/complete the parent too/iu);
    expect(contract).toMatch(/does not conclude a Bearing Effort, pass a Gate/iu);
  });

  test("installs the tracked GitHub provider contract as a clean Scenario baseline", async () => {
    const root = await mkdtemp(join(tmpdir(), "bearing-live-scenario-github-provider-"));
    const repository = join(root, "repository");
    await mkdir(join(repository, "docs/agents"), { recursive: true });
    await writeFile(join(repository, "docs/agents/issue-tracker.md"), "old contract\n");
    Bun.spawnSync(["git", "init", "-q"], { cwd: repository });
    Bun.spawnSync(["git", "add", "."], { cwd: repository });
    Bun.spawnSync(
      [
        "git",
        "-c",
        "user.name=Bearing Live Matrix",
        "-c",
        "user.email=live-matrix@example.invalid",
        "commit",
        "-qm",
        "Initial fixture",
      ],
      { cwd: repository },
    );

    await installGitHubScenarioProviderContract({ sourceRoot: process.cwd(), repository });

    expect(await readFile(join(repository, "docs/agents/issue-tracker.md"), "utf8")).toBe(
      await readFile(
        "validation/live-journey/fixtures/github-provider/docs/agents/issue-tracker.md",
        "utf8",
      ),
    );
    expect(
      Bun.spawnSync(["git", "status", "--porcelain=v1"], { cwd: repository })
        .stdout.toString()
        .trim(),
    ).toBe("");
  });

  test("replaces inherited GitHub planning history with one exact Scenario baseline", async () => {
    const root = await mkdtemp(join(tmpdir(), "bearing-live-scenario-github-planning-"));
    const repository = join(root, "repository");
    const agentHome = join(root, "agent-home");
    const productProgram = join(root, "bearing-fixture");
    await mkdir(join(repository, ".bearing/state/roadmaps"), { recursive: true });
    await mkdir(agentHome);
    await writeFile(
      join(repository, ".bearing/state/roadmaps/historical-candidate.md"),
      "historical synthetic state\n",
    );
    await writeFile(productProgram, "#!/bin/sh\nexit 0\n", { mode: 0o700 });
    Bun.spawnSync(["git", "init", "-q"], { cwd: repository });
    Bun.spawnSync(["git", "add", "."], { cwd: repository });
    Bun.spawnSync(
      [
        "git",
        "-c",
        "user.name=Bearing Live Matrix",
        "-c",
        "user.email=live-matrix@example.invalid",
        "commit",
        "-qm",
        "Inherited fixture",
      ],
      { cwd: repository },
    );

    await materializeGitHubLiveScenarioPlanningState({
      sourceRoot: process.cwd(),
      repositoryRoot: repository,
      productProgram,
      agentHome,
    });

    await expect(
      lstat(join(repository, ".bearing/state/roadmaps/historical-candidate.md")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    expect(
      await readFile(join(repository, ".bearing/state/roadmaps/label-formatting.md"), "utf8"),
    ).toContain("ID: roadmap:label-formatting");
    expect(
      await readFile(
        join(repository, ".bearing/state/milestone-gates/stable-label-output.md"),
        "utf8",
      ),
    ).toContain("Effort order: []");
    await expect(
      lstat(join(repository, ".bearing/state/efforts/label-delivery.md")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    expect(
      Bun.spawnSync(["git", "status", "--porcelain=v1"], { cwd: repository })
        .stdout.toString()
        .trim(),
    ).toBe("");
  });

  test("materializes one fresh tracked fixture and binds its starting-state identity", async () => {
    const registry = await loadLiveScenarioRegistry("validation/live-journey/registry.json");
    const root = await mkdtemp(join(tmpdir(), "bearing-live-scenario-source-"));
    const first = join(root, "first");
    const second = join(root, "second");

    const prepared = await materializeLiveScenarioFixture({
      registry,
      scenarioId: "ENTRY-01",
      sourceRoot: process.cwd(),
      outputRoot: first,
    });
    const repeated = await materializeLiveScenarioFixture({
      registry,
      scenarioId: "ENTRY-01",
      sourceRoot: process.cwd(),
      outputRoot: second,
    });

    expect(prepared.scenarioId).toBe("ENTRY-01");
    expect(prepared.fixtureRoot).toBe(first);
    expect(prepared.startingStateSha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(repeated.startingStateSha256).toBe(prepared.startingStateSha256);
    expect(await readFile(join(first, "README.md"), "utf8")).toContain("Local loop fixture");
  });

  test("keeps semantic pass with the Coordinator and rejects hard-observable conflicts", async () => {
    const registry = await loadLiveScenarioRegistry("validation/live-journey/registry.json");
    const scenario = registry.scenarios.find(({ id }) => id === "ENTRY-01");
    if (scenario === undefined) throw new Error("ENTRY-01 is unavailable.");

    const result = createLiveScenarioEvaluation({
      scenario,
      outcome: "pass",
      coordinatorIdentity: "codex-coordinator",
      rationale: "The ordinary repository edit completed without Bearing planning or setup.",
      requiredOutcomeObservations: scenario.requiredOutcomes.map((requirement) => ({
        requirement,
        observed: true,
        evidencePointers: ["observations/turn-01.json"],
      })),
      forbiddenOutcomeObservations: scenario.forbiddenOutcomes.map((requirement) => ({
        requirement,
        observed: false,
        evidencePointers: ["observations/turn-01.json"],
      })),
    });

    expect(result.outcome).toBe("pass");
    expect(result.semanticEvaluationAuthority).toBe("coordinating-agent");

    expect(() =>
      createLiveScenarioEvaluation({
        scenario,
        outcome: "pass",
        coordinatorIdentity: "codex-coordinator",
        rationale: "The Agent reported success, but a forbidden mutation was observed.",
        requiredOutcomeObservations: scenario.requiredOutcomes.map((requirement) => ({
          requirement,
          observed: true,
          evidencePointers: ["observations/turn-01.json"],
        })),
        forbiddenOutcomeObservations: scenario.forbiddenOutcomes.map((requirement, index) => ({
          requirement,
          observed: index === 0,
          evidencePointers: ["observations/turn-01.json"],
        })),
      }),
    ).toThrow("contradicts");
  });

  test("completes every independent scenario after one failure and reserves release readiness for all-pass Candidate evidence", async () => {
    const registry = await loadLiveScenarioRegistry("validation/live-journey/registry.json");
    const matrixDefinitionSha256 = await liveScenarioDefinitionDigest({
      sourceRoot: process.cwd(),
      registryPath: "validation/live-journey/registry.json",
    });
    const evaluations = registry.scenarios.map((scenario, index) =>
      createLiveScenarioEvaluation({
        scenario,
        outcome: index === 3 ? "fail" : "pass",
        coordinatorIdentity: "codex-coordinator",
        rationale:
          index === 3
            ? "The Active ordinary-work request started unrelated Bearing planning."
            : "The required semantic outcome was observed without a forbidden outcome.",
        requiredOutcomeObservations: scenario.requiredOutcomes.map((requirement) => ({
          requirement,
          observed: index !== 3,
          evidencePointers: [`observations/${scenario.id}.json`],
        })),
        forbiddenOutcomeObservations: scenario.forbiddenOutcomes.map((requirement) => ({
          requirement,
          observed: index === 3,
          evidencePointers: [`observations/${scenario.id}.json`],
        })),
      }),
    );

    const packageIdentity = {
      evidenceClass: "local-rehearsal",
      packageName: "@lagrangee/bearing",
      packageVersion: "0.1.1",
      sourceHead: "fixture-head",
      worktreeSha256: await localRehearsalWorktreeDigest(process.cwd()),
      artifact: {
        path: join(tmpdir(), "bearing-live-scenario.tgz"),
        file: "bearing-live-scenario.tgz",
        sha256: "c".repeat(64),
      },
      matrixDefinitionSha256,
    } as const;
    const scenarioResults = evaluations.map((evaluation) => ({
      result: createLiveScenarioResult({
        evidenceClass: "local-rehearsal",
        generationId: "2e3f0d28-2415-46a6-a46e-f99218f8c721",
        package: packageIdentity,
        matrixDefinitionSha256,
        codexCliVersion: "codex-cli-fixture",
        coordinatorIdentity: "codex-coordinator",
        startingStateSha256: "d".repeat(64),
        durationMs: 100,
        evaluation,
        remoteIntegrity:
          evaluation.scenarioId === "DELIVERY-02"
            ? {
                repositoryIdentitySha256: "f".repeat(64),
                authorizedCandidateIssueCount: 1,
                integritySha256: "1".repeat(64),
              }
            : undefined,
      }),
      pointer: `results/${evaluation.scenarioId}.json`,
      sha256: "e".repeat(64),
    }));

    const result = createLiveScenarioMatrixResult({
      registry,
      scenarioResults,
    });

    expect(result.evidenceClass).toBe("local-rehearsal");
    expect(result.generationId).toBe("2e3f0d28-2415-46a6-a46e-f99218f8c721");
    expect(result.durationMs).toBe(2_300);

    expect(result.scenarios).toHaveLength(expectedScenarioIds.length);
    expect(result.scenarios.at(-1)?.scenarioId).toBe("CATALOG-01");
    expect(result.scenarios.find(({ scenarioId }) => scenarioId === "DELIVERY-02")).toMatchObject({
      remoteIntegrity: {
        repositoryIdentitySha256: "f".repeat(64),
        authorizedCandidateIssueCount: 1,
        integritySha256: "1".repeat(64),
      },
    });
    expect(result.terminalOutcome).toBe("not-pass");
    expect(result.releasePrerequisiteSatisfied).toBe(false);
    expect(result.scenarios.filter(({ outcome }) => outcome === "not-run")).toEqual([]);

    expect(() =>
      createLiveScenarioMatrixResult({
        registry,
        scenarioResults: scenarioResults.slice(1),
      }),
    ).toThrow("each registered Live Scenario exactly once");

    const root = await mkdtemp(join(tmpdir(), "bearing-live-scenario-results-"));
    const results = join(root, "results");
    const output = join(root, "matrix-result.json");
    await mkdir(results);
    await Promise.all(
      scenarioResults.map(({ result: scenarioResult }) =>
        writeFile(
          join(results, `${scenarioResult.scenarioId}.json`),
          `${JSON.stringify(scenarioResult, null, 2)}\n`,
        ),
      ),
    );
    const completed = Bun.spawnSync(
      [
        process.execPath,
        "scripts/run-live-journey.ts",
        "complete-matrix",
        "--source-root",
        process.cwd(),
        "--registry",
        "validation/live-journey/registry.json",
        "--results",
        results,
        "--output",
        output,
      ],
      {
        cwd: process.cwd(),
        env: { ...process.env, PATH: await acceptingGitleaksPath(root) },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    expect(completed.exitCode).toBe(0);
    expect(JSON.parse(await readFile(output, "utf8"))).toMatchObject({
      terminalOutcome: "not-pass",
      releasePrerequisiteSatisfied: false,
    });
    const rejectedOutput = join(root, "rejected-matrix-result.json");
    const rejectedCompletion = Bun.spawnSync(
      [
        process.execPath,
        "scripts/run-live-journey.ts",
        "complete-matrix",
        "--source-root",
        process.cwd(),
        "--registry",
        "validation/live-journey/registry.json",
        "--results",
        results,
        "--output",
        rejectedOutput,
      ],
      {
        cwd: process.cwd(),
        env: { ...process.env, PATH: await rejectingGitleaksPath(root) },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    expect(rejectedCompletion.exitCode).not.toBe(0);
    await expect(access(rejectedOutput)).rejects.toMatchObject({ code: "ENOENT" });
    const externalRegistry = join(root, "external-registry.json");
    const externalOutput = join(root, "external-matrix-result.json");
    await writeFile(
      externalRegistry,
      `${JSON.stringify({ ...registry, scenarios: [...registry.scenarios].reverse() }, null, 2)}\n`,
    );
    const externalCompletion = Bun.spawnSync(
      [
        process.execPath,
        "scripts/run-live-journey.ts",
        "complete-matrix",
        "--source-root",
        process.cwd(),
        "--registry",
        externalRegistry,
        "--results",
        results,
        "--output",
        externalOutput,
      ],
      { cwd: process.cwd(), stdout: "pipe", stderr: "pipe" },
    );
    expect(externalCompletion.exitCode).not.toBe(0);
    expect(externalCompletion.stderr.toString()).toContain("tracked source registry");
  });

  test("prepares INSTALL-01 without preinstalling or configuring the product behavior under test", async () => {
    const root = await mkdtemp(join(tmpdir(), "bearing-live-scenario-generation-"));
    const packageRoot = join(root, "package-root");
    const tarball = join(root, "bearing.tgz");
    const operatorCodexHome = join(root, "operator-codex-home");
    const workspaceRoot = join(root, "workspace");
    await mkdir(join(packageRoot, "package/docs"), { recursive: true });
    await Promise.all([
      writeFile(join(packageRoot, "package/docs/agent-installation.md"), "# Install\n"),
      writeFile(
        join(packageRoot, "package/package.json"),
        '{"name":"@lagrangee/bearing","version":"0.1.1"}\n',
      ),
    ]);
    const packed = Bun.spawnSync(["tar", "-czf", tarball, "package"], {
      cwd: packageRoot,
      stdout: "pipe",
      stderr: "pipe",
    });
    if (packed.exitCode !== 0) throw new Error(packed.stderr.toString());
    await mkdir(operatorCodexHome);
    await writeFile(join(operatorCodexHome, "auth.json"), "{}\n");
    const codexProgram = await recordingCodexPermissionProbe(root);
    const matrixDefinitionSha256 = await liveScenarioDefinitionDigest({
      sourceRoot: process.cwd(),
      registryPath: "validation/live-journey/registry.json",
    });
    const localSourceIdentity = {
      sourceHead: "fixture-head",
      worktreeSha256: await localRehearsalWorktreeDigest(process.cwd()),
    } as const;

    await expect(
      prepareLiveScenarioGeneration({
        sourceRoot: process.cwd(),
        workspaceRoot: join(root, "mismatched-workspace"),
        operatorCodexHome,
        registryPath: "validation/live-journey/registry.json",
        scenarioId: "INSTALL-01",
        package: {
          evidenceClass: "local-rehearsal",
          packageName: "@lagrangee/bearing",
          packageVersion: "0.1.2",
          ...localSourceIdentity,
          artifact: {
            path: tarball,
            file: "bearing.tgz",
            sha256: await sha256File(tarball),
          },
          matrixDefinitionSha256,
        },
      }),
    ).rejects.toThrow("package metadata");

    const manifest = await prepareLiveScenarioGeneration({
      sourceRoot: process.cwd(),
      workspaceRoot,
      operatorCodexHome,
      registryPath: "validation/live-journey/registry.json",
      scenarioId: "INSTALL-01",
      codexProgram,
      package: {
        evidenceClass: "local-rehearsal",
        packageName: "@lagrangee/bearing",
        packageVersion: "0.1.1",
        ...localSourceIdentity,
        artifact: {
          path: tarball,
          file: "bearing.tgz",
          sha256: await sha256File(tarball),
        },
        matrixDefinitionSha256,
      },
    });
    expect(manifest.coordinatorIdentity).toBe("codex-coordinator");
    expect(await readFile(`${codexProgram}.args`, "utf8")).toContain("bearing_live_journey");
    const verified = await verifyLiveScenarioGeneration(manifest.paths.manifest);

    expect(verified.scenario.id).toBe("INSTALL-01");
    expect(verified.paths.repository).not.toBe(process.cwd());
    expect(verified.paths.prompts).toHaveLength(1);
    expect(await readFile(verified.paths.prompts[0] as string, "utf8")).toContain(
      verified.paths.installationEntry,
    );
    expect(await readFile(join(verified.paths.repository, "README.md"), "utf8")).toContain(
      "Local loop fixture",
    );
    expect(Bun.file(join(verified.paths.agentHome, ".bearing/kit/current/package.json")).size).toBe(
      0,
    );
  });

  test("preserves session and attempt evidence for bounded retries on the first and later turns", async () => {
    const root = await mkdtemp(join(tmpdir(), "bearing-live-scenario-cli-"));
    const packageRoot = join(root, "package-root");
    const tarball = join(root, "bearing.tgz");
    const operatorCodexHome = join(root, "operator-codex-home");
    const workspaceRoot = join(root, "workspace");
    const fakeCodex = join(root, "codex-fixture");
    const registryPath = join(root, "registry.json");
    await mkdir(join(packageRoot, "package/docs"), { recursive: true });
    await Promise.all([
      writeFile(join(packageRoot, "package/docs/agent-installation.md"), "# Install\n"),
      writeFile(
        join(packageRoot, "package/package.json"),
        '{"name":"@lagrangee/bearing","version":"0.1.1"}\n',
      ),
    ]);
    const packed = Bun.spawnSync(["tar", "-czf", tarball, "package"], {
      cwd: packageRoot,
      stdout: "pipe",
      stderr: "pipe",
    });
    if (packed.exitCode !== 0) throw new Error(packed.stderr.toString());
    await mkdir(operatorCodexHome);
    await writeFile(join(operatorCodexHome, "auth.json"), "{}\n");
    await writeFile(
      fakeCodex,
      `#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "codex-fixture"
  exit 0
fi
if [ "$1" = "sandbox" ]; then
  printf '%s\n' "$@" > "$0.sandbox-probe"
  exit 0
fi
printf '%s\n' "$@" | grep -F 'default_permissions="bearing_live_journey"' >/dev/null || exit 91
printf '%s\n' "$@" | grep -F 'permissions.bearing_live_journey=' >/dev/null || exit 92
if ! /usr/bin/sandbox-exec -p '(version 1)(allow default)' /usr/bin/true; then
  echo "Codex inner sandbox could not start" >&2
  exit 93
fi
if [ ! -f "$0.first-failed" ]; then
  touch "$0.first-failed"
  mkdir -p "$CODEX_HOME/skills/.system/runtime"
  printf '%s\\n' '# Runtime-owned system skill' > "$CODEX_HOME/skills/.system/runtime/SKILL.md"
  printf '%s\\n' '{"type":"thread.started","thread_id":"2e3f0d28-2415-46a6-a46e-f99218f8c721"}'
  printf '%s\\n' '{"type":"turn.started"}'
  printf '%s\\n' '{"type":"turn.failed","error":{"message":"transient network failure"}}'
  exit 7
fi
if [ ! -f "$0.first-complete" ]; then
  touch "$0.first-complete"
  printf '%s\\n' '{"type":"turn.started"}'
  printf '%s\\n' '{"type":"turn.completed"}'
  exit 0
fi
if [ ! -f "$0.second-attempted" ]; then
  touch "$0.second-attempted"
  printf '%s\n' 'harness attempt cache' > "$HOME/harness-attempt-cache"
  printf '%s\n' '{"type":"turn.started"}'
  printf '%s\n' '{"type":"item.completed","item":{"type":"command_execution","command":"gh issue create --title natural","exit_code":70}}'
  echo "transient network failure" >&2
  exit 7
fi
printf '%s\\n' '{"type":"turn.started"}'
printf '%s\\n' '{"type":"turn.completed"}'
`,
    );
    await chmod(fakeCodex, 0o755);
    const trackedRegistry = await loadLiveScenarioRegistry("validation/live-journey/registry.json");
    const trackedScenario = trackedRegistry.scenarios.find(({ id }) => id === "INSTALL-01");
    if (trackedScenario === undefined) throw new Error("INSTALL-01 is unavailable.");
    await writeFile(
      registryPath,
      `${JSON.stringify({
        schemaVersion: 1,
        scenarios: [
          {
            ...trackedScenario,
            prompts: [trackedScenario.prompts[0], "请确认安装后的下一步，但不要配置当前仓库。"],
          },
        ],
      })}\n`,
    );
    const matrixDefinitionSha256 = await liveScenarioDefinitionDigest({
      sourceRoot: process.cwd(),
      registryPath,
    });
    const manifest = await prepareLiveScenarioGeneration({
      sourceRoot: process.cwd(),
      workspaceRoot,
      operatorCodexHome,
      registryPath,
      scenarioId: "INSTALL-01",
      codexProgram: fakeCodex,
      package: {
        evidenceClass: "local-rehearsal",
        packageName: "@lagrangee/bearing",
        packageVersion: "0.1.1",
        sourceHead: "fixture-head",
        worktreeSha256: await localRehearsalWorktreeDigest(process.cwd()),
        artifact: {
          path: tarball,
          file: "bearing.tgz",
          sha256: await sha256File(tarball),
        },
        matrixDefinitionSha256,
      },
    });
    expect(await readFile(`${fakeCodex}.sandbox-probe`, "utf8")).toMatch(
      /sandbox[\s\S]*-P[\s\S]*bearing_live_journey[\s\S]*\/bin\/sh/u,
    );
    const runResult = Bun.spawnSync(
      [
        process.execPath,
        "scripts/run-live-journey.ts",
        "run-scenario-turn",
        "--manifest",
        manifest.paths.manifest,
        "--turn",
        "1",
        "--prompt-file",
        manifest.paths.prompts[0] as string,
      ],
      { cwd: process.cwd(), stdout: "pipe", stderr: "pipe" },
    );
    expect(runResult.exitCode).toBe(1);
    expect(JSON.parse(runResult.stdout.toString())).toMatchObject({
      exitCode: 7,
      terminalBoundary: "turn.failed",
    });
    const firstTurnRetry = Bun.spawnSync(
      [
        process.execPath,
        "scripts/run-live-journey.ts",
        "run-scenario-turn",
        "--manifest",
        manifest.paths.manifest,
        "--turn",
        "1",
        "--prompt-file",
        manifest.paths.prompts[0] as string,
        "--retry-reason",
        "network",
      ],
      { cwd: process.cwd(), stdout: "pipe", stderr: "pipe" },
    );
    expect(firstTurnRetry.exitCode).toBe(0);
    expect(JSON.parse(firstTurnRetry.stdout.toString())).toMatchObject({
      exitCode: 0,
      terminalBoundary: "turn.completed",
    });
    await writeFile(
      join(manifest.paths.agentHome, ".codex/runtime-state.sqlite"),
      "runtime drift\n",
    );
    const failedSecondTurn = Bun.spawnSync(
      [
        process.execPath,
        "scripts/run-live-journey.ts",
        "run-scenario-turn",
        "--manifest",
        manifest.paths.manifest,
        "--turn",
        "2",
        "--prompt-file",
        manifest.paths.prompts[1] as string,
      ],
      { cwd: process.cwd(), stdout: "pipe", stderr: "pipe" },
    );
    expect(failedSecondTurn.exitCode).toBe(1);
    expect(JSON.parse(failedSecondTurn.stdout.toString())).toMatchObject({
      exitCode: 7,
      terminalBoundary: "process-exit-7",
    });
    const retryResult = Bun.spawnSync(
      [
        process.execPath,
        "scripts/run-live-journey.ts",
        "run-scenario-turn",
        "--manifest",
        manifest.paths.manifest,
        "--turn",
        "2",
        "--prompt-file",
        manifest.paths.prompts[1] as string,
        "--retry-reason",
        "harness",
      ],
      { cwd: process.cwd(), stdout: "pipe", stderr: "pipe" },
    );
    expect(retryResult.exitCode).toBe(0);
    expect(JSON.parse(retryResult.stdout.toString())).toMatchObject({
      exitCode: 0,
      terminalBoundary: "turn.completed",
    });

    const registry = await loadLiveScenarioRegistry(registryPath);
    const scenario = registry.scenarios.find(({ id }) => id === "INSTALL-01");
    if (scenario === undefined) throw new Error("INSTALL-01 is unavailable.");
    const verdictPath = join(root, "verdict.json");
    const output = join(root, "INSTALL-01.json");
    await writeFile(
      verdictPath,
      `${JSON.stringify({
        outcome: "pass",
        rationale: "The exact isolated install completed without repository setup.",
        requiredOutcomeObservations: scenario.requiredOutcomes.map((requirement) => ({
          requirement,
          observed: true,
          evidencePointers: ["observations/turn-02-attempt-02.json"],
        })),
        forbiddenOutcomeObservations: scenario.forbiddenOutcomes.map((requirement) => ({
          requirement,
          observed: false,
          evidencePointers: ["observations/turn-02-attempt-02.json"],
        })),
      })}\n`,
    );
    const rejectedOutput = join(root, "INSTALL-01-rejected.json");
    const rejectedEvaluation = Bun.spawnSync(
      [
        process.execPath,
        "scripts/run-live-journey.ts",
        "evaluate-scenario",
        "--manifest",
        manifest.paths.manifest,
        "--verdicts",
        verdictPath,
        "--output",
        rejectedOutput,
      ],
      {
        cwd: process.cwd(),
        env: { ...process.env, PATH: await rejectingGitleaksPath(root) },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    expect(rejectedEvaluation.exitCode).not.toBe(0);
    await expect(access(rejectedOutput)).rejects.toMatchObject({ code: "ENOENT" });
    const cleanupOwnedOutput = join(manifest.paths.agentHome, "scenario-result.json");
    const cleanupScannerRoot = join(root, "cleanup-output");
    await mkdir(cleanupScannerRoot);
    const cleanupScannerPath = await acceptingGitleaksPath(cleanupScannerRoot);
    const rejectedCleanupOutput = Bun.spawnSync(
      [
        process.execPath,
        "scripts/run-live-journey.ts",
        "evaluate-scenario",
        "--manifest",
        manifest.paths.manifest,
        "--verdicts",
        verdictPath,
        "--output",
        cleanupOwnedOutput,
      ],
      {
        cwd: process.cwd(),
        env: { ...process.env, PATH: cleanupScannerPath },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    expect(rejectedCleanupOutput.exitCode).not.toBe(0);
    expect(rejectedCleanupOutput.stderr.toString()).toContain("cleanup-owned storage");
    await expect(access(cleanupOwnedOutput)).rejects.toMatchObject({ code: "ENOENT" });
    const cleanupAlias = join(root, "agent-home-output-alias");
    await symlink(manifest.paths.agentHome, cleanupAlias, "dir");
    const aliasedCleanupOutput = join(cleanupAlias, "scenario-result.json");
    const rejectedAliasedCleanupOutput = Bun.spawnSync(
      [
        process.execPath,
        "scripts/run-live-journey.ts",
        "evaluate-scenario",
        "--manifest",
        manifest.paths.manifest,
        "--verdicts",
        verdictPath,
        "--output",
        aliasedCleanupOutput,
      ],
      {
        cwd: process.cwd(),
        env: { ...process.env, PATH: cleanupScannerPath },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    expect(rejectedAliasedCleanupOutput.exitCode).not.toBe(0);
    expect(rejectedAliasedCleanupOutput.stderr.toString()).toContain("cleanup-owned storage");
    await expect(access(aliasedCleanupOutput)).rejects.toMatchObject({ code: "ENOENT" });
    const evaluation = Bun.spawnSync(
      [
        process.execPath,
        "scripts/run-live-journey.ts",
        "evaluate-scenario",
        "--manifest",
        manifest.paths.manifest,
        "--verdicts",
        verdictPath,
        "--output",
        output,
      ],
      {
        cwd: process.cwd(),
        env: { ...process.env, PATH: await acceptingGitleaksPath(root) },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    expect(evaluation.exitCode).toBe(0);
    expect(JSON.parse(await readFile(output, "utf8"))).toMatchObject({
      scenarioId: "INSTALL-01",
      evaluation: { outcome: "pass" },
      codex: { cliVersion: "codex-fixture" },
      attempts: [
        {
          turn: 1,
          reason: "network",
          testedBehaviorStarted: false,
          priorObservation: { pointer: "observations/turn-01-attempt-01.json" },
        },
        {
          turn: 2,
          reason: "harness",
          testedBehaviorStarted: true,
          priorObservation: { pointer: "observations/turn-02-attempt-01.json" },
        },
      ],
    });
    await expect(lstat(manifest.paths.transcripts)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(lstat(manifest.paths.agentHome)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(lstat(manifest.paths.sessionState)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
