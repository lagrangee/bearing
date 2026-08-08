import type { RefinementCtx } from "zod";
import { expectedBearingType } from "../artifact-model";
import { type AssetEvidenceRole, deriveAssetEvidenceRoles } from "./asset-evidence-roles";

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
type Authority = CitedNode &
  Readonly<{
    id: string;
    baselineAssetIds: readonly string[];
    adoptions: readonly Readonly<{ assetId: string; decisionReference: string }>[];
  }>;
type ReverseAuthorityAdoption = Readonly<{
  authorityId: string;
  decisionReference: string;
  source: string;
}>;
type ReversePassageEvidence = Readonly<{ gateId: string; source: string }>;
type Asset = Readonly<{
  id: string;
  kind: string;
  evidenceRoles: readonly AssetEvidenceRole[];
  citations: readonly ReverseCitation[];
  authorityAdoptions: readonly ReverseAuthorityAdoption[];
  passageEvidence: readonly ReversePassageEvidence[];
  supersededBy?: string | undefined;
}>;
export type AssetConsistencySnapshot = Readonly<{
  roadmaps: Collection<CitedNode>;
  gates: Collection<Gate>;
  efforts: Collection<CitedNode>;
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
type CitedCollectionName = "roadmaps" | "gates" | "efforts" | "authorities" | "reviews";
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
  ["reviews", snapshot.reviews],
];
const addIssue = (context: RefinementCtx, path: readonly (string | number)[], message: string) =>
  context.addIssue({ code: "custom", path: [...path], message });
const canonicalRoleFor = (
  reference: string,
): Readonly<{ role: string; type: string }> | undefined => {
  if (reference.startsWith("roadmap:")) return { role: "roadmap", type: "roadmap" };
  if (reference.startsWith("gate:")) return { role: "milestone-gate", type: "milestone-gate" };
  if (reference.startsWith("effort:")) return { role: "effort", type: "effort" };
  if (reference.startsWith("authority:")) return { role: "authority", type: "authority" };
  if (reference.startsWith("planning-review:")) {
    return { role: "planning-review", type: "planning-review" };
  }
  return undefined;
};
const validateDirectEvidenceSource = (
  snapshot: AssetConsistencySnapshot,
  reference: string,
  sourceReference: string,
  path: readonly (string | number)[],
  context: RefinementCtx,
): void => {
  const expected = canonicalRoleFor(reference);
  const source = snapshot.sources.find((candidate) => candidate.reference === sourceReference);
  if (
    expected === undefined ||
    source === undefined ||
    source.kind !== "canonical" ||
    source.binding?.role !== expected.role ||
    source.binding.identity !== reference ||
    expectedBearingType(source.displayLocator) !== expected.type
  ) {
    addIssue(
      context,
      path,
      "Direct Asset evidence Source provenance must match its typed canonical target.",
    );
  }
};
const citationKey = (citation: ReverseCitation): string =>
  JSON.stringify([citation.assetId, citation.note, citation.citingReference, citation.source]);
const recordCounts = <T>(
  values: readonly T[],
  keyFor: (value: T) => string,
): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const value of values) {
    const key = keyFor(value);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
};
const sameRecords = <T>(
  actual: readonly T[],
  expected: readonly T[],
  keyFor: (value: T) => string,
): boolean => {
  if (actual.length !== expected.length) return false;
  const actualCounts = recordCounts(actual, keyFor);
  for (const [key, count] of recordCounts(expected, keyFor)) {
    if ((actualCounts.get(key) ?? 0) < count) return false;
  }
  return true;
};
const containsRecords = <T>(
  actual: readonly T[],
  expected: readonly T[],
  keyFor: (value: T) => string,
): boolean => {
  const actualCounts = recordCounts(actual, keyFor);
  for (const [key, count] of recordCounts(expected, keyFor)) {
    if ((actualCounts.get(key) ?? 0) < count) return false;
  }
  return true;
};
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
  const expected = expectedCitations(snapshot, asset.id);
  const coverageComplete = citedCollections(snapshot).every(([, collection]) =>
    complete(collection),
  );
  if (
    coverageComplete
      ? !sameRecords(asset.citations, expected, citationKey)
      : !containsRecords(asset.citations, expected, citationKey)
  ) {
    addIssue(
      context,
      ["assets", "items", position, "citations"],
      coverageComplete
        ? "Asset Citations must exactly match trustworthy planning Citation relations."
        : "Asset Citations must retain every trustworthy planning Citation relation under partial coverage.",
    );
  }
};
const validateReverseRecords = <T>(
  actual: readonly T[],
  expected: readonly T[],
  keyFor: (value: T) => string,
  path: readonly (string | number)[],
  label: string,
  coverageComplete: boolean,
  context: RefinementCtx,
): void => {
  if (
    coverageComplete
      ? !sameRecords(actual, expected, keyFor)
      : !containsRecords(actual, expected, keyFor)
  ) {
    addIssue(
      context,
      path,
      coverageComplete
        ? `Asset ${label} must exactly match trustworthy forward relations.`
        : `Asset ${label} must retain every trustworthy forward relation under partial coverage.`,
    );
  }
};
const validateReverseRelations = (
  snapshot: AssetConsistencySnapshot,
  context: RefinementCtx,
): void => {
  const authorities = trusted(snapshot.authorities);
  const gates = trusted(snapshot.gates);
  for (const [position, asset] of trusted(snapshot.assets).entries()) {
    for (const [citationPosition, citation] of asset.citations.entries()) {
      validateDirectEvidenceSource(
        snapshot,
        citation.citingReference,
        citation.source,
        ["assets", "items", position, "citations", citationPosition, "source"],
        context,
      );
    }
    for (const [adoptionPosition, adoption] of asset.authorityAdoptions.entries()) {
      validateDirectEvidenceSource(
        snapshot,
        adoption.authorityId,
        adoption.source,
        ["assets", "items", position, "authorityAdoptions", adoptionPosition, "source"],
        context,
      );
    }
    for (const [passagePosition, evidence] of asset.passageEvidence.entries()) {
      validateDirectEvidenceSource(
        snapshot,
        evidence.gateId,
        evidence.source,
        ["assets", "items", position, "passageEvidence", passagePosition, "source"],
        context,
      );
    }
    validateAssetCitations(snapshot, asset, position, context);
    const adoptions = authorities.flatMap((authority) =>
      authority.adoptions
        .filter((adoption) => adoption.assetId === asset.id)
        .map((adoption) => ({
          authorityId: authority.id,
          decisionReference: adoption.decisionReference,
          source: authority.source,
        })),
    );
    const passageEvidence = gates
      .filter((gate) => gate.passage?.evidenceAssetIds.includes(asset.id) === true)
      .map((gate) => ({ gateId: gate.id, source: gate.source }));
    validateReverseRecords(
      asset.authorityAdoptions,
      adoptions,
      (adoption) =>
        JSON.stringify([adoption.authorityId, adoption.decisionReference, adoption.source]),
      ["assets", "items", position, "authorityAdoptions"],
      "Authority Adoption cache",
      complete(snapshot.authorities),
      context,
    );
    validateReverseRecords(
      asset.passageEvidence,
      passageEvidence,
      (evidence) => JSON.stringify([evidence.gateId, evidence.source]),
      ["assets", "items", position, "passageEvidence"],
      "Gate Passage Evidence cache",
      complete(snapshot.gates),
      context,
    );
    const expectedRoles = deriveAssetEvidenceRoles(asset);
    if (
      asset.evidenceRoles.length !== expectedRoles.length ||
      asset.evidenceRoles.some((role, index) => role !== expectedRoles[index])
    ) {
      addIssue(
        context,
        ["assets", "items", position, "evidenceRoles"],
        "Asset Evidence Roles must exactly match trustworthy direct evidence relations.",
      );
    }
  }
};
export const validateAssetConsistency = (
  snapshot: AssetConsistencySnapshot,
  context: RefinementCtx,
): void => {
  validateForwardReferences(snapshot, context);
  validateReverseRelations(snapshot, context);
};
