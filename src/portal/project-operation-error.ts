import {
  CatalogEntryOwnershipError,
  CatalogLockError,
  CatalogLockRecoveryError,
  CatalogRecoveryRequiredError,
} from "../catalog/errors";
import type { ProjectOperationError } from "./project-contract";
import { ProjectMaterializerError } from "./project-materializer";

export const operationError = (error: unknown): ProjectOperationError => {
  const catalogValidationFailed =
    error instanceof CatalogLockError ||
    error instanceof CatalogLockRecoveryError ||
    error instanceof CatalogEntryOwnershipError ||
    error instanceof CatalogRecoveryRequiredError;
  const code =
    error instanceof ProjectMaterializerError
      ? error.code
      : catalogValidationFailed
        ? "input-validation-failed"
        : "sync-failed";
  const messages: Readonly<Record<ProjectOperationError["code"], string>> = {
    "request-failed": "Portal request failed.",
    "project-unavailable": "The registered project is currently unavailable.",
    "unsafe-project-cache": "The project cache boundary is unsafe.",
    "input-validation-failed": "Project inputs could not be validated.",
    "sync-failed": "Project reconciliation failed.",
    "snapshot-materialization-failed": "Project Snapshot materialization failed.",
    "snapshot-write-failed": "Project cache could not be saved.",
  };
  return { code, message: messages[code] };
};
