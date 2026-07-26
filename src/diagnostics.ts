import type { DecodedBearingRecordGeneration } from "./bearing-record-decoder";
import { deriveNativeTicketDiagnostics, type NativeTicket } from "./native-ticket-diagnostics";
import type { NativeSourceRecord } from "./native-work";
import { repositoryManifestSchema } from "./schema-definitions";
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
  records: readonly NativeSourceRecord[],
  initial: readonly StructuralDiagnostic[],
): readonly StructuralDiagnostic[] => {
  const diagnostics = [...initial, ...decoded.diagnostics];
  const tickets: NativeTicket[] = [];
  for (const record of records) {
    if (record.locator === ".bearing/manifest.json") {
      diagnostics.push(...manifestDiagnostic(record.source));
      continue;
    }
    if (record.native?.kind === "ticket") tickets.push(record.native);
    if (record.native?.kind === "map") {
      const status = record.native.status;
      if (status !== "active" && status !== "resolved") {
        diagnostics.push({
          code: "unsupported-map-status",
          impact: "blocking",
          target: record.locator,
          message:
            status === undefined
              ? "Wayfinder Map has no Status."
              : "Wayfinder Map Status is not supported.",
        });
      }
    }
  }
  diagnostics.push(...deriveNativeTicketDiagnostics(tickets));
  return diagnostics.sort((left, right) => {
    const targetOrder = compareText(left.target, right.target);
    if (targetOrder !== 0) return targetOrder;
    const codeOrder = compareText(left.code, right.code);
    return codeOrder !== 0 ? codeOrder : compareText(left.message, right.message);
  });
};
