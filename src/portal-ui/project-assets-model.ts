import type { AssetProjection, ProjectSnapshot, SourceRecord } from "../project-snapshot/contract";
import {
  ASSET_EVIDENCE_FILTERS,
  type AssetEvidenceFilter,
  type AssetEvidenceFilterCoverageBasis,
  assetEvidenceFilterContract,
} from "./asset-evidence-filter";
import { assetEvidenceRoleLabel } from "./asset-evidence-role-label";
import type { ProjectInspectorSelection } from "./project-inspector";

export type AssetEvidenceFilterCoverage = "complete" | "incomplete";

export type ProjectAssetRow = Readonly<{
  asset: AssetProjection;
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
    ...asset.evidenceRoles,
    ...asset.authorityAdoptions.flatMap((adoption) => [
      adoption.authorityId,
      adoption.decisionReference,
      adoption.source,
    ]),
    ...asset.passageEvidence.flatMap((evidence) => [evidence.gateId, evidence.source]),
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
      searchValue: wordsFor(asset, citationSources),
      source: sources.get(asset.source),
    };
  });
  const citationCoverage = [
    snapshot.roadmaps,
    snapshot.gates,
    snapshot.efforts,
    snapshot.authorities,
    snapshot.checks,
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
    copy: { label: "Copy Asset Location", value: asset.displayLocation },
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
      { label: "Citations", value: String(asset.citations.length) },
      { label: "Stable ID", value: asset.id, code: true },
      { label: "Location", value: asset.displayLocation, code: true },
    ],
    sections: [
      relationSection(
        "Evidence Roles",
        asset.evidenceRoles.map(assetEvidenceRoleLabel),
        "No explicit Evidence role is recorded.",
        "Only explicit direct evidence facts create these independent, coexisting roles.",
      ),
      relationSection(
        "Planning Citations",
        citations,
        "No planning object cites this Asset in the current Snapshot.",
        "Each relation names its citing object, source provenance, and required Note.",
      ),
      relationSection(
        "Authority adoption",
        row.authorityAdoptions.map(
          (relation) =>
            `${relationLabel(relation)} · Decision ${relation.decisionReference} · Source ${
              relation.source?.displayLocator ?? "unavailable"
            }`,
        ),
        "No explicit Authority Adoption is recorded.",
        "Explicit Adoption relations preserve their direct Authority, accepted decision, and native source provenance.",
      ),
      relationSection(
        "Gate Passage evidence",
        row.gatePassages.map(
          (relation) =>
            `${relationLabel(relation)} · Source ${
              relation.source?.displayLocator ?? "unavailable"
            }`,
        ),
        "Not used as evidence by a recorded Gate Passage.",
        "Explicit historical Passage evidence relations preserve their direct Gate and native source provenance.",
      ),
      relationSection(
        "Authority baselines",
        row.authorityBaselines.map(relationLabel),
        "Not present in a current Authority baseline.",
        "Baseline membership is collection context and does not create an Authority Adoption Evidence role.",
      ),
      relationSection(
        "Execution Evidence provenance",
        asset.evidenceRoles.includes("execution-evidence")
          ? [
              `Produced for ${asset.producedFor ?? "unavailable"} · Producer ${asset.producer.kind} / ${asset.producer.name}${
                asset.producer.reference === undefined
                  ? ""
                  : ` · Reference ${asset.producer.reference}`
              }`,
            ]
          : [],
        "This Asset is not explicit Execution Evidence.",
        "Execution Evidence preserves its direct Produced For target and producer provenance.",
      ),
    ],
  };
};
