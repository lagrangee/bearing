import type { PlanningLineageSubject } from "../planning-lineage-route";
import {
  type PortalProjectFindEnvelope,
  type PortalProjectReadEnvelope,
  type PortalProjectSection,
  portalProjectFindEnvelopeSchema,
  portalProjectReadEnvelopeSchema,
} from "../portal-project-read-wire";
import {
  type PortalProviderApplicationRequest,
  type PortalProviderApplicationResponse,
  portalProviderApplicationResponseSchema,
} from "../portal-provider-application-wire";
import type { ProjectData } from "./project-data";
import { portalRowsToProjectData } from "./project-row-adapter";

export type ProjectOperationError = Readonly<{ code: string; message: string }>;

export type ProjectView = Readonly<{
  project: Readonly<{
    entryId: string;
    displayName: string;
    availability: "available";
  }>;
  data: ProjectData;
  diagnosticCounts: Readonly<{
    blocking: number;
    nonBlocking: number;
    total: number;
  }>;
}>;

type ReadyEnvelope = Extract<PortalProjectReadEnvelope, { state: "ready" }>;
type UnavailableEnvelope = Extract<PortalProjectReadEnvelope, { state: "unavailable" }>;

export type ProjectReadResult =
  | Readonly<{
      version: 1;
      state: "ready";
      view: ProjectView;
      session: ReadyEnvelope["session"];
    }>
  | UnavailableEnvelope;

export class ProjectResponseError extends Error {
  readonly name: string = "ProjectResponseError";
}

export type ProjectDataRecovery = "explicit-rebuild" | "compatible-runtime";

export class ProjectDataRecoveryError extends ProjectResponseError {
  readonly name: string = "ProjectDataRecoveryError";

  constructor(readonly recovery: ProjectDataRecovery) {
    super(
      recovery === "explicit-rebuild"
        ? "Project data needs an explicit rebuild."
        : "Project data needs a compatible Bearing runtime.",
    );
  }
}

const failedProjectResponse = (error: ProjectOperationError): ProjectResponseError => {
  if (error.code === "project-data-needs-rebuild") {
    return new ProjectDataRecoveryError("explicit-rebuild");
  }
  if (error.code === "project-data-needs-update") {
    return new ProjectDataRecoveryError("compatible-runtime");
  }
  return new ProjectResponseError(error.message);
};

const parsedResponse = async <Output>(
  response: Response,
  parse: (input: unknown) => { success: true; data: Output } | { success: false },
): Promise<Output> => {
  const input: unknown = await response.json();
  const parsed = parse(input);
  if (!parsed.success) throw new ProjectResponseError("Project response does not match version 1.");
  return parsed.data;
};

export const readProjectRows = async (
  entryId: string,
  section: PortalProjectSection,
  target: PlanningLineageSubject | undefined,
  signal: AbortSignal,
): Promise<ProjectReadResult> => {
  const parameters = new URLSearchParams({ section });
  if (target !== undefined) {
    parameters.set("targetKind", target.kind);
    parameters.set("targetId", target.id);
  }
  const response = await window.fetch(
    `/api/v1/projects/${encodeURIComponent(entryId)}/read-model?${parameters.toString()}`,
    {
      method: "GET",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
      signal,
    },
  );
  const envelope = await parsedResponse(response, (input) =>
    portalProjectReadEnvelopeSchema.safeParse(input),
  );
  if (envelope.state === "failed") throw failedProjectResponse(envelope.error);
  if (!response.ok) throw new ProjectResponseError(`Project request returned ${response.status}.`);
  if (envelope.state !== "ready") return envelope;
  const blocking = envelope.rows.diagnostics.filter(
    (diagnostic) => diagnostic.impact === "blocking",
  ).length;
  return {
    version: 1,
    state: "ready",
    view: {
      project: envelope.project,
      data: portalRowsToProjectData(envelope.rows),
      diagnosticCounts: {
        blocking,
        nonBlocking: envelope.rows.diagnostics.length - blocking,
        total: envelope.rows.diagnostics.length,
      },
    },
    session: envelope.session,
  };
};

export const findProjectRows = async (
  entryId: string,
  query: string,
  signal: AbortSignal,
): Promise<
  Pick<Extract<PortalProjectFindEnvelope, { state: "ready" }>, "results" | "scopeState">
> => {
  const parameters = new URLSearchParams({ query });
  const response = await window.fetch(
    `/api/v1/projects/${encodeURIComponent(entryId)}/find?${parameters.toString()}`,
    {
      method: "GET",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
      signal,
    },
  );
  const envelope = await parsedResponse(response, (input) =>
    portalProjectFindEnvelopeSchema.safeParse(input),
  );
  if (envelope.state === "failed") {
    throw failedProjectResponse(envelope.error);
  }
  if (!response.ok) {
    throw new ProjectResponseError("Project Find is unavailable.");
  }
  return { results: envelope.results, scopeState: envelope.scopeState };
};

export const requestProviderObservation = async (
  entryId: string,
  request: PortalProviderApplicationRequest,
  csrfToken: string,
  signal: AbortSignal,
): Promise<PortalProviderApplicationResponse> => {
  const response = await window.fetch(
    `/api/v1/projects/${encodeURIComponent(entryId)}/provider-observation`,
    {
      method: "POST",
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Bearing-CSRF-Token": csrfToken,
      },
      body: JSON.stringify(request),
      signal,
    },
  );
  const envelope = await parsedResponse(response, (input) =>
    portalProviderApplicationResponseSchema.safeParse(input),
  );
  if (!response.ok) {
    throw new ProjectResponseError("Provider observation is unavailable.");
  }
  return envelope;
};
