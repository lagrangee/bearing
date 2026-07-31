import type { MouseEvent } from "react";
import { useMemo } from "react";
import type { ProjectSnapshot } from "../project-snapshot/contract";
import { OverviewAttention } from "./overview-attention";
import { OverviewBrief } from "./overview-brief";
import { OverviewDiscoveredWork } from "./overview-discovered-work";
import { OverviewGuidance } from "./overview-guidance";
import { OverviewRoadmaps } from "./overview-roadmaps";
import type { ProjectInspectorSelection } from "./project-inspector";
import { buildProjectOverviewModel } from "./project-overview-model";

export function OverviewPage({
  entryId,
  onInspect,
  onNavigate,
  onOpenRoadmap,
  snapshot,
  discoveryOperation,
  onRefreshDiscovery,
}: {
  readonly entryId: string;
  readonly onInspect: (selection: ProjectInspectorSelection, trigger: HTMLButtonElement) => void;
  readonly onNavigate: (href: string) => void;
  readonly onOpenRoadmap: (href: string, event: MouseEvent<HTMLAnchorElement>) => void;
  readonly snapshot: ProjectSnapshot;
  readonly discoveryOperation: Readonly<{ state: "idle" | "running" | "failed" }>;
  readonly onRefreshDiscovery: () => void;
}) {
  const model = useMemo(() => buildProjectOverviewModel(snapshot), [snapshot]);
  return (
    <div className="page overview-page">
      <OverviewBrief onInspect={onInspect} summary={model.summary} />
      <OverviewAttention
        attention={model.attention}
        entryId={entryId}
        onInspect={onInspect}
        onNavigate={onNavigate}
      />
      <OverviewDiscoveredWork
        discovery={model.discoveredWork}
        onRefresh={onRefreshDiscovery}
        operation={discoveryOperation}
      />
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
