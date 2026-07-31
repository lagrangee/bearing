import { expect, test } from "bun:test";
import { buildPlanningGraph } from "../src/planning-graph";
import { prepareSync as prepareBearingSync } from "../src/sync-plan";
import { createValidBearingRepo, writeFixture } from "./helpers";

const prepareSync = (root: string) =>
  prepareBearingSync(root, { providerObservationIntent: "initial-baseline" });

const addRoadmapEffortContext = async (root: string): Promise<void> => {
  await writeFixture(
    root,
    ".bearing/state/roadmaps/test.md",
    `---
Type: roadmap
ID: roadmap:test
Title: Test Roadmap
Status: active
Focused gate: gate:test
Gate order:
  - gate:first
  - gate:test
---

# Roadmap: Test

## Intent

Prove ordered Roadmap inspection.
`,
  );
  await writeFixture(
    root,
    ".bearing/state/milestone-gates/first.md",
    `---
Type: milestone-gate
ID: gate:first
Title: First Gate
Roadmap: roadmap:test
Status: planned
Effort order:
  - effort:optional
---

# First Gate

## Intent

Represent the first boundary.

## Exit Criteria

- First work is understood.
`,
  );
  await writeFixture(
    root,
    ".bearing/state/efforts/test.md",
    `---
Type: effort
Lifecycle: active
Planned at: null
Activated at: null
ID: effort:test
Title: Test Effort
Roadmap: roadmap:test
Target gate: gate:test
Authorities:
  - authority:architecture
Citations: []
Work binding:
  Provider: matt-skills/v1
  Native scope: .scratch/work
---

# Effort: Test

## Intent

Exercise the full Effort context.

## Work

- [Map](map.md)
`,
  );
  await writeFixture(
    root,
    ".bearing/state/efforts/optional.md",
    `---
Type: effort
Lifecycle: active
Planned at: null
Activated at: null
ID: effort:optional
Title: Optional Native Work
Roadmap: roadmap:test
Target gate: gate:first
Authorities: []
Citations: []
Work binding:
  Provider: matt-skills/v1
  Native scope: .scratch/optional
---

# Effort: Optional

## Intent

Prove valid optional absence.

## Work

- None.
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

Use one typed relation owner.
`,
  );
  await writeFixture(
    root,
    ".bearing/state/alignment-checks/test-effort.md",
    `---
Type: alignment-check
ID: alignment-check:test-effort
Title: Test Effort Alignment
Status: open
Target: effort:test
Inputs: []
Input fingerprint: sha256:${"b".repeat(64)}
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
  - ID: asset:test-evidence
    Title: Test evidence
    Kind: verification-report
    Location: evidence/test.md
    Owner: effort:test
    Producer:
      Kind: agent
      Name: fixture
    Lifecycle source: native
---

# Asset Registry
`,
  );
  await writeFixture(root, "evidence/test.md", "verified\n");
};

test("uses explicit Gate Effort order instead of lexical identity or event time", async () => {
  const root = await createValidBearingRepo();
  const gatePath = ".bearing/state/milestone-gates/test.md";
  await writeFixture(
    root,
    gatePath,
    `---
Type: milestone-gate
ID: gate:test
Title: Test Gate
Roadmap: roadmap:test
Status: active
Effort order:
  - effort:test
  - effort:alpha
---

# Milestone Gate: Test

## Intent

Reach the fixture boundary.

## Exit Criteria

- All fixture work resolves.
`,
  );
  await writeFixture(
    root,
    ".bearing/state/efforts/alpha.md",
    `---
Type: effort
ID: effort:alpha
Title: Earlier Timestamp
Roadmap: roadmap:test
Target gate: gate:test
Authorities: []
Citations: []
Lifecycle: planned
Planned at: 2020-01-01T00:00:00Z
---

# Effort: Earlier Timestamp

## Intent

Prove canonical order outranks identity and time.

## Work

- None.
`,
  );

  const graph = (await prepareSync(root)).planningGraph;
  const gate = graph.contextFor({ kind: "gate", id: "gate:test" });
  const roadmap = graph.contextFor({ kind: "roadmap", id: "roadmap:test" });

  if (gate.state === "invalid" || roadmap.state === "invalid") {
    throw new Error("Expected trustworthy planning contexts.");
  }
  expect(gate.context.efforts.map(({ effort }) => String(effort.value.id))).toEqual([
    "effort:test",
    "effort:alpha",
  ]);
  expect(roadmap.context.efforts.map(({ effort }) => String(effort.value.id))).toEqual([
    "effort:test",
    "effort:alpha",
  ]);
});

test("Roadmap closure preserves canonical order while exposing an unresolved bound contributor", async () => {
  const root = await createValidBearingRepo();
  await addRoadmapEffortContext(root);
  const plan = await prepareSync(root);

  const result = plan.planningGraph.contextFor({ kind: "roadmap", id: "roadmap:test" });

  expect(result.state).toBe("partial");
  if (result.state === "invalid") throw new Error("Expected Roadmap context.");
  expect(result.fingerprint).toBe(plan.fingerprint);
  expect(result.context.gates.map(({ value }) => String(value.id))).toEqual([
    "gate:first",
    "gate:test",
  ]);
  expect(String(result.context.focusedGate?.value.id)).toBe("gate:test");
  expect(result.context.efforts.map(({ effort }) => String(effort.value.id))).toEqual([
    "effort:optional",
    "effort:test",
  ]);
  expect(result.context.efforts.map(({ targetGate }) => String(targetGate?.value.id))).toEqual([
    "gate:first",
    "gate:test",
  ]);

  const reversed = await buildPlanningGraph({
    decoded: { ...plan.decoded, records: [...plan.decoded.records].reverse() },
    providerObservations: [...plan.providerObservations].reverse(),
    providerObservationSelections: [...plan.providerObservationSelections].reverse(),
    diagnostics: [...plan.diagnostics].reverse(),
    fingerprint: plan.fingerprint,
    assetContentObservations: [...plan.assetContentObservations].reverse(),
  });
  expect(reversed.contextFor({ kind: "roadmap", id: "roadmap:test" })).toEqual(result);
});

test("Effort closure returns full nested context and fails a bound absent scope closed", async () => {
  const root = await createValidBearingRepo();
  await addRoadmapEffortContext(root);
  const graph = (await prepareSync(root)).planningGraph;

  const complete = graph.contextFor({ kind: "effort", id: "effort:test" });
  expect(complete.state).toBe("complete");
  if (complete.state === "invalid") throw new Error("Expected Effort context.");
  expect(String(complete.context.roadmap?.value.id)).toBe("roadmap:test");
  expect(String(complete.context.targetGate?.value.id)).toBe("gate:test");
  expect(complete.context.authorities.map(({ value }) => String(value.id))).toEqual([
    "authority:architecture",
  ]);
  const capture = complete.context.providerCapture;
  if (capture === undefined || (capture.state !== "available" && capture.state !== "partial")) {
    throw new Error("Expected an available Effort provider capture.");
  }
  expect(String(capture.projection.map?.ref)).toBe(".scratch/work/map.md");
  expect(capture.projection.wayfinderTickets.map((ticket) => String(ticket.ref))).toEqual([
    ".scratch/work/issues/01-finish.md",
  ]);
  expect(complete.context.nativeWorkReadingState).toMatchObject({
    conclusion: "Complete",
    binding: { state: "bound", effortIds: ["effort:test"] },
    why: {
      projectionState: "available",
      freshness: "current",
      coverage: "complete",
      completion: "complete",
      blockingDiagnosticCount: 0,
    },
  });
  expect(complete.context.alignmentChecks.map(({ value }) => String(value.id))).toEqual([
    "alignment-check:test-effort",
  ]);
  expect(complete.context.evidence.map(({ value }) => String(value.id))).toEqual([
    "asset:test-evidence",
  ]);
  expect(complete.context.sources.length).toBeGreaterThan(0);

  const optional = graph.contextFor({ kind: "effort", id: "effort:optional" });
  expect(optional.state).toBe("partial");
  if (optional.state === "invalid") throw new Error("Expected optional Effort context.");
  expect(optional.context.providerCapture).toMatchObject({
    state: "absent",
    completion: "incomplete",
    binding: { nativeScope: ".scratch/optional" },
  });
  expect(optional.context.nativeWorkReadingState).toMatchObject({
    conclusion: "Can't verify",
    why: {
      projectionState: "absent",
      completion: "incomplete",
    },
  });
  expect(optional.context.evidence).toEqual([]);
  expect(optional.issues).toContainEqual(
    expect.objectContaining({
      code: "untrusted-provider-observation-selection",
      target: ".scratch/optional",
    }),
  );
});

test("Effort closure keeps a first provider acquisition failure as bound Can't verify evidence", async () => {
  const root = await createValidBearingRepo();
  await addRoadmapEffortContext(root);
  const plan = await prepareSync(root);
  const nativeScope = ".scratch/work";
  const graph = await buildPlanningGraph({
    decoded: plan.decoded,
    providerObservations: plan.providerObservations.filter(
      (observation) => observation.binding.nativeScope !== nativeScope,
    ),
    providerObservationSelections: plan.providerObservationSelections.map((selection) =>
      selection.nativeScope === nativeScope
        ? {
            ...selection,
            observationId: null,
            effectiveFreshness: "undetermined" as const,
            latestAttempt: {
              intent: "initial-baseline" as const,
              attemptedAt: "2026-07-31T07:00:00Z",
              outcome: "failed" as const,
              diagnostics: [
                {
                  code: "provider.contract.unsupported",
                  impact: "blocking" as const,
                  target: nativeScope,
                  message: "The provider contract is unsupported.",
                },
              ],
            },
          }
        : selection,
    ),
    diagnostics: plan.diagnostics,
    fingerprint: plan.fingerprint,
    assetContentObservations: plan.assetContentObservations,
  });

  const result = graph.contextFor({ kind: "effort", id: "effort:test" });
  expect(result.state).toBe("partial");
  if (result.state === "invalid") throw new Error("Expected partial Effort context.");
  expect(result.context.nativeWorkReadingState).toMatchObject({
    conclusion: "Can't verify",
    binding: { state: "bound", effortIds: ["effort:test"] },
    why: {
      projectionState: "missing",
      blockingDiagnosticCount: 1,
      causes: expect.arrayContaining(["The provider contract is unsupported."]),
    },
    observation: {
      diagnostics: [
        {
          origin: "latest-attempt",
          code: "provider.contract.unsupported",
          impact: "blocking",
          target: nativeScope,
          message: "The provider contract is unsupported.",
        },
      ],
    },
  });
});

test("Effort closure retains the Effort when its required Target Gate is broken", async () => {
  const root = await createValidBearingRepo();
  await writeFixture(
    root,
    ".bearing/state/efforts/broken.md",
    `---
Type: effort
Lifecycle: active
Planned at: null
Activated at: null
ID: effort:broken
Title: Broken Target Effort
Roadmap: roadmap:test
Target gate: gate:missing
Authorities: []
Citations: []
Work binding:
  Provider: matt-skills/v1
  Native scope: .scratch/broken
---

# Broken Target Effort

## Intent

Preserve trustworthy local context.

## Work

- None.
`,
  );

  const result = (await prepareSync(root)).planningGraph.contextFor({
    kind: "effort",
    id: "effort:broken",
  });

  expect(result.state).toBe("partial");
  if (result.state === "invalid") throw new Error("Expected partial Effort context.");
  expect(String(result.context.effort.value.id)).toBe("effort:broken");
  expect(result.context.targetGate).toBeUndefined();
  expect(result.issues).toContainEqual({
    code: "missing-target-gate",
    target: "gate:missing",
    message: "An Effort's required Target Gate relation is unavailable.",
    source: result.context.effort.value.source,
  });
});

test("Roadmap and Effort targets share scoped invalid and wrong-kind behavior", async () => {
  const plan = await prepareSync(await createValidBearingRepo());

  expect(plan.planningGraph.contextFor({ kind: "roadmap", id: "roadmap:missing" })).toMatchObject({
    state: "invalid",
    issues: [{ code: "unknown-target", target: "roadmap:missing" }],
  });
  expect(plan.planningGraph.contextFor({ kind: "effort", id: "gate:test" })).toMatchObject({
    state: "invalid",
    issues: [{ code: "target-kind-mismatch", target: "gate:test" }],
  });
});

test("Effort closure excludes unscopable native work from an unrelated invalid Effort", async () => {
  const root = await createValidBearingRepo();
  await writeFixture(
    root,
    ".bearing/state/efforts/uncertain.md",
    `---
Type: effort
Lifecycle: active
Planned at: null
Activated at: null
ID: effort:uncertain
Title: Uncertain Effort
Roadmap: roadmap:test
Target gate: gate:test
Work binding:
  Provider: matt-skills/v1
  Native scope: .scratch/uncertain
---

# Invalid Effort
`,
  );
  await writeFixture(
    root,
    ".scratch/uncertain/issues/01-work.md",
    `# Potential contribution

Type: task

Status: open
`,
  );

  const result = (await prepareSync(root)).planningGraph.contextFor({
    kind: "effort",
    id: "effort:test",
  });

  expect(result.state).toBe("complete");
  expect(result.issues).toEqual([]);
});

test("Roadmap and Effort closures report a Target Gate outside the owning Roadmap order", async () => {
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
Effort order:
  - effort:detached
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
Lifecycle: active
Planned at: null
Activated at: null
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
  const graph = (await prepareSync(root)).planningGraph;

  for (const result of [
    graph.contextFor({ kind: "roadmap", id: "roadmap:test" }),
    graph.contextFor({ kind: "effort", id: "effort:detached" }),
  ]) {
    expect(result.state).toBe("partial");
    expect(result.issues).toContainEqual({
      code: "gate-missing-from-roadmap-order",
      target: "gate:detached",
      message: "The Effort's Target Gate is missing from its Roadmap's canonical order.",
      source: expect.stringMatching(/^source:/u),
    });
  }
});

test("Effort closure reports missing and invalid cited Assets in the Effort scope", async () => {
  const root = await createValidBearingRepo();
  await writeFixture(
    root,
    ".bearing/state/efforts/test.md",
    `---
Type: effort
Lifecycle: active
Planned at: null
Activated at: null
ID: effort:test
Title: Test Effort
Roadmap: roadmap:test
Target gate: gate:test
Authorities: []
Citations:
  - Asset: asset:missing
    Note: Missing evidence must not disappear.
  - Asset: asset:duplicate
    Note: Ambiguous evidence must not disappear.
Work binding:
  Provider: matt-skills/v1
  Native scope: .scratch/work
---

# Effort: Test

## Intent

Exercise scoped evidence failures.

## Work

- [Map](map.md)
`,
  );
  await writeFixture(
    root,
    ".bearing/state/assets.md",
    `---
Type: asset-registry
Assets:
  - ID: asset:duplicate
    Title: Duplicate evidence one
    Kind: verification-report
    Location: evidence/one.md
    Owner: effort:test
    Producer:
      Kind: agent
      Name: fixture
    Lifecycle source: native
  - ID: asset:duplicate
    Title: Duplicate evidence two
    Kind: verification-report
    Location: evidence/two.md
    Owner: effort:test
    Producer:
      Kind: agent
      Name: fixture
    Lifecycle source: native
---

# Asset Registry
`,
  );

  const result = (await prepareSync(root)).planningGraph.contextFor({
    kind: "effort",
    id: "effort:test",
  });

  expect(result.state).toBe("partial");
  if (result.state === "invalid") throw new Error("Expected partial Effort context.");
  expect(result.context.evidence).toEqual([]);
  expect(result.issues).toContainEqual({
    code: "missing-cited-asset",
    target: "asset:missing",
    message: "A cited Asset is unavailable.",
    source: result.context.effort.value.source,
  });
  expect(result.issues.filter((issue) => issue.code === "duplicate-stable-id")).toHaveLength(1);
});

test("Effort closure reports duplicate owner-linked Assets without leaking unrelated owner issues", async () => {
  const root = await createValidBearingRepo();
  await writeFixture(
    root,
    ".bearing/state/assets.md",
    `---
Type: asset-registry
Assets:
  - ID: asset:owned-duplicate
    Title: Owned duplicate one
    Kind: verification-report
    Location: evidence/owned-one.md
    Owner: effort:test
    Producer:
      Kind: agent
      Name: fixture
    Lifecycle source: native
  - ID: asset:owned-duplicate
    Title: Owned duplicate two
    Kind: verification-report
    Location: evidence/owned-two.md
    Owner: effort:test
    Producer:
      Kind: agent
      Name: fixture
    Lifecycle source: native
  - ID: asset:unrelated-duplicate
    Title: Unrelated duplicate one
    Kind: verification-report
    Location: evidence/unrelated-one.md
    Owner: effort:other
    Producer:
      Kind: agent
      Name: fixture
    Lifecycle source: native
  - ID: asset:unrelated-duplicate
    Title: Unrelated duplicate two
    Kind: verification-report
    Location: evidence/unrelated-two.md
    Owner: effort:other
    Producer:
      Kind: agent
      Name: fixture
    Lifecycle source: native
---

# Asset Registry
`,
  );

  const result = (await prepareSync(root)).planningGraph.contextFor({
    kind: "effort",
    id: "effort:test",
  });

  expect(result.state).toBe("partial");
  if (result.state === "invalid") throw new Error("Expected partial Effort context.");
  expect(result.context.effort.value.citations).toEqual([]);
  expect(result.context.evidence).toEqual([]);
  expect(result.issues.filter((issue) => issue.code === "duplicate-stable-id")).toEqual([
    expect.objectContaining({ target: ".bearing/state/assets.md#asset:owned-duplicate" }),
  ]);
  expect(result.issues.some((issue) => issue.target.includes("unrelated-duplicate"))).toBe(false);
});

test("Effort closure reports invalid and duplicate Alignment Checks targeting the Effort", async () => {
  const root = await createValidBearingRepo();
  const duplicateCheck = `---
Type: alignment-check
ID: alignment-check:duplicate
Title: Duplicate check
Status: open
Target: effort:test
Inputs: []
Input fingerprint: sha256:${"c".repeat(64)}
---

# Duplicate check
`;
  await writeFixture(root, ".bearing/state/alignment-checks/duplicate-one.md", duplicateCheck);
  await writeFixture(root, ".bearing/state/alignment-checks/duplicate-two.md", duplicateCheck);
  await writeFixture(
    root,
    ".bearing/state/alignment-checks/invalid.md",
    `---
Type: alignment-check
ID: alignment-check:invalid
Title: Invalid resolved check
Status: resolved
Target: effort:test
Inputs: []
Input fingerprint: sha256:${"d".repeat(64)}
---

# Invalid resolved check
`,
  );

  const result = (await prepareSync(root)).planningGraph.contextFor({
    kind: "effort",
    id: "effort:test",
  });

  expect(result.state).toBe("partial");
  if (result.state === "invalid") throw new Error("Expected partial Effort context.");
  expect(result.context.alignmentChecks).toEqual([]);
  expect(result.issues.filter((issue) => issue.code === "duplicate-stable-id")).toHaveLength(2);
  expect(result.issues).toContainEqual({
    code: "resolved-check-missing-resolution",
    target: ".bearing/state/alignment-checks/invalid.md",
    message: "Resolved Alignment Check requires Resolution.",
    source: expect.stringMatching(/^source:/u),
  });
});
