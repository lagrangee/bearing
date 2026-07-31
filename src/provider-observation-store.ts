import { join } from "node:path";
import stableStringify from "safe-stable-stringify";
import { z } from "zod";
import type { DecodedBearingRecordGeneration } from "./bearing-record-decoder";
import {
  affectedSetFor,
  type NativeReconciliationRequest,
  nativeReconciliationRequestFingerprint,
} from "./native-reconciliation-contract";
import {
  acquireProviderObservations,
  boundProviderScopes,
  type MattProviderFactory,
  providerBindingConflicts,
  resolveMattProvider,
} from "./provider-observation-acquisition";
import {
  type ProviderObservationAcquisitionIntent,
  type ProviderObservationAttempt,
  type ProviderObservationIntent,
  type ProviderObservationOperation,
  type ProviderObservationSelection,
  providerObservationSelectionSchema,
} from "./provider-observation-contract";
import type {
  MattSkillsV1ProviderObservation,
  MattSkillsV1WorkBinding,
} from "./providers/matt-skills-v1/capture";
import {
  mattNativeScopeKey,
  sameMattNativeBindingDefinition,
} from "./providers/matt-skills-v1/native-subject";
import { mattSkillsV1ProviderObservationSchema } from "./providers/matt-skills-v1/schema";
import type { SyncInputGeneration } from "./sync-input-generation";
import type { StructuralDiagnostic } from "./types";
import { readValidatedJsonCache, serializeValidatedJson } from "./validated-json-cache";

export const PROVIDER_OBSERVATION_STORE_FILENAME = "provider-observations.json";
const STORE_VERSION = 1;

export type {
  ProviderObservationAcquisitionIntent,
  ProviderObservationAttempt,
  ProviderObservationIntent,
  ProviderObservationOperation,
  ProviderObservationSelection,
} from "./provider-observation-contract";
export type ProviderObservationStore = Readonly<{
  schemaVersion: 1;
  observations: readonly MattSkillsV1ProviderObservation[];
  selections: readonly ProviderObservationSelection[];
}>;
export type ProviderObservationSelectionPlan = Readonly<{
  observations: readonly MattSkillsV1ProviderObservation[];
  selections: readonly ProviderObservationSelection[];
  diagnostics: readonly StructuralDiagnostic[];
  operation: ProviderObservationOperation;
  store: ProviderObservationStore;
  storePath: string;
  storeBytes: Buffer;
  storeChanged: boolean;
}>;

export class ProviderObservationAcquisitionUnavailableError extends Error {
  readonly name = "ProviderObservationAcquisitionUnavailableError";
}

const storeSchema = z
  .strictObject({
    schemaVersion: z.literal(STORE_VERSION),
    observations: z.array(mattSkillsV1ProviderObservationSchema),
    selections: z.array(providerObservationSelectionSchema),
  })
  .superRefine((store, context) => {
    const observations = new Map<string, (typeof store.observations)[number]>();
    for (const [position, observation] of store.observations.entries()) {
      if (observations.has(observation.id)) {
        context.addIssue({
          code: "custom",
          path: ["observations", position, "id"],
          message: "Provider observation identities must be unique.",
        });
      }
      observations.set(observation.id, observation);
    }
    const scopes = new Set<string>();
    for (const [position, selection] of store.selections.entries()) {
      const key = mattNativeScopeKey(selection);
      if (scopes.has(key)) {
        context.addIssue({
          code: "custom",
          path: ["selections", position, "nativeScope"],
          message: "Provider observation selections must be unique by bound scope.",
        });
      }
      scopes.add(key);
      if (selection.observationId !== null) {
        const observation = observations.get(selection.observationId);
        if (observation === undefined) {
          context.addIssue({
            code: "custom",
            path: ["selections", position, "observationId"],
            message: "Every provider observation selection must resolve.",
          });
        } else if (!sameMattNativeBindingDefinition(observation.binding, selection)) {
          context.addIssue({
            code: "custom",
            path: ["selections", position, "observationId"],
            message: "Provider observation selections must resolve within the selected scope.",
          });
        }
      }
    }
  });

type StoreRead =
  | Readonly<{ kind: "missing"; bytes?: undefined }>
  | Readonly<{ kind: "available"; store: ProviderObservationStore; bytes: Buffer }>
  | Readonly<{ kind: "malformed"; bytes?: undefined }>;

export const providerObservationStorePath = (repoRoot: string): string =>
  join(repoRoot, ".bearing/cache", PROVIDER_OBSERVATION_STORE_FILENAME);

export const readProviderObservationStore = async (repoRoot: string): Promise<StoreRead> => {
  const cache = join(repoRoot, ".bearing/cache");
  const read = await readValidatedJsonCache({
    namespacePath: join(repoRoot, ".bearing"),
    cachePath: cache,
    targetPath: providerObservationStorePath(repoRoot),
    schema: storeSchema,
  });
  return read.kind === "available"
    ? { kind: "available", store: read.value as ProviderObservationStore, bytes: read.bytes }
    : read;
};

const observationFor = (
  store: ProviderObservationStore,
  selection: ProviderObservationSelection,
): MattSkillsV1ProviderObservation | undefined =>
  selection.observationId === null
    ? undefined
    : store.observations.find((observation) => observation.id === selection.observationId);

const selectionFor = (
  store: ProviderObservationStore,
  binding: MattSkillsV1WorkBinding,
): ProviderObservationSelection | undefined =>
  store.selections.find((selection) => sameMattNativeBindingDefinition(selection, binding));

const storeBytes = (store: ProviderObservationStore): Buffer =>
  serializeValidatedJson(storeSchema, store);

const unavailableDiagnostic = (
  code: string,
  target: string,
  message: string,
): StructuralDiagnostic => ({ code, impact: "blocking", target, message });

const selectedFrom = (
  store: ProviderObservationStore,
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
          "No reusable provider observation exists for this Work Binding; run explicit observation recovery.",
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
      ...(selection.latestAttempt?.diagnostics ?? []),
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

const mergeHistory = (
  prior: ProviderObservationStore | undefined,
  next: readonly MattSkillsV1ProviderObservation[],
): readonly MattSkillsV1ProviderObservation[] => {
  const byId = new Map(
    (prior?.observations ?? []).map((observation) => [observation.id, observation]),
  );
  for (const observation of next) byId.set(observation.id, observation);
  return [...byId.values()].sort((left, right) => left.id.localeCompare(right.id, "en"));
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
    "provider-observation-acquisition-incomplete",
    binding.nativeScope,
    observation === undefined
      ? "Provider observation acquisition returned no observation for the bound scope."
      : `Provider observation acquisition returned ${observation.state}/${observation.freshness.assessment} evidence; prior evidence remains selected when available.`,
  );

export const selectProviderObservations = async (
  input: Readonly<{
    generation: SyncInputGeneration;
    decoded: DecodedBearingRecordGeneration;
    intent: ProviderObservationIntent;
    providerFactory?: MattProviderFactory;
    now?: () => string;
    nativeReconciliationRequest?: NativeReconciliationRequest;
  }>,
): Promise<ProviderObservationSelectionPlan> => {
  const current = await readProviderObservationStore(input.generation.root);
  const bindings = boundProviderScopes(input.decoded);
  const bindingConflicts = providerBindingConflicts(input.decoded);
  const prior = current.kind === "available" ? current.store : undefined;
  const priorBytes = current.kind === "available" ? current.bytes : undefined;
  const acquisitionIntent: ProviderObservationAcquisitionIntent | undefined =
    input.intent === "initial-baseline" ||
    input.intent === "recovery" ||
    input.intent === "full-verification"
      ? input.intent
      : undefined;
  const target = providerObservationStorePath(input.generation.root);

  if (input.intent === "ordinary-sync") {
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
              unavailableDiagnostic(
                "provider-observation-store-unavailable",
                ".bearing/cache/provider-observations.json",
                "Provider observation cache is unreadable; run explicit observation recovery.",
              ),
              ...bindings.map((binding) =>
                unavailableDiagnostic(
                  "provider-observation-unavailable",
                  binding.nativeScope,
                  "No reusable provider observation exists for this Work Binding; run explicit observation recovery.",
                ),
              ),
            ],
          }
        : selectedFrom(prior, bindings);
    const selected = withBindingConflicts(selectedBase, bindingConflicts);
    const store = prior ?? ({ schemaVersion: 1, observations: [], selections: [] } as const);
    const bytes = storeBytes(store);
    return {
      ...selected,
      operation: {
        intent: "ordinary-sync",
        outcome: selected.diagnostics.length === 0 ? "reused" : "unavailable",
        acquisitionCount: 0,
      },
      store,
      storePath: target,
      storeBytes: bytes,
      storeChanged: false,
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
      const bytes = storeBytes(store);
      return {
        ...selected,
        operation: {
          intent: "targeted-reconciliation",
          outcome: "not-applicable",
          acquisitionCount: 0,
        },
        store,
        storePath: target,
        storeBytes: bytes,
        storeChanged: false,
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
          "Targeted reconciliation requires one current prior full-scope observation; run explicit observation recovery.",
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
          successfulObservation?.freshness.assessment ?? ("undetermined" as const),
        latestAttempt: {
          intent: "targeted-reconciliation",
          attemptedAt,
          outcome: succeeded ? "succeeded" : "failed",
          diagnostics: succeeded ? attemptDiagnostics : failureDiagnostics,
          requestFingerprint,
        },
      };
    });
    const store: ProviderObservationStore = {
      schemaVersion: 1,
      observations: mergeHistory(prior, observation === undefined ? [] : [observation]),
      selections,
    };
    const bytes = storeBytes(store);
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
      storePath: target,
      storeBytes: bytes,
      storeChanged: current.kind !== "available" || !current.bytes.equals(bytes),
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
    );
    const attemptedAt = acquisitionAttemptAt(
      acquired.observations,
      input.now ?? (() => new Date().toISOString()),
    );
    let retainedPrior = false;
    let unavailable = false;
    const selections: ProviderObservationSelection[] = bindings.map((binding) => {
      const observation = acquired.observations.find((candidate) =>
        sameMattNativeBindingDefinition(candidate.binding, binding),
      );
      const priorSelection = prior === undefined ? undefined : selectionFor(prior, binding);
      const priorObservation =
        prior === undefined || priorSelection === undefined
          ? undefined
          : observationFor(prior, priorSelection);
      const succeeded = observation !== undefined && acquisitionSucceeded(observation);
      const diagnostics = [
        ...(observation === undefined
          ? acquired.diagnostics
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
          effectiveFreshness: "undetermined",
          latestAttempt,
        };
      }
      if (!succeeded) unavailable = true;
      return {
        provider: binding.provider,
        nativeScope: binding.nativeScope,
        observationId: observation?.id ?? null,
        effectiveFreshness: succeeded
          ? observation.freshness.assessment
          : ("undetermined" as const),
        latestAttempt,
      };
    });
    const store: ProviderObservationStore = {
      schemaVersion: 1,
      observations: mergeHistory(prior, acquired.observations),
      selections,
    };
    const bytes = storeBytes(store);
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
      storePath: target,
      storeBytes: bytes,
      storeChanged: current.kind !== "available" || !current.bytes.equals(bytes),
    };
  } catch (error) {
    if (!(error instanceof ProviderObservationAcquisitionUnavailableError)) throw error;
    const failure = unavailableDiagnostic(
      "provider-observation-acquisition-failed",
      ".bearing/provider.json",
      error instanceof Error
        ? `Provider observation acquisition failed: ${error.message}`
        : "Provider observation acquisition failed.",
    );
    if (prior === undefined) {
      const attemptedAt = (input.now ?? (() => new Date().toISOString()))();
      const selections: ProviderObservationSelection[] = bindings.map((binding) => ({
        provider: binding.provider,
        nativeScope: binding.nativeScope,
        observationId: null,
        effectiveFreshness: "undetermined",
        latestAttempt: {
          intent: acquisitionIntent,
          attemptedAt,
          outcome: "failed",
          diagnostics: [failure],
        },
      }));
      const store: ProviderObservationStore = {
        schemaVersion: 1,
        observations: [],
        selections,
      };
      const bytes = storeBytes(store);
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
        storePath: target,
        storeBytes: bytes,
        storeChanged: current.kind !== "available" || !current.bytes.equals(bytes),
      };
    }
    const attemptedAt = (input.now ?? (() => new Date().toISOString()))();
    const selections: ProviderObservationSelection[] = bindings.map((binding) => {
      const selection = selectionFor(prior, binding);
      return {
        provider: binding.provider,
        nativeScope: binding.nativeScope,
        observationId: selection?.observationId ?? null,
        effectiveFreshness: "undetermined",
        latestAttempt: {
          intent: acquisitionIntent,
          attemptedAt,
          outcome: "failed",
          diagnostics: [failure],
        },
      };
    });
    const store: ProviderObservationStore = { ...prior, selections };
    const selected = withBindingConflicts(selectedFrom(store, bindings), bindingConflicts);
    const bytes = storeBytes(store);
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
      storePath: target,
      storeBytes: bytes,
      storeChanged: priorBytes === undefined || !priorBytes.equals(bytes),
    };
  }
};

export const fingerprintProviderObservationSelection = (
  observations: readonly MattSkillsV1ProviderObservation[],
  selections: readonly ProviderObservationSelection[],
): string => stableStringify({ observations, selections }) ?? "";
