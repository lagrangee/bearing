import { expect, test } from "bun:test";
import { readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createProjectMaterializer } from "../src/portal/project-materializer";
import { readProjectSnapshotCache } from "../src/project-snapshot/cache";
import { readProjectSitemapCache } from "../src/sitemap-cache";
import { runSync } from "../src/sync";
import { createValidBearingRepo, writeFixture } from "./helpers";

const snapshotPath = (root: string) => join(root, ".bearing/cache/project-snapshot.json");
const receiptPath = (root: string) => join(root, ".bearing/cache/sync-receipt.json");
const summaryPath = (root: string) => join(root, ".bearing/state/project-summary.md");

const corruptions = [
  { name: "malformed", bytes: "{broken\n" },
  { name: "unsupported", bytes: `${JSON.stringify({ schemaVersion: 999, legacy: true })}\n` },
] as const;

for (const corruption of corruptions) {
  test(`recovers ${corruption.name} Snapshot cache without changing source or Receipt`, async () => {
    const root = await createValidBearingRepo();
    await runSync(root, { completedAt: "2026-07-14T08:00:00.000Z" });
    const source = await readFile(summaryPath(root));
    const receipt = await readFile(receiptPath(root));
    await writeFile(snapshotPath(root), corruption.bytes, "utf8");

    const result = await createProjectMaterializer({ packageVersion: "0.0.0-current" }).run(
      root,
      "ensure-current",
    );

    expect(result).toMatchObject({
      outcome: "materialized",
      snapshotDisposition: "materialized",
      snapshot: { producer: { packageVersion: "0.0.0-current" } },
    });
    expect((await readProjectSnapshotCache(root)).kind).toBe("available");
    expect(await readFile(summaryPath(root))).toEqual(source);
    expect(await readFile(receiptPath(root))).toEqual(receipt);
  });
}

test("recovers a behind-Sitemap Snapshot without fabricating another Sync", async () => {
  const root = await createValidBearingRepo();
  const materializer = createProjectMaterializer({ packageVersion: "0.0.0-current" });
  await runSync(root, { completedAt: "2026-07-14T08:00:00.000Z" });
  await materializer.run(root, "ensure-current");
  await writeFixture(root, "CONTEXT.md", "# Current context\n");
  const current = await runSync(root, { completedAt: "2026-07-14T08:01:00.000Z" });
  const source = await readFile(join(root, "CONTEXT.md"));
  const receipt = await readFile(receiptPath(root));
  expect((await readProjectSnapshotCache(root, current.fingerprint)).kind).toBe("behind");

  const result = await materializer.run(root, "ensure-current");

  expect(result).toMatchObject({
    outcome: "materialized",
    snapshotDisposition: "materialized",
    snapshot: { basis: { sitemapFingerprint: current.fingerprint } },
  });
  expect(await readFile(join(root, "CONTEXT.md"))).toEqual(source);
  expect(await readFile(receiptPath(root))).toEqual(receipt);
});

test("rebuilds a producer-mismatched Snapshot with the current Host package version", async () => {
  const root = await createValidBearingRepo();
  await runSync(root, { completedAt: "2026-07-14T08:00:00.000Z" });
  await createProjectMaterializer({ packageVersion: "0.0.0-old" }).run(root, "ensure-current");
  const source = await readFile(summaryPath(root));
  const receipt = await readFile(receiptPath(root));

  const result = await createProjectMaterializer({ packageVersion: "0.0.0-current" }).run(
    root,
    "ensure-current",
  );

  expect(result).toMatchObject({
    outcome: "materialized",
    snapshotDisposition: "materialized",
    snapshot: { producer: { packageVersion: "0.0.0-current" } },
  });
  expect(await readFile(summaryPath(root))).toEqual(source);
  expect(await readFile(receiptPath(root))).toEqual(receipt);
});

test("detects added and deleted inputs through the shared discovery seam", async () => {
  const root = await createValidBearingRepo();
  const materializer = createProjectMaterializer({ packageVersion: "0.0.0-current" });
  const baseline = await runSync(root, { completedAt: "2026-07-14T08:00:00.000Z" });
  await materializer.run(root, "ensure-current");
  const source = await readFile(summaryPath(root));
  const addedLocator = ".scratch/work/issues/02-added.md";
  await writeFixture(
    root,
    addedLocator,
    "# Added work\n\nType: task\nStatus: open\n\n## Question\n\nWhat was added?\n",
  );

  const added = await materializer.run(root, "ensure-current");
  const addedSitemap = await readProjectSitemapCache(root);

  expect(added).toMatchObject({ outcome: "synced", reconciliation: "applied" });
  expect(String(added.snapshot.basis.sitemapFingerprint)).not.toBe(baseline.fingerprint);
  expect(addedSitemap.kind).toBe("available");
  if (addedSitemap.kind !== "available") throw new Error("Expected current Sitemap cache.");
  expect(addedSitemap.envelope.inputs).not.toContain(addedLocator);
  expect(JSON.stringify(added.snapshot.providerCaptures)).toContain(addedLocator);

  await unlink(join(root, addedLocator));
  const deleted = await materializer.run(root, "ensure-current");
  const deletedSitemap = await readProjectSitemapCache(root);

  expect(deleted).toMatchObject({ outcome: "synced", reconciliation: "applied" });
  expect(String(deleted.snapshot.basis.sitemapFingerprint)).toBe(baseline.fingerprint);
  expect(deletedSitemap.kind).toBe("available");
  if (deletedSitemap.kind !== "available") throw new Error("Expected current Sitemap cache.");
  expect(deletedSitemap.envelope.inputs).not.toContain(addedLocator);
  expect(JSON.stringify(deleted.snapshot.providerCaptures)).not.toContain(addedLocator);
  expect(await readFile(summaryPath(root))).toEqual(source);
});

test("scopes invalid source structure without repairing canonical bytes", async () => {
  const root = await createValidBearingRepo();
  await runSync(root, { completedAt: "2026-07-14T08:00:00.000Z" });
  await writeFixture(
    root,
    ".bearing/state/project-summary.md",
    `---
Type: project-summary
ID: project-summary:current
Title: Invalid Summary
---

# Project Summary: Invalid

## Purpose

Keep the source bytes unchanged.
`,
  );
  const source = await readFile(summaryPath(root));

  const result = await createProjectMaterializer({ packageVersion: "0.0.0-current" }).run(
    root,
    "ensure-current",
  );

  expect(result).toMatchObject({ outcome: "synced", reconciliation: "applied" });
  expect(result.snapshot.summary.validity).toBe("invalid");
  expect(await readFile(summaryPath(root))).toEqual(source);
});
