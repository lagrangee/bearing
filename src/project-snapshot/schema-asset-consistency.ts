import type { RefinementCtx } from "zod";

type Collection<T> =
  | Readonly<{ validity: "available" | "partial"; items: readonly T[] }>
  | Readonly<{ validity: "invalid" }>;
type Citation = Readonly<{ assetId: string; note: string }>;
type ReverseCitation = Citation & Readonly<{ citingReference: string; source: string }>;
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
type Authority = CitedNode & Readonly<{ id: string; baselineAssetIds: readonly string[] }>;
type Asset = Readonly<{
  id: string;
  citations: readonly ReverseCitation[];
  supersededBy?: string | undefined;
  adoptedByAuthorityIds: readonly string[];
  gatePassageEvidenceFor: readonly string[];
  citationCount: number;
}>;
export type AssetConsistencySnapshot = Readonly<{
  roadmaps: Collection<CitedNode>;
  gates: Collection<Gate>;
  efforts: Collection<CitedNode>;
  authorities: Collection<Authority>;
  assets: Collection<Asset>;
  checks: Collection<CitedNode>;
  reviews: Collection<CitedNode>;
}>;
type CitedCollectionName = "roadmaps" | "gates" | "efforts" | "authorities" | "checks" | "reviews";
type CitedCollection = readonly [CitedCollectionName, Collection<CitedNode>];
const trusted = <T>(collection: Collection<T>): readonly T[] =>
  collection.validity === "invalid" ? [] : collection.items;
const complete = <T>(collection: Collection<T>): boolean => collection.validity === "available";
const byId = <T extends Readonly<{ id: string }>>(items: readonly T[]): Map<string, T> =>
  new Map(items.map((item) => [item.id, item]));
const citedCollections = (snapshot: AssetConsistencySnapshot): readonly CitedCollection[] => [
  ["roadmaps", snapshot.roadmaps],
  ["gates", snapshot.gates],
  ["efforts", snapshot.efforts],
  ["authorities", snapshot.authorities],
  ["checks", snapshot.checks],
  ["reviews", snapshot.reviews],
];
const addIssue = (context: RefinementCtx, path: readonly (string | number)[], message: string) =>
  context.addIssue({ code: "custom", path: [...path], message });
const sameSet = (actual: readonly string[], expected: readonly string[]): boolean => {
  const actualSet = new Set(actual);
  const expectedSet = new Set(expected);
  return (
    actual.length === actualSet.size &&
    expected.length === expectedSet.size &&
    actualSet.size === expectedSet.size &&
    actual.every((value) => expectedSet.has(value)) &&
    expected.every((value) => actualSet.has(value))
  );
};
const citationKey = (citation: ReverseCitation): string =>
  JSON.stringify([citation.assetId, citation.note, citation.citingReference, citation.source]);
const citationCounts = (citations: readonly ReverseCitation[]): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const citation of citations) {
    const key = citationKey(citation);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
};
const containsCitations = (
  actual: readonly ReverseCitation[],
  expected: readonly ReverseCitation[],
): boolean => {
  const actualCounts = citationCounts(actual);
  for (const [key, count] of citationCounts(expected)) {
    if ((actualCounts.get(key) ?? 0) < count) return false;
  }
  return true;
};
const sameCitations = (
  actual: readonly ReverseCitation[],
  expected: readonly ReverseCitation[],
): boolean => actual.length === expected.length && containsCitations(actual, expected);
const validateForwardReferences = (
  snapshot: AssetConsistencySnapshot,
  context: RefinementCtx,
): void => {
  if (!complete(snapshot.assets)) return;
  const assets = byId(trusted(snapshot.assets));
  for (const [position, asset] of trusted(snapshot.assets).entries()) {
    if (asset.supersededBy !== undefined && !assets.has(asset.supersededBy)) {
      addIssue(
        context,
        ["assets", "items", position, "supersededBy"],
        "Every replacement in a complete Asset projection must resolve.",
      );
    }
    const seen = new Set([asset.id]);
    let replacement = asset.supersededBy;
    while (replacement !== undefined && assets.has(replacement)) {
      if (seen.has(replacement)) {
        addIssue(
          context,
          ["assets", "items", position, "supersededBy"],
          "Asset supersession cannot form a cycle.",
        );
        break;
      }
      seen.add(replacement);
      replacement = assets.get(replacement)?.supersededBy;
    }
  }
  for (const [collectionName, collection] of citedCollections(snapshot)) {
    for (const [nodePosition, node] of trusted(collection).entries()) {
      for (const [citationPosition, citation] of node.citations.entries()) {
        if (!assets.has(citation.assetId)) {
          addIssue(
            context,
            [collectionName, "items", nodePosition, "citations", citationPosition, "assetId"],
            "Every Citation in a complete Asset projection must resolve.",
          );
        }
      }
    }
  }
  for (const [position, authority] of trusted(snapshot.authorities).entries()) {
    for (const [assetPosition, assetId] of authority.baselineAssetIds.entries()) {
      if (!assets.has(assetId)) {
        addIssue(
          context,
          ["authorities", "items", position, "baselineAssetIds", assetPosition],
          "Every Authority baseline in a complete Asset projection must resolve.",
        );
      }
    }
  }
  for (const [position, gate] of trusted(snapshot.gates).entries()) {
    for (const [assetPosition, assetId] of (gate.passage?.evidenceAssetIds ?? []).entries()) {
      if (!assets.has(assetId)) {
        addIssue(
          context,
          ["gates", "items", position, "passage", "evidenceAssetIds", assetPosition],
          "Every Gate Passage evidence reference in a complete Asset projection must resolve.",
        );
      }
    }
  }
};
const expectedCitations = (
  snapshot: AssetConsistencySnapshot,
  assetId: string,
): readonly ReverseCitation[] =>
  citedCollections(snapshot).flatMap(([, collection]) =>
    trusted(collection).flatMap((node) =>
      node.citations
        .filter((citation) => citation.assetId === assetId)
        .map((citation) => ({
          ...citation,
          citingReference: node.id,
          source: node.source,
        })),
    ),
  );
const validateAssetCitations = (
  snapshot: AssetConsistencySnapshot,
  asset: Asset,
  position: number,
  context: RefinementCtx,
): void => {
  if (asset.citations.some((citation) => citation.assetId !== asset.id)) {
    addIssue(
      context,
      ["assets", "items", position, "citations"],
      "An Asset reverse Citation cache can contain only its own Asset ID.",
    );
  }
  if (asset.citationCount !== asset.citations.length) {
    addIssue(
      context,
      ["assets", "items", position, "citationCount"],
      "Asset citationCount must exactly match its reverse Citation cache.",
    );
  }
  const expected = expectedCitations(snapshot, asset.id);
  if (!sameCitations(asset.citations, expected)) {
    addIssue(
      context,
      ["assets", "items", position, "citations"],
      "Asset Citations must exactly match trustworthy planning Citation relations.",
    );
  }
};
const validateReverseIds = (
  actual: readonly string[],
  expected: readonly string[],
  path: readonly (string | number)[],
  label: string,
  context: RefinementCtx,
): void => {
  if (!sameSet(actual, expected)) {
    addIssue(context, path, `Asset ${label} must exactly match trustworthy forward relations.`);
  }
};
const validateReverseRelations = (
  snapshot: AssetConsistencySnapshot,
  context: RefinementCtx,
): void => {
  const authorities = trusted(snapshot.authorities);
  const gates = trusted(snapshot.gates);
  for (const [position, asset] of trusted(snapshot.assets).entries()) {
    validateAssetCitations(snapshot, asset, position, context);
    const adoptedBy = authorities
      .filter((authority) => authority.baselineAssetIds.includes(asset.id))
      .map((authority) => authority.id);
    const passageFor = gates
      .filter((gate) => gate.passage?.evidenceAssetIds.includes(asset.id) === true)
      .map((gate) => gate.id);
    validateReverseIds(
      asset.adoptedByAuthorityIds,
      adoptedBy,
      ["assets", "items", position, "adoptedByAuthorityIds"],
      "Authority adoption cache",
      context,
    );
    validateReverseIds(
      asset.gatePassageEvidenceFor,
      passageFor,
      ["assets", "items", position, "gatePassageEvidenceFor"],
      "Gate Passage cache",
      context,
    );
  }
};
export const validateAssetConsistency = (
  snapshot: AssetConsistencySnapshot,
  context: RefinementCtx,
): void => {
  validateForwardReferences(snapshot, context);
  validateReverseRelations(snapshot, context);
};
