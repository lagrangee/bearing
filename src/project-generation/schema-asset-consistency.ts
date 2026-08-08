import type { RefinementCtx } from "zod";
import { expectedBearingType } from "../artifact-model";

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
type Effort = CitedNode & Readonly<{ lifecycle: "planned" | "active" | "concluded" }>;
type Authority = CitedNode &
  Readonly<{
    id: string;
    baselineAssetIds: readonly string[];
  }>;
type Asset = Readonly<{
  id: string;
  owner: string;
  disposition: "active" | "superseded" | "archived";
  citations: readonly ReverseCitation[];
  authorityBaselines: readonly Readonly<{ authorityId: string; source: string }>[];
  supersededBy?: string | undefined;
}>;
export type AssetConsistencySnapshot = Readonly<{
  roadmaps: Collection<CitedNode>;
  gates: Collection<CitedNode>;
  efforts: Collection<Effort>;
  authorities: Collection<Authority>;
  assets: Collection<Asset>;
  reviews: Collection<CitedNode>;
  sources: readonly Readonly<{
    reference: string;
    kind: string;
    displayLocator: string;
    binding?: Readonly<{ role: string; identity: string }> | undefined;
  }>[];
}>;

const trusted = <T>(collection: Collection<T>): readonly T[] =>
  collection.validity === "invalid" ? [] : collection.items;
const complete = <T>(collection: Collection<T>): boolean => collection.validity === "available";
const addIssue = (context: RefinementCtx, path: readonly (string | number)[], message: string) =>
  context.addIssue({ code: "custom", path: [...path], message });
const citedCollections = (snapshot: AssetConsistencySnapshot) =>
  [
    snapshot.roadmaps,
    snapshot.gates,
    snapshot.efforts,
    snapshot.authorities,
    snapshot.reviews,
  ] as const;

const validateSource = (
  snapshot: AssetConsistencySnapshot,
  reference: string,
  sourceReference: string,
  path: readonly (string | number)[],
  context: RefinementCtx,
): void => {
  const role = reference.startsWith("roadmap:")
    ? "roadmap"
    : reference.startsWith("gate:")
      ? "milestone-gate"
      : reference.startsWith("effort:")
        ? "effort"
        : reference.startsWith("authority:")
          ? "authority"
          : reference.startsWith("planning-review:")
            ? "planning-review"
            : undefined;
  const source = snapshot.sources.find((candidate) => candidate.reference === sourceReference);
  if (
    role === undefined ||
    source === undefined ||
    source.kind !== "canonical" ||
    source.binding?.role !== role ||
    source.binding.identity !== reference ||
    expectedBearingType(source.displayLocator) !== role
  ) {
    addIssue(context, path, "Direct Asset relation Source must match its canonical owner.");
  }
};

const key = (value: unknown): string => JSON.stringify(value);
const sameRecords = <T>(actual: readonly T[], expected: readonly T[]): boolean => {
  if (actual.length !== expected.length) return false;
  const expectedKeys = new Set(expected.map(key));
  return actual.every((value) => expectedKeys.has(key(value)));
};
const containsRecords = <T>(actual: readonly T[], expected: readonly T[]): boolean => {
  const actualKeys = new Set(actual.map(key));
  return expected.every((value) => actualKeys.has(key(value)));
};

export const validateAssetConsistency = (
  snapshot: AssetConsistencySnapshot,
  context: RefinementCtx,
): void => {
  const assets = new Map(trusted(snapshot.assets).map((asset) => [asset.id, asset]));
  if (complete(snapshot.assets)) {
    for (const [position, asset] of trusted(snapshot.assets).entries()) {
      if (asset.supersededBy !== undefined && !assets.has(asset.supersededBy)) {
        addIssue(
          context,
          ["assets", "items", position, "supersededBy"],
          "Every Asset replacement must resolve.",
        );
      }
      if (
        asset.supersededBy !== undefined &&
        assets.get(asset.supersededBy)?.disposition !== "active"
      ) {
        addIssue(
          context,
          ["assets", "items", position, "supersededBy"],
          "An Asset replacement must be active.",
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
    for (const collection of citedCollections(snapshot)) {
      for (const node of trusted(collection)) {
        for (const citation of node.citations) {
          if (!assets.has(citation.assetId)) {
            addIssue(context, ["assets"], "Every Planning Citation must resolve to an Asset.");
          }
        }
      }
    }
    for (const authority of trusted(snapshot.authorities)) {
      for (const assetId of authority.baselineAssetIds) {
        if (!assets.has(assetId)) {
          addIssue(context, ["assets"], "Every Authority baseline must resolve to an Asset.");
        }
      }
    }
  }
  for (const [position, asset] of trusted(snapshot.assets).entries()) {
    if (asset.disposition === "active" && asset.owner.startsWith("effort:")) {
      const owner = trusted(snapshot.efforts).find((effort) => effort.id === asset.owner);
      if (owner?.lifecycle === "concluded") {
        addIssue(
          context,
          ["assets", "items", position, "owner"],
          "A concluded Effort cannot own an active Asset; transfer, supersede, or archive it.",
        );
      }
    }
    for (const [citationPosition, citation] of asset.citations.entries()) {
      validateSource(
        snapshot,
        citation.citingReference,
        citation.source,
        ["assets", "items", position, "citations", citationPosition, "source"],
        context,
      );
    }
    for (const [baselinePosition, baseline] of asset.authorityBaselines.entries()) {
      validateSource(
        snapshot,
        baseline.authorityId,
        baseline.source,
        ["assets", "items", position, "authorityBaselines", baselinePosition, "source"],
        context,
      );
    }
    const expectedCitations = citedCollections(snapshot).flatMap((collection) =>
      trusted(collection).flatMap((node) =>
        node.citations
          .filter((citation) => citation.assetId === asset.id)
          .map((citation) => ({
            ...citation,
            citingReference: node.id,
            source: node.source,
          })),
      ),
    );
    const citationCoverage = citedCollections(snapshot).every(complete);
    if (
      citationCoverage
        ? !sameRecords(asset.citations, expectedCitations)
        : !containsRecords(asset.citations, expectedCitations)
    ) {
      addIssue(
        context,
        ["assets", "items", position, "citations"],
        "Asset Citations must match trustworthy Planning Citation owners.",
      );
    }
    const expectedBaselines = trusted(snapshot.authorities).flatMap((authority) =>
      authority.baselineAssetIds.includes(asset.id)
        ? [{ authorityId: authority.id, source: authority.source }]
        : [],
    );
    if (
      complete(snapshot.authorities)
        ? !sameRecords(asset.authorityBaselines, expectedBaselines)
        : !containsRecords(asset.authorityBaselines, expectedBaselines)
    ) {
      addIssue(
        context,
        ["assets", "items", position, "authorityBaselines"],
        "Asset Authority Baselines must match current Authority owners.",
      );
    }
  }
};
