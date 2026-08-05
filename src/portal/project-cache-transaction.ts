import type { Stats } from "node:fs";
import { lstat, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import writeFileAtomic from "write-file-atomic";
import { writeProjectSnapshotCache } from "../project-snapshot/cache";
import type { ProjectSnapshot } from "../project-snapshot/contract";
import type { SyncReceipt } from "../sync-receipt";
import { writeSyncReceipt } from "../sync-receipt";

type FileCapture =
  | Readonly<{ kind: "missing" }>
  | Readonly<{ kind: "available"; bytes: Buffer; mode: number }>;
type CommitInput = Readonly<{
  repoRoot: string;
  sync?: Readonly<{
    reportPath: string;
    sitemapPath: string;
    commit: () => Promise<unknown>;
  }>;
  providerObservationStore?: Readonly<{ bytes: Buffer }>;
  nativeScopeInspectionStore?: Readonly<{ bytes: Buffer }>;
  snapshot?: ProjectSnapshot;
  receipt?: SyncReceipt;
}>;
type Dependencies = Readonly<{
  writeProviderObservationStore?: (target: string, bytes: Buffer, mode: number) => Promise<void>;
  writeNativeScopeInspectionStore?: (target: string, bytes: Buffer, mode: number) => Promise<void>;
  writeSnapshot?: typeof writeProjectSnapshotCache;
  writeReceipt?: typeof writeSyncReceipt;
}>;

const missing = (error: unknown): boolean =>
  error instanceof Error && "code" in error && error.code === "ENOENT";
const safeFile = (metadata: Stats): boolean =>
  metadata.isFile() && !metadata.isSymbolicLink() && metadata.nlink === 1;
const capture = async (target: string): Promise<FileCapture> => {
  try {
    const metadata = await lstat(target);
    if (!safeFile(metadata)) throw new Error("Project cache target became unsafe.");
    return { kind: "available", bytes: await readFile(target), mode: metadata.mode & 0o777 };
  } catch (error) {
    if (missing(error)) return { kind: "missing" };
    throw error;
  }
};
const restore = async (target: string, prior: FileCapture): Promise<void> => {
  if (prior.kind === "available") {
    await writeFileAtomic(target, prior.bytes, { mode: prior.mode });
    return;
  }
  try {
    const metadata = await lstat(target);
    if (!safeFile(metadata)) throw new Error("Project cache target became unsafe.");
    await unlink(target);
  } catch (error) {
    if (!missing(error)) throw error;
  }
};

export const commitProjectCache = async (
  input: CommitInput,
  dependencies: Dependencies = {},
): Promise<void> => {
  if (
    input.sync === undefined &&
    input.providerObservationStore === undefined &&
    input.nativeScopeInspectionStore === undefined &&
    input.snapshot === undefined &&
    input.receipt === undefined
  ) {
    return;
  }
  const observationPath = join(input.repoRoot, ".bearing/cache/provider-observations.json");
  const inspectionPath = join(input.repoRoot, ".bearing/cache/native-scope-inspections.json");
  const snapshotPath = join(input.repoRoot, ".bearing/cache/project-snapshot.json");
  const receiptPath = join(input.repoRoot, ".bearing/cache/sync-receipt.json");
  const writeObservation =
    dependencies.writeProviderObservationStore ??
    ((target: string, bytes: Buffer, mode: number) => writeFileAtomic(target, bytes, { mode }));
  const writeInspection =
    dependencies.writeNativeScopeInspectionStore ??
    ((target: string, bytes: Buffer, mode: number) => writeFileAtomic(target, bytes, { mode }));
  const writeSnapshot = dependencies.writeSnapshot ?? writeProjectSnapshotCache;
  const writeReceipt = dependencies.writeReceipt ?? writeSyncReceipt;
  const priorReport = input.sync === undefined ? undefined : await capture(input.sync.reportPath);
  const priorSitemap = input.sync === undefined ? undefined : await capture(input.sync.sitemapPath);
  const priorObservation =
    input.providerObservationStore === undefined ? undefined : await capture(observationPath);
  const priorInspection =
    input.nativeScopeInspectionStore === undefined ? undefined : await capture(inspectionPath);
  const priorSnapshot = input.snapshot === undefined ? undefined : await capture(snapshotPath);
  const priorReceipt = input.receipt === undefined ? undefined : await capture(receiptPath);
  try {
    if (input.sync !== undefined) await input.sync.commit();
    if (input.providerObservationStore !== undefined) {
      const mode = priorObservation?.kind === "available" ? priorObservation.mode : 0o644;
      await writeObservation(observationPath, input.providerObservationStore.bytes, mode);
    }
    if (input.nativeScopeInspectionStore !== undefined) {
      const mode = priorInspection?.kind === "available" ? priorInspection.mode : 0o644;
      await writeInspection(inspectionPath, input.nativeScopeInspectionStore.bytes, mode);
    }
    if (input.snapshot !== undefined) await writeSnapshot(input.repoRoot, input.snapshot);
    if (input.receipt !== undefined) await writeReceipt(receiptPath, input.receipt);
  } catch (error) {
    const failures: unknown[] = [error];
    for (const [target, prior] of [
      [receiptPath, priorReceipt],
      [snapshotPath, priorSnapshot],
      [observationPath, priorObservation],
      [inspectionPath, priorInspection],
      [input.sync?.sitemapPath ?? observationPath, priorSitemap],
      [input.sync?.reportPath ?? observationPath, priorReport],
    ] as const) {
      if (prior === undefined) continue;
      try {
        await restore(target, prior);
      } catch (restoreError) {
        failures.push(restoreError);
      }
    }
    if (failures.length === 1) throw error;
    throw new AggregateError(failures, "Project cache commit and recovery both failed.");
  }
};
