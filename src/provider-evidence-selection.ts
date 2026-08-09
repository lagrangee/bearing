import stableStringify from "safe-stable-stringify";
import type { DecodedBearingRecordGeneration } from "./bearing-record-decoder";
import {
  affectedSetFor,
  type NativeReconciliationRequest,
  nativeReconciliationRequestFingerprint,
} from "./native-reconciliation-contract";
import type { ProjectInputGeneration } from "./project-input-generation";
import {
  acquireProviderObservations,
  boundProviderScopes,
  type MattProviderFactory,
  ProviderObservationAcquisitionUnavailableError,
  providerBindingConflicts,
  resolveMattProvider,
} from "./provider-acquisition";
import type {
  ProviderObservationAcquisitionIntent,
  ProviderObservationAttempt,
  ProviderObservationIntent,
  ProviderObservationOperation,
  ProviderObservationSelection,
} from "./provider-evidence-contract";
import type {
  MattSkillsV1ProviderObservation,
  MattSkillsV1WorkBinding,
} from "./providers/matt-skills-v1/capture";
import {
  mattNativeScopeKey,
  sameMattNativeBindingDefinition,
} from "./providers/matt-skills-v1/native-subject";
import type { StructuralDiagnostic } from "./types";

export type {
  ProviderObservationAcquisitionIntent,
  ProviderObservationAttempt,
  ProviderObservationIntent,
  ProviderObservationOperation,
  ProviderObservationSelection,
} from "./provider-evidence-contract";
export type ProviderEvidenceState = Readonly<{
  schemaVersion: 1;
  observations: readonly MattSkillsV1ProviderObservation[];
  selections: readonly ProviderObservationSelection[];
}>;
export type ProviderEvidenceSelectionResult = Readonly<{
  observations: readonly MattSkillsV1ProviderObservation[];
  selections: readonly ProviderObservationSelection[];
  diagnostics: readonly StructuralDiagnostic[];
  operation: ProviderObservationOperation;
  store: ProviderEvidenceState;
}>;

export { ProviderObservationAcquisitionUnavailableError } from "./provider-acquisition";

const observationFor = (
  store: ProviderEvidenceState,
  selection: ProviderObservationSelection,
): MattSkillsV1ProviderObservation | undefined =>
  selection.observationId === null
    ? undefined
    : store.observations.find((observation) => observation.id === selection.observationId);

const selectionFor = (
  store: ProviderEvidenceState,
  binding: MattSkillsV1WorkBinding,
): ProviderObservationSelection | undefined =>
  store.selections.find((selection) => sameMattNativeBindingDefinition(selection, binding));

const unavailableDiagnostic = (
  code: string,
  target: string,
  message: string,
): StructuralDiagnostic => ({ code, impact: "blocking", target, message });

const selectedFrom = (
  store: ProviderEvidenceState,
  bindings: readonly MattSkillsV1WorkBinding[],
): Readonly<{
  observations: readonly MattSkillsV1ProviderObservation[];
  selections: readonly ProviderObservationSelection[];
  diagnostics: readonly StructuralDiagnostic[];
}> => {
  const observations: MattSkillsV1ProviderObservation[] = [];
  const selections: ProviderObservationSelection[] = [];
  const diagnostics: StructuralDiagnostic[] = [];
  for (const binding of bindings) {
    const storedSelection = selectionFor(store, binding);
    const observation =
      storedSelection === undefined ? undefined : observationFor(store, storedSelection);
    const selection =
      storedSelection === undefined
        ? undefined
        : {
            ...storedSelection,
            provider: binding.provider,
            nativeScope: binding.nativeScope,
          };
    if (selection === undefined || observation === undefined) {
      diagnostics.push(
        unavailableDiagnostic(
          "provider-observation-unavailable",
          binding.nativeScope,
          "No reusable provider observation exists for this Work Binding; run exact-scope capture.",
        ),
        ...(selection?.latestAttempt?.diagnostics ?? []),
      );
      selections.push(
        selection ?? {
          provider: binding.provider,
          nativeScope: binding.nativeScope,
          observationId: null,
          effectiveFreshness: "undetermined",
          latestAttempt: null,
        },
      );
      continue;
    }
    observations.push(observation);
    selections.push(selection);
    diagnostics.push(
      ...observation.diagnostics.map((item) => ({
        code: item.code,
        impact: item.impact,
        target: item.target,
        message: item.message,
      })),
    );
  }
  return {
    observations,
    selections,
    diagnostics: [
      ...new Map(
        diagnostics.map((item) => [
          `${item.code}\0${item.impact}\0${item.target}\0${item.message}`,
          item,
        ]),
      ).values(),
    ],
  };
};

const withBindingConflicts = (
  selected: Readonly<{
    observations: readonly MattSkillsV1ProviderObservation[];
    selections: readonly ProviderObservationSelection[];
    diagnostics: readonly StructuralDiagnostic[];
  }>,
  conflicts: ReturnType<typeof providerBindingConflicts>,
): typeof selected => {
  if (conflicts.length === 0) return selected;
  const conflictKeys = new Set(conflicts.map((conflict) => mattNativeScopeKey(conflict.binding)));
  return {
    observations: selected.observations,
    selections: selected.selections.map((selection) =>
      conflictKeys.has(mattNativeScopeKey(selection))
        ? { ...selection, effectiveFreshness: "undetermined" as const }
        : selection,
    ),
    diagnostics: [...selected.diagnostics, ...conflicts.map((conflict) => conflict.diagnostic)],
  };
};

const selectCurrentObservations = (
  prior: ProviderEvidenceState | undefined,
  next: readonly MattSkillsV1ProviderObservation[],
  selections: readonly ProviderObservationSelection[],
): readonly MattSkillsV1ProviderObservation[] => {
  const byId = new Map(
    (prior?.observations ?? []).map((observation) => [observation.id, observation]),
  );
  for (const observation of next) byId.set(observation.id, observation);
  const selectedIds = new Set(
    selections.flatMap((selection) =>
      selection.observationId === null ? [] : [selection.observationId],
    ),
  );
  return [...byId.values()]
    .filter((observation) => selectedIds.has(observation.id))
    .sort((left, right) => left.id.localeCompare(right.id, "en"));
};

const acquisitionAttemptAt = (
  observations: readonly MattSkillsV1ProviderObservation[],
  fallback: () => string,
): string =>
  observations
    .map((observation) => observation.observedAt)
    .sort((left, right) => left.localeCompare(right, "en"))
    .at(-1) ?? fallback();

const structuralObservationDiagnostics = (
  observation: MattSkillsV1ProviderObservation,
): readonly StructuralDiagnostic[] =>
  observation.diagnostics.map((item) => ({
    code: item.code,
    impact: item.impact,
    target: item.target,
    message: item.message,
  }));

const acquisitionSucceeded = (observation: MattSkillsV1ProviderObservation): boolean =>
  observation.state === "available" &&
  observation.freshness.assessment === "current" &&
  observation.coverage.assessment === "complete" &&
  observation.coverage.dimensions.every(
    (dimension) => dimension.state !== "gap" && dimension.state !== "conflict",
  ) &&
  observation.diagnostics.every((diagnostic) => diagnostic.impact !== "blocking");

const incompleteAcquisitionDiagnostic = (
  observation: MattSkillsV1ProviderObservation | undefined,
  binding: MattSkillsV1WorkBinding,
): StructuralDiagnostic =>
  unavailableDiagnostic(
    "provider-acquisition-incomplete",
    binding.nativeScope,
    observation === undefined
      ? "Provider observation acquisition returned no observation for the bound scope."
      : `Provider observation acquisition returned ${observation.state}/${observation.freshness.assessment} evidence; prior evidence remains selected when available.`,
  );

export const selectProviderObservations = async (
  input: Readonly<{
    generation: ProjectInputGeneration;
    decoded: DecodedBearingRecordGeneration;
    intent: ProviderObservationIntent;
    providerFactory?: MattProviderFactory;
    now?: () => string;
    nativeReconciliationRequest?: NativeReconciliationRequest;
    priorStore?: ProviderEvidenceState | null;
    requestedBindings?: readonly MattSkillsV1WorkBinding[];
  }>,
): Promise<ProviderEvidenceSelectionResult> => {
  const prior = input.priorStore ?? undefined;
  const bindings = boundProviderScopes(input.decoded);
  const bindingConflicts = providerBindingConflicts(input.decoded);
  const acquisitionIntent: ProviderObservationAcquisitionIntent | undefined =
    input.intent === "exact-scope-capture" || input.intent === "all-scope-verification"
      ? input.intent
      : undefined;
  if (input.intent === "reuse-current") {
    const selectedBase =
      prior === undefined
        ? {
            observations: [],
            selections: bindings.map((binding) => ({
              provider: binding.provider,
              nativeScope: binding.nativeScope,
              observationId: null,
              effectiveFreshness: "undetermined" as const,
              latestAttempt: null,
            })),
            diagnostics: [
              ...bindings.map((binding) =>
                unavailableDiagnostic(
                  "provider-observation-unavailable",
                  binding.nativeScope,
                  "No reusable provider observation exists for this Work Binding; run exact-scope capture.",
                ),
              ),
            ],
          }
        : selectedFrom(prior, bindings);
    const selected = withBindingConflicts(selectedBase, bindingConflicts);
    const store = prior ?? ({ schemaVersion: 1, observations: [], selections: [] } as const);
    return {
      ...selected,
      operation: {
        intent: "reuse-current",
        outcome: selected.diagnostics.length === 0 ? "reused" : "unavailable",
        acquisitionCount: 0,
      },
      store,
    };
  }

  if (input.intent === "targeted-reconciliation") {
    const request = input.nativeReconciliationRequest;
    if (request === undefined) {
      throw new TypeError("Targeted provider reconciliation requires one validated request.");
    }
    const requestFingerprint = nativeReconciliationRequestFingerprint(request);
    const matchedBinding = bindings.find((binding) =>
      sameMattNativeBindingDefinition(binding, request.binding),
    );
    if (matchedBinding === undefined) {
      const selectedBase =
        prior === undefined
          ? { observations: [], selections: [], diagnostics: [] }
          : selectedFrom(prior, bindings);
      const selected = withBindingConflicts(selectedBase, bindingConflicts);
      const store = prior ?? ({ schemaVersion: 1, observations: [], selections: [] } as const);
      return {
        ...selected,
        operation: {
          intent: "targeted-reconciliation",
          outcome: "not-applicable",
          acquisitionCount: 0,
        },
        store,
      };
    }

    const attemptedAt = (input.now ?? (() => new Date().toISOString()))();
    const priorSelection = prior === undefined ? undefined : selectionFor(prior, matchedBinding);
    const priorObservation =
      prior === undefined || priorSelection === undefined
        ? undefined
        : observationFor(prior, priorSelection);
    let observation: MattSkillsV1ProviderObservation | undefined;
    let attemptDiagnostics: readonly StructuralDiagnostic[] = [];
    let acquisitionCount = 0;
    if (
      priorObservation === undefined ||
      priorSelection?.effectiveFreshness !== "current" ||
      priorSelection.latestAttempt?.outcome === "failed"
    ) {
      attemptDiagnostics = [
        unavailableDiagnostic(
          "provider-targeted-reconciliation-basis-unavailable",
          matchedBinding.nativeScope,
          "Targeted reconciliation requires one current prior full-scope observation; run exact-scope capture.",
        ),
      ];
    } else {
      const resolution = resolveMattProvider(input.generation, input.providerFactory);
      if (resolution.state === "unavailable") {
        attemptDiagnostics = resolution.diagnostics;
      } else if (resolution.provider.reconcile === undefined) {
        attemptDiagnostics = [
          unavailableDiagnostic(
            "provider-targeted-reconciliation-unsupported",
            matchedBinding.nativeScope,
            "The confirmed native-work provider does not support targeted reconciliation.",
          ),
        ];
      } else {
        try {
          acquisitionCount = 1;
          observation = await resolution.provider.reconcile({
            binding: matchedBinding,
            prior: priorObservation,
            affected: affectedSetFor(request),
          });
          attemptDiagnostics = structuralObservationDiagnostics(observation);
        } catch (error) {
          if (!(error instanceof ProviderObservationAcquisitionUnavailableError)) throw error;
          attemptDiagnostics = [
            unavailableDiagnostic(
              "provider-targeted-reconciliation-failed",
              matchedBinding.nativeScope,
              "Targeted provider reconciliation could not complete its bounded read.",
            ),
          ];
        }
      }
    }
    const successfulObservation =
      observation !== undefined && acquisitionSucceeded(observation) ? observation : undefined;
    const succeeded = successfulObservation !== undefined;
    const failureDiagnostics = succeeded
      ? attemptDiagnostics
      : [...attemptDiagnostics, incompleteAcquisitionDiagnostic(observation, matchedBinding)];
    const selections: ProviderObservationSelection[] = bindings.map((binding) => {
      const existing = prior === undefined ? undefined : selectionFor(prior, binding);
      const existingObservation =
        prior === undefined || existing === undefined ? undefined : observationFor(prior, existing);
      if (!sameMattNativeBindingDefinition(binding, matchedBinding)) {
        return (
          existing ?? {
            provider: binding.provider,
            nativeScope: binding.nativeScope,
            observationId: null,
            effectiveFreshness: "undetermined",
            latestAttempt: null,
          }
        );
      }
      return {
        provider: binding.provider,
        nativeScope: binding.nativeScope,
        observationId: successfulObservation?.id ?? existingObservation?.id ?? null,
        effectiveFreshness:
          successfulObservation?.freshness.assessment ??
          existingObservation?.freshness.assessment ??
          ("undetermined" as const),
        latestAttempt: {
          intent: "targeted-reconciliation",
          attemptedAt,
          outcome: succeeded ? "succeeded" : "failed",
          diagnostics: succeeded ? attemptDiagnostics : failureDiagnostics,
          requestFingerprint,
        },
      };
    });
    const store: ProviderEvidenceState = {
      schemaVersion: 1,
      observations: selectCurrentObservations(
        prior,
        observation === undefined ? [] : [observation],
        selections,
      ),
      selections,
    };
    const selected = withBindingConflicts(selectedFrom(store, bindings), bindingConflicts);
    return {
      observations: selected.observations,
      selections: selected.selections,
      diagnostics: selected.diagnostics,
      operation: {
        intent: "targeted-reconciliation",
        outcome: succeeded
          ? "acquired"
          : priorObservation === undefined
            ? "unavailable"
            : "retained-after-failure",
        acquisitionCount,
      },
      store,
    };
  }

  if (acquisitionIntent === undefined) {
    throw new TypeError("Provider acquisition intent is unavailable.");
  }

  try {
    const acquired = await acquireProviderObservations(
      input.generation,
      input.decoded,
      input.providerFactory,
      input.requestedBindings,
    );
    const attemptedAt = acquisitionAttemptAt(
      acquired.observations,
      input.now ?? (() => new Date().toISOString()),
    );
    let retainedPrior = false;
    let unavailable = false;
    const selections: ProviderObservationSelection[] = bindings.map((binding) => {
      const requested =
        input.requestedBindings === undefined ||
        input.requestedBindings.some((candidate) =>
          sameMattNativeBindingDefinition(candidate, binding),
        );
      const observation = acquired.observations.find((candidate) =>
        sameMattNativeBindingDefinition(candidate.binding, binding),
      );
      const priorSelection = prior === undefined ? undefined : selectionFor(prior, binding);
      const priorObservation =
        prior === undefined || priorSelection === undefined
          ? undefined
          : observationFor(prior, priorSelection);
      if (!requested) {
        return (
          priorSelection ?? {
            provider: binding.provider,
            nativeScope: binding.nativeScope,
            observationId: null,
            effectiveFreshness: "undetermined",
            latestAttempt: null,
          }
        );
      }
      const succeeded = observation !== undefined && acquisitionSucceeded(observation);
      const failure = acquired.failures.find((candidate) =>
        sameMattNativeBindingDefinition(candidate.binding, binding),
      );
      const diagnostics = [
        ...(observation === undefined
          ? (failure?.diagnostics ?? acquired.diagnostics)
          : structuralObservationDiagnostics(observation)),
        ...(succeeded ? [] : [incompleteAcquisitionDiagnostic(observation, binding)]),
      ];
      const latestAttempt: ProviderObservationAttempt = {
        intent: acquisitionIntent,
        attemptedAt,
        outcome: succeeded ? "succeeded" : "failed",
        diagnostics,
      };
      if (!succeeded && priorObservation !== undefined) {
        retainedPrior = true;
        return {
          provider: binding.provider,
          nativeScope: binding.nativeScope,
          observationId: priorObservation.id,
          effectiveFreshness: priorObservation.freshness.assessment,
          latestAttempt,
        };
      }
      if (!succeeded) unavailable = true;
      return {
        provider: binding.provider,
        nativeScope: binding.nativeScope,
        observationId: succeeded && observation !== undefined ? observation.id : null,
        effectiveFreshness: succeeded
          ? observation.freshness.assessment
          : ("undetermined" as const),
        latestAttempt,
      };
    });
    const store: ProviderEvidenceState = {
      schemaVersion: 1,
      observations: selectCurrentObservations(prior, acquired.observations, selections),
      selections,
    };
    const selected = withBindingConflicts(selectedFrom(store, bindings), bindingConflicts);
    return {
      observations: selected.observations,
      selections: selected.selections,
      diagnostics: selected.diagnostics,
      operation: {
        intent: acquisitionIntent,
        outcome: retainedPrior
          ? "retained-after-failure"
          : unavailable
            ? "unavailable"
            : "acquired",
        acquisitionCount: acquired.acquisitionCount,
      },
      store,
    };
  } catch (error) {
    if (!(error instanceof ProviderObservationAcquisitionUnavailableError)) throw error;
    const failure = unavailableDiagnostic(
      "provider-acquisition-failed",
      ".bearing/provider.json",
      error instanceof Error
        ? `Provider observation acquisition failed: ${error.message}`
        : "Provider observation acquisition failed.",
    );
    if (prior === undefined) {
      const attemptedAt = (input.now ?? (() => new Date().toISOString()))();
      const selections: ProviderObservationSelection[] = bindings.map((binding) => {
        const requested =
          input.requestedBindings === undefined ||
          input.requestedBindings.some((candidate) =>
            sameMattNativeBindingDefinition(candidate, binding),
          );
        return {
          provider: binding.provider,
          nativeScope: binding.nativeScope,
          observationId: null,
          effectiveFreshness: "undetermined",
          latestAttempt: requested
            ? {
                intent: acquisitionIntent,
                attemptedAt,
                outcome: "failed" as const,
                diagnostics: [failure],
              }
            : null,
        };
      });
      const store: ProviderEvidenceState = {
        schemaVersion: 1,
        observations: [],
        selections,
      };
      const selected = withBindingConflicts(selectedFrom(store, bindings), bindingConflicts);
      return {
        observations: selected.observations,
        selections: selected.selections,
        diagnostics: selected.diagnostics,
        operation: {
          intent: acquisitionIntent,
          outcome: "unavailable",
          acquisitionCount: 0,
        },
        store,
      };
    }
    const attemptedAt = (input.now ?? (() => new Date().toISOString()))();
    const selections: ProviderObservationSelection[] = bindings.map((binding) => {
      const selection = selectionFor(prior, binding);
      const observation = selection === undefined ? undefined : observationFor(prior, selection);
      const requested =
        input.requestedBindings === undefined ||
        input.requestedBindings.some((candidate) =>
          sameMattNativeBindingDefinition(candidate, binding),
        );
      if (!requested) {
        return (
          selection ?? {
            provider: binding.provider,
            nativeScope: binding.nativeScope,
            observationId: null,
            effectiveFreshness: "undetermined",
            latestAttempt: null,
          }
        );
      }
      return {
        provider: binding.provider,
        nativeScope: binding.nativeScope,
        observationId: selection?.observationId ?? null,
        effectiveFreshness: observation?.freshness.assessment ?? "undetermined",
        latestAttempt: {
          intent: acquisitionIntent,
          attemptedAt,
          outcome: "failed",
          diagnostics: [failure],
        },
      };
    });
    const store: ProviderEvidenceState = { ...prior, selections };
    const selected = withBindingConflicts(selectedFrom(store, bindings), bindingConflicts);
    return {
      observations: selected.observations,
      selections: selected.selections,
      diagnostics: selected.diagnostics,
      operation: {
        intent: acquisitionIntent,
        outcome: "retained-after-failure",
        acquisitionCount: 0,
      },
      store,
    };
  }
};

export const fingerprintProviderObservationSelection = (
  observations: readonly MattSkillsV1ProviderObservation[],
  selections: readonly ProviderObservationSelection[],
): string =>
  stableStringify({
    observations: [...observations]
      .sort((left, right) =>
        mattNativeScopeKey(left.binding).localeCompare(mattNativeScopeKey(right.binding), "en"),
      )
      .map(({ id: _id, ...observation }) => withoutInferredDisplayTime(observation)),
    selections: [...selections]
      .sort((left, right) =>
        mattNativeScopeKey(left).localeCompare(mattNativeScopeKey(right), "en"),
      )
      .map(({ latestAttempt: _latestAttempt, ...selection }) => ({
        ...selection,
        observationId: selection.observationId === null ? null : "selected",
      })),
  }) ?? "";

const withoutInferredDisplayTime = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(withoutInferredDisplayTime);
  if (value === null || typeof value !== "object") return value;
  const record = value as Readonly<Record<string, unknown>>;
  if (record["availability"] === "available" && record["basis"] === "inferred-source-metadata") {
    return { availability: "available", basis: "inferred-source-metadata" };
  }
  return Object.fromEntries(
    Object.entries(record).map(([key, item]) => [key, withoutInferredDisplayTime(item)]),
  );
};
