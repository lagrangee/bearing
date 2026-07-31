import { expect, test } from "bun:test";
import { createProviderScopeObservation } from "../src/native-work-provider";
import { buildRoadmapDetailModel } from "../src/portal-ui/project-roadmap-model";
import { findPlanningLineageSubjectProjection } from "../src/project-snapshot/planning-lineage";
import type { MattProviderFactory } from "../src/provider-observation-acquisition";
import { providerObservationSelectionSchema } from "../src/provider-observation-contract";
import { encodeGitHubMattNativeScope } from "../src/providers/matt-skills-v1/github-native-scope";
import { buildProjectSitemapModelFromGeneration } from "../src/sitemap-model";
import { commitSyncPlan, prepareSync } from "../src/sync-plan";
import { createMattReferenceProjection } from "./fixtures/matt-reference-scenario";
import { buildSnapshotForSyncPlan, createValidBearingRepo, writeFixture } from "./helpers";

test("acquires one observation for a duplicate binding but fails both contributors closed", async () => {
  const root = await createValidBearingRepo();
  await writeFixture(
    root,
    ".bearing/state/efforts/same-scope.md",
    `---
Type: effort
Lifecycle: active
Planned at: null
Activated at: null
ID: effort:same-scope
Title: Same Scope Effort
Roadmap: roadmap:test
Target gate: gate:test
Authorities: []
Citations: []
Work binding:
  Provider: matt-skills/v1
  Native scope: .scratch/work
---

# Effort: Same Scope

## Intent

Prove that duplicate bindings do not share completion or readiness.

## Work

- Reuse the existing bound scope.
`,
  );
  let captureCalls = 0;
  const requestedScopes: string[] = [];
  const providerFactory: MattProviderFactory = () => ({
    id: "matt-skills/v1",
    capture: async (binding) => {
      captureCalls += 1;
      requestedScopes.push(binding.nativeScope);
      return createProviderScopeObservation({
        provider: "matt-skills/v1",
        binding,
        state: "available",
        freshness: {
          assessment: "current",
          capturedAt: "2026-07-28T00:00:00Z",
          evidence: [{ kind: "fixture", value: "same-scope" }],
        },
        coverage: {
          assessment: "complete",
          dimensions: [{ key: "scope-membership", state: "covered" }],
        },
        completion: "incomplete",
        diagnostics: [],
        projection: createMattReferenceProjection("local"),
      });
    },
  });

  const plan = await prepareSync(root, {
    providerObservationIntent: "initial-baseline",
    providerFactory,
  });

  expect(captureCalls).toBe(1);
  expect(requestedScopes).toEqual([".scratch/work"]);
  expect(plan.metrics.providerAcquisitionCount).toBe(1);
  expect(plan.providerObservations).toHaveLength(1);
  expect(plan.providerObservationSelections[0]?.observationId).toBe(
    plan.providerObservations[0]?.id,
  );
  expect(plan.providerObservationSelections[0]?.effectiveFreshness).toBe("undetermined");
  expect(() =>
    providerObservationSelectionSchema.parse(plan.providerObservationSelections[0]),
  ).not.toThrow();
  expect(plan.diagnostics).toContainEqual(
    expect.objectContaining({
      code: "provider-binding-conflict",
      target: ".scratch/work",
    }),
  );
  expect(plan.planningGraph.contextFor({ kind: "effort", id: "effort:test" }).state).toBe(
    "partial",
  );
  expect(plan.planningGraph.contextFor({ kind: "effort", id: "effort:same-scope" }).state).toBe(
    "partial",
  );
});

test("reconciles canonical GitHub locator variants by stable native identity before conflict checks", async () => {
  const root = await createValidBearingRepo();
  const scope = (rootKind: "wayfinder-map" | "parent-issue", owner: string, number: number) =>
    encodeGitHubMattNativeScope({
      host: "github.com",
      rootKind,
      repository: {
        owner,
        name: "reference",
        databaseId: "9001",
        nodeId: "R_reference",
      },
      root: {
        objectKind: "issue",
        number,
        databaseId: "9101",
        nodeId: "I_reference_map",
      },
    });
  const original = scope("wayfinder-map", "example", 101);
  const relocated = scope("parent-issue", "display-owner", 999);
  const effort = (id: string, title: string, nativeScope: string) => `---
Type: effort
Lifecycle: active
Planned at: null
Activated at: null
ID: ${id}
Title: ${title}
Roadmap: roadmap:test
Target gate: gate:test
Authorities: []
Citations: []
Work binding:
  Provider: matt-skills/v1
  Native scope: ${nativeScope}
---

# Effort: ${title}

## Intent

Prove stable-identity conflict reconciliation.

## Work

- Keep both canonical locator observations explicit.
`;
  await Promise.all([
    writeFixture(
      root,
      ".bearing/state/efforts/test.md",
      effort("effort:test", "Original GitHub Scope", original),
    ),
    writeFixture(
      root,
      ".bearing/state/efforts/relocated.md",
      effort("effort:relocated", "Relocated GitHub Scope", relocated),
    ),
  ]);
  let captureCalls = 0;
  const providerFactory: MattProviderFactory = () => ({
    id: "matt-skills/v1",
    capture: async (binding) => {
      captureCalls += 1;
      return createProviderScopeObservation({
        provider: "matt-skills/v1",
        binding,
        state: "available",
        freshness: {
          assessment: "current",
          capturedAt: "2026-07-31T00:00:00Z",
          evidence: [{ kind: "fixture", value: "github-stable-identity" }],
        },
        coverage: {
          assessment: "complete",
          dimensions: [{ key: "scope-membership", state: "covered" }],
        },
        completion: "incomplete",
        diagnostics: [],
        projection: createMattReferenceProjection("github"),
      });
    },
  });

  const plan = await prepareSync(root, {
    providerObservationIntent: "initial-baseline",
    providerFactory,
  });

  expect(captureCalls).toBe(1);
  expect(plan.metrics.providerAcquisitionCount).toBe(1);
  expect(plan.providerObservationSelections).toHaveLength(1);
  expect(plan.providerObservationSelections[0]?.effectiveFreshness).toBe("undetermined");
  expect(plan.diagnostics).toContainEqual(
    expect.objectContaining({
      code: "provider-binding-conflict",
      message: expect.stringContaining("effort:relocated, effort:test"),
    }),
  );
  expect(plan.planningGraph.contextFor({ kind: "effort", id: "effort:test" }).state).toBe(
    "partial",
  );
  expect(plan.planningGraph.contextFor({ kind: "effort", id: "effort:relocated" }).state).toBe(
    "partial",
  );

  const snapshot = await buildSnapshotForSyncPlan(root, "0.0.0-test", plan);
  const originalEffort = findPlanningLineageSubjectProjection(snapshot.lineage, {
    kind: "effort",
    id: "effort:test",
  });
  const relocatedEffort = findPlanningLineageSubjectProjection(snapshot.lineage, {
    kind: "effort",
    id: "effort:relocated",
  });
  const originalBinding = originalEffort?.relations.find(
    (relation) => relation.key === "native-work.binding",
  );
  const relocatedBinding = relocatedEffort?.relations.find(
    (relation) => relation.key === "native-work.binding",
  );
  expect(originalBinding).toMatchObject({
    state: "present",
    targets: [
      {
        availability: "unavailable",
        subject: { kind: "native-scope", id: "github:R_reference:I_reference_map" },
        note: expect.stringContaining("Binding needs attention"),
      },
    ],
  });
  expect(relocatedBinding).toMatchObject({
    state: "present",
    targets: [
      {
        availability: "unavailable",
        subject: { kind: "native-scope", id: "github:R_reference:I_reference_map" },
        note: expect.stringContaining("Binding needs attention"),
      },
    ],
  });
  const nativeScope = findPlanningLineageSubjectProjection(snapshot.lineage, {
    kind: "native-scope",
    id: "github:R_reference:I_reference_map",
  });
  expect(nativeScope?.parentPath).toEqual({
    state: "truncated-unavailable",
    ancestors: [],
    reason: "Native scope has conflicting canonical Work Bindings.",
  });

  expect(
    snapshot.gates.validity === "invalid"
      ? undefined
      : snapshot.gates.items.find((gate) => gate.id === "gate:test")?.readiness,
  ).toBe("unknown");
  const roadmap = buildRoadmapDetailModel(snapshot, "roadmap:test");
  expect(roadmap.state).toBe("partial");
  if (roadmap.state !== "partial" && roadmap.state !== "available") {
    throw new Error("Expected a readable Roadmap projection.");
  }
  expect(
    roadmap.efforts.map((item) => ({
      id: String(item.effort.id),
      mapCount: item.maps.length,
      frontierEvidence: item.providerAssessment?.frontierEvidence,
    })),
  ).toEqual([
    { id: "effort:relocated", mapCount: 0, frontierEvidence: "withheld" },
    { id: "effort:test", mapCount: 0, frontierEvidence: "withheld" },
  ]);

  const sitemap = buildProjectSitemapModelFromGeneration(
    plan.decoded,
    plan.providerObservations,
    plan.diagnostics,
    plan.advisoryFreshness,
    plan.planningGraph.planningProjection(),
  );
  const mapNodes = sitemap.nodes.filter((node) => node.reference === "github:opaque:map");
  expect(mapNodes).toHaveLength(1);
  expect(mapNodes[0]?.links).toEqual([
    { label: "effort", target: "effort:relocated" },
    { label: "effort", target: "effort:test" },
  ]);
});

test("reuses a frozen GitHub observation across a stable-identity reparent on ordinary Sync", async () => {
  const root = await createValidBearingRepo();
  const scope = (rootKind: "wayfinder-map" | "parent-issue", owner: string, number: number) =>
    encodeGitHubMattNativeScope({
      host: "github.com",
      rootKind,
      repository: {
        owner,
        name: "reference",
        databaseId: "9001",
        nodeId: "R_reference",
      },
      root: {
        objectKind: "issue",
        number,
        databaseId: "9101",
        nodeId: "I_reference_map",
      },
    });
  const original = scope("wayfinder-map", "example", 101);
  const relocated = scope("wayfinder-map", "display-owner", 999);
  const reinterpreted = scope("parent-issue", "display-owner", 999);
  const effort = (nativeScope: string) => `---
Type: effort
Lifecycle: active
Planned at: null
Activated at: null
ID: effort:test
Title: Test Effort
Roadmap: roadmap:test
Target gate: gate:test
Authorities: []
Citations: []
Work binding:
  Provider: matt-skills/v1
  Native scope: ${nativeScope}
---

# Effort: Test Effort

## Intent

Keep the stable native subject route across a trustworthy reparent.

## Work

- Reuse the frozen observation until explicit verification refreshes display facts.
`;
  await writeFixture(root, ".bearing/state/efforts/test.md", effort(original));
  let captureCalls = 0;
  const providerFactory: MattProviderFactory = () => ({
    id: "matt-skills/v1",
    capture: async (binding) => {
      captureCalls += 1;
      return createProviderScopeObservation({
        provider: "matt-skills/v1",
        binding,
        state: "available",
        freshness: {
          assessment: "current",
          capturedAt: "2026-07-31T00:00:00Z",
          evidence: [{ kind: "fixture", value: "github-reparent-baseline" }],
        },
        coverage: {
          assessment: "complete",
          dimensions: [{ key: "scope-membership", state: "covered" }],
        },
        completion: "incomplete",
        diagnostics: [],
        projection: createMattReferenceProjection("github"),
      });
    },
  });
  const baseline = await prepareSync(root, {
    providerObservationIntent: "initial-baseline",
    providerFactory,
  });
  await commitSyncPlan(baseline);
  const baselineObservation = baseline.providerObservations[0];
  if (baselineObservation === undefined) {
    throw new Error("Expected one reusable GitHub baseline observation.");
  }
  expect(captureCalls).toBe(1);
  expect(baselineObservation?.binding.nativeScope).toBe(original);

  await writeFixture(root, ".bearing/state/efforts/test.md", effort(relocated));
  const ordinary = await prepareSync(root);

  expect(captureCalls).toBe(1);
  expect(ordinary.providerObservationOperation).toMatchObject({
    intent: "ordinary-sync",
    outcome: "reused",
    acquisitionCount: 0,
  });
  expect(ordinary.providerObservations).toEqual([baselineObservation]);
  expect(ordinary.providerObservationSelections).toEqual([
    expect.objectContaining({
      provider: "matt-skills/v1",
      nativeScope: relocated,
      observationId: baselineObservation?.id,
      effectiveFreshness: "current",
    }),
  ]);
  expect(ordinary.diagnostics).not.toContainEqual(
    expect.objectContaining({ code: "provider-observation-unavailable" }),
  );

  const snapshot = await buildSnapshotForSyncPlan(root, "0.0.0-test", ordinary);
  expect(snapshot.providerObservations).toHaveLength(1);
  expect(snapshot.providerObservationSelections).toHaveLength(1);
  expect(
    findPlanningLineageSubjectProjection(snapshot.lineage, {
      kind: "native-scope",
      id: "github:R_reference:I_reference_map",
    }),
  ).toBeDefined();

  await writeFixture(root, ".bearing/state/efforts/test.md", effort(reinterpreted));
  const incompatible = await prepareSync(root);
  expect(incompatible.providerObservationOperation).toMatchObject({
    intent: "ordinary-sync",
    outcome: "unavailable",
    acquisitionCount: 0,
  });
  expect(incompatible.providerObservations).toEqual([]);
  expect(incompatible.providerObservationSelections).toEqual([
    expect.objectContaining({
      nativeScope: reinterpreted,
      observationId: null,
      effectiveFreshness: "undetermined",
    }),
  ]);
  expect(incompatible.diagnostics).toContainEqual(
    expect.objectContaining({
      code: "provider-observation-unavailable",
      target: reinterpreted,
    }),
  );
});
