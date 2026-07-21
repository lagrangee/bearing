import { expect, test } from "bun:test";
import { buildPlanningGraph } from "../src/planning-graph";
import { prepareSync } from "../src/sync-plan";
import { createValidBearingRepo, writeFixture } from "./helpers";

const addSecondEffort = async (
  root: string,
  authorities: readonly string[] = [],
): Promise<void> => {
  await writeFixture(
    root,
    ".scratch/second/effort.md",
    `---
Type: effort
ID: effort:second
Title: Second Effort
Roadmap: roadmap:test
Target gate: gate:test
${authorities.length === 0 ? "Authorities: []" : `Authorities:\n${authorities.map((authority) => `  - ${authority}`).join("\n")}`}
Citations: []
---

# Effort: Second

## Intent

Exercise the second contribution.

## Work

- [Ticket](issues/01-finish.md)
`,
  );
  await writeFixture(
    root,
    ".scratch/second/issues/01-finish.md",
    `# Finish second effort

Type: task
Status: resolved

## Answer

Done.
`,
  );
};

const addGovernanceContext = async (root: string): Promise<void> => {
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

test("Gate closure returns every inbound Effort with native, governance, evidence, and provenance", async () => {
  const root = await createValidBearingRepo();
  await addSecondEffort(root, ["authority:architecture"]);
  await addGovernanceContext(root);

  const plan = await prepareSync(root);
  const result = plan.planningGraph.contextFor({ kind: "gate", id: "gate:test" });

  expect(result.state).toBe("complete");
  expect(result.fingerprint).toBe(plan.fingerprint);
  expect(result.issues).toEqual([]);
  if (result.state === "invalid") throw new Error("Expected trustworthy Gate context.");
  expect(result.context.efforts.map(({ effort }) => String(effort.value.id))).toEqual([
    "effort:second",
    "effort:test",
  ]);
  const second = result.context.efforts[0];
  if (second === undefined) throw new Error("Expected second Effort context.");
  expect(String(second.roadmap?.value.id)).toBe("roadmap:test");
  expect(String(second.targetGate?.value.id)).toBe("gate:test");
  expect(second.authorities.map(({ value }) => String(value.id))).toEqual([
    "authority:architecture",
  ]);
  expect(second.map).toBeUndefined();
  expect(second.tickets.map(({ value }) => String(value.reference))).toEqual([
    ".scratch/second/issues/01-finish.md",
  ]);
  expect(second.alignmentChecks.map(({ value }) => String(value.id))).toEqual([
    "alignment-check:second",
  ]);
  expect(second.evidence.map(({ value }) => String(value.id))).toEqual(["asset:second-evidence"]);
  expect(second.source.displayLocator).toBe(".scratch/second/effort.md");
  expect(result.context.sources.every((source) => source.reference.startsWith("source:"))).toBe(
    true,
  );
  expect(Object.isFrozen(plan.planningGraph)).toBe(true);
  expect(Object.isFrozen(result.context.efforts)).toBe(true);

  const reversed = await buildPlanningGraph({
    decoded: { ...plan.decoded, records: [...plan.decoded.records].reverse() },
    nativeRecords: [...plan.nativeRecords].reverse(),
    diagnostics: [...plan.diagnostics].reverse(),
    fingerprint: plan.fingerprint,
    assetContentObservations: [...plan.assetContentObservations].reverse(),
  });
  expect(reversed.contextFor({ kind: "gate", id: "gate:test" })).toEqual(result);
});

test("Gate closure retains trustworthy siblings and reports a missing required relation", async () => {
  const root = await createValidBearingRepo();
  await addSecondEffort(root, ["authority:missing"]);

  const result = (await prepareSync(root)).planningGraph.contextFor({
    kind: "gate",
    id: "gate:test",
  });

  expect(result.state).toBe("partial");
  if (result.state === "invalid") throw new Error("Expected partial Gate context.");
  expect(result.context.efforts.map(({ effort }) => String(effort.value.id))).toEqual([
    "effort:second",
    "effort:test",
  ]);
  expect(result.issues.find((issue) => issue.code === "missing-authority")).toMatchObject({
    code: "missing-authority",
    target: "authority:missing",
    message: "A required Authority relation is unavailable.",
  });
});

test("Gate closure rejects unknown and wrong-kind Stable IDs without fallback", async () => {
  const plan = await prepareSync(await createValidBearingRepo());

  expect(plan.planningGraph.contextFor({ kind: "gate", id: "gate:missing" })).toMatchObject({
    state: "invalid",
    issues: [{ code: "unknown-target", target: "gate:missing" }],
  });
  expect(plan.planningGraph.contextFor({ kind: "gate", id: "roadmap:test" })).toMatchObject({
    state: "invalid",
    issues: [{ code: "target-kind-mismatch", target: "roadmap:test" }],
  });
});

test("Gate closure isolates duplicate Effort identities without dropping trustworthy contributors", async () => {
  const root = await createValidBearingRepo();
  await addSecondEffort(root);
  await writeFixture(
    root,
    ".scratch/duplicate/effort.md",
    `---
Type: effort
ID: effort:second
Title: Duplicate Second Effort
Roadmap: roadmap:test
Target gate: gate:test
Authorities: []
Citations: []
---

# Duplicate Effort

## Intent

Remain ambiguous.

## Work

- None.
`,
  );

  const result = (await prepareSync(root)).planningGraph.contextFor({
    kind: "gate",
    id: "gate:test",
  });

  expect(result.state).toBe("partial");
  if (result.state === "invalid") throw new Error("Expected trustworthy Gate context.");
  expect(result.context.efforts.map(({ effort }) => String(effort.value.id))).toEqual([
    "effort:test",
  ]);
  expect(result.issues.some((issue) => issue.code === "duplicate-stable-id")).toBe(true);
  expect(
    result.issues.filter((issue) => issue.code === "untrusted-effort-contributor"),
  ).toHaveLength(2);
});

test("Gate closure reports ambiguous Maps without selecting an arbitrary Map", async () => {
  const plan = await prepareSync(await createValidBearingRepo());
  const map = plan.nativeRecords.find((record) => record.locator === ".scratch/work/map.md");
  if (map === undefined) throw new Error("Expected fixture Map record.");
  const graph = await buildPlanningGraph({
    decoded: plan.decoded,
    nativeRecords: [...plan.nativeRecords, map],
    diagnostics: plan.diagnostics,
    fingerprint: plan.fingerprint,
    assetContentObservations: plan.assetContentObservations,
  });

  const result = graph.contextFor({ kind: "gate", id: "gate:test" });

  expect(result.state).toBe("partial");
  if (result.state === "invalid") throw new Error("Expected partial Gate context.");
  expect(result.context.efforts[0]?.map).toBeUndefined();
  expect(result.issues).toContainEqual({
    code: "ambiguous-native-map",
    target: "effort:test",
    message: "Multiple native Maps are attributed to one Effort.",
    source: result.context.efforts[0]?.effort.value.source,
  });
});

test("invalid Gate closure includes only issues belonging to the requested Gate", async () => {
  const root = await createValidBearingRepo();
  const duplicateGate = (id: string, title: string) => `---
Type: milestone-gate
ID: ${id}
Title: ${title}
Roadmap: roadmap:test
Status: active
---

# ${title}

## Intent

Exercise issue isolation.

## Exit Criteria

- Preserve scoped issues.
`;
  await writeFixture(
    root,
    ".bearing/state/milestone-gates/test-duplicate.md",
    duplicateGate("gate:test", "Duplicate Test Gate"),
  );
  await writeFixture(
    root,
    ".bearing/state/milestone-gates/other-one.md",
    duplicateGate("gate:other", "Other Gate One"),
  );
  await writeFixture(
    root,
    ".bearing/state/milestone-gates/other-two.md",
    duplicateGate("gate:other", "Other Gate Two"),
  );

  const result = (await prepareSync(root)).planningGraph.contextFor({
    kind: "gate",
    id: "gate:test",
  });

  expect(result.state).toBe("invalid");
  expect(
    result.issues.some(
      (issue) => issue.target === ".bearing/state/milestone-gates/test-duplicate.md",
    ),
  ).toBe(true);
  expect(result.issues.some((issue) => issue.target.includes("other"))).toBe(false);
});

test("Gate closure fails partial for native work behind an untrustworthy Effort scope only", async () => {
  const root = await createValidBearingRepo();
  await writeFixture(
    root,
    ".scratch/uncertain/effort.md",
    `---
Type: effort
ID: effort:uncertain
Title: Uncertain Effort
Roadmap: roadmap:test
Target gate: gate:test
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
  await writeFixture(
    root,
    ".scratch/safely-unbound/issues/01-invalid.md",
    `# Safely unbound diagnostic

Type: task
Status: unsupported
`,
  );

  const result = (await prepareSync(root)).planningGraph.contextFor({
    kind: "gate",
    id: "gate:test",
  });

  expect(result.state).toBe("partial");
  if (result.state === "invalid") throw new Error("Expected trustworthy Gate context.");
  expect(result.issues).toContainEqual({
    code: "unscopable-native-work",
    target: ".scratch/uncertain/issues/01-work.md",
    message: "Native work belongs to a scope whose Effort relation is unavailable.",
    source: expect.stringMatching(/^source:/u),
  });
  expect(
    result.issues.some((issue) => issue.target === ".scratch/safely-unbound/issues/01-invalid.md"),
  ).toBe(false);
});

test("Gate closure exposes a native diagnostic that has no safe scope", async () => {
  const plan = await prepareSync(await createValidBearingRepo());
  const graph = await buildPlanningGraph({
    decoded: plan.decoded,
    nativeRecords: plan.nativeRecords,
    diagnostics: [
      ...plan.diagnostics,
      {
        code: "unsupported-tracker-status",
        impact: "blocking",
        target: "unscopable-native-input",
        message: "Native work cannot be attributed to a safe scope.",
      },
      {
        code: "native-asset-has-registry-disposition",
        impact: "blocking",
        target: "asset:unrelated",
        message: "An unrelated Asset diagnostic stays outside Gate closure.",
      },
    ],
    fingerprint: plan.fingerprint,
    assetContentObservations: plan.assetContentObservations,
  });

  const result = graph.contextFor({ kind: "gate", id: "gate:test" });

  expect(result.state).toBe("partial");
  expect(result.issues).toContainEqual({
    code: "unsupported-tracker-status",
    target: "unscopable-native-input",
    message: "Native work cannot be attributed to a safe scope.",
  });
  expect(
    result.issues.some((issue) => issue.code === "native-asset-has-registry-disposition"),
  ).toBe(false);
});
