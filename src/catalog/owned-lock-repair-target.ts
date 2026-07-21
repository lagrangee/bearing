import type { BigIntStats } from "node:fs";
import { lstat, readdir } from "node:fs/promises";
import { CatalogLockRepairError } from "./errors";
import {
  inspectLockOwner,
  type LockOwnerArtifact,
  ownerProcessState,
  sameMovedOwnerArtifact,
} from "./lock-owner";

type NodeIdentity = Readonly<{
  device: bigint;
  inode: bigint;
  mode: bigint;
  links: bigint;
  size: bigint;
}>;
type OwnerNode = Readonly<{
  kind: "directory" | "regular" | "other";
  identity: NodeIdentity;
  safeRegular?: Extract<LockOwnerArtifact, { state: "regular" }>;
}>;
export type RepairTarget = Readonly<{ path: string; node: OwnerNode }>;

const isMissing = (error: unknown): boolean =>
  error instanceof Error && "code" in error && error.code === "ENOENT";
const isSystemError = (error: unknown): error is Error & Readonly<{ code: string }> =>
  error instanceof Error && "code" in error && typeof error.code === "string";
const identityOf = (metadata: BigIntStats): NodeIdentity => ({
  device: metadata.dev,
  inode: metadata.ino,
  mode: metadata.mode,
  links: metadata.nlink,
  size: metadata.size,
});
const sameNode = (left: NodeIdentity, right: NodeIdentity): boolean =>
  left.device === right.device &&
  left.inode === right.inode &&
  left.mode === right.mode &&
  left.links === right.links &&
  left.size === right.size;
const changed = (cause?: unknown): CatalogLockRepairError =>
  new CatalogLockRepairError("lock-changed", cause === undefined ? undefined : { cause });

const inspectNode = async (target: string): Promise<OwnerNode | "missing" | "changed"> => {
  let metadata: BigIntStats;
  try {
    metadata = await lstat(target, { bigint: true });
  } catch (error) {
    if (isMissing(error)) return "missing";
    if (isSystemError(error)) throw changed(error);
    throw error;
  }
  const identity = identityOf(metadata);
  const kind = metadata.isDirectory() ? "directory" : metadata.isFile() ? "regular" : "other";
  if (kind !== "regular" || metadata.nlink !== 1n) return { kind, identity };
  const safeRegular = await inspectLockOwner(target);
  if (safeRegular.state === "missing") return "changed";
  if (safeRegular.state === "regular") return { kind, identity, safeRegular };
  let confirmed: BigIntStats | undefined;
  try {
    confirmed = await lstat(target, { bigint: true });
  } catch (error) {
    if (!isMissing(error)) {
      if (isSystemError(error)) throw changed(error);
      throw error;
    }
  }
  return confirmed !== undefined && sameNode(identity, identityOf(confirmed))
    ? { kind, identity }
    : "changed";
};

export const sameRepairTarget = (left: RepairTarget, right: RepairTarget): boolean => {
  if (left.node.kind !== right.node.kind || !sameNode(left.node.identity, right.node.identity)) {
    return false;
  }
  if (left.node.safeRegular === undefined) return right.node.safeRegular === undefined;
  return (
    right.node.safeRegular !== undefined &&
    sameMovedOwnerArtifact(left.node.safeRegular, right.node.safeRegular)
  );
};

export const exactEntries = async (
  target: string,
  expected: readonly string[],
): Promise<boolean> => {
  try {
    const entries = (await readdir(target)).sort();
    const sorted = [...expected].sort();
    return entries.length === sorted.length && entries.every((entry, i) => entry === sorted[i]);
  } catch (error) {
    if (isSystemError(error)) return false;
    throw error;
  }
};

export const assertRepairableTarget = async (target: RepairTarget): Promise<void> => {
  if (target.node.kind === "directory" && !(await exactEntries(target.path, []))) {
    throw new CatalogLockRepairError("nonempty-owner-directory");
  }
  const owner = target.node.safeRegular?.owner;
  if (owner === undefined) return;
  const state = ownerProcessState(owner.pid);
  if (state === "alive") throw new CatalogLockRepairError("live-owner");
  if (state === "indeterminate") throw new CatalogLockRepairError("indeterminate-owner");
};

export const captureRepairTarget = async (path: string): Promise<RepairTarget | undefined> => {
  const node = await inspectNode(path);
  if (node === "missing") return undefined;
  if (node === "changed") throw changed();
  return { path, node };
};
