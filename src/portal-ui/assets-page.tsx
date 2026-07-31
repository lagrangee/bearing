import { useState } from "react";
import { planningLineageSubjectHref } from "../planning-lineage-route";
import type { ProjectSnapshot } from "../project-snapshot/contract";
import {
  ASSET_EVIDENCE_FILTERS,
  type AssetEvidenceFilter,
  assetEvidenceFilterContract,
  isAssetEvidenceFilter,
} from "./asset-evidence-filter";
import { AssetRow } from "./asset-row";
import { assetLifecycleEvents, latestPlanningLineageEvent } from "./planning-lineage-events";
import { Action } from "./primitives";
import { assetInspection, buildProjectAssetsModel, filterAssetRows } from "./project-assets-model";
import { readProjectCanvasHistory, updateAssetCanvasFilters } from "./project-canvas-history";
import type { ProjectInspectorSelection } from "./project-inspector";
import { assetPreviewHref } from "./project-route";

type Inspect = (selection: ProjectInspectorSelection, trigger: HTMLButtonElement) => void;

export function AssetsPage({
  entryId,
  onNavigate,
  onInspect,
  snapshot,
}: {
  readonly entryId: string;
  readonly onNavigate: (href: string) => void;
  readonly onInspect: Inspect;
  readonly snapshot: ProjectSnapshot;
}) {
  const [query, setQuery] = useState(
    () => readProjectCanvasHistory(entryId, "assets")?.assets?.query ?? "",
  );
  const [evidenceFilter, setEvidenceFilter] = useState<AssetEvidenceFilter>(
    () => readProjectCanvasHistory(entryId, "assets")?.assets?.evidenceFilter ?? "all",
  );
  const model = buildProjectAssetsModel(snapshot);
  if (model.state === "invalid") {
    return (
      <div className="page assets-page scoped-state">
        <p className="eyebrow">Project context and evidence</p>
        <h1>Assets unavailable</h1>
        <p>
          The Asset projection cannot be trusted ({model.issueCount} source issue
          {model.issueCount === 1 ? "" : "s"}). Other project destinations remain available.
        </p>
      </div>
    );
  }

  const filterCoverage = model.evidenceFilterCoverage[evidenceFilter];
  const visibleRows = filterAssetRows(model.rows, query, evidenceFilter, filterCoverage);
  const filtering = query.trim() !== "" || evidenceFilter !== "all";
  const filterCoverageIncomplete = filterCoverage === "incomplete";
  const filterContract = assetEvidenceFilterContract(evidenceFilter);
  const partialCopy =
    model.state !== "partial"
      ? undefined
      : model.issueCount === 1
        ? "1 invalid registry entry remains isolated."
        : `${model.issueCount} invalid registry entries remain isolated.`;
  return (
    <div className="page assets-page">
      <header className="list-header assets-header">
        <div>
          <p className="eyebrow">Project context and evidence</p>
          <h1>Assets</h1>
          <p>
            Native material with lifecycle, ownership, provenance, and Planning Citations kept
            visible.
          </p>
        </div>
        <div className="asset-controls">
          <label className="search-field">
            <span>Search</span>
            <input
              onChange={(event) => {
                const next = event.currentTarget.value;
                setQuery(next);
                updateAssetCanvasFilters(entryId, next, evidenceFilter);
              }}
              placeholder="Find an Asset"
              type="search"
              value={query}
            />
          </label>
          <label className="asset-filter-field">
            <span>Evidence</span>
            <select
              onChange={(event) => {
                const next = event.currentTarget.value;
                if (!isAssetEvidenceFilter(next)) return;
                setEvidenceFilter(next);
                updateAssetCanvasFilters(entryId, query, next);
              }}
              value={evidenceFilter}
            >
              {ASSET_EVIDENCE_FILTERS.map((filter) => (
                <option key={filter.value} value={filter.value}>
                  {filter.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </header>
      {model.state === "partial" ? (
        <p className="projection-note" role="status">
          Asset orientation is partial. {partialCopy}
        </p>
      ) : null}
      <p className="asset-result-count" aria-live="polite" role="status">
        Showing {visibleRows.length} of {model.rows.length} registered Assets
        {filterCoverageIncomplete ? " from confirmed evidence facts only" : ""}
      </p>
      {filterCoverageIncomplete ? (
        <p className="projection-note" role="status">
          {filterContract.incompleteSubject} coverage is incomplete.{" "}
          {filterContract.incompleteStatus}
        </p>
      ) : null}
      {model.rows.length === 0 ? (
        <section className="asset-empty">
          <h2>No registered Assets</h2>
          <p>Register durable project context or evidence through the Agent Surface.</p>
        </section>
      ) : visibleRows.length === 0 ? (
        <section className="asset-empty">
          <h2>
            {filterCoverageIncomplete ? "No confirmed matching Assets" : "No matching Assets"}
          </h2>
          <p>
            {filterCoverageIncomplete
              ? filterContract.incompleteEmpty
              : "Change the search or Evidence filter to restore the stable Asset list."}
          </p>
          <Action
            onClick={() => {
              setQuery("");
              setEvidenceFilter("all");
              updateAssetCanvasFilters(entryId, "", "all");
            }}
          >
            Clear filters
          </Action>
        </section>
      ) : (
        <section className="asset-table" aria-label="Registered Assets">
          <div className="asset-table-header" aria-hidden="true">
            <span>Asset</span>
            <span>Owner</span>
            <span>Citations</span>
            <span>Location</span>
          </div>
          {visibleRows.map((row) => {
            const href = planningLineageSubjectHref(entryId, {
              kind: "asset",
              id: row.asset.id,
            });
            return (
              <AssetRow
                citations={row.asset.citations.length}
                contentAvailability={row.asset.contentAvailability}
                event={latestPlanningLineageEvent(assetLifecycleEvents(row.asset))}
                href={href}
                key={row.asset.id}
                kind={row.asset.kind}
                lifecycleSource={row.asset.lifecycleSource}
                location={row.asset.displayLocation}
                onOpen={(event) => {
                  if (
                    event.button !== 0 ||
                    event.metaKey ||
                    event.ctrlKey ||
                    event.shiftKey ||
                    event.altKey
                  )
                    return;
                  event.preventDefault();
                  onNavigate(href);
                }}
                onSelect={(trigger) =>
                  onInspect(
                    {
                      ...assetInspection(row),
                      ...(row.asset.contentAvailability === "available"
                        ? {
                            contentAction: {
                              href: assetPreviewHref(entryId, row.asset.id),
                              label: "Open preview",
                            },
                          }
                        : {}),
                      fullDetailHref: href,
                    },
                    trigger,
                  )
                }
                owner={row.asset.owner}
                primaryFocusKey={`asset:${row.asset.id}:primary`}
                quickLookFocusKey={`asset:${row.asset.id}:quick-look`}
                title={row.asset.title}
              />
            );
          })}
        </section>
      )}
      {filtering ? (
        <p className="asset-filter-note">The canonical row order is preserved.</p>
      ) : null}
    </div>
  );
}
