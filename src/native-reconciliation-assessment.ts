import {
  type NativeReconciliationRequest,
  nativeReconciliationRequestFingerprint,
} from "./native-reconciliation-contract";
import type {
  ProviderObservationAttempt,
  ProviderObservationSelection,
} from "./provider-observation-contract";
import { sameMattNativeBindingDefinition } from "./providers/matt-skills-v1/native-subject";
import type { StructuralDiagnostic } from "./types";

export type NativeReconciliationAssessment = Readonly<{
  requestFingerprint: string;
  outcome: "succeeded" | "failed";
  diagnostics: readonly StructuralDiagnostic[];
  attempt: ProviderObservationAttempt | undefined;
}>;

export const assessNativeReconciliation = (input: {
  readonly request: NativeReconciliationRequest;
  readonly boundSelections: readonly ProviderObservationSelection[];
  readonly inspectionSelections: readonly ProviderObservationSelection[];
}): NativeReconciliationAssessment => {
  const requestFingerprint = nativeReconciliationRequestFingerprint(input.request);
  const matchingAttempt = (
    selections: readonly ProviderObservationSelection[],
  ): ProviderObservationAttempt | undefined =>
    selections.find(
      (selection) =>
        sameMattNativeBindingDefinition(selection, input.request.binding) &&
        selection.latestAttempt?.intent === "targeted-reconciliation" &&
        selection.latestAttempt.requestFingerprint === requestFingerprint,
    )?.latestAttempt ?? undefined;
  const attempt =
    matchingAttempt(input.boundSelections) ?? matchingAttempt(input.inspectionSelections);
  if (attempt === undefined) {
    return {
      requestFingerprint,
      outcome: "failed",
      diagnostics: [
        {
          code: "native-targeted-reconciliation.result-unavailable",
          impact: "blocking",
          target: input.request.binding.nativeScope,
          message:
            "Targeted native reconciliation did not publish a matching result; inspect the current binding/discovery basis before retrying.",
        },
      ],
      attempt,
    };
  }
  return {
    requestFingerprint,
    outcome: attempt.outcome,
    diagnostics: attempt.diagnostics,
    attempt,
  };
};
