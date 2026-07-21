import { expect, test } from "bun:test";
import { createProjectCoordinator } from "../src/portal/project-coordinator";

const deferred = <T>() => {
  let resolve: ((value: T) => void) | undefined;
  let reject: ((reason: unknown) => void) | undefined;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return {
    promise,
    resolve: (value: T): void => resolve?.(value),
    reject: (reason: unknown): void => reject?.(reason),
  };
};

test("coalesces same-project automatic checks and enforces the 30-second boundary", async () => {
  let now = 1_000;
  const active = deferred<string>();
  const secondActive = deferred<string>();
  let runs = 0;
  const coordinator = createProjectCoordinator({
    clock: () => now,
    run: async () => {
      runs += 1;
      return runs === 1 ? active.promise : secondActive.promise;
    },
  });
  const operation = { entryId: "one", mode: "ensure-current" } as const;

  const first = coordinator.execute(operation);
  const joined = coordinator.execute(operation);
  expect(runs).toBe(1);
  active.resolve("checked");
  expect(await first).toMatchObject({ kind: "completed", value: "checked" });
  expect(await joined).toMatchObject({ kind: "completed", value: "checked", joined: true });

  now = 30_999;
  expect(await coordinator.execute(operation)).toEqual({
    kind: "cooldown",
    cooldownRemainingMs: 1,
  });
  now = 31_000;
  const boundary = coordinator.execute(operation);
  secondActive.resolve("checked-again");
  expect(await boundary).toMatchObject({ kind: "completed", value: "checked-again" });
  expect(runs).toBe(2);
});

test("a failed automatic attempt still enters cooldown while force bypasses it", async () => {
  let now = 0;
  let attempts = 0;
  const coordinator = createProjectCoordinator<string>({
    clock: () => now,
    run: async ({ mode }) => {
      attempts += 1;
      if (mode === "ensure-current") throw new Error("validation failed");
      return "forced";
    },
  });
  const identity = { entryId: "one" } as const;

  await expect(coordinator.execute({ ...identity, mode: "ensure-current" })).rejects.toThrow(
    "validation failed",
  );
  now = 1;
  expect(await coordinator.execute({ ...identity, mode: "ensure-current" })).toEqual({
    kind: "cooldown",
    cooldownRemainingMs: 29_999,
  });
  expect(await coordinator.execute({ ...identity, mode: "force" })).toMatchObject({
    kind: "completed",
    value: "forced",
    executedMode: "force",
  });
  expect(attempts).toBe(2);
});

test("queues one shared force behind an active ensure instead of swallowing it", async () => {
  const ensure = deferred<string>();
  const force = deferred<string>();
  const modes: string[] = [];
  const coordinator = createProjectCoordinator<string>({
    run: async ({ mode }) => {
      modes.push(mode);
      return mode === "ensure-current" ? ensure.promise : force.promise;
    },
  });
  const identity = { entryId: "one" } as const;

  const checking = coordinator.execute({ ...identity, mode: "ensure-current" });
  const forced = coordinator.execute({ ...identity, mode: "force" });
  const joinedForce = coordinator.execute({ ...identity, mode: "force" });
  expect(modes).toEqual(["ensure-current"]);
  ensure.resolve("checked");
  await checking;
  await Promise.resolve();
  expect(modes).toEqual(["ensure-current", "force"]);
  force.resolve("forced");
  expect(await forced).toMatchObject({ value: "forced", executedMode: "force" });
  expect(await joinedForce).toMatchObject({ value: "forced", joined: true });
});

test("uses Catalog entry identity for single-flight when its repository path changes", async () => {
  const ensure = deferred<string>();
  const force = deferred<string>();
  let currentRepoRoot = "/repo/original";
  const resolvedRoots: string[] = [];
  const coordinator = createProjectCoordinator<string>({
    run: async ({ mode }) => {
      resolvedRoots.push(currentRepoRoot);
      return mode === "ensure-current" ? ensure.promise : force.promise;
    },
  });
  const original = { entryId: "one", mode: "ensure-current" } as const;
  const relinked = { entryId: "one", mode: "force" } as const;

  const checking = coordinator.execute(original);
  currentRepoRoot = "/repo/relinked";
  const forcing = coordinator.execute(relinked);

  expect(resolvedRoots).toEqual(["/repo/original"]);
  currentRepoRoot = "/repo/current";
  ensure.resolve("checked-original");
  await checking;
  await Promise.resolve();
  expect(resolvedRoots).toEqual(["/repo/original", "/repo/current"]);
  force.resolve("forced-current");
  expect(await forcing).toMatchObject({ value: "forced-current", executedMode: "force" });
});

test("different project identities do not block each other", async () => {
  const seen: string[] = [];
  const coordinator = createProjectCoordinator<string>({
    run: async ({ entryId }) => {
      seen.push(entryId);
      return entryId;
    },
  });

  const results = await Promise.all([
    coordinator.execute({ entryId: "one", mode: "force" }),
    coordinator.execute({ entryId: "two", mode: "force" }),
  ]);

  expect(seen.toSorted()).toEqual(["one", "two"]);
  expect(results.map((result) => result.kind)).toEqual(["completed", "completed"]);
});
