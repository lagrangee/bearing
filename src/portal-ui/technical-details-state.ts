import type { ProjectSection } from "./project-navigation";
import type { TechnicalDetailsSelection } from "./technical-details";

type TechnicalDetailsContext = Readonly<{
  entryId: string;
  routeIdentity?: string | undefined;
  section: ProjectSection;
  snapshotFingerprint?: string | undefined;
}>;

export type CapturedTechnicalDetailsSelection = Readonly<{
  context: TechnicalDetailsContext;
  selection: TechnicalDetailsSelection;
}>;

export const captureTechnicalDetailsSelection = (
  selection: TechnicalDetailsSelection,
  context: TechnicalDetailsContext,
): CapturedTechnicalDetailsSelection => ({ context: { ...context }, selection });

export const currentTechnicalDetailsSelection = (
  captured: CapturedTechnicalDetailsSelection | null,
  context: TechnicalDetailsContext,
): TechnicalDetailsSelection | null => {
  if (captured === null) return null;
  return captured.context.entryId === context.entryId &&
    captured.context.routeIdentity === context.routeIdentity &&
    captured.context.section === context.section &&
    captured.context.snapshotFingerprint === context.snapshotFingerprint
    ? captured.selection
    : null;
};
