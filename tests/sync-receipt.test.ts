import { describe, expect, test } from "bun:test";
import { chmod, link, lstat, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  createSyncReceipt,
  readSyncReceipt,
  syncReceiptSchema,
  writeSyncReceipt,
} from "../src/sync-receipt";
import { makeTemporaryDirectory } from "./helpers";

const fingerprint = `sha256:${"a".repeat(64)}`;

const receipt = createSyncReceipt({
  producer: {
    packageName: "@lagrangee/bearing",
    packageVersion: "0.0.0-test",
  },
  completedAt: "2026-07-13T18:20:30+08:00",
  sitemap: { version: 1, fingerprint },
  reconciliation: "applied",
});

const createReceiptTarget = async (): Promise<string> => {
  const root = await makeTemporaryDirectory("bearing-sync-receipt-");
  const cache = join(root, ".bearing/cache");
  await mkdir(cache, { recursive: true });
  return join(cache, "sync-receipt.json");
};

describe("Sync Receipt schema", () => {
  test("creates the strict v1 operational envelope", () => {
    // Given: one successful Sitemap reconciliation completion.
    // When: the completion is parsed into a Sync Receipt.
    // Then: only repository-scoped operational facts enter the v1 envelope.
    expect(receipt).toEqual({
      schemaVersion: 1,
      producer: {
        packageName: "@lagrangee/bearing",
        packageVersion: "0.0.0-test",
      },
      completedAt: "2026-07-13T18:20:30+08:00",
      sitemap: { version: 1, fingerprint },
      reconciliation: "applied",
    });
  });

  test("rejects undeclared envelope fields", () => {
    // Given: an otherwise valid receipt carrying Catalog identity.
    const candidate = { ...receipt, entryId: "project-1" };

    // When: the candidate crosses the schema boundary.
    const result = syncReceiptSchema.safeParse(candidate);

    // Then: strict v1 parsing rejects the undeclared field.
    expect(result.success).toBe(false);
  });

  test("requires a real RFC3339 date-time with an explicit offset", () => {
    // Given: a valid v1 receipt with a local date-time lacking an offset.
    const candidate = { ...receipt, completedAt: "2026-07-13T18:20:30" };

    // When: the candidate crosses the schema boundary.
    const result = syncReceiptSchema.safeParse(candidate);

    // Then: the ambiguous timestamp is rejected.
    expect(result.success).toBe(false);
  });

  test("accepts no-op as a successful reconciliation result", () => {
    // Given: a valid Sync completion whose deterministic outputs were unchanged.
    const candidate = { ...receipt, reconciliation: "no-op" };

    // When: the candidate crosses the schema boundary.
    const result = syncReceiptSchema.safeParse(candidate);

    // Then: no-op remains a valid successful Sync Receipt.
    expect(result.success).toBe(true);
  });
});

describe("Sync Receipt safe read", () => {
  test("reports a missing cache entry", async () => {
    // Given: a safe cache path without a Receipt.
    const target = await createReceiptTarget();

    // When: the Receipt is read.
    const result = await readSyncReceipt(target);

    // Then: valid absence is explicit.
    expect(result).toEqual({ kind: "missing" });
  });

  test("reports malformed bytes without throwing", async () => {
    // Given: invalid JSON at the Receipt path.
    const target = await createReceiptTarget();
    await writeFile(target, "{not-json\n", "utf8");

    // When: the Receipt is read.
    const result = await readSyncReceipt(target);

    // Then: corruption is isolated to the Receipt.
    expect(result).toEqual({ kind: "malformed" });
  });

  test("reports an unsupported schema version separately", async () => {
    // Given: parseable Receipt JSON from a future schema version.
    const target = await createReceiptTarget();
    await writeFile(target, `${JSON.stringify({ ...receipt, schemaVersion: 2 })}\n`, "utf8");

    // When: the Receipt is read.
    const result = await readSyncReceipt(target);

    // Then: the Host can distinguish version mismatch from corruption.
    expect(result).toEqual({ kind: "unsupported", schemaVersion: 2 });
  });

  test("returns a typed Receipt from safe current-version bytes", async () => {
    // Given: one current-version Receipt written through the persistence primitive.
    const target = await createReceiptTarget();
    await writeSyncReceipt(target, receipt);

    // When: the Receipt is read.
    const result = await readSyncReceipt(target);

    // Then: the parsed operational fact is available.
    expect(result).toEqual({ kind: "available", receipt });
  });
});

describe("Sync Receipt safe atomic write", () => {
  test("rejects a symbolic-link target without touching its referent", async () => {
    // Given: a Receipt path linked to bytes outside the cache.
    const target = await createReceiptTarget();
    const referent = join(await makeTemporaryDirectory("bearing-receipt-outside-"), "data");
    await writeFile(referent, "outside\n", "utf8");
    await symlink(referent, target);

    // When: a Receipt write is attempted.
    const action = writeSyncReceipt(target, receipt);

    // Then: the unsafe shape is rejected and its referent is unchanged.
    await expect(action).rejects.toThrow("one unlinked regular file");
    expect(await readFile(referent, "utf8")).toBe("outside\n");
  });

  test("rejects a FIFO target without blocking", async () => {
    // Given: a named pipe at the Receipt path.
    const target = await createReceiptTarget();
    const created = Bun.spawn(["mkfifo", target]);
    expect(await created.exited).toBe(0);

    // When: a Receipt write is attempted.
    const action = writeSyncReceipt(target, receipt);

    // Then: shape inspection rejects the pipe before any write opens it.
    await expect(action).rejects.toThrow("one unlinked regular file");
  });

  test("rejects a directory target", async () => {
    // Given: a directory at the Receipt path.
    const target = await createReceiptTarget();
    await mkdir(target);

    // When: a Receipt write is attempted.
    const action = writeSyncReceipt(target, receipt);

    // Then: the directory is preserved as a bounded failure.
    await expect(action).rejects.toThrow("one unlinked regular file");
    expect((await lstat(target)).isDirectory()).toBe(true);
  });

  test("rejects a multiply-linked regular file without changing either name", async () => {
    // Given: two names sharing the current Receipt inode.
    const target = await createReceiptTarget();
    const peer = `${target}.peer`;
    await writeFile(target, "previous\n", "utf8");
    await link(target, peer);

    // When: a Receipt write is attempted.
    const action = writeSyncReceipt(target, receipt);

    // Then: neither link is replaced or changed.
    await expect(action).rejects.toThrow("one unlinked regular file");
    expect(await Promise.all([readFile(target, "utf8"), readFile(peer, "utf8")])).toEqual([
      "previous\n",
      "previous\n",
    ]);
  });

  test("preserves previous bytes when atomic staging cannot be created", async () => {
    // Given: an existing Receipt in a directory that cannot accept a staging file.
    const target = await createReceiptTarget();
    const cache = dirname(target);
    await writeFile(target, "previous\n", "utf8");
    await chmod(cache, 0o500);

    // When: the atomic Receipt write fails.
    const action = writeSyncReceipt(target, receipt);

    // Then: the prior target remains byte-identical.
    try {
      await expect(action).rejects.toBeInstanceOf(Error);
    } finally {
      await chmod(cache, 0o700);
    }
    expect(await readFile(target, "utf8")).toBe("previous\n");
  });
});
