import { readdir } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { CatalogLockRepairError } from "./errors";
import type { OwnedLockLocation } from "./lock";
import { type LockDebrisName, parseLockDebrisName } from "./lock-artifact-name";
import { inspectLockOwner, ownerProcessState } from "./lock-owner";
import {
  type DirectoryGeneration,
  inspectDirectoryPath,
  sameDirectoryGeneration,
} from "./lock-recovery";
import {
  prepareOwnedLockRepairPlan,
  type ReadyOwnedLockRepairPlan,
} from "./owned-lock-repair-plan";

type RepairInput = Readonly<{
  location: OwnedLockLocation;
  validate: () => Promise<void>;
}>;

export type ReadyOwnedLockRepairSelection = Readonly<{
  state: "ready";
  target: ReadyOwnedLockRepairPlan;
  guardLocation?: OwnedLockLocation;
}>;
export type OwnedLockRepairSelection = Readonly<{ state: "no-op" }> | ReadyOwnedLockRepairSelection;

const changed = (cause?: unknown): CatalogLockRepairError =>
  new CatalogLockRepairError("lock-changed", cause === undefined ? undefined : { cause });

const debrisLocation = (location: OwnedLockLocation, lock: string): OwnedLockLocation => ({
  lock,
  lockOwner: join(lock, basename(location.lockOwner)),
  lockRecovery: join(lock, basename(location.lockRecovery)),
});

const assertInitializerAbandoned = async (
  location: OwnedLockLocation,
  debris: LockDebrisName,
): Promise<void> => {
  if (debris.kind !== "initializing" && debris.initializer === undefined) return;
  const candidate = await inspectDirectoryPath(location.lock);
  if (candidate.state === "missing") throw changed();
  if (candidate.state !== "directory") throw new CatalogLockRepairError("unsafe-lock");
  const owner = await inspectLockOwner(location.lockOwner);
  let pid = debris.initializer?.pid;
  if (pid === undefined) {
    if (owner.state !== "regular" || owner.owner === undefined) {
      throw new CatalogLockRepairError("indeterminate-owner");
    }
    pid = owner.owner.pid;
  }
  const state = ownerProcessState(pid);
  if (state === "alive") throw new CatalogLockRepairError("live-owner");
  if (state === "indeterminate") throw new CatalogLockRepairError("indeterminate-owner");
};

const scanNames = async (
  parentPath: string,
  canonical: string,
  unsafeUnknown: boolean,
): Promise<readonly string[]> => {
  const state = await inspectDirectoryPath(parentPath);
  if (state.state === "missing") return [];
  if (state.state !== "directory") throw new CatalogLockRepairError("unsafe-lock");
  const prefix = `${canonical}.`;
  const entries = await readdir(parentPath).catch((error) => {
    throw changed(error);
  });
  const names = entries.filter((name) => name === canonical || name.startsWith(prefix)).sort();
  if (
    unsafeUnknown &&
    names.some((name) => name !== canonical && parseLockDebrisName(name)?.canonical !== canonical)
  ) {
    throw new CatalogLockRepairError("unsafe-lock");
  }
  return names;
};

const assertParent = async (
  parentPath: string,
  expected: DirectoryGeneration | undefined,
): Promise<void> => {
  const observed = await inspectDirectoryPath(parentPath);
  if (
    (expected === undefined && observed.state !== "missing") ||
    (expected !== undefined &&
      (observed.state !== "directory" || !sameDirectoryGeneration(expected, observed.generation)))
  ) {
    throw changed();
  }
};

const assertNamespaceNames = async (
  parentPath: string,
  parent: DirectoryGeneration | undefined,
  canonical: string,
  targetName: string | undefined,
  guardPresent: boolean,
): Promise<void> => {
  await assertParent(parentPath, parent);
  const names = await scanNames(parentPath, canonical, false);
  const expectsGuard = guardPresent && targetName !== canonical;
  const exact =
    targetName === undefined
      ? names.length === 0
      : expectsGuard
        ? names.length === 2 && names.includes(canonical) && names.includes(targetName)
        : names.length === 1 && names[0] === targetName;
  if (!exact) throw changed();
  await assertParent(parentPath, parent);
};

export const assertOwnedLockRepairSelection = async (
  selection: ReadyOwnedLockRepairSelection,
  guardPresent: boolean,
): Promise<void> => {
  const canonicalLock = selection.guardLocation?.lock ?? selection.target.location.lock;
  const canonical = basename(canonicalLock);
  const targetName = basename(selection.target.location.lock);
  await assertNamespaceNames(
    dirname(canonicalLock),
    selection.target.parent,
    canonical,
    targetName,
    guardPresent,
  );
  if (selection.guardLocation !== undefined) {
    const debris = parseLockDebrisName(targetName);
    if (debris === undefined || debris.canonical !== canonical) {
      throw new CatalogLockRepairError("unsafe-lock");
    }
    await assertInitializerAbandoned(selection.target.location, debris);
  }
};

export const prepareOwnedLockRepairSelection = async (
  input: RepairInput,
): Promise<OwnedLockRepairSelection> => {
  await input.validate();
  const parentPath = dirname(input.location.lock);
  const canonical = basename(input.location.lock);
  const parentState = await inspectDirectoryPath(parentPath);
  if (parentState.state === "unsafe") throw new CatalogLockRepairError("unsafe-lock");

  const initialNames = await scanNames(parentPath, canonical, true);
  if (initialNames.length > 1) throw new CatalogLockRepairError("unsafe-lock");
  const initialName = initialNames[0];
  const parent = parentState.state === "directory" ? parentState.generation : undefined;

  if (initialName === undefined) {
    await assertNamespaceNames(parentPath, parent, canonical, undefined, false);
    return { state: "no-op" };
  }
  if (parent === undefined) throw changed();

  let targetLocation = input.location;
  let guardLocation: OwnedLockLocation | undefined;
  if (initialName !== canonical) {
    const debris = parseLockDebrisName(initialName);
    if (debris === undefined || debris.canonical !== canonical) {
      throw new CatalogLockRepairError("unsafe-lock");
    }
    targetLocation = debrisLocation(input.location, join(parentPath, initialName));
    await assertInitializerAbandoned(targetLocation, debris);
    guardLocation = input.location;
  }

  const target = await prepareOwnedLockRepairPlan(targetLocation);
  if (target.state !== "ready" || !sameDirectoryGeneration(parent, target.parent)) {
    throw changed();
  }
  const selection: ReadyOwnedLockRepairSelection = {
    state: "ready",
    target,
    ...(guardLocation === undefined ? {} : { guardLocation }),
  };
  await assertOwnedLockRepairSelection(selection, false);
  return selection;
};
