import { catalogLocationFor, validateCatalogLocation } from "./location";
import { type OwnedLockRepairResult, repairOwnedLock } from "./owned-lock-repair";

export type CatalogLockRepairResult = OwnedLockRepairResult;
type CatalogLockRepair = (options: {
  readonly homeDir: string;
  readonly confirmed: boolean;
}) => Promise<CatalogLockRepairResult>;

export const repairCatalogLock: CatalogLockRepair = async (options) => {
  const location = catalogLocationFor(options.homeDir);
  return repairOwnedLock({
    confirmed: options.confirmed,
    location,
    validate: () => validateCatalogLocation(options.homeDir, location),
  });
};
