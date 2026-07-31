import type { RefinementCtx } from "zod";
import {
  type NativeScopeDiscoveryEffortCollection,
  type NativeScopeDiscoveryProjection,
  nativeScopeDiscoveryBindingContext,
  nativeScopeDiscoveryBindingDiagnostics,
} from "./native-scope-discovery";

type SnapshotDiagnostic = Readonly<{
  code: string;
  impact: "blocking" | "non-blocking";
  target: string;
  message: string;
}>;

export type NativeScopeDiscoveryConsistencySnapshot = Readonly<{
  efforts: NativeScopeDiscoveryEffortCollection;
  nativeScopeDiscovery: NativeScopeDiscoveryProjection;
  diagnostics: readonly SnapshotDiagnostic[];
}>;

const sameStringArray = (left: readonly string[], right: readonly string[]): boolean =>
  left.length === right.length && left.every((value, index) => value === right[index]);

export const validateNativeScopeDiscoveryConsistency = (
  snapshot: NativeScopeDiscoveryConsistencySnapshot,
  context: RefinementCtx,
): void => {
  const discovery = snapshot.nativeScopeDiscovery;
  if (discovery.state === "never-run") return;

  const attempt = discovery.latestAttempt;
  if (attempt === null && discovery.state !== "available") {
    context.addIssue({
      code: "custom",
      path: ["nativeScopeDiscovery", "latestAttempt"],
      message: "A non-available selected discovery observation must retain its latest attempt.",
    });
  }
  if (attempt !== null) {
    const sameObservation = attempt.observationId === discovery.observationId;
    const sameDiagnostics =
      JSON.stringify(attempt.diagnostics) === JSON.stringify(discovery.diagnostics);
    if (
      sameObservation &&
      (attempt.state !== discovery.state ||
        attempt.observedAt !== discovery.observedAt ||
        !sameDiagnostics)
    ) {
      context.addIssue({
        code: "custom",
        path: ["nativeScopeDiscovery", "latestAttempt"],
        message:
          "A latest attempt sharing the selected observation identity must match that observation exactly.",
      });
    }
    if (
      !sameObservation &&
      (attempt.state === "partial" || discovery.freshness !== "undetermined")
    ) {
      context.addIssue({
        code: "custom",
        path: ["nativeScopeDiscovery", "latestAttempt"],
        message:
          "A retained prior observation may differ only from a failed latest attempt and must have undetermined freshness.",
      });
    }
  }

  for (const [scopeIndex, scope] of discovery.scopes.entries()) {
    const expected = nativeScopeDiscoveryBindingContext(scope.summary, snapshot.efforts);
    if (
      scope.bindingContext.state !== expected.state ||
      !sameStringArray(scope.bindingContext.effortIds, expected.effortIds)
    ) {
      context.addIssue({
        code: "custom",
        path: ["nativeScopeDiscovery", "scopes", scopeIndex, "bindingContext"],
        message:
          "Discovered scope binding context must be derived exactly from trustworthy Efforts.",
      });
    }
  }

  const unboundCount = discovery.scopes.filter(
    (scope) => scope.bindingContext.state === "unbound",
  ).length;
  const exact =
    discovery.state === "available" &&
    discovery.freshness === "current" &&
    discovery.coverage === "complete" &&
    snapshot.efforts.validity === "available" &&
    discovery.latestAttempt === null;
  const expectedCount = exact
    ? ({ kind: "exact", value: unboundCount } as const)
    : unboundCount > 0
      ? ({ kind: "at-least", value: unboundCount } as const)
      : ({ kind: "unavailable" } as const);
  if (
    discovery.count.kind !== expectedCount.kind ||
    ("value" in expectedCount &&
      (!("value" in discovery.count) || discovery.count.value !== expectedCount.value))
  ) {
    context.addIssue({
      code: "custom",
      path: ["nativeScopeDiscovery", "count"],
      message: "Discovery count must match its coverage, trust state, and derived unbound scopes.",
    });
  }
  if (discovery.confirmedUnboundEmpty !== (exact && unboundCount === 0)) {
    context.addIssue({
      code: "custom",
      path: ["nativeScopeDiscovery", "confirmedUnboundEmpty"],
      message: "Only exact complete current zero-unbound discovery is confirmed empty.",
    });
  }

  const expectedBindingDiagnostics = nativeScopeDiscoveryBindingDiagnostics(discovery);
  const bindingDiagnosticCodes = new Set([
    "native-scope-discovery.binding-conflict",
    "native-scope-discovery.bound-unresolved",
    "native-scope-discovery.identity-mismatch",
    "native-scope-discovery.root-kind-conflict",
  ]);
  const actualBindingDiagnostics = snapshot.diagnostics.filter((diagnostic) =>
    bindingDiagnosticCodes.has(diagnostic.code),
  );
  const semanticKey = (diagnostic: SnapshotDiagnostic): string =>
    [diagnostic.code, diagnostic.impact, diagnostic.target, diagnostic.message].join("\u0000");
  const expectedKeys = new Set(expectedBindingDiagnostics.map(semanticKey));
  const actualKeys = new Set(actualBindingDiagnostics.map(semanticKey));
  if (
    expectedKeys.size !== actualKeys.size ||
    [...expectedKeys].some((key) => !actualKeys.has(key))
  ) {
    context.addIssue({
      code: "custom",
      path: ["diagnostics"],
      message:
        "Discovery binding diagnostics must be derived exactly from uncertain binding contexts.",
    });
  }
};
