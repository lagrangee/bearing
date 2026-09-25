import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  loadLiveScenarioRegistry,
  materializeLiveScenarioFixture,
  parseLiveScenarioRegistry,
  preflightLiveScenarioRegistry,
  verifyLocalMattKitFixture,
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
  "first-canonical-authoring",
  "planned-effort-delivery",
  "bound-delivery-missing-baseline",
  "effort-conclusion-with-assets",
] as const;

describe("adaptive Live Matrix registry", () => {
  test("keeps upstream source bytes and raw templates separate from fixture project extensions", async () => {
    const fixtureRoot = join(sourceRoot, "tests/fixtures/matt-upstream-contract");
    const receipt = JSON.parse(await readFile(join(fixtureRoot, "source-receipt.json"), "utf8"));
    expect(receipt.repository).toBe("mattpocock/skills");
    expect(receipt.commit).toBe("c55ee46073ed923f86ce59a5eb3b6d895095d1b7");
    for (const source of receipt.sources) {
      const bytes = await readFile(join(fixtureRoot, source.file));
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(source.sha256);
      expect(createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex")).toBe(
        source.gitBlob,
      );
      expect(source.upstreamPath).toBe(`skills/engineering/${source.skill}/${source.source}`);
    }
    for (const template of receipt.templates) {
      const source = await readFile(join(fixtureRoot, template.sourceFile), "utf8");
      const expected = `${source
        .split("\n")
        .slice(template.firstLine - 1, template.lastLine)
        .join("\n")}\n`;
      expect(await readFile(join(fixtureRoot, template.file), "utf8")).toBe(expected);
    }
    for (const provider of ["local-provider", "github-provider"]) {
      const provenance = JSON.parse(
        await readFile(
          join(
            sourceRoot,
            `validation/live-journey/fixtures/${provider}/matt-kit-output/provenance.json`,
          ),
          "utf8",
        ),
      );
      expect(provenance.revalidatedAgainst).toMatchObject({
        repository: receipt.repository,
        commit: receipt.commit,
      });
      for (const source of provenance.revalidatedAgainst.sources) {
        expect(receipt.sources).toContainEqual(
          expect.objectContaining({
            skill: source.skill,
            source: source.source,
            upstreamPath: source.upstreamPath,
            sha256: source.sha256,
            file: source.fixture.replace("tests/fixtures/matt-upstream-contract/", ""),
          }),
        );
        expect(
          provenance.materializedFrom.find((old: { skill: string }) => old.skill === source.skill)
            ?.sha256,
        ).not.toBe(source.sha256);
      }
      const contract = provenance.configuredContract ?? provenance.outputContract;
      expect(contract.projectExtensions.length).toBeGreaterThan(0);
      expect(contract.providerExtensions).toBeUndefined();
      expect(provenance.note).toContain("not regenerated");
      if (provider === "local-provider") {
        expect(contract.projectExtensions).toContain(
          "explicit Local Map lifecycle Status, not required by the upstream Map template",
        );
        expect(contract.projectExtensions).toContain(
          "repository-specific strict Blocked by grammar, distinct from the upstream parenthesized sentinel",
        );
      } else {
        expect(contract.projectExtensions).toContain("Completion evidence");
        expect(contract.projectExtensions).toContain(
          "native parent and blocking relations must agree with body fallbacks",
        );
        expect(contract.projectExtensions).toContain(
          "complete the parent when its only child completes the accepted scope",
        );
      }
    }
  });

  test("rejects a changed upstream source snapshot even when the old materialized artifacts still match", async () => {
    const root = await mkdtemp(join(tmpdir(), "bearing-matt-source-receipt-"));
    roots.push(root);
    await cp(join(sourceRoot, "validation"), join(root, "validation"), { recursive: true });
    await cp(
      join(sourceRoot, "tests/fixtures/matt-upstream-contract"),
      join(root, "tests/fixtures/matt-upstream-contract"),
      { recursive: true },
    );
    await expect(verifyLocalMattKitFixture(root)).resolves.toBeUndefined();
    const source = join(root, "tests/fixtures/matt-upstream-contract/sources/to-tickets.md");
    await writeFile(source, `${await readFile(source, "utf8")}\nChanged upstream source.\n`);
    await expect(verifyLocalMattKitFixture(root)).rejects.toThrow(
      "versioned materialization receipt",
    );
  });

  test("rejects forged upstream paths, digests, and source-file mappings", async () => {
    const root = await mkdtemp(join(tmpdir(), "bearing-matt-source-mapping-"));
    roots.push(root);
    await cp(join(sourceRoot, "validation"), join(root, "validation"), { recursive: true });
    await cp(
      join(sourceRoot, "tests/fixtures/matt-upstream-contract"),
      join(root, "tests/fixtures/matt-upstream-contract"),
      { recursive: true },
    );
    const receiptPath = join(
      root,
      "validation/live-journey/fixtures/local-provider/matt-kit-output/provenance.json",
    );
    const original = await readFile(receiptPath, "utf8");
    for (const mutation of [
      { upstreamPath: "skills/engineering/to-spec/SKILL.md" },
      { sha256: "0".repeat(64) },
      { fixture: "tests/fixtures/matt-upstream-contract/issue-tracker-github.md" },
    ]) {
      const receipt = JSON.parse(original);
      Object.assign(receipt.revalidatedAgainst.sources[0], mutation);
      await writeFile(receiptPath, JSON.stringify(receipt));
      await expect(verifyLocalMattKitFixture(root)).rejects.toThrow(
        "versioned materialization receipt",
      );
    }
  });

  test("declares the exact sixteen semantic scenarios and five semantic fields", async () => {
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
    expect(preflight).toMatchObject({ scenarioCount: 16, semanticReviewRequired: true });

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

  test("keeps the representative GitHub prompt free of tracker and orchestration instructions", async () => {
    const registry = await loadLiveScenarioRegistry(registryPath);
    const scenario = registry.scenarios.find(({ id }) => id === "github-delivery-writeback");
    const prompt = scenario?.initialPrompt;
    expect(prompt).toBe("请完成 Complete secondary label formatting 这张 ticket。");
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

  test("keeps composed native scenarios free of Bearing coaching", async () => {
    const registry = await loadLiveScenarioRegistry(registryPath);
    const scenarios = registry.scenarios.filter(({ id }) =>
      [
        "wayfinder-decision-writeback",
        "local-delivery-writeback",
        "github-delivery-writeback",
      ].includes(id),
    );
    expect(scenarios).toHaveLength(3);
    for (const scenario of scenarios) {
      expect(scenario.fixedValidationFixture.skills).toEqual(
        expect.arrayContaining([{ skill: "bearing", role: "prerequisite" }]),
      );
      for (const coaching of ["$bearing", "reconcile", "capture", "同步回 Bearing"]) {
        expect(scenario.initialPrompt).not.toContain(coaching);
      }
    }
  });
});
