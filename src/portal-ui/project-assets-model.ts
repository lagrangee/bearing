import type { AssetProjection, SourceRecord } from "../project-snapshot/contract";
import {
  ASSET_EVIDENCE_FILTERS,
  type AssetEvidenceFilter,
  type AssetEvidenceFilterCoverageBasis,
  assetEvidenceFilterContract,
} from "./asset-evidence-filter";
import type { AssetStatusFilter } from "./asset-status-filter";
import { semanticTitleForPlanningReference } from "./planning-reference-title";
import type { AssetsModelData } from "./project-data";

export type AssetEvidenceFilterCoverage = "complete" | "incomplete";

export type ProjectAssetRow = Readonly<{
  asset: AssetProjection;
  ownerTitle: string;
  authorityBaselines: readonly Readonly<{ id: string; available: boolean }>[];
  citationRelations: readonly Readonly<{
    citation: AssetProjection["citations"][number];
    source: SourceRecord | undefined;
  }>[];
  searchValue: string;
  source: SourceRecord | undefined;
}>;

export type ProjectAssetsModel =
  | Readonly<{
      state: "available";
      evidenceFilterCoverage: Readonly<Record<AssetEvidenceFilter, AssetEvidenceFilterCoverage>>;
      rows: readonly ProjectAssetRow[];
    }>
  | Readonly<{
      state: "partial";
      evidenceFilterCoverage: Readonly<Record<AssetEvidenceFilter, AssetEvidenceFilterCoverage>>;
      issueCount: number;
      rows: readonly ProjectAssetRow[];
    }>
  | Readonly<{ state: "invalid"; issueCount: number; rows: readonly [] }>;

const wordsFor = (asset: AssetProjection, ownerTitle: string): string =>
  [
    asset.title,
    asset.purpose,
    asset.kind,
    ownerTitle,
    asset.disposition,
    asset.sourceLocator,
    ...asset.citations.map((citation) => citation.note),
  ]
    .filter((value): value is string => value !== undefined)
    .join(" ")
    .toLocaleLowerCase();

export const buildProjectAssetsModel = (snapshot: AssetsModelData): ProjectAssetsModel => {
  if (snapshot.assets.validity === "invalid") {
    return { state: "invalid", issueCount: snapshot.assets.issues.length, rows: [] };
  }
  const sources = new Map(snapshot.sources.map((source) => [source.reference, source]));
  const rows = snapshot.assets.items.map((asset) => {
    const ownerTitle = semanticTitleForPlanningReference(snapshot, asset.owner);
    const citationSources = asset.citations.map((citation) => sources.get(citation.source));
    const authorityBaselines =
      snapshot.authorities.validity === "invalid"
        ? []
        : snapshot.authorities.items
            .filter((authority) => authority.baselineAssetIds.includes(asset.id))
            .map((authority) => ({
              id: String(authority.id),
              available: true,
            }));
    return {
      asset,
      ownerTitle,
      authorityBaselines,
      citationRelations: asset.citations.map((citation, index) => ({
        citation,
        source: citationSources[index],
      })),
      searchValue: wordsFor(asset, ownerTitle),
      source: sources.get(asset.source),
    };
  });
  const citationCoverage = [
    snapshot.roadmaps,
    snapshot.gates,
    snapshot.efforts,
    snapshot.authorities,
    snapshot.reviews,
  ].every((collection) => collection.validity === "available")
    ? "complete"
    : "incomplete";
  const coverageByBasis: Readonly<
    Record<AssetEvidenceFilterCoverageBasis, AssetEvidenceFilterCoverage>
  > = {
    "asset-record": snapshot.assets.validity === "available" ? "complete" : "incomplete",
    "citation-owners": citationCoverage,
    authorities: snapshot.authorities.validity === "available" ? "complete" : "incomplete",
  };
  const evidenceFilterCoverage = Object.fromEntries(
    ASSET_EVIDENCE_FILTERS.map((filter) => [filter.value, coverageByBasis[filter.coverageBasis]]),
  ) as Readonly<Record<AssetEvidenceFilter, AssetEvidenceFilterCoverage>>;
  return snapshot.assets.validity === "partial"
    ? {
        state: "partial",
        evidenceFilterCoverage,
        issueCount: snapshot.assets.issues.length,
        rows,
      }
    : { state: "available", evidenceFilterCoverage, rows };
};

export const filterAssetRows = (
  rows: readonly ProjectAssetRow[],
  query: string,
  statusFilter: AssetStatusFilter,
  evidenceFilter: AssetEvidenceFilter,
  filterCoverage: AssetEvidenceFilterCoverage,
): readonly ProjectAssetRow[] => {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const match = assetEvidenceFilterContract(evidenceFilter).match;
  return rows.filter((row) => {
    const statusMatch =
      statusFilter === "all" ||
      (statusFilter === "current"
        ? row.asset.disposition === "active"
        : statusFilter === "replaced"
          ? row.asset.disposition === "superseded"
          : row.asset.disposition === "archived");
    const evidenceMatch =
      match === "all" ||
      (match === "planning-citation"
        ? row.asset.citations.length > 0
        : match === "authority-baseline"
          ? row.authorityBaselines.length > 0
          : filterCoverage === "complete" && row.asset.citations.length === 0);
    return (
      statusMatch &&
      evidenceMatch &&
      (normalizedQuery === "" || row.searchValue.includes(normalizedQuery))
    );
  });
};
