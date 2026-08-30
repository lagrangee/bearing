import { afterEach, describe, expect, test } from "bun:test";
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  materializeDeclaredPrerequisiteSkills,
  materializeLiveScenarioProductState,
} from "../scripts/live-scenario-product";
import {
  digestLiveScenarioFixtureSet,
  loadLiveScenarioRegistry,
  preflightLiveScenarioRegistry,
} from "../scripts/live-scenario-registry";
import { liveScenarioDefinitionDigest } from "../scripts/live-scenario-runner";

const expectedScenarioIds = [
  "INSTALL-01",
  "ENTRY-03",
  "CONFIG-01",
  "CONFIG-02",
  "CONFIG-UPDATE-01",
  "GUIDE-01",
  "INTAKE-01",
  "NATIVE-01",
  "NATIVE-04",
  "STOP-03",
  "NATIVE-05",
  "NATIVE-02",
  "NATIVE-03",
  "STOP-01",
  "STOP-02",
  "WAYFINDER-01",
  "DELIVERY-01",
  "DELIVERY-02",
] as const;

const expectedFixtureSources = [
  "validation/live-journey/fixtures/code-minimal",
  "validation/live-journey/fixtures/delivery-minimal",
  "validation/live-journey/fixtures/lifecycle-minimal",
  "validation/live-journey/fixtures/planning-native-minimal",
] as const;

const temporaryRoots: string[] = [];
afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

const scenarioById = async (id: (typeof expectedScenarioIds)[number]) => {
  const registry = await loadLiveScenarioRegistry("validation/live-journey/registry.json");
  const scenario = registry.scenarios.find((candidate) => candidate.id === id);
  if (scenario === undefined) throw new Error(`${id} is unavailable.`);
  return scenario;
};

describe("KISS Live Scenario inventory", () => {
  test("tracks exactly the eighteen representative scenarios on four fixture families", async () => {
    const registry = await loadLiveScenarioRegistry("validation/live-journey/registry.json");

    expect(registry.scenarios.map(({ id }) => id)).toEqual([...expectedScenarioIds]);
    expect([...new Set(registry.scenarios.map(({ fixture }) => fixture.source))].sort()).toEqual([
      ...expectedFixtureSources,
    ]);
    const deterministicOnly = new Set([
      "ENTRY-01",
      "ENTRY-02",
      "CONFIG-03",
      "CONFIG-05",
      "CONFIG-06",
      "PLAN-01",
      "PLAN-02",
      "PLAN-03",
      "CATALOG-01",
    ]);
    expect(registry.scenarios.filter(({ id }) => deterministicOnly.has(id))).toEqual([]);

    const preflight = await preflightLiveScenarioRegistry({
      sourceRoot: process.cwd(),
      registryPath: "validation/live-journey/registry.json",
    });
    expect(preflight.scenarioCount).toBe(18);
    expect(preflight.semanticReviewScenarioIds).toEqual([...expectedScenarioIds]);
  });

  test("identities include only fixtures referenced by the registry or selected Scenarios", async () => {
    const root = await mkdtemp(join(tmpdir(), "bearing-live-fixture-identity-"));
    temporaryRoots.push(root);
    const registryPath = "validation/live-journey/registry.json";
    await mkdir(join(root, "validation/live-journey/fixtures"), { recursive: true });
    await cp(registryPath, join(root, registryPath));
    for (const source of expectedFixtureSources) {
      await cp(source, join(root, source), { recursive: true });
    }
    const registry = await loadLiveScenarioRegistry(join(root, registryPath));
    const matrixBefore = await liveScenarioDefinitionDigest({
      sourceRoot: root,
      registryPath,
    });
    const selectedBefore = await digestLiveScenarioFixtureSet({
      sourceRoot: root,
      registry,
      scenarioIds: ["INSTALL-01"],
    });

    const unreferenced = join(root, "validation/live-journey/fixtures/legacy-unused");
    await mkdir(unreferenced);
    await writeFile(join(unreferenced, "state.txt"), "unreferenced\n");
    expect(await liveScenarioDefinitionDigest({ sourceRoot: root, registryPath })).toBe(
      matrixBefore,
    );
    expect(
      await digestLiveScenarioFixtureSet({
        sourceRoot: root,
        registry,
        scenarioIds: ["INSTALL-01"],
      }),
    ).toBe(selectedBefore);

    await writeFile(join(root, expectedFixtureSources[1], "identity-probe.txt"), "referenced\n");
    expect(await liveScenarioDefinitionDigest({ sourceRoot: root, registryPath })).not.toBe(
      matrixBefore,
    );
    expect(
      await digestLiveScenarioFixtureSet({
        sourceRoot: root,
        registry,
        scenarioIds: ["INSTALL-01"],
      }),
    ).toBe(selectedBefore);

    await writeFile(join(root, expectedFixtureSources[0], "identity-probe.txt"), "selected\n");
    expect(
      await digestLiveScenarioFixtureSet({
        sourceRoot: root,
        registry,
        scenarioIds: ["INSTALL-01"],
      }),
    ).not.toBe(selectedBefore);
  });

  test("keeps lifecycle, native, and delivery fixture context bounded", async () => {
    await expect(
      lstat("validation/live-journey/fixtures/lifecycle-minimal/.scratch/label-delivery"),
    ).rejects.toMatchObject({ code: "ENOENT" });
    expect(
      (
        await readdir(
          "validation/live-journey/fixtures/planning-native-minimal/.scratch/label-delivery/issues",
        )
      ).sort(),
    ).toEqual(["01-update-output.md"]);
    expect(
      (
        await readdir(
          "validation/live-journey/fixtures/delivery-minimal/.scratch/label-delivery/issues",
        )
      ).sort(),
    ).toEqual(["04-complete-secondary-format.md"]);
    expect(
      await readFile(
        "validation/live-journey/fixtures/delivery-minimal/src/format-label.ts",
        "utf8",
      ),
    ).toContain("formatPrimaryLabel");
  });

  test("declares the real Wayfinder and Implement compositions", async () => {
    const native = await scenarioById("NATIVE-02");
    const wayfinder = await scenarioById("WAYFINDER-01");
    const localDelivery = await scenarioById("DELIVERY-01");
    const githubDelivery = await scenarioById("DELIVERY-02");

    expect(native.composition.skills.map(({ skill }) => skill)).toEqual([
      "bearing",
      "wayfinder",
      "grilling",
      "domain-modeling",
    ]);
    expect(native.prompts).toHaveLength(2);
    expect(native.prompts[0]).toMatch(/Wayfinder/iu);
    expect(wayfinder.composition.skills.map(({ skill }) => skill)).toEqual([
      "bearing",
      "wayfinder",
      "grilling",
      "domain-modeling",
    ]);
    expect(wayfinder.forbiddenOutcomes.join("\n")).toMatch(/creates a Map/iu);

    const implementComposition = ["bearing", "implement", "tdd", "code-review"] as const;
    expect(localDelivery.composition.skills.map(({ skill }) => skill)).toEqual([
      ...implementComposition,
    ]);
    expect(githubDelivery.composition.skills.map(({ skill }) => skill)).toEqual([
      ...implementComposition,
    ]);
    expect(localDelivery.prompts.join("\n")).toMatch(/Implement Skill/iu);
    expect(githubDelivery.prompts.join("\n")).toMatch(/Implement Skill/iu);
    expect(githubDelivery.composition).toMatchObject({
      capabilityProfile: "github-bounded-delivery",
      resourceKeys: ["github-validation-repository"],
    });
  });

  test("materializes NATIVE-02 as one claimed grilling ticket", async () => {
    const root = await mkdtemp(join(tmpdir(), "bearing-live-native-02-"));
    temporaryRoots.push(root);
    const repositoryRoot = join(root, "repository");
    const agentHome = join(root, "agent-home");
    const native = await scenarioById("NATIVE-02");
    await Promise.all([
      cp(native.fixture.source, repositoryRoot, { recursive: true }),
      mkdir(agentHome),
    ]);
    const initialized = Bun.spawnSync(["git", "init", "-q"], {
      cwd: repositoryRoot,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(initialized.exitCode, initialized.stderr.toString()).toBe(0);

    await materializeLiveScenarioProductState({
      scenario: native,
      sourceRoot: process.cwd(),
      repositoryRoot,
      productProgram: join(process.cwd(), "dist/cli.js"),
      agentHome,
    });

    const issueRoot = join(repositoryRoot, ".scratch/label-delivery/issues");
    expect(await readdir(issueRoot)).toEqual(["05-decide-secondary-label-casing.md"]);
    expect(
      await readFile(join(issueRoot, "05-decide-secondary-label-casing.md"), "utf8"),
    ).toContain("Type: grilling");
  });

  test("copies only declared non-Bearing prerequisite Skills from the trusted root", async () => {
    const root = await mkdtemp(join(tmpdir(), "bearing-live-skills-"));
    temporaryRoots.push(root);
    const trustedSkillRoot = join(root, "trusted");
    const targetSkillRoot = join(root, "target");
    await Promise.all([mkdir(trustedSkillRoot), mkdir(targetSkillRoot)]);
    for (const skill of ["implement", "tdd", "code-review", "ambient"]) {
      await mkdir(join(trustedSkillRoot, skill));
      await writeFile(join(trustedSkillRoot, skill, "SKILL.md"), `# ${skill}\n`);
    }

    const materialized = await materializeDeclaredPrerequisiteSkills({
      scenario: await scenarioById("DELIVERY-01"),
      trustedSkillRoot,
      targetSkillRoot,
    });

    expect(materialized).toEqual(["implement", "tdd", "code-review"]);
    expect((await readdir(targetSkillRoot)).sort()).toEqual(["code-review", "implement", "tdd"]);
    await expect(lstat(join(targetSkillRoot, "bearing"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(lstat(join(targetSkillRoot, "ambient"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      materializeDeclaredPrerequisiteSkills({
        scenario: await scenarioById("DELIVERY-01"),
        trustedSkillRoot,
        targetSkillRoot,
      }),
    ).rejects.toThrow("target already exists");
  });

  test("rejects a declared Skill that escapes the trusted root", async () => {
    const root = await mkdtemp(join(tmpdir(), "bearing-live-skill-escape-"));
    temporaryRoots.push(root);
    const trustedSkillRoot = join(root, "trusted");
    const outside = join(root, "outside");
    const targetSkillRoot = join(root, "target");
    await Promise.all([mkdir(trustedSkillRoot), mkdir(outside), mkdir(targetSkillRoot)]);
    await writeFile(join(outside, "SKILL.md"), "# outside\n");
    await symlink(outside, join(trustedSkillRoot, "wayfinder"));

    await expect(
      materializeDeclaredPrerequisiteSkills({
        scenario: await scenarioById("WAYFINDER-01"),
        trustedSkillRoot,
        targetSkillRoot,
      }),
    ).rejects.toThrow("escapes the trusted root");
  });
});
