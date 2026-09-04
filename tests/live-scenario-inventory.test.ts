import { afterEach, describe, expect, test } from "bun:test";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  loadLiveScenarioRegistry,
  materializeLiveScenarioFixture,
  preflightLiveScenarioRegistry,
} from "../scripts/live-scenario-registry";
import { createLocalMarkdownMattProvider } from "../src/providers/matt-skills-v1/local-markdown";

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

  test("declares the real Wayfinder entry as a user invocation", async () => {
    const registry = await loadLiveScenarioRegistry(registryPath);
    const scenario = registry.scenarios.find(({ id }) => id === "wayfinder-decision-writeback");
    expect(scenario?.fixedValidationFixture.skills).toContainEqual({
      skill: "wayfinder",
      role: "user-invoked",
    });
    expect(
      scenario?.fixedValidationFixture.skills.filter(({ role }) => role === "user-invoked"),
    ).toHaveLength(1);
  });

  test("uses a canonical Delivery ticket in the shared planning fixture", async () => {
    const fixtureRoot = join(
      sourceRoot,
      "validation/live-journey/fixtures/planning-native-minimal",
    );
    const result = await createLocalMarkdownMattProvider({
      repoRoot: fixtureRoot,
      contractLocator: "docs/agents/issue-tracker.md",
      triageLocator: "docs/agents/triage-labels.md",
      clock: () => new Date("2026-09-03T00:00:00Z"),
    }).capture({ provider: "matt-skills/v1", nativeScope: ".scratch/label-delivery" });

    expect(result.diagnostics).toEqual([]);
    expect(result.projection?.wayfinderTickets).toEqual([]);
    expect(result.projection?.deliveryTickets).toEqual([
      expect.objectContaining({
        ref: ".scratch/label-delivery/issues/01-update-output.md",
        lifecycle: { state: "open" },
      }),
    ]);
  });

  test("keeps Local Matt fixture artifacts on their versioned materialization receipt", async () => {
    const root = await mkdtemp(join(tmpdir(), "bearing-local-matt-fixture-contract-"));
    roots.push(root);
    await cp(join(sourceRoot, "validation"), join(root, "validation"), { recursive: true });
    const prd = join(
      root,
      "validation/live-journey/fixtures/planning-native-minimal/.scratch/label-delivery/PRD.md",
    );
    await writeFile(prd, `${await readFile(prd, "utf8")}\nChanged outside Matt Kit output.\n`);

    await expect(
      preflightLiveScenarioRegistry({
        sourceRoot: root,
        registryPath: "validation/live-journey/registry.json",
      }),
    ).rejects.toThrow("Local Matrix Matt Kit output does not match");
  });

  test("starts Local delivery from a real ready-for-agent ticket", async () => {
    const ticket = await readFile(
      join(
        sourceRoot,
        "validation/live-journey/fixtures/delivery-minimal/.scratch/label-delivery/issues/04-complete-secondary-format.md",
      ),
      "utf8",
    );
    expect(ticket).toContain("**Status:** ready-for-agent");
    expect(ticket).not.toContain("**Status:** claimed");
  });

  test("keeps disposable Bearing cache outside fixture Git history", async () => {
    for (const fixture of ["lifecycle-minimal", "planning-native-minimal", "delivery-minimal"]) {
      const ignore = await readFile(
        join(sourceRoot, "validation/live-journey/fixtures", fixture, ".gitignore"),
        "utf8",
      );
      expect(ignore.split("\n")).toContain(".bearing/cache/");
    }
  });

  test("keeps one Matt-aligned Local Delivery completion contract", async () => {
    const fixtures = ["lifecycle-minimal", "planning-native-minimal", "delivery-minimal"];
    const contracts = await Promise.all(
      fixtures.map((fixture) =>
        readFile(
          join(
            sourceRoot,
            "validation/live-journey/fixtures",
            fixture,
            "docs/agents/issue-tracker.md",
          ),
          "utf8",
        ),
      ),
    );
    expect(new Set(contracts)).toHaveLength(1);
    expect(contracts[0]).toContain(
      "Provider-native scope is the feature directory `.scratch/<feature-slug>/`",
    );
    expect(contracts[0]).toContain("## Delivery operations");
    const deliveryContract = contracts[0]
      ?.split("## Delivery operations")[1]
      ?.split("## Wayfinding operations")[0];
    expect(deliveryContract).toBeDefined();
    expect(deliveryContract).toContain("Markdown preamble");
    expect(deliveryContract).toContain("**What to build:**");
    expect(deliveryContract).toContain("**Blocked by:**");
    expect(deliveryContract).toContain("**Status:**");
    expect(deliveryContract).toContain("- [ ] Acceptance criterion");
    expect(contracts[0]).toContain("set `Status: resolved`");
    expect(contracts[0]).toContain("under an `## Answer` heading");

    const labels = await readFile(
      join(
        sourceRoot,
        "validation/live-journey/fixtures/delivery-minimal/docs/agents/triage-labels.md",
      ),
      "utf8",
    );
    expect(labels).toContain("Requires Human implementation");
    expect(labels).not.toContain("Ready for Human review");
  });

  test("uses the current Matt Spec and Wayfinder section topology", async () => {
    for (const fixture of ["planning-native-minimal", "delivery-minimal"]) {
      const nativeRoot = join(
        sourceRoot,
        "validation/live-journey/fixtures",
        fixture,
        ".scratch/label-delivery",
      );
      const prd = await readFile(join(nativeRoot, "PRD.md"), "utf8");
      const map = await readFile(join(nativeRoot, "map.md"), "utf8");
      for (const heading of [
        "## Problem Statement",
        "## Solution",
        "## User Stories",
        "## Implementation Decisions",
        "## Testing Decisions",
        "## Out of Scope",
        "## Further Notes",
      ]) {
        expect(prd).toContain(heading);
      }
      expect(map).toContain("## Not yet specified");
      expect(map).not.toContain("## Fog");
    }
  });

  test("projects the final Local delivery and Wayfinder fixture shapes without diagnostics", async () => {
    const deliveryRoot = join(sourceRoot, "validation/live-journey/fixtures/delivery-minimal");
    const delivery = await createLocalMarkdownMattProvider({
      repoRoot: deliveryRoot,
      contractLocator: "docs/agents/issue-tracker.md",
      triageLocator: "docs/agents/triage-labels.md",
      clock: () => new Date("2026-09-03T00:00:00Z"),
    }).capture({ provider: "matt-skills/v1", nativeScope: ".scratch/label-delivery" });
    expect(delivery.diagnostics).toEqual([]);
    expect(delivery.projection?.deliveryTickets).toHaveLength(1);
    expect(delivery.projection?.wayfinderTickets).toEqual([]);

    const wayfinderRoot = await mkdtemp(join(tmpdir(), "bearing-local-wayfinder-fixture-"));
    roots.push(wayfinderRoot);
    await cp(
      join(sourceRoot, "validation/live-journey/fixtures/planning-native-minimal"),
      wayfinderRoot,
      { recursive: true },
    );
    await rm(join(wayfinderRoot, ".scratch/label-delivery/issues/01-update-output.md"));
    await cp(
      join(
        sourceRoot,
        "validation/live-journey/fixtures/local-provider/matt-kit-output/wayfinder-ticket.md",
      ),
      join(wayfinderRoot, ".scratch/label-delivery/issues/05-decide-secondary-label-casing.md"),
    );
    const wayfinder = await createLocalMarkdownMattProvider({
      repoRoot: wayfinderRoot,
      contractLocator: "docs/agents/issue-tracker.md",
      triageLocator: "docs/agents/triage-labels.md",
      clock: () => new Date("2026-09-03T00:00:00Z"),
    }).capture({ provider: "matt-skills/v1", nativeScope: ".scratch/label-delivery" });
    expect(wayfinder.diagnostics).toEqual([]);
    expect(wayfinder.projection?.deliveryTickets).toEqual([]);
    expect(wayfinder.projection?.wayfinderTickets).toEqual([
      expect.objectContaining({
        subtype: "grilling",
        lifecycle: { state: "open" },
        claim: { state: "unclaimed" },
      }),
    ]);
  });

  test("keeps Local Delivery separate from Wayfinder Map resolution", async () => {
    const map = await readFile(
      join(
        sourceRoot,
        "validation/live-journey/fixtures/delivery-minimal/.scratch/label-delivery/map.md",
      ),
      "utf8",
    );
    expect(map).toContain("## Decisions so far\n\n## Not yet specified");
    expect(map).not.toContain("04-complete-secondary-format.md");
  });
});
