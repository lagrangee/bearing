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

export type CaptureGeneration = Readonly<{
  fingerprint: string;
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
  capturedAt: string;
  sourceRevision?: string;
  sourceObservedAt?: string;
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

export type ProviderCaptureEvidenceAssessment = Readonly<{
  projectionState: ProviderProjectionState | "missing";
  freshness: ProviderFreshnessAssessment;
  coverage: ProjectionCoverage["assessment"] | "undetermined";
  completion: ProviderCompletionAssessment;
  blockingDiagnosticCount: number;
  frontierEvidence: "trustworthy" | "withheld";
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

export const assessProviderCaptureEvidence = (
  capture: ProviderCompletionInvariantInput | undefined,
): ProviderCaptureEvidenceAssessment => {
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

type ProviderScopeCaptureBase<ProviderId extends string> = Readonly<{
  provider: ProviderId;
  binding: WorkBinding<ProviderId>;
  generation: CaptureGeneration;
  freshness: ProviderFreshnessEvidence;
  coverage: ProjectionCoverage;
  completion: ProviderCompletionAssessment;
  diagnostics: readonly ProviderDiagnostic[];
}>;

export type ProviderScopeCapture<
  ProviderId extends string,
  Projection extends ProviderProjection,
> = ProviderScopeCaptureBase<ProviderId> &
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
    generation: CaptureGeneration,
  ): Promise<ProviderScopeCapture<ProviderId, Projection>>;
}

export const createProviderScopeCapture = <
  ProviderId extends string,
  Projection extends ProviderProjection,
>(
  capture: ProviderScopeCapture<ProviderId, Projection>,
): ProviderScopeCapture<ProviderId, Projection> => {
  if (capture.provider !== capture.binding.provider) {
    throw new TypeError("Provider capture identity must match its Work Binding.");
  }
  const hasProjection = Object.hasOwn(capture, "projection");
  if (
    ((capture.state === "available" || capture.state === "partial") &&
      (!hasProjection || capture.projection === undefined)) ||
    ((capture.state === "absent" || capture.state === "invalid") && hasProjection)
  ) {
    throw new TypeError(
      "Available and partial captures require one projection; absent and invalid captures forbid it.",
    );
  }
  if (!hasConsistentProviderCompletion(capture)) {
    throw new TypeError(
      "Provider completion can be complete only for an available, current, fully covered capture without gaps, conflicts or blocking diagnostics.",
    );
  }
  const structuralCapture = providerStructuralValueSchema.safeParse(capture);
  if (!structuralCapture.success) {
    throw new TypeError(
      "Provider captures must contain only string-keyed structural objects, arrays and scalar values.",
    );
  }
  return deepFreeze(structuralCapture.data) as ProviderScopeCapture<ProviderId, Projection>;
};

export const rebaseProviderScopeCaptureGeneration = <
  ProviderId extends string,
  Projection extends ProviderProjection,
>(
  capture: ProviderScopeCapture<ProviderId, Projection>,
  fingerprint: string,
): ProviderScopeCapture<ProviderId, Projection> =>
  capture.state === "available" || capture.state === "partial"
    ? createProviderScopeCapture({
        ...capture,
        generation: { fingerprint },
        projection: capture.projection,
      })
    : createProviderScopeCapture({
        ...capture,
        generation: { fingerprint },
      });
