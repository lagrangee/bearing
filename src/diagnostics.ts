import type { DecodedBearingRecordGeneration } from "./bearing-record-decoder";
import { repositoryManifestSchema } from "./schema-definitions";
import type { SyncInputRecord } from "./sync-input-generation";
import type { StructuralDiagnostic } from "./types";

const compareText = (left: string, right: string): number =>
  Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));

const manifestDiagnostic = (source: string): StructuralDiagnostic[] => {
  const invalidManifest = (): StructuralDiagnostic[] => [
    {
      code: "invalid-bearing-manifest",
      impact: "blocking",
      target: ".bearing/manifest.json",
      message: "Bearing manifest does not match its package-owned schema.",
    },
  ];
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    return invalidManifest();
  }
  return repositoryManifestSchema.safeParse(parsed).success ? [] : invalidManifest();
};

export const deriveStructuralDiagnosticsFromGeneration = (
  decoded: DecodedBearingRecordGeneration,
  records: readonly SyncInputRecord[],
  initial: readonly StructuralDiagnostic[],
): readonly StructuralDiagnostic[] => {
  const diagnostics = [...initial, ...decoded.diagnostics];
  for (const record of records) {
    if (record.locator === ".bearing/manifest.json") {
      diagnostics.push(...manifestDiagnostic(record.source));
    }
  }
  return diagnostics.sort((left, right) => {
    const targetOrder = compareText(left.target, right.target);
    if (targetOrder !== 0) return targetOrder;
    const codeOrder = compareText(left.code, right.code);
    return codeOrder !== 0 ? codeOrder : compareText(left.message, right.message);
  });
};
