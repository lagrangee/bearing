import type { RoadmapsModelData } from "./project-data";
import { RoadmapsIndex } from "./roadmaps-index";

export function RoadmapsPage({
  entryId,
  onNavigate,
  snapshot,
}: {
  readonly entryId: string;
  readonly onNavigate: (href: string) => void;
  readonly snapshot: RoadmapsModelData;
}) {
  return <RoadmapsIndex entryId={entryId} onNavigate={onNavigate} snapshot={snapshot} />;
}
