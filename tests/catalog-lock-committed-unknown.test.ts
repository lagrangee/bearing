import { expect, test } from "bun:test";
import { access, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { catalogLocationFor } from "../src/catalog/location";
import { acquireOwnedLock } from "../src/catalog/lock";
import { strictRemoveBoundEmptyDirectory } from "../src/catalog/lock-bound-owner";
import { inspectDirectoryGeneration } from "../src/catalog/lock-recovery";
import { repairCatalogLock } from "../src/catalog/store";
import { makeTemporaryDirectory } from "./helpers";

const runFaultedHost = async (
  homeDir: string,
  operation: "publish" | "retire" | "write",
  body: string,
  faultPath?: string,
  faultPathSuffix?: string,
  timing: "after-commit" | "before-mutation" = "after-commit",
): Promise<Readonly<{ code: number; marker: string; stderr: string }>> => {
  const markerPath = join(homeDir, `${operation}.fault`);
  const lockModule = pathToFileURL(join(process.cwd(), "src/catalog/lock.ts")).href;
  const locationModule = pathToFileURL(join(process.cwd(), "src/catalog/location.ts")).href;
  const recoveryModule = pathToFileURL(join(process.cwd(), "src/catalog/lock-recovery.ts")).href;
  const child = Bun.spawn(
    [
      process.execPath,
      "-e",
      `
        import { acquireOwnedLock } from ${JSON.stringify(lockModule)};
        import { catalogLocationFor } from ${JSON.stringify(locationModule)};
        import {
          inspectDirectoryGeneration,
          releaseRecoveryClaim,
          tryClaimRecovery,
        } from ${JSON.stringify(recoveryModule)};
        const homeDir = process.env.BEARING_TEST_HOME;
        const location = catalogLocationFor(homeDir);
        ${body}
      `,
    ],
    {
      env: {
        ...process.env,
        ...(timing === "after-commit"
          ? { BEARING_INTERNAL_BOUND_LOCK_EXIT_AFTER_COMMIT: operation }
          : { BEARING_INTERNAL_BOUND_LOCK_EXIT_BEFORE_MUTATION: operation }),
        BEARING_INTERNAL_BOUND_LOCK_EXIT_MARKER: markerPath,
        ...(faultPath === undefined ? {} : { BEARING_INTERNAL_BOUND_LOCK_FAULT_PATH: faultPath }),
        ...(faultPathSuffix === undefined
          ? {}
          : { BEARING_INTERNAL_BOUND_LOCK_FAULT_PATH_SUFFIX: faultPathSuffix }),
        BEARING_TEST_HOME: homeDir,
      },
      stderr: "pipe",
      stdout: "ignore",
    },
  );
  const [code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
  let marker = "";
  try {
    marker = await readFile(markerPath, "utf8");
  } catch {
    // The assertion below distinguishes a missing fault from successful reconciliation.
  }
  return { code, marker, stderr };
};

const expectNoLockResidue = async (homeDir: string): Promise<void> => {
  const entries = await readdir(join(homeDir, ".bearing"));
  expect(entries.filter((entry) => entry.startsWith("catalog.lock"))).toEqual([]);
};

const runBoundMutationProbe = async (
  homeDir: string,
  operation: "remove" | "replace-owner" | "restore-owner",
  requestPath: string,
  body: string,
  timing: Readonly<{ afterMutation: string }> | Readonly<{ afterCommit: true }>,
): Promise<
  Readonly<{
    code: number;
    marker: string;
    result: Readonly<{ committed?: boolean; mutation: boolean }>;
    stderr: string;
  }>
> => {
  const markerPath = join(homeDir, `${operation}.probe`);
  const boundOwnerModule = pathToFileURL(
    join(process.cwd(), "src/catalog/lock-bound-owner.ts"),
  ).href;
  const boundProcessModule = pathToFileURL(
    join(process.cwd(), "src/catalog/lock-bound-owner-process.ts"),
  ).href;
  const locationModule = pathToFileURL(join(process.cwd(), "src/catalog/location.ts")).href;
  const ownerModule = pathToFileURL(join(process.cwd(), "src/catalog/lock-owner.ts")).href;
  const recoveryModule = pathToFileURL(join(process.cwd(), "src/catalog/lock-recovery.ts")).href;
  const child = Bun.spawn(
    [
      process.execPath,
      "-e",
      `
        import {
          BoundLockMutationError,
          replaceBoundClaimOwner,
          restoreBoundClaimOwner,
        } from ${JSON.stringify(boundOwnerModule)};
        import { boundRequest, runBoundChild } from ${JSON.stringify(boundProcessModule)};
        import { catalogLocationFor } from ${JSON.stringify(locationModule)};
        import { inspectLockOwner } from ${JSON.stringify(ownerModule)};
        import { inspectDirectoryGeneration } from ${JSON.stringify(recoveryModule)};
        const homeDir = process.env.BEARING_TEST_HOME;
        const location = catalogLocationFor(homeDir);
        ${body}
      `,
    ],
    {
      env: {
        ...process.env,
        ...("afterCommit" in timing
          ? { BEARING_INTERNAL_BOUND_LOCK_EXIT_AFTER_COMMIT: operation }
          : { BEARING_INTERNAL_BOUND_LOCK_FAIL_AFTER_MUTATION: timing.afterMutation }),
        BEARING_INTERNAL_BOUND_LOCK_EXIT_MARKER: markerPath,
        BEARING_INTERNAL_BOUND_LOCK_FAULT_PATH: requestPath,
        BEARING_TEST_HOME: homeDir,
      },
      stderr: "pipe",
      stdout: "pipe",
    },
  );
  const [code, stderr, stdout] = await Promise.all([
    child.exited,
    new Response(child.stderr).text(),
    new Response(child.stdout).text(),
  ]);
  let marker = "";
  try {
    marker = await readFile(markerPath, "utf8");
  } catch {
    // A missing marker keeps a test red when the helper never reaches the requested commit point.
  }
  return { code, marker, result: JSON.parse(stdout), stderr };
};

const absentPid = (): number => {
  for (let pid = process.pid + 100_000; pid < process.pid + 101_000; pid += 1) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ESRCH") return pid;
    }
  }
  throw new Error("Could not find an absent process identity.");
};

test("adopts a canonical owner committed before its helper reply is lost", async () => {
  const homeDir = await makeTemporaryDirectory("bearing-committed-owner-");
  await mkdir(join(homeDir, ".bearing"));

  const result = await runFaultedHost(
    homeDir,
    "write",
    `
      const handle = await acquireOwnedLock(location, 1_000);
      await handle.release();
    `,
  );

  expect(result.marker).toContain("write\n");
  expect(result).toMatchObject({ code: 0, stderr: "" });
  await expectNoLockResidue(homeDir);
});

test("adopts a recovery claim committed before its helper reply is lost", async () => {
  const homeDir = await makeTemporaryDirectory("bearing-committed-claim-");
  await mkdir(join(homeDir, ".bearing"));

  const result = await runFaultedHost(
    homeDir,
    "publish",
    `
      const handle = await acquireOwnedLock(location, 1_000);
      const directory = await inspectDirectoryGeneration(location.lock);
      if (directory === undefined) throw new Error("Expected an owned lock generation.");
      const claim = await tryClaimRecovery(location, directory);
      if (claim === undefined) throw new Error("Expected an adopted recovery claim.");
      await releaseRecoveryClaim(location, claim);
      await handle.release();
    `,
  );

  expect(result.marker).toContain("publish\n");
  expect(result).toMatchObject({ code: 0, stderr: "" });
  await expectNoLockResidue(homeDir);
  await expect(access(join(homeDir, ".bearing", "catalog.lock"))).rejects.toThrow();
});

test("cleans an exact empty reservation when owner publication never committed", async () => {
  const homeDir = await makeTemporaryDirectory("bearing-uncommitted-owner-");
  await mkdir(join(homeDir, ".bearing"));

  const result = await runFaultedHost(
    homeDir,
    "write",
    `
      const error = await acquireOwnedLock(location, 1_000).catch((cause) => cause);
      if (error?.code !== "catalog-lock-indeterminate") {
        throw new Error("Expected an explicit recovery failure.");
      }
    `,
    undefined,
    undefined,
    "before-mutation",
  );

  expect(result.marker).toBe("write\n");
  expect(result).toMatchObject({ code: 0, stderr: "" });
  await expectNoLockResidue(homeDir);
});

test("withdraws its candidate when claim publication never committed", async () => {
  const homeDir = await makeTemporaryDirectory("bearing-uncommitted-claim-");
  await mkdir(join(homeDir, ".bearing"));

  const result = await runFaultedHost(
    homeDir,
    "publish",
    `
      const handle = await acquireOwnedLock(location, 1_000);
      const directory = await inspectDirectoryGeneration(location.lock);
      if (directory === undefined) throw new Error("Expected an owned lock generation.");
      const claim = await tryClaimRecovery(location, directory);
      if (claim !== undefined) throw new Error("An uncommitted claim cannot be adopted.");
      await handle.release();
    `,
    undefined,
    undefined,
    "before-mutation",
  );

  expect(result.marker).toBe("publish\n");
  expect(result).toMatchObject({ code: 0, stderr: "" });
  await expectNoLockResidue(homeDir);
});

test("an exact precommit claim-release failure cannot block the next same-process acquire", async () => {
  const homeDir = await makeTemporaryDirectory("bearing-release-claim-failure-");
  await mkdir(join(homeDir, ".bearing", "catalog.lock"), { recursive: true });
  await writeFile(
    join(homeDir, ".bearing", "catalog.lock", "owner.json"),
    `${JSON.stringify({ pid: absentPid(), token: "dead-owner" })}\n`,
  );
  const markerPath = join(homeDir, "retire.fault");
  const lockModule = pathToFileURL(join(process.cwd(), "src/catalog/lock.ts")).href;
  const locationModule = pathToFileURL(join(process.cwd(), "src/catalog/location.ts")).href;
  const errorsModule = pathToFileURL(join(process.cwd(), "src/catalog/errors.ts")).href;
  const child = Bun.spawn(
    [
      process.execPath,
      "-e",
      `
        import { acquireOwnedLock } from ${JSON.stringify(lockModule)};
        import { catalogLocationFor } from ${JSON.stringify(locationModule)};
        import { CatalogLockError } from ${JSON.stringify(errorsModule)};
        const location = catalogLocationFor(process.env.BEARING_TEST_HOME);
        const error = await acquireOwnedLock(location, 100, {
          afterRecoveryAcquired: async (phase) => {
            if (phase === "reclaim") throw new Error("injected primary reclaim failure");
          },
        }).catch((cause) => cause);
        const second = await acquireOwnedLock(location, 1_000);
        await second.release();
        console.log(JSON.stringify({
          busy: error instanceof CatalogLockError,
          failed: error instanceof Error,
        }));
      `,
    ],
    {
      env: {
        ...process.env,
        BEARING_INTERNAL_BOUND_LOCK_EXIT_BEFORE_MUTATION: "retire",
        BEARING_INTERNAL_BOUND_LOCK_FAULT_PATH: join(
          homeDir,
          ".bearing",
          "catalog.lock",
          "recovery",
          "claim",
        ),
        BEARING_INTERNAL_BOUND_LOCK_EXIT_MARKER: markerPath,
        BEARING_TEST_HOME: homeDir,
      },
      stderr: "pipe",
      stdout: "pipe",
    },
  );
  const [code, stderr, stdout] = await Promise.all([
    child.exited,
    new Response(child.stderr).text(),
    new Response(child.stdout).text(),
  ]);

  expect(await readFile(markerPath, "utf8")).toBe("retire\n");
  expect({ code, stderr }).toEqual({ code: 0, stderr: "" });
  expect(JSON.parse(stdout)).toEqual({ busy: false, failed: true });
  await expectNoLockResidue(homeDir);
});

test("bounds an exact claim-release retry when the helper keeps failing", async () => {
  const homeDir = await makeTemporaryDirectory("bearing-persistent-claim-release-failure-");
  await mkdir(join(homeDir, ".bearing", "catalog.lock"), { recursive: true });
  await writeFile(
    join(homeDir, ".bearing", "catalog.lock", "owner.json"),
    `${JSON.stringify({ pid: absentPid(), token: "dead-owner" })}\n`,
  );
  const lockModule = pathToFileURL(join(process.cwd(), "src/catalog/lock.ts")).href;
  const locationModule = pathToFileURL(join(process.cwd(), "src/catalog/location.ts")).href;
  const errorsModule = pathToFileURL(join(process.cwd(), "src/catalog/errors.ts")).href;
  const claimPath = join(homeDir, ".bearing", "catalog.lock", "recovery", "claim");
  const startedAt = Date.now();
  const child = Bun.spawn(
    [
      process.execPath,
      "-e",
      `
        import { acquireOwnedLock } from ${JSON.stringify(lockModule)};
        import { catalogLocationFor } from ${JSON.stringify(locationModule)};
        import { CatalogLockRecoveryError } from ${JSON.stringify(errorsModule)};
        const location = catalogLocationFor(process.env.BEARING_TEST_HOME);
        const error = await acquireOwnedLock(location, 100, {
          afterRecoveryAcquired: async (phase) => {
            if (phase === "reclaim") throw new Error("injected primary reclaim failure");
          },
        }).catch((cause) => cause);
        console.log(JSON.stringify({ recovery: error instanceof CatalogLockRecoveryError }));
      `,
    ],
    {
      env: {
        ...process.env,
        BEARING_INTERNAL_BOUND_LOCK_EXIT_BEFORE_MUTATION: "retire",
        BEARING_INTERNAL_BOUND_LOCK_FAULT_PATH: claimPath,
        BEARING_TEST_HOME: homeDir,
      },
      stderr: "pipe",
      stdout: "pipe",
    },
  );
  const [code, stderr, stdout] = await Promise.all([
    child.exited,
    new Response(child.stderr).text(),
    new Response(child.stdout).text(),
  ]);

  expect(Date.now() - startedAt).toBeLessThan(2_000);
  expect({ code, stderr }).toEqual({ code: 0, stderr: "" });
  expect(JSON.parse(stdout)).toEqual({ recovery: true });
  await access(join(claimPath, "owner.json"));
});

test("confirms claim release committed before its helper reply is lost", async () => {
  const homeDir = await makeTemporaryDirectory("bearing-committed-claim-release-");
  await mkdir(join(homeDir, ".bearing"));
  const result = await runFaultedHost(
    homeDir,
    "retire",
    `
      const handle = await acquireOwnedLock(location, 1_000);
      const directory = await inspectDirectoryGeneration(location.lock);
      if (directory === undefined) throw new Error("Expected an owned lock generation.");
      const claim = await tryClaimRecovery(location, directory);
      if (claim === undefined) throw new Error("Expected a recovery claim.");
      await releaseRecoveryClaim(location, claim);
      await handle.release();
    `,
    undefined,
    ".release",
  );

  expect(result.marker).toBe("retire\n");
  expect(result).toMatchObject({ code: 0, stderr: "" });
  await expectNoLockResidue(homeDir);
});

test("a new claim owner reports its O_EXCL creation before metadata capture fails", async () => {
  const homeDir = await makeTemporaryDirectory("bearing-replace-owner-commit-");
  const location = catalogLocationFor(homeDir);
  const claim = join(location.lockRecovery, "claim");
  await mkdir(claim, { recursive: true });
  await writeFile(
    location.lockOwner,
    `${JSON.stringify({ pid: absentPid(), token: "dead-lock-owner" })}\n`,
  );

  const probe = await runBoundMutationProbe(
    homeDir,
    "replace-owner",
    claim,
    `
      const [claimDirectory, recoveryDirectory] = await Promise.all([
        inspectDirectoryGeneration(${JSON.stringify(claim)}),
        inspectDirectoryGeneration(location.lockRecovery),
      ]);
      if (claimDirectory === undefined || recoveryDirectory === undefined) {
        throw new Error("Expected an exact replace fixture.");
      }
      const error = await replaceBoundClaimOwner(
        ${JSON.stringify(claim)},
        claimDirectory,
        recoveryDirectory,
        "owner.json",
        undefined,
        "owner.00000000-0000-4000-8000-000000000000.staged",
        { pid: process.pid, token: "repair-owner" },
      ).catch((cause) => cause);
      console.log(JSON.stringify({
        mutation: error instanceof BoundLockMutationError,
        committed: error?.mutationMayHaveCommitted,
      }));
    `,
    { afterMutation: "replace-owner-open" },
  );

  expect(probe).toMatchObject({
    code: 0,
    marker: "replace-owner-open\n",
    result: { mutation: true, committed: true },
    stderr: "",
  });
  expect(await readFile(join(claim, "owner.json"))).toHaveLength(0);

  await expect(repairCatalogLock({ homeDir, confirmed: true })).resolves.toEqual({
    outcome: "applied",
  });
  const handle = await acquireOwnedLock(location, 1_000);
  await handle.release();
  await expectNoLockResidue(homeDir);
});

test("a restore-owner tombstone failure reports the moved owner and remains repairable", async () => {
  const homeDir = await makeTemporaryDirectory("bearing-restore-owner-commit-");
  const location = catalogLocationFor(homeDir);
  const claim = join(location.lockRecovery, "claim");
  const stageName = "owner.00000000-0000-4000-8000-000000000000.staged";
  const currentBytes = `${JSON.stringify({ pid: absentPid(), token: "repair-owner" })}\n`;
  const previousBytes = `${JSON.stringify({ pid: absentPid(), token: "previous-owner" })}\n`;
  await mkdir(claim, { recursive: true });
  await writeFile(
    location.lockOwner,
    `${JSON.stringify({ pid: absentPid(), token: "dead-lock-owner" })}\n`,
  );
  await writeFile(join(claim, "owner.json"), currentBytes);
  await writeFile(join(location.lockRecovery, stageName), previousBytes);

  const probe = await runBoundMutationProbe(
    homeDir,
    "restore-owner",
    claim,
    `
      const [claimDirectory, recoveryDirectory, currentOwner, previousOwner] = await Promise.all([
        inspectDirectoryGeneration(${JSON.stringify(claim)}),
        inspectDirectoryGeneration(location.lockRecovery),
        inspectLockOwner(${JSON.stringify(join(claim, "owner.json"))}),
        inspectLockOwner(${JSON.stringify(join(location.lockRecovery, stageName))}),
      ]);
      if (
        claimDirectory === undefined ||
        recoveryDirectory === undefined ||
        currentOwner.state !== "regular" ||
        currentOwner.owner === undefined ||
        previousOwner.state !== "regular"
      ) throw new Error("Expected an exact restore fixture.");
      const error = await restoreBoundClaimOwner(
        ${JSON.stringify(claim)},
        claimDirectory,
        recoveryDirectory,
        "owner.json",
        currentOwner,
        ${JSON.stringify(stageName)},
        previousOwner,
      ).catch((cause) => cause);
      console.log(JSON.stringify({
        mutation: error instanceof BoundLockMutationError,
        committed: error?.mutationMayHaveCommitted,
      }));
    `,
    { afterMutation: "tombstone-owner" },
  );

  expect(probe).toMatchObject({
    code: 0,
    marker: "tombstone-owner\n",
    result: { mutation: true, committed: true },
    stderr: "",
  });
  const claimEntries = await readdir(claim);
  expect(claimEntries).toHaveLength(1);
  expect(claimEntries[0]).toMatch(/^\.owner\..+\.tombstone$/);
  expect(await readFile(join(claim, claimEntries[0] ?? ""), "utf8")).toBe(currentBytes);
  expect(await readFile(join(location.lockRecovery, stageName), "utf8")).toBe(previousBytes);

  await expect(repairCatalogLock({ homeDir, confirmed: true })).resolves.toEqual({
    outcome: "applied",
  });
  const handle = await acquireOwnedLock(location, 1_000);
  await handle.release();
  await expectNoLockResidue(homeDir);
});

test("a direct remove reports an owner unlink before exact empty-directory cleanup", async () => {
  const homeDir = await makeTemporaryDirectory("bearing-remove-owner-commit-");
  const candidate = join(homeDir, "candidate");
  const ownerPath = join(candidate, "owner.json");
  await mkdir(candidate);
  await writeFile(ownerPath, `${JSON.stringify({ pid: absentPid(), token: "candidate-owner" })}\n`);

  const probe = await runBoundMutationProbe(
    homeDir,
    "remove",
    candidate,
    `
      const [directory, parent, owner] = await Promise.all([
        inspectDirectoryGeneration(${JSON.stringify(candidate)}),
        inspectDirectoryGeneration(${JSON.stringify(homeDir)}),
        inspectLockOwner(${JSON.stringify(ownerPath)}),
      ]);
      if (directory === undefined || parent === undefined || owner.state !== "regular") {
        throw new Error("Expected an exact remove fixture.");
      }
      const error = await runBoundChild(
        boundRequest("remove", ${JSON.stringify(candidate)}, directory, "owner.json", owner, undefined, parent),
      ).catch((cause) => cause);
      console.log(JSON.stringify({
        mutation: error instanceof BoundLockMutationError,
        committed: error?.mutationMayHaveCommitted,
      }));
    `,
    { afterMutation: "remove-owner" },
  );

  expect(probe).toMatchObject({
    code: 0,
    marker: "remove-owner\n",
    result: { mutation: true, committed: true },
    stderr: "",
  });
  expect(await readdir(candidate)).toEqual([]);
  const [directory, parent] = await Promise.all([
    inspectDirectoryGeneration(candidate),
    inspectDirectoryGeneration(homeDir),
  ]);
  if (directory === undefined || parent === undefined) throw new Error("Expected empty residue.");
  await strictRemoveBoundEmptyDirectory(
    candidate,
    join(homeDir, "candidate.retired"),
    directory,
    parent,
  );
  await expect(access(candidate)).rejects.toThrow();
});

test("a direct empty remove reports a committed rmdir when its reply is lost", async () => {
  const homeDir = await makeTemporaryDirectory("bearing-remove-directory-commit-");
  const candidate = join(homeDir, "candidate");
  await mkdir(candidate);

  const probe = await runBoundMutationProbe(
    homeDir,
    "remove",
    candidate,
    `
      const [directory, parent] = await Promise.all([
        inspectDirectoryGeneration(${JSON.stringify(candidate)}),
        inspectDirectoryGeneration(${JSON.stringify(homeDir)}),
      ]);
      if (directory === undefined || parent === undefined) {
        throw new Error("Expected an exact empty remove fixture.");
      }
      const error = await runBoundChild(
        boundRequest("remove", ${JSON.stringify(candidate)}, directory, "owner.json", undefined, undefined, parent),
      ).catch((cause) => cause);
      console.log(JSON.stringify({
        mutation: error instanceof BoundLockMutationError,
        committed: error?.mutationMayHaveCommitted,
      }));
    `,
    { afterCommit: true },
  );

  expect(probe).toMatchObject({
    code: 0,
    marker: "remove\n",
    result: { mutation: true, committed: true },
    stderr: "",
  });
  await expect(access(candidate)).rejects.toThrow();
});
