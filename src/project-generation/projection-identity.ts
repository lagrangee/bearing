import { z } from "zod";
import type { ProjectionIssue, SourceRecord } from "./contract";

export type IdentifiedProjectionResult<T> = Readonly<{
  item?: T;
  issue?: ProjectionIssue;
  source: SourceRecord;
}>;

const duplicateIssue = (source: SourceRecord): ProjectionIssue => ({
  code: "duplicate-stable-id",
  target:
    source.fragment === undefined
      ? source.displayLocator
      : `${source.displayLocator}#${source.fragment}`,
  message: "Stable ID is declared by multiple Bearing objects.",
  source: source.reference,
});

export const isolateDuplicateIdentities = <T>(
  results: readonly IdentifiedProjectionResult<T>[],
  identityOf: (item: T) => string,
): readonly IdentifiedProjectionResult<T>[] => {
  const counts = new Map<string, number>();
  for (const result of results) {
    if (result.item === undefined) continue;
    const identity = identityOf(result.item);
    counts.set(identity, (counts.get(identity) ?? 0) + 1);
  }
  return results.map((result) => {
    if (result.item === undefined || counts.get(identityOf(result.item)) === 1) return result;
    return { source: result.source, issue: duplicateIssue(result.source) };
  });
};

export const uniqueIdentityArraySchema = <T extends z.ZodType>(
  itemSchema: T,
  identityOf: (item: z.output<T>) => string,
) =>
  z.array(itemSchema).superRefine((items, context) => {
    const seen = new Set<string>();
    for (const [index, item] of items.entries()) {
      const identity = identityOf(item);
      if (seen.has(identity)) {
        context.addIssue({
          code: "custom",
          path: [index],
          message: "Identity must be unique within its collection.",
        });
      }
      seen.add(identity);
    }
  });
