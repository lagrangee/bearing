import { CatalogLockRecoveryError } from "./errors";
import type { BoundOperation } from "./lock-bound-operation-registry";
import type { FileIdentity, LockOwner, LockOwnerArtifact } from "./lock-owner";

export type BoundOwnerArtifact = Extract<LockOwnerArtifact, { state: "regular" }>;
export type OwnedOwner = BoundOwnerArtifact & Readonly<{ owner: LockOwner }>;
type EncodedIdentity = Readonly<Record<keyof FileIdentity, string>>;
export type EncodedOwner = Readonly<{ identity: EncodedIdentity; bytes: string }>;
export type BoundEntryIdentity = Readonly<{
  device: bigint;
  inode: bigint;
  mode: bigint;
  links: bigint;
  size: bigint;
}>;
export type BoundEntry = Readonly<{
  kind: "directory" | "regular" | "other";
  identity: BoundEntryIdentity;
}>;
export type EncodedEntry = Readonly<{
  kind: BoundEntry["kind"];
  identity: Readonly<Record<keyof BoundEntryIdentity, string>>;
}>;
export type ChildRequest = Readonly<{
  operation: BoundOperation;
  path: string;
  directory: Readonly<{ device: string; inode: string }>;
  ownerName: string;
  owner?: EncodedOwner;
  newOwner?: LockOwner;
  newOwnerName?: string;
  previousOwnerName?: string;
  destination?: string;
  tombstoneName?: string;
  entries?: readonly string[];
  entry?: EncodedEntry;
  stageName?: string;
  stagedOwner?: EncodedOwner;
  parent?: Readonly<{
    path: string;
    directory: Readonly<{ device: string; inode: string }>;
  }>;
}>;
export type ChildReply =
  | Readonly<{
      state: "ok";
      owner?: EncodedOwner;
      directory?: Readonly<{ device: string; inode: string }>;
    }>
  | Readonly<{ state: "contended" }>
  | Readonly<{ state: "error"; committed: boolean }>;
export type SuccessfulChildReply = Exclude<
  ChildReply,
  Readonly<{ state: "error"; committed: boolean }>
>;

export class BoundLockReservationError extends CatalogLockRecoveryError {
  public constructor(
    public readonly reservationMayHaveCommitted: boolean,
    options?: ErrorOptions,
  ) {
    super(options);
    this.name = "BoundLockReservationError";
  }
}

export class BoundLockMutationError extends CatalogLockRecoveryError {
  public constructor(
    public readonly mutationMayHaveCommitted: boolean,
    options?: ErrorOptions,
  ) {
    super(options);
    this.name = "BoundLockMutationError";
  }
}
