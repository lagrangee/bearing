import { expect, test } from "bun:test";
import {
  nativeReconciliationRequestSchema,
  normalizeNativeReconciliationRequest,
} from "../src/native-reconciliation-contract";
import { createProjectCoordinator } from "../src/portal/project-coordinator";
import { encodeGitHubMattNativeScope } from "../src/providers/matt-skills-v1/github-native-scope";

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

test("deduplicates explicit discovery and never swallows it into an ordinary force", async () => {
  const ordinary = deferred<string>();
  const discovery = deferred<string>();
  const calls: string[] = [];
  const coordinator = createProjectCoordinator({
    run: async (operation) => {
      const intent = operation.nativeScopeDiscoveryIntent ?? "ordinary-sync";
      calls.push(intent);
      return intent === "explicit-discovery" ? discovery.promise : ordinary.promise;
    },
  });

  const forced = coordinator.execute({ entryId: "project", mode: "force" });
  const firstDiscovery = coordinator.execute({
    entryId: "project",
    mode: "force",
    nativeScopeDiscoveryIntent: "explicit-discovery",
  });
  const secondDiscovery = coordinator.execute({
    entryId: "project",
    mode: "force",
    nativeScopeDiscoveryIntent: "explicit-discovery",
  });
  expect(calls).toEqual(["ordinary-sync"]);

  ordinary.resolve("ordinary");
  expect(await forced).toMatchObject({ kind: "completed", value: "ordinary" });
  await Promise.resolve();
  expect(calls).toEqual(["ordinary-sync", "explicit-discovery"]);
  discovery.resolve("discovered");
  expect(await firstDiscovery).toMatchObject({
    kind: "completed",
    value: "discovered",
    joined: false,
  });
  expect(await secondDiscovery).toMatchObject({
    kind: "completed",
    value: "discovered",
    joined: true,
  });
});

test("serializes different queued refresh intents behind the same active operation", async () => {
  const active = deferred<string>();
  const discovery = deferred<string>();
  const ordinary = deferred<string>();
  const calls: string[] = [];
  let ordinaryRuns = 0;
  const coordinator = createProjectCoordinator({
    run: async (operation) => {
      const intent = operation.nativeScopeDiscoveryIntent ?? "ordinary-sync";
      calls.push(intent);
      if (calls.length === 1) return active.promise;
      if (intent === "explicit-discovery") return discovery.promise;
      ordinaryRuns += 1;
      return ordinary.promise;
    },
  });

  const checking = coordinator.execute({ entryId: "project", mode: "ensure-current" });
  const discovering = coordinator.execute({
    entryId: "project",
    mode: "force",
    nativeScopeDiscoveryIntent: "explicit-discovery",
  });
  const forcing = coordinator.execute({ entryId: "project", mode: "force" });
  expect(calls).toEqual(["ordinary-sync"]);

  active.resolve("checked");
  await checking;
  await Promise.resolve();
  expect(calls).toEqual(["ordinary-sync", "explicit-discovery"]);

  discovery.resolve("discovered");
  await discovering;
  await Promise.resolve();
  expect(calls).toEqual(["ordinary-sync", "explicit-discovery", "ordinary-sync"]);
  expect(ordinaryRuns).toBe(1);

  ordinary.resolve("forced");
  expect(await forcing).toMatchObject({ value: "forced", joined: false });
});

test("deduplicates concurrent inspections for the same native target", async () => {
  const inspection = deferred<string>();
  const calls: string[] = [];
  const coordinator = createProjectCoordinator({
    run: async (operation) => {
      calls.push(JSON.stringify(operation.nativeScopeInspectionIntent));
      return inspection.promise;
    },
  });
  const nativeScopeInspectionIntent = {
    kind: "inspect",
    subject: { kind: "native-scope", id: ".scratch/unbound" },
    target: { provider: "matt-skills/v1", nativeScope: ".scratch/unbound" },
    refresh: false,
  } as const;

  const first = coordinator.execute({
    entryId: "project",
    mode: "force",
    nativeScopeInspectionIntent,
  });
  const second = coordinator.execute({
    entryId: "project",
    mode: "force",
    nativeScopeInspectionIntent: {
      ...nativeScopeInspectionIntent,
      subject: { kind: "native-subject", id: ".scratch/unbound/issues/01-work.md" },
    },
  });

  expect(calls).toEqual([JSON.stringify(nativeScopeInspectionIntent)]);
  inspection.resolve("inspected");
  expect(await first).toMatchObject({ value: "inspected", joined: false });
  expect(await second).toMatchObject({ value: "inspected", joined: true });
});

test("serializes different inspection targets instead of sharing an observation", async () => {
  const firstInspection = deferred<string>();
  const secondInspection = deferred<string>();
  const calls: string[] = [];
  const coordinator = createProjectCoordinator({
    run: async (operation) => {
      const subject = operation.nativeScopeInspectionIntent;
      const identity = subject?.kind === "inspect" ? subject.subject.id : "none";
      calls.push(identity);
      return calls.length === 1 ? firstInspection.promise : secondInspection.promise;
    },
  });

  const first = coordinator.execute({
    entryId: "project",
    mode: "force",
    nativeScopeInspectionIntent: {
      kind: "inspect",
      subject: { kind: "native-scope", id: ".scratch/one" },
      target: { provider: "matt-skills/v1", nativeScope: ".scratch/one" },
      refresh: false,
    },
  });
  const second = coordinator.execute({
    entryId: "project",
    mode: "force",
    nativeScopeInspectionIntent: {
      kind: "inspect",
      subject: { kind: "native-scope", id: ".scratch/two" },
      target: { provider: "matt-skills/v1", nativeScope: ".scratch/two" },
      refresh: false,
    },
  });

  expect(calls).toEqual([".scratch/one"]);
  firstInspection.resolve("one");
  await first;
  await Promise.resolve();
  expect(calls).toEqual([".scratch/one", ".scratch/two"]);
  secondInspection.resolve("two");
  expect(await second).toMatchObject({ value: "two", joined: false });
});

test("serializes exact GitHub bindings with the same stable identity but different root kinds", async () => {
  const firstInspection = deferred<string>();
  const secondInspection = deferred<string>();
  const targets: string[] = [];
  const githubTarget = (rootKind: "wayfinder-map" | "parent-issue") =>
    encodeGitHubMattNativeScope({
      host: "github.com",
      rootKind,
      repository: {
        owner: "example",
        name: "delivery",
        databaseId: "1",
        nodeId: "R_same",
      },
      root: {
        objectKind: "issue",
        number: 18,
        databaseId: "18",
        nodeId: "I_same",
      },
    });
  const coordinator = createProjectCoordinator({
    run: async (operation) => {
      const intent = operation.nativeScopeInspectionIntent;
      const target = intent?.kind === "inspect" ? intent.target.nativeScope : "none";
      targets.push(target);
      return targets.length === 1 ? firstInspection.promise : secondInspection.promise;
    },
  });

  const first = coordinator.execute({
    entryId: "project",
    mode: "force",
    nativeScopeInspectionIntent: {
      kind: "inspect",
      subject: { kind: "native-scope", id: "github:R_same:I_same" },
      target: { provider: "matt-skills/v1", nativeScope: githubTarget("wayfinder-map") },
      refresh: false,
    },
  });
  const second = coordinator.execute({
    entryId: "project",
    mode: "force",
    nativeScopeInspectionIntent: {
      kind: "inspect",
      subject: { kind: "native-scope", id: "github:R_same:I_same" },
      target: { provider: "matt-skills/v1", nativeScope: githubTarget("parent-issue") },
      refresh: false,
    },
  });

  expect(targets).toEqual([githubTarget("wayfinder-map")]);
  firstInspection.resolve("map");
  await first;
  await Promise.resolve();
  expect(targets).toEqual([githubTarget("wayfinder-map"), githubTarget("parent-issue")]);
  secondInspection.resolve("parent");
  expect(await second).toMatchObject({ value: "parent", joined: false });
});

test("deduplicates GitHub binding metadata variants with one exact definition", async () => {
  const inspection = deferred<string>();
  const targets: string[] = [];
  const githubTarget = (owner: string, name: string) =>
    encodeGitHubMattNativeScope({
      host: "github.com",
      rootKind: "wayfinder-map",
      repository: {
        owner,
        name,
        databaseId: "1",
        nodeId: "R_same",
      },
      root: {
        objectKind: "issue",
        number: 18,
        databaseId: "18",
        nodeId: "I_same",
      },
    });
  const coordinator = createProjectCoordinator({
    run: async (operation) => {
      const intent = operation.nativeScopeInspectionIntent;
      targets.push(intent?.kind === "inspect" ? intent.target.nativeScope : "none");
      return inspection.promise;
    },
  });

  const first = coordinator.execute({
    entryId: "project",
    mode: "force",
    nativeScopeInspectionIntent: {
      kind: "inspect",
      subject: { kind: "native-scope", id: "github:R_same:I_same" },
      target: { provider: "matt-skills/v1", nativeScope: githubTarget("before", "delivery") },
      refresh: false,
    },
  });
  const second = coordinator.execute({
    entryId: "project",
    mode: "force",
    nativeScopeInspectionIntent: {
      kind: "inspect",
      subject: { kind: "native-scope", id: "github:R_same:I_same" },
      target: { provider: "matt-skills/v1", nativeScope: githubTarget("after", "renamed") },
      refresh: false,
    },
  });

  expect(targets).toEqual([githubTarget("before", "delivery")]);
  inspection.resolve("inspected");
  expect(await first).toMatchObject({ value: "inspected", joined: false });
  expect(await second).toMatchObject({ value: "inspected", joined: true });
});

test("coalesces equivalent concurrent targeted reconciliations without caller-side normalization", async () => {
  const reconciliation = deferred<string>();
  const calls: string[] = [];
  const coordinator = createProjectCoordinator({
    run: async (operation) => {
      calls.push(JSON.stringify(operation.nativeScopeInspectionIntent));
      return reconciliation.promise;
    },
  });
  const request = normalizeNativeReconciliationRequest({
    binding: { provider: "matt-skills/v1", nativeScope: ".scratch/work" },
    subjects: [".scratch/work/issues/02.md", ".scratch/work/issues/01.md"],
    relations: [
      {
        kind: "blocked-by",
        source: ".scratch/work/issues/02.md",
        target: ".scratch/work/issues/01.md",
      },
    ],
  });
  const equivalent = nativeReconciliationRequestSchema.parse({
    schemaVersion: 1,
    binding: request.binding,
    subjects: [
      ".scratch/work/issues/01.md",
      ".scratch/work/issues/02.md",
      ".scratch/work/issues/01.md",
    ],
    relations: [request.relations[0] as (typeof request.relations)[number]],
  });

  const first = coordinator.execute({
    entryId: "project",
    mode: "force",
    nativeScopeInspectionIntent: { kind: "reconcile", request },
  });
  const second = coordinator.execute({
    entryId: "project",
    mode: "force",
    nativeScopeInspectionIntent: { kind: "reconcile", request: equivalent },
  });

  expect(calls).toHaveLength(1);
  reconciliation.resolve("reconciled");
  expect(await first).toMatchObject({ value: "reconciled", joined: false });
  expect(await second).toMatchObject({ value: "reconciled", joined: true });
});
