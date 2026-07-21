import { expect, test } from "bun:test";
import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { catalogLocationFor } from "../src/catalog/location";
import { repairCatalogLock } from "../src/catalog/store";
import { makeTemporaryDirectory } from "./helpers";

const absentPid = (): number => {
  for (let candidate = process.pid + 100_000; candidate < process.pid + 101_000; candidate += 1) {
    try {
      process.kill(candidate, 0);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ESRCH") return candidate;
    }
  }
  throw new Error("Could not find an absent process identity for the lock fixture.");
};

test("confirmed repair preserves an impossible mixed debris generation", async () => {
  const homeDir = await makeTemporaryDirectory("bearing-home-");
  const location = catalogLocationFor(homeDir);
  await mkdir(join(homeDir, ".bearing"));
  const candidate = `${location.lock}.00000000-0000-4000-8000-000000000000.initializing.AAAAAAAAAAAAAAAAAAAAAA.quarantine`;
  const owner = join(candidate, "owner.json");
  const ownerBytes = Buffer.from(
    `${JSON.stringify({ pid: absentPid(), token: "mixed-generation-owner" })}\n`,
  );
  await mkdir(candidate);
  await writeFile(owner, ownerBytes);
  const before = await lstat(candidate, { bigint: true });
  const ownerBefore = await lstat(owner, { bigint: true });

  await expect(repairCatalogLock({ homeDir, confirmed: true })).rejects.toMatchObject({
    reason: "unsafe-lock",
  });

  const after = await lstat(candidate, { bigint: true });
  const ownerAfter = await lstat(owner, { bigint: true });
  expect({ device: after.dev, inode: after.ino }).toEqual({
    device: before.dev,
    inode: before.ino,
  });
  expect({ device: ownerAfter.dev, inode: ownerAfter.ino }).toEqual({
    device: ownerBefore.dev,
    inode: ownerBefore.ino,
  });
  expect(await readFile(owner)).toEqual(ownerBytes);
});
