import { useCallback, useEffect, useReducer, useRef } from "react";
import {
  createDeferredActivation,
  interactionNeedsActivation,
  manualActionOwnsActivation,
} from "./project-activation-events";
import {
  type ActivationAction,
  type ActivationState,
  activationStateForEntry,
  projectActivationReducer,
  transitionForSyncResult,
  visibleProjectView,
} from "./project-activation-state";
import {
  type ProjectOperationError,
  type ProjectView,
  readProjectSnapshot,
  syncProject,
} from "./project-contract";

const requestFailure = (operation: "check" | "sync"): ProjectOperationError => ({
  code: "sync-failed",
  message:
    operation === "check"
      ? "Project currency could not be checked."
      : "Project reconciliation could not be completed.",
});

export type ProjectActivation = Readonly<{
  state: ActivationState;
  view?: ProjectView;
  forceSync: () => void;
  retry: () => void;
}>;

export const useProjectActivation = (entryId: string): ProjectActivation => {
  const [state, dispatch] = useReducer(projectActivationReducer, { kind: "loading-cache" });
  const stateRef = useRef(state);
  const stateEntryIdRef = useRef(entryId);
  const csrfTokenRef = useRef<string | undefined>(undefined);
  const requestIdRef = useRef(0);
  const busyRequestRef = useRef<number | undefined>(undefined);
  const automaticRequestRef = useRef<number | undefined>(undefined);
  const controllersRef = useRef(new Set<AbortController>());
  const confirmationTimerRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const dispatchCurrent = useCallback((requestId: number, action: ActivationAction): boolean => {
    if (requestId !== requestIdRef.current) return false;
    dispatch(action);
    return true;
  }, []);

  const applySyncResult = useCallback(
    (requestId: number, result: Awaited<ReturnType<typeof syncProject>>) => {
      const transition = transitionForSyncResult(result);
      if (!dispatchCurrent(requestId, transition.action)) return;
      if (transition.confirmation === undefined) return;
      const view = result.state === "completed" ? result.view : undefined;
      if (view === undefined) return;
      if (confirmationTimerRef.current !== undefined) {
        window.clearTimeout(confirmationTimerRef.current);
      }
      confirmationTimerRef.current = window.setTimeout(() => {
        dispatchCurrent(requestId, {
          type: "settled",
          confirmation: transition.confirmation?.value ?? "up-to-date",
          view,
        });
      }, transition.confirmation.delayMs);
    },
    [dispatchCurrent],
  );

  const withController = useCallback(
    async <Result>(run: (signal: AbortSignal) => Promise<Result>): Promise<Result> => {
      const controller = new AbortController();
      controllersRef.current.add(controller);
      try {
        return await run(controller.signal);
      } finally {
        controllersRef.current.delete(controller);
      }
    },
    [],
  );

  const activate = useCallback(async () => {
    if (busyRequestRef.current !== undefined) return;
    stateEntryIdRef.current = entryId;
    const requestId = ++requestIdRef.current;
    busyRequestRef.current = requestId;
    automaticRequestRef.current = requestId;
    const candidate = visibleProjectView(stateRef.current);
    const cached = candidate?.project.entryId === entryId ? candidate : undefined;
    let retained = cached;
    dispatch(cached === undefined ? { type: "load-started" } : { type: "checking", view: cached });
    try {
      const envelope = await withController((signal) => readProjectSnapshot(entryId, signal));
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
      retained = envelope.view;
      if (!envelope.validation.due && !envelope.validation.inFlight) {
        dispatch({
          type: "settled",
          confirmation: "checked-recently",
          view: envelope.view,
        });
        return;
      }
      dispatch({ type: "checking", view: envelope.view });
      const result = await withController((signal) =>
        syncProject(entryId, "ensure-current", envelope.session.csrfToken, signal),
      );
      applySyncResult(requestId, result);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      dispatchCurrent(requestId, {
        type: "failed",
        operation: "check",
        error: requestFailure("check"),
        ...(retained === undefined ? {} : { view: retained }),
      });
    } finally {
      if (busyRequestRef.current === requestId) busyRequestRef.current = undefined;
      if (automaticRequestRef.current === requestId) automaticRequestRef.current = undefined;
    }
  }, [applySyncResult, dispatchCurrent, entryId, withController]);

  const forceSync = useCallback(() => {
    const csrfToken = csrfTokenRef.current;
    const busyRequest = busyRequestRef.current;
    if (
      csrfToken === undefined ||
      (busyRequest !== undefined && busyRequest !== automaticRequestRef.current)
    ) {
      return;
    }
    const requestId = ++requestIdRef.current;
    if (busyRequest !== undefined) {
      for (const controller of controllersRef.current) controller.abort();
      controllersRef.current.clear();
    }
    busyRequestRef.current = requestId;
    automaticRequestRef.current = undefined;
    const candidate = visibleProjectView(stateRef.current);
    const cached = candidate?.project.entryId === entryId ? candidate : undefined;
    dispatch(cached === undefined ? { type: "syncing" } : { type: "syncing", view: cached });
    void withController((signal) => syncProject(entryId, "force", csrfToken, signal))
      .then((result) => applySyncResult(requestId, result))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        dispatchCurrent(requestId, {
          type: "failed",
          operation: "sync",
          error: requestFailure("sync"),
          ...(cached === undefined ? {} : { view: cached }),
        });
      })
      .finally(() => {
        if (busyRequestRef.current === requestId) busyRequestRef.current = undefined;
      });
  }, [applySyncResult, dispatchCurrent, entryId, withController]);

  useEffect(() => {
    csrfTokenRef.current = undefined;
    void activate();
    return () => {
      requestIdRef.current += 1;
      busyRequestRef.current = undefined;
      automaticRequestRef.current = undefined;
      for (const controller of controllersRef.current) controller.abort();
      controllersRef.current.clear();
      if (confirmationTimerRef.current !== undefined) {
        window.clearTimeout(confirmationTimerRef.current);
      }
    };
  }, [activate]);

  useEffect(() => {
    let lastActivityAt = Date.now();
    const deferredActivation = createDeferredActivation(() => void activate());
    const queueActivation = () => {
      if (busyRequestRef.current === undefined) deferredActivation.schedule();
    };
    const visible = () => {
      if (document.visibilityState === "visible") queueActivation();
    };
    const interaction = (event: PointerEvent | KeyboardEvent) => {
      const currentActivityAt = Date.now();
      const shouldActivate = interactionNeedsActivation(lastActivityAt, currentActivityAt);
      lastActivityAt = currentActivityAt;
      if (manualActionOwnsActivation(event)) {
        deferredActivation.cancel();
        return;
      }
      if (shouldActivate) queueActivation();
    };
    window.addEventListener("online", queueActivation);
    window.addEventListener("focus", queueActivation);
    document.addEventListener("visibilitychange", visible);
    window.addEventListener("pointerdown", interaction, true);
    window.addEventListener("keydown", interaction, true);
    return () => {
      window.removeEventListener("online", queueActivation);
      window.removeEventListener("focus", queueActivation);
      document.removeEventListener("visibilitychange", visible);
      window.removeEventListener("pointerdown", interaction, true);
      window.removeEventListener("keydown", interaction, true);
      deferredActivation.cancel();
    };
  }, [activate]);

  const retry = useCallback(() => {
    const current = stateRef.current;
    if (current.kind === "failed" && csrfTokenRef.current !== undefined) {
      forceSync();
      return;
    }
    void activate();
  }, [activate, forceSync]);

  const scopedState = activationStateForEntry(state, stateEntryIdRef.current, entryId);
  const candidate = visibleProjectView(scopedState);
  const view = candidate?.project.entryId === entryId ? candidate : undefined;
  return view === undefined
    ? { state: scopedState, forceSync, retry }
    : { state: scopedState, view, forceSync, retry };
};
