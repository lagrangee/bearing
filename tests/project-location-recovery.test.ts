import { expect, test } from "bun:test";
import type { CoordinatedResult, ProjectOperationMode } from "../src/portal/project-coordinator";
import {
  type CapturedProjectOperation,
  createProjectLocationRecovery,
} from "../src/portal/project-location-recovery";
import type { ProjectMaterializationResult } from "../src/portal/project-materializer";
import type { ProjectRepoView } from "../src/portal/project-view";

const deferred = <Value>() => {
  let resolvePromise: ((value: Value) => void) | undefined;
  let rejectPromise: ((error: Error) => void) | undefined;
  const promise = new Promise<Value>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return {
    promise,
    resolve: (value: Value): void => resolvePromise?.(value),
    reject: (error: Error): void => rejectPromise?.(error),
  };
};

const completedCapture = (
  repoRoot: string,
  mode: ProjectOperationMode = "force",
): Extract<CapturedProjectOperation, Readonly<{ kind: "completed" }>> => ({
  kind: "completed",
  entry: { entryId: "project-1", displayName: "Fixture", repoRoot },
  result: {
    mode,
    outcome: mode === "force" ? "no-op" : "checked",
    snapshotDisposition: "reused",
    snapshot: {},
    ...(mode === "force" ? { reconciliation: "no-op" } : {}),
  } as ProjectMaterializationResult,
  repoView: {} as ProjectRepoView,
});

const coordinated = (
  capture: CapturedProjectOperation,
): CoordinatedResult<CapturedProjectOperation> => ({
  kind: "completed",
  value: capture,
  executedMode: capture.kind === "completed" ? capture.result.mode : "force",
  joined: false,
});

test("does not reuse a force that is older than the latest operation generation", async () => {
  const executions: ProjectOperationMode[] = [];
  let recovery: ReturnType<typeof createProjectLocationRecovery>;
  recovery = createProjectLocationRecovery({
    execute: async (_entryId, mode) => {
      executions.push(mode);
      return coordinated(recovery.record("project-1", completedCapture("/repo/a", "force")));
    },
  });
  const callerCheckpoint = recovery.checkpoint("project-1");
  recovery.record("project-1", completedCapture("/repo/a", "force"));
  recovery.record("project-1", {
    kind: "entry-failure",
    result: { kind: "not-found" },
  });

  await recovery.recover("project-1", "/repo/a", callerCheckpoint);

  expect(executions).toEqual(["ensure-current"]);
});

test("removes a settled recovery before a later caller can reuse its promise", async () => {
  let executions = 0;
  let recovery: ReturnType<typeof createProjectLocationRecovery>;
  recovery = createProjectLocationRecovery({
    execute: async () => {
      executions += 1;
      return coordinated(recovery.record("project-1", completedCapture("/repo/a")));
    },
  });

  await recovery.recover("project-1", "/repo/a", recovery.checkpoint("project-1"));
  const laterCheckpoint = recovery.checkpoint("project-1");
  await recovery.recover("project-1", "/repo/a", laterCheckpoint);

  expect(executions).toBe(2);
});

test("joins only callers from the same in-flight recovery generation", async () => {
  const pending = deferred<CoordinatedResult<CapturedProjectOperation>>();
  let executions = 0;
  const recovery = createProjectLocationRecovery({
    execute: () => {
      executions += 1;
      return pending.promise;
    },
  });
  const sharedCheckpoint = recovery.checkpoint("project-1");

  const first = recovery.recover("project-1", "/repo/a", sharedCheckpoint);
  const sameGeneration = recovery.recover("project-1", "/repo/a", sharedCheckpoint);
  expect(executions).toBe(1);
  pending.resolve(coordinated(completedCapture("/repo/a")));

  expect(await first).toEqual(await sameGeneration);
  expect(executions).toBe(1);
});

test("cleans up a rejected recovery without replaying it to a later caller", async () => {
  const firstFailure = deferred<CoordinatedResult<CapturedProjectOperation>>();
  let executions = 0;
  const recovery = createProjectLocationRecovery({
    execute: () => {
      executions += 1;
      return executions === 1
        ? firstFailure.promise
        : Promise.resolve(coordinated(completedCapture("/repo/a")));
    },
  });
  const failed = recovery.recover("project-1", "/repo/a", recovery.checkpoint("project-1"));
  const observed = failed.then(
    () => undefined,
    (error: unknown) => error,
  );
  firstFailure.reject(new Error("recovery failed"));
  expect(await observed).toMatchObject({ message: "recovery failed" });

  await recovery.recover("project-1", "/repo/a", recovery.checkpoint("project-1"));

  expect(executions).toBe(2);
});

test("owns locator observation and relink cooldown invalidation", () => {
  const recovery = createProjectLocationRecovery({
    execute: async () => coordinated(completedCapture("/repo/a")),
    status: () => ({ due: false, cooldownRemainingMs: 20_000, inFlight: false }),
  });

  expect(recovery.validation("project-1", "/repo/b")).toEqual({
    due: false,
    cooldownRemainingMs: 20_000,
    inFlight: false,
  });
  expect(recovery.rootRequiringRecovery("project-1", "ensure-current", "/repo/b")).toBeUndefined();

  recovery.observeLocator("project-1", "/repo/a");

  expect(recovery.validation("project-1", "/repo/a")).toEqual({
    due: false,
    cooldownRemainingMs: 20_000,
    inFlight: false,
  });
  expect(recovery.validation("project-1", "/repo/b")).toEqual({
    due: true,
    cooldownRemainingMs: 0,
    inFlight: false,
  });
  expect(recovery.rootRequiringRecovery("project-1", "ensure-current", "/repo/b")).toBe("/repo/b");
  expect(recovery.rootRequiringRecovery("project-1", "force", "/repo/b")).toBeUndefined();
});
