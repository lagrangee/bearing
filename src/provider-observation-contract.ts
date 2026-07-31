import { z } from "zod";
import {
  assessProviderObservationEvidence,
  type ProviderCompletionInvariantInput,
  type ProviderFreshnessAssessment,
  type ProviderObservationEvidenceAssessment,
} from "./native-work-provider";
import type { StructuralDiagnostic } from "./types";

export type ProviderObservationIntent =
  | "ordinary-sync"
  | "initial-baseline"
  | "recovery"
  | "full-verification";
export type ProviderObservationAcquisitionIntent = Exclude<
  ProviderObservationIntent,
  "ordinary-sync"
>;
export type ProviderObservationAttempt = Readonly<{
  intent: ProviderObservationAcquisitionIntent;
  attemptedAt: string;
  outcome: "succeeded" | "failed";
  diagnostics: readonly StructuralDiagnostic[];
}>;
export type ProviderObservationSelection = Readonly<{
  provider: "matt-skills/v1";
  nativeScope: string;
  observationId: string | null;
  effectiveFreshness: ProviderFreshnessAssessment;
  latestAttempt: ProviderObservationAttempt | null;
}>;
export type ProviderObservationOperation = Readonly<{
  intent: ProviderObservationIntent;
  outcome: "reused" | "acquired" | "unavailable" | "retained-after-failure";
  acquisitionCount: number;
}>;

const structuralDiagnosticSchema = z.strictObject({
  code: z.string().min(1),
  impact: z.enum(["blocking", "non-blocking"]),
  target: z.string().min(1),
  message: z.string().min(1),
});
const attemptSchema = z.strictObject({
  intent: z.enum(["initial-baseline", "recovery", "full-verification"]),
  attemptedAt: z.string().min(1),
  outcome: z.enum(["succeeded", "failed"]),
  diagnostics: z.array(structuralDiagnosticSchema),
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
    const latestAttemptBlocks =
      selection.latestAttempt?.outcome === "failed" ||
      selection.latestAttempt?.diagnostics.some(
        (diagnostic) => diagnostic.impact === "blocking",
      ) === true;
    if (
      (selection.observationId === null || latestAttemptBlocks) &&
      selection.effectiveFreshness !== "undetermined"
    ) {
      context.addIssue({
        code: "custom",
        path: ["effectiveFreshness"],
        message:
          "A missing observation or failed/blocking latest attempt requires undetermined effective freshness.",
      });
    }
    if (
      selection.latestAttempt?.outcome === "succeeded" &&
      (selection.observationId === null ||
        selection.effectiveFreshness === "stale" ||
        selection.latestAttempt.diagnostics.some((diagnostic) => diagnostic.impact === "blocking"))
    ) {
      context.addIssue({
        code: "custom",
        path: ["latestAttempt"],
        message:
          "A successful latest attempt requires a selected non-stale observation without blocking attempt diagnostics; an independent binding conflict may still withhold effective freshness.",
      });
    }
  });

export const assessSelectedProviderObservationEvidence = (
  observation: (ProviderCompletionInvariantInput & Readonly<{ id: string }>) | undefined,
  selection: ProviderObservationSelection | undefined,
): ProviderObservationEvidenceAssessment => {
  const assessment = assessProviderObservationEvidence(observation);
  const selected =
    observation !== undefined &&
    selection !== undefined &&
    selection.observationId === observation.id &&
    selection.effectiveFreshness === "current" &&
    selection.latestAttempt?.outcome !== "failed";
  const latestBlockingDiagnostics =
    selection?.latestAttempt?.diagnostics.filter((diagnostic) => diagnostic.impact === "blocking")
      .length ?? 0;
  return {
    ...assessment,
    freshness: selection?.effectiveFreshness ?? "undetermined",
    blockingDiagnosticCount: assessment.blockingDiagnosticCount + latestBlockingDiagnostics,
    frontierEvidence:
      selected && latestBlockingDiagnostics === 0 ? assessment.frontierEvidence : "withheld",
  };
};
