import { expect, test } from "bun:test";
import { access, mkdir, readFile, realpath, stat, symlink, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import {
  inspectCatalogEntryLeaseIds,
  withCatalogEntryLeaseGuards,
} from "../src/catalog/entry-lease-guards";
import {
  catalogEntryLeaseLocationFor,
  prepareCatalogEntryLeaseLocation,
} from "../src/catalog/location";
import {
  CatalogEntryOwnershipError,
  CatalogLockError,
  CatalogLockRecoveryError,
  forgetCatalogEntry,
  relinkCatalogEntry,
  renameCatalogEntry,
  repairCatalog,
  repairCatalogEntryLock,
  resetCatalog,
  upsertCatalogEntry,
  withCatalogEntryLease,
} from "../src/catalog/store";
import { runCatalogTransaction } from "../src/catalog/transaction";
import { createValidBearingRepo, makeTemporaryDirectory } from "./helpers";

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((next) => {
    resolve = next;
  });
  return { promise, resolve };
};

const absentPid = (): number => {
  for (let candidate = process.pid + 100_000; candidate < process.pid + 101_000; candidate += 1) {
    try {
      process.kill(candidate, 0);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ESRCH") return candidate;
    }
  }
  throw new Error("Could not find an absent process identity for the entry lock fixture.");
};

const register = async (homeDir: string, entryId: string): Promise<string> => {
  const repoRoot = await createValidBearingRepo();
  await upsertCatalogEntry({ homeDir, repoRoot, createEntryId: () => entryId });
  return realpath(repoRoot);
};

const catalogBytes = async (homeDir: string): Promise<readonly [Buffer, Buffer]> =>
  Promise.all([
    readFile(join(homeDir, ".bearing/catalog.json")),
    readFile(join(homeDir, ".bearing/catalog.backup.json")),
  ]);

const ENTRY_LEASE_NAMESPACE_INSPECTION =
  "manual inspection of the fixed Catalog entry-lease namespace (automatic repair is refused for unknown or unsafe artifacts)";

test("entry lease filenames are canonical, lowercase, reversible, and case-preserving", async () => {
  const homeDir = await makeTemporaryDirectory("bearing-home-");
  const upper = catalogEntryLeaseLocationFor(homeDir, "A");
  const lower = catalogEntryLeaseLocationFor(homeDir, "a");
  const longestId = `${"Aa0_-".repeat(25)}Aa0`;
  const longest = catalogEntryLeaseLocationFor(homeDir, longestId);

  expect(upper.lock).not.toBe(lower.lock);
  expect(upper.lock.toLowerCase()).not.toBe(lower.lock.toLowerCase());
  expect(basename(upper.lock)).toBe(basename(upper.lock).toLowerCase());
  expect(basename(longest.lock).length).toBeLessThanOrEqual(255);

  await mkdir(upper.lock, { recursive: true });
  await mkdir(lower.lock, { recursive: true });
  await mkdir(longest.lock, { recursive: true });
  expect(await inspectCatalogEntryLeaseIds(homeDir)).toEqual(["A", longestId, "a"].sort());
});

test("entry lease enumeration rejects malformed or non-canonical filenames", async () => {
  const homeDir = await makeTemporaryDirectory("bearing-home-");
  const location = catalogEntryLeaseLocationFor(homeDir, "A");
  await mkdir(location.namespace, { recursive: true });
  await mkdir(join(location.namespace, "if.lock"));

  await expect(inspectCatalogEntryLeaseIds(homeDir)).rejects.toMatchObject({
    name: CatalogLockRecoveryError.name,
    repair: ENTRY_LEASE_NAMESPACE_INSPECTION,
  });
});

test("recognized regular-file debris requires manual namespace inspection", async () => {
  const homeDir = await makeTemporaryDirectory("bearing-home-");
  const location = catalogEntryLeaseLocationFor(homeDir, "entry-a");
  const debris = `${basename(location.lock)}.00000000-0000-4000-8000-000000000000.initializing`;
  await mkdir(location.namespace, { recursive: true });
  await writeFile(join(location.namespace, debris), "preserve\n");

  await expect(inspectCatalogEntryLeaseIds(homeDir)).rejects.toMatchObject({
    repair: ENTRY_LEASE_NAMESPACE_INSPECTION,
  });
});

test("recognized symlink debris requires manual namespace inspection", async () => {
  const homeDir = await makeTemporaryDirectory("bearing-home-");
  const location = catalogEntryLeaseLocationFor(homeDir, "entry-a");
  const debris = `${basename(location.lock)}.00000000-0000-4000-8000-000000000000.initializing`;
  const outside = join(homeDir, "outside-debris");
  await mkdir(location.namespace, { recursive: true });
  await mkdir(outside);
  await symlink(outside, join(location.namespace, debris));

  await expect(inspectCatalogEntryLeaseIds(homeDir)).rejects.toMatchObject({
    repair: ENTRY_LEASE_NAMESPACE_INSPECTION,
  });
});

test("a global Catalog mutation admits no new entry lease before releasing its lock", async () => {
  const homeDir = await makeTemporaryDirectory("bearing-home-");
  const repoRoot = await register(homeDir, "entry-a");
  const location = catalogEntryLeaseLocationFor(homeDir, "entry-a");
  await prepareCatalogEntryLeaseLocation(homeDir, location);
  const entered = deferred();
  const release = deferred();
  const mutation = runCatalogTransaction({
    homeDir,
    mutate: async () => {
      entered.resolve();
      await release.promise;
      return { result: undefined };
    },
  });
  await entered.promise;

  try {
    const before = await stat(location.namespace, { bigint: true });
    let invoked = false;
    await expect(
      withCatalogEntryLease(
        homeDir,
        "entry-a",
        repoRoot,
        async () => {
          invoked = true;
        },
        0,
      ),
    ).rejects.toBeInstanceOf(CatalogLockError);
    const after = await stat(location.namespace, { bigint: true });
    expect(invoked).toBeFalse();
    expect({ ctimeNs: after.ctimeNs, mtimeNs: after.mtimeNs }).toEqual({
      ctimeNs: before.ctimeNs,
      mtimeNs: before.mtimeNs,
    });
  } finally {
    release.resolve();
    await mutation;
  }
});

test("an A operation does not block B operations or unrelated Catalog mutations", async () => {
  const homeDir = await makeTemporaryDirectory("bearing-home-");
  const rootA = await register(homeDir, "entry-a");
  const rootB = await register(homeDir, "entry-b");
  const entered = deferred();
  const release = deferred();
  const heldA = withCatalogEntryLease(homeDir, "entry-a", rootA, async () => {
    entered.resolve();
    await release.promise;
  });
  await entered.promise;

  await expect(
    withCatalogEntryLease(homeDir, "entry-b", rootB, async () => "b-done"),
  ).resolves.toBe("b-done");
  const rootC = await createValidBearingRepo();
  await expect(
    upsertCatalogEntry({
      homeDir,
      repoRoot: rootC,
      createEntryId: () => "entry-c",
      lockTimeoutMs: 0,
    }),
  ).resolves.toMatchObject({ outcome: "applied" });
  await expect(
    renameCatalogEntry({ homeDir, entryId: "entry-a", displayName: "A renamed", lockTimeoutMs: 0 }),
  ).resolves.toMatchObject({ outcome: "applied" });

  release.resolve();
  await heldA;
});

test("same-entry operations serialize and a zero-timeout contender fails closed", async () => {
  const homeDir = await makeTemporaryDirectory("bearing-home-");
  const repoRoot = await register(homeDir, "entry-a");
  const entered = deferred();
  const release = deferred();
  const order: string[] = [];
  const first = withCatalogEntryLease(homeDir, "entry-a", repoRoot, async () => {
    order.push("first-start");
    entered.resolve();
    await release.promise;
    order.push("first-end");
  });
  await entered.promise;

  await expect(
    withCatalogEntryLease(homeDir, "entry-a", repoRoot, async () => order.push("unsafe"), 0),
  ).rejects.toBeInstanceOf(CatalogLockError);
  expect(order).toEqual(["first-start"]);

  const second = withCatalogEntryLease(homeDir, "entry-a", repoRoot, async () => {
    order.push("second");
  });
  release.resolve();
  await Promise.all([first, second]);
  expect(order).toEqual(["first-start", "first-end", "second"]);
});

test("relink and forget A fail fast without Catalog writes while B relink proceeds", async () => {
  const homeDir = await makeTemporaryDirectory("bearing-home-");
  const rootA = await register(homeDir, "entry-a");
  const rootB = await register(homeDir, "entry-b");
  const nextA = await createValidBearingRepo();
  const nextB = await createValidBearingRepo();
  const entered = deferred();
  const release = deferred();
  const heldA = withCatalogEntryLease(homeDir, "entry-a", rootA, async () => {
    entered.resolve();
    await release.promise;
  });
  await entered.promise;
  const before = await catalogBytes(homeDir);

  await expect(
    relinkCatalogEntry({
      homeDir,
      entryId: "entry-a",
      newRepoRoot: nextA,
      confirmMove: true,
      lockTimeoutMs: 0,
    }),
  ).rejects.toBeInstanceOf(CatalogLockError);
  await expect(
    forgetCatalogEntry({ homeDir, entryId: "entry-a", lockTimeoutMs: 0 }),
  ).rejects.toBeInstanceOf(CatalogLockError);
  expect(await catalogBytes(homeDir)).toEqual(before);

  await expect(
    relinkCatalogEntry({
      homeDir,
      entryId: "entry-b",
      newRepoRoot: nextB,
      confirmMove: true,
      lockTimeoutMs: 0,
    }),
  ).resolves.toMatchObject({ outcome: "applied", entry: { entryId: "entry-b" } });
  expect(rootB).not.toBe(await realpath(nextB));
  release.resolve();
  await heldA;
});

test("strict ownership is revalidated before work and leases never change Catalog bytes", async () => {
  const homeDir = await makeTemporaryDirectory("bearing-home-");
  const oldRoot = await register(homeDir, "entry-a");
  const nextRoot = await createValidBearingRepo();
  const beforeLease = await catalogBytes(homeDir);
  await withCatalogEntryLease(homeDir, "entry-a", oldRoot, async () => undefined);
  expect(await catalogBytes(homeDir)).toEqual(beforeLease);

  await relinkCatalogEntry({
    homeDir,
    entryId: "entry-a",
    newRepoRoot: nextRoot,
    confirmMove: true,
  });
  let invoked = false;
  await expect(
    withCatalogEntryLease(homeDir, "entry-a", oldRoot, async () => {
      invoked = true;
    }),
  ).rejects.toBeInstanceOf(CatalogEntryOwnershipError);
  expect(invoked).toBeFalse();
});

test("invalid entry IDs and degraded ownership fail before work", async () => {
  const homeDir = await makeTemporaryDirectory("bearing-home-");
  const repoRoot = await register(homeDir, "entry-a");
  let invoked = false;
  await expect(
    withCatalogEntryLease(homeDir, "../escape", repoRoot, async () => {
      invoked = true;
    }),
  ).rejects.toThrow();
  expect(invoked).toBeFalse();

  await writeFile(join(homeDir, ".bearing/catalog.json"), "{ malformed\n");
  await expect(
    withCatalogEntryLease(homeDir, "entry-a", repoRoot, async () => {
      invoked = true;
    }),
  ).rejects.toThrow("explicit repair");
  expect(invoked).toBeFalse();
});

test("an indeterminate entry lease names its executable entry-scoped repair command", async () => {
  const homeDir = await makeTemporaryDirectory("bearing-home-");
  const repoRoot = await register(homeDir, "entry-a");
  const location = catalogEntryLeaseLocationFor(homeDir, "entry-a");
  await mkdir(location.lock, { recursive: true });
  await writeFile(location.lockOwner, "malformed-owner\n");

  await expect(
    withCatalogEntryLease(homeDir, "entry-a", repoRoot, async () => undefined, 0),
  ).rejects.toMatchObject({
    name: CatalogLockRecoveryError.name,
    repair: 'bearing catalog repair-entry-lock --entry "entry-a" --confirm-abandoned',
  });
});

test("nested entry guards preserve the failing entry repair command", async () => {
  const homeDir = await makeTemporaryDirectory("bearing-home-");
  const failed = catalogEntryLeaseLocationFor(homeDir, "entry-b");
  await mkdir(failed.lock, { recursive: true });
  await writeFile(failed.lockOwner, "malformed-owner\n");

  await expect(
    withCatalogEntryLeaseGuards(homeDir, ["entry-a", "entry-b"], 0, async () => undefined),
  ).rejects.toMatchObject({
    repair: 'bearing catalog repair-entry-lock --entry "entry-b" --confirm-abandoned',
  });
});

test("entry operations preserve their own recovery error", async () => {
  const homeDir = await makeTemporaryDirectory("bearing-home-");
  const repoRoot = await register(homeDir, "entry-a");
  const operationError = new CatalogLockRecoveryError(undefined, "operation-owned recovery route");

  await expect(
    withCatalogEntryLease(homeDir, "entry-a", repoRoot, async () => {
      throw operationError;
    }),
  ).rejects.toBe(operationError);
});

test("entry lease release failures retain the executable entry repair command", async () => {
  const homeDir = await makeTemporaryDirectory("bearing-home-");
  const repoRoot = await register(homeDir, "entry-a");
  const location = catalogEntryLeaseLocationFor(homeDir, "entry-a");

  await expect(
    withCatalogEntryLease(homeDir, "entry-a", repoRoot, async () => {
      await writeFile(location.lockOwner, "replacement-owner\n");
    }),
  ).rejects.toMatchObject({
    repair: 'bearing catalog repair-entry-lock --entry "entry-a" --confirm-abandoned',
  });
});

test("backup repair and reset refuse an active entry lock without changing bytes", async () => {
  const homeDir = await makeTemporaryDirectory("bearing-home-");
  const repoRoot = await register(homeDir, "entry-a");
  const entered = deferred();
  const release = deferred();
  const held = withCatalogEntryLease(homeDir, "entry-a", repoRoot, async () => {
    entered.resolve();
    await release.promise;
  });
  await entered.promise;

  const currentPath = join(homeDir, ".bearing/catalog.json");
  const backupPath = join(homeDir, ".bearing/catalog.backup.json");
  await writeFile(currentPath, "{ malformed\n");
  const degraded = await catalogBytes(homeDir);
  await expect(repairCatalog({ homeDir, lockTimeoutMs: 0 })).rejects.toBeInstanceOf(
    CatalogLockError,
  );
  expect(await catalogBytes(homeDir)).toEqual(degraded);

  await writeFile(backupPath, "{ also-malformed\n");
  const failed = await catalogBytes(homeDir);
  await expect(resetCatalog({ homeDir, confirmed: true, lockTimeoutMs: 0 })).rejects.toBeInstanceOf(
    CatalogLockError,
  );
  expect(await catalogBytes(homeDir)).toEqual(failed);
  release.resolve();
  await held;
});

test("recovery refuses an indeterminate entry lock and names the exact repair path", async () => {
  const homeDir = await makeTemporaryDirectory("bearing-home-");
  await register(homeDir, "entry-a");
  const location = catalogEntryLeaseLocationFor(homeDir, "entry-a");
  await mkdir(location.lock, { recursive: true });
  await writeFile(location.lockOwner, "malformed-owner\n");
  await writeFile(join(homeDir, ".bearing/catalog.json"), "{ malformed\n");
  const before = await catalogBytes(homeDir);

  await expect(repairCatalog({ homeDir, lockTimeoutMs: 0 })).rejects.toMatchObject({
    name: CatalogLockRecoveryError.name,
    repair: 'bearing catalog repair-entry-lock --entry "entry-a" --confirm-abandoned',
  });
  expect(await catalogBytes(homeDir)).toEqual(before);
  await repairCatalogEntryLock({ homeDir, entryId: "entry-a", confirmed: true });
  await expect(repairCatalog({ homeDir })).resolves.toEqual({ outcome: "applied" });
});

test("entry repair converges exact initializing debris before recovery retries", async () => {
  const homeDir = await makeTemporaryDirectory("bearing-home-");
  await register(homeDir, "entry-a");
  const location = catalogEntryLeaseLocationFor(homeDir, "entry-a");
  const debris = `${location.lock}.00000000-0000-4000-8000-000000000000.initializing`;
  await mkdir(debris, { recursive: true });
  await writeFile(
    join(debris, "owner.json"),
    `${JSON.stringify({ pid: absentPid(), token: "dead-initializing" })}\n`,
  );
  await writeFile(join(homeDir, ".bearing/catalog.json"), "{ malformed\n");

  await expect(repairCatalog({ homeDir, lockTimeoutMs: 0 })).rejects.toMatchObject({
    repair: 'bearing catalog repair-entry-lock --entry "entry-a" --confirm-abandoned',
  });
  await expect(
    repairCatalogEntryLock({ homeDir, entryId: "entry-a", confirmed: true }),
  ).resolves.toEqual({ outcome: "applied" });
  await expect(access(debris)).rejects.toThrow();
  await expect(repairCatalog({ homeDir })).resolves.toEqual({ outcome: "applied" });
});

test("entry repair refuses an unknown same-prefix sibling without removing it", async () => {
  const homeDir = await makeTemporaryDirectory("bearing-home-");
  const location = catalogEntryLeaseLocationFor(homeDir, "entry-a");
  const unknown = `${location.lock}.not-a-uuid.initializing`;
  await mkdir(unknown, { recursive: true });
  await writeFile(join(unknown, "marker"), "preserve\n");

  await expect(
    repairCatalogEntryLock({ homeDir, entryId: "entry-a", confirmed: true }),
  ).rejects.toMatchObject({ reason: "unsafe-lock" });
  expect(await readFile(join(unknown, "marker"), "utf8")).toBe("preserve\n");
});

test("recovery rejects unknown lease namespace entries and reclaims a proven-dead lease", async () => {
  const unsafeHome = await makeTemporaryDirectory("bearing-home-");
  await register(unsafeHome, "entry-a");
  const unsafeLocation = catalogEntryLeaseLocationFor(unsafeHome, "entry-a");
  await writeFile(join(unsafeLocation.namespace, "unexpected"), "preserve\n");
  await writeFile(join(unsafeHome, ".bearing/catalog.json"), "{ malformed\n");
  const unsafeBefore = await catalogBytes(unsafeHome);
  await expect(repairCatalog({ homeDir: unsafeHome })).rejects.toMatchObject({
    name: CatalogLockRecoveryError.name,
    repair: ENTRY_LEASE_NAMESPACE_INSPECTION,
  });
  expect(await catalogBytes(unsafeHome)).toEqual(unsafeBefore);

  const deadHome = await makeTemporaryDirectory("bearing-home-");
  await register(deadHome, "entry-a");
  const deadLocation = catalogEntryLeaseLocationFor(deadHome, "entry-a");
  await mkdir(deadLocation.lock, { recursive: true });
  await writeFile(
    deadLocation.lockOwner,
    `${JSON.stringify({ pid: absentPid(), token: "dead-entry-owner" })}\n`,
  );
  await writeFile(join(deadHome, ".bearing/catalog.json"), "{ malformed\n");
  await expect(repairCatalog({ homeDir: deadHome })).resolves.toEqual({ outcome: "applied" });
});
