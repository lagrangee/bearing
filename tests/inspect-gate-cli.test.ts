import { expect, test } from "bun:test";
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { createValidBearingRepo, writeFixture } from "./helpers";

const inspect = async (root: string, kind: "roadmap" | "gate" | "effort", id: string) => {
  const child = Bun.spawn(["bun", "src/cli.ts", "inspect", kind, id, "--repo", root], {
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

const stableInspectOutput = (stdout: string): string =>
  JSON.stringify(JSON.parse(stdout), (key, value) =>
    key === "capturedAt" || key === "sourceObservedAt" || key === "observedAt" ? undefined : value,
  );

const addRev002Context = async (root: string): Promise<void> => {
  await writeFixture(
    root,
    ".bearing/state/efforts/second.md",
    `---
Type: effort
ID: effort:second
Title: Second Effort
Roadmap: roadmap:test
Target gate: gate:test
Authorities:
  - authority:architecture
Citations: []
Work binding:
  Provider: matt-skills/v1
  Native scope: .scratch/second
---

# Effort: Second

## Intent

Exercise the REV-002 contribution.

## Work

- [Ticket](issues/01-finish.md)
`,
  );
  await writeFixture(
    root,
    ".scratch/second/map.md",
    `# Wayfinder Map: Second

Status: resolved

## Destination

Finish the second contribution.

## Decisions so far

- [Finish second effort](issues/01-finish.md) — Done.

## Fog
`,
  );
  await writeFixture(
    root,
    ".scratch/second/issues/01-finish.md",
    `# Finish second effort

Type: task

Status: resolved

## Question

Can the second contribution finish?

## Answer

Done.
`,
  );
  await writeFixture(
    root,
    ".bearing/state/authorities/architecture.md",
    `---
Type: authority
ID: authority:architecture
Title: Architecture Authority
Baseline: []
---

# Architecture Authority

## Scope

Architecture decisions.

## Current Baseline

Use deterministic local modules.
`,
  );
  await writeFixture(
    root,
    ".bearing/state/alignment-checks/second.md",
    `---
Type: alignment-check
ID: alignment-check:second
Title: Second Effort Alignment
Status: open
Target: effort:second
Inputs: []
Input fingerprint: sha256:${"a".repeat(64)}
---

# Alignment Check
`,
  );
  await writeFixture(
    root,
    ".bearing/state/assets.md",
    `---
Type: asset-registry
Assets:
  - ID: asset:second-evidence
    Title: Second evidence
    Kind: verification-report
    Location: evidence/second.md
    Owner: effort:second
    Producer:
      Kind: agent
      Name: fixture
    Lifecycle source: native
---

# Asset Registry
`,
  );
  await writeFixture(root, "evidence/second.md", "verified\n");
};

test("real inspect gate command returns one structured captured closure and writes only disposable caches", async () => {
  const root = await createValidBearingRepo();
  await addRev002Context(root);
  const effortPath = join(root, ".bearing/state/efforts/test.md");
  const before = await readFile(effortPath, "utf8");

  const result = await inspect(root, "gate", "gate:test");

  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe("");
  const output = JSON.parse(result.stdout);
  expect(output).toMatchObject({
    state: "complete",
    fingerprint: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
    target: { kind: "gate", id: "gate:test" },
    issues: [],
    context: { gate: { value: { id: "gate:test" } } },
  });
  expect(
    output.context.efforts.map(
      (effort: { effort: { value: { id: string } } }) => effort.effort.value.id,
    ),
  ).toEqual(["effort:second", "effort:test"]);
  const second = output.context.efforts[0];
  expect(second).toMatchObject({
    effort: { value: { id: "effort:second" } },
    roadmap: { value: { id: "roadmap:test" } },
    targetGate: { value: { id: "gate:test" } },
    authorities: [{ value: { id: "authority:architecture" } }],
    providerCapture: {
      state: "available",
      completion: "complete",
      projection: {
        map: { ref: ".scratch/second/map.md" },
        wayfinderTickets: [{ ref: ".scratch/second/issues/01-finish.md" }],
      },
    },
    alignmentChecks: [{ value: { id: "alignment-check:second" } }],
    evidence: [{ value: { id: "asset:second-evidence" } }],
    source: { displayLocator: ".bearing/state/efforts/second.md" },
  });
  expect(
    output.context.sources.some(
      (source: { displayLocator: string }) =>
        source.displayLocator === ".bearing/state/efforts/second.md",
    ),
  ).toBe(true);
  expect(await readFile(effortPath, "utf8")).toBe(before);
  await expect(access(join(root, ".bearing/cache/sync-report.md"))).resolves.toBeNull();
  await expect(access(join(root, ".bearing/cache/project-sitemap.md"))).resolves.toBeNull();
  await expect(access(join(root, ".bearing/cache/sync-receipt.json"))).rejects.toThrow();
});

test("real inspect commands return structured invalid contexts with nonzero exits", async () => {
  const root = await createValidBearingRepo();
  const scenarios = [
    ["roadmap", "roadmap:missing", "unknown-target"],
    ["gate", "gate:missing", "unknown-target"],
    ["effort", "effort:missing", "unknown-target"],
    ["effort", "gate:test", "target-kind-mismatch"],
  ] as const;

  for (const [kind, id, code] of scenarios) {
    const result = await inspect(root, kind, id);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({
      state: "invalid",
      target: { kind, id },
      issues: [{ code, target: id }],
    });
  }
});

test("real inspect gate command returns partial context successfully for scoped invalid native work", async () => {
  const root = await createValidBearingRepo();
  await writeFixture(
    root,
    ".scratch/work/issues/02-invalid.md",
    `# Invalid native work

Type: task

Status: unsupported

## Question

Can this work be classified?
`,
  );

  const result = await inspect(root, "gate", "gate:test");

  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe("");
  expect(JSON.parse(result.stdout)).toMatchObject({
    state: "partial",
    context: { efforts: [{ effort: { value: { id: "effort:test" } } }] },
    issues: [
      {
        code: "matt.local.lifecycle.unknown",
        target: ".scratch/work/issues/02-invalid.md",
      },
    ],
  });
});

test("real inspect roadmap and effort commands use the same complete typed closure contract", async () => {
  const root = await createValidBearingRepo();
  await addRev002Context(root);
  const perturbedRoot = await createValidBearingRepo();
  for (const reference of [
    "evidence/second.md",
    ".bearing/state/assets.md",
    ".bearing/state/alignment-checks/second.md",
    ".bearing/state/authorities/architecture.md",
    ".scratch/second/map.md",
    ".scratch/second/issues/01-finish.md",
    ".bearing/state/efforts/second.md",
  ]) {
    await writeFixture(perturbedRoot, reference, await readFile(join(root, reference), "utf8"));
  }

  const roadmap = await inspect(root, "roadmap", "roadmap:test");
  const effort = await inspect(root, "effort", "effort:second");
  const repeatedRoadmap = await inspect(root, "roadmap", "roadmap:test");
  const perturbedRoadmap = await inspect(perturbedRoot, "roadmap", "roadmap:test");
  const perturbedEffort = await inspect(perturbedRoot, "effort", "effort:second");

  expect(roadmap.exitCode).toBe(0);
  expect(effort.exitCode).toBe(0);
  expect(roadmap.stderr).toBe("");
  expect(effort.stderr).toBe("");
  expect(repeatedRoadmap.exitCode).toBe(0);
  expect(repeatedRoadmap.stderr).toBe("");
  expect(stableInspectOutput(repeatedRoadmap.stdout)).toBe(stableInspectOutput(roadmap.stdout));
  expect(perturbedRoadmap.exitCode).toBe(0);
  expect(perturbedEffort.exitCode).toBe(0);
  expect(perturbedRoadmap.stderr).toBe("");
  expect(perturbedEffort.stderr).toBe("");
  expect(stableInspectOutput(perturbedRoadmap.stdout)).toBe(stableInspectOutput(roadmap.stdout));
  expect(stableInspectOutput(perturbedEffort.stdout)).toBe(stableInspectOutput(effort.stdout));
  const roadmapOutput = JSON.parse(roadmap.stdout);
  const effortOutput = JSON.parse(effort.stdout);
  expect(roadmapOutput).toMatchObject({
    state: "complete",
    target: { kind: "roadmap", id: "roadmap:test" },
    context: { roadmap: { value: { id: "roadmap:test" } } },
  });
  expect(
    roadmapOutput.context.efforts.map(
      (entry: { effort: { value: { id: string } } }) => entry.effort.value.id,
    ),
  ).toEqual(["effort:second", "effort:test"]);
  expect(effortOutput).toMatchObject({
    state: "complete",
    target: { kind: "effort", id: "effort:second" },
    context: {
      effort: { value: { id: "effort:second" } },
      roadmap: { value: { id: "roadmap:test" } },
      targetGate: { value: { id: "gate:test" } },
      authorities: [{ value: { id: "authority:architecture" } }],
      providerCapture: {
        state: "available",
        completion: "complete",
        projection: {
          map: { ref: ".scratch/second/map.md" },
          wayfinderTickets: [{ ref: ".scratch/second/issues/01-finish.md" }],
        },
      },
      alignmentChecks: [{ value: { id: "alignment-check:second" } }],
      evidence: [{ value: { id: "asset:second-evidence" } }],
    },
  });
  expect(roadmapOutput.fingerprint).toBe(effortOutput.fingerprint);
});

test("real Roadmap and Effort commands retain roots and report a nested ordering relation as partial", async () => {
  const root = await createValidBearingRepo();
  await writeFixture(
    root,
    ".bearing/state/milestone-gates/detached.md",
    `---
Type: milestone-gate
ID: gate:detached
Title: Detached Gate
Roadmap: roadmap:test
Status: planned
---

# Detached Gate

## Intent

Exercise a broken nested ordering relation.

## Exit Criteria

- The missing order relation is visible.
`,
  );
  await writeFixture(
    root,
    ".bearing/state/efforts/detached.md",
    `---
Type: effort
ID: effort:detached
Title: Detached Effort
Roadmap: roadmap:test
Target gate: gate:detached
Authorities: []
Citations: []
Work binding:
  Provider: matt-skills/v1
  Native scope: .scratch/detached
---

# Detached Effort

## Intent

Exercise a broken nested ordering relation.

## Work

- None.
`,
  );

  const roadmap = await inspect(root, "roadmap", "roadmap:test");
  const effort = await inspect(root, "effort", "effort:detached");

  for (const result of [roadmap, effort]) {
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({
      state: "partial",
      issues: [
        {
          code: "gate-missing-from-roadmap-order",
          target: "gate:detached",
        },
      ],
    });
  }
});
