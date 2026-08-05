export class CatalogBusyError extends Error {
  readonly code = "catalog-busy";

  constructor(options?: ErrorOptions) {
    super("Project Catalog is busy; retry after the current writer finishes.", options);
    this.name = "CatalogBusyError";
  }
}

export class CatalogRecoveryRequiredError extends Error {
  public constructor(
    message = "Project Catalog is unavailable; confirmed reset and Setup re-registration are required.",
    options?: ErrorOptions,
  ) {
    super(message, options);
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
