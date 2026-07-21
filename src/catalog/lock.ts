import { CatalogLockError, CatalogLockRecoveryError } from "./errors";
import type { CatalogLocation } from "./location";
import { type OwnedLockGenerationOwner, retireOwnedLockGeneration } from "./lock-generation";
import {
  createInitializedLock,
  type InitializedLockGeneration,
  type OwnedLockInitializerHooks,
} from "./lock-initializer";
import * as lockOwner from "./lock-owner";
import * as recovery from "./lock-recovery";
import { hasErrorCode, lockDelay } from "./lock-support";

class CatalogLockOwnerPendingError extends Error {}
class CatalogLockContentionError extends Error {}
const RELEASE_TIMEOUT_MS = 1_000;

export type OwnedLockLocation = Pick<CatalogLocation, "lock" | "lockOwner" | "lockRecovery">;
export type OwnedLockHooks = OwnedLockInitializerHooks &
  Readonly<{
    afterRecoveryContainerReady?: (phase: "reclaim" | "release") => Promise<void>;
    afterRecoveryAcquired?: (phase: "reclaim" | "release") => Promise<void>;
    afterRecoveryContention?: (phase: "release") => Promise<void>;
    afterRecoveryClaim?: (phase: "reclaim" | "release") => Promise<void>;
    beforeLockQuarantine?: (phase: "reclaim" | "release") => Promise<void>;
  }>;

type LockGeneration = InitializedLockGeneration;

const readOwnerAt = async (target: string): Promise<OwnedLockGenerationOwner> => {
  const artifact = await lockOwner.inspectLockOwner(target);
  if (artifact.state === "missing" || artifact.state === "unstable") {
    throw new CatalogLockOwnerPendingError();
  }
  if (artifact.state !== "regular") throw new CatalogLockRecoveryError();
  if (artifact.owner === undefined) throw new CatalogLockOwnerPendingError();
  return { ...artifact, owner: artifact.owner };
};

const releaseClaim = async (
  location: OwnedLockLocation,
  claim: recovery.RecoveryClaim | undefined,
  primaryFailure?: unknown,
): Promise<void> => {
  if (claim === undefined) return;
  try {
    await recovery.releaseRecoveryClaim(location, claim);
  } catch (releaseFailure) {
    if (primaryFailure === undefined) throw releaseFailure;
    throw new CatalogLockRecoveryError({
      cause: new AggregateError(
        [primaryFailure, releaseFailure],
        "Catalog lock operation and recovery-claim release both failed.",
      ),
    });
  }
};

const reclaimDeadOwner = async (
  location: OwnedLockLocation,
  hooks: OwnedLockHooks,
): Promise<boolean> => {
  const observed = await recovery.inspectDirectoryPath(location.lock);
  if (observed.state === "missing") return true;
  if (observed.state === "unsafe") throw new CatalogLockRecoveryError();
  const directory = observed.generation;
  const claimRecovery = () =>
    recovery.tryClaimRecovery(
      location,
      directory,
      () => hooks.afterRecoveryContainerReady?.("reclaim") ?? Promise.resolve(),
      "transient",
    );
  let candidateOwner: OwnedLockGenerationOwner;
  try {
    candidateOwner = await readOwnerAt(location.lockOwner);
  } catch (error) {
    if (!(error instanceof CatalogLockOwnerPendingError)) throw error;
    const pendingClaim = await claimRecovery();
    if (pendingClaim === undefined) throw new CatalogLockContentionError();
    await releaseClaim(location, pendingClaim);
    throw error;
  }
  const candidateState = lockOwner.ownerProcessState(candidateOwner.owner.pid);
  if (candidateState === "alive") return false;
  if (candidateState === "indeterminate") throw new CatalogLockRecoveryError();
  const claim = await claimRecovery();
  if (claim === undefined) throw new CatalogLockContentionError();
  let claimHeld = true;
  let primaryFailure: unknown;
  try {
    await hooks.afterRecoveryAcquired?.("reclaim");
    const owner = await readOwnerAt(location.lockOwner);
    const currentDirectory = await recovery.inspectDirectoryGeneration(location.lock);
    if (
      !lockOwner.sameOwnerArtifact(candidateOwner, owner) ||
      !recovery.sameDirectoryGeneration(directory, currentDirectory)
    ) {
      throw new CatalogLockRecoveryError();
    }
    const state = lockOwner.ownerProcessState(owner.owner.pid);
    if (state === "alive") return false;
    if (state === "indeterminate") throw new CatalogLockRecoveryError();
    await retireOwnedLockGeneration(
      location,
      directory,
      claim,
      owner,
      () => hooks.afterRecoveryClaim?.("reclaim") ?? Promise.resolve(),
      () => hooks.beforeLockQuarantine?.("reclaim") ?? Promise.resolve(),
    );
    claimHeld = false;
    return true;
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return true;
    primaryFailure = error;
    throw error;
  } finally {
    if (claimHeld) await releaseClaim(location, claim, primaryFailure);
  }
};

const acquireLock = async (
  location: OwnedLockLocation,
  timeoutMs: number,
  hooks: OwnedLockHooks,
): Promise<LockGeneration> => {
  const deadline = Date.now() + Math.max(0, timeoutMs);
  while (true) {
    const observed = await recovery.inspectDirectoryPath(location.lock);
    if (observed.state === "unsafe") throw new CatalogLockRecoveryError();
    const created =
      observed.state === "missing" ? await createInitializedLock(location, hooks) : undefined;
    if (created !== undefined) return created;
    try {
      if (await reclaimDeadOwner(location, hooks)) continue;
    } catch (error) {
      if (error instanceof CatalogLockOwnerPendingError) {
        if (Date.now() >= deadline) throw new CatalogLockRecoveryError({ cause: error });
      } else if (!(error instanceof CatalogLockContentionError)) {
        throw error;
      }
    }
    if (Date.now() >= deadline) throw new CatalogLockError();
    await lockDelay(Math.min(20, Math.max(1, deadline - Date.now())));
  }
};

const releaseLock = async (
  location: OwnedLockLocation,
  generation: LockGeneration,
  timeoutMs: number,
  hooks: OwnedLockHooks,
): Promise<void> => {
  const deadline = Date.now() + Math.max(RELEASE_TIMEOUT_MS, timeoutMs);
  let claim = await recovery.tryClaimRecovery(
    location,
    generation.directory,
    () => hooks.afterRecoveryContainerReady?.("release") ?? Promise.resolve(),
  );
  while (claim === undefined) {
    await hooks.afterRecoveryContention?.("release");
    if (Date.now() >= deadline) throw new CatalogLockRecoveryError();
    await lockDelay(Math.min(20, Math.max(1, deadline - Date.now())));
    claim = await recovery.tryClaimRecovery(
      location,
      generation.directory,
      () => hooks.afterRecoveryContainerReady?.("release") ?? Promise.resolve(),
    );
  }
  let claimHeld = true;
  let primaryFailure: unknown;
  try {
    await hooks.afterRecoveryAcquired?.("release");
    await retireOwnedLockGeneration(
      location,
      generation.directory,
      claim,
      generation.owner,
      () => hooks.afterRecoveryClaim?.("release") ?? Promise.resolve(),
      () => hooks.beforeLockQuarantine?.("release") ?? Promise.resolve(),
    );
    claimHeld = false;
  } catch (error) {
    primaryFailure = error;
    throw error;
  } finally {
    if (claimHeld) await releaseClaim(location, claim, primaryFailure);
  }
};

export type OwnedLockHandle = Readonly<{ release: () => Promise<void> }>;

const ownedLockHandle = (
  location: OwnedLockLocation,
  generation: LockGeneration,
  timeoutMs: number,
  hooks: OwnedLockHooks,
): OwnedLockHandle => {
  let released = false;
  return {
    release: async () => {
      if (released) return;
      await releaseLock(location, generation, timeoutMs, hooks);
      released = true;
    },
  };
};

export const tryCreateOwnedLock = async (
  location: OwnedLockLocation,
  timeoutMs: number,
  hooks: OwnedLockHooks = {},
): Promise<OwnedLockHandle | undefined> => {
  const generation = await createInitializedLock(location, hooks);
  return generation === undefined
    ? undefined
    : ownedLockHandle(location, generation, timeoutMs, hooks);
};

export const acquireOwnedLock = async (
  location: OwnedLockLocation,
  timeoutMs: number,
  hooks: OwnedLockHooks = {},
): Promise<OwnedLockHandle> => {
  const generation = await acquireLock(location, timeoutMs, hooks);
  return ownedLockHandle(location, generation, timeoutMs, hooks);
};

export const createOwnedLock =
  (hooks: OwnedLockHooks = {}) =>
  async <Result>(
    location: OwnedLockLocation,
    timeoutMs: number,
    operation: () => Promise<Result>,
  ): Promise<Result> => {
    const handle = await acquireOwnedLock(location, timeoutMs, hooks);
    try {
      return await operation();
    } finally {
      await handle.release();
    }
  };

export const createCooperativeLock = createOwnedLock;
export const withCatalogLock = createOwnedLock();
