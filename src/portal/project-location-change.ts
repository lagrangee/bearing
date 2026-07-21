import type { ProjectOperationError, ProjectView } from "./project-contract";
import type { AvailableProjectEntry } from "./project-entry";
import { readProjectView } from "./project-view";

const PROJECT_LOCATION_CHANGED_ERROR = {
  code: "input-validation-failed",
  message:
    "The registered project location changed while this operation was in flight. Retry against the current repository.",
} as const satisfies ProjectOperationError;

type ProjectViewReader = (entry: AvailableProjectEntry) => Promise<ProjectView>;
type ProjectLocationChangedFailure =
  | Readonly<{
      error: ProjectOperationError;
      view: ProjectView;
      viewDisposition?: never;
    }>
  | Readonly<{
      error: ProjectOperationError;
      view?: never;
      viewDisposition: "discard";
    }>;

export const projectLocationChangedFailure = async (
  entry: AvailableProjectEntry,
  readView: ProjectViewReader = readProjectView,
): Promise<ProjectLocationChangedFailure> => {
  try {
    return { error: PROJECT_LOCATION_CHANGED_ERROR, view: await readView(entry) };
  } catch {
    return { error: PROJECT_LOCATION_CHANGED_ERROR, viewDisposition: "discard" };
  }
};
