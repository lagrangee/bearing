import type { MouseEvent } from "react";
import { useMemo } from "react";
import type { ProjectSnapshot } from "../project-snapshot/contract";
import { OverviewAttention } from "./overview-attention";
import { OverviewBrief } from "./overview-brief";
import { OverviewRoadmaps } from "./overview-roadmaps";
import { buildProjectOverviewModel } from "./project-overview-model";

export function OverviewPage({
  entryId,
  onNavigate,
  onOpenRoadmap,
  snapshot,
}: {
  readonly entryId: string;
  readonly onNavigate: (href: string) => void;
  readonly onOpenRoadmap: (href: string, event: MouseEvent<HTMLAnchorElement>) => void;
  readonly snapshot: ProjectSnapshot;
}) {
  const model = useMemo(() => buildProjectOverviewModel(snapshot), [snapshot]);
  return (
    <div className="page overview-page">
      <OverviewBrief brief={model.brief} summary={model.summary} />
      <OverviewAttention attention={model.attention} entryId={entryId} onNavigate={onNavigate} />
      <OverviewRoadmaps entryId={entryId} onOpenRoadmap={onOpenRoadmap} roadmaps={model.roadmaps} />
    </div>
  );
}
