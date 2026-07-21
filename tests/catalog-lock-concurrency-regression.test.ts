import { expect, test } from "bun:test";
import {
  access,
  lstat,
  mkdir,
  readdir,
  readlink,
  rename,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { withCatalogEntryLock } from "../src/catalog/entry-lease-guards";
import { catalogLocationFor } from "../src/catalog/location";
import { acquireOwnedLock, createCooperativeLock } from "../src/catalog/lock";
import {
  replaceBoundClaimOwner,
  restoreBoundClaimOwner,
} from "../src/catalog/lock-bound-claim-owner";
import {
  BoundLockMutationError,
  strictRemoveBoundEmptyDirectory,
  strictRemoveBoundOwnerFile,
} from "../src/catalog/lock-bound-owner";
import { boundRequest, runBoundChild } from "../src/catalog/lock-bound-owner-process";
import { inspectLockOwner } from "../src/catalog/lock-owner";
import { inspectDirectoryGeneration } from "../src/catalog/lock-recovery";
import { CatalogLockError, CatalogLockRecoveryError } from "../src/catalog/store";
import { makeTemporaryDirectory } from "./helpers";

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

const deferred = (): Readonly<{ promise: Promise<void>; resolve: () => void }> => {
  let resolve = () => {};
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
};

const createDeadLock = async (homeDir: string): Promise<ReturnType<typeof catalogLocationFor>> => {
  const location = catalogLocationFor(homeDir);
  await mkdir(location.lock, { recursive: true });
  await writeFile(
    location.lockOwner,
    `${JSON.stringify({ pid: absentPid(), token: "dead-generation" })}\n`,
  );
  return location;
};

test("withdraws an exact claim published into a reused generation path", async () => {
  const homeDir = await makeTemporaryDirectory("bearing-home-");
  const location = await createDeadLock(homeDir);
  const ready = deferred();
  const resume = deferred();
  const contender = createCooperativeLock({
    afterRecoveryContainerReady: async (phase) => {
      if (phase !== "reclaim") return;
      ready.resolve();
      await resume.promise;
    },
  });
  const contenderRun = contender(location, 0, async () => undefined).then(
    () => undefined,
    (error: unknown) => error,
  );
  await ready.promise;
  await createCooperativeLock()(location, 1_000, async () => undefined);
  const replacement = await acquireOwnedLock(location, 0);
  await mkdir(location.lockRecovery);
  resume.resolve();

  expect(await contenderRun).toBeInstanceOf(CatalogLockError);
  expect(await readdir(location.lockRecovery)).toEqual([]);
  await expect(replacement.release()).resolves.toBeUndefined();
});

test("classifies an unsafe canonical recovery claim as indeterminate", async () => {
  const homeDir = await makeTemporaryDirectory("bearing-home-");
  const location = await createDeadLock(homeDir);
  const outside = join(homeDir, "outside-claim");
  await mkdir(location.lockRecovery);
  await writeFile(outside, "preserve\n");
  await symlink(outside, join(location.lockRecovery, "claim"));

  await expect(createCooperativeLock()(location, 0, async () => undefined)).rejects.toBeInstanceOf(
    CatalogLockRecoveryError,
  );
  await access(outside);
});

test("classifies malformed claim shapes as indeterminate instead of busy", async () => {
  for (const kind of ["file", "empty", "malformed"] as const) {
    const homeDir = await makeTemporaryDirectory("bearing-home-");
    const location = await createDeadLock(homeDir);
    const claim = join(location.lockRecovery, "claim");
    await mkdir(location.lockRecovery);
    if (kind === "file") await writeFile(claim, "unsafe\n");
    else {
      await mkdir(claim);
      if (kind === "malformed") await writeFile(join(claim, "owner.json"), "not-json\n");
    }

    await expect(
      createCooperativeLock()(location, 0, async () => undefined),
    ).rejects.toBeInstanceOf(CatalogLockRecoveryError);
  }
});

test("treats only an exact live recovery claim as ordinary contention", async () => {
  const homeDir = await makeTemporaryDirectory("bearing-home-");
  const location = await createDeadLock(homeDir);
  const claim = join(location.lockRecovery, "claim");
  await mkdir(claim, { recursive: true });
  await writeFile(
    join(claim, "owner.json"),
    `${JSON.stringify({ pid: process.pid, token: "active-recovery" })}\n`,
  );

  await expect(createCooperativeLock()(location, 0, async () => undefined)).rejects.toBeInstanceOf(
    CatalogLockError,
  );
});

test("overlapping dead-owner reclaim candidates converge without indeterminate failures", async () => {
  const homeDir = await makeTemporaryDirectory("bearing-home-");
  const location = await createDeadLock(homeDir);
  const count = 16;
  const allReady = deferred();
  let ready = 0;
  const runs = Array.from({ length: count }, (_, index) => {
    const lock = createCooperativeLock({
      afterRecoveryContainerReady: async (phase) => {
        if (phase !== "reclaim") return;
        ready += 1;
        if (ready === count) allReady.resolve();
        await allReady.promise;
      },
    });
    return lock(location, 1_000, async () => index);
  });

  const outcomes = await Promise.allSettled(runs);
  const rejected = outcomes.flatMap((outcome) =>
    outcome.status === "fulfilled"
      ? []
      : [
          outcome.reason instanceof Error
            ? `${outcome.reason.name}: ${outcome.reason.message}`
            : String(outcome.reason),
        ],
  );
  expect(rejected).toEqual([]);
});

test("a maximum-length Entry ID acquires and releases without ENAMETOOLONG", async () => {
  const homeDir = await makeTemporaryDirectory("bearing-home-");
  const entryId = "a".repeat(128);
  await expect(withCatalogEntryLock(homeDir, entryId, 0, async () => "complete")).resolves.toBe(
    "complete",
  );
});

const injectLateCandidate = async (recovery: string): Promise<void> => {
  const candidate = join(recovery, "claim.00000000-0000-4000-8000-000000000000.tmp");
  await mkdir(candidate);
  await writeFile(
    join(candidate, "owner.json"),
    `${JSON.stringify({ pid: process.pid, token: "late-candidate" })}\n`,
  );
};

test("release drains a claim candidate that arrives at the quarantine boundary", async () => {
  const homeDir = await makeTemporaryDirectory("bearing-home-");
  await mkdir(join(homeDir, ".bearing"));
  const location = catalogLocationFor(homeDir);
  const handle = await acquireOwnedLock(location, 0, {
    beforeLockQuarantine: async (phase) => {
      if (phase === "release") await injectLateCandidate(location.lockRecovery);
    },
  });

  await expect(handle.release()).resolves.toBeUndefined();
  await expect(access(location.lock)).rejects.toThrow();
});

test("release never follows a same-generation lock parent symlink", async () => {
  const homeDir = await makeTemporaryDirectory("bearing-home-");
  const root = join(homeDir, ".bearing");
  const preserved = join(homeDir, "preserved-bearing-root");
  await mkdir(root);
  const location = catalogLocationFor(homeDir);
  const handle = await acquireOwnedLock(location, 0, {
    beforeLockQuarantine: async (phase) => {
      if (phase !== "release") return;
      await rename(root, preserved);
      await symlink(preserved, root);
    },
  });
  const lockBefore = await lstat(location.lock, { bigint: true });

  await expect(handle.release()).rejects.toBeInstanceOf(CatalogLockRecoveryError);

  expect(await readlink(root)).toBe(preserved);
  const lockAfter = await lstat(join(preserved, "catalog.lock"), { bigint: true });
  expect([lockAfter.dev, lockAfter.ino]).toEqual([lockBefore.dev, lockBefore.ino]);
  await access(join(preserved, "catalog.lock"));
});

test("initializer owner publication never follows a replaced directory symlink", async () => {
  const homeDir = await makeTemporaryDirectory("bearing-home-");
  const root = join(homeDir, ".bearing");
  const outside = join(homeDir, "outside");
  const preserved = join(homeDir, "preserved-initializer");
  await mkdir(root);
  await mkdir(outside);
  await writeFile(join(outside, "sentinel"), "preserve\n");
  const location = catalogLocationFor(homeDir);
  const lock = createCooperativeLock({
    afterLockDirectoryCreated: async () => {
      const name = (await readdir(root)).find((entry) => entry.endsWith(".initializing"));
      if (name === undefined) throw new Error("Expected an initializer candidate.");
      const candidate = join(root, name);
      await rename(candidate, preserved);
      await symlink(outside, candidate);
    },
  });

  await expect(lock(location, 0, async () => undefined)).rejects.toBeInstanceOf(
    CatalogLockRecoveryError,
  );
  await expect(access(join(outside, "owner.json"))).rejects.toThrow();
  await access(join(outside, "sentinel"));
  await access(preserved);
});

test("lock acquisition never mutates the Host process cwd", async () => {
  const homeDir = await makeTemporaryDirectory("bearing-home-");
  await mkdir(join(homeDir, ".bearing"));
  const location = catalogLocationFor(homeDir);
  const originalCwd = process.cwd();
  const originalChdir = process.chdir;
  let hostChdirCalls = 0;
  process.chdir = ((directory: string) => {
    hostChdirCalls += 1;
    originalChdir(directory);
  }) as typeof process.chdir;
  try {
    await createCooperativeLock()(location, 0, async () => undefined);
  } finally {
    process.chdir = originalChdir;
  }

  expect(hostChdirCalls).toBe(0);
  expect(process.cwd()).toBe(originalCwd);
});

test("initializer owner publication rejects a same-generation symlink alias", async () => {
  const homeDir = await makeTemporaryDirectory("bearing-home-");
  const root = join(homeDir, ".bearing");
  const preserved = join(homeDir, "preserved-initializer");
  await mkdir(root);
  const location = catalogLocationFor(homeDir);
  const lock = createCooperativeLock({
    afterLockDirectoryCreated: async () => {
      const name = (await readdir(root)).find((entry) => entry.endsWith(".initializing"));
      if (name === undefined) throw new Error("Expected an initializer candidate.");
      const candidate = join(root, name);
      await rename(candidate, preserved);
      await symlink(preserved, candidate);
    },
  });

  await expect(lock(location, 0, async () => undefined)).rejects.toBeInstanceOf(
    CatalogLockRecoveryError,
  );
  await expect(access(join(preserved, "owner.json"))).rejects.toThrow();
});

test("initializer publication rejects a same-generation alias after writing its owner", async () => {
  const homeDir = await makeTemporaryDirectory("bearing-home-");
  const root = join(homeDir, ".bearing");
  const preserved = join(homeDir, "preserved-initializer");
  await mkdir(root);
  const location = catalogLocationFor(homeDir);
  const lock = createCooperativeLock({
    afterOwnerPublished: async () => {
      const name = (await readdir(root)).find((entry) => entry.endsWith(".initializing"));
      if (name === undefined) throw new Error("Expected an initializer candidate.");
      const candidate = join(root, name);
      await rename(candidate, preserved);
      await symlink(preserved, candidate);
    },
  });

  await expect(lock(location, 0, async () => undefined)).rejects.toBeInstanceOf(
    CatalogLockRecoveryError,
  );
  await access(join(preserved, "owner.json"));
  await expect(access(location.lock)).rejects.toThrow();
});

test("a committed publish never cleans an old-name alias after canonical confirmation fails", async () => {
  const homeDir = await makeTemporaryDirectory("bearing-home-");
  const root = join(homeDir, ".bearing");
  const preserved = join(homeDir, "published-generation");
  const preservedInitializer = join(homeDir, "preserved-initializer");
  let oldCandidate = "";
  await mkdir(root);
  const location = catalogLocationFor(homeDir);
  const lock = createCooperativeLock({
    afterOwnerPublished: async () => {
      const name = (await readdir(root)).find((entry) => entry.endsWith(".initializing"));
      if (name === undefined) throw new Error("Expected an initializer candidate.");
      oldCandidate = join(root, name);
    },
    afterLockRenameCommitted: async () => {
      await rename(location.lock, preserved);
      await symlink(preserved, location.lock);
      await rename(oldCandidate, preservedInitializer);
      await symlink(preserved, oldCandidate);
    },
  });

  await expect(lock(location, 0, async () => undefined)).rejects.toBeInstanceOf(
    CatalogLockRecoveryError,
  );
  await access(join(preserved, "owner.json"));
  await access(join(preservedInitializer, "owner.json"));
  expect(await readlink(location.lock)).toBe(preserved);
  expect(await readlink(oldCandidate)).toBe(preserved);
});

test("initializer cleanup preserves a quarantine path replaced by a same-generation alias", async () => {
  const homeDir = await makeTemporaryDirectory("bearing-home-");
  const root = join(homeDir, ".bearing");
  const preserved = join(homeDir, "preserved-quarantine");
  let replacedQuarantine = "";
  await mkdir(root);
  const location = catalogLocationFor(homeDir);
  const lock = createCooperativeLock({
    afterOwnerPublished: async () => {
      await mkdir(location.lock);
      await writeFile(
        location.lockOwner,
        `${JSON.stringify({ pid: process.pid, token: "active-generation" })}\n`,
      );
    },
    afterInitializerQuarantined: async (quarantine) => {
      replacedQuarantine = quarantine;
      await rename(quarantine, preserved);
      await symlink(preserved, quarantine);
    },
  });

  await expect(lock(location, 0, async () => undefined)).rejects.toBeInstanceOf(CatalogLockError);
  await access(join(preserved, "owner.json"));
  expect(await readlink(replacedQuarantine)).toBe(preserved);
});

test("initializer publication never replaces an empty canonical contender", async () => {
  const homeDir = await makeTemporaryDirectory("bearing-home-");
  await mkdir(join(homeDir, ".bearing"));
  const location = catalogLocationFor(homeDir);
  let contender: Readonly<{ device: bigint; inode: bigint }> | undefined;
  const lock = createCooperativeLock({
    afterOwnerPublished: async () => {
      await mkdir(location.lock);
      const metadata = await lstat(location.lock, { bigint: true });
      contender = { device: metadata.dev, inode: metadata.ino };
    },
  });

  await expect(lock(location, 0, async () => undefined)).rejects.toBeInstanceOf(
    CatalogLockRecoveryError,
  );
  if (contender === undefined) throw new Error("Expected a canonical contender.");
  const preserved = await lstat(location.lock, { bigint: true });
  expect(preserved.dev).toBe(contender.device);
  expect(preserved.ino).toBe(contender.inode);
  await expect(access(location.lockOwner)).rejects.toThrow();
});

test("canonical owner publication rejects a same-generation reservation symlink", async () => {
  const homeDir = await makeTemporaryDirectory("bearing-home-");
  const root = join(homeDir, ".bearing");
  const preserved = join(homeDir, "preserved-reservation");
  await mkdir(root);
  const location = catalogLocationFor(homeDir);
  const lock = createCooperativeLock({
    afterLockDestinationReserved: async () => {
      await rename(location.lock, preserved);
      await symlink(preserved, location.lock);
    },
  });

  await expect(lock(location, 0, async () => undefined)).rejects.toBeInstanceOf(
    CatalogLockRecoveryError,
  );
  await expect(access(join(preserved, "owner.json"))).rejects.toThrow();
  expect(await readlink(location.lock)).toBe(preserved);
});

test("canonical owner publication rejects a symlinked reservation parent", async () => {
  const homeDir = await makeTemporaryDirectory("bearing-home-");
  const root = join(homeDir, ".bearing");
  const preservedRoot = join(homeDir, "preserved-bearing-root");
  await mkdir(root);
  const location = catalogLocationFor(homeDir);
  const lock = createCooperativeLock({
    afterLockDestinationReserved: async () => {
      await rename(root, preservedRoot);
      await symlink(preservedRoot, root);
    },
  });

  await expect(lock(location, 0, async () => undefined)).rejects.toBeInstanceOf(
    CatalogLockRecoveryError,
  );
  await expect(access(join(preservedRoot, "catalog.lock", "owner.json"))).rejects.toThrow();
  expect(await readlink(root)).toBe(preservedRoot);
});

test("initializer cleanup never unlinks a replaced owner tombstone", async () => {
  const homeDir = await makeTemporaryDirectory("bearing-home-");
  const root = join(homeDir, ".bearing");
  const preservedOwner = join(homeDir, "preserved-owner.json");
  let replacedTombstone = "";
  await mkdir(root);
  const location = catalogLocationFor(homeDir);
  const lock = createCooperativeLock({
    afterOwnerPublished: async () => {
      await mkdir(location.lock);
      await writeFile(
        location.lockOwner,
        `${JSON.stringify({ pid: process.pid, token: "active-generation" })}\n`,
      );
    },
    afterInitializerOwnerTombstoned: async (quarantine, tombstone) => {
      replacedTombstone = join(quarantine, tombstone);
      await rename(replacedTombstone, preservedOwner);
      await symlink(preservedOwner, replacedTombstone);
    },
  });

  await expect(lock(location, 0, async () => undefined)).rejects.toBeInstanceOf(CatalogLockError);
  await access(preservedOwner);
  expect(await readlink(replacedTombstone)).toBe(preservedOwner);
});

test("bound file retirement preserves unrelated recovery entries", async () => {
  const homeDir = await makeTemporaryDirectory("bearing-home-");
  const container = join(homeDir, "recovery");
  const ownerName = "owner.staged";
  await mkdir(container);
  await writeFile(join(container, ownerName), "staged-owner\n");
  await writeFile(join(container, "claim"), "preserve\n");
  const generation = await inspectDirectoryGeneration(container);
  const owner = await inspectLockOwner(join(container, ownerName));
  if (generation === undefined || owner.state !== "regular") throw new Error("Expected fixture.");

  await strictRemoveBoundOwnerFile(container, generation, ownerName, owner);

  await expect(access(join(container, ownerName))).rejects.toThrow();
  await expect(Bun.file(join(container, "claim")).text()).resolves.toBe("preserve\n");
});

test("bound directory retirement preserves a replacement at its quarantine name", async () => {
  const homeDir = await makeTemporaryDirectory("bearing-home-");
  const candidate = join(homeDir, "candidate");
  const quarantine = join(homeDir, "candidate.quarantine");
  const preserved = join(homeDir, "preserved-candidate");
  await mkdir(candidate);
  const candidateGeneration = await inspectDirectoryGeneration(candidate);
  const parentGeneration = await inspectDirectoryGeneration(homeDir);
  if (candidateGeneration === undefined || parentGeneration === undefined) {
    throw new Error("Expected fixture.");
  }

  await expect(
    strictRemoveBoundEmptyDirectory(
      candidate,
      quarantine,
      candidateGeneration,
      parentGeneration,
      async (moved) => {
        await rename(moved, preserved);
        await mkdir(moved);
      },
    ),
  ).rejects.toBeInstanceOf(CatalogLockRecoveryError);

  await access(preserved);
  await access(quarantine);
  await expect(access(candidate)).rejects.toThrow();
});

test("bound mutation errors disclose a move that may already have committed", async () => {
  const homeDir = await makeTemporaryDirectory("bearing-home-");
  const candidate = join(homeDir, "candidate");
  const quarantine = join(homeDir, "quarantine");
  const ownerPath = join(candidate, "owner.json");
  const owner = { pid: process.pid, token: "owned" };
  await mkdir(candidate);
  await writeFile(ownerPath, `${JSON.stringify(owner)}\n`);
  const [parentGeneration, candidateGeneration, expectedOwner] = await Promise.all([
    inspectDirectoryGeneration(homeDir),
    inspectDirectoryGeneration(candidate),
    inspectLockOwner(ownerPath),
  ]);
  if (
    parentGeneration === undefined ||
    candidateGeneration === undefined ||
    expectedOwner.state !== "regular"
  ) {
    throw new Error("Expected fixture.");
  }

  const failure = await runBoundChild({
    ...boundRequest(
      "retire",
      candidate,
      candidateGeneration,
      "owner.json",
      expectedOwner,
      quarantine,
      parentGeneration,
    ),
    tombstoneName: ".",
  }).catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(BoundLockMutationError);
  expect(failure).toMatchObject({ mutationMayHaveCommitted: true });

  await expect(access(candidate)).rejects.toThrow();
  expect(await Bun.file(join(quarantine, "owner.json")).text()).toBe(`${JSON.stringify(owner)}\n`);
});

test("bound claim owner replacement restores the exact previous owner", async () => {
  const homeDir = await makeTemporaryDirectory("bearing-home-");
  const recovery = join(homeDir, "recovery");
  const claim = join(recovery, "claim");
  const ownerPath = join(claim, "owner.json");
  const stageName = "owner.00000000-0000-4000-8000-000000000000.staged";
  const oldOwner = { pid: process.pid, token: "old-owner" };
  await mkdir(claim, { recursive: true });
  await writeFile(ownerPath, `${JSON.stringify(oldOwner)}\n`);
  const [recoveryGeneration, claimGeneration, expectedOwner] = await Promise.all([
    inspectDirectoryGeneration(recovery),
    inspectDirectoryGeneration(claim),
    inspectLockOwner(ownerPath),
  ]);
  if (
    recoveryGeneration === undefined ||
    claimGeneration === undefined ||
    expectedOwner.state !== "regular"
  ) {
    throw new Error("Expected fixture.");
  }

  const current = await replaceBoundClaimOwner(
    claim,
    claimGeneration,
    recoveryGeneration,
    "owner.json",
    expectedOwner,
    stageName,
    { pid: process.pid, token: "repair-owner" },
  );
  await restoreBoundClaimOwner(
    claim,
    claimGeneration,
    recoveryGeneration,
    "owner.json",
    current,
    stageName,
    expectedOwner,
  );

  expect(await Bun.file(ownerPath).text()).toBe(`${JSON.stringify(oldOwner)}\n`);
  await expect(access(join(recovery, stageName))).rejects.toThrow();
  expect(await inspectDirectoryGeneration(claim)).toEqual(claimGeneration);
});

test("bound claim owner replacement restores an exact previous tombstone name", async () => {
  const homeDir = await makeTemporaryDirectory("bearing-home-");
  const recovery = join(homeDir, "recovery");
  const claim = join(recovery, "claim");
  const previousName = ".owner.MDEyMzQ1Njc4OWFiY2RlZg.tombstone";
  const previousPath = join(claim, previousName);
  const currentPath = join(claim, "owner.json");
  const stageName = "owner.00000000-0000-4000-8000-000000000000.staged";
  const oldOwner = { pid: process.pid, token: "old-owner" };
  await mkdir(claim, { recursive: true });
  await writeFile(previousPath, `${JSON.stringify(oldOwner)}\n`);
  const [recoveryGeneration, claimGeneration, expectedOwner] = await Promise.all([
    inspectDirectoryGeneration(recovery),
    inspectDirectoryGeneration(claim),
    inspectLockOwner(previousPath),
  ]);
  if (
    recoveryGeneration === undefined ||
    claimGeneration === undefined ||
    expectedOwner.state !== "regular"
  ) {
    throw new Error("Expected fixture.");
  }

  const current = await replaceBoundClaimOwner(
    claim,
    claimGeneration,
    recoveryGeneration,
    previousName,
    expectedOwner,
    stageName,
    { pid: process.pid, token: "repair-owner" },
    "owner.json",
  );
  expect(await Bun.file(currentPath).text()).toBe(
    `${JSON.stringify({ pid: process.pid, token: "repair-owner" })}\n`,
  );
  await expect(access(previousPath)).rejects.toThrow();

  await restoreBoundClaimOwner(
    claim,
    claimGeneration,
    recoveryGeneration,
    "owner.json",
    current,
    stageName,
    expectedOwner,
    previousName,
  );

  expect(await Bun.file(previousPath).text()).toBe(`${JSON.stringify(oldOwner)}\n`);
  await expect(access(currentPath)).rejects.toThrow();
  await expect(access(join(recovery, stageName))).rejects.toThrow();
  expect(await inspectDirectoryGeneration(claim)).toEqual(claimGeneration);
});
