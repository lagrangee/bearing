import { join } from "node:path";
import { CatalogLockRepairError } from "./errors";
import {
  createBoundChildDirectory,
  replaceBoundClaimOwner,
  restoreBoundClaimOwner,
  strictRemoveBoundEmptyDirectory,
} from "./lock-bound-owner";
import {
  type DirectoryGeneration,
  RECOVERY_CLAIM,
  RECOVERY_CLAIM_OWNER,
  type RecoveryClaim,
} from "./lock-recovery";
import type { RecoveryClaimDebris } from "./lock-repair-claim-plan";
import { recoveryRetiredPath } from "./lock-repair-residue";
import {
  assertOriginalOwnedLockRepairPlan,
  type ReadyOwnedLockRepairPlan,
} from "./owned-lock-repair-plan";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type RepairLeaseNames = Readonly<{
  claimRelease: string;
  stagedOwner: string;
}>;
type RepairLeaseLedger = {
  plan: ReadyOwnedLockRepairPlan;
  recovery?: DirectoryGeneration;
  createdRecovery: boolean;
  originalClaim?: RecoveryClaimDebris;
  stagedOwnerName?: string;
  createdClaim?: DirectoryGeneration;
  claim?: RecoveryClaim;
  names: RepairLeaseNames;
};
export type RepairLease = Readonly<{
  plan: ReadyOwnedLockRepairPlan;
  claim: RecoveryClaim;
  recovery: DirectoryGeneration;
  originalClaim?: RecoveryClaimDebris;
  stagedOwnerName?: string;
  rollback: () => Promise<void>;
}>;

const changed = (cause?: unknown): CatalogLockRepairError =>
  new CatalogLockRepairError("lock-changed", cause === undefined ? undefined : { cause });
const leaseNames = (token: string): RepairLeaseNames => ({
  claimRelease: `claim.${token}.release`,
  stagedOwner: `owner.${token}.staged`,
});

const assertNamesAvailable = (plan: ReadyOwnedLockRepairPlan, names: RepairLeaseNames): void => {
  if ([names.claimRelease, names.stagedOwner].some((name) => plan.recoveryEntries.includes(name))) {
    throw changed();
  }
};

const releaseCreatedClaim = async (ledger: RepairLeaseLedger): Promise<void> => {
  const claim = ledger.claim;
  const recovery = ledger.recovery;
  const createdClaim = ledger.createdClaim;
  if (recovery === undefined || createdClaim === undefined) return;
  if (claim !== undefined) {
    await restoreBoundClaimOwner(
      join(ledger.plan.location.lockRecovery, RECOVERY_CLAIM),
      createdClaim,
      recovery,
      RECOVERY_CLAIM_OWNER,
      claim.owner,
      ledger.names.stagedOwner,
      undefined,
    );
    delete ledger.claim;
  }
  await strictRemoveBoundEmptyDirectory(
    join(ledger.plan.location.lockRecovery, RECOVERY_CLAIM),
    join(ledger.plan.location.lockRecovery, ledger.names.claimRelease),
    createdClaim,
    recovery,
  );
  delete ledger.createdClaim;
};

const restoreOriginalClaim = async (ledger: RepairLeaseLedger): Promise<void> => {
  const original = ledger.originalClaim;
  const claim = ledger.claim;
  const recovery = ledger.recovery;
  if (original === undefined || claim === undefined || recovery === undefined) return;
  await restoreBoundClaimOwner(
    original.path,
    original.directory,
    recovery,
    RECOVERY_CLAIM_OWNER,
    claim.owner,
    ledger.names.stagedOwner,
    original.owner,
    original.ownerName ?? RECOVERY_CLAIM_OWNER,
  );
  delete ledger.claim;
};

const removeCreatedRecovery = async (ledger: RepairLeaseLedger): Promise<void> => {
  if (!ledger.createdRecovery || ledger.recovery === undefined) return;
  await strictRemoveBoundEmptyDirectory(
    ledger.plan.location.lockRecovery,
    recoveryRetiredPath(ledger.plan.location.lockRecovery),
    ledger.recovery,
    ledger.plan.directory,
  );
  ledger.createdRecovery = false;
};

const rollbackLedger = async (ledger: RepairLeaseLedger): Promise<void> => {
  const failures: unknown[] = [];
  const attempt = async (operation: () => Promise<void>): Promise<void> => {
    try {
      await operation();
    } catch (error) {
      failures.push(
        error instanceof Error
          ? error
          : new Error("Catalog lock repair rollback threw a non-Error value.", { cause: error }),
      );
    }
  };
  await attempt(() =>
    ledger.originalClaim === undefined ? releaseCreatedClaim(ledger) : restoreOriginalClaim(ledger),
  );
  await attempt(() => removeCreatedRecovery(ledger));
  if (failures.length !== 0) throw changed(new AggregateError(failures));
};

const acquireNewClaim = async (
  ledger: RepairLeaseLedger,
  token: string,
): Promise<RecoveryClaim> => {
  const recovery = ledger.recovery;
  if (recovery === undefined) throw changed();
  const claimPath = join(ledger.plan.location.lockRecovery, RECOVERY_CLAIM);
  const directory = await createBoundChildDirectory(
    ledger.plan.location.lockRecovery,
    recovery,
    claimPath,
    ledger.plan.directory,
  );
  ledger.createdClaim = directory;
  const owner = await replaceBoundClaimOwner(
    claimPath,
    directory,
    recovery,
    RECOVERY_CLAIM_OWNER,
    undefined,
    ledger.names.stagedOwner,
    { pid: process.pid, token },
  );
  const claim = { token, lock: ledger.plan.directory, recovery, directory, owner };
  ledger.claim = claim;
  return claim;
};

const acquireExistingClaim = async (
  ledger: RepairLeaseLedger,
  original: RecoveryClaimDebris,
  token: string,
): Promise<RecoveryClaim> => {
  const recovery = ledger.recovery;
  if (recovery === undefined) throw changed();
  const owner = await replaceBoundClaimOwner(
    original.path,
    original.directory,
    recovery,
    original.ownerName ?? RECOVERY_CLAIM_OWNER,
    original.owner,
    ledger.names.stagedOwner,
    { pid: process.pid, token },
    RECOVERY_CLAIM_OWNER,
  );
  const claim = {
    token,
    lock: ledger.plan.directory,
    recovery,
    directory: original.directory,
    owner,
  };
  ledger.claim = claim;
  return claim;
};

const acquireClaim = async (ledger: RepairLeaseLedger, token: string): Promise<RecoveryClaim> => {
  const original = ledger.originalClaim;
  return original === undefined
    ? acquireNewClaim(ledger, token)
    : acquireExistingClaim(ledger, original, token);
};

export const beginRepairLease = async (
  plan: ReadyOwnedLockRepairPlan,
  txToken: string,
): Promise<RepairLease> => {
  if (!UUID.test(txToken)) throw changed();
  const names = leaseNames(txToken);
  assertNamesAvailable(plan, names);
  await assertOriginalOwnedLockRepairPlan(plan);
  const originalClaim = plan.claims.find((claim) => claim.name === RECOVERY_CLAIM);
  const ledger: RepairLeaseLedger = {
    plan,
    createdRecovery: false,
    ...(originalClaim === undefined ? {} : { originalClaim }),
    ...(originalClaim?.owner === undefined ? {} : { stagedOwnerName: names.stagedOwner }),
    names,
  };
  try {
    ledger.recovery =
      plan.recovery ??
      (await createBoundChildDirectory(
        plan.location.lock,
        plan.directory,
        plan.location.lockRecovery,
        plan.parent,
      ));
    ledger.createdRecovery = plan.recovery === undefined;
    const claim = await acquireClaim(ledger, txToken);
    let rollbackTask: Promise<void> | undefined;
    const rollback = (): Promise<void> => {
      rollbackTask ??= rollbackLedger(ledger).catch((error) => {
        rollbackTask = undefined;
        throw error;
      });
      return rollbackTask;
    };
    return {
      plan,
      claim,
      recovery: ledger.recovery,
      ...(originalClaim === undefined ? {} : { originalClaim }),
      ...(ledger.stagedOwnerName === undefined ? {} : { stagedOwnerName: ledger.stagedOwnerName }),
      rollback,
    };
  } catch (error) {
    try {
      await rollbackLedger(ledger);
    } catch (rollbackError) {
      const rollbackCause =
        rollbackError instanceof Error
          ? rollbackError
          : new Error("Catalog lock repair rollback threw a non-Error value.", {
              cause: rollbackError,
            });
      throw changed(new AggregateError([error, rollbackCause]));
    }
    throw error instanceof CatalogLockRepairError ? error : changed(error);
  }
};
