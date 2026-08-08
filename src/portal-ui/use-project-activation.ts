import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import {
  type PlanningLineageSubject,
  planningLineageSubjectSchema,
} from "../planning-lineage-route";
import type { PortalProjectSection } from "../portal-project-read-wire";
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
  requestNativeScopeInspection,
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
  forceSync: () => void;
  retry: () => void;
  inspection: Readonly<{
    state: "idle" | "running" | "failed";
    subjectKey?: string | undefined;
  }>;
  inspectNativeScope: (
    subject: Readonly<{ kind: "native-scope" | "native-subject"; id: string }>,
    target: Readonly<{ provider: "matt-skills/v1"; nativeScope: string }>,
    refresh: boolean,
  ) => void;
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
  const [inspection, setInspection] = useState<ProjectActivation["inspection"]>({ state: "idle" });
  const stateRef = useRef(state);
  const stateEntryIdRef = useRef(entryId);
  const csrfTokenRef = useRef<string | undefined>(undefined);
  const requestIdRef = useRef(0);
  const controllersRef = useRef(new Set<AbortController>());
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
    controllersRef.current.add(controller);
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
      controllersRef.current.delete(controller);
    }
  }, [entryId, matchesQuery, queryTarget, section]);

  useEffect(() => {
    csrfTokenRef.current = undefined;
    setInspection({ state: "idle" });
    void read();
    return () => {
      requestIdRef.current += 1;
      for (const controller of controllersRef.current) controller.abort();
      controllersRef.current.clear();
    };
  }, [read]);

  const inspectNativeScope = useCallback(
    (
      subject: Readonly<{ kind: "native-scope" | "native-subject"; id: string }>,
      target: Readonly<{ provider: "matt-skills/v1"; nativeScope: string }>,
      refresh: boolean,
    ) => {
      const csrfToken = csrfTokenRef.current;
      if (csrfToken === undefined || inspection.state === "running") return;
      const subjectKey = `${subject.kind}:${subject.id}`;
      const controller = new AbortController();
      controllersRef.current.add(controller);
      setInspection({ state: "running", subjectKey });
      void requestNativeScopeInspection(
        entryId,
        subject,
        target,
        refresh,
        csrfToken,
        controller.signal,
      )
        .then(async () => {
          await read();
          setInspection({ state: "idle", subjectKey });
        })
        .catch((error: unknown) => {
          if (error instanceof DOMException && error.name === "AbortError") return;
          setInspection({ state: "failed", subjectKey });
        })
        .finally(() => controllersRef.current.delete(controller));
    },
    [entryId, inspection.state, read],
  );

  const scopedState = activationStateForEntry(state, stateEntryIdRef.current, entryId);
  const candidate = visibleProjectView(scopedState);
  const view =
    candidate?.project.entryId === entryId && matchesQuery(candidate) ? candidate : undefined;
  const result = {
    state: scopedState,
    forceSync: () => void read(),
    retry: () => void read(),
    inspection,
    inspectNativeScope,
  };
  return view === undefined ? result : { ...result, view };
};
