import { planningLineageSubjectHref } from "../planning-lineage-route";
import type { ProjectSnapshot, SourceRecord } from "../project-snapshot/contract";
import { EffortRow } from "./effort-row";
import { Icons } from "./icons";
import type { ProjectInspectorSelection } from "./project-inspector";
import {
  effortInspection,
  frontierSummary,
  mapInspection,
  sourceInspection,
} from "./project-roadmap-inspection";
import type { RoadmapDetailModel } from "./project-roadmap-model";

type Detail = Extract<RoadmapDetailModel, { state: "available" | "partial" }>;
type Inspect = (selection: ProjectInspectorSelection, trigger: HTMLButtonElement) => void;

function TraceRow({
  label,
  onSelect,
  title,
}: {
  readonly label: string;
  readonly onSelect: (trigger: HTMLButtonElement) => void;
  readonly title: string;
}) {
  return (
    <button type="button" onClick={(event) => onSelect(event.currentTarget)}>
      <span>
        <small>{label}</small>
        <strong>{title}</strong>
      </span>
      <Icons.arrow />
    </button>
  );
}

const sourceIndex = (snapshot: ProjectSnapshot): ReadonlyMap<string, SourceRecord> =>
  new Map(snapshot.sources.map((source) => [source.reference, source]));

export function RoadmapDetailWork({
  entryId,
  model,
  onInspect,
  onNavigate,
  snapshot,
}: {
  readonly entryId: string;
  readonly model: Detail;
  readonly onInspect: Inspect;
  readonly onNavigate: (href: string) => void;
  readonly snapshot: ProjectSnapshot;
}) {
  const sources = sourceIndex(snapshot);
  const maps = model.efforts.flatMap((effort) => effort.maps);
  const gateLabels = new Map(
    model.gates.map((entry) => [String(entry.gate.id), `G${entry.ordinal}`]),
  );
  return (
    <>
      <section className="plain-section roadmap-efforts" aria-labelledby="roadmap-efforts-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Contributing work</p>
            <h2 id="roadmap-efforts-title">Efforts and frontiers</h2>
          </div>
        </div>
        {model.efforts.length === 0 ? (
          <p className="scoped-copy">No trustworthy contributing Efforts are available.</p>
        ) : (
          <div className="effort-table">
            {model.efforts.map((effort) => {
              const href = planningLineageSubjectHref(entryId, {
                kind: "effort",
                id: effort.effort.id,
              });
              return (
                <EffortRow
                  key={effort.effort.id}
                  fog={effort.fogCount}
                  frontier={frontierSummary(effort)}
                  gate={gateLabels.get(effort.effort.targetGateId) ?? "Unavailable"}
                  href={href}
                  lifecycle={effort.effort.lifecycle}
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
                    onInspect({ ...effortInspection(effort), fullDetailHref: href }, trigger)
                  }
                  title={effort.effort.title}
                />
              );
            })}
          </div>
        )}
        {model.missingEffortIds.length === 0 ? null : (
          <p className="projection-note">
            {model.missingEffortIds.length} contributing Effort relation
            {model.missingEffortIds.length === 1 ? " is" : "s are"} unavailable.
          </p>
        )}
        {model.missingMapRelationCount === 0 ? null : (
          <p className="projection-note">
            {model.missingMapRelationCount} native Map relation
            {model.missingMapRelationCount === 1 ? " is" : "s are"} unavailable.
          </p>
        )}
      </section>
      <section className="evidence-section" aria-labelledby="roadmap-trace-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Evidence and sources</p>
            <h2 id="roadmap-trace-title">Trace this Roadmap</h2>
          </div>
        </div>
        <div className="source-list">
          <TraceRow
            label="Canonical Roadmap"
            title={model.source?.displayLocator ?? "Source unavailable"}
            onSelect={(trigger) =>
              onInspect(
                sourceInspection("Roadmap source", model.roadmap.title, model.source),
                trigger,
              )
            }
          />
          {model.focusedGate === undefined ? null : (
            <TraceRow
              label="Focused Gate"
              title={model.focusedGate.source?.displayLocator ?? "Source unavailable"}
              onSelect={(trigger) =>
                onInspect(
                  sourceInspection(
                    "Milestone Gate source",
                    model.focusedGate?.gate.title ?? "Focused Gate",
                    model.focusedGate?.source,
                  ),
                  trigger,
                )
              }
            />
          )}
          {maps.map((map) => (
            <TraceRow
              key={map.reference}
              label="Tracker-native Map"
              title={map.reference}
              onSelect={(trigger) =>
                onInspect(mapInspection(map, sources.get(map.source)), trigger)
              }
            />
          ))}
          {model.evidence.map(({ asset, source }) => (
            <TraceRow
              key={asset.id}
              label="Registered evidence"
              title={asset.title}
              onSelect={(trigger) =>
                onInspect(
                  {
                    eyebrow: "Registered evidence",
                    title: asset.title,
                    detail: "A bounded evidence relation from this Roadmap journey.",
                    source,
                    facts: [
                      { label: "Kind", value: asset.kind },
                      { label: "Owner", value: asset.owner, code: true },
                      { label: "Location", value: asset.displayLocation, code: true },
                    ],
                  },
                  trigger,
                )
              }
            />
          ))}
        </div>
        {model.missingEvidenceAssetIds.length === 0 ? null : (
          <p className="projection-note">
            {model.missingEvidenceAssetIds.length} cited evidence relation
            {model.missingEvidenceAssetIds.length === 1 ? " is" : "s are"} unavailable.
          </p>
        )}
      </section>
    </>
  );
}
