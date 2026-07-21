import type { AvailableProjectEntry } from "./project-entry";
import type { ProjectWriteAuthorizer } from "./project-materializer";

export type ProjectOperationExecutor = <Result>(
  operation: (authorizeWrites: ProjectWriteAuthorizer) => Promise<Result>,
) => Promise<Result>;
export type ProjectOperationExecutorFactory = (
  entry: AvailableProjectEntry,
) => ProjectOperationExecutor;

const denyWrites: ProjectWriteAuthorizer = async () => {
  throw new Error("Project Catalog write authorization is unavailable.");
};

export const authorizeWritesDirectly: ProjectWriteAuthorizer = (_phase, operation) => operation();

export const executeWithWritesDenied: ProjectOperationExecutorFactory = () => async (operation) =>
  operation(denyWrites);
