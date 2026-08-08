import { createHash } from "node:crypto";
import type { StructuralDiagnostic } from "../types";
import type { AttentionItem, GenerationDiagnostic } from "./contract";
import { isManagedAttentionDiagnostic } from "./managed-attention";
import {
  attentionItemSchema,
  diagnosticReferenceSchema,
  structuralDiagnosticSchema,
} from "./schema";
import { createSourceRecord, type SourceLocator } from "./source-records";

type DiagnosticProjectionInput = Readonly<{
  basisFingerprint: string;
  diagnostics: readonly StructuralDiagnostic[];
  sourceLocators: readonly SourceLocator[];
  managedTargets?: readonly string[] | undefined;
}>;

const diagnosticReference = (
  basisFingerprint: string,
  diagnostic: StructuralDiagnostic,
): ReturnType<typeof diagnosticReferenceSchema.parse> => {
  const payload = JSON.stringify([
    basisFingerprint,
    diagnostic.code,
    diagnostic.impact,
    diagnostic.target,
    diagnostic.message,
  ]);
  return diagnosticReferenceSchema.parse(
    `diagnostic:${createHash("sha256").update(payload, "utf8").digest("hex")}`,
  );
};

const sourceForTarget = (
  input: DiagnosticProjectionInput,
  target: string,
): ReturnType<typeof createSourceRecord> | undefined => {
  const exactFragment = input.sourceLocators.find(
    (source) => source.fragment !== undefined && target === `${source.locator}#${source.fragment}`,
  );
  const exact =
    exactFragment ??
    input.sourceLocators.find(
      (source) => target === source.locator || target.startsWith(`${source.locator}#`),
    );
  return exact === undefined ? undefined : createSourceRecord(input.basisFingerprint, exact);
};

export const buildGenerationDiagnostics = (
  input: DiagnosticProjectionInput,
): Readonly<{
  diagnostics: readonly GenerationDiagnostic[];
  attention: readonly AttentionItem[];
}> => {
  const byReference = new Map<string, GenerationDiagnostic>();
  for (const diagnostic of input.diagnostics) {
    const source = sourceForTarget(input, diagnostic.target);
    const projected = structuralDiagnosticSchema.parse({
      reference: diagnosticReference(input.basisFingerprint, diagnostic),
      code: diagnostic.code,
      impact: diagnostic.impact,
      target: diagnostic.target,
      message: diagnostic.message,
      ...(source === undefined ? {} : { source: source.reference }),
    });
    byReference.set(projected.reference, projected);
  }
  const diagnostics = [...byReference.values()];
  const sources = input.sourceLocators.map((source) =>
    createSourceRecord(input.basisFingerprint, source),
  );
  return {
    diagnostics,
    attention: diagnostics.flatMap((diagnostic) =>
      diagnostic.impact === "blocking" &&
      isManagedAttentionDiagnostic(diagnostic, sources, input.managedTargets ?? [])
        ? [
            attentionItemSchema.parse({
              kind: "structural-diagnostic" as const,
              diagnosticReference: diagnostic.reference,
            }),
          ]
        : [],
    ),
  };
};
