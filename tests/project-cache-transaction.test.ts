import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { commitProjectCache } from "../src/portal/project-cache-transaction";
import { writeProjectSnapshotCache } from "../src/project-snapshot/cache";
import { runSync } from "../src/sync";
import { createValidBearingRepo } from "./helpers";
import { buildProjectSnapshotForTest as buildProjectSnapshot } from "./project-snapshot-fixture";

const snapshotFor = async (root: string, packageVersion: string) => {
  const sync = await runSync(root, {
    completedAt: "2026-07-13T12:00:00.000Z",
    providerObservationIntent: "initial-baseline",
  });
  const snapshot = await buildProjectSnapshot({
    repoRoot: root,
    packageVersion,
    inputs: sync.inputs,
    sitemapFingerprint: sync.fingerprint,
    diagnostics: sync.diagnostics,
    advisoryFreshness: sync.advisoryFreshness,
  });
  return { sync, snapshot };
};

test("restores prior Snapshot bytes when the paired Receipt write fails", async () => {
  const root = await createValidBearingRepo();
  const prior = await snapshotFor(root, "prior");
  await writeProjectSnapshotCache(root, prior.snapshot);
  const snapshotPath = join(root, ".bearing/cache/project-snapshot.json");
  const receiptPath = join(root, ".bearing/cache/sync-receipt.json");
  const priorSnapshot = await readFile(snapshotPath);
  const next = await snapshotFor(root, "next");
  const priorReceipt = await readFile(receiptPath);

  await expect(
    commitProjectCache(
      { repoRoot: root, snapshot: next.snapshot, receipt: next.sync.receipt },
      { writeReceipt: async () => Promise.reject(new Error("injected receipt failure")) },
    ),
  ).rejects.toThrow("injected receipt failure");
  expect(await readFile(snapshotPath)).toEqual(priorSnapshot);
  expect(await readFile(receiptPath)).toEqual(priorReceipt);
});

test("removes a newly created Snapshot if the paired Receipt write fails", async () => {
  const root = await createValidBearingRepo();
  const next = await snapshotFor(root, "next");
  const snapshotPath = join(root, ".bearing/cache/project-snapshot.json");
  await expect(
    commitProjectCache(
      { repoRoot: root, snapshot: next.snapshot, receipt: next.sync.receipt },
      { writeReceipt: async () => Promise.reject(new Error("injected receipt failure")) },
    ),
  ).rejects.toThrow("injected receipt failure");
  await expect(readFile(snapshotPath)).rejects.toMatchObject({ code: "ENOENT" });
});

test("restores the prior observation selection when Snapshot publication fails", async () => {
  const root = await createValidBearingRepo();
  const prior = await snapshotFor(root, "prior");
  await writeProjectSnapshotCache(root, prior.snapshot);
  const observationPath = join(root, ".bearing/cache/provider-observations.json");
  const priorObservation = await readFile(observationPath);
  const candidateObservation = Buffer.from(
    `${JSON.stringify({ schemaVersion: 1, observations: [], selections: [] })}\n`,
  );

  await expect(
    commitProjectCache(
      {
        repoRoot: root,
        providerObservationStore: { bytes: candidateObservation },
        snapshot: prior.snapshot,
      },
      {
        writeSnapshot: async () => Promise.reject(new Error("injected Snapshot failure")),
      },
    ),
  ).rejects.toThrow("injected Snapshot failure");

  expect(await readFile(observationPath)).toEqual(priorObservation);
});

test("restores the prior targeted inspection when coherent Snapshot publication fails", async () => {
  const root = await createValidBearingRepo();
  const prior = await snapshotFor(root, "prior");
  const inspectionPath = join(root, ".bearing/cache/native-scope-inspections.json");
  const priorInspection = Buffer.from("prior targeted inspection\n");
  await commitProjectCache({
    repoRoot: root,
    nativeScopeInspectionStore: { bytes: priorInspection },
  });

  await expect(
    commitProjectCache(
      {
        repoRoot: root,
        nativeScopeInspectionStore: { bytes: Buffer.from("candidate inspection\n") },
        snapshot: prior.snapshot,
      },
      {
        writeSnapshot: async () => Promise.reject(new Error("injected Snapshot failure")),
      },
    ),
  ).rejects.toThrow("injected Snapshot failure");

  expect(await readFile(inspectionPath)).toEqual(priorInspection);
});
