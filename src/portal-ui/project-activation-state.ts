import type {
  ProjectFailureView,
  ProjectOperationError,
  ProjectSyncEnvelope,
  ProjectView,
} from "./project-contract";

export type ProjectConfirmation = "up-to-date" | "updated" | "checked-recently";
type UnavailableEnvelope = Extract<ProjectSyncEnvelope, Readonly<{ state: "unavailable" }>>;
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
  | (Readonly<{
      type: "failed";
      operation: "check" | "sync";
      error: ProjectOperationError;
    }> &
      ProjectFailureView)
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

export type SyncTransition = Readonly<{
  action: ActivationAction;
  confirmation?: Readonly<{ value: ProjectConfirmation; delayMs: number }>;
}>;

export const transitionForSyncResult = (result: ProjectSyncEnvelope): SyncTransition => {
  switch (result.state) {
    case "cooldown":
      return {
        action: {
          type: "settled",
          confirmation: "checked-recently",
          view: result.view,
        },
      };
    case "unavailable":
      return {
        action: {
          type: "unavailable",
          project: result.project,
          diagnostic: result.diagnostic,
        },
      };
    case "failed": {
      const presentation: ProjectFailureView =
        result.view === undefined
          ? result.viewDisposition === "discard"
            ? { viewDisposition: "discard" }
            : {}
          : { view: result.view };
      return {
        action: {
          type: "failed",
          operation:
            result.mode === "force" || result.error.code === "sync-failed" ? "sync" : "check",
          error: result.error,
          ...presentation,
        },
      };
    }
    case "completed":
      switch (result.outcome) {
        case "materialized":
          return {
            action: { type: "refreshing", view: result.view },
            confirmation: { value: "up-to-date", delayMs: 650 },
          };
        case "applied":
          return {
            action: { type: "syncing", view: result.view },
            confirmation: { value: "updated", delayMs: 650 },
          };
        case "synced":
          if (result.reconciliation === "applied") {
            return {
              action: { type: "syncing", view: result.view },
              confirmation: { value: "updated", delayMs: 650 },
            };
          }
          return {
            action: { type: "settled", confirmation: "up-to-date", view: result.view },
          };
        case "checked":
        case "no-op":
          return {
            action: { type: "settled", confirmation: "up-to-date", view: result.view },
          };
      }
  }
};
