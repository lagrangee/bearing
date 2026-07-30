import type { AssetProjection, CollectionProjection } from "./contract";
import { assetProjectionSchema } from "./schema";

type Collection<T> =
  | Readonly<{ validity: "available" | "partial"; items: readonly T[] }>
  | Readonly<{ validity: "invalid" }>;
type Citation = Readonly<{ assetId: string; note: string }>;
type CitedNode = Readonly<{
  id: string;
  source: string;
  citations: readonly Citation[];
}>;
type Gate = CitedNode &
  Readonly<{
    id: string;
    passage?: Readonly<{ evidenceAssetIds: readonly string[] }> | undefined;
  }>;
type Authority = CitedNode &
  Readonly<{
    id: string;
    adoptions: readonly Readonly<{ assetId: string }>[];
  }>;
type ForwardRelations = Readonly<{
  roadmaps: Collection<CitedNode>;
  gates: Collection<Gate>;
  efforts: Collection<CitedNode>;
  authorities: Collection<Authority>;
  checks: Collection<CitedNode>;
  reviews: Collection<CitedNode>;
}>;

const compareUtf8 = (left: string, right: string): number =>
  Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));

const trustworthy = <T>(collection: Collection<T>): readonly T[] =>
  collection.validity === "invalid" ? [] : collection.items;

const citedNodes = (input: ForwardRelations): readonly CitedNode[] => [
  ...trustworthy(input.roadmaps),
  ...trustworthy(input.gates),
  ...trustworthy(input.efforts),
  ...trustworthy(input.authorities),
  ...trustworthy(input.checks),
  ...trustworthy(input.reviews),
];

const rebuildAsset = (asset: AssetProjection, input: ForwardRelations): AssetProjection => {
  const citations = citedNodes(input)
    .flatMap((node) =>
      node.citations
        .filter((citation) => citation.assetId === asset.id)
        .map((citation) => ({
          ...citation,
          citingReference: node.id,
          source: node.source,
        })),
    )
    .sort((left, right) => {
      const byReference = compareUtf8(left.citingReference, right.citingReference);
      return byReference === 0 ? compareUtf8(left.note, right.note) : byReference;
    });
  return assetProjectionSchema.parse({
    ...asset,
    citations,
    citationCount: citations.length,
    adoptedByAuthorityIds: trustworthy(input.authorities)
      .filter((authority) => authority.adoptions.some((adoption) => adoption.assetId === asset.id))
      .map((authority) => authority.id)
      .sort(compareUtf8),
    gatePassageEvidenceFor: trustworthy(input.gates)
      .filter((gate) => gate.passage?.evidenceAssetIds.includes(asset.id) === true)
      .map((gate) => gate.id)
      .sort(compareUtf8),
  });
};

export const rebuildAssetReverseRelations = (
  assets: CollectionProjection<AssetProjection>,
  input: ForwardRelations,
): CollectionProjection<AssetProjection> => {
  if (assets.validity === "invalid") return assets;
  const items = assets.items.map((asset) => rebuildAsset(asset, input));
  return assets.validity === "available"
    ? { validity: "available", items }
    : { validity: "partial", items, issues: assets.issues };
};
