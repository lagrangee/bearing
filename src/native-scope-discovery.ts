import { join } from "node:path";
import stableStringify from "safe-stable-stringify";
import { z } from "zod";
import { deepFreeze } from "./immutable";
import {
  discoveredNativeScopeSchema,
  NATIVE_SCOPE_DISCOVERY_PROVIDER,
} from "./native-scope-discovery-contract";
import type { ProviderDiagnostic } from "./native-work-provider";
import { sha256Hex } from "./sha256";
import {
  MAXIMUM_VALIDATED_JSON_CACHE_BYTES,
  readValidatedJsonCache,
  serializeValidatedJson,
} from "./validated-json-cache";

export const NATIVE_SCOPE_DISCOVERY_STORE_FILENAME = "native-scope-discovery.json";
export const NATIVE_SCOPE_DISCOVERY_STORE_VERSION = 1 as const;
const MAXIMUM_NATIVE_SCOPE_DISCOVERY_OBSERVATION_BYTES = 7 * 1024 * 1024;

export {
  discoveredNativeScopeSchema,
  NATIVE_SCOPE_DISCOVERY_PROVIDER,
  nativeSubjectSummarySchema,
} from "./native-scope-discovery-contract";

export type NativeScopeDiscoveryIntent = "ordinary-sync" | "explicit-discovery";
export type NativeScopeDiscoveryState =
  | "available"
  | "partial"
  | "unavailable"
  | "invalid"
  | "unsupported";
export type NativeScopeDiscoveryFreshness = "current" | "stale" | "undetermined";
export type NativeScopeDiscoveryClassification =
  | "map"
  | "spec"
  | "wayfinder"
  | "delivery"
  | "incoming"
  | "request"
  | "unknown";

export type NativeSubjectSummary = Readonly<{
  identity: string;
  locator: string;
  title: string;
  classification: NativeScopeDiscoveryClassification;
  lifecycle: "open" | "closed" | "unknown";
  parentIdentity: string | null;
  admission: readonly string[];
}>;

export type DiscoveredNativeScope = Readonly<{
  identity: string;
  binding: Readonly<{
    provider: typeof NATIVE_SCOPE_DISCOVERY_PROVIDER;
    nativeScope: string;
  }>;
  locator: string;
  driver: "local" | "github";
  rootRole: "wayfinder-map" | "parent-scope" | "standalone-request" | "unknown";
  title: string;
  lifecycle: "open" | "closed" | "mixed" | "unknown";
  classification: NativeScopeDiscoveryClassification;
  admission: readonly string[];
  subjects: readonly NativeSubjectSummary[];
}>;

export type NativeScopeDiscoveryObservation = Readonly<{
  id: string;
  provider: typeof NATIVE_SCOPE_DISCOVERY_PROVIDER;
  state: NativeScopeDiscoveryState;
  observedAt: string;
  sourceRevision?: string | undefined;
  validators: readonly Readonly<{ kind: string; value: string }>[];
  freshness: Readonly<{ assessment: NativeScopeDiscoveryFreshness }>;
  coverage: Readonly<{
    assessment: "complete" | "incomplete";
    dimensions: readonly Readonly<{
      key: string;
      state: "covered" | "excluded" | "gap" | "conflict";
      detail?: string | undefined;
    }>[];
  }>;
  scopes: readonly DiscoveredNativeScope[];
  diagnostics: readonly ProviderDiagnostic[];
  confirmedEmpty: boolean;
}>;

export type NativeScopeDiscoveryAttempt = Readonly<{
  observationId: string;
  state: Exclude<NativeScopeDiscoveryState, "available">;
  observedAt: string;
  diagnostics: readonly ProviderDiagnostic[];
}>;

export type NativeScopeDiscoveryView = Readonly<{
  observationId: string;
  provider: typeof NATIVE_SCOPE_DISCOVERY_PROVIDER;
  state: NativeScopeDiscoveryState;
  observedAt: string;
  sourceRevision?: string | undefined;
  validators: readonly Readonly<{ kind: string; value: string }>[];
  freshness: NativeScopeDiscoveryFreshness;
  coverage: "complete" | "incomplete";
  scopes: readonly DiscoveredNativeScope[];
  diagnostics: readonly ProviderDiagnostic[];
  confirmedEmpty: boolean;
  latestAttempt: NativeScopeDiscoveryAttempt | null;
}>;

export interface NativeScopeDiscoveryProvider {
  readonly id: typeof NATIVE_SCOPE_DISCOVERY_PROVIDER;
  discover(): Promise<NativeScopeDiscoveryObservation>;
}

const diagnosticSchema = z.strictObject({
  code: z.string().min(1),
  class: z.enum([
    "source",
    "contract",
    "mapping",
    "permission",
    "acquisition",
    "network",
    "pagination",
    "format",
    "identity",
    "concurrency",
  ]),
  impact: z.enum(["blocking", "non-blocking"]),
  target: z.string().min(1),
  message: z.string().min(1),
});

const validatorSchema = z.strictObject({
  kind: z.string().min(1),
  value: z.string().min(1),
});

export const nativeScopeDiscoveryObservationSchema = z
  .strictObject({
    id: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    provider: z.literal(NATIVE_SCOPE_DISCOVERY_PROVIDER),
    state: z.enum(["available", "partial", "unavailable", "invalid", "unsupported"]),
    observedAt: z.iso.datetime({ offset: true }),
    sourceRevision: z.string().min(1).optional(),
    validators: z.array(validatorSchema),
    freshness: z.strictObject({
      assessment: z.enum(["current", "stale", "undetermined"]),
    }),
    coverage: z.strictObject({
      assessment: z.enum(["complete", "incomplete"]),
      dimensions: z.array(
        z.strictObject({
          key: z.string().min(1),
          state: z.enum(["covered", "excluded", "gap", "conflict"]),
          detail: z.string().min(1).optional(),
        }),
      ),
    }),
    scopes: z.array(discoveredNativeScopeSchema),
    diagnostics: z.array(diagnosticSchema),
    confirmedEmpty: z.boolean(),
  })
  .superRefine((observation, context) => {
    const scopeIdentities = new Set<string>();
    const bindingIdentities = new Set<string>();
    const subjectIdentities = new Set<string>();
    for (const [index, scope] of observation.scopes.entries()) {
      if (scopeIdentities.has(scope.identity)) {
        context.addIssue({
          code: "custom",
          path: ["scopes", index, "identity"],
          message: "Discovered scope identities must be unique.",
        });
      }
      if (bindingIdentities.has(scope.binding.nativeScope)) {
        context.addIssue({
          code: "custom",
          path: ["scopes", index, "binding", "nativeScope"],
          message: "Discovered native bindings must be unique.",
        });
      }
      scopeIdentities.add(scope.identity);
      bindingIdentities.add(scope.binding.nativeScope);
      for (const [subjectIndex, subject] of scope.subjects.entries()) {
        if (subjectIdentities.has(subject.identity)) {
          context.addIssue({
            code: "custom",
            path: ["scopes", index, "subjects", subjectIndex, "identity"],
            message: "A discovered native subject must belong to exactly one scope.",
          });
        }
        subjectIdentities.add(subject.identity);
      }
    }
    const confirmedEmpty =
      observation.state === "available" &&
      observation.freshness.assessment === "current" &&
      observation.coverage.assessment === "complete" &&
      observation.scopes.length === 0;
    if (observation.confirmedEmpty !== confirmedEmpty) {
      context.addIssue({
        code: "custom",
        path: ["confirmedEmpty"],
        message: "Only complete, current, available zero-scope discovery is confirmed empty.",
      });
    }
    const serialized = stableStringify(observationContent(observation));
    const expectedId = serialized === undefined ? undefined : `sha256:${sha256Hex(serialized)}`;
    if (observation.id !== expectedId) {
      context.addIssue({
        code: "custom",
        path: ["id"],
        message: "Native discovery observation identity must match its immutable content.",
      });
    }
  });

const observationContent = (
  input: Omit<NativeScopeDiscoveryObservation, "id" | "confirmedEmpty">,
) => ({
  provider: input.provider,
  state: input.state,
  observedAt: input.observedAt,
  ...(input.sourceRevision === undefined ? {} : { sourceRevision: input.sourceRevision }),
  validators: input.validators,
  freshness: input.freshness,
  coverage: input.coverage,
  scopes: input.scopes,
  diagnostics: input.diagnostics,
});

export const createNativeScopeDiscoveryObservation = (
  input: Readonly<{
    provider: typeof NATIVE_SCOPE_DISCOVERY_PROVIDER;
    state: NativeScopeDiscoveryState;
    observedAt?: string;
    sourceRevision?: string;
    validators?: readonly Readonly<{ kind: string; value: string }>[];
    freshness: NativeScopeDiscoveryFreshness;
    coverage: "complete" | "incomplete";
    coverageDimensions?: NativeScopeDiscoveryObservation["coverage"]["dimensions"];
    scopes: readonly DiscoveredNativeScope[];
    diagnostics: readonly ProviderDiagnostic[];
  }>,
): NativeScopeDiscoveryObservation => {
  const observedAt = input.observedAt ?? new Date().toISOString();
  const content = observationContent({
    provider: input.provider,
    state: input.state,
    observedAt,
    ...(input.sourceRevision === undefined ? {} : { sourceRevision: input.sourceRevision }),
    validators: input.validators ?? [],
    freshness: { assessment: input.freshness },
    coverage: {
      assessment: input.coverage,
      dimensions: input.coverageDimensions ?? [
        {
          key: "scope-enumeration",
          state: input.coverage === "complete" ? "covered" : "gap",
        },
      ],
    },
    scopes: input.scopes,
    diagnostics: input.diagnostics,
  });
  const serialized = stableStringify(content);
  if (serialized === undefined)
    throw new TypeError("Native discovery observation is not serializable.");
  return deepFreeze(
    nativeScopeDiscoveryObservationSchema.parse({
      id: `sha256:${sha256Hex(serialized)}`,
      ...content,
      confirmedEmpty:
        input.state === "available" &&
        input.freshness === "current" &&
        input.coverage === "complete" &&
        input.scopes.length === 0,
    }),
  );
};

const selectionSchema = z.strictObject({
  observationId: z
    .string()
    .regex(/^sha256:[a-f0-9]{64}$/u)
    .nullable(),
  effectiveFreshness: z.enum(["current", "stale", "undetermined"]),
  latestAttempt: z
    .strictObject({
      observationId: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
      state: z.enum(["partial", "unavailable", "invalid", "unsupported"]),
      observedAt: z.iso.datetime({ offset: true }),
      diagnostics: z.array(diagnosticSchema),
    })
    .nullable(),
});

const storeSchema = z
  .strictObject({
    schemaVersion: z.literal(NATIVE_SCOPE_DISCOVERY_STORE_VERSION),
    observations: z.array(nativeScopeDiscoveryObservationSchema),
    selection: selectionSchema,
  })
  .superRefine((store, context) => {
    const identities = new Set<string>();
    for (const [index, observation] of store.observations.entries()) {
      if (identities.has(observation.id)) {
        context.addIssue({
          code: "custom",
          path: ["observations", index, "id"],
          message: "Native discovery observations must be immutable and unique.",
        });
      }
      identities.add(observation.id);
    }
    if (store.selection.observationId !== null && !identities.has(store.selection.observationId)) {
      context.addIssue({
        code: "custom",
        path: ["selection", "observationId"],
        message: "Native discovery selection must resolve to an immutable observation.",
      });
    }
    const latestAttempt =
      store.selection.latestAttempt === null
        ? undefined
        : store.observations.find(
            (observation) => observation.id === store.selection.latestAttempt?.observationId,
          );
    if (
      store.selection.latestAttempt !== null &&
      (latestAttempt === undefined ||
        latestAttempt.state !== store.selection.latestAttempt.state ||
        latestAttempt.observedAt !== store.selection.latestAttempt.observedAt ||
        stableStringify(latestAttempt.diagnostics) !==
          stableStringify(store.selection.latestAttempt.diagnostics))
    ) {
      context.addIssue({
        code: "custom",
        path: ["selection", "latestAttempt"],
        message: "The latest discovery attempt must exactly reference its immutable observation.",
      });
    }
    const selected =
      store.selection.observationId === null
        ? undefined
        : store.observations.find(
            (observation) => observation.id === store.selection.observationId,
          );
    const retainedIds = new Set<string>([
      ...(store.selection.observationId === null ? [] : [store.selection.observationId]),
      ...(store.selection.latestAttempt === null
        ? []
        : [store.selection.latestAttempt.observationId]),
    ]);
    if (
      identities.size !== retainedIds.size ||
      [...identities].some((identity) => !retainedIds.has(identity))
    ) {
      context.addIssue({
        code: "custom",
        path: ["observations"],
        message:
          "Discovery history must contain exactly the selected observation and latest attempt.",
      });
    }
    if (store.selection.latestAttempt === null) {
      const coherentSelection =
        selected === undefined
          ? store.selection.observationId === null &&
            store.selection.effectiveFreshness === "undetermined"
          : selected.state === "available" &&
            store.selection.effectiveFreshness === selected.freshness.assessment;
      if (!coherentSelection) {
        context.addIssue({
          code: "custom",
          path: ["selection"],
          message:
            "A discovery selection without a latest attempt must preserve the selected observation's exact freshness.",
        });
      }
    } else if (store.selection.latestAttempt !== null && latestAttempt !== undefined) {
      const sameObservation = store.selection.observationId === latestAttempt.id;
      if (
        (latestAttempt.state === "partial" && !sameObservation) ||
        (!sameObservation &&
          (selected === undefined ||
            !selectable(selected) ||
            store.selection.effectiveFreshness !== "undetermined")) ||
        (sameObservation &&
          store.selection.effectiveFreshness !== latestAttempt.freshness.assessment)
      ) {
        context.addIssue({
          code: "custom",
          path: ["selection"],
          message:
            "Discovery selection, freshness, and latest-attempt disposition must form one coherent observation state.",
        });
      }
    }
  });

export type NativeScopeDiscoveryStore = Readonly<z.infer<typeof storeSchema>>;
type StoreRead =
  | Readonly<{ kind: "missing" }>
  | Readonly<{ kind: "malformed" }>
  | Readonly<{ kind: "available"; store: NativeScopeDiscoveryStore; bytes: Buffer }>;

export const nativeScopeDiscoveryStorePath = (repoRoot: string): string =>
  join(repoRoot, ".bearing/cache", NATIVE_SCOPE_DISCOVERY_STORE_FILENAME);

export const readNativeScopeDiscoveryStore = async (repoRoot: string): Promise<StoreRead> => {
  const cache = join(repoRoot, ".bearing/cache");
  const read = await readValidatedJsonCache({
    namespacePath: join(repoRoot, ".bearing"),
    cachePath: cache,
    targetPath: nativeScopeDiscoveryStorePath(repoRoot),
    schema: storeSchema,
    maximumBytes: MAXIMUM_VALIDATED_JSON_CACHE_BYTES,
  });
  return read.kind === "available"
    ? { kind: "available", store: read.value, bytes: read.bytes }
    : read;
};

const serializeStore = (store: NativeScopeDiscoveryStore): Buffer => {
  const bytes = serializeValidatedJson(storeSchema, store);
  if (bytes.length > MAXIMUM_VALIDATED_JSON_CACHE_BYTES) {
    throw new RangeError("Native discovery store exceeds its readable cache boundary.");
  }
  return bytes;
};

const observationFor = (
  store: NativeScopeDiscoveryStore,
): NativeScopeDiscoveryObservation | undefined =>
  store.selection.observationId === null
    ? undefined
    : store.observations.find((observation) => observation.id === store.selection.observationId);

const viewFromStore = (store: NativeScopeDiscoveryStore): NativeScopeDiscoveryView | undefined => {
  const observation = observationFor(store);
  if (observation === undefined) return undefined;
  return deepFreeze({
    observationId: observation.id,
    provider: observation.provider,
    state: observation.state,
    observedAt: observation.observedAt,
    ...(observation.sourceRevision === undefined
      ? {}
      : { sourceRevision: observation.sourceRevision }),
    validators: observation.validators,
    freshness: store.selection.effectiveFreshness,
    coverage: observation.coverage.assessment,
    scopes: observation.scopes,
    diagnostics: observation.diagnostics,
    confirmedEmpty: observation.confirmedEmpty && store.selection.effectiveFreshness === "current",
    latestAttempt: store.selection.latestAttempt,
  });
};

const boundedHistory = (
  selected: NativeScopeDiscoveryObservation,
  latest: NativeScopeDiscoveryObservation,
): readonly NativeScopeDiscoveryObservation[] => {
  const byId = new Map<string, NativeScopeDiscoveryObservation>();
  byId.set(selected.id, selected);
  byId.set(latest.id, latest);
  return [...byId.values()].sort((left, right) => left.id.localeCompare(right.id, "en"));
};

const boundedObservation = (
  observation: NativeScopeDiscoveryObservation,
): NativeScopeDiscoveryObservation => {
  const bytes = serializeValidatedJson(nativeScopeDiscoveryObservationSchema, observation);
  if (bytes.length <= MAXIMUM_NATIVE_SCOPE_DISCOVERY_OBSERVATION_BYTES) return observation;
  return createNativeScopeDiscoveryObservation({
    provider: NATIVE_SCOPE_DISCOVERY_PROVIDER,
    state: "invalid",
    observedAt: observation.observedAt,
    freshness: "undetermined",
    coverage: "incomplete",
    scopes: [],
    diagnostics: [
      {
        code: "matt.discovery.resource-budget",
        class: "acquisition",
        impact: "blocking",
        target: "native-scope-discovery",
        message: "Discovery summaries exceeded the bounded observation cache budget.",
      },
    ],
  });
};

const selectable = (observation: NativeScopeDiscoveryObservation): boolean =>
  observation.state === "available" || observation.state === "partial";

export type NativeScopeDiscoverySelectionPlan = Readonly<{
  view: NativeScopeDiscoveryView | undefined;
  operation: Readonly<{
    intent: NativeScopeDiscoveryIntent;
    outcome:
      | "reused"
      | "never-run"
      | "acquired"
      | "partial"
      | "retained-after-failure"
      | "unavailable";
    acquisitionCount: number;
  }>;
  store: NativeScopeDiscoveryStore;
  storePath: string;
  storeBytes: Buffer;
  storeChanged: boolean;
}>;

export const selectNativeScopeDiscovery = async (
  input: Readonly<{
    repoRoot: string;
    intent: NativeScopeDiscoveryIntent;
    provider: NativeScopeDiscoveryProvider;
  }>,
): Promise<NativeScopeDiscoverySelectionPlan> => {
  const current = await readNativeScopeDiscoveryStore(input.repoRoot);
  const prior = current.kind === "available" ? current.store : undefined;
  const target = nativeScopeDiscoveryStorePath(input.repoRoot);
  if (input.intent === "ordinary-sync") {
    const store =
      prior ??
      storeSchema.parse({
        schemaVersion: NATIVE_SCOPE_DISCOVERY_STORE_VERSION,
        observations: [],
        selection: {
          observationId: null,
          effectiveFreshness: "undetermined",
          latestAttempt: null,
        },
      });
    return {
      view: viewFromStore(store),
      operation: {
        intent: input.intent,
        outcome: prior === undefined ? "never-run" : "reused",
        acquisitionCount: 0,
      },
      store,
      storePath: target,
      storeBytes: serializeStore(store),
      storeChanged: false,
    };
  }

  const observation = boundedObservation(await input.provider.discover());
  const previous = prior === undefined ? undefined : observationFor(prior);
  const useLatest = selectable(observation);
  const selected = useLatest ? observation : (previous ?? observation);
  const attempt: NativeScopeDiscoveryAttempt | null =
    observation.state === "available"
      ? null
      : {
          observationId: observation.id,
          state: observation.state,
          observedAt: observation.observedAt,
          diagnostics: observation.diagnostics,
        };
  const store = storeSchema.parse({
    schemaVersion: NATIVE_SCOPE_DISCOVERY_STORE_VERSION,
    observations: boundedHistory(selected, observation),
    selection: {
      observationId: selected?.id ?? null,
      effectiveFreshness:
        useLatest && selected.id === observation.id
          ? observation.freshness.assessment
          : "undetermined",
      latestAttempt: attempt,
    },
  });
  const bytes = serializeStore(store);
  return {
    view: viewFromStore(store),
    operation: {
      intent: input.intent,
      outcome:
        observation.state === "available"
          ? "acquired"
          : observation.state === "partial"
            ? "partial"
            : previous === undefined
              ? "unavailable"
              : "retained-after-failure",
      acquisitionCount: 1,
    },
    store,
    storePath: target,
    storeBytes: bytes,
    storeChanged: current.kind !== "available" || !current.bytes.equals(bytes),
  };
};

export const fingerprintNativeScopeDiscoveryView = (
  view: NativeScopeDiscoveryView | undefined,
): string => stableStringify(view ?? null) ?? "null";
