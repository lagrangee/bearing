import { createHash } from "node:crypto";
import type { StructuralDiagnostic } from "../types";
import type { AttentionItem, SnapshotDiagnostic } from "./contract";
import {
  attentionItemSchema,
  diagnosticReferenceSchema,
  structuralDiagnosticSchema,
} from "./schema";
import { createSourceRecord, type SourceLocator } from "./source-records";

type DiagnosticProjectionInput = Readonly<{
  sitemapFingerprint: string;
  diagnostics: readonly StructuralDiagnostic[];
  sourceLocators: readonly SourceLocator[];
}>;

const diagnosticReference = (
  sitemapFingerprint: string,
  diagnostic: StructuralDiagnostic,
): ReturnType<typeof diagnosticReferenceSchema.parse> => {
  const payload = JSON.stringify([
    sitemapFingerprint,
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
  return exact === undefined ? undefined : createSourceRecord(input.sitemapFingerprint, exact);
};

export const buildSnapshotDiagnostics = (
  input: DiagnosticProjectionInput,
): Readonly<{
  diagnostics: readonly SnapshotDiagnostic[];
  attention: readonly AttentionItem[];
}> => {
  const byReference = new Map<string, SnapshotDiagnostic>();
  for (const diagnostic of input.diagnostics) {
    const source = sourceForTarget(input, diagnostic.target);
    const projected = structuralDiagnosticSchema.parse({
      reference: diagnosticReference(input.sitemapFingerprint, diagnostic),
      code: diagnostic.code,
      impact: diagnostic.impact,
      target: diagnostic.target,
      message: diagnostic.message,
      ...(source === undefined ? {} : { source: source.reference }),
    });
    byReference.set(projected.reference, projected);
  }
  const diagnostics = [...byReference.values()];
  return {
    diagnostics,
    attention: diagnostics.flatMap((diagnostic) =>
      diagnostic.impact === "blocking"
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
