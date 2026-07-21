import { readdir } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { CatalogLockRepairError } from "./errors";
import type { OwnedLockLocation } from "./lock";
import {
  type DirectoryGeneration,
  inspectDirectoryPath,
  RECOVERY_OWNER_STAGE,
  sameDirectoryGeneration,
} from "./lock-recovery";
import {
  captureRecoveryClaimDebris,
  type RecoveryClaimDebris,
  sameRecoveryClaimDebris,
} from "./lock-repair-claim-plan";
import {
  isBoundOwnerRetiredName,
  isBoundRetiredTargetName,
  isRecoveryRetiredName,
} from "./lock-repair-residue";
import { inspectRepairShape, OWNER_TEMP } from "./lock-repair-shape";
import {
  assertRepairableTarget,
  captureRepairTarget,
  type RepairTarget,
  sameRepairTarget,
} from "./owned-lock-repair-target";

type MissingOwnedLockRepairPlan = Readonly<{
  state: "missing";
  location: OwnedLockLocation;
}>;
export type ReadyOwnedLockRepairPlan = Readonly<{
  state: "ready";
  location: OwnedLockLocation;
  directory: DirectoryGeneration;
  parent: DirectoryGeneration;
  recovery?: DirectoryGeneration;
  lockEntries: readonly string[];
  recoveryEntries: readonly string[];
  targets: readonly RepairTarget[];
  claims: readonly RecoveryClaimDebris[];
}>;
type OwnedLockRepairPlan = MissingOwnedLockRepairPlan | ReadyOwnedLockRepairPlan;

const changed = (cause?: unknown): CatalogLockRepairError =>
  new CatalogLockRepairError("lock-changed", cause === undefined ? undefined : { cause });
const exact = (left: readonly string[], right: readonly string[]): boolean =>
  left.length === right.length && left.every((value, index) => value === right[index]);

const targetPaths = (
  location: OwnedLockLocation,
  lockEntries: readonly string[],
  recoveryEntries: readonly string[],
): readonly string[] => [
  ...lockEntries
    .filter(
      (name) =>
        name === basename(location.lockOwner) ||
        OWNER_TEMP.test(name) ||
        isBoundRetiredTargetName(name) ||
        isRecoveryRetiredName(name, basename(location.lockRecovery)),
    )
    .map((name) => join(location.lock, name)),
  ...recoveryEntries
    .filter((name) => RECOVERY_OWNER_STAGE.test(name) || isBoundRetiredTargetName(name))
    .map((name) => join(location.lockRecovery, name)),
];

const captureTargets = async (
  paths: readonly string[],
  recoveryName: string,
): Promise<readonly RepairTarget[]> => {
  const targets: RepairTarget[] = [];
  for (const path of paths) {
    const target = await captureRepairTarget(path);
    if (target === undefined) throw changed();
    const name = basename(path);
    if (
      (OWNER_TEMP.test(name) && target.node.identity.links !== 1n) ||
      (isBoundOwnerRetiredName(name) && target.node.safeRegular === undefined) ||
      (isRecoveryRetiredName(name, recoveryName) && target.node.kind !== "directory")
    ) {
      throw new CatalogLockRepairError("unsafe-lock");
    }
    await assertRepairableTarget(target);
    targets.push(target);
  }
  return targets;
};

const readEntries = async (path: string): Promise<readonly string[]> =>
  readdir(path)
    .then((entries) => entries.sort())
    .catch((error) => {
      throw changed(error);
    });

export const prepareOwnedLockRepairPlan = async (
  location: OwnedLockLocation,
): Promise<OwnedLockRepairPlan> => {
  const observed = await inspectDirectoryPath(location.lock);
  if (observed.state === "missing") return { state: "missing", location };
  if (observed.state !== "directory") throw new CatalogLockRepairError("unsafe-lock");
  const parentState = await inspectDirectoryPath(dirname(location.lock));
  if (parentState.state !== "directory") throw new CatalogLockRepairError("unsafe-lock");
  const directory = observed.generation;
  const recovery = await inspectRepairShape(location, directory);
  const lockEntries = await readEntries(location.lock);
  const recoveryEntries = recovery === undefined ? [] : await readEntries(location.lockRecovery);
  const [targets, claims] = await Promise.all([
    captureTargets(
      targetPaths(location, lockEntries, recoveryEntries),
      basename(location.lockRecovery),
    ),
    recovery === undefined
      ? Promise.resolve([])
      : captureRecoveryClaimDebris(location.lockRecovery, recovery),
  ]);
  const [lockAfter, parentAfter, recoveryAfter] = await Promise.all([
    inspectDirectoryPath(location.lock),
    inspectDirectoryPath(dirname(location.lock)),
    recovery === undefined
      ? Promise.resolve(undefined)
      : inspectDirectoryPath(location.lockRecovery),
  ]);
  if (
    lockAfter.state !== "directory" ||
    !sameDirectoryGeneration(directory, lockAfter.generation) ||
    parentAfter.state !== "directory" ||
    !sameDirectoryGeneration(parentState.generation, parentAfter.generation) ||
    (recovery !== undefined &&
      (recoveryAfter?.state !== "directory" ||
        !sameDirectoryGeneration(recovery, recoveryAfter.generation)))
  ) {
    throw changed();
  }
  return {
    state: "ready",
    location,
    directory,
    parent: parentState.generation,
    ...(recovery === undefined ? {} : { recovery }),
    lockEntries,
    recoveryEntries,
    targets,
    claims,
  };
};

const sameOwnedLockRepairPlan = (
  expected: OwnedLockRepairPlan,
  observed: OwnedLockRepairPlan,
): boolean => {
  if (expected.state !== observed.state || expected.location.lock !== observed.location.lock) {
    return false;
  }
  if (expected.state === "missing" || observed.state === "missing") return true;
  return (
    sameDirectoryGeneration(expected.directory, observed.directory) &&
    sameDirectoryGeneration(expected.parent, observed.parent) &&
    (expected.recovery === undefined) === (observed.recovery === undefined) &&
    (expected.recovery === undefined ||
      (observed.recovery !== undefined &&
        sameDirectoryGeneration(expected.recovery, observed.recovery))) &&
    exact(expected.lockEntries, observed.lockEntries) &&
    exact(expected.recoveryEntries, observed.recoveryEntries) &&
    expected.targets.length === observed.targets.length &&
    expected.targets.every((target, index) => {
      const current = observed.targets[index];
      return current !== undefined && sameRepairTarget(target, current);
    }) &&
    expected.claims.length === observed.claims.length &&
    expected.claims.every((claim, index) => {
      const current = observed.claims[index];
      return current !== undefined && sameRecoveryClaimDebris(claim, current);
    })
  );
};

export const assertOriginalOwnedLockRepairPlan = async (
  expected: OwnedLockRepairPlan,
): Promise<void> => {
  const observed = await prepareOwnedLockRepairPlan(expected.location);
  if (!sameOwnedLockRepairPlan(expected, observed)) throw changed();
};
