import { expect, test } from "bun:test";
import { createProviderScopeObservation } from "../src/native-work-provider";
import type { MattProviderFactory } from "../src/provider-observation-acquisition";
import { prepareSync } from "../src/sync-plan";
import { createMattReferenceProjection } from "./fixtures/matt-reference-scenario";
import { createValidBearingRepo, writeFixture } from "./helpers";

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
