import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  loadLiveScenarioRegistry,
  materializeLiveScenarioFixture,
  parseLiveScenarioRegistry,
  preflightLiveScenarioRegistry,
} from "../scripts/live-scenario-registry";

const sourceRoot = resolve(import.meta.dir, "..");
const registryPath = join(sourceRoot, "validation/live-journey/registry.json");
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const scenarioIds = [
  "install-exact-package",
  "ordinary-work-restraint",
  "configure-fresh-repository",
  "repair-active-configuration",
  "update-repository-integration",
  "project-orientation",
  "mixed-feature-intake",
  "accept-native-enrollment",
  "decline-native-enrollment",
  "wayfinder-decision-writeback",
  "local-delivery-writeback",
  "github-delivery-writeback",
] as const;

describe("adaptive Live Matrix registry", () => {
  test("declares the exact twelve semantic scenarios and five semantic fields", async () => {
    const registry = await loadLiveScenarioRegistry(registryPath);
    expect(registry.schemaVersion).toBe(2);
    expect(registry.scenarios.map(({ id }) => id)).toEqual([...scenarioIds]);
    for (const scenario of registry.scenarios) {
      expect(Object.keys(scenario).sort()).toEqual([
        "bearingIntent",
        "fixedValidationFixture",
        "humanPosition",
        "id",
        "initialPrompt",
        "terminalEvidence",
      ]);
      expect(scenario.initialPrompt.trim()).not.toBe("");
      expect(scenario.humanPosition.trim()).not.toBe("");
      expect(scenario.bearingIntent.trim()).not.toBe("");
      expect(scenario.terminalEvidence.observers.length).toBeGreaterThan(0);
    }
  });

  test("contains no fixed-turn or deterministic semantic-evaluator contract", async () => {
    const bytes = await readFile(registryPath, "utf8");
    for (const legacy of ["prompts", "requiredOutcomes", "forbiddenOutcomes", "composition"]) {
      expect(bytes).not.toContain(`"${legacy}"`);
    }
    const process = Bun.spawnSync(["bun", "scripts/run-live-journey.ts", "--help"], {
      cwd: sourceRoot,
      stdout: "pipe",
      stderr: "pipe",
    });
    const help = process.stdout.toString();
    expect(process.exitCode).toBe(0);
    for (const operation of [
      "prepare-generation",
      "start-scenario",
      "resume-scenario",
      "finalize-scenario",
      "complete-matrix",
    ]) {
      expect(help).toContain(operation);
    }
    expect(help).not.toContain("run-generation");
    expect(help).not.toContain("evaluate-scenario");
  });

  test("preflights and materializes the declared validation fixtures", async () => {
    const registry = await loadLiveScenarioRegistry(registryPath);
    const preflight = await preflightLiveScenarioRegistry({
      sourceRoot,
      registryPath: "validation/live-journey/registry.json",
    });
    expect(preflight).toMatchObject({ scenarioCount: 12, semanticReviewRequired: true });

    const root = await mkdtemp(join(tmpdir(), "bearing-semantic-fixture-"));
    roots.push(root);
    const materialized = await materializeLiveScenarioFixture({
      registry,
      scenarioId: "ordinary-work-restraint",
      sourceRoot,
      outputRoot: join(root, "fixture"),
    });
    expect(materialized.fixtureProfile).toBe("active-repository");
    expect(materialized.startingStateSha256).toMatch(/^[0-9a-f]{64}$/u);
  });

  test("rejects legacy numeric ids and undeclared semantic fields", async () => {
    const registry = await loadLiveScenarioRegistry(registryPath);
    const scenario = registry.scenarios[0];
    expect(scenario).toBeDefined();
    expect(() =>
      parseLiveScenarioRegistry({
        schemaVersion: 2,
        scenarios: [{ ...scenario, id: "INSTALL-01", prompts: [scenario?.initialPrompt] }],
      }),
    ).toThrow();
  });

  test("keeps the representative GitHub prompt free of tracker and owner-return instructions", async () => {
    const registry = await loadLiveScenarioRegistry(registryPath);
    const scenario = registry.scenarios.find(({ id }) => id === "github-delivery-writeback");
    const prompt = scenario?.initialPrompt;
    expect(prompt).toBe("请完成 Implement canonical ready-label predicate 这张 ticket。");
    for (const forbidden of [
      "GitHub",
      "issue",
      "$implement",
      "write back",
      "reconcile",
      "协调",
      "同步",
    ]) {
      expect(prompt?.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
    expect(scenario?.humanPosition).toContain("configured parent completion rules");
    expect(scenario?.terminalEvidence.description).toContain("contract-governed parent completion");
    expect(scenario?.terminalEvidence.description).toContain("preserved native relations");
  });
});
