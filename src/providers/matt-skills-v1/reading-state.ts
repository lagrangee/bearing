import {
  assessSelectedProviderObservationEvidence,
  type ProviderObservationSelection,
} from "../../provider-observation-contract";
import type { StructuralDiagnostic } from "../../types";
import {
  sameMattNativeBindingDefinition,
  sameMattNativeLocator,
  sameMattNativeScope,
} from "./native-subject";
import type { MattObservationView } from "./projection";

export const NATIVE_WORK_READING_CONCLUSIONS = [
  "Complete",
  "Open work remains",
  "Can't verify",
  "Binding needs attention",
] as const;

export type MattNativeWorkReadingConclusion = (typeof NATIVE_WORK_READING_CONCLUSIONS)[number];

export type MattNativeWorkReadingContext =
  | Readonly<{ state: "bound"; effortIds: readonly string[]; nativeScope?: string | undefined }>
  | Readonly<{
      state: "attention";
      reason: "binding-conflict" | "bound-unresolved" | "identity-mismatch" | "root-kind-conflict";
      effortIds: readonly string[];
      nativeScope?: string | undefined;
    }>;

type ReadingEffort = Readonly<{
  id: string;
  workBinding?: Readonly<{ provider: "matt-skills/v1"; nativeScope: string }> | undefined;
}>;

export const mattNativeWorkReadingContextForEffort = (
  efforts: readonly ReadingEffort[],
  effort: ReadingEffort,
  observation: MattObservationView | undefined,
  _selections: readonly ProviderObservationSelection[],
): MattNativeWorkReadingContext | undefined => {
  const binding = effort.workBinding;
  if (binding === undefined) return undefined;
  const candidates = efforts.filter(
    (candidate) =>
      candidate.workBinding !== undefined && sameMattNativeScope(candidate.workBinding, binding),
  );
  if (candidates.length > 1) {
    return {
      state: "attention",
      reason: "binding-conflict",
      effortIds: candidates.map((candidate) => candidate.id),
      nativeScope: binding.nativeScope,
    };
  }
  if (observation === undefined) {
    return {
      state: "attention",
      reason: "bound-unresolved",
      effortIds: [effort.id],
      nativeScope: binding.nativeScope,
    };
  }
  if (observation !== undefined && !sameMattNativeScope(binding, observation.binding)) {
    return {
      state: "attention",
      reason: "identity-mismatch",
      effortIds: [effort.id],
      nativeScope: binding.nativeScope,
    };
  }
  if (observation !== undefined && !sameMattNativeBindingDefinition(binding, observation.binding)) {
    return {
      state: "attention",
      reason: "root-kind-conflict",
      effortIds: [effort.id],
      nativeScope: binding.nativeScope,
    };
  }
  return { state: "bound", effortIds: [effort.id], nativeScope: binding.nativeScope };
};

export const mattNativeWorkReadingContextForScope = (
  efforts: readonly ReadingEffort[],
  observation: MattObservationView,
): MattNativeWorkReadingContext | undefined => {
  const candidates = efforts.filter(
    (effort) =>
      effort.workBinding !== undefined &&
      sameMattNativeScope(effort.workBinding, observation.binding),
  );
  if (candidates.length === 0) {
    const locatorCandidates = efforts.filter(
      (effort) =>
        effort.workBinding !== undefined &&
        sameMattNativeLocator(effort.workBinding, observation.binding),
    );
    if (locatorCandidates.length > 0) {
      return {
        state: "attention",
        reason: "identity-mismatch",
        effortIds: locatorCandidates.map((candidate) => candidate.id),
        nativeScope: observation.binding.nativeScope,
      };
    }
    return undefined;
  }
  if (candidates.length > 1) {
    return {
      state: "attention",
      reason: "binding-conflict",
      effortIds: candidates.map((candidate) => candidate.id),
      nativeScope: observation.binding.nativeScope,
    };
  }
  const effort = candidates[0];
  if (
    effort?.workBinding === undefined ||
    !sameMattNativeBindingDefinition(effort.workBinding, observation.binding)
  ) {
    return {
      state: "attention",
      reason: "root-kind-conflict",
      effortIds: effort === undefined ? [] : [effort.id],
      nativeScope: observation.binding.nativeScope,
    };
  }
  return {
    state: "bound",
    effortIds: [effort.id],
    nativeScope: observation.binding.nativeScope,
  };
};

export type MattNativeWorkReadingState = Readonly<{
  conclusion: MattNativeWorkReadingConclusion;
  impact: string;
  action: string;
  binding:
    | Readonly<{
        state: "bound";
        effortIds: readonly string[];
      }>
    | Readonly<{
        state: "attention";
        reason: Extract<MattNativeWorkReadingContext, { state: "attention" }>["reason"];
        effortIds: readonly string[];
      }>;
  why: Readonly<{
    projectionState: "available" | "partial" | "absent" | "invalid" | "missing";
    freshness: "current" | "stale" | "undetermined";
    coverage: "complete" | "incomplete" | "undetermined";
    completion: "complete" | "incomplete" | "undetermined";
    blockingDiagnosticCount: number;
    causes: readonly string[];
  }>;
  observation: Readonly<{
    sourceRevision:
      | Readonly<{ availability: "available"; value: string }>
      | Readonly<{ availability: "unavailable" }>;
    observedAt:
      | Readonly<{ availability: "available"; value: string }>
      | Readonly<{ availability: "unavailable" }>;
    sourceObservedAt:
      | Readonly<{ availability: "available"; value: string }>
      | Readonly<{ availability: "unavailable" }>;
    coverageDimensions: readonly Readonly<{
      key: string;
      state: "covered" | "excluded" | "gap" | "conflict";
      detail?: string | undefined;
    }>[];
    validators: readonly Readonly<{ kind: string; value: string }>[];
    provenance: readonly Readonly<{ kind: string; value: string }>[];
    diagnostics: readonly Readonly<{
      origin: "observation" | "latest-attempt";
      code: string;
      impact: "blocking" | "non-blocking";
      target: string;
      message: string;
    }>[];
  }>;
}>;

const selectionFor = (
  observation: MattObservationView | undefined,
  selections: readonly ProviderObservationSelection[],
  context: MattNativeWorkReadingContext,
): ProviderObservationSelection | undefined => {
  const contextScope = context.nativeScope;
  const contextSelection =
    contextScope === undefined
      ? undefined
      : selections.find((selection) =>
          sameMattNativeScope(selection, {
            provider: "matt-skills/v1",
            nativeScope: contextScope,
          }),
        );
  return (
    contextSelection ??
    (observation === undefined
      ? undefined
      : selections.find((selection) => sameMattNativeScope(selection, observation.binding)))
  );
};

const availableString = (
  value: string | undefined,
):
  | Readonly<{ availability: "available"; value: string }>
  | Readonly<{ availability: "unavailable" }> =>
  value === undefined || value.length === 0
    ? { availability: "unavailable" }
    : { availability: "available", value };

const readingDiagnostics = (
  observation: MattObservationView | undefined,
  selection: ProviderObservationSelection | undefined,
): MattNativeWorkReadingState["observation"]["diagnostics"] => [
  ...(observation?.diagnostics ?? []).map((diagnostic) => ({
    origin: "observation" as const,
    code: diagnostic.code,
    impact: diagnostic.impact,
    target: diagnostic.target,
    message: diagnostic.message,
  })),
  ...(selection?.latestAttempt?.diagnostics ?? []).map((diagnostic: StructuralDiagnostic) => ({
    origin: "latest-attempt" as const,
    code: diagnostic.code,
    impact: diagnostic.impact,
    target: diagnostic.target,
    message: diagnostic.message,
  })),
];

const evidenceCauses = (
  observation: MattObservationView | undefined,
  selection: ProviderObservationSelection | undefined,
  why: Omit<MattNativeWorkReadingState["why"], "causes">,
): readonly string[] => {
  const causes: string[] = [];
  if (observation === undefined) causes.push("The provider observation is missing.");
  if (selection === undefined) causes.push("No current provider observation is selected.");
  if (selection?.latestAttempt?.outcome === "failed") {
    causes.push("The latest provider acquisition or verification attempt failed.");
  }
  if (why.projectionState !== "available") {
    causes.push(`Projection state is ${why.projectionState}.`);
  }
  if (why.freshness !== "current") causes.push(`Freshness is ${why.freshness}.`);
  if (why.coverage !== "complete") causes.push(`Coverage is ${why.coverage}.`);
  if (why.completion === "undetermined") {
    causes.push("Provider Completion is undetermined.");
  }
  if (why.blockingDiagnosticCount > 0) {
    causes.push(
      `${why.blockingDiagnosticCount} blocking diagnostic${
        why.blockingDiagnosticCount === 1 ? "" : "s"
      } withholds trust.`,
    );
  }
  for (const diagnostic of readingDiagnostics(observation, selection)) {
    if (diagnostic.impact === "blocking") causes.push(diagnostic.message);
  }
  if (observation?.coverage.dimensions.some((dimension) => dimension.state === "conflict")) {
    causes.push("Coverage dimensions contain a conflict.");
  }
  return [...new Set(causes)];
};

const bindingView = (
  context: MattNativeWorkReadingContext,
): MattNativeWorkReadingState["binding"] => {
  if (context.state === "bound") {
    return { state: "bound", effortIds: context.effortIds };
  }
  return {
    state: "attention",
    reason: context.reason,
    effortIds: context.effortIds,
  };
};

export const buildMattNativeWorkReadingState = (
  observation: MattObservationView | undefined,
  selections: readonly ProviderObservationSelection[],
  context: MattNativeWorkReadingContext,
): MattNativeWorkReadingState => {
  const selection = selectionFor(observation, selections, context);
  const assessment = assessSelectedProviderObservationEvidence(observation, selection);
  const whyBase = {
    projectionState: assessment.projectionState,
    freshness: assessment.freshness,
    coverage: assessment.coverage,
    completion: assessment.completion,
    blockingDiagnosticCount: assessment.blockingDiagnosticCount,
  } as const;
  const evidenceReasons = evidenceCauses(observation, selection, whyBase);
  const observationDetails: MattNativeWorkReadingState["observation"] = {
    sourceRevision: availableString(observation?.sourceRevision),
    observedAt: availableString(observation?.observedAt),
    sourceObservedAt: availableString(observation?.sourceObservedAt),
    coverageDimensions: observation?.coverage.dimensions ?? [],
    validators: observation?.validators ?? [],
    provenance: [
      ...(observation === undefined
        ? []
        : [
            { kind: "provider", value: observation.provider },
            { kind: "native-scope", value: observation.binding.nativeScope },
          ]),
      ...(observation?.freshness.evidence ?? []),
    ],
    diagnostics: readingDiagnostics(observation, selection),
  };

  if (context.state === "attention") {
    const reasonByBinding = {
      "binding-conflict": "Multiple Efforts bind the same native scope.",
      "bound-unresolved": "The declared Work Binding does not resolve to a provider observation.",
      "identity-mismatch": "The bound native identity does not match the observed identity.",
      "root-kind-conflict": "The same native root has conflicting binding definitions.",
    } as const;
    return {
      conclusion: "Binding needs attention",
      impact: "No canonical parent or contribution is selected while the binding is unresolved.",
      action:
        "Reconcile the Work Binding in the owning Agent Surface before relying on this scope.",
      binding: bindingView(context),
      why: {
        ...whyBase,
        causes: [reasonByBinding[context.reason], ...evidenceReasons],
      },
      observation: observationDetails,
    };
  }

  if (assessment.frontierEvidence === "trustworthy" && assessment.completion === "complete") {
    return {
      conclusion: "Complete",
      impact:
        "Current bound provider evidence establishes native completion; it does not conclude the Effort or Gate.",
      action: "Inspect history or subject evidence; no action is required.",
      binding: bindingView(context),
      why: { ...whyBase, causes: [] },
      observation: observationDetails,
    };
  }

  if (assessment.frontierEvidence === "trustworthy" && assessment.completion === "incomplete") {
    return {
      conclusion: "Open work remains",
      impact:
        "Current bound provider evidence establishes open native work; it does not conclude the Effort or Gate.",
      action: "Continue work through the native tracker owner.",
      binding: bindingView(context),
      why: { ...whyBase, causes: [] },
      observation: observationDetails,
    };
  }

  return {
    conclusion: "Can't verify",
    impact:
      "Current evidence cannot establish native completion, contribution, or readiness; trustworthy subsets remain inspectable.",
    action: "Use Observation details to identify the evidence owner before relying on this scope.",
    binding: bindingView(context),
    why: {
      ...whyBase,
      causes:
        evidenceReasons.length === 0
          ? ["The selected provider evidence is not currently trustworthy."]
          : evidenceReasons,
    },
    observation: observationDetails,
  };
};
