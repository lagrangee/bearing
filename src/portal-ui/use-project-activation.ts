import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import {
  type PlanningLineageSubject,
  planningLineageSubjectSchema,
} from "../planning-lineage-route";
import type { PortalProjectSection } from "../portal-project-read-wire";
import type {
  PortalProviderApplicationRequest,
  PortalProviderApplicationResponse,
} from "../portal-provider-application-wire";
import {
  type ActivationState,
  activationStateForEntry,
  projectActivationReducer,
  visibleProjectView,
} from "./project-activation-state";
import {
  ProjectDataRecoveryError,
  type ProjectOperationError,
  type ProjectView,
  readProjectRows,
  requestProviderObservation,
} from "./project-contract";

const requestFailure = (error: unknown): ProjectOperationError =>
  error instanceof ProjectDataRecoveryError
    ? {
        code:
          error.recovery === "explicit-rebuild"
            ? "project-data-needs-rebuild"
            : "project-data-needs-update",
        message: error.message,
      }
    : {
        code: "project-read-failed",
        message: "Project data could not be read.",
      };

export type ProjectActivation = Readonly<{
  state: ActivationState;
  view?: ProjectView;
  readFailure?: ProjectOperationError;
  providerApplication:
    | Readonly<{ state: "idle" }>
    | Readonly<{ state: "running"; action: PortalProviderApplicationRequest["action"] }>
    | Readonly<{
        state: "settled";
        result: PortalProviderApplicationResponse;
      }>;
  applyProviderObservation: (request: PortalProviderApplicationRequest) => void;
}>;

export const useProjectActivation = (
  entryId: string,
  section: PortalProjectSection,
  target?: PlanningLineageSubject | undefined,
): ProjectActivation => {
  const targetKind = target?.kind;
  const targetId = target?.id;
  const queryTarget = useMemo<PlanningLineageSubject | undefined>(
    () =>
      targetKind === undefined || targetId === undefined
        ? undefined
        : planningLineageSubjectSchema.parse({ kind: targetKind, id: targetId }),
    [targetId, targetKind],
  );
  const [state, dispatch] = useReducer(projectActivationReducer, { kind: "loading-cache" });
  const [providerApplication, setProviderApplication] = useState<
    ProjectActivation["providerApplication"]
  >({ state: "idle" });
  const stateRef = useRef(state);
  const stateEntryIdRef = useRef(entryId);
  const providerEntryIdRef = useRef(entryId);
  const csrfTokenRef = useRef<string | undefined>(undefined);
  const requestIdRef = useRef(0);
  const readControllersRef = useRef(new Set<AbortController>());
  const providerControllersRef = useRef(new Set<AbortController>());
  const matchesQuery = useCallback(
    (view: ProjectView): boolean =>
      view.data.section === section &&
      (section !== "lineage" ||
        (view.data.section === "lineage" &&
          view.data.target?.kind === queryTarget?.kind &&
          view.data.target?.id === queryTarget?.id)),
    [queryTarget, section],
  );

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const read = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    stateEntryIdRef.current = entryId;
    const candidate = visibleProjectView(stateRef.current);
    const retained =
      candidate?.project.entryId === entryId && matchesQuery(candidate) ? candidate : undefined;
    dispatch(
      retained === undefined ? { type: "load-started" } : { type: "checking", view: retained },
    );
    const controller = new AbortController();
    readControllersRef.current.add(controller);
    try {
      const envelope = await readProjectRows(entryId, section, queryTarget, controller.signal);
      if (requestId !== requestIdRef.current) return;
      csrfTokenRef.current = envelope.session.csrfToken;
      if (envelope.state === "unavailable") {
        dispatch({
          type: "unavailable",
          project: envelope.project,
          diagnostic: envelope.diagnostic,
        });
        return;
      }
      dispatch({ type: "settled", confirmation: "checked-recently", view: envelope.view });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      if (requestId !== requestIdRef.current) return;
      dispatch({
        type: "failed",
        operation: "check",
        error: requestFailure(error),
        ...(retained === undefined ? {} : { view: retained }),
      });
    } finally {
      readControllersRef.current.delete(controller);
    }
  }, [entryId, matchesQuery, queryTarget, section]);
  const latestReadRef = useRef(read);
  latestReadRef.current = read;

  useEffect(() => {
    if (providerEntryIdRef.current !== entryId) {
      providerEntryIdRef.current = entryId;
      setProviderApplication({ state: "idle" });
    }
    csrfTokenRef.current = undefined;
    void read();
    return () => {
      requestIdRef.current += 1;
      for (const controller of readControllersRef.current) controller.abort();
      readControllersRef.current.clear();
    };
  }, [entryId, read]);

  useEffect(
    () => () => {
      for (const controller of providerControllersRef.current) controller.abort();
      providerControllersRef.current.clear();
    },
    [],
  );

  const applyProviderObservation = useCallback(
    (request: PortalProviderApplicationRequest) => {
      const csrfToken = csrfTokenRef.current;
      if (csrfToken === undefined || providerApplication.state === "running") return;
      const controller = new AbortController();
      providerControllersRef.current.add(controller);
      setProviderApplication({ state: "running", action: request.action });
      void requestProviderObservation(entryId, request, csrfToken, controller.signal)
        .then((result) => {
          setProviderApplication({ state: "settled", result });
          void latestReadRef.current();
        })
        .catch((error: unknown) => {
          if (error instanceof DOMException && error.name === "AbortError") return;
          setProviderApplication({
            state: "settled",
            result: {
              version: 1,
              state: "attention",
              action: request.action,
              condition: "provider-unavailable",
              acquisitionCount: 0,
              observations: [],
              diagnostics: [
                {
                  reference: "portal-provider-observation-failed",
                  summary: "Provider observation needs Agent Surface attention.",
                },
              ],
              explanation: "The provider observation request did not complete.",
              nextAction: "Open Bearing in the Agent Surface to diagnose the provider action.",
            },
          });
        })
        .finally(() => providerControllersRef.current.delete(controller));
    },
    [entryId, providerApplication.state],
  );

  const scopedState = activationStateForEntry(state, stateEntryIdRef.current, entryId);
  const candidate = visibleProjectView(scopedState);
  const view =
    candidate?.project.entryId === entryId && matchesQuery(candidate) ? candidate : undefined;
  const result = {
    state: scopedState,
    ...(scopedState.kind === "failed" ? { readFailure: scopedState.error } : {}),
    providerApplication,
    applyProviderObservation,
  };
  return view === undefined ? result : { ...result, view };
};
