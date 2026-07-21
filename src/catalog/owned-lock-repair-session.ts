import { randomUUID } from "node:crypto";
import { basename, dirname, join, relative } from "node:path";
import { CatalogLockRepairError } from "./errors";
import type { OwnedLockLocation } from "./lock";
import { createLockToken, quarantineLockPath } from "./lock-artifact-name";
import {
  BoundLockMutationError,
  strictQuarantineBoundDirectory,
  strictRemoveBoundEmptyDirectory,
  strictRemoveBoundOwnerFile,
  strictRetireBoundEntry,
  strictRetireBoundLockCandidate,
} from "./lock-bound-owner";
import { RECOVERY_CLAIM_OWNER, releaseRecoveryClaim } from "./lock-recovery";
import { recoveryRetiredPath } from "./lock-repair-residue";
import { beginRepairLease, type RepairLease } from "./owned-lock-repair-lease";
import {
  assertOwnedLockRepairSelection,
  type ReadyOwnedLockRepairSelection,
} from "./owned-lock-repair-namespace";
import type { RepairTarget } from "./owned-lock-repair-target";
import { type ValidatedRepairLease, validateRepairLease } from "./owned-lock-repair-validation";

type QuarantinedRepairRoot = Readonly<{
  validated: ValidatedRepairLease;
  original: OwnedLockLocation;
  quarantined: OwnedLockLocation;
}>;

const changed = (cause?: unknown): CatalogLockRepairError =>
  new CatalogLockRepairError("lock-changed", cause === undefined ? undefined : { cause });
const residue = (cause?: unknown): CatalogLockRepairError =>
  new CatalogLockRepairError("committed-with-residue", cause === undefined ? undefined : { cause });
const movedLocation = (location: OwnedLockLocation, lock: string): OwnedLockLocation => ({
  lock,
  lockOwner: join(lock, basename(location.lockOwner)),
  lockRecovery: join(lock, basename(location.lockRecovery)),
});

const validate = async (
  selection: ReadyOwnedLockRepairSelection,
  lease: RepairLease,
): Promise<ValidatedRepairLease> => {
  const guardPresent = selection.guardLocation !== undefined;
  await assertOwnedLockRepairSelection(selection, guardPresent);
  const result = await validateRepairLease(lease);
  await assertOwnedLockRepairSelection(selection, guardPresent);
  return result;
};

const restoreCommittedMove = async (root: QuarantinedRepairRoot): Promise<void> => {
  await strictQuarantineBoundDirectory(
    root.quarantined.lock,
    root.original.lock,
    root.validated.lease.plan.directory,
    root.validated.lease.plan.parent,
    root.validated.lockEntries,
  );
};

const quarantine = async (validated: ValidatedRepairLease): Promise<QuarantinedRepairRoot> => {
  const original = validated.lease.plan.location;
  const quarantined = movedLocation(original, quarantineLockPath(original.lock, createLockToken()));
  const root = { validated, original, quarantined };
  try {
    await strictQuarantineBoundDirectory(
      original.lock,
      quarantined.lock,
      validated.lease.plan.directory,
      validated.lease.plan.parent,
      validated.lockEntries,
    );
    return root;
  } catch (error) {
    if (error instanceof BoundLockMutationError && error.mutationMayHaveCommitted) {
      try {
        await restoreCommittedMove(root);
      } catch (restoreError) {
        const restoreCause =
          restoreError instanceof Error
            ? restoreError
            : new Error("Catalog lock repair restore threw a non-Error value.", {
                cause: restoreError,
              });
        throw residue(new AggregateError([error, restoreCause]));
      }
    }
    throw changed(error);
  }
};

const translatedPath = (root: QuarantinedRepairRoot, path: string): string =>
  join(root.quarantined.lock, relative(root.original.lock, path));

const removeTarget = async (root: QuarantinedRepairRoot, target: RepairTarget): Promise<void> => {
  const path = translatedPath(root, target.path);
  const container = dirname(path);
  const inRecovery = container === root.quarantined.lockRecovery;
  const containerGeneration = inRecovery
    ? root.validated.lease.recovery
    : root.validated.lease.plan.directory;
  const parentGeneration = inRecovery
    ? root.validated.lease.plan.directory
    : root.validated.lease.plan.parent;
  if (target.node.safeRegular !== undefined) {
    await strictRemoveBoundOwnerFile(
      container,
      containerGeneration,
      basename(path),
      target.node.safeRegular,
      parentGeneration,
    );
    return;
  }
  await strictRetireBoundEntry(
    container,
    containerGeneration,
    basename(path),
    target.node,
    parentGeneration,
  );
};

const drainClaims = async (root: QuarantinedRepairRoot): Promise<void> => {
  for (const claim of root.validated.claimsToDrain) {
    const path = join(root.quarantined.lockRecovery, claim.name);
    await strictRetireBoundLockCandidate(
      path,
      join(root.quarantined.lockRecovery, `claim.${randomUUID()}.abandoned`),
      claim.directory,
      claim.ownerName ?? RECOVERY_CLAIM_OWNER,
      claim.owner,
      root.validated.lease.recovery,
    );
  }
};

const drainStagedOwner = async (root: QuarantinedRepairRoot): Promise<void> => {
  const { originalClaim, stagedOwnerName } = root.validated.lease;
  if (originalClaim?.owner === undefined || stagedOwnerName === undefined) return;
  await strictRemoveBoundOwnerFile(
    root.quarantined.lockRecovery,
    root.validated.lease.recovery,
    stagedOwnerName,
    originalClaim.owner,
    root.validated.lease.plan.directory,
  );
};

const drain = async (root: QuarantinedRepairRoot): Promise<void> => {
  const failures: Error[] = [];
  try {
    for (const target of root.validated.lease.plan.targets) await removeTarget(root, target);
    await drainStagedOwner(root);
    await drainClaims(root);
  } catch (error) {
    failures.push(
      error instanceof Error
        ? error
        : new Error("Catalog lock repair drain threw a non-Error value.", { cause: error }),
    );
  }
  try {
    await releaseRecoveryClaim(root.quarantined, root.validated.lease.claim);
  } catch (error) {
    failures.push(
      error instanceof Error
        ? error
        : new Error("Catalog lock repair claim release threw a non-Error value.", {
            cause: error,
          }),
    );
  }
  if (failures.length === 1) throw residue(failures[0]);
  if (failures.length > 1) throw residue(new AggregateError(failures));
  await strictRemoveBoundEmptyDirectory(
    root.quarantined.lockRecovery,
    recoveryRetiredPath(root.quarantined.lockRecovery),
    root.validated.lease.recovery,
    root.validated.lease.plan.directory,
  ).catch((error) => {
    throw residue(error);
  });
  await strictRemoveBoundEmptyDirectory(
    root.quarantined.lock,
    quarantineLockPath(root.original.lock, createLockToken()),
    root.validated.lease.plan.directory,
    root.validated.lease.plan.parent,
  ).catch((error) => {
    throw residue(error);
  });
};

export const repairOwnedLockGeneration = async (
  selection: ReadyOwnedLockRepairSelection,
): Promise<void> => {
  const guardPresent = selection.guardLocation !== undefined;
  await assertOwnedLockRepairSelection(selection, guardPresent);
  const lease = await beginRepairLease(selection.target, randomUUID());
  let committed = false;
  try {
    const validated = await validate(selection, lease);
    const root = await quarantine(validated);
    committed = true;
    await drain(root);
  } catch (error) {
    if (
      committed ||
      (error instanceof CatalogLockRepairError && error.reason === "committed-with-residue")
    ) {
      throw residue(error);
    }
    try {
      await lease.rollback();
    } catch (rollbackError) {
      const rollbackCause =
        rollbackError instanceof Error
          ? rollbackError
          : new Error("Catalog lock repair rollback threw a non-Error value.", {
              cause: rollbackError,
            });
      throw changed(new AggregateError([error, rollbackCause]));
    }
    throw changed(error);
  }
};
