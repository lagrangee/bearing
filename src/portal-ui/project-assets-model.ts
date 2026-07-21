import type { AssetProjection, ProjectSnapshot, SourceRecord } from "../project-snapshot/contract";
import type { ProjectInspectorSelection } from "./project-inspector";

export type AssetCitationFilter = "all" | "cited" | "uncited";

export type ProjectAssetRow = Readonly<{
  asset: AssetProjection;
  authorityAdoptions: readonly Readonly<{ id: string; available: boolean }>[];
  citationRelations: readonly Readonly<{
    citation: AssetProjection["citations"][number];
    source: SourceRecord | undefined;
  }>[];
  gatePassages: readonly Readonly<{ id: string; available: boolean }>[];
  searchValue: string;
  source: SourceRecord | undefined;
}>;

export type ProjectAssetsModel =
  | Readonly<{ state: "available"; rows: readonly ProjectAssetRow[] }>
  | Readonly<{ state: "partial"; issueCount: number; rows: readonly ProjectAssetRow[] }>
  | Readonly<{ state: "invalid"; issueCount: number; rows: readonly [] }>;

const wordsFor = (
  asset: AssetProjection,
  citationSources: readonly (SourceRecord | undefined)[],
): string =>
  [
    asset.id,
    asset.title,
    asset.kind,
    asset.owner,
    asset.producer.kind,
    asset.producer.name,
    asset.producer.reference,
    asset.lifecycleSource,
    asset.disposition,
    asset.supersededBy,
    asset.producedFor,
    asset.displayLocation,
    asset.contentAvailability,
    ...asset.adoptedByAuthorityIds,
    ...asset.gatePassageEvidenceFor,
    ...asset.citations.flatMap((citation) => [
      citation.citingReference,
      citation.source,
      citation.note,
    ]),
    ...citationSources.map((source) => source?.displayLocator),
  ]
    .filter((value): value is string => value !== undefined)
    .join(" ")
    .toLocaleLowerCase();

export const buildProjectAssetsModel = (snapshot: ProjectSnapshot): ProjectAssetsModel => {
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
    const citationSources = asset.citations.map((citation) => sources.get(citation.source));
    return {
      asset,
      authorityAdoptions: asset.adoptedByAuthorityIds.map((id) => ({
        id: String(id),
        available: authorityIds.has(id),
      })),
      citationRelations: asset.citations.map((citation, index) => ({
        citation,
        source: citationSources[index],
      })),
      gatePassages: asset.gatePassageEvidenceFor.map((id) => ({
        id: String(id),
        available: gateIds.has(id),
      })),
      searchValue: wordsFor(asset, citationSources),
      source: sources.get(asset.source),
    };
  });
  return snapshot.assets.validity === "partial"
    ? { state: "partial", issueCount: snapshot.assets.issues.length, rows }
    : { state: "available", rows };
};

export const filterAssetRows = (
  rows: readonly ProjectAssetRow[],
  query: string,
  citationFilter: AssetCitationFilter,
): readonly ProjectAssetRow[] => {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  return rows.filter((row) => {
    const citationMatch =
      citationFilter === "all" ||
      (citationFilter === "cited" ? row.asset.citationCount > 0 : row.asset.citationCount === 0);
    return citationMatch && (normalizedQuery === "" || row.searchValue.includes(normalizedQuery));
  });
};

const titleCase = (value: string): string => `${value[0]?.toUpperCase()}${value.slice(1)}`;

const relationSection = (
  title: string,
  items: readonly string[],
  emptyBody: string,
  relationBody: string,
): NonNullable<ProjectInspectorSelection["sections"]>[number] =>
  items.length === 0 ? { title, body: emptyBody } : { title, body: relationBody, items };

const relationLabel = (relation: Readonly<{ id: string; available: boolean }>): string =>
  relation.available ? relation.id : `${relation.id} · unavailable in the current Snapshot`;

export const assetInspection = (row: ProjectAssetRow): ProjectInspectorSelection => {
  const asset = row.asset;
  const producer = `${asset.producer.kind} · ${asset.producer.name}`;
  const citations = row.citationRelations.map(({ citation, source }) =>
    source === undefined
      ? `${citation.citingReference} · locator unavailable · Source ${citation.source} — ${citation.note}`
      : `${citation.citingReference} · ${source.displayLocator} · Source ${citation.source} — ${citation.note}`,
  );
  return {
    eyebrow: "Asset",
    title: asset.title,
    detail: "A registered project artifact whose content remains at its native source location.",
    handoff: true,
    nativeSourceHandoff: true,
    source: row.source,
    facts: [
      { label: "Kind", value: asset.kind },
      { label: "Owner", value: asset.owner, code: true },
      { label: "Producer", value: producer },
      ...(asset.producer.reference === undefined
        ? []
        : [{ label: "Producer ref", value: asset.producer.reference, code: true }]),
      { label: "Lifecycle", value: titleCase(asset.lifecycleSource) },
      { label: "Disposition", value: asset.disposition ?? "Not declared" },
      ...(asset.supersededBy === undefined
        ? []
        : [{ label: "Superseded by", value: asset.supersededBy, code: true }]),
      { label: "Produced for", value: asset.producedFor ?? "Not declared", code: true },
      { label: "Content", value: titleCase(asset.contentAvailability) },
      { label: "Citations", value: String(asset.citationCount) },
      { label: "Stable ID", value: asset.id, code: true },
      { label: "Location", value: asset.displayLocation, code: true },
    ],
    sections: [
      relationSection(
        "Planning Citations",
        citations,
        "No planning object cites this Asset in the current Snapshot.",
        "Each relation names its citing object, source provenance, and required Note.",
      ),
      relationSection(
        "Authority adoption",
        row.authorityAdoptions.map(relationLabel),
        "Not adopted by a current Authority baseline.",
        "Explicit current-baseline adoption relations; unavailable targets remain visible.",
      ),
      relationSection(
        "Gate Passage evidence",
        row.gatePassages.map(relationLabel),
        "Not used as evidence by a recorded Gate Passage.",
        "Explicit historical Passage evidence relations; unavailable targets remain visible.",
      ),
    ],
  };
};
