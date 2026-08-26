import { expect, test } from "bun:test";
import { targetedReconciliationBasis } from "../src/provider-evidence-contract";

const observation = {
  id: "provider-observation:current",
  freshness: { assessment: "current" as const },
};

test("targeted reconciliation basis distinguishes ready evidence from capture-required states", () => {
  expect(targetedReconciliationBasis(undefined, undefined)).toEqual({
    state: "capture-required",
    reason: "observation-unavailable",
  });
  expect(
    targetedReconciliationBasis(
      {
        provider: "matt-skills/v1",
        nativeScope: ".scratch/example",
        observationId: observation.id,
        effectiveFreshness: "stale",
        latestAttempt: null,
      },
      observation,
    ),
  ).toEqual({ state: "capture-required", reason: "freshness-not-current" });
  expect(
    targetedReconciliationBasis(
      {
        provider: "matt-skills/v1",
        nativeScope: ".scratch/example",
        observationId: observation.id,
        effectiveFreshness: "current",
        latestAttempt: {
          intent: "targeted-reconciliation",
          attemptedAt: "2026-08-24T00:00:00.000Z",
          outcome: "failed",
          diagnostics: [],
          requestFingerprint: `sha256:${"1".repeat(64)}`,
        },
      },
      observation,
    ),
  ).toEqual({ state: "capture-required", reason: "latest-attempt-failed" });
  expect(
    targetedReconciliationBasis(
      {
        provider: "matt-skills/v1",
        nativeScope: ".scratch/example",
        observationId: observation.id,
        effectiveFreshness: "current",
        latestAttempt: null,
      },
      observation,
    ),
  ).toEqual({ state: "ready" });
});
