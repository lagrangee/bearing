import { dirname } from "node:path";
import { type BoundOperation, boundOperationDescriptor } from "./lock-bound-operation-registry";
import {
  type BoundEntry,
  BoundLockMutationError,
  BoundLockReservationError,
  type BoundOwnerArtifact,
  type ChildRequest,
  type EncodedEntry,
  type EncodedOwner,
  type OwnedOwner,
  type SuccessfulChildReply,
} from "./lock-bound-owner-contract";
import { runBoundOwner } from "./lock-bound-owner-reusable-process";
import type { FileIdentity, LockOwner } from "./lock-owner";
import type { DirectoryGeneration } from "./lock-recovery";

export type {
  BoundEntry,
  BoundOwnerArtifact,
  ChildRequest,
  EncodedEntry,
  EncodedOwner,
  OwnedOwner,
  SuccessfulChildReply,
};
export { BoundLockMutationError, BoundLockReservationError };

const encodeDirectory = (
  directory: DirectoryGeneration,
): Readonly<{ device: string; inode: string }> => ({
  device: directory.device.toString(),
  inode: directory.inode.toString(),
});

const encodeIdentity = (identity: FileIdentity): EncodedOwner["identity"] => ({
  device: identity.device.toString(),
  inode: identity.inode.toString(),
  links: identity.links.toString(),
  size: identity.size.toString(),
  modifiedAt: identity.modifiedAt.toString(),
  changedAt: identity.changedAt.toString(),
});

export const encodeBoundOwner = (owner: BoundOwnerArtifact): EncodedOwner => ({
  identity: encodeIdentity(owner.identity),
  bytes: owner.bytes.toString("base64"),
});

export const encodeBoundEntry = (entry: BoundEntry): EncodedEntry => ({
  kind: entry.kind,
  identity: {
    device: entry.identity.device.toString(),
    inode: entry.identity.inode.toString(),
    mode: entry.identity.mode.toString(),
    links: entry.identity.links.toString(),
    size: entry.identity.size.toString(),
  },
});

export const decodeBoundOwner = (owner: EncodedOwner, value: LockOwner): OwnedOwner => ({
  state: "regular",
  identity: {
    device: BigInt(owner.identity.device),
    inode: BigInt(owner.identity.inode),
    links: BigInt(owner.identity.links),
    size: BigInt(owner.identity.size),
    modifiedAt: BigInt(owner.identity.modifiedAt),
    changedAt: BigInt(owner.identity.changedAt),
  },
  bytes: Buffer.from(owner.bytes, "base64"),
  owner: value,
});

export const runBoundChild = (
  request: ChildRequest,
  reservation = boundOperationDescriptor(request.operation).failure === "reservation",
): Promise<SuccessfulChildReply> => runBoundOwner(request, reservation);

export const boundRequest = (
  operation: BoundOperation,
  path: string,
  directory: DirectoryGeneration,
  ownerName: string,
  owner?: BoundOwnerArtifact,
  destination?: string,
  parent?: DirectoryGeneration,
): ChildRequest => ({
  operation,
  path,
  directory: encodeDirectory(directory),
  ownerName,
  ...(owner === undefined ? {} : { owner: encodeBoundOwner(owner) }),
  ...(destination === undefined ? {} : { destination }),
  ...(parent === undefined
    ? {}
    : { parent: { path: dirname(path), directory: encodeDirectory(parent) } }),
});
