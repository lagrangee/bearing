import { expect, test } from "bun:test";
import { createProviderScopeCapture } from "../src/native-work-provider";
import type { MattProviderFactory } from "../src/provider-capture-generation";
import { prepareSync } from "../src/sync-plan";
import { createMattReferenceProjection } from "./fixtures/matt-reference-scenario";
import { createValidBearingRepo, writeFixture } from "./helpers";

test("captures one provider observation for duplicate Effort bindings in one generation", async () => {
  const root = await createValidBearingRepo();
  await writeFixture(
    root,
    ".bearing/state/efforts/same-scope.md",
    `---
Type: effort
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

Prove that duplicate bindings share one capture observation.

## Work

- Reuse the existing bound scope.
`,
  );
  let captureCalls = 0;
  const requestedScopes: string[] = [];
  const providerFactory: MattProviderFactory = () => ({
    id: "matt-skills/v1",
    capture: async (binding, generation) => {
      captureCalls += 1;
      requestedScopes.push(binding.nativeScope);
      return createProviderScopeCapture({
        provider: "matt-skills/v1",
        binding,
        generation,
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

  const plan = await prepareSync(root, { providerFactory });

  expect(captureCalls).toBe(1);
  expect(requestedScopes).toEqual([".scratch/work"]);
  expect(plan.metrics.providerCaptureCount).toBe(1);
  expect(plan.providerCaptures).toHaveLength(1);
  expect(plan.providerCaptures[0]?.generation.fingerprint).toBe(plan.fingerprint);
  expect(plan.planningGraph.contextFor({ kind: "effort", id: "effort:test" }).state).toBe(
    "complete",
  );
  expect(plan.planningGraph.contextFor({ kind: "effort", id: "effort:same-scope" }).state).toBe(
    "complete",
  );
});
