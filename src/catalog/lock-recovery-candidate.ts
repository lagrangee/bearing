import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { createBoundChildDirectory } from "./lock-bound-directory";
import {
  confirmBoundLockOwner,
  retireBoundLockCandidate,
  writeBoundLockOwner,
} from "./lock-bound-owner";
import { publishBoundLockCandidate } from "./lock-bound-publish";
import type { LockOwner, LockOwnerArtifact } from "./lock-owner";

type DirectoryIdentity = Readonly<{ device: bigint; inode: bigint }>;
export type RecoveryCandidateOwner = Extract<LockOwnerArtifact, { state: "regular" }> &
  Readonly<{ owner: LockOwner }>;

export const createRecoveryCandidate = (
  parentPath: string,
  parent: DirectoryIdentity,
  candidate: string,
  lock: DirectoryIdentity,
): Promise<DirectoryIdentity> => createBoundChildDirectory(parentPath, parent, candidate, lock);

export const publishRecoveryCandidateOwner = (
  directory: string,
  expected: DirectoryIdentity,
  parent: DirectoryIdentity,
  name: string,
  owner: LockOwner,
): Promise<RecoveryCandidateOwner> => writeBoundLockOwner(directory, expected, name, owner, parent);

export const confirmRecoveryCandidateOwner = (
  directory: string,
  expected: DirectoryIdentity,
  parent: DirectoryIdentity,
  name: string,
  owner: RecoveryCandidateOwner,
): Promise<RecoveryCandidateOwner> =>
  confirmBoundLockOwner(directory, expected, name, owner, parent);

export const publishRecoveryCandidate = (
  candidate: string,
  claimed: string,
  expected: DirectoryIdentity,
  parent: DirectoryIdentity,
  name: string,
  owner: RecoveryCandidateOwner,
) => publishBoundLockCandidate(candidate, claimed, expected, name, owner, parent);

export const removeRecoveryCandidate = async (
  directory: string,
  expected: DirectoryIdentity,
  parent: DirectoryIdentity,
  name: string,
  owner: RecoveryCandidateOwner | undefined,
): Promise<void> => {
  const quarantine = join(dirname(directory), `claim.${randomUUID()}.abandoned`);
  await retireBoundLockCandidate(directory, quarantine, expected, name, owner, parent);
};
