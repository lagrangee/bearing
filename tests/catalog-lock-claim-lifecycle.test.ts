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
  writeFile,
} from "node:fs/promises";
import { basename, join } from "node:path";
import { catalogLocationFor } from "../src/catalog/location";
import { acquireOwnedLock } from "../src/catalog/lock";
import {
  retireBoundLockCandidate,
  strictRemoveBoundOwnerFile,
} from "../src/catalog/lock-bound-owner";
import { inspectCanonicalRecoveryClaim } from "../src/catalog/lock-claim-state";
import { inspectLockOwner } from "../src/catalog/lock-owner";
import { inspectDirectoryGeneration, tryClaimRecovery } from "../src/catalog/lock-recovery";
import { CatalogLockRecoveryError } from "../src/catalog/store";
import { makeTemporaryDirectory } from "./helpers";

const CANDIDATE = "claim.00000000-0000-4000-8000-000000000000.tmp";
const TOMBSTONE = `.owner.${"A".repeat(22)}.tombstone`;

const deferred = (): Readonly<{ promise: Promise<void>; resolve: () => void }> => {
  let resolve = () => {};
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
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

const candidateOwner = (pid: number): string =>
  `${JSON.stringify({ pid, token: "00000000-0000-4000-8000-000000000000" })}\n`;

test("an exact claim retires with safe partial, live, or crashed claim candidates", async () => {
  const ownerFixtures = [
    undefined,
    candidateOwner(process.pid),
    candidateOwner(absentPid()),
    "not-json\n",
    '{"pid":',
  ];
  for (const ownerBytes of ownerFixtures) {
    const homeDir = await makeTemporaryDirectory("bearing-home-");
    await mkdir(join(homeDir, ".bearing"));
    const location = catalogLocationFor(homeDir);
    const handle = await acquireOwnedLock(location, 0, {
      afterRecoveryClaim: async (phase) => {
        if (phase !== "release") return;
        const candidate = join(location.lockRecovery, CANDIDATE);
        await mkdir(candidate);
        if (ownerBytes !== undefined) await writeFile(join(candidate, "owner.json"), ownerBytes);
      },
    });

    await expect(handle.release()).resolves.toBeUndefined();
    expect(
      (await readdir(join(homeDir, ".bearing"))).filter((name) =>
        name.startsWith(basename(location.lock)),
      ),
    ).toEqual([]);
  }
});

test("a crashed candidate present at the first held-shape check is quarantined", async () => {
  const homeDir = await makeTemporaryDirectory("bearing-home-");
  await mkdir(join(homeDir, ".bearing"));
  const location = catalogLocationFor(homeDir);
  const handle = await acquireOwnedLock(location, 0, {
    afterRecoveryAcquired: async (phase) => {
      if (phase !== "release") return;
      const candidate = join(location.lockRecovery, CANDIDATE);
      await mkdir(candidate);
      await writeFile(join(candidate, "owner.json"), candidateOwner(absentPid()));
    },
  });

  await expect(handle.release()).resolves.toBeUndefined();
  expect(
    (await readdir(join(homeDir, ".bearing"))).filter((name) =>
      name.startsWith(basename(location.lock)),
    ),
  ).toEqual([]);
});

test("an in-flight candidate cleanup artifact is carried into detached cleanup", async () => {
  for (const suffix of ["abandoned", "release"] as const) {
    const homeDir = await makeTemporaryDirectory("bearing-home-");
    await mkdir(join(homeDir, ".bearing"));
    const location = catalogLocationFor(homeDir);
    const handle = await acquireOwnedLock(location, 0, {
      afterRecoveryClaim: async (phase) => {
        if (phase !== "release") return;
        const candidate = join(location.lockRecovery, CANDIDATE.replace("tmp", suffix));
        await mkdir(candidate);
        await writeFile(join(candidate, "owner.json"), candidateOwner(process.pid));
      },
    });

    await expect(handle.release()).resolves.toBeUndefined();
    expect(
      (await readdir(join(homeDir, ".bearing"))).filter((name) =>
        name.startsWith(basename(location.lock)),
      ),
    ).toEqual([]);
  }
});

test("a winner carries a candidate paused after exact tombstone publication", async () => {
  const homeDir = await makeTemporaryDirectory("bearing-home-");
  await mkdir(join(homeDir, ".bearing"));
  const location = catalogLocationFor(homeDir);
  const tombstoned = deferred();
  const resume = deferred();
  let loser = Promise.resolve();
  const handle = await acquireOwnedLock(location, 0, {
    afterRecoveryClaim: async (phase) => {
      if (phase !== "release") return;
      const candidate = join(location.lockRecovery, CANDIDATE);
      const abandoned = candidate.replace(/\.tmp$/, ".abandoned");
      await mkdir(candidate);
      await writeFile(join(candidate, "owner.json"), candidateOwner(process.pid));
      const [directory, parent, owner] = await Promise.all([
        inspectDirectoryGeneration(candidate),
        inspectDirectoryGeneration(location.lockRecovery),
        inspectLockOwner(join(candidate, "owner.json")),
      ]);
      if (directory === undefined || parent === undefined || owner.state !== "regular") {
        throw new Error("Expected an exact candidate fixture.");
      }
      loser = retireBoundLockCandidate(
        candidate,
        abandoned,
        directory,
        "owner.json",
        owner,
        parent,
        undefined,
        async () => {
          tombstoned.resolve();
          await resume.promise;
        },
      );
      await tombstoned.promise;
    },
  });

  try {
    await expect(handle.release()).resolves.toBeUndefined();
  } finally {
    resume.resolve();
    await loser;
  }
  expect(
    (await readdir(join(homeDir, ".bearing"))).filter((name) =>
      name.startsWith(basename(location.lock)),
    ),
  ).toEqual([]);
});

test("a stable tombstone left by crashed cleanup is carried through quarantine", async () => {
  for (const suffix of ["abandoned", "release"] as const) {
    const homeDir = await makeTemporaryDirectory("bearing-home-");
    await mkdir(join(homeDir, ".bearing"));
    const location = catalogLocationFor(homeDir);
    const handle = await acquireOwnedLock(location, 0, {
      afterRecoveryClaim: async (phase) => {
        if (phase !== "release") return;
        const candidate = join(location.lockRecovery, CANDIDATE.replace("tmp", suffix));
        await mkdir(candidate);
        await writeFile(join(candidate, TOMBSTONE), candidateOwner(process.pid));
      },
    });

    await expect(handle.release()).resolves.toBeUndefined();
    expect(
      (await readdir(join(homeDir, ".bearing"))).filter((name) =>
        name.startsWith(basename(location.lock)),
      ),
    ).toEqual([]);
  }
});

test("an exact claim fails closed on an unknown claim candidate shape", async () => {
  const homeDir = await makeTemporaryDirectory("bearing-home-");
  await mkdir(join(homeDir, ".bearing"));
  const location = catalogLocationFor(homeDir);
  const unknown = join(location.lockRecovery, CANDIDATE, "unknown");
  const handle = await acquireOwnedLock(location, 0, {
    afterRecoveryClaim: async (phase) => {
      if (phase !== "release") return;
      await mkdir(join(location.lockRecovery, CANDIDATE));
      await writeFile(unknown, "preserve\n");
    },
  });

  await expect(handle.release()).rejects.toBeInstanceOf(CatalogLockRecoveryError);
  await access(unknown);
});

test("near-match tombstones and extra children remain unknown", async () => {
  const fixtures = [
    [`.owner.${"A".repeat(21)}.tombstone`],
    [`.owner.${"A".repeat(21)}B.tombstone`],
    [`.owner.${"A".repeat(22)}.retired`],
    [TOMBSTONE, "extra"],
  ];
  for (const names of fixtures) {
    const homeDir = await makeTemporaryDirectory("bearing-home-");
    await mkdir(join(homeDir, ".bearing"));
    const location = catalogLocationFor(homeDir);
    const candidate = join(location.lockRecovery, CANDIDATE);
    const handle = await acquireOwnedLock(location, 0, {
      afterRecoveryClaim: async (phase) => {
        if (phase !== "release") return;
        await mkdir(candidate);
        for (const name of names)
          await writeFile(join(candidate, name), candidateOwner(process.pid));
      },
    });

    await expect(handle.release()).rejects.toBeInstanceOf(CatalogLockRecoveryError);
    for (const name of names) await access(join(candidate, name));
  }
});

test("candidate and owner special nodes fail closed without changing their referents", async () => {
  for (const kind of [
    "candidate-symlink",
    "owner-symlink",
    "owner-hardlink",
    "owner-fifo",
    "tombstone-symlink",
    "tombstone-hardlink",
    "tombstone-fifo",
  ] as const) {
    const homeDir = await makeTemporaryDirectory("bearing-home-");
    await mkdir(join(homeDir, ".bearing"));
    const location = catalogLocationFor(homeDir);
    const outside = join(homeDir, `outside-${kind}`);
    if (kind === "candidate-symlink") {
      await mkdir(outside);
      await writeFile(join(outside, "marker"), "preserve\n");
    } else {
      await writeFile(outside, "preserve\n");
    }
    const handle = await acquireOwnedLock(location, 0, {
      afterRecoveryClaim: async (phase) => {
        if (phase !== "release") return;
        const candidate = join(location.lockRecovery, CANDIDATE);
        if (kind === "candidate-symlink") {
          await symlink(outside, candidate);
          return;
        }
        await mkdir(candidate);
        const owner = join(candidate, kind.startsWith("tombstone") ? TOMBSTONE : "owner.json");
        if (kind.endsWith("symlink")) await symlink(outside, owner);
        else if (kind.endsWith("hardlink")) await link(outside, owner);
        else {
          const fifo = Bun.spawn(["mkfifo", owner], { stdout: "ignore", stderr: "pipe" });
          expect(await fifo.exited).toBe(0);
        }
      },
    });

    await expect(handle.release()).rejects.toBeInstanceOf(CatalogLockRecoveryError);
    expect(
      kind === "candidate-symlink"
        ? await readFile(join(outside, "marker"), "utf8")
        : await readFile(outside, "utf8"),
    ).toBe("preserve\n");
  }
});

test("detached cleanup drains a regular partially-written candidate owner", async () => {
  for (const ownerBytes of ["not-json\n", '{"pid":']) {
    const homeDir = await makeTemporaryDirectory("bearing-home-");
    await mkdir(join(homeDir, ".bearing"));
    const location = catalogLocationFor(homeDir);
    const handle = await acquireOwnedLock(location, 0, {
      beforeLockQuarantine: async (phase) => {
        if (phase !== "release") return;
        const candidate = join(location.lockRecovery, CANDIDATE);
        await mkdir(candidate);
        await writeFile(join(candidate, "owner.json"), ownerBytes);
      },
    });

    await expect(handle.release()).resolves.toBeUndefined();
    expect(
      (await readdir(join(homeDir, ".bearing"))).filter((name) =>
        name.startsWith(basename(location.lock)),
      ),
    ).toEqual([]);
  }
});

test("a loser paused after candidate mkdir returns transient contention after quarantine", async () => {
  const homeDir = await makeTemporaryDirectory("bearing-home-");
  await mkdir(join(homeDir, ".bearing"));
  const location = catalogLocationFor(homeDir);
  const handle = await acquireOwnedLock(location, 0);
  const directory = await inspectDirectoryGeneration(location.lock);
  if (directory === undefined) throw new Error("Expected an owned lock generation.");
  const created = deferred();
  const resume = deferred();
  const loser = tryClaimRecovery(location, directory, undefined, "transient", async () => {
    created.resolve();
    await resume.promise;
  });
  await created.promise;

  await expect(handle.release()).resolves.toBeUndefined();
  resume.resolve();

  await expect(loser).resolves.toBeUndefined();
  expect(
    (await readdir(join(homeDir, ".bearing"))).filter((name) =>
      name.startsWith(basename(location.lock)),
    ),
  ).toEqual([]);
});

test("candidate creation maps a removed recovery parent to transient contention", async () => {
  const homeDir = await makeTemporaryDirectory("bearing-home-");
  const location = catalogLocationFor(homeDir);
  await mkdir(location.lock, { recursive: true });
  const directory = await inspectDirectoryGeneration(location.lock);
  if (directory === undefined) throw new Error("Expected a lock generation.");

  await expect(
    tryClaimRecovery(location, directory, async () => rmdir(location.lockRecovery), "transient"),
  ).resolves.toBeUndefined();
  await expect(access(location.lockRecovery)).rejects.toThrow();
});

test("an exact empty canonical claim converges while its owner is published", async () => {
  const homeDir = await makeTemporaryDirectory("bearing-home-");
  const location = catalogLocationFor(homeDir);
  const claim = join(location.lockRecovery, "claim");
  await mkdir(claim, { recursive: true });

  const observed = inspectCanonicalRecoveryClaim(claim);
  await Bun.sleep(10);
  await writeFile(join(claim, "owner.json"), candidateOwner(process.pid));

  await expect(observed).resolves.toBe("active");
});

test("candidate creation never follows a replaced recovery parent", async () => {
  for (const targetKind of ["outside", "same-generation"] as const) {
    const homeDir = await makeTemporaryDirectory("bearing-home-");
    const location = catalogLocationFor(homeDir);
    await mkdir(location.lock, { recursive: true });
    const directory = await inspectDirectoryGeneration(location.lock);
    if (directory === undefined) throw new Error("Expected a lock generation.");
    const preserved = join(homeDir, `preserved-parent-${targetKind}`);
    const outside = join(homeDir, `outside-parent-${targetKind}`);
    await mkdir(outside);

    await expect(
      tryClaimRecovery(
        location,
        directory,
        async () => {
          if (targetKind === "same-generation") {
            await rename(location.lockRecovery, preserved);
            await symlink(preserved, location.lockRecovery);
          } else {
            await rmdir(location.lockRecovery);
            await symlink(outside, location.lockRecovery);
          }
        },
        "transient",
      ),
    ).resolves.toBeUndefined();

    expect(await readdir(outside)).toEqual([]);
    if (targetKind === "same-generation") expect(await readdir(preserved)).toEqual([]);
  }
});

test("candidate cleanup preserves both generations when its unique path is replaced", async () => {
  const homeDir = await makeTemporaryDirectory("bearing-home-");
  const location = catalogLocationFor(homeDir);
  await mkdir(location.lock, { recursive: true });
  const directory = await inspectDirectoryGeneration(location.lock);
  if (directory === undefined) throw new Error("Expected a lock generation.");
  const preserved = join(homeDir, "preserved-claim-candidate");
  let replacement = "";

  await expect(
    tryClaimRecovery(location, directory, undefined, "error", async (candidate) => {
      replacement = candidate;
      await rename(candidate, preserved);
      await mkdir(candidate);
      await writeFile(join(candidate, "marker"), "foreign\n");
    }),
  ).rejects.toBeInstanceOf(CatalogLockRecoveryError);

  await access(preserved);
  expect(await readdir(preserved)).toEqual([]);
  expect(await readdir(replacement)).toEqual(["marker"]);
});

test("owner-bound candidate cleanup preserves a replacement before canonical publish", async () => {
  const homeDir = await makeTemporaryDirectory("bearing-home-");
  const location = catalogLocationFor(homeDir);
  await mkdir(location.lock, { recursive: true });
  const directory = await inspectDirectoryGeneration(location.lock);
  if (directory === undefined) throw new Error("Expected a lock generation.");
  const preserved = join(homeDir, "preserved-owned-candidate");
  let replacement = "";

  await expect(
    tryClaimRecovery(location, directory, undefined, "error", undefined, async (candidate) => {
      replacement = candidate;
      await rename(candidate, preserved);
      await mkdir(candidate);
      await writeFile(join(candidate, "marker"), "foreign\n");
    }),
  ).rejects.toBeInstanceOf(CatalogLockRecoveryError);

  expect(await readdir(preserved)).toEqual(["owner.json"]);
  expect(await readdir(replacement)).toEqual(["marker"]);
  await expect(access(join(location.lockRecovery, "claim"))).rejects.toThrow();
});

test("canonical claim publication preserves a candidate replaced after final confirmation", async () => {
  const homeDir = await makeTemporaryDirectory("bearing-home-");
  const location = catalogLocationFor(homeDir);
  await mkdir(location.lock, { recursive: true });
  const directory = await inspectDirectoryGeneration(location.lock);
  if (directory === undefined) throw new Error("Expected a lock generation.");
  const preserved = join(homeDir, "preserved-confirmed-candidate");
  let replacement = "";

  await expect(
    tryClaimRecovery(
      location,
      directory,
      undefined,
      "error",
      undefined,
      undefined,
      async (candidate) => {
        replacement = candidate;
        await rename(candidate, preserved);
        await mkdir(candidate);
        await writeFile(join(candidate, "marker"), "foreign\n");
      },
    ),
  ).rejects.toBeInstanceOf(CatalogLockRecoveryError);

  expect(await readdir(preserved)).toEqual(["owner.json"]);
  expect(await readdir(replacement)).toEqual(["marker"]);
  await expect(access(join(location.lockRecovery, "claim"))).rejects.toThrow();
});

test("candidate owner publication never follows an outside or same-generation symlink", async () => {
  for (const targetKind of ["outside", "same-generation"] as const) {
    const homeDir = await makeTemporaryDirectory("bearing-home-");
    const location = catalogLocationFor(homeDir);
    await mkdir(location.lock, { recursive: true });
    const directory = await inspectDirectoryGeneration(location.lock);
    if (directory === undefined) throw new Error("Expected a lock generation.");
    const preserved = join(homeDir, `preserved-${targetKind}`);
    const outside = join(homeDir, `outside-${targetKind}`);
    await mkdir(outside);
    await writeFile(join(outside, "marker"), "preserve\n");
    let candidatePath = "";

    await expect(
      tryClaimRecovery(location, directory, undefined, "error", async (candidate) => {
        candidatePath = candidate;
        await rename(candidate, preserved);
        await symlink(targetKind === "outside" ? outside : preserved, candidate);
      }),
    ).rejects.toBeInstanceOf(CatalogLockRecoveryError);

    expect((await lstat(candidatePath)).isSymbolicLink()).toBeTrue();
    await expect(access(join(outside, "owner.json"))).rejects.toThrow();
    await expect(access(join(preserved, "owner.json"))).rejects.toThrow();
    expect(await readdir(preserved)).toEqual([]);
    expect(await readdir(outside)).toEqual(["marker"]);
  }
});

test("release stays bound to the recovery parent captured with its claim", async () => {
  const homeDir = await makeTemporaryDirectory("bearing-home-");
  await mkdir(join(homeDir, ".bearing"));
  const location = catalogLocationFor(homeDir);
  const preserved = join(homeDir, "preserved-recovery-parent");
  const handle = await acquireOwnedLock(location, 0, {
    afterRecoveryAcquired: async (phase) => {
      if (phase !== "release") return;
      await rename(location.lockRecovery, preserved);
      await symlink(preserved, location.lockRecovery);
    },
  });

  await expect(handle.release()).rejects.toBeInstanceOf(CatalogLockRecoveryError);
  expect((await lstat(location.lockRecovery)).isSymbolicLink()).toBeTrue();
  await access(join(preserved, "claim", "owner.json"));
  await access(location.lockOwner);
});

test("staged owner cleanup preserves a replacement after exact owner quarantine", async () => {
  const homeDir = await makeTemporaryDirectory("bearing-home-");
  const parent = join(homeDir, ".bearing");
  const directory = join(parent, "staged-owner-container");
  await mkdir(directory, { recursive: true });
  const [parentGeneration, directoryGeneration] = await Promise.all([
    inspectDirectoryGeneration(parent),
    inspectDirectoryGeneration(directory),
  ]);
  if (parentGeneration === undefined || directoryGeneration === undefined) {
    throw new Error("Expected exact directory generations.");
  }
  const name = "owner.staged";
  const ownerPath = join(directory, name);
  const originalBytes = candidateOwner(process.pid);
  await writeFile(ownerPath, originalBytes);
  const owner = await inspectLockOwner(ownerPath);
  if (owner.state !== "regular") throw new Error("Expected a regular staged owner.");
  const preserved = join(homeDir, "preserved-staged-owner");
  let replacement = "";

  await expect(
    strictRemoveBoundOwnerFile(
      directory,
      directoryGeneration,
      name,
      owner,
      parentGeneration,
      async (tombstone) => {
        replacement = tombstone;
        await rename(tombstone, preserved);
        await writeFile(tombstone, "foreign\n");
      },
    ),
  ).rejects.toBeInstanceOf(CatalogLockRecoveryError);

  expect(await readFile(preserved, "utf8")).toBe(originalBytes);
  expect(await readFile(replacement, "utf8")).toBe("foreign\n");
});
