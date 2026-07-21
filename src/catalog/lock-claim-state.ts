import { lstat, readdir } from "node:fs/promises";
import { join } from "node:path";
import { CatalogLockRecoveryError } from "./errors";
import { inspectLockOwner, ownerProcessState } from "./lock-owner";
import { lockDelay } from "./lock-support";

const CLAIM_OWNER = "owner.json";
const CLAIM_CONVERGENCE_TIMEOUT_MS = 1_000;

const isMissing = (error: unknown): boolean =>
  error instanceof Error && "code" in error && error.code === "ENOENT";

type DirectoryIdentity = Readonly<{ device: bigint; inode: bigint }>;

const inspectDirectory = async (path: string): Promise<DirectoryIdentity | "missing"> => {
  try {
    const metadata = await lstat(path, { bigint: true });
    if (!metadata.isDirectory()) throw new CatalogLockRecoveryError();
    return { device: metadata.dev, inode: metadata.ino };
  } catch (error) {
    if (isMissing(error)) return "missing";
    if (error instanceof CatalogLockRecoveryError) throw error;
    throw new CatalogLockRecoveryError({ cause: error });
  }
};

const sameDirectory = (left: DirectoryIdentity, right: DirectoryIdentity | "missing"): boolean =>
  right !== "missing" && left.device === right.device && left.inode === right.inode;

const inspectClaim = async (
  claimPath: string,
  retryChanged: boolean,
): Promise<"missing" | "pending" | "active"> => {
  const before = await inspectDirectory(claimPath);
  if (before === "missing") return "missing";
  let entries: string[];
  try {
    entries = await readdir(claimPath);
  } catch (error) {
    if (isMissing(error)) return "missing";
    throw new CatalogLockRecoveryError({ cause: error });
  }
  if (entries.length > 1 || (entries.length === 1 && entries[0] !== CLAIM_OWNER)) {
    throw new CatalogLockRecoveryError();
  }
  const owner =
    entries.length === 0 ? undefined : await inspectLockOwner(join(claimPath, CLAIM_OWNER));
  const after = await inspectDirectory(claimPath);
  if (!sameDirectory(before, after)) {
    if (after === "missing") return "missing";
    if (retryChanged) return inspectClaim(claimPath, false);
    throw new CatalogLockRecoveryError();
  }
  if (owner === undefined || owner.state === "missing" || owner.state === "unstable") {
    return "pending";
  }
  if (owner.state !== "regular" || owner.owner === undefined) {
    throw new CatalogLockRecoveryError();
  }
  if (ownerProcessState(owner.owner.pid) !== "alive") {
    throw new CatalogLockRecoveryError();
  }
  return "active";
};

export const inspectCanonicalRecoveryClaim = async (
  claimPath: string,
): Promise<"missing" | "active"> => {
  const deadline = Date.now() + CLAIM_CONVERGENCE_TIMEOUT_MS;
  while (true) {
    const state = await inspectClaim(claimPath, true);
    if (state !== "pending") return state;
    if (Date.now() >= deadline) throw new CatalogLockRecoveryError();
    await lockDelay(5);
  }
};
