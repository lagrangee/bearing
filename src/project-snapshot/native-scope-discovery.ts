import type { z } from "zod";
import type { DiscoveredNativeScope, NativeScopeDiscoveryView } from "../native-scope-discovery";
import type { MattSkillsV1ProviderObservation } from "../providers/matt-skills-v1/capture";
import {
  sameMattNativeBindingDefinition,
  sameMattNativeLocator,
  sameMattNativeScope,
} from "../providers/matt-skills-v1/native-subject";
import type { StructuralDiagnostic } from "../types";
import type { Effort } from "./contract";
import { nativeScopeDiscoveryProjectionSchema } from "./schema-native-scope-discovery";

export type NativeScopeDiscoveryProjection = Readonly<
  z.infer<typeof nativeScopeDiscoveryProjectionSchema>
>;

export type NativeScopeDiscoveryEffortCollection =
  | Readonly<{ validity: "available" | "partial"; items: readonly Effort[] }>
  | Readonly<{ validity: "invalid" }>;

const effortsWithBindings = (
  efforts:
    | Readonly<{ validity: "available" | "partial"; items: readonly Effort[] }>
    | Readonly<{ validity: "invalid" }>,
): readonly Effort[] =>
  efforts.validity === "invalid"
    ? []
    : efforts.items.filter((effort) => effort.workBinding !== undefined);

export const nativeScopeDiscoveryBindingContext = (
  summary: DiscoveredNativeScope,
  efforts: NativeScopeDiscoveryEffortCollection,
) => {
  const bindableEfforts = effortsWithBindings(efforts);
  const exactEffortIds = bindableEfforts
    .filter(
      (effort) =>
        effort.workBinding !== undefined &&
        sameMattNativeBindingDefinition(effort.workBinding, summary.binding),
    )
    .map((effort) => effort.id)
    .sort((left, right) => left.localeCompare(right, "en"));
  const rootKindConflictEffortIds = bindableEfforts
    .filter(
      (effort) =>
        effort.workBinding !== undefined &&
        sameMattNativeScope(effort.workBinding, summary.binding) &&
        !sameMattNativeBindingDefinition(effort.workBinding, summary.binding),
    )
    .map((effort) => effort.id)
    .sort((left, right) => left.localeCompare(right, "en"));
  const stableScopeEffortIds = [...exactEffortIds, ...rootKindConflictEffortIds].sort(
    (left, right) => left.localeCompare(right, "en"),
  );
  const identityMismatchEffortIds = bindableEfforts
    .filter(
      (effort) =>
        effort.workBinding !== undefined &&
        sameMattNativeLocator(effort.workBinding, summary.binding) &&
        !sameMattNativeScope(effort.workBinding, summary.binding),
    )
    .map((effort) => effort.id)
    .sort((left, right) => left.localeCompare(right, "en"));
  return identityMismatchEffortIds.length > 0
    ? ({ state: "identity-mismatch", effortIds: identityMismatchEffortIds } as const)
    : stableScopeEffortIds.length >= 2
      ? ({ state: "binding-conflict", effortIds: stableScopeEffortIds } as const)
      : rootKindConflictEffortIds.length > 0
        ? ({ state: "root-kind-conflict", effortIds: rootKindConflictEffortIds } as const)
        : efforts.validity !== "available"
          ? ({ state: "bound-unresolved", effortIds: exactEffortIds } as const)
          : exactEffortIds.length === 0
            ? ({ state: "unbound", effortIds: [] } as const)
            : ({ state: "bound", effortIds: [exactEffortIds[0] as string] } as const);
};

export const buildNativeScopeDiscoveryProjection = (
  view: NativeScopeDiscoveryView | undefined,
  efforts: NativeScopeDiscoveryEffortCollection,
  inspectionObservations: readonly MattSkillsV1ProviderObservation[] = [],
): NativeScopeDiscoveryProjection => {
  if (view === undefined) return { state: "never-run" };
  const scopes = view.scopes.map((summary) => ({
    summary,
    bindingContext: nativeScopeDiscoveryBindingContext(summary, efforts),
    detailAvailability: inspectionObservations.some((observation) =>
      sameMattNativeScope(observation.binding, summary.binding),
    )
      ? ("details-inspected" as const)
      : ("summary-only" as const),
  }));
  const unboundCount = scopes.filter((scope) => scope.bindingContext.state === "unbound").length;
  const exact =
    view.state === "available" &&
    view.freshness === "current" &&
    view.coverage === "complete" &&
    efforts.validity === "available" &&
    view.latestAttempt === null;
  return nativeScopeDiscoveryProjectionSchema.parse({
    state: view.state,
    provider: view.provider,
    observationId: view.observationId,
    observedAt: view.observedAt,
    ...(view.sourceRevision === undefined ? {} : { sourceRevision: view.sourceRevision }),
    freshness: view.freshness,
    coverage: view.coverage,
    scopes,
    count: exact
      ? { kind: "exact", value: unboundCount }
      : unboundCount > 0
        ? { kind: "at-least", value: unboundCount }
        : { kind: "unavailable" },
    confirmedUnboundEmpty: exact && unboundCount === 0,
    diagnostics: view.diagnostics,
    latestAttempt: view.latestAttempt,
  });
};

export const nativeScopeDiscoveryBindingDiagnostics = (
  projection: NativeScopeDiscoveryProjection,
): readonly StructuralDiagnostic[] => {
  if (projection.state === "never-run") return [];
  return projection.scopes.flatMap((scope) => {
    const context = scope.bindingContext;
    if (context.state === "unbound" || context.state === "bound") return [];
    const messages: Readonly<Record<typeof context.state, string>> = {
      "binding-conflict":
        "Multiple Efforts bind the same discovered native identity; no canonical parent is selected.",
      "bound-unresolved":
        "Canonical Effort coverage is incomplete, so this discovered scope cannot be classified as bound or unbound.",
      "identity-mismatch":
        "A Work Binding uses the same native locator but a different durable identity; explicit rebind is required.",
      "root-kind-conflict":
        "A Work Binding and discovery disagree on the native root definition; explicit repair is required.",
    };
    return [
      {
        code: `native-scope-discovery.${context.state}`,
        impact: "blocking" as const,
        target: scope.summary.locator,
        message: messages[context.state],
      },
    ];
  });
};
