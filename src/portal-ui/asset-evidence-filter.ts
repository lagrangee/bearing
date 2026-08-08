export const ASSET_EVIDENCE_FILTERS = [
  {
    value: "all",
    label: "All Assets",
    match: "all",
    coverageBasis: "asset-record",
    incompleteSubject: "Asset registry",
    incompleteStatus: "Results include confirmed Assets only and cannot confirm an empty set.",
    incompleteEmpty: "Unavailable Asset coverage prevents a complete result.",
  },
  {
    value: "cited",
    label: "Cited",
    match: "planning-citation",
    coverageBasis: "citation-owners",
    incompleteSubject: "Planning Citation",
    incompleteStatus: "Results include confirmed members only and cannot confirm an empty set.",
    incompleteEmpty: "Unavailable citation-owner coverage prevents a complete citation result.",
  },
  {
    value: "authority-baselines",
    label: "Authority baselines",
    match: "authority-baseline",
    coverageBasis: "authorities",
    incompleteSubject: "Authority baseline",
    incompleteStatus: "Results include confirmed members only and cannot confirm an empty set.",
    incompleteEmpty: "Unavailable Authority coverage prevents a complete baseline result.",
  },
  {
    value: "uncited",
    label: "Uncited",
    match: "uncited",
    coverageBasis: "citation-owners",
    incompleteSubject: "Planning Citation",
    incompleteStatus:
      "No Asset can be confirmed uncited until every citation-owning collection is available.",
    incompleteEmpty: "Unavailable citation-owner coverage prevents a complete citation result.",
  },
] as const;

export type AssetEvidenceFilter = (typeof ASSET_EVIDENCE_FILTERS)[number]["value"];
export type AssetEvidenceFilterContract = (typeof ASSET_EVIDENCE_FILTERS)[number];
export type AssetEvidenceFilterCoverageBasis = AssetEvidenceFilterContract["coverageBasis"];

const assetEvidenceFilterValues = new Set<string>(
  ASSET_EVIDENCE_FILTERS.map((filter) => filter.value),
);

export const isAssetEvidenceFilter = (value: unknown): value is AssetEvidenceFilter =>
  typeof value === "string" && assetEvidenceFilterValues.has(value);

export const assetEvidenceFilterContract = (
  value: AssetEvidenceFilter,
): AssetEvidenceFilterContract => {
  const contract = ASSET_EVIDENCE_FILTERS.find((filter) => filter.value === value);
  if (contract === undefined) throw new Error(`Unknown Asset Evidence filter: ${value}`);
  return contract;
};
