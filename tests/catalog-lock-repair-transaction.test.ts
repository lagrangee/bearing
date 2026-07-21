import { expect, test } from "bun:test";
import { access, lstat, mkdir, readFile, rename, symlink, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { catalogLocationFor } from "../src/catalog/location";
import { acquireOwnedLock } from "../src/catalog/lock";
import { createLockToken } from "../src/catalog/lock-artifact-name";
import { repairCatalogLock } from "../src/catalog/store";
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

const writeOwner = async (directory: string, pid: number, token: string): Promise<string> => {
  await mkdir(directory, { recursive: true });
  const owner = join(directory, "owner.json");
  await writeFile(owner, `${JSON.stringify({ pid, token })}\n`);
  return owner;
};

const identity = async (path: string): Promise<readonly bigint[]> => {
  const stat = await lstat(path, { bigint: true });
  return [stat.dev, stat.ino, stat.size];
};

test("repair fails closed before inspecting or mutating multiple debris generations", async () => {
  const homeDir = await makeTemporaryDirectory("bearing-home-");
  const location = catalogLocationFor(homeDir);
  const debris = [
    `${location.lock}.00000000-0000-4000-8000-000000000000.initializing`,
    `${location.lock}.00000000-0000-4000-8000-000000000001.quarantine`,
  ];
  const owners = await Promise.all(
    debris.map((path, index) => writeOwner(path, absentPid(), `dead-${index}`)),
  );
  const before = await Promise.all(owners.map(identity));
  const bytes = await Promise.all(owners.map((owner) => readFile(owner)));
  await expect(repairCatalogLock({ homeDir, confirmed: true })).rejects.toMatchObject({
    reason: "unsafe-lock",
  });

  expect(await Promise.all(owners.map(identity))).toEqual(before);
  expect(await Promise.all(owners.map((owner) => readFile(owner)))).toEqual(bytes);
});

test("ordinary lock release never follows a replaced Catalog root ancestor", async () => {
  const homeDir = await makeTemporaryDirectory("bearing-home-");
  const location = catalogLocationFor(homeDir);
  const root = join(homeDir, ".bearing");
  const preserved = join(homeDir, "preserved-bearing-root");
  await mkdir(root, { recursive: true });
  const handle = await acquireOwnedLock(location, 0, {
    beforeLockQuarantine: async (phase) => {
      if (phase !== "release") return;
      await rename(root, preserved);
      await symlink(preserved, root);
    },
  });
  const before = await lstat(location.lock, { bigint: true });

  await expect(handle.release()).rejects.toThrow();

  const after = await lstat(join(preserved, basename(location.lock)), { bigint: true });
  expect([after.dev, after.ino]).toEqual([before.dev, before.ino]);
});

test("repair converges exact bound-retirement residue names", async () => {
  const homeDir = await makeTemporaryDirectory("bearing-home-");
  const location = catalogLocationFor(homeDir);
  await writeOwner(location.lock, absentPid(), "dead-with-retirement-residue");
  await mkdir(location.lockRecovery);
  const dead = `${JSON.stringify({ pid: absentPid(), token: "dead-residue" })}\n`;
  await writeFile(join(location.lock, `.owner.${createLockToken()}.retired`), dead);
  await mkdir(join(location.lock, `.entry.${createLockToken()}.retired`));
  await mkdir(
    join(location.lock, `${basename(location.lockRecovery)}.${createLockToken()}.retired`),
  );
  await writeFile(join(location.lockRecovery, `.owner.${createLockToken()}.retired`), dead);
  await mkdir(join(location.lockRecovery, `.entry.${createLockToken()}.retired`));

  await expect(repairCatalogLock({ homeDir, confirmed: true })).resolves.toEqual({
    outcome: "applied",
  });
  await expect(access(location.lock)).rejects.toThrow();
});

test("repair rejects a forged recovery-retirement residue with the wrong node shape", async () => {
  const homeDir = await makeTemporaryDirectory("bearing-home-");
  const location = catalogLocationFor(homeDir);
  const owner = await writeOwner(location.lock, absentPid(), "dead-with-forged-residue");
  const forged = join(
    location.lock,
    `${basename(location.lockRecovery)}.${createLockToken()}.retired`,
  );
  await writeFile(forged, "foreign bytes\n");
  const before = await Promise.all([identity(owner), identity(forged)]);
  const bytes = await Promise.all([readFile(owner), readFile(forged)]);

  await expect(repairCatalogLock({ homeDir, confirmed: true })).rejects.toMatchObject({
    reason: "unsafe-lock",
  });

  expect(await Promise.all([identity(owner), identity(forged)])).toEqual(before);
  expect(await Promise.all([readFile(owner), readFile(forged)])).toEqual(bytes);
});

test("repair leases a canonical claim whose previous owner is already tombstoned", async () => {
  const homeDir = await makeTemporaryDirectory("bearing-home-");
  const location = catalogLocationFor(homeDir);
  await writeOwner(location.lock, absentPid(), "dead-with-tombstoned-claim");
  const claim = join(location.lockRecovery, "claim");
  await mkdir(claim, { recursive: true });
  await writeFile(
    join(claim, `.owner.${createLockToken()}.tombstone`),
    `${JSON.stringify({ pid: absentPid(), token: "dead-claim-tombstone" })}\n`,
  );

  await expect(repairCatalogLock({ homeDir, confirmed: true })).resolves.toEqual({
    outcome: "applied",
  });
  await expect(access(location.lock)).rejects.toThrow();
});

test("repair fails closed before leasing a canonical generation beside debris", async () => {
  const homeDir = await makeTemporaryDirectory("bearing-home-");
  const location = catalogLocationFor(homeDir);
  const debris = `${location.lock}.${createLockToken()}.quarantine`;
  const canonicalOwner = await writeOwner(location.lock, absentPid(), "dead-canonical");
  const debrisOwner = await writeOwner(debris, absentPid(), "dead-debris");
  const owners = [canonicalOwner, debrisOwner];
  const before = await Promise.all(owners.map(identity));
  const bytes = await Promise.all(owners.map((owner) => readFile(owner)));

  await expect(repairCatalogLock({ homeDir, confirmed: true })).rejects.toMatchObject({
    reason: "unsafe-lock",
  });

  expect(await Promise.all(owners.map(identity))).toEqual(before);
  expect(await Promise.all(owners.map((owner) => readFile(owner)))).toEqual(bytes);
  await expect(access(location.lockRecovery)).rejects.toThrow();
  await expect(access(join(debris, "recovery"))).rejects.toThrow();
});
