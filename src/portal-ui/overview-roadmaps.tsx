import type { MouseEvent } from "react";
import { planningLineageSubjectHref } from "../planning-lineage-route";
import {
  gateLifecycleEvents,
  latestPlanningLineageEvent,
  roadmapLifecycleEvents,
} from "./planning-lineage-events";
import type { ProjectOverviewModel } from "./project-overview-model";
import { type Gate, RoadmapHorizon } from "./roadmap-primitives";
import { SourceEventTimeValue } from "./source-event-time";

export function OverviewRoadmaps({
  entryId,
  onOpenRoadmap,
  roadmaps,
}: {
  readonly entryId: string;
  readonly onOpenRoadmap: (href: string, event: MouseEvent<HTMLAnchorElement>) => void;
  readonly roadmaps: ProjectOverviewModel["roadmaps"];
}) {
  if (roadmaps.state === "absent") {
    return (
      <section className="roadmap-landscape scoped-state" aria-labelledby="active-roadmaps-title">
        <div className="section-heading">
          <h2 id="active-roadmaps-title">Active Roadmaps</h2>
          <span className="truth-note">0 active</span>
        </div>
        <p>No Roadmap Index is available in the current Project Read Model generation.</p>
      </section>
    );
  }
  if (roadmaps.state === "invalid") {
    return (
      <section className="roadmap-landscape scoped-state" aria-labelledby="active-roadmaps-title">
        <div className="section-heading">
          <h2 id="active-roadmaps-title">Active Roadmaps unavailable</h2>
        </div>
        <p>
          The Roadmap horizon could not be projected ({roadmaps.issues.length} source issue
          {roadmaps.issues.length === 1 ? "" : "s"}).
        </p>
      </section>
    );
  }

  return (
    <section className="roadmap-landscape" aria-labelledby="active-roadmaps-title">
      <div className="section-heading">
        <h2 id="active-roadmaps-title">Active Roadmaps</h2>
        <span className="truth-note">{roadmaps.activeCount} active</span>
      </div>
      {roadmaps.state === "partial" ? (
        <p className="projection-note" role="status">
          Roadmap orientation is partial; {roadmaps.issues.length} issue
          {roadmaps.issues.length === 1 ? " is" : "s are"} isolated.
        </p>
      ) : null}
      {roadmaps.items.length === 0 ? <p className="scoped-copy">No active Roadmaps.</p> : null}
      {roadmaps.items.map((item) => {
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
        const href = planningLineageSubjectHref(entryId, {
          kind: "roadmap",
          id: item.roadmap.id,
        });
        const roadmapEvent = latestPlanningLineageEvent(roadmapLifecycleEvents(item.roadmap));
        return (
          <article className="roadmap-landscape-item" key={item.roadmap.id}>
            <div className="roadmap-landscape-header">
              <h3>
                <a
                  className="roadmap-title-link"
                  href={href}
                  onClick={(event) => onOpenRoadmap(href, event)}
                >
                  {item.roadmap.title}
                </a>
              </h3>
              {roadmapEvent?.time.availability !== "available" ? null : (
                <small className="roadmap-event">
                  {roadmapEvent.label}{" "}
                  <SourceEventTimeValue
                    label={`${item.roadmap.title} ${roadmapEvent.label}`}
                    mode="compact"
                    time={roadmapEvent.time}
                  />
                </small>
              )}
              <p>{item.roadmap.intent}</p>
            </div>
            {item.missingGateIds.length === 0 ? null : (
              <p className="projection-note" role="status">
                {item.missingGateIds.length} Gate relation
                {item.missingGateIds.length === 1 ? " is" : "s are"} unavailable.
              </p>
            )}
            {gates.length === 0 ? (
              <p className="roadmap-horizon-empty">
                {item.roadmap.horizon === "exhausted"
                  ? "This Roadmap horizon is complete."
                  : "No Gate horizon is available."}
              </p>
            ) : (
              <RoadmapHorizon
                gates={gates}
                label={`${item.roadmap.title} Roadmap horizon`}
                onOpen={(gate, event) => onOpenRoadmap(gate.href, event)}
              />
            )}
          </article>
        );
      })}
    </section>
  );
}
