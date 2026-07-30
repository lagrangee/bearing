import type { ProjectSnapshot } from "../project-snapshot/contract";
import type { ProjectInspectorSelection } from "./project-inspector";
import { RoadmapsIndex } from "./roadmaps-index";

type Inspect = (selection: ProjectInspectorSelection, trigger: HTMLButtonElement) => void;

export function RoadmapsPage({
  entryId,
  onInspect,
  onNavigate,
  snapshot,
}: {
  readonly entryId: string;
  readonly onInspect: Inspect;
  readonly onNavigate: (href: string) => void;
  readonly snapshot: ProjectSnapshot;
}) {
  return (
    <RoadmapsIndex
      entryId={entryId}
      onInspect={onInspect}
      onNavigate={onNavigate}
      snapshot={snapshot}
    />
  );
}
