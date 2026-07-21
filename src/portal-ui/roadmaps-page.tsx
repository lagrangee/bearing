import type { MouseEvent } from "react";
import type { ProjectSnapshot } from "../project-snapshot/contract";
import type { ProjectInspectorSelection } from "./project-inspector";
import { buildRoadmapDetailModel } from "./project-roadmap-model";
import { RoadmapDetail } from "./roadmap-detail";
import { RoadmapsIndex } from "./roadmaps-index";

type Inspect = (selection: ProjectInspectorSelection, trigger: HTMLButtonElement) => void;

const follow = (
  href: string,
  event: MouseEvent<HTMLAnchorElement>,
  onNavigate: (href: string) => void,
) => {
  event.preventDefault();
  onNavigate(href);
};

export function RoadmapsPage({
  entryId,
  onInspect,
  onNavigate,
  roadmapId,
  snapshot,
}: {
  readonly entryId: string;
  readonly onInspect: Inspect;
  readonly onNavigate: (href: string) => void;
  readonly roadmapId?: string | undefined;
  readonly snapshot: ProjectSnapshot;
}) {
  if (roadmapId === undefined) {
    return (
      <RoadmapsIndex
        entryId={entryId}
        onInspect={onInspect}
        onNavigate={onNavigate}
        snapshot={snapshot}
      />
    );
  }
  const model = buildRoadmapDetailModel(snapshot, roadmapId);
  if (model.state === "available" || model.state === "partial") {
    return (
      <RoadmapDetail
        entryId={entryId}
        model={model}
        onInspect={onInspect}
        onNavigate={onNavigate}
        snapshot={snapshot}
      />
    );
  }
  const indexHref = `/projects/${encodeURIComponent(entryId)}/roadmaps`;
  const title = model.state === "missing" ? "Roadmap not found" : "Roadmap unavailable";
  const detail =
    model.state === "missing"
      ? "This typed Roadmap ID is not present in the current Snapshot."
      : `The Roadmap projection cannot be trusted (${model.issueCount} source issue${
          model.issueCount === 1 ? "" : "s"
        }).`;
  return (
    <div className="page roadmaps-index scoped-state">
      <p className="eyebrow">Peer outcome horizons</p>
      <h1>{title}</h1>
      <p>{detail}</p>
      <a
        className="action action-quiet"
        href={indexHref}
        onClick={(event) => follow(indexHref, event, onNavigate)}
      >
        Return to Roadmaps
      </a>
    </div>
  );
}
