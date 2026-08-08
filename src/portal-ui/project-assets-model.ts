import type { AssetProjection, SourceRecord } from "../project-snapshot/contract";
import {
  ASSET_EVIDENCE_FILTERS,
  type AssetEvidenceFilter,
  type AssetEvidenceFilterCoverageBasis,
  assetEvidenceFilterContract,
} from "./asset-evidence-filter";
import { semanticTitleForPlanningReference } from "./planning-reference-title";
import type { AssetsModelData } from "./project-data";

export type AssetEvidenceFilterCoverage = "complete" | "incomplete";

export type ProjectAssetRow = Readonly<{
  asset: AssetProjection;
  ownerTitle: string;
  authorityAdoptions: readonly Readonly<{
    id: string;
    decisionReference: string;
    source: SourceRecord | undefined;
    available: boolean;
  }>[];
  authorityBaselines: readonly Readonly<{ id: string; available: boolean }>[];
  citationRelations: readonly Readonly<{
    citation: AssetProjection["citations"][number];
    source: SourceRecord | undefined;
  }>[];
  gatePassages: readonly Readonly<{
    id: string;
    source: SourceRecord | undefined;
    available: boolean;
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
    asset.kind,
    ownerTitle,
    asset.lifecycleSource,
    asset.disposition,
    asset.producedFor,
    ...asset.evidenceRoles,
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
  const authorityIds = new Set(
    snapshot.authorities.validity === "invalid"
      ? []
      : snapshot.authorities.items.map((authority) => String(authority.id)),
  );
  const gateIds = new Set(
    snapshot.gates.validity === "invalid"
      ? []
      : snapshot.gates.items.map((gate) => String(gate.id)),
  );
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
      authorityAdoptions: asset.authorityAdoptions.map((adoption) => ({
        id: String(adoption.authorityId),
        decisionReference: adoption.decisionReference,
        source: sources.get(adoption.source),
        available: authorityIds.has(adoption.authorityId),
      })),
      authorityBaselines,
      citationRelations: asset.citations.map((citation, index) => ({
        citation,
        source: citationSources[index],
      })),
      gatePassages: asset.passageEvidence.map((evidence) => ({
        id: String(evidence.gateId),
        source: sources.get(evidence.source),
        available: gateIds.has(evidence.gateId),
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
    gates: snapshot.gates.validity === "available" ? "complete" : "incomplete",
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
  evidenceFilter: AssetEvidenceFilter,
  filterCoverage: AssetEvidenceFilterCoverage,
): readonly ProjectAssetRow[] => {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const match = assetEvidenceFilterContract(evidenceFilter).match;
  return rows.filter((row) => {
    const evidenceMatch =
      match === "all" ||
      (match === "execution-evidence"
        ? row.asset.evidenceRoles.includes("execution-evidence")
        : match === "planning-citation"
          ? row.asset.evidenceRoles.includes("planning-citation")
          : match === "authority-baseline"
            ? row.authorityBaselines.length > 0
            : match === "passage-evidence"
              ? row.asset.evidenceRoles.includes("passage-evidence")
              : filterCoverage === "complete" && row.asset.citations.length === 0);
    return evidenceMatch && (normalizedQuery === "" || row.searchValue.includes(normalizedQuery));
  });
};
