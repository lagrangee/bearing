import { lstat, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { confirmBoundLockOwner } from "./lock-bound-owner";
import {
  BoundLockReservationError,
  boundRequest,
  decodeBoundOwner,
  type OwnedOwner,
  runBoundChild,
  type SuccessfulChildReply,
} from "./lock-bound-owner-process";
import { inspectLockOwner, type LockOwner, ownerProcessState } from "./lock-owner";
import type { DirectoryGeneration } from "./lock-recovery";

export type PublishedBoundLock = Readonly<{
  state: "adopted";
  directory: DirectoryGeneration;
  owner: OwnedOwner;
}>;

type ReconciledBoundOwner =
  | PublishedBoundLock
  | Readonly<{ state: "missing" }>
  | Readonly<{ state: "empty" }>
  | Readonly<{ state: "contended" }>
  | Readonly<{ state: "indeterminate" }>;

export type BoundLockPublishResult =
  | PublishedBoundLock
  | Readonly<{ state: "missing" }>
  | Readonly<{ state: "contended" }>
  | Readonly<{ state: "indeterminate"; cause?: unknown }>;

const sameOwner = (left: LockOwner, right: LockOwner): boolean =>
  left.pid === right.pid && left.token === right.token;

type ObservedDirectory =
  | Readonly<{ state: "directory"; generation: DirectoryGeneration }>
  | Readonly<{ state: "missing" | "indeterminate" }>;

const observeDirectory = async (path: string): Promise<ObservedDirectory> => {
  try {
    const metadata = await lstat(path, { bigint: true });
    return metadata.isDirectory()
      ? { state: "directory", generation: { device: metadata.dev, inode: metadata.ino } }
      : { state: "indeterminate" };
  } catch (error) {
    return error instanceof Error && "code" in error && error.code === "ENOENT"
      ? { state: "missing" }
      : { state: "indeterminate" };
  }
};

const exactDirectory = async (
  path: string,
  expected: DirectoryGeneration,
): Promise<"exact" | "missing" | "indeterminate"> => {
  const observed = await observeDirectory(path);
  if (observed.state === "missing") return "missing";
  return observed.state === "directory" &&
    expected.device === observed.generation.device &&
    expected.inode === observed.generation.inode
    ? "exact"
    : "indeterminate";
};

export const reconcileBoundOwnerPublication = async (
  directory: string,
  expectedDirectory: DirectoryGeneration,
  parentPath: string,
  expectedParent: DirectoryGeneration,
  ownerName: string,
  intendedOwner: LockOwner,
): Promise<ReconciledBoundOwner> => {
  const [directoryState, parentState] = await Promise.all([
    exactDirectory(directory, expectedDirectory),
    exactDirectory(parentPath, expectedParent),
  ]);
  if (directoryState === "missing") return { state: "missing" };
  if (directoryState !== "exact" || parentState !== "exact") return { state: "indeterminate" };
  let entries: string[];
  try {
    entries = await readdir(directory);
  } catch {
    return { state: "indeterminate" };
  }
  if (entries.length === 0) {
    const stable = await exactDirectory(directory, expectedDirectory);
    return stable === "exact" ? { state: "empty" } : { state: "indeterminate" };
  }
  if (entries.length !== 1 || entries[0] !== ownerName) return { state: "indeterminate" };
  const artifact = await inspectLockOwner(join(directory, ownerName));
  if (artifact.state !== "regular" || artifact.owner === undefined) {
    return { state: "indeterminate" };
  }
  const expectedBytes = Buffer.from(`${JSON.stringify(intendedOwner)}\n`);
  const ownerValueMatches = sameOwner(artifact.owner, intendedOwner);
  if (ownerValueMatches && !artifact.bytes.equals(expectedBytes)) return { state: "indeterminate" };
  let confirmed: OwnedOwner;
  try {
    confirmed = await confirmBoundLockOwner(
      directory,
      expectedDirectory,
      ownerName,
      { ...artifact, owner: artifact.owner },
      expectedParent,
    );
  } catch {
    return { state: "indeterminate" };
  }
  let confirmedEntries: string[];
  try {
    confirmedEntries = await readdir(directory);
  } catch {
    return { state: "indeterminate" };
  }
  if (confirmedEntries.length !== 1 || confirmedEntries[0] !== ownerName) {
    return { state: "indeterminate" };
  }
  if (ownerValueMatches) {
    return { state: "adopted", directory: expectedDirectory, owner: confirmed };
  }
  return ownerProcessState(confirmed.owner.pid) === "alive"
    ? { state: "contended" }
    : { state: "indeterminate" };
};

export const publishBoundLockCandidate = async (
  candidate: string,
  destination: string,
  candidateDirectory: DirectoryGeneration,
  ownerName: string,
  candidateOwner: OwnedOwner,
  parent: DirectoryGeneration,
): Promise<BoundLockPublishResult> => {
  let reply: SuccessfulChildReply;
  try {
    reply = await runBoundChild(
      {
        ...boundRequest(
          "publish",
          candidate,
          candidateDirectory,
          ownerName,
          candidateOwner,
          destination,
          parent,
        ),
        newOwner: candidateOwner.owner,
      },
      true,
    );
  } catch (error) {
    if (!(error instanceof BoundLockReservationError) || !error.reservationMayHaveCommitted) {
      throw error;
    }
    const destinationState = await observeDirectory(destination);
    if (destinationState.state === "missing") return { state: "missing" };
    if (destinationState.state !== "directory") {
      return { state: "indeterminate", cause: error };
    }
    const reconciled = await reconcileBoundOwnerPublication(
      destination,
      destinationState.generation,
      dirname(destination),
      parent,
      ownerName,
      candidateOwner.owner,
    );
    if (reconciled.state === "empty" || reconciled.state === "indeterminate") {
      return { state: "indeterminate", cause: error };
    }
    if (reconciled.state === "adopted") return reconciled;
    if (reconciled.state === "missing") return reconciled;
    if (reconciled.state === "contended") return reconciled;
    return { state: "indeterminate", cause: error };
  }
  if (reply.state === "contended") return reply;
  if (reply.directory === undefined || reply.owner === undefined) {
    return { state: "indeterminate", cause: new BoundLockReservationError(true) };
  }
  return {
    state: "adopted",
    directory: {
      device: BigInt(reply.directory.device),
      inode: BigInt(reply.directory.inode),
    },
    owner: decodeBoundOwner(reply.owner, candidateOwner.owner),
  };
};
