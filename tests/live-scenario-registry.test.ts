import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  assertJourneyAgentPrompt,
  createCodexJourneyEnvironment,
} from "../scripts/live-journey-matrix";
import {
  createLiveScenarioEvaluation,
  digestLiveScenarioFixture,
  loadLiveScenarioRegistry,
  materializeLiveScenarioFixture,
  parseLiveScenarioEvaluation,
  preflightLiveScenarioRegistry,
} from "../scripts/live-scenario-registry";

const sourceRoot = process.cwd();
const registryPath = "validation/live-journey/registry.json";

describe("independent Agent Live scenarios", () => {
  test("preflights the complete declarative registry without starting Agent behavior", async () => {
    const registry = await loadLiveScenarioRegistry(registryPath);
    const scenarioIds = registry.scenarios.map(({ id }) => id);

    expect(registry.schemaVersion).toBe(1);
    expect(new Set(scenarioIds).size).toBe(scenarioIds.length);
    expect(
      registry.scenarios.every(
        ({ prompts, requiredOutcomes, forbiddenOutcomes, composition }) =>
          prompts.length > 0 &&
          requiredOutcomes.length > 0 &&
          forbiddenOutcomes.length > 0 &&
          composition.model === "gpt-5.6-luna" &&
          composition.reasoningEffort === "high" &&
          composition.resourceKeys.length <= 1,
      ),
    ).toBe(true);

    await expect(
      preflightLiveScenarioRegistry({ sourceRoot, registryPath }),
    ).resolves.toMatchObject({
      scenarioCount: scenarioIds.length,
      semanticReviewRequired: true,
      semanticReviewScenarioIds: scenarioIds,
    });

    const command = Bun.spawnSync(
      [
        process.execPath,
        "scripts/run-live-journey.ts",
        "check-matrix-definition",
        "--source-root",
        sourceRoot,
        "--registry",
        registryPath,
      ],
      { cwd: sourceRoot, stdout: "pipe", stderr: "pipe" },
    );
    expect(command.exitCode, command.stderr.toString()).toBe(0);
    expect(JSON.parse(command.stdout.toString())).toMatchObject({
      scenarioCount: scenarioIds.length,
      semanticReviewRequired: true,
      semanticReviewScenarioIds: scenarioIds,
    });
  });

  test("materializes every Scenario from a stable source into an independent output", async () => {
    const registry = await loadLiveScenarioRegistry(registryPath);
    const root = await mkdtemp(join(tmpdir(), "bearing-live-scenario-fixtures-"));
    const sourceDigests = new Map<string, string>();

    for (const { fixture } of registry.scenarios) {
      if (!sourceDigests.has(fixture.source)) {
        sourceDigests.set(
          fixture.source,
          await digestLiveScenarioFixture(resolve(sourceRoot, fixture.source)),
        );
      }
    }

    for (const scenario of registry.scenarios) {
      const outputRoot = join(root, scenario.id);
      const materialized = await materializeLiveScenarioFixture({
        registry,
        scenarioId: scenario.id,
        sourceRoot,
        outputRoot,
      });

      expect(materialized).toMatchObject({
        scenarioId: scenario.id,
        fixtureProfile: scenario.composition.fixtureProfile,
        fixtureRoot: outputRoot,
      });
      expect(materialized.startingStateSha256).toMatch(/^[0-9a-f]{64}$/u);
      expect(await digestLiveScenarioFixture(outputRoot)).toBe(materialized.startingStateSha256);
      await expect(
        materializeLiveScenarioFixture({
          registry,
          scenarioId: scenario.id,
          sourceRoot,
          outputRoot,
        }),
      ).rejects.toThrow("already exists");
    }

    for (const [fixtureSource, digest] of sourceDigests) {
      expect(await digestLiveScenarioFixture(resolve(sourceRoot, fixtureSource))).toBe(digest);
    }
  });

  test("keeps Scenario identity, criteria, and operator secrets outside Agent input", async () => {
    const registry = await loadLiveScenarioRegistry(registryPath);
    const scenarioIds = registry.scenarios.map(({ id }) => id);

    expect(() =>
      assertJourneyAgentPrompt(`Please complete ${scenarioIds[0]}.`, scenarioIds),
    ).toThrow("black-box");
    expect(
      assertJourneyAgentPrompt("Please complete the requested repository task.", scenarioIds),
    ).toBe("Please complete the requested repository task.");
    for (const privateTerm of ["pass criteria", "expected command", "matrix case"]) {
      expect(() =>
        assertJourneyAgentPrompt(`The ${privateTerm} stays private from the Agent.`, scenarioIds),
      ).toThrow("black-box");
    }

    const environment = createCodexJourneyEnvironment(
      {
        PATH: "/operator/private/bin:/usr/bin:/bin",
        TMPDIR: "/operator/private/tmp",
        USER: "operator",
        LOGNAME: "operator",
        LANG: "en_US.UTF-8",
        GH_TOKEN: "operator-secret",
        MATRIX_PASS_CRITERIA: "private criteria",
      },
      {
        HOME: "/isolated/home",
        CODEX_HOME: "/isolated/home/.codex",
        TMPDIR: "/isolated/runtime/tmp",
        PATH: "/isolated/node/bin:/usr/bin:/bin:/usr/sbin:/sbin",
      },
    );
    expect(environment).toMatchObject({
      HOME: "/isolated/home",
      CODEX_HOME: "/isolated/home/.codex",
      TMPDIR: "/isolated/runtime/tmp",
      PATH: "/isolated/home/.bearing/bin:/isolated/node/bin:/usr/bin:/bin:/usr/sbin:/sbin",
      LANG: "en_US.UTF-8",
    });
    expect(environment).not.toHaveProperty("USER");
    expect(environment).not.toHaveProperty("LOGNAME");
    expect(environment).not.toHaveProperty("GH_TOKEN");
    expect(environment).not.toHaveProperty("MATRIX_PASS_CRITERIA");
  });

  test("exposes one no-retry Generation runner surface", () => {
    const result = Bun.spawnSync([process.execPath, "scripts/run-live-journey.ts", "--help"], {
      cwd: sourceRoot,
      stdout: "pipe",
      stderr: "pipe",
    });
    const help = result.stdout.toString();

    expect(result.exitCode, result.stderr.toString()).toBe(0);
    expect(help).toContain("check-matrix-definition");
    expect(help).not.toContain("preflight-matrix");
    expect(help).toContain("prepare-generation");
    expect(help).toContain("run-generation");
    expect(help).toContain("evaluate-scenario");
    expect(help).toContain("complete-matrix");
    for (const retired of [
      "--journey-attempt",
      "--retry-reason",
      "matrix-status",
      "recover-evidence-publication",
      "inspect-evidence-bundle",
      "inspect-generation",
      "prepare-scenario",
      "run-scenario-turn",
    ]) {
      expect(help).not.toContain(retired);
    }
  });

  test("keeps semantic judgment with the Coordinator and rejects observable conflicts", async () => {
    const registry = await loadLiveScenarioRegistry(registryPath);
    const scenario = registry.scenarios[0];
    if (scenario === undefined) throw new Error("Tracked Live Scenario is unavailable.");
    const evidencePointers = ["observations/turn-01.json"];
    const requiredOutcomeObservations = scenario.requiredOutcomes.map((requirement) => ({
      requirement,
      observed: true,
      evidencePointers,
    }));
    const forbiddenOutcomeObservations = scenario.forbiddenOutcomes.map((requirement) => ({
      requirement,
      observed: false,
      evidencePointers,
    }));

    const result = createLiveScenarioEvaluation({
      scenario,
      outcome: "pass",
      coordinatorIdentity: "codex-coordinator",
      rationale: "The required outcome was observed without a forbidden outcome.",
      requiredOutcomeObservations,
      forbiddenOutcomeObservations,
    });
    expect(result).toMatchObject({
      scenarioId: scenario.id,
      outcome: "pass",
      semanticEvaluationAuthority: "coordinating-agent",
    });
    expect(() => parseLiveScenarioEvaluation({ ...result, outcome: "not-run" })).toThrow();

    expect(() =>
      createLiveScenarioEvaluation({
        scenario,
        outcome: "pass",
        coordinatorIdentity: "codex-coordinator",
        rationale: "The claimed pass contradicts an observed forbidden outcome.",
        requiredOutcomeObservations,
        forbiddenOutcomeObservations: scenario.forbiddenOutcomes.map((requirement) => ({
          requirement,
          observed: true,
          evidencePointers,
        })),
      }),
    ).toThrow("contradicts");
  });
});
