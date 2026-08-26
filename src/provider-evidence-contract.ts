import { z } from "zod";
import {
  assessProviderObservationEvidence,
  type ProviderCompletionInvariantInput,
  type ProviderFreshnessAssessment,
  type ProviderObservationEvidenceAssessment,
} from "./native-work-provider";
import type { StructuralDiagnostic } from "./types";

export type ProviderObservationIntent =
  | "reuse-current"
  | "targeted-reconciliation"
  | "exact-scope-capture"
  | "all-scope-verification";
export type ProviderObservationAcquisitionIntent = Exclude<
  ProviderObservationIntent,
  "reuse-current" | "targeted-reconciliation"
>;
export type ProviderObservationAttemptIntent =
  | ProviderObservationAcquisitionIntent
  | "targeted-reconciliation"
  | "provider-detail-selection";
export type ProviderObservationAttempt = Readonly<{
  intent: ProviderObservationAttemptIntent;
  attemptedAt: string;
  outcome: "succeeded" | "failed";
  diagnostics: readonly StructuralDiagnostic[];
  requestFingerprint?: string | undefined;
}>;
export type ProviderObservationSelection = Readonly<{
  provider: "matt-skills/v1";
  nativeScope: string;
  observationId: string | null;
  effectiveFreshness: ProviderFreshnessAssessment;
  latestAttempt: ProviderObservationAttempt | null;
}>;
export const targetedReconciliationBasisSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("ready") }),
  z.strictObject({
    state: z.literal("capture-required"),
    reason: z.enum(["observation-unavailable", "freshness-not-current", "latest-attempt-failed"]),
  }),
]);
export type TargetedReconciliationBasis = Readonly<
  z.infer<typeof targetedReconciliationBasisSchema>
>;
export type ProviderObservationOperation = Readonly<{
  intent: ProviderObservationIntent;
  outcome: "reused" | "acquired" | "unavailable" | "retained-after-failure" | "not-applicable";
  acquisitionCount: number;
}>;

const structuralDiagnosticSchema = z.strictObject({
  code: z.string().min(1),
  impact: z.enum(["blocking", "non-blocking"]),
  target: z.string().min(1),
  message: z.string().min(1),
});
const attemptSchema = z
  .strictObject({
    intent: z.enum([
      "exact-scope-capture",
      "all-scope-verification",
      "targeted-reconciliation",
      "provider-detail-selection",
    ]),
    attemptedAt: z.string().min(1),
    outcome: z.enum(["succeeded", "failed"]),
    diagnostics: z.array(structuralDiagnosticSchema),
    requestFingerprint: z
      .string()
      .regex(/^sha256:[0-9a-f]{64}$/)
      .optional(),
  })
  .superRefine((attempt, context) => {
    if (attempt.intent !== "targeted-reconciliation" && attempt.requestFingerprint !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["requestFingerprint"],
        message: "Only targeted reconciliation attempts carry a request fingerprint.",
      });
    }
  });
export const providerObservationSelectionSchema = z
  .strictObject({
    provider: z.literal("matt-skills/v1"),
    nativeScope: z.string().min(1),
    observationId: z.string().nullable(),
    effectiveFreshness: z.enum(["current", "stale", "undetermined"]),
    latestAttempt: attemptSchema.nullable(),
  })
  .superRefine((selection, context) => {
    if (selection.observationId === null && selection.effectiveFreshness !== "undetermined") {
      context.addIssue({
        code: "custom",
        path: ["effectiveFreshness"],
        message: "A missing selected observation requires undetermined effective freshness.",
      });
    }
    if (
      selection.latestAttempt?.outcome === "succeeded" &&
      (selection.observationId === null ||
        selection.latestAttempt.diagnostics.some((diagnostic) => diagnostic.impact === "blocking"))
    ) {
      context.addIssue({
        code: "custom",
        path: ["latestAttempt"],
        message:
          "A successful latest attempt requires a selected observation without blocking attempt diagnostics; later evidence or an independent binding conflict may still change effective freshness.",
      });
    }
  });

export const providerObservationSelectionFreshnessIsCoherent = (
  selection: Pick<ProviderObservationSelection, "effectiveFreshness">,
  observation:
    | Readonly<{ freshness: Readonly<{ assessment: ProviderFreshnessAssessment }> }>
    | undefined,
): boolean =>
  selection.effectiveFreshness !== "current" || observation?.freshness.assessment === "current";

export const targetedReconciliationBasis = (
  selection: ProviderObservationSelection | undefined,
  observation:
    | Readonly<{
        id: string;
        freshness: Readonly<{ assessment: ProviderFreshnessAssessment }>;
      }>
    | undefined,
): TargetedReconciliationBasis => {
  if (
    selection === undefined ||
    observation === undefined ||
    selection.observationId !== observation.id
  ) {
    return { state: "capture-required", reason: "observation-unavailable" };
  }
  if (
    selection.effectiveFreshness !== "current" ||
    observation.freshness.assessment !== "current"
  ) {
    return { state: "capture-required", reason: "freshness-not-current" };
  }
  if (selection.latestAttempt?.outcome === "failed") {
    return { state: "capture-required", reason: "latest-attempt-failed" };
  }
  return { state: "ready" };
};

export const assessSelectedProviderObservationEvidence = (
  observation: (ProviderCompletionInvariantInput & Readonly<{ id: string }>) | undefined,
  selection: ProviderObservationSelection | undefined,
): ProviderObservationEvidenceAssessment => {
  const assessment = assessProviderObservationEvidence(observation);
  const hasSelectedObservation =
    observation !== undefined &&
    selection !== undefined &&
    selection.observationId === observation.id;
  const selected = hasSelectedObservation && selection.effectiveFreshness === "current";
  const latestBlockingDiagnostics = hasSelectedObservation
    ? 0
    : (selection?.latestAttempt?.diagnostics.filter(
        (diagnostic) => diagnostic.impact === "blocking",
      ).length ?? 0);
  return {
    ...assessment,
    freshness: selection?.effectiveFreshness ?? "undetermined",
    blockingDiagnosticCount: assessment.blockingDiagnosticCount + latestBlockingDiagnostics,
    frontierEvidence: selected ? assessment.frontierEvidence : "withheld",
  };
};
