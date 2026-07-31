import type { NativeScopeInspectionIntent } from "../native-scope-inspection";
import { mattNativeBindingDefinitionKey } from "../providers/matt-skills-v1/native-subject";

export type ProjectOperationMode = "ensure-current" | "force";

export type ProjectOperation = Readonly<{
  entryId: string;
  mode: ProjectOperationMode;
  nativeScopeDiscoveryIntent?: "ordinary-sync" | "explicit-discovery";
  nativeScopeInspectionIntent?: NativeScopeInspectionIntent;
}>;

export type CoordinatedResult<T> =
  | Readonly<{ kind: "cooldown"; cooldownRemainingMs: number }>
  | Readonly<{
      kind: "completed";
      value: T;
      executedMode: ProjectOperationMode;
      joined: boolean;
    }>;

type Active<T> = Readonly<{
  mode: ProjectOperationMode;
  nativeScopeDiscoveryIntent: "ordinary-sync" | "explicit-discovery";
  nativeScopeInspectionIntent: NativeScopeInspectionIntent;
  nativeScopeInspectionKey: string;
  promise: Promise<T>;
}>;
type ProjectState<T> = {
  lastAttemptAt?: number;
  active?: Active<T>;
  queuedForces?: Map<string, Promise<T>>;
  queueTail?: Promise<unknown>;
};

const nativeScopeInspectionKey = (intent: NativeScopeInspectionIntent): string =>
  intent.kind === "none"
    ? "none"
    : `${mattNativeBindingDefinitionKey(intent.target)}\0${intent.refresh ? "refresh" : "reuse"}`;

export type ProjectCoordinator<T> = Readonly<{
  execute(operation: ProjectOperation): Promise<CoordinatedResult<T>>;
  status(identity: Readonly<{ entryId: string }>): Readonly<{
    due: boolean;
    cooldownRemainingMs: number;
    inFlight: boolean;
  }>;
}>;

export const createProjectCoordinator = <T>(options: {
  readonly run: (operation: ProjectOperation) => Promise<T>;
  readonly clock?: () => number;
  readonly cooldownMs?: number;
}): ProjectCoordinator<T> => {
  const clock = options.clock ?? Date.now;
  const cooldownMs = options.cooldownMs ?? 30_000;
  const states = new Map<string, ProjectState<T>>();
  const stateFor = (entryId: string): ProjectState<T> => {
    const existing = states.get(entryId);
    if (existing !== undefined) return existing;
    const created: ProjectState<T> = {};
    states.set(entryId, created);
    return created;
  };
  const remainingFor = (state: ProjectState<T>): number => {
    if (state.lastAttemptAt === undefined) return 0;
    return Math.max(0, cooldownMs - (clock() - state.lastAttemptAt));
  };
  const begin = (state: ProjectState<T>, operation: ProjectOperation): Promise<T> => {
    state.lastAttemptAt = clock();
    const running = options.run(operation);
    let promise: Promise<T>;
    const clear = <Value>(continuation: () => Value): Value => {
      if (state.active?.promise === promise) delete state.active;
      return continuation();
    };
    promise = running.then(
      (value) => clear(() => value),
      (error: unknown) =>
        clear(() => {
          throw error;
        }),
    );
    state.active = {
      mode: operation.mode,
      nativeScopeDiscoveryIntent: operation.nativeScopeDiscoveryIntent ?? "ordinary-sync",
      nativeScopeInspectionIntent: operation.nativeScopeInspectionIntent ?? { kind: "none" },
      nativeScopeInspectionKey: nativeScopeInspectionKey(
        operation.nativeScopeInspectionIntent ?? { kind: "none" },
      ),
      promise,
    };
    return promise;
  };
  const completed = async (
    promise: Promise<T>,
    executedMode: ProjectOperationMode,
    joined: boolean,
  ): Promise<CoordinatedResult<T>> => ({
    kind: "completed",
    value: await promise,
    executedMode,
    joined,
  });

  return {
    execute(operation): Promise<CoordinatedResult<T>> {
      const state = stateFor(operation.entryId);
      const active = state.active;
      const intent = operation.nativeScopeDiscoveryIntent ?? "ordinary-sync";
      const inspectionIntent = operation.nativeScopeInspectionIntent ?? { kind: "none" };
      const inspectionKey = nativeScopeInspectionKey(inspectionIntent);
      if (
        active !== undefined &&
        active.nativeScopeDiscoveryIntent === intent &&
        active.nativeScopeInspectionKey === inspectionKey &&
        (operation.mode === "ensure-current" || active.mode === "force")
      ) {
        return completed(active.promise, active.mode, true);
      }
      const queueKey = `force:${intent}:${inspectionKey}`;
      const existingQueue = state.queuedForces?.get(queueKey);
      if (existingQueue !== undefined) return completed(existingQueue, "force", true);
      const predecessor = state.queueTail ?? active?.promise;
      if (predecessor !== undefined) {
        const queues = state.queuedForces ?? new Map<string, Promise<T>>();
        state.queuedForces = queues;
        const pending = predecessor.then(
          () =>
            begin(state, {
              ...operation,
              mode: "force",
              nativeScopeDiscoveryIntent: intent,
              nativeScopeInspectionIntent: inspectionIntent,
            }),
          () =>
            begin(state, {
              ...operation,
              mode: "force",
              nativeScopeDiscoveryIntent: intent,
              nativeScopeInspectionIntent: inspectionIntent,
            }),
        );
        let queued: Promise<T>;
        const clearQueue = <Value>(continuation: () => Value): Value => {
          if (queues.get(queueKey) === queued) queues.delete(queueKey);
          return continuation();
        };
        queued = pending.then(
          (value) => clearQueue(() => value),
          (error: unknown) =>
            clearQueue(() => {
              throw error;
            }),
        );
        queues.set(queueKey, queued);
        const tail = queued.then(
          () => undefined,
          () => undefined,
        );
        state.queueTail = tail;
        void tail.then(() => {
          if (state.queueTail === tail) delete state.queueTail;
        });
        return completed(queued, "force", false);
      }
      const cooldownRemainingMs = remainingFor(state);
      if (operation.mode === "ensure-current" && cooldownRemainingMs > 0) {
        return Promise.resolve({ kind: "cooldown", cooldownRemainingMs });
      }
      return completed(begin(state, operation), operation.mode, false);
    },
    status(identity) {
      const state = stateFor(identity.entryId);
      const cooldownRemainingMs = remainingFor(state);
      return {
        due: cooldownRemainingMs === 0,
        cooldownRemainingMs,
        inFlight: state.active !== undefined || (state.queuedForces?.size ?? 0) > 0,
      };
    },
  };
};
