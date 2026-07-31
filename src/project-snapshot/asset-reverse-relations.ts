import type { AssetDirectEvidence } from "./asset-direct-evidence";
import { deriveAssetEvidenceRoles } from "./asset-evidence-roles";
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
    adoptions: readonly Readonly<{ assetId: string; decisionReference: string }>[];
  }>;
type ForwardRelations = Readonly<{
  roadmaps: Collection<CitedNode>;
  gates: Collection<Gate>;
  efforts: Collection<CitedNode>;
  authorities: Collection<Authority>;
  checks: Collection<CitedNode>;
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
  ...trustworthy(input.checks),
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
      [
        input.roadmaps,
        input.gates,
        input.efforts,
        input.authorities,
        input.checks,
        input.reviews,
      ].some((collection) => collection.validity !== "available")
      ? asset.citations
      : [],
    (citation) => `${citation.citingReference}\0${citation.note}\0${citation.source}`,
  ).sort((left, right) => {
    const byReference = compareUtf8(left.citingReference, right.citingReference);
    return byReference === 0 ? compareUtf8(left.note, right.note) : byReference;
  });
  const observedAdoptions =
    input.directEvidence?.authorityAdoptions
      .filter((adoption) => adoption.assetId === asset.id)
      .map(({ authorityId, decisionReference, source }) => ({
        authorityId,
        decisionReference,
        source,
      })) ??
    trustworthy(input.authorities).flatMap((authority) =>
      authority.adoptions
        .filter((adoption) => adoption.assetId === asset.id)
        .map((adoption) => ({
          authorityId: authority.id,
          decisionReference: adoption.decisionReference,
          source: authority.source,
        })),
    );
  const authorityAdoptions = mergeRecords(
    observedAdoptions,
    input.directEvidence === undefined && input.authorities.validity !== "available"
      ? asset.authorityAdoptions
      : [],
    (adoption) => adoption.authorityId,
  ).sort((left, right) => compareUtf8(left.authorityId, right.authorityId));
  const observedPassageEvidence =
    input.directEvidence?.passageEvidence
      .filter((evidence) => evidence.assetId === asset.id)
      .map(({ gateId, source }) => ({ gateId, source })) ??
    trustworthy(input.gates)
      .filter((gate) => gate.passage?.evidenceAssetIds.includes(asset.id) === true)
      .map((gate) => ({ gateId: gate.id, source: gate.source }));
  const passageEvidence = mergeRecords(
    observedPassageEvidence,
    input.directEvidence === undefined && input.gates.validity !== "available"
      ? asset.passageEvidence
      : [],
    (evidence) => evidence.gateId,
  ).sort((left, right) => compareUtf8(left.gateId, right.gateId));
  const evidenceRoles = deriveAssetEvidenceRoles({
    ...asset,
    citations,
    authorityAdoptions,
    passageEvidence,
  });
  return assetProjectionSchema.parse({
    ...asset,
    evidenceRoles,
    citations,
    authorityAdoptions,
    passageEvidence,
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
