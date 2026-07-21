import type { Stats } from "node:fs";
import { lstat, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { writeFileAtomically } from "../atomic-write";
import { writeProjectSnapshotCache } from "../project-snapshot/cache";
import type { ProjectSnapshot } from "../project-snapshot/contract";
import type { SyncReceipt } from "../sync-receipt";
import { writeSyncReceipt } from "../sync-receipt";

type FileCapture =
  | Readonly<{ kind: "missing" }>
  | Readonly<{ kind: "available"; bytes: Buffer; mode: number }>;
type CommitInput = Readonly<{
  repoRoot: string;
  snapshot?: ProjectSnapshot;
  receipt?: SyncReceipt;
}>;
type Dependencies = Readonly<{
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
    await writeFileAtomically(target, prior.bytes, prior.mode);
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
  if (input.snapshot === undefined && input.receipt === undefined) return;
  const snapshotPath = join(input.repoRoot, ".bearing/cache/project-snapshot.json");
  const receiptPath = join(input.repoRoot, ".bearing/cache/sync-receipt.json");
  const writeSnapshot = dependencies.writeSnapshot ?? writeProjectSnapshotCache;
  const writeReceipt = dependencies.writeReceipt ?? writeSyncReceipt;
  const priorSnapshot = input.snapshot === undefined ? undefined : await capture(snapshotPath);
  if (input.snapshot !== undefined) await writeSnapshot(input.repoRoot, input.snapshot);
  if (input.receipt === undefined) return;
  try {
    await writeReceipt(receiptPath, input.receipt);
  } catch (error) {
    if (priorSnapshot !== undefined) await restore(snapshotPath, priorSnapshot);
    throw error;
  }
};
