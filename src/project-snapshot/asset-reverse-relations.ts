import type { AssetDirectEvidence } from "./asset-direct-evidence";
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
type Authority = CitedNode &
  Readonly<{
    id: string;
    baselineAssetIds: readonly string[];
  }>;
type ForwardRelations = Readonly<{
  roadmaps: Collection<CitedNode>;
  gates: Collection<CitedNode>;
  efforts: Collection<CitedNode>;
  authorities: Collection<Authority>;
  reviews: Collection<CitedNode>;
  directEvidence?: AssetDirectEvidence | undefined;
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
  ...trustworthy(input.reviews),
];

const mergeRecords = <T>(
  primary: readonly T[],
  retained: readonly T[],
  keyFor: (record: T) => string,
): T[] => {
  const records = new Map(primary.map((record) => [keyFor(record), record]));
  for (const record of retained) {
    const key = keyFor(record);
    if (!records.has(key)) records.set(key, record);
  }
  return [...records.values()];
};

const rebuildAsset = (asset: AssetProjection, input: ForwardRelations): AssetProjection => {
  const observedCitations =
    input.directEvidence?.citations
      .filter((citation) => citation.assetId === asset.id)
      .map(({ assetId, note, citingReference, source }) => ({
        assetId,
        note,
        citingReference,
        source,
      })) ??
    citedNodes(input).flatMap((node) =>
      node.citations
        .filter((citation) => citation.assetId === asset.id)
        .map((citation) => ({
          ...citation,
          citingReference: node.id,
          source: node.source,
        })),
    );
  const citations = mergeRecords(
    observedCitations,
    input.directEvidence === undefined &&
      [input.roadmaps, input.gates, input.efforts, input.authorities, input.reviews].some(
        (collection) => collection.validity !== "available",
      )
      ? asset.citations
      : [],
    (citation) => `${citation.citingReference}\0${citation.note}\0${citation.source}`,
  ).sort((left, right) => {
    const byReference = compareUtf8(left.citingReference, right.citingReference);
    return byReference === 0 ? compareUtf8(left.note, right.note) : byReference;
  });
  const observedBaselines =
    input.directEvidence?.authorityBaselines
      .filter((baseline) => baseline.assetId === asset.id)
      .map(({ authorityId, source }) => ({ authorityId, source })) ??
    trustworthy(input.authorities).flatMap((authority) =>
      authority.baselineAssetIds.includes(asset.id)
        ? [{ authorityId: authority.id, source: authority.source }]
        : [],
    );
  const authorityBaselines = mergeRecords(
    observedBaselines,
    input.directEvidence === undefined && input.authorities.validity !== "available"
      ? asset.authorityBaselines
      : [],
    (baseline) => baseline.authorityId,
  ).sort((left, right) => compareUtf8(left.authorityId, right.authorityId));
  return assetProjectionSchema.parse({ ...asset, citations, authorityBaselines });
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
