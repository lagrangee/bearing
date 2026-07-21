import { expect, test } from "bun:test";
import { access, link, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { catalogEntryLeaseLocationFor } from "../src/catalog/location";
import { repairCatalogEntryLock, upsertCatalogEntry } from "../src/catalog/store";
import { createValidBearingRepo, makeTemporaryDirectory } from "./helpers";

const absentPid = (): number => {
  for (let candidate = process.pid + 100_000; candidate < process.pid + 101_000; candidate += 1) {
    try {
      process.kill(candidate, 0);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ESRCH") return candidate;
    }
  }
  throw new Error("Could not find an absent process identity for the entry repair fixture.");
};

const createEntryLock = async (homeDir: string, entryId: string, owner: unknown) => {
  const location = catalogEntryLeaseLocationFor(homeDir, entryId);
  await mkdir(location.lock, { recursive: true });
  await writeFile(location.lockOwner, `${JSON.stringify(owner)}\n`);
  return location;
};

test("entry lock repair requires confirmation, validates identity, and no-ops when absent", async () => {
  const homeDir = await makeTemporaryDirectory("bearing-home-");
  const location = await createEntryLock(homeDir, "entry-a", { pid: "bad", token: "owner" });
  await expect(
    repairCatalogEntryLock({ homeDir, entryId: "entry-a", confirmed: false }),
  ).rejects.toMatchObject({ reason: "confirmation-required" });
  await access(location.lockOwner);
  await expect(
    repairCatalogEntryLock({ homeDir, entryId: "../escape", confirmed: true }),
  ).rejects.toThrow();
  await access(location.lockOwner);

  await repairCatalogEntryLock({ homeDir, entryId: "entry-a", confirmed: true });
  await expect(
    repairCatalogEntryLock({ homeDir, entryId: "entry-a", confirmed: true }),
  ).resolves.toEqual({ outcome: "no-op" });
});

test("entry lock repair refuses a live owner and removes a proven-dead owner", async () => {
  const liveHome = await makeTemporaryDirectory("bearing-home-");
  const live = await createEntryLock(liveHome, "entry-a", {
    pid: process.pid,
    token: "live-owner",
  });
  await expect(
    repairCatalogEntryLock({ homeDir: liveHome, entryId: "entry-a", confirmed: true }),
  ).rejects.toMatchObject({ reason: "live-owner" });
  await access(live.lockOwner);

  const deadHome = await makeTemporaryDirectory("bearing-home-");
  const dead = await createEntryLock(deadHome, "entry-a", {
    pid: absentPid(),
    token: "dead-owner",
  });
  await expect(
    repairCatalogEntryLock({ homeDir: deadHome, entryId: "entry-a", confirmed: true }),
  ).resolves.toEqual({ outcome: "applied" });
  await expect(access(dead.lock)).rejects.toThrow();
});

test("repairing an entry lock never changes Catalog document bytes", async () => {
  const homeDir = await makeTemporaryDirectory("bearing-home-");
  const repoRoot = await createValidBearingRepo();
  await upsertCatalogEntry({ homeDir, repoRoot, createEntryId: () => "entry-a" });
  const before = await Promise.all([
    readFile(join(homeDir, ".bearing/catalog.json")),
    readFile(join(homeDir, ".bearing/catalog.backup.json")),
  ]);
  await createEntryLock(homeDir, "entry-a", { pid: "bad", token: "malformed" });

  await repairCatalogEntryLock({ homeDir, entryId: "entry-a", confirmed: true });
  expect(
    await Promise.all([
      readFile(join(homeDir, ".bearing/catalog.json")),
      readFile(join(homeDir, ".bearing/catalog.backup.json")),
    ]),
  ).toEqual(before);
});

test("entry repair targets one case-distinct lease without touching its sibling", async () => {
  const homeDir = await makeTemporaryDirectory("bearing-home-");
  const upper = await createEntryLock(homeDir, "A", { pid: "bad", token: "upper" });
  const lower = await createEntryLock(homeDir, "a", { pid: "bad", token: "lower" });

  await expect(repairCatalogEntryLock({ homeDir, entryId: "A", confirmed: true })).resolves.toEqual(
    { outcome: "applied" },
  );
  await expect(access(upper.lock)).rejects.toThrow();
  expect(await readFile(lower.lockOwner, "utf8")).toContain('"lower"');
});

test("entry repair unlinks exact symlink and hardlink owner names without following them", async () => {
  const symlinkHome = await makeTemporaryDirectory("bearing-home-");
  const symlinkLocation = catalogEntryLeaseLocationFor(symlinkHome, "entry-a");
  const outside = join(symlinkHome, "outside-owner");
  await writeFile(outside, "outside\n");
  await mkdir(symlinkLocation.lock, { recursive: true });
  await symlink(outside, symlinkLocation.lockOwner);
  await repairCatalogEntryLock({ homeDir: symlinkHome, entryId: "entry-a", confirmed: true });
  expect(await readFile(outside, "utf8")).toBe("outside\n");

  const hardlinkHome = await makeTemporaryDirectory("bearing-home-");
  const hardlinkLocation = catalogEntryLeaseLocationFor(hardlinkHome, "entry-a");
  const peer = join(hardlinkHome, "peer-owner");
  await writeFile(peer, "peer\n");
  await mkdir(hardlinkLocation.lock, { recursive: true });
  await link(peer, hardlinkLocation.lockOwner);
  await repairCatalogEntryLock({ homeDir: hardlinkHome, entryId: "entry-a", confirmed: true });
  expect(await readFile(peer, "utf8")).toBe("peer\n");
});

test("entry repair inspects a FIFO owner without blocking", async () => {
  const homeDir = await makeTemporaryDirectory("bearing-home-");
  const location = catalogEntryLeaseLocationFor(homeDir, "entry-a");
  await mkdir(location.lock, { recursive: true });
  const fifo = Bun.spawn(["mkfifo", location.lockOwner], { stdout: "ignore", stderr: "pipe" });
  expect(await fifo.exited).toBe(0);
  await expect(
    repairCatalogEntryLock({ homeDir, entryId: "entry-a", confirmed: true }),
  ).resolves.toEqual({ outcome: "applied" });
  await expect(access(location.lock)).rejects.toThrow();
});

test("entry repair refuses symlink or FIFO lock paths without following them", async () => {
  const symlinkHome = await makeTemporaryDirectory("bearing-home-");
  const symlinkLocation = catalogEntryLeaseLocationFor(symlinkHome, "entry-a");
  const outside = join(symlinkHome, "outside-lock");
  await mkdir(outside);
  await mkdir(symlinkLocation.namespace, { recursive: true });
  await symlink(outside, symlinkLocation.lock);
  await expect(
    repairCatalogEntryLock({ homeDir: symlinkHome, entryId: "entry-a", confirmed: true }),
  ).rejects.toThrow();
  await access(outside);

  const fifoHome = await makeTemporaryDirectory("bearing-home-");
  const fifoLocation = catalogEntryLeaseLocationFor(fifoHome, "entry-a");
  await mkdir(fifoLocation.namespace, { recursive: true });
  const fifo = Bun.spawn(["mkfifo", fifoLocation.lock], { stdout: "ignore", stderr: "pipe" });
  expect(await fifo.exited).toBe(0);
  await expect(
    repairCatalogEntryLock({ homeDir: fifoHome, entryId: "entry-a", confirmed: true }),
  ).rejects.toThrow();
  await access(fifoLocation.lock);
});
