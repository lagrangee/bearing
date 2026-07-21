import { expect, test } from "bun:test";
import { join } from "node:path";
import { runSync } from "../src/sync";
import { readSyncReceipt } from "../src/sync-receipt";
import { createValidBearingRepo } from "./helpers";

test("every actual Sync writes a separate Receipt, including deterministic no-op", async () => {
  const root = await createValidBearingRepo();
  const receiptPath = join(root, ".bearing/cache/sync-receipt.json");

  const first = await runSync(root, {
    packageVersion: "0.0.0-test",
    completedAt: "2026-07-13T20:00:00+08:00",
  });
  const firstReceipt = await readSyncReceipt(receiptPath);
  expect(first.changed).toBe(true);
  expect(firstReceipt).toMatchObject({
    kind: "available",
    receipt: {
      completedAt: "2026-07-13T20:00:00+08:00",
      reconciliation: "applied",
      sitemap: { fingerprint: first.fingerprint },
    },
  });

  const second = await runSync(root, {
    packageVersion: "0.0.0-test",
    completedAt: "2026-07-13T20:01:00+08:00",
  });
  const secondReceipt = await readSyncReceipt(receiptPath);
  expect(second.changed).toBe(false);
  expect(secondReceipt).toMatchObject({
    kind: "available",
    receipt: {
      completedAt: "2026-07-13T20:01:00+08:00",
      reconciliation: "no-op",
      sitemap: { fingerprint: second.fingerprint },
    },
  });
});
