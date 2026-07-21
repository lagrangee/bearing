import { expect, test } from "bun:test";
import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { catalogEntryLeaseLocationFor } from "../src/catalog/location";
import { repairCatalogEntryLock, repairCatalogLock } from "../src/catalog/store";

const waitForPath = async (path: string): Promise<void> => {
  const deadline = Date.now() + 5_000;
  while (true) {
    try {
      await access(path);
      return;
    } catch {
      if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${path}`);
      await Bun.sleep(5);
    }
  }
};

const absentPid = (): number => {
  for (let candidate = process.pid + 100_000; candidate < process.pid + 101_000; candidate += 1) {
    try {
      process.kill(candidate, 0);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ESRCH") return candidate;
    }
  }
  throw new Error("Could not find an absent process identity for the initializer fixture.");
};

test("confirmed repair preserves a pre-owner initializer held by another process", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "bearing-initializer-home-"));
  const ready = join(homeDir, "initializer-ready");
  const resume = join(homeDir, "initializer-resume");
  const entered = join(homeDir, "initializer-entered");
  await mkdir(join(homeDir, ".bearing"));
  const lockModule = pathToFileURL(join(process.cwd(), "src/catalog/lock.ts")).href;
  const locationModule = pathToFileURL(join(process.cwd(), "src/catalog/location.ts")).href;
  const childScript = `
    import { access, writeFile } from "node:fs/promises";
    import { createCooperativeLock } from ${JSON.stringify(lockModule)};
    import { catalogLocationFor } from ${JSON.stringify(locationModule)};
    const wait = async (path) => {
      while (true) {
        try { await access(path); return; } catch { await Bun.sleep(5); }
      }
    };
    const lock = createCooperativeLock({
      afterLockDirectoryCreated: async () => {
        await writeFile(process.env.INIT_READY, "ready\\n");
        await wait(process.env.INIT_RESUME);
      },
    });
    await lock(catalogLocationFor(process.env.INIT_HOME), 5_000, async () => {
      await writeFile(process.env.INIT_ENTERED, "entered\\n");
    });
  `;
  const child = Bun.spawn([process.execPath, "-e", childScript], {
    env: {
      ...process.env,
      INIT_ENTERED: entered,
      INIT_HOME: homeDir,
      INIT_READY: ready,
      INIT_RESUME: resume,
    },
    stderr: "pipe",
    stdout: "ignore",
  });

  try {
    await waitForPath(ready);
    await expect(repairCatalogLock({ homeDir, confirmed: true })).rejects.toMatchObject({
      reason: "live-owner",
    });
    const resumedAt = Date.now();
    await writeFile(resume, "resume\n");
    expect(await child.exited).toBe(0);
    expect(Date.now() - resumedAt).toBeLessThan(1_000);
    expect(await readFile(entered, "utf8")).toBe("entered\n");
  } finally {
    child.kill();
  }
});

test("entry repair removes only its proven-dead encoded-lock initializer", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "bearing-entry-initializer-home-"));
  const target = catalogEntryLeaseLocationFor(homeDir, "Entry_A");
  const other = catalogEntryLeaseLocationFor(homeDir, "Entry_B");
  await mkdir(target.namespace, { recursive: true });
  const pid = absentPid().toString(36);
  const token = "AAAAAAAAAAAAAAAAAAAAAA";
  const targetCandidate = `${target.lock}.${pid}.${token}.initializing`;
  const otherCandidate = `${other.lock}.${pid}.${token}.initializing`;
  await mkdir(targetCandidate);
  await mkdir(otherCandidate);

  await expect(
    repairCatalogEntryLock({ homeDir, entryId: "Entry_A", confirmed: true }),
  ).resolves.toEqual({ outcome: "applied" });
  await expect(access(targetCandidate)).rejects.toThrow();
  await access(otherCandidate);
});
