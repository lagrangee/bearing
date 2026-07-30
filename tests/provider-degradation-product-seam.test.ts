import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  createProviderScopeCapture,
  type ProviderDiagnostic,
  type ProviderScopeCapture,
} from "../src/native-work-provider";
import { createProjectMaterializer } from "../src/portal/project-materializer";
import { buildRoadmapDetailModel } from "../src/portal-ui/project-roadmap-model";
import { buildProjectSnapshot } from "../src/project-snapshot/projection";
import type { MattProviderFactory } from "../src/provider-capture-generation";
import type { MattSkillsV1ScopeCapture } from "../src/providers/matt-skills-v1/capture";
import type { MattScopeProjection } from "../src/providers/matt-skills-v1/model";
import { prepareSync } from "../src/sync-plan";
import { createValidBearingRepo, writeFixture } from "./helpers";

const emptyProjection: MattScopeProjection = {
  wayfinderTickets: [],
  deliveryTickets: [],
  incomingIssues: [],
  graph: { parentChild: [], blockedBy: [] },
};

const failureScenarios = [
  {
    slug: "contract",
    code: "matt.local.contract.unsupported",
    class: "contract",
    state: "invalid",
    freshness: "undetermined",
    coverage: "incomplete",
    completion: "undetermined",
  },
  {
    slug: "scope",
    code: "matt.local.scope.invalid",
    class: "source",
    state: "absent",
    freshness: "current",
    coverage: "complete",
    completion: "incomplete",
  },
  {
    slug: "local-safety",
    code: "matt.local.input.unsafe",
    class: "source",
    state: "partial",
    freshness: "current",
    coverage: "incomplete",
    completion: "undetermined",
  },
  {
    slug: "decode",
    code: "matt.local.decode.title",
    class: "format",
    state: "invalid",
    freshness: "current",
    coverage: "incomplete",
    completion: "undetermined",
  },
  {
    slug: "relations",
    code: "matt.local.relation.broken",
    class: "mapping",
    state: "partial",
    freshness: "current",
    coverage: "incomplete",
    completion: "undetermined",
  },
  {
    slug: "github-acquisition",
    code: "matt.github.acquisition.network",
    class: "network",
    state: "invalid",
    freshness: "undetermined",
    coverage: "incomplete",
    completion: "undetermined",
  },
  {
    slug: "freshness",
    code: "matt.github.concurrent-change",
    class: "concurrency",
    state: "available",
    freshness: "stale",
    coverage: "complete",
    completion: "incomplete",
  },
  {
    slug: "workflow",
    code: "matt.github.workflow.claimant-ambiguous",
    class: "mapping",
    state: "available",
    freshness: "current",
    coverage: "complete",
    completion: "incomplete",
  },
  {
    slug: "aggregation",
    code: "matt.github.scope.duplicate-child",
    class: "mapping",
    state: "available",
    freshness: "current",
    coverage: "complete",
    completion: "undetermined",
  },
] as const;

const writeDegradedRoadmap = async (root: string): Promise<void> => {
  await writeFixture(
    root,
    ".bearing/state/roadmap-index.md",
    `---
Type: roadmap-index
Roadmaps:
  - roadmap:test
  - roadmap:degraded
---

# Roadmap Index
`,
  );
  await writeFixture(
    root,
    ".bearing/state/roadmaps/degraded.md",
    `---
Type: roadmap
ID: roadmap:degraded
Title: Degraded Roadmap
Status: active
Focused gate: gate:degraded
Gate order:
  - gate:degraded
---

# Roadmap: Degraded

## Intent

Keep expected provider failures scoped.
`,
  );
  await writeFixture(
    root,
    ".bearing/state/milestone-gates/degraded.md",
    `---
Type: milestone-gate
ID: gate:degraded
Title: Degraded Gate
Roadmap: roadmap:degraded
Status: active
---

# Milestone Gate: Degraded

## Intent

Preserve readable partial work without false readiness.

## Exit Criteria

- Every degraded capture remains non-terminal.
`,
  );
  for (const scenario of failureScenarios) {
    await writeFixture(
      root,
      `.bearing/state/efforts/degraded-${scenario.slug}.md`,
      `---
Type: effort
Lifecycle: active
Planned at: null
Activated at: null
ID: effort:degraded-${scenario.slug}
Title: Degraded ${scenario.slug}
Roadmap: roadmap:degraded
Target gate: gate:degraded
Authorities: []
Citations: []
Work binding:
  Provider: matt-skills/v1
  Native scope: .scratch/degraded/${scenario.slug}
---

# Effort: Degraded ${scenario.slug}

## Intent

Exercise ${scenario.code}.

## Work

- Retain scoped provider evidence.
`,
    );
  }
};

const writeRealLocalDegradedScope = async (root: string): Promise<void> => {
  await writeFixture(
    root,
    ".bearing/state/efforts/degraded-cli.md",
    `---
Type: effort
Lifecycle: active
Planned at: null
Activated at: null
ID: effort:degraded-cli
Title: Degraded CLI Effort
Roadmap: roadmap:test
Target gate: gate:test
Authorities: []
Citations: []
Work binding:
  Provider: matt-skills/v1
  Native scope: .scratch/degraded-cli
---

# Effort: Degraded CLI

## Intent

Keep a trustworthy claimed ticket visible without publishing it as executable.

## Work

- [Map](map.md)
`,
  );
  await writeFixture(
    root,
    ".scratch/degraded-cli/map.md",
    `# Wayfinder Map: Degraded CLI

Status: active

## Destination

Exercise one real Local partial capture.

## Decisions so far

- [Drive the degraded scope](issues/01-drive.md) — Retain the claimed native fact.

## Fog

- One sibling has ambiguous role evidence.
`,
  );
  await writeFixture(
    root,
    ".scratch/degraded-cli/issues/01-drive.md",
    `# Drive the degraded scope

Type: task

Status: claimed

Claimed by: lago

## Question

Can a partial capture avoid publishing a claimed frontier?
`,
  );
  await writeFixture(
    root,
    ".scratch/degraded-cli/issues/02-ambiguous.md",
    `# Ambiguous sibling

Type: task

Status: claimed

Claimed by: lago

**What to build:** Conflicting role evidence.

- [ ] Preserve the diagnostic.

## Question

Which Matt role owns this issue?
`,
  );
};

const inspectCli = async (root: string, effortId: string) => {
  const child = Bun.spawn(["bun", "src/cli.ts", "inspect", "effort", effortId, "--repo", root], {
    cwd: process.cwd(),
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, NO_COLOR: "1" },
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { stdout, stderr, exitCode };
};

const providerDiagnostic = (
  scenario: (typeof failureScenarios)[number],
  nativeScope: string,
): ProviderDiagnostic => ({
  code: scenario.code,
  class: scenario.class,
  impact: "blocking",
  target: nativeScope,
  message: `Expected ${scenario.slug} degradation.`,
});

const degradedCapture = (
  scenario: (typeof failureScenarios)[number],
  binding: Readonly<{ provider: "matt-skills/v1"; nativeScope: string }>,
  generation: Readonly<{ fingerprint: string }>,
): MattSkillsV1ScopeCapture => {
  const base = {
    provider: "matt-skills/v1" as const,
    binding,
    generation,
    freshness: {
      assessment: scenario.freshness,
      capturedAt: "2026-07-28T00:00:00.000Z",
      evidence: [{ kind: "expected-failure", value: scenario.slug }],
    },
    coverage: {
      assessment: scenario.coverage,
      dimensions: [
        {
          key: scenario.slug,
          state: scenario.coverage === "complete" ? ("covered" as const) : ("gap" as const),
        },
      ],
    },
    completion: scenario.completion,
    diagnostics: [providerDiagnostic(scenario, binding.nativeScope)],
  };
  if (scenario.state === "available" || scenario.state === "partial") {
    return createProviderScopeCapture({
      ...base,
      state: scenario.state,
      projection: emptyProjection,
    });
  }
  return createProviderScopeCapture({
    ...base,
    state: scenario.state,
  });
};

const healthyCapture = (
  binding: Readonly<{ provider: "matt-skills/v1"; nativeScope: string }>,
  generation: Readonly<{ fingerprint: string }>,
): MattSkillsV1ScopeCapture =>
  createProviderScopeCapture({
    provider: "matt-skills/v1",
    binding,
    generation,
    state: "available",
    freshness: {
      assessment: "current",
      capturedAt: "2026-07-28T00:00:00.000Z",
      evidence: [{ kind: "fixture", value: "healthy" }],
    },
    coverage: {
      assessment: "complete",
      dimensions: [{ key: "scope", state: "covered" }],
    },
    completion: "complete",
    diagnostics: [],
    projection: emptyProjection,
  });

test("propagates every expected degradation class through one generation without contaminating a healthy peer", async () => {
  const root = await createValidBearingRepo();
  await writeDegradedRoadmap(root);
  let captureCalls = 0;
  const providerFactory: MattProviderFactory = () => ({
    id: "matt-skills/v1",
    capture: async (binding, generation) => {
      captureCalls += 1;
      if (binding.nativeScope === ".scratch/work") return healthyCapture(binding, generation);
      const scenario = failureScenarios.find(
        (candidate) => binding.nativeScope === `.scratch/degraded/${candidate.slug}`,
      );
      if (scenario === undefined) throw new Error(`Unexpected scope: ${binding.nativeScope}`);
      return degradedCapture(scenario, binding, generation);
    },
  });

  const plan = await prepareSync(root, { providerFactory });
  expect(captureCalls).toBe(failureScenarios.length + 1);
  expect(plan.metrics.providerCaptureCount).toBe(failureScenarios.length + 1);
  expect(
    plan.providerCaptures.every((capture) => capture.generation.fingerprint === plan.fingerprint),
  ).toBe(true);
  expect(plan.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
    expect.arrayContaining(failureScenarios.map((scenario) => scenario.code)),
  );

  const healthyEffort = plan.planningGraph.contextFor({ kind: "effort", id: "effort:test" });
  expect(healthyEffort.state).toBe("complete");
  if (healthyEffort.state === "invalid") throw new Error("Expected healthy Effort context.");
  expect(healthyEffort.context.effort.value.lifecycle).toBe("active");
  expect(healthyEffort.context.providerCapture).toMatchObject({
    state: "available",
    freshness: { assessment: "current" },
    coverage: { assessment: "complete" },
    completion: "complete",
  });
  const healthyGate = plan.planningGraph.contextFor({ kind: "gate", id: "gate:test" });
  if (healthyGate.state === "invalid") throw new Error("Expected healthy Gate context.");
  expect(healthyGate.context.gate.value.readiness).toBe("not-ready");

  for (const scenario of failureScenarios) {
    const result = plan.planningGraph.contextFor({
      kind: "effort",
      id: `effort:degraded-${scenario.slug}`,
    });
    expect(result.state).toBe("partial");
    if (result.state === "invalid") throw new Error("Expected scoped degraded Effort context.");
    const captured = plan.providerCaptures.find(
      (capture) => capture.binding.nativeScope === `.scratch/degraded/${scenario.slug}`,
    );
    expect(result.fingerprint).toBe(plan.fingerprint);
    expect(result.context.providerCapture).toBe(captured);
    expect(result.context.effort.value.lifecycle).toBe("active");
    expect(result.context.providerCapture).toMatchObject({
      state: scenario.state,
      freshness: { assessment: scenario.freshness },
      coverage: { assessment: scenario.coverage },
      completion: scenario.completion,
      diagnostics: [{ code: scenario.code }],
    });
    expect(result.issues).toContainEqual(expect.objectContaining({ code: scenario.code }));
  }
  const degradedGate = plan.planningGraph.contextFor({
    kind: "gate",
    id: "gate:degraded",
  });
  if (degradedGate.state === "invalid") throw new Error("Expected degraded Gate context.");
  expect(degradedGate.context.gate.value.readiness).not.toBe("ready-for-review");

  const sitemap = plan.sitemap.toString("utf8");
  expect(sitemap).toContain(`Input fingerprint: ${plan.fingerprint}`);
  for (const scenario of failureScenarios) {
    expect(sitemap).toContain(`provider-state=${scenario.state}`);
    expect(sitemap).toContain(`provider-freshness=${scenario.freshness}`);
    expect(sitemap).toContain(`provider-coverage=${scenario.coverage}`);
    expect(sitemap).toContain(`provider-completion=${scenario.completion}`);
  }
  expect(sitemap).toContain("provider-frontier-evidence=trustworthy");
  expect(sitemap).toContain("provider-frontier-evidence=withheld");
  expect(plan.report.toString("utf8")).toContain(`Input fingerprint: ${plan.fingerprint}`);

  let portalReceivedGeneration = false;
  const materialized = await createProjectMaterializer({
    packageVersion: "0.0.0-ticket-13",
    dependencies: {
      prepare: async () => plan,
      buildSnapshot: async (input) => {
        portalReceivedGeneration =
          input.sitemapFingerprint === plan.fingerprint &&
          input.providerCaptures === plan.providerCaptures &&
          input.planningGraph === plan.planningGraph;
        return buildProjectSnapshot(input);
      },
    },
  }).run(root, "force");
  expect(portalReceivedGeneration).toBe(true);
  const snapshot = materialized.snapshot;
  expect(String(snapshot.basis.sitemapFingerprint)).toBe(plan.fingerprint);
  expect(snapshot.providerCaptures).toEqual(plan.providerCaptures);
  const healthyPortal = buildRoadmapDetailModel(snapshot, "roadmap:test");
  expect(healthyPortal.state).toBe("available");
  const degradedPortal = buildRoadmapDetailModel(snapshot, "roadmap:degraded");
  expect(degradedPortal.state).toBe("partial");
  if (degradedPortal.state !== "partial") throw new Error("Expected degraded Roadmap Detail.");
  expect(
    degradedPortal.efforts.every(
      (effort) =>
        effort.providerAssessment?.frontierEvidence === "withheld" &&
        effort.frontier.ready.length === 0,
    ),
  ).toBe(true);

  const stable = await prepareSync(root, { providerFactory });
  expect(stable.diagnostics).toEqual(plan.diagnostics);
  expect(stable.fingerprint).toBe(plan.fingerprint);
  expect(captureCalls).toBe((failureScenarios.length + 1) * 2);
});

test("captures continuing mutation once per Sync and observes the next generation later", async () => {
  const root = await createValidBearingRepo();
  let captureCalls = 0;
  const providerFactory: MattProviderFactory = () => ({
    id: "matt-skills/v1",
    capture: async (binding, generation) => {
      captureCalls += 1;
      if (captureCalls === 1) {
        const healthy = healthyCapture(binding, generation);
        if (healthy.state !== "available") throw new Error("Expected healthy fixture capture.");
        return createProviderScopeCapture({
          ...healthy,
          freshness: {
            assessment: "stale",
            capturedAt: "2026-07-28T00:00:00.000Z",
            evidence: [{ kind: "mutation", value: "first-generation" }],
          },
          completion: "incomplete",
          projection: emptyProjection,
        });
      }
      return healthyCapture(binding, generation);
    },
  });

  const first = await prepareSync(root, { providerFactory });
  expect(captureCalls).toBe(1);
  expect(first.providerCaptures[0]).toMatchObject({
    freshness: { assessment: "stale" },
    completion: "incomplete",
  });

  const second = await prepareSync(root, { providerFactory });
  expect(captureCalls).toBe(2);
  expect(second.providerCaptures[0]).toMatchObject({
    freshness: { assessment: "current" },
    completion: "complete",
  });
  expect(second.fingerprint).not.toBe(first.fingerprint);
});

test("real Local mixed scopes keep CLI Inspect, Snapshot, Sitemap, and Portal on one generation", async () => {
  const root = await createValidBearingRepo();
  await writeRealLocalDegradedScope(root);

  const materialized = await createProjectMaterializer({
    packageVersion: "0.0.0-ticket-13",
  }).run(root, "force");
  const snapshot = materialized.snapshot;
  const degradedCapture = snapshot.providerCaptures.find(
    (capture) => capture.binding.nativeScope === ".scratch/degraded-cli",
  );
  expect(degradedCapture).toMatchObject({
    state: "partial",
    coverage: { assessment: "incomplete" },
    completion: "undetermined",
    diagnostics: [{ code: "matt.local.role.ambiguous" }],
  });

  const inspected = await inspectCli(root, "effort:degraded-cli");
  expect(inspected.exitCode).toBe(0);
  expect(inspected.stderr).toBe("");
  const output = JSON.parse(inspected.stdout);
  const cliCapture = output.context.providerCapture;
  expect(output).toMatchObject({
    state: "partial",
    fingerprint: String(snapshot.basis.sitemapFingerprint),
    context: {
      effort: { value: { id: "effort:degraded-cli", lifecycle: "active" } },
      providerCapture: {
        state: degradedCapture?.state,
        freshness: { assessment: degradedCapture?.freshness.assessment },
        coverage: { assessment: degradedCapture?.coverage.assessment },
        completion: degradedCapture?.completion,
      },
    },
  });
  expect(cliCapture.generation.fingerprint).toBe(String(snapshot.basis.sitemapFingerprint));
  expect(cliCapture.diagnostics.map((diagnostic: ProviderDiagnostic) => diagnostic.code)).toEqual(
    degradedCapture?.diagnostics.map((diagnostic) => diagnostic.code),
  );

  const sitemap = await readFile(join(root, ".bearing/cache/project-sitemap.md"), "utf8");
  expect(sitemap).toContain(`Input fingerprint: ${String(snapshot.basis.sitemapFingerprint)}`);
  expect(sitemap).toContain("provider-state=partial");
  expect(sitemap).toContain("provider-frontier-evidence=withheld");

  const portal = buildRoadmapDetailModel(snapshot, "roadmap:test");
  expect(portal.state).toBe("partial");
  if (portal.state !== "partial") throw new Error("Expected mixed-scope Roadmap Detail.");
  const healthyEffort = portal.efforts.find((effort) => effort.effort.id === "effort:test");
  const degradedEffort = portal.efforts.find(
    (effort) => effort.effort.id === "effort:degraded-cli",
  );
  expect(healthyEffort?.providerAssessment?.frontierEvidence).toBe("trustworthy");
  expect(degradedEffort?.providerAssessment?.frontierEvidence).toBe("withheld");
  expect(degradedEffort?.frontier).toMatchObject({
    claimed: [],
    ready: [],
    uncertain: [{ title: "Drive the degraded scope" }],
  });
});

test("throws programming defects, cancellation, and wrapper invariant violations", async () => {
  const errors = [
    new Error("programming defect"),
    new DOMException("capture cancelled", "AbortError"),
  ];
  for (const expected of errors) {
    const root = await createValidBearingRepo();
    await expect(
      prepareSync(root, {
        providerFactory: () => ({
          id: "matt-skills/v1",
          capture: async () => {
            throw expected;
          },
        }),
      }),
    ).rejects.toBe(expected);
  }

  const root = await createValidBearingRepo();
  await expect(
    prepareSync(root, {
      providerFactory: () => ({
        id: "matt-skills/v1",
        capture: async (binding, generation) =>
          ({
            ...healthyCapture(binding, generation),
            state: "partial",
            completion: "complete",
          }) as ProviderScopeCapture<"matt-skills/v1", MattScopeProjection>,
      }),
    }),
  ).rejects.toThrow("complete only");
});

test("treats an unsupported confirmed contract as a diagnostic capture boundary", async () => {
  const root = await createValidBearingRepo();
  await writeFixture(root, "docs/agents/issue-tracker.md", "# Unsupported tracker contract\n");
  let factoryCalls = 0;
  const plan = await prepareSync(root, {
    providerFactory: () => {
      factoryCalls += 1;
      throw new Error("Provider factory must not run for an unsupported contract.");
    },
  });

  expect(factoryCalls).toBe(0);
  expect(plan.providerCaptures).toEqual([]);
  expect(plan.diagnostics).toContainEqual(
    expect.objectContaining({ code: "unsupported-provider-contract" }),
  );
  const effort = plan.planningGraph.contextFor({ kind: "effort", id: "effort:test" });
  expect(effort).toMatchObject({
    state: "partial",
    context: {
      effort: { value: { lifecycle: "active" } },
    },
  });
  if (effort.state === "invalid") throw new Error("Expected degraded Effort context.");
  expect(effort.context.providerCapture).toBeUndefined();
  expect(plan.planningGraph.contextFor({ kind: "gate", id: "gate:test" })).toMatchObject({
    state: "partial",
    context: { gate: { value: { readiness: "unknown" } } },
  });
  expect(plan.sitemap.toString("utf8")).toContain("provider-state=missing");
  expect(plan.sitemap.toString("utf8")).toContain("provider-frontier-evidence=withheld");
});
