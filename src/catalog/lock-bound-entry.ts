import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { CatalogLockRecoveryError } from "./errors";
import {
  type BoundEntry,
  boundRequest,
  encodeBoundEntry,
  runBoundChild,
} from "./lock-bound-owner-process";
import type { DirectoryGeneration } from "./lock-recovery";

const tombstoneName = (): string => `.entry.${randomBytes(16).toString("base64url")}.retired`;

export type { BoundEntry, BoundEntryIdentity } from "./lock-bound-owner-contract";

export const strictRetireBoundEntry = async (
  directory: string,
  expectedDirectory: DirectoryGeneration,
  name: string,
  expectedEntry: BoundEntry,
  parent: DirectoryGeneration,
  afterTombstone?: (path: string) => Promise<void>,
): Promise<void> => {
  const retire = async (operation: "quarantine-entry" | "remove-entry", source: string) => {
    const tombstone = tombstoneName();
    const reply = await runBoundChild({
      ...boundRequest(
        operation,
        directory,
        expectedDirectory,
        source,
        undefined,
        undefined,
        parent,
      ),
      entry: encodeBoundEntry(expectedEntry),
      tombstoneName: tombstone,
    });
    if (reply.state !== "ok") throw new CatalogLockRecoveryError();
    return tombstone;
  };
  if (afterTombstone === undefined) {
    await retire("remove-entry", name);
    return;
  }
  const tombstone = await retire("quarantine-entry", name);
  await afterTombstone(join(directory, tombstone));
  await retire("remove-entry", tombstone);
};
