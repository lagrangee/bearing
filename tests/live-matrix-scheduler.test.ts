import { describe, expect, test } from "bun:test";
import { LIVE_MATRIX_CONCURRENCY, runLiveMatrixSchedule } from "../scripts/live-matrix-scheduler";

const deferred = () => {
  let resolvePromise: (() => void) | undefined;
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve: () => {
      const resolve = resolvePromise;
      if (resolve === undefined) throw new Error("Deferred promise is unavailable.");
      resolve();
    },
  };
};

describe("Live Matrix scheduler", () => {
  test("starts four Scenarios and refills the first registry-order slot as one finishes", async () => {
    const gates = Array.from({ length: 6 }, deferred);
    const firstFourStarted = deferred();
    const fifthStarted = deferred();
    const started: number[] = [];
    let active = 0;
    let maximumActive = 0;

    const scheduled = runLiveMatrixSchedule(
      Array.from({ length: 6 }, (_, task) => ({ task })),
      async (task) => {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        started.push(task);
        if (started.length === LIVE_MATRIX_CONCURRENCY) firstFourStarted.resolve();
        if (task === 4) fifthStarted.resolve();
        try {
          await gates[task]?.promise;
          return task;
        } finally {
          active -= 1;
        }
      },
    );

    await firstFourStarted.promise;
    expect(started).toEqual([0, 1, 2, 3]);
    expect(maximumActive).toBe(4);

    gates[1]?.resolve();
    await fifthStarted.promise;
    expect(started).toEqual([0, 1, 2, 3, 4]);
    expect(maximumActive).toBe(4);

    for (const gate of gates) gate.resolve();
    const { results, peakConcurrency } = await scheduled;
    expect(started).toEqual([0, 1, 2, 3, 4, 5]);
    expect(peakConcurrency).toBe(4);
    expect(results.map(({ task, state }) => ({ task, state }))).toEqual(
      Array.from({ length: 6 }, (_, task) => ({ task, state: "terminal" })),
    );
  });

  test("serializes one optional Resource Key while unrelated Scenarios keep running", async () => {
    const gates = [deferred(), deferred(), deferred(), deferred()];
    const firstPairStarted = deferred();
    const secondSharedStarted = deferred();
    const thirdSharedStarted = deferred();
    const started: number[] = [];
    let sharedActive = 0;
    let maximumSharedActive = 0;

    const scheduled = runLiveMatrixSchedule(
      [
        { task: 0, resourceKey: "github" },
        { task: 1, resourceKey: "github" },
        { task: 2 },
        { task: 3, resourceKey: "github" },
      ],
      async (task) => {
        started.push(task);
        if (started.length === 2) firstPairStarted.resolve();
        const shared = task !== 2;
        if (shared) {
          sharedActive += 1;
          maximumSharedActive = Math.max(maximumSharedActive, sharedActive);
          if (task === 1) secondSharedStarted.resolve();
          if (task === 3) thirdSharedStarted.resolve();
        }
        try {
          await gates[task]?.promise;
          return task;
        } finally {
          if (shared) sharedActive -= 1;
        }
      },
    );

    await firstPairStarted.promise;
    expect(started).toEqual([0, 2]);

    gates[0]?.resolve();
    await secondSharedStarted.promise;
    expect(started).toEqual([0, 2, 1]);

    gates[1]?.resolve();
    await thirdSharedStarted.promise;
    expect(started).toEqual([0, 2, 1, 3]);
    expect(maximumSharedActive).toBe(1);

    for (const gate of gates) gate.resolve();
    const { peakConcurrency } = await scheduled;
    expect(peakConcurrency).toBe(2);
  });

  test("records a rejected Scenario without stopping fail, blocked, or passing results", async () => {
    const { results, peakConcurrency } = await runLiveMatrixSchedule(
      [{ task: "error" }, { task: "fail" }, { task: "blocked" }, { task: "pass" }],
      async (task) => {
        if (task === "error") throw new Error("scenario crashed");
        return { outcome: task };
      },
    );

    expect(
      results.map(({ task, state, result }) => ({ task, state, status: result.status })),
    ).toEqual([
      { task: "error", state: "terminal", status: "rejected" },
      { task: "fail", state: "terminal", status: "fulfilled" },
      { task: "blocked", state: "terminal", status: "fulfilled" },
      { task: "pass", state: "terminal", status: "fulfilled" },
    ]);
    expect(results.slice(1).map(({ result }) => result)).toEqual([
      { status: "fulfilled", value: { outcome: "fail" } },
      { status: "fulfilled", value: { outcome: "blocked" } },
      { status: "fulfilled", value: { outcome: "pass" } },
    ]);
    expect(peakConcurrency).toBe(4);
  });

  test("reports zero peak concurrency when there is no scheduled work", async () => {
    const run = () => Promise.resolve("unused");
    const scheduled = await runLiveMatrixSchedule([], run);

    expect(scheduled).toEqual({ results: [], peakConcurrency: 0 });
  });
});
