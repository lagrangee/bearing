import { catalogEntryLeaseLocationFor, validateCatalogEntryLeaseLocation } from "./location";
import { type OwnedLockRepairResult, repairOwnedLock } from "./owned-lock-repair";

export type CatalogEntryLockRepairResult = OwnedLockRepairResult;
type CatalogEntryLockRepairOptions = Readonly<{
  homeDir: string;
  entryId: string;
  confirmed: boolean;
}>;

export const repairCatalogEntryLock = async (
  options: CatalogEntryLockRepairOptions,
): Promise<CatalogEntryLockRepairResult> => {
  const location = catalogEntryLeaseLocationFor(options.homeDir, options.entryId);
  return repairOwnedLock({
    confirmed: options.confirmed,
    location,
    validate: () => validateCatalogEntryLeaseLocation(options.homeDir, location),
  });
};
