import { lstat, readdir } from "node:fs/promises";
import { join } from "node:path";
import { CatalogLockRecoveryError } from "./errors";
import { isBoundOwnerTombstoneName } from "./lock-bound-retire";
import { inspectLockOwner } from "./lock-owner";
import { isRecoveryClaimCandidateName } from "./lock-repair-claim";
import { lockDelay } from "./lock-support";

const CLAIM_OWNER = "owner.json";
const CONVERGENCE_TIMEOUT_MS = 1_000;

const isMissing = (error: unknown): boolean =>
  error instanceof Error && "code" in error && error.code === "ENOENT";

const exact = (actual: readonly string[], expected: readonly string[]): boolean => {
  const sorted = [...expected].sort();
  return actual.length === sorted.length && actual.every((entry, index) => entry === sorted[index]);
};

type CandidateShape = "missing" | "pending" | "safe";

const inspectCandidate = async (recovery: string, name: string): Promise<CandidateShape> => {
  const path = join(recovery, name);
  const metadata = await lstat(path, { bigint: true }).catch((error) => {
    if (isMissing(error)) return undefined;
    throw new CatalogLockRecoveryError({ cause: error });
  });
  if (metadata === undefined) return "missing";
  if (!metadata.isDirectory()) throw new CatalogLockRecoveryError();
  const entries = await readdir(path).catch((error) => {
    if (isMissing(error)) return undefined;
    throw new CatalogLockRecoveryError({ cause: error });
  });
  if (entries === undefined) return "missing";
  if (
    entries.length > 1 ||
    (entries.length === 1 &&
      entries[0] !== CLAIM_OWNER &&
      !isBoundOwnerTombstoneName(entries[0] ?? ""))
  ) {
    throw new CatalogLockRecoveryError();
  }
  const ownerName = entries[0];
  if (ownerName === undefined) return "safe";
  const owner = await inspectLockOwner(join(path, ownerName));
  if (owner.state === "missing" || owner.state === "unstable") return "pending";
  if (owner.state !== "regular") throw new CatalogLockRecoveryError();
  return "safe";
};

export const waitForOwnedLockShape = async (
  lock: string,
  recovery: string,
  expectedLock: readonly string[],
  expectedRecovery: readonly string[],
): Promise<void> => {
  const deadline = Date.now() + CONVERGENCE_TIMEOUT_MS;
  while (true) {
    const lockEntries = await readdir(lock).catch((error) => {
      throw new CatalogLockRecoveryError({ cause: error });
    });
    const recoveryEntries = await readdir(recovery).catch((error) => {
      throw new CatalogLockRecoveryError({ cause: error });
    });
    lockEntries.sort();
    recoveryEntries.sort();
    if (exact(lockEntries, expectedLock) && exact(recoveryEntries, expectedRecovery)) return;
    if (!exact(lockEntries, expectedLock)) throw new CatalogLockRecoveryError();
    const extras = recoveryEntries.filter((entry) => !expectedRecovery.includes(entry));
    if (extras.length === 0 || extras.some((entry) => !isRecoveryClaimCandidateName(entry))) {
      throw new CatalogLockRecoveryError();
    }
    const shapes = await Promise.all(extras.map((entry) => inspectCandidate(recovery, entry)));
    if (shapes.includes("missing")) continue;
    if (!shapes.includes("pending")) return;
    if (Date.now() >= deadline) throw new CatalogLockRecoveryError();
    await lockDelay(5);
  }
};
