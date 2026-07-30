import type { MouseEvent } from "react";
import type { ProjectSnapshot } from "../project-snapshot/contract";
import { Icons } from "./icons";
import { Action } from "./primitives";
import type { ProjectInspectorSelection } from "./project-inspector";
import { roadmapInspection } from "./project-roadmap-inspection";
import type { RoadmapDetailModel } from "./project-roadmap-model";
import { RoadmapDetailGate } from "./roadmap-detail-gate";
import { RoadmapDetailWork } from "./roadmap-detail-work";

type Detail = Extract<RoadmapDetailModel, { state: "available" | "partial" }>;
type Inspect = (selection: ProjectInspectorSelection, trigger: HTMLButtonElement) => void;

const lifecycleLabel = (lifecycle: Detail["roadmap"]["lifecycle"]): string =>
  `${lifecycle[0]?.toUpperCase()}${lifecycle.slice(1)}`;

const follow = (
  href: string,
  event: MouseEvent<HTMLAnchorElement>,
  onNavigate: (href: string) => void,
) => {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
    return;
  event.preventDefault();
  onNavigate(href);
};

export function RoadmapDetail({
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
  const indexHref = `/projects/${encodeURIComponent(entryId)}/roadmaps`;
  return (
    <div className="page roadmap-detail">
      <header className="detail-header">
        <a
          className="back-link"
          href={indexHref}
          onClick={(event) => follow(indexHref, event, onNavigate)}
        >
          <Icons.back /> Roadmaps
        </a>
        <div className="detail-heading">
          <div>
            <p className="eyebrow">{lifecycleLabel(model.roadmap.lifecycle)} Roadmap</p>
            <h1>{model.roadmap.title}</h1>
            <p>{model.roadmap.intent}</p>
          </div>
          <Action
            className="roadmap-resume"
            onClick={(event) => onInspect(roadmapInspection(model), event.currentTarget)}
          >
            Resume Roadmap in Agent Surface <Icons.arrow />
          </Action>
        </div>
      </header>
      {model.state === "partial" ? (
        <p className="projection-note" role="status">
          This Roadmap remains readable with unresolved relations explicitly scoped below.
        </p>
      ) : null}
      <RoadmapDetailGate model={model} onInspect={onInspect} />
      <RoadmapDetailWork
        entryId={entryId}
        model={model}
        onInspect={onInspect}
        onNavigate={onNavigate}
        snapshot={snapshot}
      />
      <section className="roadmap-notes">
        <p className="eyebrow">Roadmap note</p>
        <p>
          {model.roadmap.horizon === "active-horizon"
            ? "This is a rolling horizon. Gates beyond the declared order are intentionally undefined, and Roadmaps remain peer objects under the project."
            : model.roadmap.horizon === "exhausted"
              ? "The declared Gate horizon is exhausted. Roadmap completion remains an explicit governance decision."
              : "The Roadmap horizon is unknown; the Portal does not infer completion or future Gates."}
        </p>
      </section>
    </div>
  );
}
