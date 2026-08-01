import { describe, expect, test } from "bun:test";
import {
  type ActivationDisposition,
  type ActivationOrigin,
  decideBearingActivation,
} from "../src/activation-policy";
import type { RepositoryIntegrationLifecycle } from "../src/repository-integration-lifecycle";

describe("Bearing activation policy", () => {
  const cases = [
    ["model-invoked", "active", true, "invoke-bearing"],
    ["model-invoked", "fresh", false, "continue-without-bearing"],
    ["model-invoked", "deactivated", false, "continue-without-bearing"],
    ["model-invoked", "invalid-or-unsupported", false, "stop-for-explicit-entry"],
    ["explicit", "active", true, "continue-bearing"],
    ["explicit", "fresh", false, "enter-setup"],
    ["explicit", "deactivated", false, "enter-reactivation"],
    ["explicit", "invalid-or-unsupported", false, "enter-recovery"],
  ] as const satisfies readonly (readonly [
    ActivationOrigin,
    RepositoryIntegrationLifecycle["kind"],
    boolean,
    ActivationDisposition,
  ])[];

  for (const [origin, kind, modelInvokedEligible, disposition] of cases) {
    test(`${origin} + ${kind} -> ${disposition}`, () => {
      expect(decideBearingActivation(origin, { kind, reason: "fixture" })).toEqual({
        schemaVersion: 1,
        origin,
        lifecycle: { kind, reason: "fixture" },
        modelInvokedEligible,
        disposition,
      });
    });
  }
});
