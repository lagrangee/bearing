export const LIVE_MATRIX_CONCURRENCY = 4 as const;

export type LiveMatrixScheduleEntry<Task> = Readonly<{
  task: Task;
  resourceKey?: string;
}>;

export type LiveMatrixTerminalResult<Task, Result> = Readonly<{
  task: Task;
  resourceKey?: string;
  state: "terminal";
  result: PromiseSettledResult<Result>;
}>;

export type LiveMatrixScheduleResult<Task, Result> = Readonly<{
  results: readonly LiveMatrixTerminalResult<Task, Result>[];
  peakConcurrency: number;
}>;

type LiveMatrixScheduleState = "pending" | "active" | "terminal";

const terminalResult = <Task, Result>(
  entry: LiveMatrixScheduleEntry<Task>,
  result: PromiseSettledResult<Result>,
): LiveMatrixTerminalResult<Task, Result> => ({
  task: entry.task,
  ...(entry.resourceKey === undefined ? {} : { resourceKey: entry.resourceKey }),
  state: "terminal",
  result,
});

export const runLiveMatrixSchedule = async <Task, Result>(
  entries: readonly LiveMatrixScheduleEntry<Task>[],
  run: (task: Task) => Promise<Result>,
): Promise<LiveMatrixScheduleResult<Task, Result>> => {
  const states: LiveMatrixScheduleState[] = entries.map(() => "pending");
  const results: Array<LiveMatrixTerminalResult<Task, Result> | undefined> = entries.map(
    () => undefined,
  );
  const activeResourceKeys = new Set<string>();
  const active = new Map<number, Promise<void>>();
  let peakConcurrency = 0;

  const nextEligibleIndex = (): number =>
    states.findIndex((state, index) => {
      const entry = entries[index];
      return (
        state === "pending" &&
        entry !== undefined &&
        (entry.resourceKey === undefined || !activeResourceKeys.has(entry.resourceKey))
      );
    });

  const launch = (index: number): void => {
    const entry = entries[index];
    if (entry === undefined) throw new Error(`Missing Live Matrix entry at index ${index}.`);

    states[index] = "active";
    if (entry.resourceKey !== undefined) activeResourceKeys.add(entry.resourceKey);

    const execution = Promise.resolve()
      .then(() => run(entry.task))
      .then(
        (value) => {
          results[index] = terminalResult(entry, { status: "fulfilled", value });
        },
        (reason: unknown) => {
          results[index] = terminalResult(entry, { status: "rejected", reason });
        },
      )
      .finally(() => {
        states[index] = "terminal";
        if (entry.resourceKey !== undefined) activeResourceKeys.delete(entry.resourceKey);
        active.delete(index);
      });

    active.set(index, execution);
    peakConcurrency = Math.max(peakConcurrency, active.size);
  };

  while (states.some((state) => state !== "terminal")) {
    while (active.size < LIVE_MATRIX_CONCURRENCY) {
      const index = nextEligibleIndex();
      if (index === -1) break;
      launch(index);
    }

    const nextTerminal = active.values().next().value;
    if (nextTerminal === undefined) {
      throw new Error("Live Matrix scheduler has pending work but no eligible Scenario.");
    }
    await Promise.race(active.values());
  }

  return {
    results: results.map((result, index) => {
      if (result === undefined) {
        throw new Error(`Missing terminal Live Matrix result at index ${index}.`);
      }
      return result;
    }),
    peakConcurrency,
  };
};
