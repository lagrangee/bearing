import { randomBytes } from "node:crypto";
import { CatalogLockRecoveryError } from "./errors";
import { type BoundOwnerArtifact, boundRequest, runBoundChild } from "./lock-bound-owner-process";
import type { DirectoryGeneration } from "./lock-recovery";

const tombstoneName = (): string => `.owner.${randomBytes(16).toString("base64url")}.tombstone`;
const OWNER_TOMBSTONE = /^\.owner\.([A-Za-z0-9_-]{22})\.tombstone$/;

export const isBoundOwnerTombstoneName = (name: string): boolean => {
  const token = OWNER_TOMBSTONE.exec(name)?.[1];
  if (token === undefined) return false;
  const bytes = Buffer.from(token, "base64url");
  return bytes.length === 16 && bytes.toString("base64url") === token;
};

const removeWithTombstone = async (
  directory: string,
  expectedDirectory: DirectoryGeneration,
  ownerName: string,
  expectedOwner: BoundOwnerArtifact | undefined,
  parent: DirectoryGeneration,
  afterTombstone?: (name: string) => Promise<void>,
): Promise<void> => {
  if (expectedOwner === undefined) {
    await runBoundChild(
      boundRequest("remove", directory, expectedDirectory, ownerName, undefined, undefined, parent),
    );
    return;
  }
  const tombstone = tombstoneName();
  await runBoundChild({
    ...boundRequest(
      "tombstone",
      directory,
      expectedDirectory,
      ownerName,
      expectedOwner,
      undefined,
      parent,
    ),
    tombstoneName: tombstone,
  });
  await afterTombstone?.(tombstone);
  await runBoundChild(
    boundRequest(
      "remove",
      directory,
      expectedDirectory,
      tombstone,
      expectedOwner,
      undefined,
      parent,
    ),
  );
};

export const strictMoveBoundLockCandidate = async (
  directory: string,
  destination: string,
  expectedDirectory: DirectoryGeneration,
  ownerName: string,
  expectedOwner: BoundOwnerArtifact | undefined,
  parent: DirectoryGeneration,
  beforeMove?: () => Promise<void>,
): Promise<void> => {
  await beforeMove?.();
  const moved = await runBoundChild(
    boundRequest(
      "quarantine",
      directory,
      expectedDirectory,
      ownerName,
      expectedOwner,
      destination,
      parent,
    ),
  );
  if (moved.state !== "ok") throw new CatalogLockRecoveryError();
};

export const strictRetireBoundLockCandidate = async (
  directory: string,
  quarantine: string,
  expectedDirectory: DirectoryGeneration,
  ownerName: string,
  expectedOwner: BoundOwnerArtifact | undefined,
  parent: DirectoryGeneration,
  beforeQuarantine?: () => Promise<void>,
  afterQuarantine?: (path: string) => Promise<void>,
  afterOwnerTombstoned?: (path: string, name: string) => Promise<void>,
): Promise<void> => {
  if (
    beforeQuarantine === undefined &&
    afterQuarantine === undefined &&
    afterOwnerTombstoned === undefined
  ) {
    const retired = await runBoundChild({
      ...boundRequest(
        "retire",
        directory,
        expectedDirectory,
        ownerName,
        expectedOwner,
        quarantine,
        parent,
      ),
      ...(expectedOwner === undefined ? {} : { tombstoneName: tombstoneName() }),
    });
    if (retired.state !== "ok") throw new CatalogLockRecoveryError();
    return;
  }
  await strictMoveBoundLockCandidate(
    directory,
    quarantine,
    expectedDirectory,
    ownerName,
    expectedOwner,
    parent,
    beforeQuarantine,
  );
  await afterQuarantine?.(quarantine);
  await removeWithTombstone(
    quarantine,
    expectedDirectory,
    ownerName,
    expectedOwner,
    parent,
    afterOwnerTombstoned === undefined
      ? undefined
      : (name) => afterOwnerTombstoned(quarantine, name),
  );
};

export const retireBoundLockCandidate = async (
  directory: string,
  quarantine: string,
  expectedDirectory: DirectoryGeneration,
  ownerName: string,
  expectedOwner: BoundOwnerArtifact | undefined,
  parent: DirectoryGeneration,
  afterQuarantine?: (path: string) => Promise<void>,
  afterOwnerTombstoned?: (path: string, name: string) => Promise<void>,
): Promise<void> => {
  try {
    await strictRetireBoundLockCandidate(
      directory,
      quarantine,
      expectedDirectory,
      ownerName,
      expectedOwner,
      parent,
      undefined,
      afterQuarantine,
      afterOwnerTombstoned,
    );
  } catch (error) {
    if (error instanceof CatalogLockRecoveryError) {
      // Expected identity/contention failures leave an unverified source or
      // quarantine for exact repair; programmer and hook failures still surface.
      return;
    }
    throw error;
  }
};
