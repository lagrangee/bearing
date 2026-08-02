import type { ProjectSnapshot } from "../project-snapshot/contract";
import { RoadmapsIndex } from "./roadmaps-index";

export function RoadmapsPage({
  entryId,
  onNavigate,
  snapshot,
}: {
  readonly entryId: string;
  readonly onNavigate: (href: string) => void;
  readonly snapshot: ProjectSnapshot;
}) {
  return <RoadmapsIndex entryId={entryId} onNavigate={onNavigate} snapshot={snapshot} />;
}
