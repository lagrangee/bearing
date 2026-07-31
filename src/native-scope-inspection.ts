import { join } from "node:path";
import stableStringify from "safe-stable-stringify";
import { z } from "zod";
import type { DiscoveredNativeScope, NativeScopeDiscoveryView } from "./native-scope-discovery";
import type { nativeScopeInspectionSubjectSchema } from "./planning-lineage-route";
import type { MattProviderFactory } from "./provider-observation-acquisition";
import { resolveMattProvider } from "./provider-observation-acquisition";
import type { ProviderObservationSelection } from "./provider-observation-contract";
import {
  providerObservationSelectionFreshnessIsCoherent,
  providerObservationSelectionSchema,
} from "./provider-observation-contract";
import { ProviderObservationAcquisitionUnavailableError } from "./provider-observation-store";
import type { MattSkillsV1ProviderObservation } from "./providers/matt-skills-v1/capture";
import {
  mattNativeScopeKey,
  mattNativeSubjectForObject,
  sameMattNativeBindingDefinition,
  sameMattNativeScope,
} from "./providers/matt-skills-v1/native-subject";
import { mattObjects } from "./providers/matt-skills-v1/projection";
import { mattSkillsV1ProviderObservationSchema } from "./providers/matt-skills-v1/schema";
import { sha256Hex } from "./sha256";
import type { SyncInputGeneration } from "./sync-input-generation";
import type { StructuralDiagnostic } from "./types";
import { readValidatedJsonCache, serializeValidatedJson } from "./validated-json-cache";

const STORE_VERSION = 1 as const;
const STORE_FILENAME = "native-scope-inspections.json";
const MAXIMUM_STORE_BYTES = 32 * 1024 * 1024;
const MAXIMUM_OBSERVATION_BYTES = 8 * 1024 * 1024;

export type NativeScopeInspectionSubject = Readonly<
  z.infer<typeof nativeScopeInspectionSubjectSchema>
>;

export type NativeScopeInspectionIntent =
  | Readonly<{ kind: "none" }>
  | Readonly<{
      kind: "inspect";
      subject: NativeScopeInspectionSubject;
      target: Readonly<{ provider: "matt-skills/v1"; nativeScope: string }>;
      refresh: boolean;
    }>;

const inspectionBasisSchema = z.strictObject({
  discoveryObservationId: z.string().min(1),
  summaryFingerprint: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
});

const inspectionSelectionSchema = z.strictObject({
  selection: providerObservationSelectionSchema,
  basis: inspectionBasisSchema,
});

const storeSchema = z
  .strictObject({
    schemaVersion: z.literal(STORE_VERSION),
    observations: z.array(mattSkillsV1ProviderObservationSchema),
    selections: z.array(inspectionSelectionSchema),
  })
  .superRefine((store, context) => {
    const observations = new Map(
      store.observations.map((observation) => [observation.id, observation]),
    );
    const scopes = new Set<string>();
    const selectedIds = new Set<string>();
    for (const [index, entry] of store.selections.entries()) {
      const key = mattNativeScopeKey(entry.selection);
      if (scopes.has(key)) {
        context.addIssue({
          code: "custom",
          path: ["selections", index, "selection", "nativeScope"],
          message: "Native scope inspection selections must be unique by scope identity.",
        });
      }
      scopes.add(key);
      if (entry.selection.observationId === null) continue;
      selectedIds.add(entry.selection.observationId);
      const observation = observations.get(entry.selection.observationId);
      if (
        observation === undefined ||
        !sameMattNativeBindingDefinition(observation.binding, entry.selection)
      ) {
        context.addIssue({
          code: "custom",
          path: ["selections", index, "selection", "observationId"],
          message: "A native scope inspection selection must resolve inside its exact scope.",
        });
      } else if (!providerObservationSelectionFreshnessIsCoherent(entry.selection, observation)) {
        context.addIssue({
          code: "custom",
          path: ["selections", index, "selection", "effectiveFreshness"],
          message:
            "A native scope inspection selection cannot claim fresher evidence than its selected observation.",
        });
      }
    }
    if (
      observations.size !== selectedIds.size ||
      [...observations].some(([identity]) => !selectedIds.has(identity))
    ) {
      context.addIssue({
        code: "custom",
        path: ["observations"],
        message: "Native scope inspection history retains only currently selected observations.",
      });
    }
  });

export type NativeScopeInspectionStore = Readonly<z.infer<typeof storeSchema>>;
export type NativeScopeInspectionSelection = Readonly<z.infer<typeof inspectionSelectionSchema>>;

type StoreRead =
  | Readonly<{ kind: "missing" }>
  | Readonly<{ kind: "malformed" }>
  | Readonly<{ kind: "available"; store: NativeScopeInspectionStore; bytes: Buffer }>;

export const nativeScopeInspectionStorePath = (repoRoot: string): string =>
  join(repoRoot, ".bearing/cache", STORE_FILENAME);

export const readNativeScopeInspectionStore = async (repoRoot: string): Promise<StoreRead> => {
  const result = await readValidatedJsonCache({
    namespacePath: join(repoRoot, ".bearing"),
    cachePath: join(repoRoot, ".bearing/cache"),
    targetPath: nativeScopeInspectionStorePath(repoRoot),
    schema: storeSchema,
    maximumBytes: MAXIMUM_STORE_BYTES,
  });
  return result.kind === "available"
    ? { kind: "available", store: result.value, bytes: result.bytes }
    : result;
};

const summaryFingerprint = (summary: DiscoveredNativeScope): string => {
  const serialized = stableStringify(summary);
  if (serialized === undefined) throw new TypeError("Native scope summary is not serializable.");
  return `sha256:${sha256Hex(serialized)}`;
};

export const resolveNativeScopeInspectionTarget = (
  discovery: NativeScopeDiscoveryView | undefined,
  subject: NativeScopeInspectionSubject,
  target?: Readonly<{ provider: "matt-skills/v1"; nativeScope: string }> | undefined,
): DiscoveredNativeScope | undefined => {
  if (discovery === undefined) return undefined;
  const matchesTarget = (scope: DiscoveredNativeScope): boolean =>
    target === undefined || sameMattNativeBindingDefinition(scope.binding, target);
  if (subject.kind === "native-scope") {
    return discovery.scopes.find((scope) => scope.identity === subject.id && matchesTarget(scope));
  }
  return discovery.scopes.find(
    (scope) =>
      matchesTarget(scope) && scope.subjects.some((candidate) => candidate.identity === subject.id),
  );
};

export const nativeScopeInspectionExplicitInputs = (
  discovery: NativeScopeDiscoveryView | undefined,
  subject: NativeScopeInspectionSubject,
  target?: Readonly<{ provider: "matt-skills/v1"; nativeScope: string }> | undefined,
): readonly string[] => {
  const scope = resolveNativeScopeInspectionTarget(discovery, subject, target);
  if (scope?.driver !== "local") return [];
  return [...new Set(scope.subjects.map((candidate) => candidate.locator))].sort((left, right) =>
    left.localeCompare(right, "en"),
  );
};

const observationFor = (
  store: NativeScopeInspectionStore,
  entry: NativeScopeInspectionSelection,
): MattSkillsV1ProviderObservation | undefined =>
  entry.selection.observationId === null
    ? undefined
    : (store.observations.find((observation) => observation.id === entry.selection.observationId) as
        | MattSkillsV1ProviderObservation
        | undefined);

const selectionFor = (
  store: NativeScopeInspectionStore,
  scope: DiscoveredNativeScope,
): NativeScopeInspectionSelection | undefined =>
  store.selections.find((entry) => sameMattNativeBindingDefinition(entry.selection, scope.binding));

const discoveryCurrent = (view: NativeScopeDiscoveryView | undefined): boolean =>
  view?.state === "available" &&
  view.freshness === "current" &&
  view.coverage === "complete" &&
  view.latestAttempt === null;

const reconcileEntry = async (
  entry: NativeScopeInspectionSelection,
  discovery: NativeScopeDiscoveryView | undefined,
): Promise<NativeScopeInspectionSelection> => {
  if (entry.selection.latestAttempt?.outcome === "failed") {
    return {
      ...entry,
      selection: { ...entry.selection, effectiveFreshness: "undetermined" },
    };
  }
  if (!discoveryCurrent(discovery)) {
    return {
      ...entry,
      selection: { ...entry.selection, effectiveFreshness: "undetermined" },
    };
  }
  if (discovery?.observationId === entry.basis.discoveryObservationId) return entry;
  const scope = discovery?.scopes.find((candidate) =>
    sameMattNativeScope(candidate.binding, entry.selection),
  );
  const effectiveFreshness =
    scope === undefined
      ? discoveryCurrent(discovery)
        ? "stale"
        : "undetermined"
      : summaryFingerprint(scope) === entry.basis.summaryFingerprint
        ? "undetermined"
        : "stale";
  return {
    ...entry,
    selection: { ...entry.selection, effectiveFreshness },
  };
};

const selectedState = async (
  prior: NativeScopeInspectionStore | undefined,
  discovery: NativeScopeDiscoveryView | undefined,
): Promise<NativeScopeInspectionStore> => {
  if (prior === undefined) {
    return { schemaVersion: STORE_VERSION, observations: [], selections: [] };
  }
  const selections = await Promise.all(
    prior.selections.map((entry) => reconcileEntry(entry, discovery)),
  );
  return storeSchema.parse({ ...prior, selections });
};

const selectedViews = (store: NativeScopeInspectionStore) => {
  const observations = store.selections.flatMap((entry) => {
    const observation = observationFor(store, entry);
    return observation === undefined ? [] : [observation];
  });
  return {
    observations,
    selections: store.selections.map((entry) => entry.selection),
  };
};

const storeWithoutSelection = (
  store: NativeScopeInspectionStore,
  removed: NativeScopeInspectionSelection,
): NativeScopeInspectionStore => {
  const selections = store.selections.filter(
    (entry) => !sameMattNativeScope(entry.selection, removed.selection),
  );
  const selectedIds = new Set(
    selections.flatMap((entry) =>
      entry.selection.observationId === null ? [] : [entry.selection.observationId],
    ),
  );
  return storeSchema.parse({
    ...store,
    observations: store.observations.filter((observation) => selectedIds.has(observation.id)),
    selections,
  });
};

const boundedPublishedStore = (
  candidate: NativeScopeInspectionStore,
  maximumBytes: number,
  preferredBinding?: Readonly<{ provider: "matt-skills/v1"; nativeScope: string }> | undefined,
): Readonly<{ store: NativeScopeInspectionStore; bytes: Buffer }> => {
  let store = candidate;
  let bytes = serializeValidatedJson(storeSchema, store);
  const removable = [
    ...store.selections
      .filter(
        (entry) =>
          preferredBinding === undefined ||
          !sameMattNativeBindingDefinition(entry.selection, preferredBinding),
      )
      .toReversed(),
    ...store.selections
      .filter(
        (entry) =>
          preferredBinding !== undefined &&
          sameMattNativeBindingDefinition(entry.selection, preferredBinding),
      )
      .toReversed(),
  ];
  for (const entry of removable) {
    if (bytes.length <= maximumBytes) break;
    store = storeWithoutSelection(store, entry);
    bytes = serializeValidatedJson(storeSchema, store);
  }
  if (bytes.length > maximumBytes) {
    throw new RangeError("Native scope inspection cache budget cannot fit an empty store.");
  }
  return { store, bytes };
};

const structuralDiagnostics = (
  observation: MattSkillsV1ProviderObservation,
): readonly StructuralDiagnostic[] =>
  observation.diagnostics.map((diagnostic) => ({
    code: diagnostic.code,
    impact: diagnostic.impact,
    target: diagnostic.target,
    message: diagnostic.message,
  }));

const trustworthyAcquisition = (observation: MattSkillsV1ProviderObservation): boolean =>
  observation.state === "available" &&
  observation.freshness.assessment === "current" &&
  observation.coverage.assessment === "complete" &&
  observation.coverage.dimensions.every(
    (dimension) => dimension.state !== "gap" && dimension.state !== "conflict",
  ) &&
  observation.diagnostics.every((diagnostic) => diagnostic.impact !== "blocking");

const observationCoversSubject = (
  observation: MattSkillsV1ProviderObservation,
  subject: NativeScopeInspectionSubject,
): boolean =>
  subject.kind === "native-scope" ||
  mattObjects(observation).some(
    (candidate) => mattNativeSubjectForObject(candidate).id === subject.id,
  );

const serializedObservationFits = (observation: MattSkillsV1ProviderObservation): boolean =>
  serializeValidatedJson(mattSkillsV1ProviderObservationSchema, observation).length <=
  MAXIMUM_OBSERVATION_BYTES;

const operationDiagnostic = (
  code: string,
  target: string,
  message: string,
): StructuralDiagnostic => ({ code, impact: "blocking", target, message });

export type NativeScopeInspectionPlan = Readonly<{
  observations: readonly MattSkillsV1ProviderObservation[];
  selections: readonly ProviderObservationSelection[];
  operation: Readonly<{
    intent: NativeScopeInspectionIntent;
    outcome:
      | "not-requested"
      | "target-unavailable"
      | "reused-bound"
      | "reused-cache"
      | "acquired"
      | "retained-after-failure"
      | "unavailable";
    acquisitionCount: number;
  }>;
  store: NativeScopeInspectionStore;
  storePath: string;
  storeBytes: Buffer;
  storeChanged: boolean;
}>;

export const selectNativeScopeInspections = async (input: {
  readonly repoRoot: string;
  readonly generation: SyncInputGeneration;
  readonly discovery: NativeScopeDiscoveryView | undefined;
  readonly intent: NativeScopeInspectionIntent;
  readonly boundObservations: readonly MattSkillsV1ProviderObservation[];
  readonly boundSelections: readonly ProviderObservationSelection[];
  readonly providerFactory?: MattProviderFactory;
  readonly now?: () => string;
  readonly maximumStoreBytes?: number;
}): Promise<NativeScopeInspectionPlan> => {
  const current = await readNativeScopeInspectionStore(input.repoRoot);
  const prior = current.kind === "available" ? current.store : undefined;
  const store = await selectedState(prior, input.discovery);
  const maximumStoreBytes = input.maximumStoreBytes ?? MAXIMUM_STORE_BYTES;
  const targetPath = nativeScopeInspectionStorePath(input.repoRoot);
  const finish = (
    next: NativeScopeInspectionStore,
    outcome: NativeScopeInspectionPlan["operation"]["outcome"],
    acquisitionCount: number,
    preferredBinding?: Readonly<{ provider: "matt-skills/v1"; nativeScope: string }> | undefined,
  ): NativeScopeInspectionPlan => {
    const published = boundedPublishedStore(next, maximumStoreBytes, preferredBinding);
    const views = selectedViews(published.store);
    return {
      ...views,
      operation: { intent: input.intent, outcome, acquisitionCount },
      store: published.store,
      storePath: targetPath,
      storeBytes: published.bytes,
      storeChanged:
        current.kind === "available"
          ? !current.bytes.equals(published.bytes)
          : published.store.selections.length > 0,
    };
  };

  if (input.intent.kind === "none") return finish(store, "not-requested", 0);
  const scope = resolveNativeScopeInspectionTarget(
    input.discovery,
    input.intent.subject,
    input.intent.target,
  );
  const discovery = input.discovery;
  if (scope === undefined || discovery === undefined) {
    return finish(store, "target-unavailable", 0);
  }
  const boundObservation = input.boundObservations.find((observation) =>
    sameMattNativeBindingDefinition(observation.binding, scope.binding),
  );
  const boundSelection = input.boundSelections.find(
    (selection) =>
      sameMattNativeBindingDefinition(selection, scope.binding) &&
      selection.observationId === boundObservation?.id,
  );
  if (
    boundObservation !== undefined &&
    boundSelection !== undefined &&
    observationCoversSubject(boundObservation, input.intent.subject)
  ) {
    return finish(store, "reused-bound", 0);
  }

  const priorEntry = selectionFor(store, scope);
  const priorObservation = priorEntry === undefined ? undefined : observationFor(store, priorEntry);
  if (
    !input.intent.refresh &&
    priorEntry !== undefined &&
    priorObservation !== undefined &&
    observationCoversSubject(priorObservation, input.intent.subject)
  ) {
    return finish(store, "reused-cache", 0, scope.binding);
  }

  const attemptedAt = (input.now ?? (() => new Date().toISOString()))();
  const provider = resolveMattProvider(input.generation, input.providerFactory);
  let observation: MattSkillsV1ProviderObservation | undefined;
  let diagnostics: readonly StructuralDiagnostic[];
  let acquisitionCount = 0;
  if (provider.state === "unavailable") {
    diagnostics = provider.diagnostics;
  } else {
    try {
      acquisitionCount = 1;
      observation = await provider.provider.capture(scope.binding);
      diagnostics = structuralDiagnostics(observation);
    } catch (error) {
      if (!(error instanceof ProviderObservationAcquisitionUnavailableError)) throw error;
      diagnostics = [
        operationDiagnostic(
          "native-scope-inspection.acquisition-failed",
          scope.locator,
          "Native scope detail acquisition failed.",
        ),
      ];
    }
    if (observation !== undefined && !serializedObservationFits(observation)) {
      diagnostics = [
        ...diagnostics,
        operationDiagnostic(
          "native-scope-inspection.resource-budget",
          scope.locator,
          "Native scope detail exceeded the bounded inspection observation budget.",
        ),
      ];
      observation = undefined;
    }
  }
  const subjectCovered =
    observation !== undefined && observationCoversSubject(observation, input.intent.subject);
  if (observation !== undefined && !subjectCovered) {
    diagnostics = [
      ...diagnostics,
      operationDiagnostic(
        "native-scope-inspection.subject-mismatch",
        input.intent.subject.id,
        "The acquired native scope does not contain the requested subject identity.",
      ),
    ];
  }
  const succeeded =
    observation !== undefined && subjectCovered && trustworthyAcquisition(observation);
  const failureDiagnostics = succeeded
    ? diagnostics
    : [
        ...diagnostics,
        operationDiagnostic(
          "native-scope-inspection.incomplete",
          scope.locator,
          observation === undefined
            ? "Native scope detail could not be acquired."
            : `Native scope detail returned ${observation.state}/${observation.freshness.assessment} evidence.`,
        ),
      ];
  const selectedObservation = succeeded ? observation : priorObservation;
  const nextSelection: NativeScopeInspectionSelection = inspectionSelectionSchema.parse({
    selection: {
      provider: scope.binding.provider,
      nativeScope: scope.binding.nativeScope,
      observationId: selectedObservation?.id ?? null,
      effectiveFreshness:
        succeeded && observation !== undefined ? observation.freshness.assessment : "undetermined",
      latestAttempt: {
        intent: "native-scope-inspection",
        attemptedAt,
        outcome: succeeded ? "succeeded" : "failed",
        diagnostics: succeeded ? diagnostics : failureDiagnostics,
      },
    },
    basis: {
      discoveryObservationId: discovery.observationId,
      summaryFingerprint: summaryFingerprint(scope),
    },
  });
  const storeSelecting = (
    selection: NativeScopeInspectionSelection,
    candidateObservation: MattSkillsV1ProviderObservation | undefined,
  ): NativeScopeInspectionStore => {
    const selections = [
      ...store.selections.filter((entry) => !sameMattNativeScope(entry.selection, scope.binding)),
      selection,
    ].sort((left, right) =>
      mattNativeScopeKey(left.selection).localeCompare(mattNativeScopeKey(right.selection), "en"),
    );
    const selectedIds = new Set(
      selections.flatMap((entry) =>
        entry.selection.observationId === null ? [] : [entry.selection.observationId],
      ),
    );
    const observations = [
      ...store.observations,
      ...(candidateObservation === undefined ? [] : [candidateObservation]),
    ]
      .filter((candidate) => selectedIds.has(candidate.id))
      .filter(
        (candidate, index, values) =>
          values.findIndex((other) => other.id === candidate.id) === index,
      )
      .sort((left, right) => left.id.localeCompare(right.id, "en"));
    return storeSchema.parse({
      schemaVersion: STORE_VERSION,
      observations,
      selections,
    });
  };
  let next = storeSelecting(nextSelection, observation);
  let finalSucceeded = succeeded;
  if (serializeValidatedJson(storeSchema, next).length > maximumStoreBytes) {
    finalSucceeded = false;
    const budgetDiagnostic = operationDiagnostic(
      "native-scope-inspection.store-resource-budget",
      scope.locator,
      "Native scope detail could not be published without exceeding the bounded inspection cache.",
    );
    const retainedSelection = inspectionSelectionSchema.parse({
      selection: {
        provider: scope.binding.provider,
        nativeScope: scope.binding.nativeScope,
        observationId: priorObservation?.id ?? null,
        effectiveFreshness: "undetermined",
        latestAttempt: {
          intent: "native-scope-inspection",
          attemptedAt,
          outcome: "failed",
          diagnostics: [budgetDiagnostic],
        },
      },
      basis: {
        discoveryObservationId: discovery.observationId,
        summaryFingerprint: summaryFingerprint(scope),
      },
    });
    const retained = storeSelecting(retainedSelection, undefined);
    next =
      serializeValidatedJson(storeSchema, retained).length <= maximumStoreBytes ? retained : store;
  }
  return finish(
    next,
    finalSucceeded
      ? "acquired"
      : priorObservation === undefined
        ? "unavailable"
        : "retained-after-failure",
    acquisitionCount,
    scope.binding,
  );
};

export const fingerprintNativeScopeInspections = (
  observations: readonly MattSkillsV1ProviderObservation[],
  selections: readonly ProviderObservationSelection[],
): string => stableStringify({ observations, selections }) ?? "";
