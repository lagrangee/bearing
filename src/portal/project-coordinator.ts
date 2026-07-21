export type ProjectOperationMode = "ensure-current" | "force";

export type ProjectOperation = Readonly<{
  entryId: string;
  mode: ProjectOperationMode;
}>;

export type CoordinatedResult<T> =
  | Readonly<{ kind: "cooldown"; cooldownRemainingMs: number }>
  | Readonly<{
      kind: "completed";
      value: T;
      executedMode: ProjectOperationMode;
      joined: boolean;
    }>;

type Active<T> = Readonly<{ mode: ProjectOperationMode; promise: Promise<T> }>;
type ProjectState<T> = {
  lastAttemptAt?: number;
  active?: Active<T>;
  queuedForce?: Promise<T>;
};

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
    const running = options.run({ entryId: operation.entryId, mode: operation.mode });
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
    state.active = { mode: operation.mode, promise };
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
      if (active !== undefined) {
        if (operation.mode === "ensure-current" || active.mode === "force") {
          return completed(active.promise, active.mode, true);
        }
        const existingQueue = state.queuedForce;
        if (existingQueue !== undefined) return completed(existingQueue, "force", true);
        const pending = active.promise.then(
          () => begin(state, { ...operation, mode: "force" }),
          () => begin(state, { ...operation, mode: "force" }),
        );
        let queued: Promise<T>;
        const clearQueue = <Value>(continuation: () => Value): Value => {
          if (state.queuedForce === queued) delete state.queuedForce;
          return continuation();
        };
        queued = pending.then(
          (value) => clearQueue(() => value),
          (error: unknown) =>
            clearQueue(() => {
              throw error;
            }),
        );
        state.queuedForce = queued;
        return completed(queued, "force", false);
      }
      if (state.queuedForce !== undefined) return completed(state.queuedForce, "force", true);
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
        inFlight: state.active !== undefined || state.queuedForce !== undefined,
      };
    },
  };
};
