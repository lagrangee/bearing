import type { MouseEvent } from "react";
import { useMemo } from "react";
import type { ProjectSnapshot } from "../project-snapshot/contract";
import { OverviewAttention } from "./overview-attention";
import { OverviewBrief } from "./overview-brief";
import { OverviewGuidance } from "./overview-guidance";
import { OverviewRoadmaps } from "./overview-roadmaps";
import type { ProjectInspectorSelection } from "./project-inspector";
import { buildProjectOverviewModel } from "./project-overview-model";

export function OverviewPage({
  entryId,
  onInspect,
  onOpenRoadmap,
  snapshot,
}: {
  readonly entryId: string;
  readonly onInspect: (selection: ProjectInspectorSelection, trigger: HTMLButtonElement) => void;
  readonly onOpenRoadmap: (href: string, event: MouseEvent<HTMLAnchorElement>) => void;
  readonly snapshot: ProjectSnapshot;
}) {
  const model = useMemo(() => buildProjectOverviewModel(snapshot), [snapshot]);
  return (
    <div className="page overview-page">
      <OverviewBrief onInspect={onInspect} summary={model.summary} />
      <OverviewAttention attention={model.attention} onInspect={onInspect} />
      <OverviewGuidance guidance={model.guidance} onInspect={onInspect} sources={model.sources} />
      <OverviewRoadmaps
        entryId={entryId}
        onInspect={onInspect}
        onOpenRoadmap={onOpenRoadmap}
        roadmaps={model.roadmaps}
      />
    </div>
  );
}
