import type { PortalProjectReadEnvelope } from "../portal-project-read-wire";
import type { ProjectOperationError, ProjectView } from "./project-contract";

export type ProjectConfirmation = "up-to-date" | "updated" | "checked-recently";
type UnavailableEnvelope = Extract<PortalProjectReadEnvelope, Readonly<{ state: "unavailable" }>>;
export type ProjectUnavailableState = Readonly<{
  kind: "unavailable";
  project: UnavailableEnvelope["project"];
  diagnostic: UnavailableEnvelope["diagnostic"];
}>;
export type ActivationState =
  | Readonly<{ kind: "loading-cache" }>
  | Readonly<{ kind: "checking"; view?: ProjectView }>
  | Readonly<{ kind: "refreshing"; view: ProjectView }>
  | Readonly<{ kind: "syncing"; view?: ProjectView }>
  | Readonly<{ kind: "settled"; confirmation: ProjectConfirmation; view: ProjectView }>
  | Readonly<{
      kind: "failed";
      operation: "check" | "sync";
      error: ProjectOperationError;
      view?: ProjectView;
    }>
  | ProjectUnavailableState;

export type ActivationAction =
  | Readonly<{ type: "load-started" }>
  | Readonly<{ type: "checking"; view?: ProjectView }>
  | Readonly<{ type: "syncing"; view?: ProjectView }>
  | Readonly<{ type: "settled"; confirmation: ProjectConfirmation; view: ProjectView }>
  | Readonly<{ type: "refreshing"; view: ProjectView }>
  | Readonly<{
      type: "failed";
      operation: "check" | "sync";
      error: ProjectOperationError;
      view?: ProjectView;
      viewDisposition?: "discard";
    }>
  | Readonly<{
      type: "unavailable";
      project: ProjectUnavailableState["project"];
      diagnostic: ProjectUnavailableState["diagnostic"];
    }>;

export const visibleProjectView = (state: ActivationState): ProjectView | undefined => {
  switch (state.kind) {
    case "checking":
    case "syncing":
    case "failed":
    case "refreshing":
    case "settled":
      return state.view;
    case "loading-cache":
    case "unavailable":
      return undefined;
  }
};

export const activationStateForEntry = (
  state: ActivationState,
  stateEntryId: string,
  entryId: string,
): ActivationState => (stateEntryId === entryId ? state : { kind: "loading-cache" });

const withOptionalView = <Kind extends "checking" | "syncing">(
  kind: Kind,
  view: ProjectView | undefined,
): Readonly<{ kind: Kind; view?: ProjectView }> => (view === undefined ? { kind } : { kind, view });

export const projectActivationReducer = (
  state: ActivationState,
  action: ActivationAction,
): ActivationState => {
  switch (action.type) {
    case "load-started":
      return { kind: "loading-cache" };
    case "checking":
      return withOptionalView("checking", action.view);
    case "syncing":
      return withOptionalView("syncing", action.view);
    case "settled":
      return { kind: "settled", confirmation: action.confirmation, view: action.view };
    case "refreshing":
      return { kind: "refreshing", view: action.view };
    case "failed": {
      const view =
        action.viewDisposition === "discard"
          ? undefined
          : (action.view ?? ("view" in state ? state.view : undefined));
      return view === undefined
        ? { kind: "failed", operation: action.operation, error: action.error }
        : { kind: "failed", operation: action.operation, error: action.error, view };
    }
    case "unavailable":
      return { kind: "unavailable", project: action.project, diagnostic: action.diagnostic };
  }
};
