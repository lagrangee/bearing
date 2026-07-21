import { randomUUID } from "node:crypto";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { CatalogLockRecoveryError, CatalogLockRepairError } from "./errors";
import { strictRetireBoundLockCandidate } from "./lock-bound-owner";
import { isBoundOwnerTombstoneName } from "./lock-bound-retire";
import { inspectLockOwner } from "./lock-owner";
import {
  type DirectoryGeneration,
  inspectDirectoryPath,
  RECOVERY_CLAIM,
  RECOVERY_CLAIM_OWNER,
  sameDirectoryGeneration,
} from "./lock-recovery";
import { lockDelay } from "./lock-support";

type Location = Readonly<{ lockRecovery: string }>;

const CLAIM_ARTIFACT =
  /^claim\.[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:tmp|release|abandoned)$/i;
const DETACHED_CONVERGENCE_TIMEOUT_MS = 1_000;
export const isRecoveryClaimCandidateName = (name: string): boolean => CLAIM_ARTIFACT.test(name);
export const isRecoveryClaimArtifactName = (name: string): boolean =>
  name === RECOVERY_CLAIM || isRecoveryClaimCandidateName(name);
const changed = (cause?: unknown): CatalogLockRepairError =>
  new CatalogLockRepairError("lock-changed", cause === undefined ? undefined : { cause });

const clearDetachedCandidate = async (
  location: Location,
  parent: DirectoryGeneration,
  candidate: Readonly<{ path: string; directory: DirectoryGeneration }>,
): Promise<void> => {
  const deadline = Date.now() + DETACHED_CONVERGENCE_TIMEOUT_MS;
  while (true) {
    const current = await inspectDirectoryPath(candidate.path);
    if (current.state === "missing") return;
    if (
      current.state !== "directory" ||
      !sameDirectoryGeneration(candidate.directory, current.generation)
    ) {
      throw changed();
    }
    const entries = await readdir(candidate.path).catch((error) => {
      throw changed(error);
    });
    if (
      entries.length > 1 ||
      (entries.length === 1 &&
        entries[0] !== RECOVERY_CLAIM_OWNER &&
        !isBoundOwnerTombstoneName(entries[0] ?? ""))
    ) {
      throw new CatalogLockRepairError("unsafe-lock");
    }
    const ownerName = entries[0];
    const owner =
      ownerName === undefined ? undefined : await inspectLockOwner(join(candidate.path, ownerName));
    if (owner?.state === "unsafe") throw new CatalogLockRepairError("unsafe-lock");
    if (owner === undefined || owner.state === "regular") {
      const destination = join(location.lockRecovery, `claim.${randomUUID()}.abandoned`);
      try {
        await strictRetireBoundLockCandidate(
          candidate.path,
          destination,
          candidate.directory,
          ownerName ?? RECOVERY_CLAIM_OWNER,
          owner,
          parent,
        );
        return;
      } catch (error) {
        if (!(error instanceof CatalogLockRecoveryError)) throw error;
        const [source, moved] = await Promise.all([
          inspectDirectoryPath(candidate.path),
          inspectDirectoryPath(destination),
        ]);
        if (source.state === "missing" && moved.state === "missing") return;
        if (
          source.state !== "directory" ||
          !sameDirectoryGeneration(candidate.directory, source.generation) ||
          moved.state !== "missing"
        ) {
          throw changed(error);
        }
      }
    }
    if (Date.now() >= deadline) throw changed();
    await lockDelay(5);
  }
};

export const clearDetachedRecoveryClaimCandidates = async (location: Location): Promise<void> => {
  const parent = await inspectDirectoryPath(location.lockRecovery);
  if (parent.state !== "directory") throw new CatalogLockRepairError("unsafe-lock");
  const entries = await readdir(location.lockRecovery).catch((error) => {
    throw changed(error);
  });
  const confirmed = await inspectDirectoryPath(location.lockRecovery);
  if (
    confirmed.state !== "directory" ||
    !sameDirectoryGeneration(parent.generation, confirmed.generation)
  ) {
    throw changed();
  }
  for (const name of entries.filter(isRecoveryClaimCandidateName)) {
    const path = join(location.lockRecovery, name);
    const candidate = await inspectDirectoryPath(path);
    if (candidate.state === "missing") continue;
    if (candidate.state !== "directory") throw new CatalogLockRepairError("unsafe-lock");
    await clearDetachedCandidate(location, parent.generation, {
      path,
      directory: candidate.generation,
    });
  }
};
