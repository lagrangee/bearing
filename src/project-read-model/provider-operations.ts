import type { Dirent } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import {
  affectedReadReferences,
  type NativeReconciliationRequest,
  nativeReconciliationRequestFingerprint,
  normalizeNativeReconciliationRequest,
} from "../native-reconciliation-contract";
import { resolveRepositoryRoot } from "../path-boundary";
import type { MattProviderFactory } from "../provider-acquisition";
import { createProviderDetailEvidenceState } from "../provider-detail-selection";
import type { ProviderEvidenceState } from "../provider-evidence-selection";
import {
  mattNativeSubjectForObject,
  sameMattNativeBindingDefinition,
} from "../providers/matt-skills-v1/native-subject";
import { mattObjects } from "../providers/matt-skills-v1/projection";
import { assertActiveRepositoryIntegration } from "../repository-integration-lifecycle";
import { activeRuntimeExecutionContext, withRuntimeExecutionContext } from "../runtime-context";
import type { StructuralDiagnostic } from "../types";
import { materializeProjectReadModelCandidate, prepareProjectReadModelCandidate } from "./inspect";
import {
  inspectProjectReadModel,
  type ProjectProviderEvidence,
  projectProviderEvidenceBindingKey,
  publishProjectReadModel,
  readProjectProviderEvidence,
  removeProjectReadModelForRebuild,
  replaceProjectProviderEvidence,
} from "./store";

type OperationOutcome = "complete" | "unfulfilled" | "recovery-required" | "need-update";

export type ProviderOperationEnvelope<Result> = Readonly<{
  schemaVersion: 1;
  command: "provider-capture" | "provider-verify" | "reconcile-native" | "cache-rebuild";
  outcome: OperationOutcome;
  result: Result;
  diagnostics: readonly StructuralDiagnostic[];
}>;

export type ProviderOperationDependencies = Readonly<{
  providerFactory?: MattProviderFactory;
  now?: () => string;
}>;

const uniqueDiagnostics = (
  diagnostics: readonly StructuralDiagnostic[],
): readonly StructuralDiagnostic[] => [
  ...new Map(
    diagnostics.map((item) => [
      `${item.code}\0${item.impact}\0${item.target}\0${item.message}`,
      item,
    ]),
  ).values(),
];

const boundStore = (evidence: readonly ProjectProviderEvidence[]): ProviderEvidenceState => ({
  schemaVersion: 1,
  observations: evidence.flatMap((entry) =>
    entry.role === "bound" && entry.observation !== undefined ? [entry.observation] : [],
  ),
  selections: evidence.flatMap((entry) => (entry.role === "bound" ? [entry.selection] : [])),
});

const projectEvidenceInputs = (evidence: readonly ProjectProviderEvidence[]) => {
  const detail = evidence.filter((entry) => entry.role === "detail");
  return {
    providerObservationStore: boundStore(evidence),
    providerDetailEvidenceState: createProviderDetailEvidenceState({
      observations: detail.flatMap((entry) =>
        entry.observation === undefined ? [] : [entry.observation],
      ),
      selections: detail.map((entry) => entry.selection),
    }),
  };
};

const legacyDevelopmentEvidence = async (
  repoRoot: string,
): Promise<readonly (readonly ProjectProviderEvidence[])[]> => {
  const context = activeRuntimeExecutionContext(repoRoot);
  if (context?.receipt.channel !== "development") return [];
  const cacheRoot = join(repoRoot, ".bearing", "cache", "development");
  let entries: Dirent<string>[];
  try {
    entries = await readdir(cacheRoot, { withFileTypes: true });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
  const evidence: (readonly ProjectProviderEvidence[])[] = [];
  for (const entry of entries
    .filter((candidate) => candidate.isDirectory() && /^[0-9a-f]{64}$/u.test(candidate.name))
    .sort((left, right) => left.name.localeCompare(right.name, "en"))) {
    const projectReadModelPath = join(cacheRoot, entry.name, "project-read-model.sqlite");
    const compatible = await withRuntimeExecutionContext(
      { ...context, projectReadModelPath },
      async () => {
        const state = await inspectProjectReadModel(repoRoot);
        return state.state === "ready" ? readProjectProviderEvidence(repoRoot) : undefined;
      },
    );
    if (compatible !== undefined) evidence.push(compatible);
  }
  return evidence;
};

const reuseCompatibleProjectEvidence = (
  current: readonly ProjectProviderEvidence[],
  legacyStores: readonly (readonly ProjectProviderEvidence[])[],
): readonly ProjectProviderEvidence[] => {
  const key = (entry: ProjectProviderEvidence): string => `${entry.bindingKey}\0${entry.role}`;
  const currentByKey = new Map(current.map((entry) => [key(entry), entry]));
  const legacyByKey = new Map<string, ProjectProviderEvidence[]>();
  for (const entry of legacyStores.flat()) {
    if (entry.observation === undefined || entry.selection.effectiveFreshness !== "current") {
      continue;
    }
    const entries = legacyByKey.get(key(entry)) ?? [];
    entries.push(entry);
    legacyByKey.set(key(entry), entries);
  }
  const keys = new Set([...currentByKey.keys(), ...legacyByKey.keys()]);
  const reusable: ProjectProviderEvidence[] = [];
  for (const evidenceKey of [...keys].sort((left, right) => left.localeCompare(right, "en"))) {
    const currentEntry = currentByKey.get(evidenceKey);
    if (currentEntry?.observation !== undefined) {
      reusable.push(currentEntry);
      continue;
    }
    const variants = new Map(
      (legacyByKey.get(evidenceKey) ?? []).map((entry) => [JSON.stringify(entry), entry]),
    );
    if (variants.size === 1) reusable.push([...variants.values()][0] as ProjectProviderEvidence);
    else if (currentEntry !== undefined) reusable.push(currentEntry);
  }
  return reusable;
};

type LocalStore =
  | Readonly<{ state: "available"; evidence: readonly ProjectProviderEvidence[] }>
  | Readonly<{
      state: "unavailable";
      outcome: "recovery-required" | "need-update";
      diagnostic: StructuralDiagnostic;
    }>;

const localStore = async (repoRoot: string): Promise<LocalStore> => {
  const state = await inspectProjectReadModel(repoRoot);
  if (state.state === "missing") {
    const candidate = await materializeProjectReadModelCandidate(repoRoot, {
      providerObservationStore: null,
      providerDetailEvidenceState: null,
    });
    await publishProjectReadModel(repoRoot, candidate);
    return { state: "available", evidence: await readProjectProviderEvidence(repoRoot) };
  }
  if (state.state === "ready") {
    return { state: "available", evidence: await readProjectProviderEvidence(repoRoot) };
  }
  const outcome = state.state === "need-update" ? "need-update" : "recovery-required";
  return {
    state: "unavailable",
    outcome,
    diagnostic: {
      code: `project-read-model-${outcome}`,
      impact: "blocking",
      target: ".bearing/cache/project-read-model.sqlite",
      message:
        state.state === "need-update"
          ? "Project Read Model requires a newer Bearing version."
          : state.reason,
    },
  };
};

const missingEvidenceScopes = (evidence: readonly ProjectProviderEvidence[]): readonly string[] =>
  evidence
    .filter(
      (entry) =>
        entry.role === "bound" &&
        (entry.observation === undefined || entry.selection.effectiveFreshness !== "current"),
    )
    .map((entry) => entry.selection.nativeScope)
    .sort((left, right) => left.localeCompare(right, "en"));

type ProviderAcquisitionResult = Readonly<{
  acquisitionCount: number;
  scopes: readonly Readonly<{
    scope: string;
    disposition: "captured" | "retained-after-failure" | "unavailable";
  }>[];
  generationFingerprint?: string;
  missingEvidenceScopes: readonly string[];
}>;

const acquisition = async (
  repoRoot: string,
  scopes: readonly string[],
  intent: "exact-scope-capture" | "all-scope-verification",
  dependencies: ProviderOperationDependencies,
): Promise<ProviderOperationEnvelope<ProviderAcquisitionResult>> => {
  const root = await resolveRepositoryRoot(repoRoot);
  await assertActiveRepositoryIntegration(root, "provider");
  const local = await localStore(root);
  if (local.state === "unavailable") {
    return {
      schemaVersion: 1 as const,
      command:
        intent === "exact-scope-capture"
          ? ("provider-capture" as const)
          : ("provider-verify" as const),
      outcome: local.outcome,
      result: { acquisitionCount: 0, scopes: [], missingEvidenceScopes: [] },
      diagnostics: [local.diagnostic],
    };
  }
  const priorEvidence = local.evidence;
  const store = boundStore(priorEvidence);
  const available = new Map(
    store.selections.map((selection) => [selection.nativeScope, selection]),
  );
  const selectedScopes =
    intent === "all-scope-verification"
      ? [...available.keys()].sort((left, right) => left.localeCompare(right, "en"))
      : [...new Set(scopes)].sort((left, right) => left.localeCompare(right, "en"));
  if (intent === "all-scope-verification" && selectedScopes.length === 0) {
    return {
      schemaVersion: 1 as const,
      command: "provider-verify" as const,
      outcome: "complete" as const,
      result: {
        acquisitionCount: 0,
        scopes: [],
        missingEvidenceScopes: [],
      },
      diagnostics: [],
    };
  }
  const unknown = selectedScopes.filter((scope) => !available.has(scope));
  if (unknown.length > 0 || selectedScopes.length === 0) {
    const diagnostics: StructuralDiagnostic[] = [
      {
        code: "provider-scope-selection-invalid",
        impact: "blocking",
        target: unknown[0] ?? "provider-scope-selection",
        message:
          unknown.length === 0
            ? "Provider capture requires at least one exact current Work Binding scope."
            : "Provider capture scope is not one current Work Binding.",
      },
    ];
    return {
      schemaVersion: 1 as const,
      command:
        intent === "exact-scope-capture"
          ? ("provider-capture" as const)
          : ("provider-verify" as const),
      outcome: "unfulfilled" as const,
      result: {
        acquisitionCount: 0,
        scopes: selectedScopes.map((scope) => ({ scope, disposition: "unavailable" as const })),
        missingEvidenceScopes: missingEvidenceScopes(priorEvidence),
      },
      diagnostics,
    };
  }
  const requestedBindings = selectedScopes.map((nativeScope) => ({
    provider: "matt-skills/v1" as const,
    nativeScope,
  }));
  const prepared = await prepareProjectReadModelCandidate(root, {
    providerObservationStore: store,
    providerObservationIntent: intent,
    requestedProviderBindings: requestedBindings,
    providerDetailEvidenceState: null,
    ...(dependencies.providerFactory === undefined
      ? {}
      : { providerFactory: dependencies.providerFactory }),
    ...(dependencies.now === undefined ? {} : { providerObservationNow: dependencies.now }),
  });
  const attemptedSelections = prepared.plan.providerObservationSelections.filter((selection) =>
    selectedScopes.includes(selection.nativeScope),
  );
  const blocked = attemptedSelections.some(
    (selection) =>
      selection.observationId === null ||
      selection.latestAttempt?.outcome === "failed" ||
      selection.effectiveFreshness !== "current",
  );
  const captured = attemptedSelections.some(
    (selection) => selection.latestAttempt?.outcome === "succeeded",
  );
  let generationFingerprint: string;
  if (!captured) {
    for (const selection of attemptedSelections) {
      const observation = prepared.plan.providerObservations.find(
        (candidate) => candidate.id === selection.observationId,
      );
      await replaceProjectProviderEvidence(root, {
        bindingKey: projectProviderEvidenceBindingKey(selection),
        role: "bound",
        ...(observation === undefined ? {} : { observation }),
        selection,
      });
    }
    const state = await inspectProjectReadModel(root);
    if (state.state !== "ready") {
      throw new Error("Project Read Model generation became unavailable after provider attempt.");
    }
    generationFingerprint = state.metadata.basisFingerprint;
  } else {
    const state = await inspectProjectReadModel(root);
    if (
      state.state === "ready" &&
      state.metadata.basisFingerprint === prepared.candidate.basisFingerprint
    ) {
      for (const selection of attemptedSelections) {
        const observation = prepared.plan.providerObservations.find(
          (candidate) => candidate.id === selection.observationId,
        );
        await replaceProjectProviderEvidence(root, {
          bindingKey: projectProviderEvidenceBindingKey(selection),
          role: "bound",
          ...(observation === undefined ? {} : { observation }),
          selection,
        });
      }
      generationFingerprint = state.metadata.basisFingerprint;
    } else {
      generationFingerprint = (await publishProjectReadModel(root, prepared.candidate))
        .basisFingerprint;
    }
  }
  const evidence = await readProjectProviderEvidence(root);
  const requestedSelections = evidence.filter(
    (entry) => entry.role === "bound" && selectedScopes.includes(entry.selection.nativeScope),
  );
  const diagnostics = uniqueDiagnostics(
    requestedSelections.flatMap((entry) => entry.selection.latestAttempt?.diagnostics ?? []),
  );
  return {
    schemaVersion: 1 as const,
    command:
      intent === "exact-scope-capture"
        ? ("provider-capture" as const)
        : ("provider-verify" as const),
    outcome: blocked ? ("unfulfilled" as const) : ("complete" as const),
    result: {
      acquisitionCount: prepared.plan.providerObservationOperation.acquisitionCount,
      scopes: requestedSelections.map((entry) => ({
        scope: entry.selection.nativeScope,
        disposition:
          entry.selection.latestAttempt?.outcome === "succeeded"
            ? ("captured" as const)
            : entry.observation === undefined
              ? ("unavailable" as const)
              : ("retained-after-failure" as const),
      })),
      generationFingerprint,
      missingEvidenceScopes: missingEvidenceScopes(evidence),
    },
    diagnostics,
  };
};

export const captureProjectProviderScopes = (
  repoRoot: string,
  scopes: readonly string[],
  dependencies: ProviderOperationDependencies = {},
) => acquisition(repoRoot, scopes, "exact-scope-capture", dependencies);

export const verifyAllProjectProviderScopes = (
  repoRoot: string,
  dependencies: ProviderOperationDependencies = {},
) => acquisition(repoRoot, [], "all-scope-verification", dependencies);

export const refreshProjectProviderDetail = async (
  repoRoot: string,
  input: Readonly<{
    binding: Readonly<{ provider: "matt-skills/v1"; nativeScope: string }>;
    subject: string;
  }>,
  dependencies: ProviderOperationDependencies = {},
) => {
  const root = await resolveRepositoryRoot(repoRoot);
  await assertActiveRepositoryIntegration(root, "provider");
  const local = await localStore(root);
  if (local.state === "unavailable") {
    return {
      schemaVersion: 1 as const,
      command: "provider-detail-refresh" as const,
      outcome: local.outcome,
      result: { acquisitionCount: 0, scopes: [] },
      diagnostics: [local.diagnostic],
    };
  }
  const priorDetail = local.evidence.filter((entry) => entry.role === "detail");
  const prepared = await prepareProjectReadModelCandidate(root, {
    providerObservationStore: boundStore(local.evidence),
    providerObservationIntent: "reuse-current",
    providerDetailEvidenceIntent: {
      kind: "inspect",
      subject: { kind: "native-subject", id: input.subject },
      target: input.binding,
      refresh: true,
    },
    providerDetailEvidenceState: createProviderDetailEvidenceState({
      observations: priorDetail.flatMap((entry) =>
        entry.observation === undefined ? [] : [entry.observation],
      ),
      selections: priorDetail.map((entry) => entry.selection),
    }),
    ...(dependencies.providerFactory === undefined
      ? {}
      : { providerFactory: dependencies.providerFactory }),
    ...(dependencies.now === undefined ? {} : { providerObservationNow: dependencies.now }),
  });
  const selection = prepared.plan.providerDetailEvidenceSelections.find((candidate) =>
    sameMattNativeBindingDefinition(candidate, input.binding),
  );
  const observation = prepared.plan.providerDetailEvidenceObservations.find(
    (candidate) => candidate.id === selection?.observationId,
  );
  if (selection !== undefined) {
    await replaceProjectProviderEvidence(root, {
      bindingKey: projectProviderEvidenceBindingKey(selection),
      role: "detail",
      ...(observation === undefined ? {} : { observation }),
      selection,
    });
  }
  const diagnostics = uniqueDiagnostics(selection?.latestAttempt?.diagnostics ?? []);
  const completed = prepared.plan.providerDetailEvidenceOperation.outcome === "acquired";
  return {
    schemaVersion: 1 as const,
    command: "provider-detail-refresh" as const,
    outcome: completed ? ("complete" as const) : ("unfulfilled" as const),
    result: {
      acquisitionCount: prepared.plan.providerDetailEvidenceOperation.acquisitionCount,
      scopes: [
        {
          scope: input.binding.nativeScope,
          disposition: completed
            ? ("captured" as const)
            : observation === undefined
              ? ("unavailable" as const)
              : ("retained-after-failure" as const),
        },
      ],
    },
    diagnostics,
  };
};

export const reconcileProjectNative = async (
  repoRoot: string,
  input: Omit<NativeReconciliationRequest, "schemaVersion">,
  dependencies: ProviderOperationDependencies = {},
) => {
  const root = await resolveRepositoryRoot(repoRoot);
  await assertActiveRepositoryIntegration(root, "reconcile-native");
  const request = normalizeNativeReconciliationRequest(input);
  const local = await localStore(root);
  if (local.state === "unavailable") {
    const references = affectedReadReferences({
      subjects: request.subjects,
      relations: request.relations,
    });
    const dispositions = references.map((reference) => ({
      reference,
      disposition: "missing" as const,
    }));
    return {
      schemaVersion: 1 as const,
      command: "reconcile-native" as const,
      outcome: local.outcome,
      result: {
        requestFingerprint: nativeReconciliationRequestFingerprint(request),
        acquisitionCount: 0,
        dispositions,
        relationDispositions: request.relations.map((relation) => ({
          relation,
          disposition: "missing-endpoint" as const,
        })),
        readback: [],
        generationFingerprint: null,
        scopedDiagnosticCount: 1,
      },
      diagnostics: [local.diagnostic],
    };
  }
  const priorEvidence = local.evidence;
  const store = boundStore(priorEvidence);
  const prepared = await prepareProjectReadModelCandidate(root, {
    providerObservationStore: store,
    providerDetailEvidenceState: null,
    nativeReconciliationRequest: request,
    ...(dependencies.providerFactory === undefined
      ? {}
      : { providerFactory: dependencies.providerFactory }),
    ...(dependencies.now === undefined ? {} : { providerObservationNow: dependencies.now }),
  });
  const matchingSelection = prepared.plan.providerObservationSelections.find((selection) =>
    sameMattNativeBindingDefinition(selection, request.binding),
  );
  const matchingObservation = prepared.plan.providerObservations.find((observation) =>
    sameMattNativeBindingDefinition(observation.binding, request.binding),
  );
  const diagnostics = uniqueDiagnostics(matchingSelection?.latestAttempt?.diagnostics ?? []);
  const requestFingerprint = nativeReconciliationRequestFingerprint(request);
  const succeeded =
    prepared.plan.providerObservationOperation.intent === "targeted-reconciliation" &&
    prepared.plan.providerObservationOperation.outcome === "acquired" &&
    matchingSelection?.latestAttempt?.outcome === "succeeded" &&
    matchingSelection.latestAttempt.requestFingerprint === requestFingerprint;
  const currentState = await inspectProjectReadModel(root);
  if (currentState.state !== "ready") {
    throw new Error("Project Read Model generation became unavailable during reconciliation.");
  }
  let generationFingerprint = currentState.metadata.basisFingerprint;
  if (succeeded) {
    if (prepared.candidate.basisFingerprint === currentState.metadata.basisFingerprint) {
      if (matchingSelection !== undefined) {
        await replaceProjectProviderEvidence(root, {
          bindingKey: projectProviderEvidenceBindingKey(matchingSelection),
          role: "bound",
          ...(matchingObservation === undefined ? {} : { observation: matchingObservation }),
          selection: matchingSelection,
        });
      }
    } else {
      generationFingerprint = (await publishProjectReadModel(root, prepared.candidate))
        .basisFingerprint;
    }
  } else if (matchingSelection !== undefined) {
    await replaceProjectProviderEvidence(root, {
      bindingKey: projectProviderEvidenceBindingKey(matchingSelection),
      role: "bound",
      ...(matchingObservation === undefined ? {} : { observation: matchingObservation }),
      selection: matchingSelection,
    });
    const state = await inspectProjectReadModel(root);
    if (state.state === "ready") {
      generationFingerprint = state.metadata.basisFingerprint;
    }
  }
  const references = affectedReadReferences({
    subjects: request.subjects,
    relations: request.relations,
  });
  const objects = matchingObservation === undefined ? [] : mattObjects(matchingObservation);
  const readback = references.flatMap((reference) => {
    const entity = objects.find(
      (candidate) => mattNativeSubjectForObject(candidate).id === reference,
    );
    return entity === undefined ? [] : [{ nativeReference: reference, entity }];
  });
  const dispositions = references.map((reference) => ({
    reference,
    disposition: readback.some((entry) => entry.nativeReference === reference)
      ? ("read" as const)
      : ("missing" as const),
  }));
  return {
    schemaVersion: 1 as const,
    command: "reconcile-native" as const,
    outcome: succeeded ? ("complete" as const) : ("unfulfilled" as const),
    result: {
      requestFingerprint,
      acquisitionCount: prepared.plan.providerObservationOperation.acquisitionCount,
      dispositions,
      relationDispositions: request.relations.map((relation) => ({
        relation,
        disposition:
          dispositions.find((entry) => entry.reference === relation.source)?.disposition ===
            "read" &&
          dispositions.find((entry) => entry.reference === relation.target)?.disposition === "read"
            ? ("read" as const)
            : ("missing-endpoint" as const),
      })),
      readback,
      generationFingerprint,
      scopedDiagnosticCount: diagnostics.length,
    },
    diagnostics,
  };
};

export const rebuildProjectReadModel = async (
  repoRoot: string,
): Promise<
  ProviderOperationEnvelope<{
    acquisitionCount: number;
    generationFingerprint?: string;
    missingEvidenceScopes: readonly string[];
  }>
> => {
  const root = await resolveRepositoryRoot(repoRoot);
  await assertActiveRepositoryIntegration(root, "cache-rebuild");
  const state = await inspectProjectReadModel(root);
  if (state.state === "need-update") {
    return {
      schemaVersion: 1,
      command: "cache-rebuild",
      outcome: "need-update",
      result: { acquisitionCount: 0, missingEvidenceScopes: [] },
      diagnostics: [],
    };
  }
  if (state.state === "recovery-required" && /unsafe/iu.test(state.reason)) {
    return {
      schemaVersion: 1,
      command: "cache-rebuild",
      outcome: "recovery-required",
      result: { acquisitionCount: 0, missingEvidenceScopes: [] },
      diagnostics: [],
    };
  }
  const currentEvidence = state.state === "ready" ? await readProjectProviderEvidence(root) : [];
  const reusableEvidence = reuseCompatibleProjectEvidence(
    currentEvidence,
    state.state === "ready" || state.state === "missing"
      ? await legacyDevelopmentEvidence(root)
      : [],
  );
  const candidate = await materializeProjectReadModelCandidate(root, {
    ...(reusableEvidence.length === 0
      ? { providerObservationStore: null, providerDetailEvidenceState: null }
      : projectEvidenceInputs(reusableEvidence)),
  });
  if (state.state === "recovery-required") await removeProjectReadModelForRebuild(root);
  const receipt = await publishProjectReadModel(root, candidate);
  const evidence = await readProjectProviderEvidence(root);
  return {
    schemaVersion: 1,
    command: "cache-rebuild",
    outcome: "complete",
    result: {
      acquisitionCount: 0,
      generationFingerprint: receipt.basisFingerprint,
      missingEvidenceScopes: missingEvidenceScopes(evidence),
    },
    diagnostics: [],
  };
};
