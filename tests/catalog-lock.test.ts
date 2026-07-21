import { expect, test } from "bun:test";
import {
  access,
  link,
  lstat,
  mkdir,
  readdir,
  readFile,
  rename,
  rmdir,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { catalogLocationFor } from "../src/catalog/location";
import { acquireOwnedLock, createCooperativeLock } from "../src/catalog/lock";
import {
  inspectDirectoryGeneration,
  releaseRecoveryClaim,
  tryClaimRecovery,
} from "../src/catalog/lock-recovery";
import {
  CatalogLockError,
  CatalogLockRecoveryError,
  readCatalogDocument,
  repairCatalogLock,
  upsertCatalogEntry,
} from "../src/catalog/store";
import { createValidBearingRepo, makeTemporaryDirectory } from "./helpers";

const createLock = async (homeDir: string, owner: unknown): Promise<string> => {
  const lock = join(homeDir, ".bearing/catalog.lock");
  await mkdir(lock, { recursive: true });
  await writeFile(join(lock, "owner.json"), `${JSON.stringify(owner)}\n`);
  return lock;
};

const absentPid = (): number => {
  for (let candidate = process.pid + 100_000; candidate < process.pid + 101_000; candidate += 1) {
    try {
      process.kill(candidate, 0);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ESRCH") return candidate;
    }
  }
  throw new Error("Could not find an absent process identity for the Catalog lock fixture.");
};

const deferred = (): Readonly<{
  promise: Promise<void>;
  resolve: () => void;
}> => {
  let resolve = () => {};
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
};

const readCanonicalOwner = async (
  location: ReturnType<typeof catalogLocationFor>,
): Promise<{ pid: number; token: string }> => {
  return JSON.parse(await readFile(location.lockOwner, "utf8"));
};

const replaceCanonicalLock = async (
  location: ReturnType<typeof catalogLocationFor>,
  preserved: string,
  token: string,
): Promise<void> => {
  await rename(location.lock, preserved);
  await mkdir(location.lock);
  await writeFile(location.lockOwner, `${JSON.stringify({ pid: process.pid, token })}\n`);
};

test("waits within the bounded timeout for a live Catalog writer", async () => {
  const homeDir = await makeTemporaryDirectory("bearing-home-");
  const repoRoot = await createValidBearingRepo();
  const lock = await createLock(homeDir, { pid: process.pid, token: "live-owner" });
  const released = new Promise<void>((resolve, reject) => {
    setTimeout(() => {
      void (async () => {
        try {
          await unlink(join(lock, "owner.json"));
          await rmdir(join(lock, "recovery")).catch(() => undefined);
          await rmdir(lock);
          resolve();
        } catch (error) {
          reject(error);
        }
      })();
    }, 30);
  });

  await expect(
    upsertCatalogEntry({
      homeDir,
      repoRoot,
      createEntryId: () => "entry-after-wait",
      lockTimeoutMs: 500,
    }),
  ).resolves.toMatchObject({ outcome: "applied" });
  await released;
});

test("re-reads the latest strict document after concurrent writers serialize", async () => {
  const homeDir = await makeTemporaryDirectory("bearing-home-");
  const firstRoot = await createValidBearingRepo();
  const secondRoot = await createValidBearingRepo();

  await Promise.all([
    upsertCatalogEntry({
      homeDir,
      repoRoot: firstRoot,
      createEntryId: () => "entry-first",
      lockTimeoutMs: 500,
    }),
    upsertCatalogEntry({
      homeDir,
      repoRoot: secondRoot,
      createEntryId: () => "entry-second",
      lockTimeoutMs: 500,
    }),
  ]);

  await expect(readCatalogDocument({ homeDir })).resolves.toMatchObject({
    entries: expect.arrayContaining([
      expect.objectContaining({ entryId: "entry-first" }),
      expect.objectContaining({ entryId: "entry-second" }),
    ]),
  });
});

test("reclaims an abandoned lock only after its process is proven absent", async () => {
  const homeDir = await makeTemporaryDirectory("bearing-home-");
  const repoRoot = await createValidBearingRepo();
  const lock = await createLock(homeDir, { pid: absentPid(), token: "dead-owner" });

  await expect(
    upsertCatalogEntry({
      homeDir,
      repoRoot,
      createEntryId: () => "entry-after-reclaim",
      lockTimeoutMs: 0,
    }),
  ).resolves.toMatchObject({ outcome: "applied" });
  await expect(access(lock)).rejects.toThrow();
});

test("treats a live owner as busy without creating a recovery claim", async () => {
  const homeDir = await makeTemporaryDirectory("bearing-home-");
  const location = catalogLocationFor(homeDir);
  await createLock(homeDir, { pid: process.pid, token: "live-without-recovery" });
  let recoveryStarted = false;
  const contender = createCooperativeLock({
    afterRecoveryContainerReady: async () => {
      recoveryStarted = true;
    },
  });

  await expect(contender(location, 0, async () => undefined)).rejects.toBeInstanceOf(
    CatalogLockError,
  );
  expect(recoveryStarted).toBeFalse();
  await expect(access(location.lockRecovery)).rejects.toThrow();
  expect(await readCanonicalOwner(location)).toEqual({
    pid: process.pid,
    token: "live-without-recovery",
  });
});

test("fails with an explicit repair path when lock ownership is indeterminate", async () => {
  const homeDir = await makeTemporaryDirectory("bearing-home-");
  const registeredRoot = await createValidBearingRepo();
  const repoRoot = await createValidBearingRepo();
  await upsertCatalogEntry({
    homeDir,
    repoRoot: registeredRoot,
    createEntryId: () => "entry-readable",
  });
  await createLock(homeDir, { pid: "unknown", token: "indeterminate" });

  await expect(readCatalogDocument({ homeDir })).resolves.toMatchObject({
    entries: [{ entryId: "entry-readable" }],
  });
  await expect(upsertCatalogEntry({ homeDir, repoRoot, lockTimeoutMs: 0 })).rejects.toMatchObject({
    name: CatalogLockRecoveryError.name,
    code: "catalog-lock-indeterminate",
    repair: "inspect-and-confirm-catalog-lock-repair",
  });
});

test("bounds a crash-after-mkdir lock and explicitly repairs only the empty lock directory", async () => {
  const homeDir = await makeTemporaryDirectory("bearing-home-");
  const repoRoot = await createValidBearingRepo();
  const lock = join(homeDir, ".bearing/catalog.lock");
  await mkdir(lock, { recursive: true });

  await expect(upsertCatalogEntry({ homeDir, repoRoot, lockTimeoutMs: 10 })).rejects.toMatchObject({
    name: CatalogLockRecoveryError.name,
    code: "catalog-lock-indeterminate",
  });
  await expect(repairCatalogLock({ homeDir, confirmed: false })).rejects.toMatchObject({
    code: "catalog-lock-repair-refused",
    reason: "confirmation-required",
  });
  await access(lock);

  await expect(repairCatalogLock({ homeDir, confirmed: true })).resolves.toEqual({
    outcome: "applied",
  });
  await expect(access(lock)).rejects.toThrow();
});

test("repairs an exact malformed regular owner but leaves Catalog bytes unchanged", async () => {
  const homeDir = await makeTemporaryDirectory("bearing-home-");
  const repoRoot = await createValidBearingRepo();
  await upsertCatalogEntry({ homeDir, repoRoot, createEntryId: () => "entry-preserved" });
  const catalogPath = join(homeDir, ".bearing/catalog.json");
  const catalogBefore = await readFile(catalogPath);
  const lock = await createLock(homeDir, { pid: "not-a-pid", token: "malformed" });

  await expect(repairCatalogLock({ homeDir, confirmed: true })).resolves.toEqual({
    outcome: "applied",
  });
  await expect(access(lock)).rejects.toThrow();
  expect(await readFile(catalogPath)).toEqual(catalogBefore);
});

test("refuses to repair a valid lock whose owner process is live", async () => {
  const homeDir = await makeTemporaryDirectory("bearing-home-");
  const lock = await createLock(homeDir, { pid: process.pid, token: "live-owner" });

  await expect(repairCatalogLock({ homeDir, confirmed: true })).rejects.toMatchObject({
    code: "catalog-lock-repair-refused",
    reason: "live-owner",
  });
  await access(join(lock, "owner.json"));
});

test("refuses a live canonical owner before mutating abandoned claim debris", async () => {
  const homeDir = await makeTemporaryDirectory("bearing-home-");
  const location = catalogLocationFor(homeDir);
  await createLock(homeDir, { pid: process.pid, token: "live-before-debris" });
  const debris = join(location.lockRecovery, "claim.00000000-0000-4000-8000-000000000000.tmp");
  const debrisOwner = join(debris, "owner.json");
  const bytes = `${JSON.stringify({ pid: absentPid(), token: "abandoned-candidate" })}\n`;
  await mkdir(debris, { recursive: true });
  await writeFile(debrisOwner, bytes);
  const directoryBefore = await lstat(debris, { bigint: true });
  const ownerBefore = await lstat(debrisOwner, { bigint: true });

  await expect(repairCatalogLock({ homeDir, confirmed: true })).rejects.toMatchObject({
    code: "catalog-lock-repair-refused",
    reason: "live-owner",
  });

  const directoryAfter = await lstat(debris, { bigint: true });
  const ownerAfter = await lstat(debrisOwner, { bigint: true });
  expect([directoryAfter.dev, directoryAfter.ino]).toEqual([
    directoryBefore.dev,
    directoryBefore.ino,
  ]);
  expect([ownerAfter.dev, ownerAfter.ino, ownerAfter.size]).toEqual([
    ownerBefore.dev,
    ownerBefore.ino,
    ownerBefore.size,
  ]);
  expect(await readFile(debrisOwner, "utf8")).toBe(bytes);
});

test("refuses a live staged owner before mutating abandoned claim debris", async () => {
  const homeDir = await makeTemporaryDirectory("bearing-home-");
  const location = catalogLocationFor(homeDir);
  await createLock(homeDir, { pid: absentPid(), token: "dead-canonical" });
  const stagedOwner = join(location.lock, "owner.json.00000000-0000-4000-8000-000000000000.tmp");
  await writeFile(stagedOwner, `${JSON.stringify({ pid: process.pid, token: "live-stage" })}\n`);
  const debris = join(location.lockRecovery, "claim.00000000-0000-4000-8000-000000000001.tmp");
  const debrisOwner = join(debris, "owner.json");
  const bytes = `${JSON.stringify({ pid: absentPid(), token: "abandoned-candidate" })}\n`;
  await mkdir(debris, { recursive: true });
  await writeFile(debrisOwner, bytes);
  const directoryBefore = await lstat(debris, { bigint: true });
  const ownerBefore = await lstat(debrisOwner, { bigint: true });

  await expect(repairCatalogLock({ homeDir, confirmed: true })).rejects.toMatchObject({
    code: "catalog-lock-repair-refused",
    reason: "live-owner",
  });

  const directoryAfter = await lstat(debris, { bigint: true });
  const ownerAfter = await lstat(debrisOwner, { bigint: true });
  expect([directoryAfter.dev, directoryAfter.ino]).toEqual([
    directoryBefore.dev,
    directoryBefore.ino,
  ]);
  expect([ownerAfter.dev, ownerAfter.ino, ownerAfter.size]).toEqual([
    ownerBefore.dev,
    ownerBefore.ino,
    ownerBefore.size,
  ]);
  expect(await readFile(debrisOwner, "utf8")).toBe(bytes);
});

test("returns no-op when an explicitly confirmed repair finds no lock", async () => {
  const homeDir = await makeTemporaryDirectory("bearing-home-");

  await expect(repairCatalogLock({ homeDir, confirmed: true })).resolves.toEqual({
    outcome: "no-op",
  });
  await expect(access(join(homeDir, ".bearing"))).rejects.toThrow();
});

test("inspects a FIFO owner without blocking and repairs only its exact directory entry", async () => {
  const homeDir = await makeTemporaryDirectory("bearing-home-");
  const repoRoot = await createValidBearingRepo();
  const lock = join(homeDir, ".bearing/catalog.lock");
  const owner = join(lock, "owner.json");
  await mkdir(lock, { recursive: true });
  const fifo = Bun.spawn(["mkfifo", owner], { stdout: "ignore", stderr: "pipe" });
  expect(await fifo.exited).toBe(0);

  const startedAt = performance.now();
  await expect(upsertCatalogEntry({ homeDir, repoRoot, lockTimeoutMs: 0 })).rejects.toMatchObject({
    name: CatalogLockRecoveryError.name,
    code: "catalog-lock-indeterminate",
  });
  expect(performance.now() - startedAt).toBeLessThan(200);
  await expect(repairCatalogLock({ homeDir, confirmed: true })).resolves.toEqual({
    outcome: "applied",
  });
  await expect(access(lock)).rejects.toThrow();
});

test("unlinks only an exact symlink or hardlink owner name", async () => {
  const symlinkHome = await makeTemporaryDirectory("bearing-home-");
  const symlinkRepo = await createValidBearingRepo();
  const outside = join(symlinkHome, "outside-owner.json");
  await writeFile(outside, "outside-bytes\n");
  const symlinkLock = join(symlinkHome, ".bearing/catalog.lock");
  await mkdir(symlinkLock, { recursive: true });
  await symlink(outside, join(symlinkLock, "owner.json"));

  await expect(
    upsertCatalogEntry({ homeDir: symlinkHome, repoRoot: symlinkRepo, lockTimeoutMs: 0 }),
  ).rejects.toBeInstanceOf(CatalogLockRecoveryError);
  await expect(repairCatalogLock({ homeDir: symlinkHome, confirmed: true })).resolves.toEqual({
    outcome: "applied",
  });
  expect(await readFile(outside, "utf8")).toBe("outside-bytes\n");

  const hardlinkHome = await makeTemporaryDirectory("bearing-home-");
  const hardlinkRepo = await createValidBearingRepo();
  const peer = join(hardlinkHome, "owner-peer.json");
  await writeFile(peer, "malformed-owner\n");
  const hardlinkLock = join(hardlinkHome, ".bearing/catalog.lock");
  await mkdir(hardlinkLock, { recursive: true });
  await link(peer, join(hardlinkLock, "owner.json"));

  await expect(
    upsertCatalogEntry({ homeDir: hardlinkHome, repoRoot: hardlinkRepo, lockTimeoutMs: 0 }),
  ).rejects.toBeInstanceOf(CatalogLockRecoveryError);
  await expect(repairCatalogLock({ homeDir: hardlinkHome, confirmed: true })).resolves.toEqual({
    outcome: "applied",
  });
  expect(await readFile(peer, "utf8")).toBe("malformed-owner\n");
});

test("removes an exact empty owner directory but refuses a nonempty one", async () => {
  const emptyHome = await makeTemporaryDirectory("bearing-home-");
  const emptyLock = join(emptyHome, ".bearing/catalog.lock");
  await mkdir(join(emptyLock, "owner.json"), { recursive: true });

  await expect(repairCatalogLock({ homeDir: emptyHome, confirmed: true })).resolves.toEqual({
    outcome: "applied",
  });
  await expect(access(emptyLock)).rejects.toThrow();

  const nonemptyHome = await makeTemporaryDirectory("bearing-home-");
  const nonemptyOwner = join(nonemptyHome, ".bearing/catalog.lock/owner.json");
  await mkdir(nonemptyOwner, { recursive: true });
  await writeFile(join(nonemptyOwner, "unexpected"), "preserve\n");

  await expect(repairCatalogLock({ homeDir: nonemptyHome, confirmed: true })).rejects.toMatchObject(
    {
      code: "catalog-lock-repair-refused",
      reason: "nonempty-owner-directory",
    },
  );
  expect(await readFile(join(nonemptyOwner, "unexpected"), "utf8")).toBe("preserve\n");
});

test("serializes two dead-owner reclaimers before either can remove a generation", async () => {
  const homeDir = await makeTemporaryDirectory("bearing-home-");
  const location = catalogLocationFor(homeDir);
  await createLock(homeDir, { pid: absentPid(), token: "dead-generation" });
  const claimed = deferred();
  const continueReclaim = deferred();
  let secondReachedClaim = false;
  const first = createCooperativeLock({
    afterRecoveryClaim: async (phase) => {
      if (phase !== "reclaim") return;
      claimed.resolve();
      await continueReclaim.promise;
    },
  });
  const firstRun = first(location, 500, async () => "first-owner");
  await claimed.promise;

  const second = createCooperativeLock({
    afterRecoveryClaim: async () => {
      secondReachedClaim = true;
    },
  });
  await expect(second(location, 0, async () => "unsafe-second-owner")).rejects.toBeInstanceOf(
    CatalogLockError,
  );
  expect(secondReachedClaim).toBeFalse();
  expect(await readCanonicalOwner(location)).toMatchObject({
    token: "dead-generation",
  });

  continueReclaim.resolve();
  await expect(firstRun).resolves.toBe("first-owner");
});

test("keeps recovery stable while a contender reuses it before publishing a claim", async () => {
  const homeDir = await makeTemporaryDirectory("bearing-home-");
  const location = catalogLocationFor(homeDir);
  await createLock(homeDir, { pid: absentPid(), token: "stable-dead-generation" });
  const firstClaimed = deferred();
  const continueFirst = deferred();
  const firstOperationEntered = deferred();
  const releaseFirstOperation = deferred();
  const secondReady = deferred();
  const continueSecond = deferred();
  let firstOperationCalled = false;
  let secondOperationCalled = false;
  const first = createCooperativeLock({
    afterRecoveryAcquired: async (phase) => {
      if (phase !== "reclaim") return;
      firstClaimed.resolve();
      await continueFirst.promise;
    },
  });
  const firstRun = first(location, 0, async () => {
    firstOperationCalled = true;
    firstOperationEntered.resolve();
    await releaseFirstOperation.promise;
  });
  await firstClaimed.promise;

  const second = createCooperativeLock({
    afterRecoveryContainerReady: async (phase) => {
      if (phase !== "reclaim") return;
      secondReady.resolve();
      await continueSecond.promise;
    },
  });
  const secondRun = second(location, 0, async () => {
    secondOperationCalled = true;
  });
  await secondReady.promise;
  continueFirst.resolve();
  await firstOperationEntered.promise;
  continueSecond.resolve();
  await expect(secondRun).rejects.toBeInstanceOf(CatalogLockError);

  expect(firstOperationCalled).toBeTrue();
  expect(secondOperationCalled).toBeFalse();
  releaseFirstOperation.resolve();
  await expect(firstRun).resolves.toBeUndefined();
  await expect(access(location.lock)).rejects.toThrow();
});

test("treats a generation retired after recovery reuse as transient contention", async () => {
  const homeDir = await makeTemporaryDirectory("bearing-home-");
  const location = catalogLocationFor(homeDir);
  await createLock(homeDir, { pid: absentPid(), token: "retired-generation" });
  const contenderReady = deferred();
  const continueContender = deferred();
  let operationCalled = false;
  const contender = createCooperativeLock({
    afterRecoveryContainerReady: async (phase) => {
      if (phase !== "reclaim") return;
      contenderReady.resolve();
      await continueContender.promise;
    },
  });
  const contenderRun = contender(location, 0, async () => {
    operationCalled = true;
  });
  await contenderReady.promise;

  const winner = await acquireOwnedLock(location, 0);
  continueContender.resolve();
  await expect(contenderRun).rejects.toBeInstanceOf(CatalogLockError);
  expect(operationCalled).toBeFalse();
  await winner.release();
  await expect(access(location.lock)).rejects.toThrow();
});

test("keeps repair behind an automatic reclaimer's revalidated claim", async () => {
  const homeDir = await makeTemporaryDirectory("bearing-home-");
  const location = catalogLocationFor(homeDir);
  await createLock(homeDir, { pid: absentPid(), token: "automatic-target" });
  const revalidated = deferred();
  const continueReclaim = deferred();
  const reclaimer = createCooperativeLock({
    afterRecoveryClaim: async (phase) => {
      if (phase !== "reclaim") return;
      revalidated.resolve();
      await continueReclaim.promise;
    },
  });
  const reclaimerRun = reclaimer(location, 500, async () => undefined);
  await revalidated.promise;

  await expect(repairCatalogLock({ homeDir, confirmed: true })).rejects.toMatchObject({
    reason: "lock-changed",
  });
  expect(await readCanonicalOwner(location)).toMatchObject({
    token: "automatic-target",
  });

  continueReclaim.resolve();
  await expect(reclaimerRun).resolves.toBeUndefined();
});

test("a synthetic repair guard excludes a concurrent Catalog writer", async () => {
  const homeDir = await makeTemporaryDirectory("bearing-home-");
  const repoRoot = await createValidBearingRepo();
  const location = catalogLocationFor(homeDir);
  const debris = `${location.lock}.AAAAAAAAAAAAAAAAAAAAAA.quarantine`;
  const recovery = join(debris, "recovery");
  await mkdir(recovery, { recursive: true });
  await writeFile(
    join(debris, "owner.json"),
    `${JSON.stringify({ pid: absentPid(), token: "abandoned-debris" })}\n`,
  );
  await Promise.all(
    Array.from({ length: 64 }, (_, index) =>
      mkdir(
        join(
          recovery,
          `claim.00000000-0000-4000-8000-${(index + 1).toString(16).padStart(12, "0")}.tmp`,
        ),
      ),
    ),
  );

  const repair = repairCatalogLock({ homeDir, confirmed: true });
  let guardOwner: { pid: number; token: string } | undefined;
  const observationDeadline = Date.now() + 5_000;
  while (guardOwner === undefined && Date.now() < observationDeadline) {
    try {
      guardOwner = await readCanonicalOwner(location);
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
  }
  expect(guardOwner).toMatchObject({ pid: process.pid });

  await expect(
    upsertCatalogEntry({
      homeDir,
      repoRoot,
      createEntryId: () => "entry-during-repair",
      lockTimeoutMs: 0,
    }),
  ).rejects.toBeInstanceOf(CatalogLockError);
  await expect(repair).resolves.toEqual({ outcome: "applied" });

  await expect(
    upsertCatalogEntry({
      homeDir,
      repoRoot,
      createEntryId: () => "entry-after-repair",
      lockTimeoutMs: 0,
    }),
  ).resolves.toMatchObject({ outcome: "applied" });
  const document = await readCatalogDocument({ homeDir });
  expect(document.entries).toHaveLength(1);
  expect(document.entries[0]).toMatchObject({
    entryId: "entry-after-repair",
  });
});

test("keeps an initializing generation unpublished until its owner is complete", async () => {
  const homeDir = await makeTemporaryDirectory("bearing-home-");
  await mkdir(join(homeDir, ".bearing"));
  const location = catalogLocationFor(homeDir);
  const directoryCreated = deferred();
  const continueWriter = deferred();
  let firstCreation = true;
  let operationCalled = false;
  const writer = createCooperativeLock({
    afterLockDirectoryCreated: async () => {
      if (!firstCreation) return;
      firstCreation = false;
      directoryCreated.resolve();
      await continueWriter.promise;
    },
  });
  const writerRun = writer(location, 500, async () => {
    operationCalled = true;
  });
  await directoryCreated.promise;
  await expect(repairCatalogLock({ homeDir, confirmed: true })).rejects.toMatchObject({
    reason: "live-owner",
  });

  expect(operationCalled).toBeFalse();
  continueWriter.resolve();
  await expect(writerRun).resolves.toBeUndefined();
  expect(operationCalled).toBeTrue();
});

test("exact repair removes a proven-dead pre-owner initializer", async () => {
  const homeDir = await makeTemporaryDirectory("bearing-home-");
  const location = catalogLocationFor(homeDir);
  await mkdir(join(homeDir, ".bearing"));
  const pid = absentPid();
  const candidate = `${location.lock}.${pid.toString(36)}.AAAAAAAAAAAAAAAAAAAAAA.initializing`;
  await mkdir(candidate);

  await expect(repairCatalogLock({ homeDir, confirmed: true })).resolves.toEqual({
    outcome: "applied",
  });
  await expect(access(candidate)).rejects.toThrow();
});

test("legacy empty initializer remains indeterminate without PID evidence", async () => {
  const homeDir = await makeTemporaryDirectory("bearing-home-");
  const location = catalogLocationFor(homeDir);
  await mkdir(join(homeDir, ".bearing"));
  const candidate = `${location.lock}.00000000-0000-4000-8000-000000000000.initializing`;
  await mkdir(candidate);

  await expect(repairCatalogLock({ homeDir, confirmed: true })).rejects.toMatchObject({
    reason: "indeterminate-owner",
  });
  await access(candidate);
});

test("initializer repair refuses a symlink before inspecting its external owner", async () => {
  const homeDir = await makeTemporaryDirectory("bearing-home-");
  const location = catalogLocationFor(homeDir);
  await mkdir(join(homeDir, ".bearing"));
  const outside = join(homeDir, "outside-initializer");
  await mkdir(outside);
  const ownerBytes = `${JSON.stringify({ pid: process.pid, token: "outside-live" })}\n`;
  await writeFile(join(outside, "owner.json"), ownerBytes);
  const candidate = `${location.lock}.00000000-0000-4000-8000-000000000000.initializing`;
  await symlink(outside, candidate);

  await expect(repairCatalogLock({ homeDir, confirmed: true })).rejects.toMatchObject({
    reason: "unsafe-lock",
  });
  expect(await readFile(join(outside, "owner.json"), "utf8")).toBe(ownerBytes);
  expect((await lstat(candidate)).isSymbolicLink()).toBeTrue();
});

test("treats out-of-range PIDs as malformed and explicitly repairable", async () => {
  const homeDir = await makeTemporaryDirectory("bearing-home-");
  const repoRoot = await createValidBearingRepo();
  await createLock(homeDir, { pid: 0x8000_0000, token: "invalid-platform-pid" });

  await expect(upsertCatalogEntry({ homeDir, repoRoot, lockTimeoutMs: 0 })).rejects.toBeInstanceOf(
    CatalogLockRecoveryError,
  );
  await expect(repairCatalogLock({ homeDir, confirmed: true })).resolves.toEqual({
    outcome: "applied",
  });
});

test("repairs only recognized atomic-owner staging and preserves unknown siblings", async () => {
  const stagingName = "owner.json.00000000-0000-4000-8000-000000000000.tmp";
  const repairedHome = await makeTemporaryDirectory("bearing-home-");
  const repairedLock = join(repairedHome, ".bearing/catalog.lock");
  await mkdir(repairedLock, { recursive: true });
  await writeFile(join(repairedLock, stagingName), "partial-owner\n");

  await expect(repairCatalogLock({ homeDir: repairedHome, confirmed: true })).resolves.toEqual({
    outcome: "applied",
  });
  await expect(access(repairedLock)).rejects.toThrow();

  const refusedHome = await makeTemporaryDirectory("bearing-home-");
  const refusedLock = join(refusedHome, ".bearing/catalog.lock");
  await mkdir(refusedLock, { recursive: true });
  await writeFile(join(refusedLock, stagingName), "partial-owner\n");
  await writeFile(join(refusedLock, "unknown.tmp"), "preserve\n");

  await expect(repairCatalogLock({ homeDir: refusedHome, confirmed: true })).rejects.toMatchObject({
    reason: "unsafe-lock",
  });
  expect(await readFile(join(refusedLock, stagingName), "utf8")).toBe("partial-owner\n");
  expect(await readFile(join(refusedLock, "unknown.tmp"), "utf8")).toBe("preserve\n");
});

test("reuses an empty recovery container left beside an abandoned owner", async () => {
  const homeDir = await makeTemporaryDirectory("bearing-home-");
  const location = catalogLocationFor(homeDir);
  await createLock(homeDir, { pid: absentPid(), token: "dead-with-empty-recovery" });
  await mkdir(location.lockRecovery);

  const lock = createCooperativeLock();
  await expect(lock(location, 0, async () => "reclaimed")).resolves.toBe("reclaimed");
  await expect(access(location.lock)).rejects.toThrow();
});

test("reclaimer never unlinks a live replacement installed after final validation", async () => {
  const homeDir = await makeTemporaryDirectory("bearing-home-");
  const location = catalogLocationFor(homeDir);
  await createLock(homeDir, { pid: absentPid(), token: "dead-before-replacement" });
  let operationCalled = false;
  const lock = createCooperativeLock({
    afterRecoveryClaim: async (phase) => {
      if (phase !== "reclaim") return;
      await unlink(location.lockOwner).catch(() => undefined);
      await writeFile(
        location.lockOwner,
        `${JSON.stringify({ pid: process.pid, token: "live-replacement" })}\n`,
      );
    },
  });

  await expect(
    lock(location, 0, async () => {
      operationCalled = true;
    }),
  ).rejects.toBeInstanceOf(CatalogLockRecoveryError);
  expect(operationCalled).toBeFalse();
  expect(JSON.parse(await readFile(location.lockOwner, "utf8"))).toEqual({
    pid: process.pid,
    token: "live-replacement",
  });
});

test("owner rollback restores a replacement symlink without hard-linking its referent", async () => {
  const homeDir = await makeTemporaryDirectory("bearing-home-");
  const location = catalogLocationFor(homeDir);
  await createLock(homeDir, { pid: absentPid(), token: "dead-before-symlink" });
  const outside = join(homeDir, "outside-owner");
  await writeFile(outside, "outside-bytes\n");
  const outsideBefore = await lstat(outside, { bigint: true });
  const lock = createCooperativeLock({
    afterRecoveryClaim: async (phase) => {
      if (phase !== "reclaim") return;
      await unlink(location.lockOwner);
      await symlink(outside, location.lockOwner);
    },
  });

  await expect(lock(location, 0, async () => undefined)).rejects.toBeInstanceOf(
    CatalogLockRecoveryError,
  );
  expect((await lstat(location.lockOwner)).isSymbolicLink()).toBeTrue();
  const outsideAfter = await lstat(outside, { bigint: true });
  expect([outsideAfter.dev, outsideAfter.ino, outsideAfter.nlink]).toEqual([
    outsideBefore.dev,
    outsideBefore.ino,
    outsideBefore.nlink,
  ]);
  expect(await readFile(outside, "utf8")).toBe("outside-bytes\n");
});

test("release compares the exact owner generation instead of only its token", async () => {
  const homeDir = await makeTemporaryDirectory("bearing-home-");
  await mkdir(join(homeDir, ".bearing"));
  const location = catalogLocationFor(homeDir);
  let capturedOwner: { pid: number; token: string } | undefined;
  const lock = createCooperativeLock({
    afterRecoveryClaim: async (phase) => {
      if (phase !== "release" || capturedOwner === undefined) return;
      await unlink(location.lockOwner).catch(() => undefined);
      await writeFile(location.lockOwner, `${JSON.stringify(capturedOwner)}\n`);
    },
  });

  await expect(
    lock(location, 0, async () => {
      capturedOwner = JSON.parse(await readFile(location.lockOwner, "utf8"));
      return "completed";
    }),
  ).rejects.toThrow();
  expect(JSON.parse(await readFile(location.lockOwner, "utf8"))).toEqual(capturedOwner);
});

test("withdraws its live generation when owner publication is interrupted", async () => {
  const homeDir = await makeTemporaryDirectory("bearing-home-");
  await mkdir(join(homeDir, ".bearing"));
  const location = catalogLocationFor(homeDir);
  const lock = createCooperativeLock({
    afterOwnerPublished: async () => {
      throw new Error("publication interrupted");
    },
  });

  await expect(lock(location, 0, async () => undefined)).rejects.toThrow("publication interrupted");
  await expect(access(location.lockOwner)).rejects.toThrow();
  await expect(repairCatalogLock({ homeDir, confirmed: true })).resolves.toEqual({
    outcome: "no-op",
  });
});

test("confirmed repair consumes a staged owner left inside recovery", async () => {
  const homeDir = await makeTemporaryDirectory("bearing-home-");
  const location = catalogLocationFor(homeDir);
  await mkdir(location.lockRecovery, { recursive: true });
  await writeFile(
    join(location.lockRecovery, "owner.00000000-0000-4000-8000-000000000000.staged"),
    `${JSON.stringify({ pid: absentPid(), token: "staged-dead-owner" })}\n`,
  );

  await expect(repairCatalogLock({ homeDir, confirmed: true })).resolves.toEqual({
    outcome: "applied",
  });
  await expect(access(location.lock)).rejects.toThrow();
});

test("confirmed repair recovers dead, empty, and malformed recovery claims", async () => {
  const owners: unknown[] = [
    { pid: absentPid(), token: "dead-recovery-claim" },
    undefined,
    "malformed",
  ];
  for (const owner of owners) {
    const homeDir = await makeTemporaryDirectory("bearing-home-");
    const location = catalogLocationFor(homeDir);
    const claim = join(location.lockRecovery, "claim");
    await mkdir(claim, { recursive: true });
    if (owner !== undefined) {
      await writeFile(
        join(claim, "owner.json"),
        owner === "malformed" ? "not-json\n" : `${JSON.stringify(owner)}\n`,
      );
    }

    await expect(repairCatalogLock({ homeDir, confirmed: true })).resolves.toEqual({
      outcome: "applied",
    });
    await expect(access(location.lock)).rejects.toThrow();
  }
});

test("confirmed repair stays behind a live recovery claim", async () => {
  const homeDir = await makeTemporaryDirectory("bearing-home-");
  const location = catalogLocationFor(homeDir);
  const claim = join(location.lockRecovery, "claim");
  await mkdir(claim, { recursive: true });
  await writeFile(
    join(claim, "owner.json"),
    `${JSON.stringify({ pid: process.pid, token: "live-recovery-claim" })}\n`,
  );

  await expect(repairCatalogLock({ homeDir, confirmed: true })).rejects.toMatchObject({
    reason: "lock-changed",
  });
  await access(claim);
});

test("exposes a generation-bound handle for operation-scoped leases", async () => {
  const homeDir = await makeTemporaryDirectory("bearing-home-");
  await mkdir(join(homeDir, ".bearing"));
  const location = catalogLocationFor(homeDir);
  const handle = await acquireOwnedLock(location, 0);

  await expect(acquireOwnedLock(location, 0)).rejects.toBeInstanceOf(CatalogLockError);
  await handle.release();
  await handle.release();

  const next = await acquireOwnedLock(location, 0);
  await next.release();
  await expect(access(location.lock)).rejects.toThrow();
});

test("release outlives a fail-fast acquisition timeout during transient recovery contention", async () => {
  const homeDir = await makeTemporaryDirectory("bearing-home-");
  await mkdir(join(homeDir, ".bearing"));
  const location = catalogLocationFor(homeDir);
  const contended = deferred();
  const handle = await acquireOwnedLock(location, 0, {
    afterRecoveryContention: async () => contended.resolve(),
  });
  const directory = await inspectDirectoryGeneration(location.lock);
  if (directory === undefined) throw new Error("Expected a live lock generation.");
  const competingClaim = await tryClaimRecovery(location, directory);
  if (competingClaim === undefined) throw new Error("Expected a competing recovery claim.");

  const releasing = handle.release();
  await contended.promise;
  await releaseRecoveryClaim(location, competingClaim);

  await expect(releasing).resolves.toBeUndefined();
  await expect(access(location.lock)).rejects.toThrow();
});

test("rejects unsafe canonical lock nodes immediately without following or replacing them", async () => {
  for (const kind of ["symlink", "fifo", "regular"] as const) {
    const homeDir = await makeTemporaryDirectory("bearing-home-");
    const location = catalogLocationFor(homeDir);
    await mkdir(join(homeDir, ".bearing"));
    if (kind === "symlink") {
      const outside = join(homeDir, "outside-lock");
      await mkdir(outside);
      await writeFile(join(outside, "marker"), "outside\n");
      await symlink(outside, location.lock);
    } else if (kind === "fifo") {
      const fifo = Bun.spawn(["mkfifo", location.lock], { stdout: "ignore", stderr: "pipe" });
      expect(await fifo.exited).toBe(0);
    } else {
      await writeFile(location.lock, "regular-lock\n");
    }

    const startedAt = performance.now();
    await expect(
      createCooperativeLock()(location, 0, async () => undefined),
    ).rejects.toBeInstanceOf(CatalogLockRecoveryError);
    expect(performance.now() - startedAt).toBeLessThan(200);
    const preserved = await lstat(location.lock);
    if (kind === "symlink") {
      expect(preserved.isSymbolicLink()).toBeTrue();
      expect(await readFile(join(homeDir, "outside-lock/marker"), "utf8")).toBe("outside\n");
    } else if (kind === "fifo") {
      expect(preserved.isFIFO()).toBeTrue();
    } else {
      expect(await readFile(location.lock, "utf8")).toBe("regular-lock\n");
    }
  }
});

test("repair binds recovery as an exact directory before inspecting claim debris", async () => {
  for (const kind of ["symlink", "fifo", "regular", "hardlink"] as const) {
    const homeDir = await makeTemporaryDirectory("bearing-home-");
    const location = catalogLocationFor(homeDir);
    await createLock(homeDir, { pid: absentPid(), token: `dead-${kind}` });
    const peer = join(homeDir, `recovery-${kind}`);
    if (kind === "symlink") {
      await mkdir(peer);
      await writeFile(join(peer, "marker"), "outside\n");
      await symlink(peer, location.lockRecovery);
    } else if (kind === "fifo") {
      const fifo = Bun.spawn(["mkfifo", location.lockRecovery], {
        stdout: "ignore",
        stderr: "pipe",
      });
      expect(await fifo.exited).toBe(0);
    } else {
      await writeFile(peer, `${kind}-bytes\n`);
      if (kind === "hardlink") await link(peer, location.lockRecovery);
      else await rename(peer, location.lockRecovery);
    }
    const before = await lstat(location.lockRecovery, { bigint: true });
    const startedAt = performance.now();
    await expect(repairCatalogLock({ homeDir, confirmed: true })).rejects.toMatchObject({
      reason: "unsafe-lock",
    });
    expect(performance.now() - startedAt).toBeLessThan(200);
    const after = await lstat(location.lockRecovery, { bigint: true });
    expect({ dev: after.dev, ino: after.ino, nlink: after.nlink }).toEqual({
      dev: before.dev,
      ino: before.ino,
      nlink: before.nlink,
    });
    if (kind === "symlink") {
      expect(await readFile(join(peer, "marker"), "utf8")).toBe("outside\n");
    } else if (kind !== "fifo") {
      expect(await readFile(location.lockRecovery, "utf8")).toBe(`${kind}-bytes\n`);
      if (kind === "hardlink") expect(await readFile(peer, "utf8")).toBe("hardlink-bytes\n");
    }
  }
});

test("repair refuses unknown recovery siblings before clearing recognized debris", async () => {
  const homeDir = await makeTemporaryDirectory("bearing-home-");
  const location = catalogLocationFor(homeDir);
  await createLock(homeDir, { pid: absentPid(), token: "dead-with-debris" });
  const debris = join(
    location.lockRecovery,
    "claim.00000000-0000-4000-8000-000000000000.abandoned",
  );
  await mkdir(debris, { recursive: true });
  await writeFile(
    join(debris, "owner.json"),
    `${JSON.stringify({ pid: absentPid(), token: "dead-debris" })}\n`,
  );
  const unknown = join(location.lockRecovery, "unknown");
  await writeFile(unknown, "preserve\n");
  const debrisBefore = await lstat(debris, { bigint: true });
  const unknownBefore = await lstat(unknown, { bigint: true });

  await expect(repairCatalogLock({ homeDir, confirmed: true })).rejects.toMatchObject({
    reason: "unsafe-lock",
  });
  const debrisAfter = await lstat(debris, { bigint: true });
  const unknownAfter = await lstat(unknown, { bigint: true });
  expect([debrisAfter.dev, debrisAfter.ino]).toEqual([debrisBefore.dev, debrisBefore.ino]);
  expect([unknownAfter.dev, unknownAfter.ino]).toEqual([unknownBefore.dev, unknownBefore.ino]);
  expect(await readFile(unknown, "utf8")).toBe("preserve\n");
});

test("automatic reclaim validates the exact generation before staging its owner", async () => {
  const homeDir = await makeTemporaryDirectory("bearing-home-");
  const location = catalogLocationFor(homeDir);
  await createLock(homeDir, { pid: absentPid(), token: "dead-unknown-sibling" });
  await mkdir(location.lockRecovery);
  const unknown = join(location.lock, "unknown");
  await writeFile(unknown, "preserve\n");
  const ownerBefore = await lstat(location.lockOwner, { bigint: true });
  const recoveryBefore = await lstat(location.lockRecovery, { bigint: true });
  const unknownBefore = await lstat(unknown, { bigint: true });
  const entriesBefore = (await readdir(location.lock)).sort();

  await expect(createCooperativeLock()(location, 0, async () => undefined)).rejects.toBeInstanceOf(
    CatalogLockRecoveryError,
  );
  const ownerAfter = await lstat(location.lockOwner, { bigint: true });
  const recoveryAfter = await lstat(location.lockRecovery, { bigint: true });
  const unknownAfter = await lstat(unknown, { bigint: true });
  expect([ownerAfter.dev, ownerAfter.ino]).toEqual([ownerBefore.dev, ownerBefore.ino]);
  expect([recoveryAfter.dev, recoveryAfter.ino]).toEqual([recoveryBefore.dev, recoveryBefore.ino]);
  expect([unknownAfter.dev, unknownAfter.ino]).toEqual([unknownBefore.dev, unknownBefore.ino]);
  expect((await readdir(location.lock)).sort()).toEqual(entriesBefore);
  expect(await readFile(unknown, "utf8")).toBe("preserve\n");
});

test("repair converges recognized claim debris across every self-describing suffix", async () => {
  const suffixes = ["tmp", "release", "abandoned"] as const;
  const owners: unknown[] = [undefined, { pid: absentPid(), token: "dead" }, "malformed"];
  for (const suffix of suffixes) {
    for (const owner of owners) {
      const homeDir = await makeTemporaryDirectory("bearing-home-");
      const location = catalogLocationFor(homeDir);
      const debris = join(
        location.lockRecovery,
        `claim.00000000-0000-4000-8000-000000000000.${suffix}`,
      );
      await mkdir(debris, { recursive: true });
      if (owner !== undefined) {
        await writeFile(
          join(debris, "owner.json"),
          owner === "malformed" ? "not-json\n" : `${JSON.stringify(owner)}\n`,
        );
      }
      await expect(repairCatalogLock({ homeDir, confirmed: true })).resolves.toEqual({
        outcome: "applied",
      });
      await expect(access(location.lock)).rejects.toThrow();
    }
  }
});

test("repair preserves live claim debris for every recognized suffix", async () => {
  for (const suffix of ["tmp", "release", "abandoned"] as const) {
    const homeDir = await makeTemporaryDirectory("bearing-home-");
    const location = catalogLocationFor(homeDir);
    const debris = join(
      location.lockRecovery,
      `claim.00000000-0000-4000-8000-000000000000.${suffix}`,
    );
    await mkdir(debris, { recursive: true });
    const bytes = `${JSON.stringify({ pid: process.pid, token: `live-${suffix}` })}\n`;
    await writeFile(join(debris, "owner.json"), bytes);
    const before = await lstat(debris, { bigint: true });
    await expect(repairCatalogLock({ homeDir, confirmed: true })).rejects.toMatchObject({
      reason: "lock-changed",
    });
    const after = await lstat(debris, { bigint: true });
    expect([after.dev, after.ino]).toEqual([before.dev, before.ino]);
    expect(await readFile(join(debris, "owner.json"), "utf8")).toBe(bytes);
  }
});

test("reclaim restores a replacement canonical generation after a quarantine race", async () => {
  const homeDir = await makeTemporaryDirectory("bearing-home-");
  const location = catalogLocationFor(homeDir);
  const preserved = `${location.lock}.preserved-reclaim`;
  await createLock(homeDir, { pid: absentPid(), token: "dead-before-quarantine" });
  const lock = createCooperativeLock({
    beforeLockQuarantine: async (phase) => {
      if (phase === "reclaim") {
        await replaceCanonicalLock(location, preserved, "replacement-reclaim");
      }
    },
  });

  await expect(lock(location, 0, async () => undefined)).rejects.toBeInstanceOf(
    CatalogLockRecoveryError,
  );
  expect(await readCanonicalOwner(location)).toMatchObject({ token: "replacement-reclaim" });
  await access(preserved);
  expect(await readdir(join(preserved, "recovery"))).toEqual(expect.arrayContaining(["claim"]));
});

test("release restores a replacement canonical generation after a quarantine race", async () => {
  const homeDir = await makeTemporaryDirectory("bearing-home-");
  const location = catalogLocationFor(homeDir);
  const preserved = `${location.lock}.preserved-release`;
  await mkdir(join(homeDir, ".bearing"));
  const handle = await acquireOwnedLock(location, 0, {
    beforeLockQuarantine: async (phase) => {
      if (phase === "release") {
        await replaceCanonicalLock(location, preserved, "replacement-release");
      }
    },
  });

  await expect(handle.release()).rejects.toBeInstanceOf(CatalogLockRecoveryError);
  expect(await readCanonicalOwner(location)).toMatchObject({ token: "replacement-release" });
  await access(preserved);
  expect(await readdir(join(preserved, "recovery"))).toEqual(expect.arrayContaining(["claim"]));
});

test("claim release restores a replacement claim and preserves the captured claim", async () => {
  const homeDir = await makeTemporaryDirectory("bearing-home-");
  const location = catalogLocationFor(homeDir);
  await mkdir(location.lock, { recursive: true });
  const directory = await inspectDirectoryGeneration(location.lock);
  if (directory === undefined) throw new Error("Expected lock generation.");
  const claim = await tryClaimRecovery(location, directory);
  if (claim === undefined) throw new Error("Expected recovery claim.");
  const claimPath = join(location.lockRecovery, "claim");
  const preserved = join(homeDir, "preserved-claim");
  const originalBytes = await readFile(join(claimPath, "owner.json"));

  await expect(
    releaseRecoveryClaim(location, claim, async () => {
      await rename(claimPath, preserved);
      await mkdir(claimPath);
      await writeFile(
        join(claimPath, "owner.json"),
        `${JSON.stringify({ pid: process.pid, token: "replacement-claim" })}\n`,
      );
    }),
  ).rejects.toBeInstanceOf(CatalogLockRecoveryError);
  expect(JSON.parse(await readFile(join(claimPath, "owner.json"), "utf8"))).toMatchObject({
    token: "replacement-claim",
  });
  expect(await readFile(join(preserved, "owner.json"))).toEqual(originalBytes);
});

test("global repair converges exact initializing and quarantine namespace debris", async () => {
  for (const kind of ["initializing", "quarantine"] as const) {
    const homeDir = await makeTemporaryDirectory("bearing-home-");
    const location = catalogLocationFor(homeDir);
    const debris = `${location.lock}.00000000-0000-4000-8000-000000000000.${kind}`;
    await mkdir(debris, { recursive: true });
    await writeFile(
      join(debris, "owner.json"),
      `${JSON.stringify({ pid: absentPid(), token: `dead-${kind}` })}\n`,
    );

    await expect(repairCatalogLock({ homeDir, confirmed: true })).resolves.toEqual({
      outcome: "applied",
    });
    await expect(access(debris)).rejects.toThrow();
    const repoRoot = await createValidBearingRepo();
    await expect(
      upsertCatalogEntry({ homeDir, repoRoot, lockTimeoutMs: 0 }),
    ).resolves.toMatchObject({ outcome: "applied" });
  }
});

test("global repair preserves live or unknown same-prefix namespace debris", async () => {
  const liveHome = await makeTemporaryDirectory("bearing-home-");
  const liveLocation = catalogLocationFor(liveHome);
  const liveDebris = `${liveLocation.lock}.00000000-0000-4000-8000-000000000000.initializing`;
  await mkdir(liveDebris, { recursive: true });
  await writeFile(
    join(liveDebris, "owner.json"),
    `${JSON.stringify({ pid: process.pid, token: "live-initializing" })}\n`,
  );
  await expect(repairCatalogLock({ homeDir: liveHome, confirmed: true })).rejects.toMatchObject({
    reason: "live-owner",
  });
  await access(liveDebris);

  const unknownHome = await makeTemporaryDirectory("bearing-home-");
  const unknownLocation = catalogLocationFor(unknownHome);
  const unknown = `${unknownLocation.lock}.not-a-uuid.initializing`;
  await mkdir(unknown, { recursive: true });
  await writeFile(join(unknown, "marker"), "preserve\n");
  await expect(repairCatalogLock({ homeDir: unknownHome, confirmed: true })).rejects.toMatchObject({
    reason: "unsafe-lock",
  });
  expect(await readFile(join(unknown, "marker"), "utf8")).toBe("preserve\n");
});
