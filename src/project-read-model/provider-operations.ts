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
import { captureProjectCompilationInputs } from "../project-compilation";
import { boundProviderScopes, type MattProviderFactory } from "../provider-acquisition";
import { createProviderDetailEvidenceState } from "../provider-detail-selection";
import type { ProviderEvidenceState } from "../provider-evidence-selection";
import { decodeGitHubMattNativeScope } from "../providers/matt-skills-v1/github-native-scope";
import {
  canonicalizeLocalNativeReference,
  localNativeReferenceBelongsToScope,
} from "../providers/matt-skills-v1/local-native-reference";
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
  type ProjectReadModelOperationBasis,
  projectProviderEvidenceBindingKey,
  publishProjectReadModel,
  readProjectProviderEvidence,
  readProjectReadModelOperationBasis,
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

const rejectedNativeReconciliation = (
  request: NativeReconciliationRequest,
  diagnostic: StructuralDiagnostic,
) => ({
  schemaVersion: 1 as const,
  command: "reconcile-native" as const,
  outcome: "unfulfilled" as const,
  request,
  result: {
    requestFingerprint: nativeReconciliationRequestFingerprint(request),
    acquisitionCount: 0,
    dispositions: request.subjects.map((reference) => ({
      reference,
      disposition: "missing" as const,
    })),
    relationDispositions: [],
    readback: [],
    generationFingerprint: null,
    scopedDiagnosticCount: 1,
  },
  diagnostics: [diagnostic],
});

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
  | Readonly<{ state: "available"; basis: ProjectReadModelOperationBasis }>
  | Readonly<{
      state: "unavailable";
      outcome: "recovery-required" | "need-update";
      diagnostic: StructuralDiagnostic;
    }>;

const localStore = async (repoRoot: string): Promise<LocalStore> => {
  const state = await readProjectReadModelOperationBasis(repoRoot);
  if (state.state === "available") return state;
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
    disposition: "captured" | "retained-after-failure" | "unavailable" | "unpublished";
    observedAt?: string;
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
  const priorEvidence = local.basis.evidence;
  const store = boundStore(priorEvidence);
  const capturedInputs = await captureProjectCompilationInputs(root);
  const available = new Map(
    boundProviderScopes(capturedInputs.decoded).map((binding) => [binding.nativeScope, binding]),
  );
  const selectedScopes =
    intent === "all-scope-verification"
      ? [...available.keys()].sort((left, right) => left.localeCompare(right, "en"))
      : [...new Set(scopes)].sort((left, right) => left.localeCompare(right, "en"));
  const unknown = selectedScopes.filter((scope) => !available.has(scope));
  if (unknown.length > 0 || (intent === "exact-scope-capture" && selectedScopes.length === 0)) {
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
    capturedInputs,
    startingBasis: local.basis,
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
  const bindingsChanged =
    store.selections.length !== available.size ||
    store.selections.some((selection) => !available.has(selection.nativeScope));
  const attempts: ProjectProviderEvidence[] = attemptedSelections.map((selection) => {
    const observation = prepared.plan.providerObservations.find(
      (candidate) => candidate.id === selection.observationId,
    );
    return {
      bindingKey: projectProviderEvidenceBindingKey(selection),
      role: "bound",
      ...(observation === undefined ? {} : { observation }),
      selection,
    };
  });
  const publication = await publishProjectReadModel(root, prepared.candidate, {
    operation: {
      startingBasis: local.basis,
      attempts,
      publishGeneration: captured || bindingsChanged,
    },
  });
  if (publication.state === "conflict") {
    return {
      schemaVersion: 1,
      command: intent === "exact-scope-capture" ? "provider-capture" : "provider-verify",
      outcome: "unfulfilled",
      result: {
        acquisitionCount: prepared.plan.providerObservationOperation.acquisitionCount,
        scopes: selectedScopes.map((scope) => ({ scope, disposition: "unpublished" })),
        missingEvidenceScopes: missingEvidenceScopes(priorEvidence),
      },
      diagnostics: [publication.diagnostic],
    };
  }
  const evidence = publication.evidence;
  const requestedSelections = evidence.filter((entry) =>
    selectedScopes.includes(entry.selection.nativeScope),
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
        ...(entry.observation === undefined ? {} : { observedAt: entry.observation.observedAt }),
        disposition:
          entry.selection.latestAttempt?.outcome === "succeeded"
            ? ("captured" as const)
            : entry.observation === undefined
              ? ("unavailable" as const)
              : ("retained-after-failure" as const),
      })),
      ...(selectedScopes.length === 0
        ? {}
        : { generationFingerprint: publication.receipt.basisFingerprint }),
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
  const priorDetail = local.basis.evidence.filter((entry) => entry.role === "detail");
  const prepared = await prepareProjectReadModelCandidate(root, {
    startingBasis: local.basis,
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
  if (prepared.startingBasis?.metadata === null) {
    const publication = await publishProjectReadModel(root, prepared.candidate, {
      operation: { startingBasis: local.basis, attempts: [], publishGeneration: true },
    });
    if (publication.state === "conflict") {
      return {
        schemaVersion: 1 as const,
        command: "provider-detail-refresh" as const,
        outcome: "unfulfilled" as const,
        result: {
          acquisitionCount: prepared.plan.providerDetailEvidenceOperation.acquisitionCount,
          scopes: [{ scope: input.binding.nativeScope, disposition: "unpublished" as const }],
        },
        diagnostics: [publication.diagnostic],
      };
    }
  }
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
          ...(observation === undefined ? {} : { observedAt: observation.observedAt }),
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
  let request = normalizeNativeReconciliationRequest(input);
  if (decodeGitHubMattNativeScope(request.binding.nativeScope) === undefined) {
    let admissionDiagnostic: StructuralDiagnostic | undefined;
    try {
      const canonicalSubjects = await Promise.all(
        request.subjects.map((reference) => canonicalizeLocalNativeReference(root, reference)),
      );
      request = normalizeNativeReconciliationRequest({
        binding: request.binding,
        subjects: canonicalSubjects,
      });
    } catch {
      admissionDiagnostic = {
        code: "native-reconciliation-reference-invalid",
        impact: "blocking",
        target: request.binding.nativeScope,
        message:
          "Local native references must resolve to repository-relative subjects inside the repository.",
      };
    }
    if (
      admissionDiagnostic === undefined &&
      request.subjects.some(
        (reference) => !localNativeReferenceBelongsToScope(request.binding.nativeScope, reference),
      )
    ) {
      admissionDiagnostic = {
        code: "native-reconciliation-reference-outside-scope",
        impact: "blocking",
        target: request.binding.nativeScope,
        message:
          "Local native references must identify a supported Markdown subject inside the bound scope.",
      };
    }
    if (admissionDiagnostic !== undefined) {
      return rejectedNativeReconciliation(request, admissionDiagnostic);
    }
  }
  const local = await localStore(root);
  if (local.state === "unavailable") {
    const references = affectedReadReferences({
      subjects: request.subjects,
    });
    const dispositions = references.map((reference) => ({
      reference,
      disposition: "missing" as const,
    }));
    return {
      schemaVersion: 1 as const,
      command: "reconcile-native" as const,
      outcome: local.outcome,
      request,
      result: {
        requestFingerprint: nativeReconciliationRequestFingerprint(request),
        acquisitionCount: 0,
        dispositions,
        relationDispositions: [],
        readback: [],
        generationFingerprint: null,
        scopedDiagnosticCount: 1,
      },
      diagnostics: [local.diagnostic],
    };
  }
  const prepared = await prepareProjectReadModelCandidate(root, {
    startingBasis: local.basis,
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
  const referenceRejected = diagnostics.some(
    (diagnostic) =>
      diagnostic.code === "matt.local.reconciliation.reference-invalid" ||
      diagnostic.code === "matt.local.reconciliation.reference-outside-scope" ||
      diagnostic.code === "matt.github.reconciliation.reference-invalid",
  );
  const attempts: ProjectProviderEvidence[] =
    !referenceRejected && matchingSelection !== undefined
      ? [
          {
            bindingKey: projectProviderEvidenceBindingKey(matchingSelection),
            role: "bound",
            selection: matchingSelection,
            ...(matchingObservation === undefined ? {} : { observation: matchingObservation }),
          },
        ]
      : [];
  const publication = await publishProjectReadModel(root, prepared.candidate, {
    operation: { startingBasis: local.basis, attempts, publishGeneration: succeeded },
  });
  if (publication.state === "conflict") {
    return {
      schemaVersion: 1 as const,
      command: "reconcile-native" as const,
      outcome: "unfulfilled" as const,
      request,
      result: {
        requestFingerprint,
        acquisitionCount: prepared.plan.providerObservationOperation.acquisitionCount,
        dispositions: request.subjects.map((reference) => ({
          reference,
          disposition: "unpublished" as const,
        })),
        relationDispositions: [],
        readback: [],
        generationFingerprint: null,
        scopedDiagnosticCount: 1,
      },
      diagnostics: [publication.diagnostic],
    };
  }
  const generationFingerprint = publication.receipt.basisFingerprint;
  const references = affectedReadReferences({
    subjects: request.subjects,
  });
  const objects = matchingObservation === undefined ? [] : mattObjects(matchingObservation);
  const readback = references.flatMap((reference) => {
    const entity = objects.find(
      (candidate) =>
        mattNativeSubjectForObject(candidate).id === reference ||
        (candidate.native.kind === "github" && candidate.native.identity.url === reference),
    );
    return entity === undefined ? [] : [{ nativeReference: reference, entity }];
  });
  const dispositions = references.map((reference) => ({
    reference,
    disposition: readback.some((entry) => entry.nativeReference === reference)
      ? ("read" as const)
      : ("missing" as const),
  }));
  const requestedReferenceByProjectedSubject = new Map(
    readback.map(({ nativeReference, entity }) => [
      mattNativeSubjectForObject(entity).id,
      nativeReference,
    ]),
  );
  const providerRelations =
    !succeeded ||
    matchingObservation === undefined ||
    (matchingObservation.state !== "available" && matchingObservation.state !== "partial")
      ? []
      : [
          ...matchingObservation.projection.graph.parentChild.map((relation) => ({
            relation: {
              kind: "parent-child" as const,
              source: requestedReferenceByProjectedSubject.get(String(relation.parent)),
              target: requestedReferenceByProjectedSubject.get(String(relation.child)),
            },
            disposition: "read" as const,
          })),
          ...matchingObservation.projection.graph.blockedBy.map((relation) => ({
            relation: {
              kind: "blocked-by" as const,
              source: requestedReferenceByProjectedSubject.get(String(relation.blocked)),
              target: requestedReferenceByProjectedSubject.get(String(relation.blocker)),
            },
            disposition: "read" as const,
          })),
        ]
          .flatMap((entry) =>
            entry.relation.source === undefined || entry.relation.target === undefined
              ? []
              : [
                  {
                    relation: {
                      kind: entry.relation.kind,
                      source: entry.relation.source,
                      target: entry.relation.target,
                    },
                    disposition: entry.disposition,
                  },
                ],
          )
          .sort((left, right) =>
            `${left.relation.kind}\0${left.relation.source}\0${left.relation.target}`.localeCompare(
              `${right.relation.kind}\0${right.relation.source}\0${right.relation.target}`,
              "en",
            ),
          );
  return {
    schemaVersion: 1 as const,
    command: "reconcile-native" as const,
    outcome: succeeded ? ("complete" as const) : ("unfulfilled" as const),
    request,
    result: {
      requestFingerprint,
      acquisitionCount: prepared.plan.providerObservationOperation.acquisitionCount,
      dispositions,
      relationDispositions: providerRelations,
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
    reason?: string;
    resumptionPoint?: "project-read-model-rebuild";
  }>
> => {
  const root = await resolveRepositoryRoot(repoRoot);
  await assertActiveRepositoryIntegration(root, "cache-rebuild");
  const state = await readProjectReadModelOperationBasis(root);
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
      result: {
        acquisitionCount: 0,
        missingEvidenceScopes: [],
        reason: state.reason,
        resumptionPoint: "project-read-model-rebuild",
      },
      diagnostics: [],
    };
  }
  const startingBasis = state.state === "available" ? state.basis : undefined;
  const currentEvidence = startingBasis?.evidence ?? [];
  const reusableEvidence = reuseCompatibleProjectEvidence(
    currentEvidence,
    state.state === "available" ? await legacyDevelopmentEvidence(root) : [],
  );
  const candidate = await materializeProjectReadModelCandidate(root, {
    ...(reusableEvidence.length === 0
      ? { providerObservationStore: null, providerDetailEvidenceState: null }
      : projectEvidenceInputs(reusableEvidence)),
  });
  if (state.state === "recovery-required") await removeProjectReadModelForRebuild(root);
  const publication = await publishProjectReadModel(
    root,
    candidate,
    startingBasis === undefined
      ? {}
      : { operation: { startingBasis, attempts: [], publishGeneration: true } },
  );
  if (publication.state === "conflict")
    return {
      schemaVersion: 1,
      command: "cache-rebuild",
      outcome: "unfulfilled",
      result: {
        acquisitionCount: 0,
        missingEvidenceScopes: missingEvidenceScopes(currentEvidence),
      },
      diagnostics: [publication.diagnostic],
    };
  const evidence = publication.evidence;
  return {
    schemaVersion: 1,
    command: "cache-rebuild",
    outcome: "complete",
    result: {
      acquisitionCount: 0,
      generationFingerprint: publication.receipt.basisFingerprint,
      missingEvidenceScopes: missingEvidenceScopes(evidence),
    },
    diagnostics: [],
  };
};
