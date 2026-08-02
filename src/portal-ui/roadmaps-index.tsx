import type { MouseEvent } from "react";
import { planningLineageSubjectHref } from "../planning-lineage-route";
import type { ProjectSnapshot } from "../project-snapshot/contract";
import {
  gateLifecycleEvents,
  latestPlanningLineageEvent,
  roadmapLifecycleEvents,
} from "./planning-lineage-events";
import { buildRoadmapIndexModel } from "./project-roadmap-model";
import { type Gate, RoadmapIndexRow } from "./roadmap-primitives";

const groupTitle = (lifecycle: "active" | "completed" | "superseded"): string =>
  lifecycle === "active" ? "Active" : lifecycle === "completed" ? "Completed" : "Superseded";

const openLink = (
  href: string,
  event: MouseEvent<HTMLAnchorElement>,
  onNavigate: (href: string) => void,
) => {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
    return;
  event.preventDefault();
  onNavigate(href);
};

export function RoadmapsIndex({
  entryId,
  onNavigate,
  snapshot,
}: {
  readonly entryId: string;
  readonly onNavigate: (href: string) => void;
  readonly snapshot: ProjectSnapshot;
}) {
  const model = buildRoadmapIndexModel(snapshot);
  if (model.state === "invalid") {
    return (
      <div className="page roadmaps-index scoped-state">
        <p className="eyebrow">Peer outcome horizons</p>
        <h1>Roadmaps unavailable</h1>
        <p>
          The current Roadmap Index cannot be trusted ({model.issueCount} source issue
          {model.issueCount === 1 ? "" : "s"}). Other project destinations remain available.
        </p>
      </div>
    );
  }
  if (model.state === "absent") {
    return (
      <div className="page roadmaps-index scoped-state">
        <p className="eyebrow">Peer outcome horizons</p>
        <h1>Roadmaps</h1>
        <p>No canonical Roadmap Index is available in the current Snapshot.</p>
      </div>
    );
  }
  const visibleGroups = model.groups.filter(
    (group) => group.items.length > 0 || group.missingRoadmapIds.length > 0,
  );
  return (
    <div className="page roadmaps-index">
      <header className="list-header">
        <p className="eyebrow">Peer outcome horizons</p>
        <h1>Roadmaps</h1>
        <p>
          Each Roadmap carries an independently governed Gate sequence. Open one to inspect its
          contracts, contributing work, and evidence.
        </p>
      </header>
      {model.state === "partial" ? (
        <p className="projection-note" role="status">
          Roadmap orientation is partial. Unresolved relations remain visibly scoped below.
        </p>
      ) : null}
      {visibleGroups.length === 0 ? <p className="scoped-copy">No Roadmaps are indexed.</p> : null}
      {visibleGroups.map((group) => (
        <section
          className="roadmap-index-section"
          aria-labelledby={`roadmap-index-${group.lifecycle}`}
          key={group.lifecycle}
        >
          <div className="index-section-heading">
            <h2 id={`roadmap-index-${group.lifecycle}`}>{groupTitle(group.lifecycle)}</h2>
            <span>{group.items.length + group.missingRoadmapIds.length}</span>
          </div>
          {group.missingRoadmapIds.length === 0 ? null : (
            <p className="projection-note">
              {group.missingRoadmapIds.length} indexed Roadmap relation
              {group.missingRoadmapIds.length === 1 ? " is" : "s are"} unavailable.
            </p>
          )}
          {group.items.map((item) => {
            const href = planningLineageSubjectHref(entryId, {
              kind: "roadmap",
              id: item.roadmap.id,
            });
            const gates: Gate[] = item.gates.map((entry) => ({
              id: entry.gate.id,
              href: planningLineageSubjectHref(entryId, {
                kind: "gate",
                id: entry.gate.id,
              }),
              label: `G${entry.ordinal}`,
              state: entry.gate.horizonState,
              title: entry.gate.title,
              event: latestPlanningLineageEvent(gateLifecycleEvents(entry.gate)),
            }));
            return (
              <div key={item.roadmap.id}>
                <RoadmapIndexRow
                  gates={gates}
                  href={href}
                  horizon={item.roadmap.horizon}
                  intent={item.roadmap.intent}
                  event={latestPlanningLineageEvent(roadmapLifecycleEvents(item.roadmap))}
                  onOpen={(event) => openLink(href, event, onNavigate)}
                  onOpenGate={(gate, event) => openLink(gate.href, event, onNavigate)}
                  title={item.roadmap.title}
                />
                {item.missingGateIds.length === 0 ? null : (
                  <p className="projection-note roadmap-relation-note">
                    {item.missingGateIds.length} ordered Gate relation
                    {item.missingGateIds.length === 1 ? " is" : "s are"} unavailable.
                  </p>
                )}
              </div>
            );
          })}
        </section>
      ))}
    </div>
  );
}
