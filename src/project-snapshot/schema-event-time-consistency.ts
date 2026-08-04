import type { RefinementCtx } from "zod";

type Collection<T> =
  | Readonly<{ validity: "available" | "partial"; items: readonly T[] }>
  | Readonly<{ validity: "invalid" }>;

type Decision = Readonly<{
  id: string;
  resolution?: Readonly<{ acceptedAt: unknown }> | undefined;
}>;

type Authority = Readonly<{
  baselineAssetIds: readonly string[];
  adoptions: readonly Readonly<{
    assetId: string;
    decisionReference: string;
  }>[];
}>;

export type EventTimeConsistencySnapshot = Readonly<{
  authorities: Collection<Authority>;
  checks: Collection<Decision>;
  reviews: Collection<Decision>;
}>;

const trustedItems = <T>(collection: Collection<T>): readonly T[] =>
  collection.validity === "invalid" ? [] : collection.items;

const decisionCollectionFor = (
  snapshot: EventTimeConsistencySnapshot,
  reference: string,
): Collection<Decision> =>
  reference.startsWith("alignment-check:") ? snapshot.checks : snapshot.reviews;

export const validateEventTimeConsistency = (
  snapshot: EventTimeConsistencySnapshot,
  context: RefinementCtx,
): void => {
  for (const [authorityPosition, authority] of trustedItems(snapshot.authorities).entries()) {
    for (const [adoptionPosition, adoption] of authority.adoptions.entries()) {
      const path = [
        "authorities",
        "items",
        authorityPosition,
        "adoptions",
        adoptionPosition,
      ] as const;
      if (!authority.baselineAssetIds.includes(adoption.assetId)) {
        context.addIssue({
          code: "custom",
          path: [...path, "assetId"],
          message: "Authority Adoption must belong to the current baseline.",
        });
      }
      const collection = decisionCollectionFor(snapshot, adoption.decisionReference);
      if (collection.validity === "invalid") continue;
      const decision = collection.items.find(
        (candidate) => candidate.id === adoption.decisionReference,
      );
      if (decision === undefined) {
        if (collection.validity === "available") {
          context.addIssue({
            code: "custom",
            path: [...path, "decisionReference"],
            message: "Every Authority Adoption in a complete Decision projection must resolve.",
          });
        }
        continue;
      }
      if (decision.resolution === undefined) {
        context.addIssue({
          code: "custom",
          path: [...path, "decisionReference"],
          message:
            "Authority Adoption must cite an Accepted Decision that owns its Source Event Time.",
        });
      }
    }
  }
};
