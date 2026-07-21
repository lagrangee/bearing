import type { RefinementCtx } from "zod";

type Collection<T> =
  | Readonly<{ validity: "available"; items: readonly T[] }>
  | Readonly<{ validity: "partial"; items: readonly T[] }>
  | Readonly<{ validity: "invalid" }>;
type Decision = Readonly<{ id: string; title: string; source: string; status: string }>;
type AttentionItem =
  | Readonly<{ kind: "structural-diagnostic"; diagnosticReference: string }>
  | Readonly<{
      kind: "alignment-check" | "planning-review";
      id: string;
      title: string;
      source: string;
    }>;

export type AttentionConsistencySnapshot = Readonly<{
  diagnostics: readonly Readonly<{ reference: string; impact: "blocking" | "non-blocking" }>[];
  checks: Collection<Decision>;
  reviews: Collection<Decision>;
  attention: readonly AttentionItem[];
}>;

const trustedItems = <T>(collection: Collection<T>): readonly T[] =>
  collection.validity === "invalid" ? [] : collection.items;
const attentionKey = (item: AttentionItem): string =>
  item.kind === "structural-diagnostic"
    ? `${item.kind}:${item.diagnosticReference}`
    : `${item.kind}:${item.id}`;
const sameAttention = (left: AttentionItem, right: AttentionItem): boolean => {
  if (left.kind !== right.kind) return false;
  if (left.kind === "structural-diagnostic" || right.kind === "structural-diagnostic") {
    return (
      left.kind === "structural-diagnostic" &&
      right.kind === "structural-diagnostic" &&
      left.diagnosticReference === right.diagnosticReference
    );
  }
  return left.id === right.id && left.title === right.title && left.source === right.source;
};

export const validateAttentionConsistency = (
  snapshot: AttentionConsistencySnapshot,
  context: RefinementCtx,
): void => {
  const expected: AttentionItem[] = snapshot.diagnostics
    .filter((diagnostic) => diagnostic.impact === "blocking")
    .map((diagnostic) => ({
      kind: "structural-diagnostic",
      diagnosticReference: diagnostic.reference,
    }));
  expected.push(
    ...trustedItems(snapshot.checks)
      .filter((check) => check.status === "open")
      .map((check) => ({
        kind: "alignment-check" as const,
        id: check.id,
        title: check.title,
        source: check.source,
      })),
    ...trustedItems(snapshot.reviews)
      .filter((review) => review.status === "pending")
      .map((review) => ({
        kind: "planning-review" as const,
        id: review.id,
        title: review.title,
        source: review.source,
      })),
  );
  const expectedByKey = new Map(expected.map((item) => [attentionKey(item), item]));
  const exact =
    snapshot.attention.length === expectedByKey.size &&
    snapshot.attention.every((item) => {
      const expectedItem = expectedByKey.get(attentionKey(item));
      return expectedItem !== undefined && sameAttention(item, expectedItem);
    });
  if (!exact) {
    context.addIssue({
      code: "custom",
      path: ["attention"],
      message: "Attention must exactly match blocking diagnostics and unresolved decisions.",
    });
  }
};
