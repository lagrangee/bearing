import type { ProjectInspectorSelection } from "./project-inspector";
import type { ProjectSection } from "./project-navigation";

type ProjectInspectorContext = Readonly<{
  entryId: string;
  roadmapId?: string | undefined;
  section: ProjectSection;
  snapshotFingerprint?: string | undefined;
}>;

export type CapturedProjectInspectorSelection = Readonly<{
  context: ProjectInspectorContext;
  selection: ProjectInspectorSelection;
}>;

export const captureProjectInspectorSelection = (
  selection: ProjectInspectorSelection,
  context: ProjectInspectorContext,
): CapturedProjectInspectorSelection => ({ context: { ...context }, selection });

export const currentProjectInspectorSelection = (
  captured: CapturedProjectInspectorSelection | null,
  context: ProjectInspectorContext,
): ProjectInspectorSelection | null => {
  if (captured === null) return null;
  const origin = captured.context;
  return origin.entryId === context.entryId &&
    origin.section === context.section &&
    origin.roadmapId === context.roadmapId &&
    origin.snapshotFingerprint === context.snapshotFingerprint
    ? captured.selection
    : null;
};
