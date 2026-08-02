import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import {
  createDeferredActivation,
  interactionNeedsActivation,
  manualActionOwnsActivation,
  visibilityReturnNeedsActivation,
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
  discoverNativeScopes,
  InvalidProjectSessionError,
  inspectNativeScope,
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
  discovery: Readonly<{ state: "idle" | "running" | "failed" }>;
  refreshDiscovery: () => void;
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

export const useProjectActivation = (entryId: string): ProjectActivation => {
  const [state, dispatch] = useReducer(projectActivationReducer, { kind: "loading-cache" });
  const [discovery, setDiscovery] = useState<Readonly<{ state: "idle" | "running" | "failed" }>>({
    state: "idle",
  });
  const [inspection, setInspection] = useState<
    Readonly<{
      state: "idle" | "running" | "failed";
      subjectKey?: string | undefined;
    }>
  >({ state: "idle" });
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

  const withSessionRecovery = useCallback(
    async function withSessionRecovery<Result>(
      csrfToken: string,
      signal: AbortSignal,
      run: (currentCsrfToken: string, currentSignal: AbortSignal) => Promise<Result>,
    ): Promise<Result> {
      try {
        return await run(csrfToken, signal);
      } catch (error) {
        if (!(error instanceof InvalidProjectSessionError)) throw error;
        const envelope = await readProjectSnapshot(entryId, signal);
        const currentCsrfToken = envelope.session.csrfToken;
        csrfTokenRef.current = currentCsrfToken;
        return run(currentCsrfToken, signal);
      }
    },
    [entryId],
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
        withSessionRecovery(envelope.session.csrfToken, signal, (currentCsrfToken, currentSignal) =>
          syncProject(entryId, "ensure-current", currentCsrfToken, currentSignal),
        ),
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
  }, [applySyncResult, dispatchCurrent, entryId, withController, withSessionRecovery]);

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
    void withController((signal) =>
      withSessionRecovery(csrfToken, signal, (currentCsrfToken, currentSignal) =>
        syncProject(entryId, "force", currentCsrfToken, currentSignal),
      ),
    )
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
  }, [applySyncResult, dispatchCurrent, entryId, withController, withSessionRecovery]);

  const refreshDiscovery = useCallback(() => {
    const csrfToken = csrfTokenRef.current;
    if (csrfToken === undefined || discovery.state === "running") return;
    const requestId = ++requestIdRef.current;
    const candidate = visibleProjectView(stateRef.current);
    const cached = candidate?.project.entryId === entryId ? candidate : undefined;
    setDiscovery({ state: "running" });
    void withController((signal) =>
      withSessionRecovery(csrfToken, signal, (currentCsrfToken, currentSignal) =>
        discoverNativeScopes(entryId, currentCsrfToken, currentSignal),
      ),
    )
      .then((result) => {
        applySyncResult(requestId, result);
        setDiscovery(result.state === "failed" ? { state: "failed" } : { state: "idle" });
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") {
          setDiscovery({ state: "idle" });
          return;
        }
        setDiscovery({ state: "failed" });
        if (cached !== undefined) {
          dispatchCurrent(requestId, {
            type: "settled",
            confirmation: "checked-recently",
            view: cached,
          });
        }
      });
  }, [
    applySyncResult,
    discovery.state,
    dispatchCurrent,
    entryId,
    withController,
    withSessionRecovery,
  ]);

  const inspectScope = useCallback(
    (
      subject: Readonly<{ kind: "native-scope" | "native-subject"; id: string }>,
      target: Readonly<{ provider: "matt-skills/v1"; nativeScope: string }>,
      refresh: boolean,
    ) => {
      const csrfToken = csrfTokenRef.current;
      const subjectKey = `${subject.kind}:${subject.id}`;
      if (csrfToken === undefined || inspection.state === "running") return;
      const requestId = ++requestIdRef.current;
      busyRequestRef.current = requestId;
      automaticRequestRef.current = undefined;
      const candidate = visibleProjectView(stateRef.current);
      const cached = candidate?.project.entryId === entryId ? candidate : undefined;
      setInspection({ state: "running", subjectKey });
      void withController((signal) =>
        withSessionRecovery(csrfToken, signal, (currentCsrfToken, currentSignal) =>
          inspectNativeScope(entryId, subject, target, refresh, currentCsrfToken, currentSignal),
        ),
      )
        .then((result) => {
          applySyncResult(requestId, result);
          setInspection(
            result.state === "failed"
              ? { state: "failed", subjectKey }
              : { state: "idle", subjectKey },
          );
        })
        .catch((error: unknown) => {
          if (error instanceof DOMException && error.name === "AbortError") {
            setInspection({ state: "idle" });
            return;
          }
          setInspection({ state: "failed", subjectKey });
          if (cached !== undefined) {
            dispatchCurrent(requestId, {
              type: "settled",
              confirmation: "checked-recently",
              view: cached,
            });
          }
        })
        .finally(() => {
          if (busyRequestRef.current === requestId) busyRequestRef.current = undefined;
        });
    },
    [
      applySyncResult,
      dispatchCurrent,
      entryId,
      inspection.state,
      withController,
      withSessionRecovery,
    ],
  );

  useEffect(() => {
    csrfTokenRef.current = undefined;
    setDiscovery({ state: "idle" });
    setInspection({ state: "idle" });
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
    let previousVisibilityState = document.visibilityState;
    let hiddenAt = previousVisibilityState === "hidden" ? Date.now() : undefined;
    const deferredActivation = createDeferredActivation(() => void activate());
    const queueActivation = () => {
      if (busyRequestRef.current === undefined) deferredActivation.schedule();
    };
    const visibilityChanged = () => {
      const currentActivityAt = Date.now();
      const currentVisibilityState = document.visibilityState;
      if (previousVisibilityState !== "hidden" && currentVisibilityState === "hidden") {
        hiddenAt = currentActivityAt;
      }
      const shouldActivate = visibilityReturnNeedsActivation(
        previousVisibilityState,
        currentVisibilityState,
        hiddenAt,
        currentActivityAt,
      );
      previousVisibilityState = currentVisibilityState;
      if (currentVisibilityState === "visible") hiddenAt = undefined;
      if (shouldActivate) queueActivation();
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
    document.addEventListener("visibilitychange", visibilityChanged);
    window.addEventListener("pointerdown", interaction, true);
    window.addEventListener("keydown", interaction, true);
    return () => {
      window.removeEventListener("online", queueActivation);
      document.removeEventListener("visibilitychange", visibilityChanged);
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
    ? {
        state: scopedState,
        forceSync,
        retry,
        discovery,
        refreshDiscovery,
        inspection,
        inspectNativeScope: inspectScope,
      }
    : {
        state: scopedState,
        view,
        forceSync,
        retry,
        discovery,
        refreshDiscovery,
        inspection,
        inspectNativeScope: inspectScope,
      };
};
