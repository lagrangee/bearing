import type { SourceBinding, SourceKind, SourceRecord } from "./contract";
import { createSourceReference, sourceRecordSchema } from "./source-reference";

export type SourceLocator = Readonly<{
  kind: SourceKind;
  locator: string;
  fragment?: string;
  binding?: SourceBinding;
}>;

export const createSourceRecord = (
  sitemapFingerprint: string,
  source: SourceLocator,
): SourceRecord =>
  sourceRecordSchema.parse({
    reference: createSourceReference({
      basisFingerprint: sitemapFingerprint,
      kind: source.kind,
      displayLocator: source.locator,
      ...(source.fragment === undefined ? {} : { fragment: source.fragment }),
      ...(source.binding === undefined ? {} : { binding: source.binding }),
    }),
    kind: source.kind,
    displayLocator: source.locator,
    ...(source.fragment === undefined ? {} : { fragment: source.fragment }),
    ...(source.binding === undefined ? {} : { binding: source.binding }),
  });

export const mergeSourceRecords = (
  records: readonly (readonly SourceRecord[])[],
): readonly SourceRecord[] => {
  const byReference = new Map<string, SourceRecord>();
  for (const record of records.flat()) byReference.set(record.reference, record);
  return [...byReference.values()].sort((left, right) =>
    Buffer.compare(Buffer.from(left.reference, "utf8"), Buffer.from(right.reference, "utf8")),
  );
};
