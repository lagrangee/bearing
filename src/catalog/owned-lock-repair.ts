import { CatalogLockRepairError } from "./errors";
import { type OwnedLockHandle, type OwnedLockLocation, tryCreateOwnedLock } from "./lock";
import {
  assertOwnedLockRepairSelection,
  type OwnedLockRepairSelection,
  prepareOwnedLockRepairSelection,
} from "./owned-lock-repair-namespace";
import { repairOwnedLockGeneration } from "./owned-lock-repair-session";

export type OwnedLockRepairResult = Readonly<{ outcome: "applied" | "no-op" }>;
type OwnedLockRepairOptions = Readonly<{
  confirmed: boolean;
  location: OwnedLockLocation;
  validate: () => Promise<void>;
}>;

const changed = (cause?: unknown): CatalogLockRepairError =>
  new CatalogLockRepairError("lock-changed", cause === undefined ? undefined : { cause });
const residue = (cause?: unknown): CatalogLockRepairError =>
  new CatalogLockRepairError("committed-with-residue", cause === undefined ? undefined : { cause });

const releaseGuard = async (guard: OwnedLockHandle | undefined): Promise<void> => {
  if (guard !== undefined) await guard.release();
};

const repairSelection = async (
  selection: OwnedLockRepairSelection,
): Promise<OwnedLockRepairResult> => {
  if (selection.state === "no-op") return { outcome: "no-op" };
  let guard: OwnedLockHandle | undefined;
  try {
    await assertOwnedLockRepairSelection(selection, false);
    if (selection.guardLocation !== undefined) {
      guard = await tryCreateOwnedLock(selection.guardLocation, 0);
      if (guard === undefined) throw changed();
    }
    await repairOwnedLockGeneration(selection);
  } catch (error) {
    const committed =
      error instanceof CatalogLockRepairError && error.reason === "committed-with-residue";
    try {
      await releaseGuard(guard);
      guard = undefined;
    } catch (releaseError) {
      const releaseCause =
        releaseError instanceof Error
          ? releaseError
          : new Error("Catalog lock repair guard release threw a non-Error value.", {
              cause: releaseError,
            });
      throw committed
        ? residue(new AggregateError([error, releaseCause]))
        : changed(new AggregateError([error, releaseCause]));
    }
    throw committed ? error : changed(error);
  }
  try {
    await releaseGuard(guard);
  } catch (error) {
    throw residue(
      error instanceof Error
        ? error
        : new Error("Catalog lock repair guard release threw a non-Error value.", { cause: error }),
    );
  }
  return { outcome: "applied" };
};

export const repairOwnedLock = async (
  options: OwnedLockRepairOptions,
): Promise<OwnedLockRepairResult> => {
  if (!options.confirmed) throw new CatalogLockRepairError("confirmation-required");
  const selection = await prepareOwnedLockRepairSelection(options);
  return repairSelection(selection);
};
