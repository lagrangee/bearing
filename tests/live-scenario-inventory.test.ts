import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  loadLiveScenarioRegistry,
  materializeLiveScenarioFixture,
} from "../scripts/live-scenario-registry";

const sourceRoot = resolve(import.meta.dir, "..");
const registryPath = join(sourceRoot, "validation/live-journey/registry.json");
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Live Matrix validation fixture inventory", () => {
  test("every semantic scenario has one reproducible fixed fixture", async () => {
    const registry = await loadLiveScenarioRegistry(registryPath);
    const root = await mkdtemp(join(tmpdir(), "bearing-live-inventory-"));
    roots.push(root);
    const materialized = await Promise.all(
      registry.scenarios.map((scenario) =>
        materializeLiveScenarioFixture({
          registry,
          scenarioId: scenario.id,
          sourceRoot,
          outputRoot: join(root, scenario.id),
        }),
      ),
    );
    expect(materialized).toHaveLength(12);
    expect(
      materialized.every(({ startingStateSha256 }) => /^[0-9a-f]{64}$/u.test(startingStateSha256)),
    ).toBe(true);
  });

  test("keeps GitHub capability and observer on the GitHub scenario only", async () => {
    const registry = await loadLiveScenarioRegistry(registryPath);
    const github = registry.scenarios.filter(
      ({ fixedValidationFixture }) => fixedValidationFixture.capabilityProfile !== undefined,
    );
    expect(github.map(({ id }) => id)).toEqual(["github-delivery-writeback"]);
    expect(github[0]?.terminalEvidence.observers).toContain("github");
    expect(
      registry.scenarios
        .filter(({ id }) => id !== "github-delivery-writeback")
        .every(({ terminalEvidence }) => !terminalEvidence.observers.includes("github")),
    ).toBe(true);
  });

  test("keeps installation and prerequisite roles mutually exclusive", async () => {
    const registry = await loadLiveScenarioRegistry(registryPath);
    const installation = registry.scenarios.find(({ id }) => id === "install-exact-package");
    expect(installation?.fixedValidationFixture.skills).toEqual([
      { skill: "bearing", role: "installation-under-test" },
    ]);
    expect(
      registry.scenarios
        .filter(({ id }) => id !== "install-exact-package")
        .every(({ fixedValidationFixture }) =>
          fixedValidationFixture.skills.some(
            ({ skill, role }) => skill === "bearing" && role === "prerequisite",
          ),
        ),
    ).toBe(true);
  });
});
