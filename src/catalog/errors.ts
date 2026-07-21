export class CatalogLockError extends Error {
  public constructor() {
    super("Project Catalog is busy; retry after the active writer finishes.");
    this.name = "CatalogLockError";
  }
}

export class CatalogLockRecoveryError extends Error {
  public readonly code = "catalog-lock-indeterminate";
  public readonly repair: string;

  public constructor(options?: ErrorOptions, repair = "inspect-and-confirm-catalog-lock-repair") {
    super(`Project Catalog lock ownership is indeterminate; use ${repair}.`, options);
    this.name = "CatalogLockRecoveryError";
    this.repair = repair;
  }
}

export type CatalogLockRepairRefusal =
  | "confirmation-required"
  | "live-owner"
  | "indeterminate-owner"
  | "nonempty-owner-directory"
  | "unsafe-lock"
  | "lock-changed"
  | "committed-with-residue";

const lockRepairMessage = (reason: CatalogLockRepairRefusal): string => {
  if (reason === "confirmation-required") {
    return "Catalog lock repair requires explicit abandoned-lock confirmation.";
  }
  if (reason === "live-owner") {
    return "Project Catalog lock has a live owner and cannot be repaired.";
  }
  if (reason === "indeterminate-owner") {
    return "Project Catalog lock owner cannot be proven absent.";
  }
  if (reason === "nonempty-owner-directory") {
    return "Project Catalog lock owner directory is not empty and cannot be repaired automatically.";
  }
  if (reason === "unsafe-lock") {
    return "Project Catalog lock directory is not an exact safe repair target.";
  }
  if (reason === "committed-with-residue") {
    return "Project Catalog lock repair committed its quarantine but left exact repair residue; rerun confirmed repair.";
  }
  return "Project Catalog lock changed during repair; no further artifacts were removed.";
};

export class CatalogLockRepairError extends Error {
  public readonly code = "catalog-lock-repair-refused";

  public constructor(
    public readonly reason: CatalogLockRepairRefusal,
    options?: ErrorOptions,
  ) {
    super(lockRepairMessage(reason), options);
    this.name = "CatalogLockRepairError";
  }
}

export class CatalogRecoveryRequiredError extends Error {
  public constructor(message = "Project Catalog requires explicit repair or confirmed reset.") {
    super(message);
    this.name = "CatalogRecoveryRequiredError";
  }
}

export class CatalogEntryNotFoundError extends Error {
  public constructor(entryId: string) {
    super(`Project Catalog entry does not exist: ${entryId}`);
    this.name = "CatalogEntryNotFoundError";
  }
}

export class CatalogDuplicateRepositoryError extends Error {
  public constructor() {
    super("Another Project Catalog entry already owns that repository path.");
    this.name = "CatalogDuplicateRepositoryError";
  }
}

export class CatalogMoveConfirmationRequiredError extends Error {
  public constructor() {
    super("The existing repository is still available; explicit move confirmation is required.");
    this.name = "CatalogMoveConfirmationRequiredError";
  }
}

export class CatalogEntryOwnershipError extends Error {
  public readonly code = "catalog-entry-ownership-changed";

  public constructor() {
    super("Project Catalog entry no longer owns the expected repository path.");
    this.name = "CatalogEntryOwnershipError";
  }
}
