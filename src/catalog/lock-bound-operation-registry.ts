type BoundOperationDescriptor<Operation extends string> = Readonly<{
  operation: Operation;
  handler: string;
  failure: "mutation" | "reservation";
}>;

const operation = <const Operation extends string>(
  name: Operation,
  handler: string,
  failure: "mutation" | "reservation" = "mutation",
): BoundOperationDescriptor<Operation> => ({ operation: name, handler, failure });

export const boundOperationDescriptors = {
  write: operation("write", "writeOwnerOperation"),
  confirm: operation("confirm", "confirmOwner"),
  reserve: operation("reserve", "reserve", "reservation"),
  quarantine: operation("quarantine", "quarantineCandidate"),
  tombstone: operation("tombstone", "tombstoneOwner"),
  retire: operation("retire", "retire"),
  remove: operation("remove", "remove"),
  "quarantine-file": operation("quarantine-file", "quarantineOwnerFile"),
  "remove-file": operation("remove-file", "removeOwnerFile"),
  mkdir: operation("mkdir", "mkdirChild", "reservation"),
  "quarantine-entries": operation("quarantine-entries", "quarantineEntries"),
  "quarantine-entry": operation("quarantine-entry", "quarantineEntry"),
  "remove-entry": operation("remove-entry", "removeEntry"),
  publish: operation("publish", "publishCandidate", "reservation"),
  "replace-owner": operation("replace-owner", "replaceClaimOwner"),
  "restore-owner": operation("restore-owner", "restoreClaimOwner"),
} as const;

export type BoundOperation = keyof typeof boundOperationDescriptors;

export const boundOperationDescriptor = (
  name: BoundOperation,
): (typeof boundOperationDescriptors)[BoundOperation] => boundOperationDescriptors[name];

const registrations = Object.values(boundOperationDescriptors)
  .map((descriptor) => `  ${JSON.stringify(descriptor.operation)}: ${descriptor.handler},`)
  .join("\n");

export const boundOperationDispatchSource = `
const boundOperations = {
${registrations}
};
const dispatchBoundOperation = () => {
  const operation = boundOperations[request.operation];
  if (operation === undefined) throw new Error("unknown-operation");
  return operation();
};
`;
