import type { ZodType } from "zod";
import type { ProjectSnapshotEnvelope, ProjectSyncEnvelope } from "../portal-project-wire";
import { projectSnapshotEnvelopeSchema, projectSyncEnvelopeSchema } from "../portal-project-wire";

export type {
  ProjectFailureView,
  ProjectOperationError,
  ProjectSnapshotEnvelope,
  ProjectSyncEnvelope,
  ProjectView,
} from "../portal-project-wire";
export {
  projectSnapshotEnvelopeSchema,
  projectSyncEnvelopeSchema,
  projectViewSchema,
} from "../portal-project-wire";

export class ProjectResponseError extends Error {
  readonly name = "ProjectResponseError";
}

const readJson = async <Output>(response: Response, schema: ZodType<Output>): Promise<Output> => {
  if (!response.ok) throw new ProjectResponseError(`Project request returned ${response.status}.`);
  const input: unknown = await response.json();
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new ProjectResponseError("Project response does not match version 1.");
  return parsed.data;
};

export const readProjectSnapshot = async (
  entryId: string,
  signal: AbortSignal,
): Promise<ProjectSnapshotEnvelope> => {
  const response = await window.fetch(`/api/v1/projects/${encodeURIComponent(entryId)}/snapshot`, {
    method: "GET",
    credentials: "same-origin",
    headers: { Accept: "application/json" },
    signal,
  });
  const input: unknown = await response.json();
  const parsed = projectSnapshotEnvelopeSchema.safeParse(input);
  if (!parsed.success) {
    throw new ProjectResponseError("Project response does not match version 1.");
  }
  if (parsed.data.state === "failed") {
    throw new ProjectResponseError(parsed.data.error.message);
  }
  if (!response.ok) throw new ProjectResponseError(`Project request returned ${response.status}.`);
  return parsed.data;
};

export const syncProject = async (
  entryId: string,
  mode: "ensure-current" | "force",
  csrfToken: string,
  signal: AbortSignal,
): Promise<ProjectSyncEnvelope> =>
  readJson(
    await window.fetch(`/api/v1/projects/${encodeURIComponent(entryId)}/sync`, {
      method: "POST",
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Bearing-CSRF-Token": csrfToken,
      },
      body: JSON.stringify({ version: 1, mode }),
      signal,
    }),
    projectSyncEnvelopeSchema,
  );

export const discoverNativeScopes = async (
  entryId: string,
  csrfToken: string,
  signal: AbortSignal,
): Promise<ProjectSyncEnvelope> =>
  readJson(
    await window.fetch(`/api/v1/projects/${encodeURIComponent(entryId)}/discover-native-scopes`, {
      method: "POST",
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Bearing-CSRF-Token": csrfToken,
      },
      body: JSON.stringify({ version: 1 }),
      signal,
    }),
    projectSyncEnvelopeSchema,
  );
