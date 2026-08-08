import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import stableStringify from "safe-stable-stringify";
import { z } from "zod";
import type { NativeReconciliationRequest } from "./native-reconciliation-contract";
import type { providerDetailEvidenceSubjectSchema } from "./planning-lineage-route";
import type { ProjectInputGeneration } from "./project-input-generation";
import type { MattProviderFactory } from "./provider-acquisition";
import { resolveMattProvider } from "./provider-acquisition";
import type { ProviderObservationSelection } from "./provider-evidence-contract";
import {
  providerObservationSelectionFreshnessIsCoherent,
  providerObservationSelectionSchema,
} from "./provider-evidence-contract";
import { ProviderObservationAcquisitionUnavailableError } from "./provider-evidence-selection";
import type { MattSkillsV1ProviderObservation } from "./providers/matt-skills-v1/capture";
import {
  mattNativeScopeKey,
  mattNativeSubjectForObject,
  sameMattNativeBindingDefinition,
  sameMattNativeScope,
} from "./providers/matt-skills-v1/native-subject";
import { mattObjects } from "./providers/matt-skills-v1/projection";
import { mattSkillsV1ProviderObservationSchema } from "./providers/matt-skills-v1/schema";
import type { StructuralDiagnostic } from "./types";
import { serializeValidatedJson } from "./validated-json-cache";

const STORE_VERSION = 2 as const;
const MAXIMUM_EVIDENCE_BYTES = 32 * 1024 * 1024;
const MAXIMUM_OBSERVATION_BYTES = 8 * 1024 * 1024;

export type ProviderDetailEvidenceSubject = Readonly<
  z.infer<typeof providerDetailEvidenceSubjectSchema>
>;

export type ProviderDetailEvidenceIntent =
  | Readonly<{ kind: "none" }>
  | Readonly<{ kind: "reconcile"; request: NativeReconciliationRequest }>
  | Readonly<{
      kind: "inspect";
      subject: ProviderDetailEvidenceSubject;
      target: Readonly<{ provider: "matt-skills/v1"; nativeScope: string }>;
      refresh: boolean;
    }>;

const inspectionBasisSchema = z.strictObject({
  bindingFingerprint: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
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
          message: "Provider detail evidence selections must be unique by scope identity.",
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
          message: "A provider detail evidence selection must resolve inside its exact scope.",
        });
      } else if (!providerObservationSelectionFreshnessIsCoherent(entry.selection, observation)) {
        context.addIssue({
          code: "custom",
          path: ["selections", index, "selection", "effectiveFreshness"],
          message:
            "A provider detail evidence selection cannot claim fresher evidence than its selected observation.",
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
        message: "Provider detail evidence history retains only currently selected observations.",
      });
    }
  });

export type ProviderDetailEvidenceState = Readonly<z.infer<typeof storeSchema>>;
export type ProviderDetailEvidenceSelection = Readonly<z.infer<typeof inspectionSelectionSchema>>;

const bindingFingerprint = (
  binding: Readonly<{ provider: "matt-skills/v1"; nativeScope: string }>,
): string => {
  const serialized = stableStringify(binding);
  if (serialized === undefined) throw new TypeError("Native scope binding is not serializable.");
  return `sha256:${bytesToHex(sha256(utf8ToBytes(serialized)))}`;
};

export const createProviderDetailEvidenceState = (input: {
  readonly observations: readonly MattSkillsV1ProviderObservation[];
  readonly selections: readonly ProviderObservationSelection[];
}): ProviderDetailEvidenceState =>
  storeSchema.parse({
    schemaVersion: STORE_VERSION,
    observations: input.observations,
    selections: input.selections.map((selection) => ({
      selection,
      basis: { bindingFingerprint: bindingFingerprint(selection) },
    })),
  });

const observationFor = (
  store: ProviderDetailEvidenceState,
  entry: ProviderDetailEvidenceSelection,
): MattSkillsV1ProviderObservation | undefined =>
  entry.selection.observationId === null
    ? undefined
    : (store.observations.find((observation) => observation.id === entry.selection.observationId) as
        | MattSkillsV1ProviderObservation
        | undefined);

const selectionFor = (
  store: ProviderDetailEvidenceState,
  binding: Readonly<{ provider: "matt-skills/v1"; nativeScope: string }>,
): ProviderDetailEvidenceSelection | undefined =>
  store.selections.find((entry) => sameMattNativeBindingDefinition(entry.selection, binding));

const stateWithoutSelection = (
  store: ProviderDetailEvidenceState,
  removed: ProviderDetailEvidenceSelection,
): ProviderDetailEvidenceState => {
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

const stateSelectingDetail = (
  store: ProviderDetailEvidenceState,
  binding: Readonly<{ provider: "matt-skills/v1"; nativeScope: string }>,
  selection: ProviderDetailEvidenceSelection,
  candidateObservation: MattSkillsV1ProviderObservation | undefined,
): ProviderDetailEvidenceState => {
  const selections = [
    ...store.selections.filter((entry) => !sameMattNativeScope(entry.selection, binding)),
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
  return storeSchema.parse({ schemaVersion: STORE_VERSION, observations, selections });
};

const selectedState = (
  prior: ProviderDetailEvidenceState | undefined,
  boundSelections: readonly ProviderObservationSelection[],
): ProviderDetailEvidenceState => {
  if (prior === undefined)
    return { schemaVersion: STORE_VERSION, observations: [], selections: [] };
  const selections = prior.selections.filter((entry) =>
    boundSelections.some((bound) => sameMattNativeBindingDefinition(entry.selection, bound)),
  );
  const selectedIds = new Set(
    selections.flatMap((entry) =>
      entry.selection.observationId === null ? [] : [entry.selection.observationId],
    ),
  );
  return storeSchema.parse({
    schemaVersion: STORE_VERSION,
    observations: prior.observations.filter((observation) => selectedIds.has(observation.id)),
    selections,
  });
};

const selectedViews = (store: ProviderDetailEvidenceState) => ({
  observations: store.selections.flatMap((entry) => {
    const observation = observationFor(store, entry);
    return observation === undefined ? [] : [observation];
  }),
  selections: store.selections.map((entry) => entry.selection),
});

const boundedEvidenceState = (
  candidate: ProviderDetailEvidenceState,
  maximumBytes: number,
  preferredBinding?: Readonly<{ provider: "matt-skills/v1"; nativeScope: string }>,
): Readonly<{ store: ProviderDetailEvidenceState; bytes: Buffer }> => {
  let store = candidate;
  let bytes = serializeValidatedJson(storeSchema, store);
  const removable = [
    ...store.selections.filter(
      (entry) =>
        preferredBinding === undefined ||
        !sameMattNativeBindingDefinition(entry.selection, preferredBinding),
    ),
    ...store.selections.filter(
      (entry) =>
        preferredBinding !== undefined &&
        sameMattNativeBindingDefinition(entry.selection, preferredBinding),
    ),
  ].toReversed();
  for (const entry of removable) {
    if (bytes.length <= maximumBytes) break;
    store = stateWithoutSelection(store, entry);
    bytes = serializeValidatedJson(storeSchema, store);
  }
  if (bytes.length > maximumBytes) {
    throw new RangeError("Provider detail evidence cache budget cannot fit an empty store.");
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
  subject: ProviderDetailEvidenceSubject,
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

export type ProviderDetailEvidencePlan = Readonly<{
  observations: readonly MattSkillsV1ProviderObservation[];
  selections: readonly ProviderObservationSelection[];
  operation: Readonly<{
    intent: ProviderDetailEvidenceIntent;
    outcome:
      | "not-requested"
      | "target-unavailable"
      | "reused-bound"
      | "reused-detail"
      | "acquired"
      | "retained-after-failure"
      | "unavailable";
    acquisitionCount: number;
  }>;
  state: ProviderDetailEvidenceState;
}>;

export const selectProviderDetailEvidences = async (input: {
  readonly generation: ProjectInputGeneration;
  readonly intent: ProviderDetailEvidenceIntent;
  readonly boundObservations: readonly MattSkillsV1ProviderObservation[];
  readonly boundSelections: readonly ProviderObservationSelection[];
  readonly providerFactory?: MattProviderFactory;
  readonly now?: () => string;
  readonly maximumEvidenceBytes?: number;
  readonly priorEvidence?: ProviderDetailEvidenceState | null;
}): Promise<ProviderDetailEvidencePlan> => {
  const prior = input.priorEvidence ?? undefined;
  const store = selectedState(prior, input.boundSelections);
  const maximumEvidenceBytes = input.maximumEvidenceBytes ?? MAXIMUM_EVIDENCE_BYTES;
  const finish = (
    next: ProviderDetailEvidenceState,
    outcome: ProviderDetailEvidencePlan["operation"]["outcome"],
    acquisitionCount: number,
    preferredBinding?: Readonly<{ provider: "matt-skills/v1"; nativeScope: string }>,
  ): ProviderDetailEvidencePlan => {
    const published = boundedEvidenceState(next, maximumEvidenceBytes, preferredBinding);
    const views = selectedViews(published.store);
    return {
      ...views,
      operation: { intent: input.intent, outcome, acquisitionCount },
      state: published.store,
    };
  };

  if (input.intent.kind === "reconcile") {
    const reconcileIntent = input.intent;
    const bound = input.boundSelections.some((selection) =>
      sameMattNativeBindingDefinition(selection, reconcileIntent.request.binding),
    );
    return finish(
      store,
      bound ? "reused-bound" : "target-unavailable",
      0,
      reconcileIntent.request.binding,
    );
  }

  if (input.intent.kind === "none") return finish(store, "not-requested", 0);
  const inspectIntent = input.intent;

  const boundSelection = input.boundSelections.find((selection) =>
    sameMattNativeBindingDefinition(selection, inspectIntent.target),
  );
  if (boundSelection === undefined) {
    return finish(store, "target-unavailable", 0, inspectIntent.target);
  }
  const boundObservation = input.boundObservations.find(
    (observation) =>
      sameMattNativeBindingDefinition(observation.binding, inspectIntent.target) &&
      observation.id === boundSelection.observationId,
  );
  if (
    !inspectIntent.refresh &&
    boundObservation !== undefined &&
    observationCoversSubject(boundObservation, inspectIntent.subject)
  ) {
    return finish(store, "reused-bound", 0, inspectIntent.target);
  }

  const priorEntry = selectionFor(store, inspectIntent.target);
  const priorObservation = priorEntry === undefined ? undefined : observationFor(store, priorEntry);
  if (
    !inspectIntent.refresh &&
    priorObservation !== undefined &&
    observationCoversSubject(priorObservation, inspectIntent.subject)
  ) {
    return finish(store, "reused-detail", 0, inspectIntent.target);
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
      observation = await provider.provider.capture(inspectIntent.target);
      diagnostics = structuralDiagnostics(observation);
    } catch (error) {
      if (!(error instanceof ProviderObservationAcquisitionUnavailableError)) throw error;
      diagnostics = [
        operationDiagnostic(
          "provider-detail-selection.acquisition-failed",
          inspectIntent.target.nativeScope,
          "Native scope detail acquisition failed.",
        ),
      ];
    }
    if (observation !== undefined && !serializedObservationFits(observation)) {
      diagnostics = [
        ...diagnostics,
        operationDiagnostic(
          "provider-detail-selection.resource-budget",
          inspectIntent.target.nativeScope,
          "Native scope detail exceeded the bounded inspection observation budget.",
        ),
      ];
      observation = undefined;
    }
  }
  const subjectCovered =
    observation !== undefined && observationCoversSubject(observation, inspectIntent.subject);
  if (observation !== undefined && !subjectCovered) {
    diagnostics = [
      ...diagnostics,
      operationDiagnostic(
        "provider-detail-selection.subject-mismatch",
        inspectIntent.subject.id,
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
          "provider-detail-selection.incomplete",
          inspectIntent.target.nativeScope,
          observation === undefined
            ? "Native scope detail could not be acquired."
            : `Native scope detail returned ${observation.state}/${observation.freshness.assessment} evidence.`,
        ),
      ];
  const selectedObservation = succeeded ? observation : priorObservation;
  const nextSelection: ProviderDetailEvidenceSelection = inspectionSelectionSchema.parse({
    selection: {
      provider: inspectIntent.target.provider,
      nativeScope: inspectIntent.target.nativeScope,
      observationId: selectedObservation?.id ?? null,
      effectiveFreshness:
        succeeded && observation !== undefined ? observation.freshness.assessment : "undetermined",
      latestAttempt: {
        intent: "provider-detail-selection",
        attemptedAt,
        outcome: succeeded ? "succeeded" : "failed",
        diagnostics: succeeded ? diagnostics : failureDiagnostics,
      },
    },
    basis: { bindingFingerprint: bindingFingerprint(inspectIntent.target) },
  });
  let next = stateSelectingDetail(store, inspectIntent.target, nextSelection, observation);
  let finalSucceeded = succeeded;
  if (serializeValidatedJson(storeSchema, next).length > maximumEvidenceBytes) {
    finalSucceeded = false;
    const retainedSelection = inspectionSelectionSchema.parse({
      selection: {
        provider: inspectIntent.target.provider,
        nativeScope: inspectIntent.target.nativeScope,
        observationId: priorObservation?.id ?? null,
        effectiveFreshness: "undetermined",
        latestAttempt: {
          intent: "provider-detail-selection",
          attemptedAt,
          outcome: "failed",
          diagnostics: [
            operationDiagnostic(
              "provider-detail-selection.store-resource-budget",
              inspectIntent.target.nativeScope,
              "Native scope detail could not be published without exceeding the bounded evidence set.",
            ),
          ],
        },
      },
      basis: { bindingFingerprint: bindingFingerprint(inspectIntent.target) },
    });
    const retained = stateSelectingDetail(
      store,
      inspectIntent.target,
      retainedSelection,
      undefined,
    );
    next =
      serializeValidatedJson(storeSchema, retained).length <= maximumEvidenceBytes
        ? retained
        : store;
  }
  return finish(
    next,
    finalSucceeded
      ? "acquired"
      : priorObservation === undefined
        ? "unavailable"
        : "retained-after-failure",
    acquisitionCount,
    inspectIntent.target,
  );
};

export const fingerprintProviderDetailEvidences = (
  observations: readonly MattSkillsV1ProviderObservation[],
  selections: readonly ProviderObservationSelection[],
): string => stableStringify({ observations, selections }) ?? "";
