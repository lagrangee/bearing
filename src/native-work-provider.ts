import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import stableStringify from "safe-stable-stringify";
import { z } from "zod";
import { deepFreeze } from "./immutable";

export type ProviderStructuralValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | readonly ProviderStructuralValue[]
  | Readonly<{ [key: string]: ProviderStructuralValue }>;

export type ProviderProjection =
  | readonly ProviderStructuralValue[]
  | Readonly<{ [key: string]: ProviderStructuralValue }>;

const providerStructuralValueSchema: z.ZodType<ProviderStructuralValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.undefined(),
    z.array(providerStructuralValueSchema),
    z.record(z.string(), providerStructuralValueSchema),
  ]),
);

export type ProviderConfiguration<ProviderId extends string> = Readonly<{
  provider: ProviderId;
  contractLocator: string;
}>;

export type WorkBinding<ProviderId extends string> = Readonly<{
  provider: ProviderId;
  nativeScope: string;
}>;

export type CapturedProviderDocument = Readonly<{
  locator: string;
  source: string;
  bytes: Buffer;
}>;

export type CapturedProviderDocuments = ReadonlyMap<string, CapturedProviderDocument>;

export type ProviderProjectionState = "available" | "partial" | "absent" | "invalid";
export type ProviderFreshnessAssessment = "current" | "stale" | "undetermined";
export type ProviderCompletionAssessment = "incomplete" | "complete" | "undetermined";

export type ProviderFreshnessEvidence = Readonly<{
  assessment: ProviderFreshnessAssessment;
  evidence: readonly Readonly<{
    kind: string;
    value: string;
  }>[];
}>;

export type ProjectionCoverage = Readonly<{
  assessment: "complete" | "incomplete";
  dimensions: readonly Readonly<{
    key: string;
    state: "covered" | "excluded" | "gap" | "conflict";
    detail?: string;
  }>[];
}>;

export type ProviderDiagnostic = Readonly<{
  code: string;
  class:
    | "source"
    | "contract"
    | "mapping"
    | "permission"
    | "acquisition"
    | "network"
    | "pagination"
    | "format"
    | "identity"
    | "concurrency";
  impact: "blocking" | "non-blocking";
  target: string;
  message: string;
}>;

export type ProviderCompletionInvariantInput = Readonly<{
  state: ProviderProjectionState;
  freshness: Readonly<{ assessment: ProviderFreshnessAssessment }>;
  coverage: Readonly<{
    assessment: "complete" | "incomplete";
    dimensions: readonly Readonly<{
      state: "covered" | "excluded" | "gap" | "conflict";
    }>[];
  }>;
  completion: ProviderCompletionAssessment;
  diagnostics: readonly Readonly<{ impact: "blocking" | "non-blocking" }>[];
}>;

export type ProviderObservationEvidenceAssessment = Readonly<{
  projectionState: ProviderProjectionState | "missing";
  freshness: ProviderFreshnessAssessment;
  coverage: ProjectionCoverage["assessment"] | "undetermined";
  completion: ProviderCompletionAssessment;
  blockingDiagnosticCount: number;
  frontierEvidence: "trustworthy" | "withheld";
}>;

export type NativeWorkAffectedRelation = Readonly<{
  kind: "parent-child" | "blocked-by";
  source: string;
  target: string;
}>;

export type NativeWorkAffectedSet = Readonly<{
  subjects: readonly string[];
  relations: readonly NativeWorkAffectedRelation[];
}>;

export type NativeWorkReconciliationInput<
  ProviderId extends string,
  Projection extends ProviderProjection,
> = Readonly<{
  binding: WorkBinding<ProviderId>;
  prior?: ProviderScopeObservation<ProviderId, Projection>;
  affected: NativeWorkAffectedSet;
}>;

const hasTrustworthyProviderEvidence = (capture: ProviderCompletionInvariantInput): boolean =>
  capture.state === "available" &&
  capture.freshness.assessment === "current" &&
  capture.coverage.assessment === "complete" &&
  capture.coverage.dimensions.every(
    (dimension) => dimension.state !== "gap" && dimension.state !== "conflict",
  ) &&
  capture.diagnostics.every((diagnostic) => diagnostic.impact !== "blocking");

export const hasConsistentProviderCompletion = (
  capture: ProviderCompletionInvariantInput,
): boolean => capture.completion !== "complete" || hasTrustworthyProviderEvidence(capture);

export const assessProviderObservationEvidence = (
  capture: ProviderCompletionInvariantInput | undefined,
): ProviderObservationEvidenceAssessment => {
  if (capture === undefined) {
    return deepFreeze({
      projectionState: "missing",
      freshness: "undetermined",
      coverage: "undetermined",
      completion: "undetermined",
      blockingDiagnosticCount: 0,
      frontierEvidence: "withheld",
    });
  }
  const blockingDiagnosticCount = capture.diagnostics.filter(
    (diagnostic) => diagnostic.impact === "blocking",
  ).length;
  const trustworthy =
    hasTrustworthyProviderEvidence(capture) && capture.completion !== "undetermined";
  return deepFreeze({
    projectionState: capture.state,
    freshness: capture.freshness.assessment,
    coverage: capture.coverage.assessment,
    completion: capture.completion,
    blockingDiagnosticCount,
    frontierEvidence: trustworthy ? "trustworthy" : "withheld",
  });
};

export type ProviderObservationValidator = Readonly<{
  kind: string;
  value: string;
}>;

type ProviderScopeObservationBase<ProviderId extends string> = Readonly<{
  id: string;
  provider: ProviderId;
  binding: WorkBinding<ProviderId>;
  observedAt: string;
  sourceRevision?: string;
  sourceObservedAt?: string;
  validators: readonly ProviderObservationValidator[];
  freshness: ProviderFreshnessEvidence;
  coverage: ProjectionCoverage;
  completion: ProviderCompletionAssessment;
  diagnostics: readonly ProviderDiagnostic[];
}>;

export type ProviderScopeObservation<
  ProviderId extends string,
  Projection extends ProviderProjection,
> = ProviderScopeObservationBase<ProviderId> &
  (
    | Readonly<{
        state: "available" | "partial";
        projection: Projection;
      }>
    | Readonly<{
        state: "absent" | "invalid";
        projection?: never;
      }>
  );

export interface NativeWorkProvider<
  ProviderId extends string,
  Projection extends ProviderProjection,
> {
  readonly id: ProviderId;
  capture(
    binding: WorkBinding<ProviderId>,
  ): Promise<ProviderScopeObservation<ProviderId, Projection>>;
  reconcile?(
    input: NativeWorkReconciliationInput<ProviderId, Projection>,
  ): Promise<ProviderScopeObservation<ProviderId, Projection>>;
}

type ProviderScopeObservationInputBase<ProviderId extends string> = Omit<
  ProviderScopeObservationBase<ProviderId>,
  "id" | "observedAt" | "sourceRevision" | "sourceObservedAt" | "validators" | "freshness"
> &
  Readonly<{
    observedAt?: string;
    sourceRevision?: string;
    sourceObservedAt?: string;
    validators?: readonly ProviderObservationValidator[];
    freshness: ProviderFreshnessEvidence &
      Readonly<{
        capturedAt?: string;
        sourceRevision?: string;
        sourceObservedAt?: string;
      }>;
  }>;

type ProviderScopeObservationInput<
  ProviderId extends string,
  Projection extends ProviderProjection,
> = ProviderScopeObservationInputBase<ProviderId> &
  (
    | Readonly<{
        state: "available" | "partial";
        projection: Projection;
      }>
    | Readonly<{
        state: "absent" | "invalid";
        projection?: never;
      }>
  );

export const providerObservationIdentityFor = (observation: ProviderStructuralValue): string => {
  const source = stableStringify(observation);
  if (source === undefined) throw new TypeError("Provider observation could not be serialized.");
  return `provider-observation:sha256:${bytesToHex(sha256(utf8ToBytes(source)))}`;
};

export const createProviderScopeObservation = <
  ProviderId extends string,
  Projection extends ProviderProjection,
>(
  observation: ProviderScopeObservationInput<ProviderId, Projection>,
): ProviderScopeObservation<ProviderId, Projection> => {
  if (observation.provider !== observation.binding.provider) {
    throw new TypeError("Provider observation identity must match its Work Binding.");
  }
  const hasProjection = Object.hasOwn(observation, "projection");
  if (
    ((observation.state === "available" || observation.state === "partial") &&
      (!hasProjection || observation.projection === undefined)) ||
    ((observation.state === "absent" || observation.state === "invalid") && hasProjection)
  ) {
    throw new TypeError(
      "Available and partial observations require one projection; absent and invalid observations forbid it.",
    );
  }
  if (!hasConsistentProviderCompletion(observation)) {
    throw new TypeError(
      "Provider completion can be complete only for an available, current, fully covered observation without gaps, conflicts or blocking diagnostics.",
    );
  }
  const {
    capturedAt,
    sourceRevision: freshnessSourceRevision,
    sourceObservedAt: freshnessSourceObservedAt,
    ...freshness
  } = observation.freshness;
  const observedAt = observation.observedAt ?? capturedAt;
  if (observedAt === undefined || observedAt.length === 0) {
    throw new TypeError("Provider observations require one original observation time.");
  }
  const sourceRevision = observation.sourceRevision ?? freshnessSourceRevision;
  const sourceObservedAt = observation.sourceObservedAt ?? freshnessSourceObservedAt;
  const validators =
    observation.validators ?? freshness.evidence.filter((item) => item.kind.includes("validator"));
  const content = {
    provider: observation.provider,
    binding: observation.binding,
    observedAt,
    ...(sourceRevision === undefined ? {} : { sourceRevision }),
    ...(sourceObservedAt === undefined ? {} : { sourceObservedAt }),
    validators,
    freshness,
    coverage: observation.coverage,
    completion: observation.completion,
    diagnostics: observation.diagnostics,
    state: observation.state,
    ...("projection" in observation ? { projection: observation.projection } : {}),
  };
  const candidate = {
    id: providerObservationIdentityFor(content),
    ...content,
  };
  const structuralObservation = providerStructuralValueSchema.safeParse(candidate);
  if (!structuralObservation.success) {
    throw new TypeError(
      "Provider observations must contain only string-keyed structural objects, arrays and scalar values.",
    );
  }
  return deepFreeze(structuralObservation.data) as ProviderScopeObservation<ProviderId, Projection>;
};
