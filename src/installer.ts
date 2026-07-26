import { randomUUID } from "node:crypto";
import {
  chmod,
  mkdir,
  readdir,
  readFile,
  readlink,
  rename,
  rm,
  rmdir,
  symlink,
  unlink,
} from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { writeFileAtomically } from "./atomic-write";
import { readCatalogState } from "./catalog/store";
import {
  ensureInstallDirectoryTargets,
  inspectInstallPath,
  missingInstallParentDirectories,
  preflightInstallTargets,
} from "./install-boundary";
import type {
  DeleteTargetPlan,
  FileTargetPlan,
  SymlinkTargetPlan,
  TargetPlan,
} from "./install-manifest";
import { buildBundlePlans } from "./install-manifest";
import type { AgentSurface, InstallOptions, InstallResult } from "./types";

type FileSnapshot = Readonly<{
  kind: "file";
  bytes: Buffer | undefined;
  mode: number | undefined;
  linkCount: number | undefined;
}>;

type SymlinkSnapshot = Readonly<{
  kind: "symlink";
  source: string | undefined;
}>;

type Snapshot = Readonly<{
  plan: TargetPlan;
  original: FileSnapshot | SymlinkSnapshot;
}>;

const isSymlinkPlan = (plan: TargetPlan): plan is SymlinkTargetPlan => plan.kind === "symlink";

const isDeletePlan = (plan: TargetPlan): plan is DeleteTargetPlan => plan.kind === "delete";

const normalizedLinkTarget = (target: string, linkTarget: string): string =>
  resolve(dirname(target), linkTarget);

const snapshotPlans = async (plans: readonly TargetPlan[]): Promise<readonly Snapshot[]> => {
  const snapshots: Snapshot[] = [];
  for (const plan of plans) {
    const inspected = await inspectInstallPath(plan.target);
    if (isSymlinkPlan(plan)) {
      if (inspected.kind === "missing") {
        snapshots.push({ plan, original: { kind: "symlink", source: undefined } });
        continue;
      }
      if (inspected.kind !== "symbolic-link") {
        throw new Error(
          `Installation symlink target conflicts with existing content: ${plan.target}`,
        );
      }
      const source = await readlink(plan.target);
      if (source !== plan.source && normalizedLinkTarget(plan.target, source) !== plan.source) {
        throw new Error(
          `Installation symlink target points outside the Bearing bundle: ${plan.target}`,
        );
      }
      snapshots.push({ plan, original: { kind: "symlink", source } });
      continue;
    }

    if (inspected.kind === "symbolic-link") {
      throw new Error(`Installation target cannot use a symbolic link: ${plan.target}`);
    }
    if (inspected.kind === "directory") {
      throw new Error(`Installation file target is a directory: ${plan.target}`);
    }
    const bytes = inspected.kind === "file" ? await readFile(plan.target) : undefined;
    snapshots.push({
      plan,
      original: {
        kind: "file",
        bytes,
        mode: inspected.kind === "file" ? inspected.mode : undefined,
        linkCount: inspected.kind === "file" ? inspected.linkCount : undefined,
      },
    });
  }
  for (const snapshot of snapshots) {
    if (
      !isSymlinkPlan(snapshot.plan) &&
      needsWrite(snapshot) &&
      snapshot.original.kind === "file" &&
      snapshot.original.linkCount !== undefined &&
      snapshot.original.linkCount > 1
    ) {
      throw new Error(`Installation target cannot be hard-linked: ${snapshot.plan.target}`);
    }
  }
  return snapshots;
};

const needsWrite = (snapshot: Snapshot): boolean => {
  if (isSymlinkPlan(snapshot.plan)) {
    return snapshot.original.kind !== "symlink" || snapshot.original.source === undefined;
  }
  if (isDeletePlan(snapshot.plan)) {
    return snapshot.original.kind === "file" && snapshot.original.bytes !== undefined;
  }
  if (snapshot.original.kind !== "file") return true;
  if (snapshot.original.bytes === undefined || !snapshot.original.bytes.equals(snapshot.plan.bytes))
    return true;
  return (
    snapshot.plan.executable &&
    snapshot.original.mode !== undefined &&
    (snapshot.original.mode & 0o111) === 0
  );
};

const removeCreatedDirectories = async (directories: readonly string[]): Promise<void> => {
  for (const directory of directories) {
    try {
      await rmdir(directory);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        continue;
      }
      throw error;
    }
  }
};

export const writeInstallTarget = async (plan: TargetPlan, _ordinal: number): Promise<void> => {
  if (isDeletePlan(plan)) {
    await unlink(plan.target);
    return;
  }
  await mkdir(dirname(plan.target), { recursive: true });
  if (isSymlinkPlan(plan)) {
    await symlink(plan.source, plan.target, "dir");
    return;
  }
  await writeFileAtomically(
    plan.target,
    plan.bytes,
    plan.mode ?? (plan.executable ? 0o755 : 0o644),
  );
};

const restoreSnapshots = async (snapshots: readonly Snapshot[]): Promise<void> => {
  for (const [index, snapshot] of [...snapshots].reverse().entries()) {
    if (isSymlinkPlan(snapshot.plan)) {
      if (snapshot.original.kind === "symlink" && snapshot.original.source === undefined) {
        try {
          await unlink(snapshot.plan.target);
        } catch (error) {
          if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
        }
      }
      continue;
    }

    if (snapshot.original.kind !== "file" || snapshot.original.bytes === undefined) {
      try {
        await unlink(snapshot.plan.target);
      } catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
      }
      continue;
    }
    await writeInstallTarget(
      {
        kind: "file",
        target: snapshot.plan.target,
        bytes: snapshot.original.bytes,
        executable: snapshot.original.mode !== undefined && (snapshot.original.mode & 0o111) !== 0,
        ...(snapshot.original.mode === undefined ? {} : { mode: snapshot.original.mode & 0o7777 }),
      },
      index,
    );
    if (snapshot.original.mode !== undefined)
      await chmod(snapshot.plan.target, snapshot.original.mode & 0o7777);
  }
};

export type InstallTargetWriter = (plan: TargetPlan, ordinal: number) => Promise<void>;

export { preflightInstallTargets };

export const applyInstallPlans = async (
  homeDir: string,
  plans: readonly TargetPlan[],
  writer: InstallTargetWriter = writeInstallTarget,
  beforeSnapshot: () => Promise<void> = async () => {},
  afterWrite: () => Promise<readonly TargetPlan[] | undefined> = async () => undefined,
  afterAllWrites: () => Promise<void> = async () => {},
): Promise<InstallResult> => {
  await ensureInstallDirectoryTargets(
    homeDir,
    plans.map((plan) => plan.target),
  );
  await beforeSnapshot();
  const snapshots = await snapshotPlans(plans);
  const changed = snapshots.filter(needsWrite);
  const createdDirectories = [
    ...(await missingInstallParentDirectories(
      homeDir,
      changed.map((snapshot) => snapshot.plan.target),
    )),
  ];
  const applied: Snapshot[] = [];
  const allChanged: Snapshot[] = [...changed];
  try {
    for (const [index, snapshot] of changed.entries()) {
      applied.push(snapshot);
      if (isSymlinkPlan(snapshot.plan) || isDeletePlan(snapshot.plan)) {
        await writer(snapshot.plan, index);
        continue;
      }
      const mode =
        snapshot.original.kind === "file" && snapshot.original.mode !== undefined
          ? (snapshot.original.mode & 0o7777) | (snapshot.plan.executable ? 0o100 : 0)
          : undefined;
      await writer(mode === undefined ? snapshot.plan : { ...snapshot.plan, mode }, index);
    }
    const additionalPlans = (await afterWrite()) ?? [];
    if (additionalPlans.length > 0) {
      await ensureInstallDirectoryTargets(
        homeDir,
        additionalPlans.map((plan) => plan.target),
      );
      const additionalSnapshots = await snapshotPlans(additionalPlans);
      const additionalChanged = additionalSnapshots.filter(needsWrite);
      const additionalDirectories = await missingInstallParentDirectories(
        homeDir,
        additionalChanged.map((snapshot) => snapshot.plan.target),
      );
      createdDirectories.push(
        ...additionalDirectories.filter((directory) => !createdDirectories.includes(directory)),
      );
      allChanged.push(...additionalChanged);
      for (const [index, snapshot] of additionalChanged.entries()) {
        applied.push(snapshot);
        if (isSymlinkPlan(snapshot.plan) || isDeletePlan(snapshot.plan)) {
          await writer(snapshot.plan, changed.length + index);
          continue;
        }
        const mode =
          snapshot.original.kind === "file" && snapshot.original.mode !== undefined
            ? (snapshot.original.mode & 0o7777) | (snapshot.plan.executable ? 0o100 : 0)
            : undefined;
        await writer(
          mode === undefined ? snapshot.plan : { ...snapshot.plan, mode },
          changed.length + index,
        );
      }
    }
    await afterAllWrites();
  } catch (error) {
    try {
      await restoreSnapshots(applied);
      await removeCreatedDirectories(
        [...createdDirectories].sort((left, right) => right.length - left.length),
      );
    } catch (rollbackError) {
      throw new Error("Bearing kit installation and rollback both failed.", {
        cause: rollbackError,
      });
    }
    throw new Error(
      `Bearing kit installation failed; all written targets were restored. Cause: ${
        error instanceof Error ? error.message : String(error)
      }`,
      { cause: error },
    );
  }
  return {
    outcome: allChanged.length > 0 ? "applied" : "no-op",
    cliPath: join(homeDir, ".bearing/bin/bearing"),
    changedTargets: allChanged.map((snapshot) => relative(homeDir, snapshot.plan.target)),
  };
};

type ManagedLinkSnapshot = Readonly<
  | { kind: "missing"; target: string }
  | { kind: "symlink"; target: string; source: string }
  | { kind: "legacy-cli"; target: string; bytes: Buffer; mode: number }
>;

const parsePackageVersion = (bytes: string, target: string): string => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes);
  } catch (error) {
    throw new Error(`Bearing package metadata is invalid: ${target}`, { cause: error });
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("version" in parsed) ||
    typeof parsed.version !== "string" ||
    parsed.version.length === 0
  ) {
    throw new Error(`Bearing package metadata is invalid: ${target}`);
  }
  return parsed.version;
};

const packageVersionAt = async (root: string): Promise<string> => {
  const target = join(root, "package.json");
  return parsePackageVersion(await readFile(target, "utf8"), target);
};

type ParsedVersion = Readonly<{
  major: bigint;
  minor: bigint;
  patch: bigint;
  prerelease: readonly string[];
}>;

const parseVersion = (version: string): ParsedVersion => {
  const match =
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u.exec(
      version,
    );
  if (match === null) throw new Error(`Bearing package version is not supported: ${version}`);
  const major = match[1];
  const minor = match[2];
  const patch = match[3];
  if (major === undefined || minor === undefined || patch === undefined) {
    throw new Error(`Bearing package version is not supported: ${version}`);
  }
  const prerelease = match[4]?.split(".") ?? [];
  if (prerelease.some((identifier) => /^0\d+$/u.test(identifier))) {
    throw new Error(`Bearing package version is not supported: ${version}`);
  }
  return { major: BigInt(major), minor: BigInt(minor), patch: BigInt(patch), prerelease };
};

const installedPackageVersionAt = async (root: string): Promise<string | undefined> => {
  const target = join(root, "package.json");
  const state = await inspectInstallPath(target);
  if (state.kind === "missing") return undefined;
  if (state.kind !== "file" || state.linkCount !== 1) {
    throw new Error(`Installed Bearing package metadata must be one safe regular file: ${target}`);
  }
  let version: string;
  try {
    version = parsePackageVersion(await readFile(target, "utf8"), target);
    parseVersion(version);
  } catch {
    return undefined;
  }
  return version;
};

const comparePrereleaseIdentifiers = (left: string, right: string): number => {
  const leftNumeric = /^\d+$/u.test(left);
  const rightNumeric = /^\d+$/u.test(right);
  if (leftNumeric && rightNumeric) {
    const leftNumber = BigInt(left);
    const rightNumber = BigInt(right);
    return leftNumber === rightNumber ? 0 : leftNumber < rightNumber ? -1 : 1;
  }
  if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
  return left === right ? 0 : left < right ? -1 : 1;
};

export const comparePackageVersions = (left: string, right: string): number => {
  const a = parseVersion(left);
  const b = parseVersion(right);
  for (const key of ["major", "minor", "patch"] as const) {
    if (a[key] !== b[key]) return a[key] < b[key] ? -1 : 1;
  }
  if (a.prerelease.length === 0 || b.prerelease.length === 0) {
    if (a.prerelease.length === b.prerelease.length) return 0;
    return a.prerelease.length === 0 ? 1 : -1;
  }
  const length = Math.max(a.prerelease.length, b.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const leftIdentifier = a.prerelease[index];
    const rightIdentifier = b.prerelease[index];
    if (leftIdentifier === undefined || rightIdentifier === undefined) {
      return leftIdentifier === undefined ? -1 : 1;
    }
    const comparison = comparePrereleaseIdentifiers(leftIdentifier, rightIdentifier);
    if (comparison !== 0) return comparison;
  }
  return 0;
};

export const assertSupportedDowngrade = (
  candidateVersion: string,
  installedVersion: string,
  confirmed: boolean,
): void => {
  if (comparePackageVersions(candidateVersion, installedVersion) >= 0) return;
  const candidate = parseVersion(candidateVersion);
  const installed = parseVersion(installedVersion);
  if (candidate.major !== installed.major) {
    throw new Error(
      `Downgrade from Bearing ${installedVersion} to ${candidateVersion} crosses a major-version boundary and is unsupported. Use the release-specific migration and verified backup path.`,
    );
  }
  if (installed.minor - candidate.minor > 1n) {
    throw new Error(
      `Downgrade from Bearing ${installedVersion} to ${candidateVersion} skips multiple minor versions and is unsupported. Downgrade through each documented minor and restore its verified backup when required.`,
    );
  }
  if (!confirmed) {
    throw new Error(
      `Downgrade from Bearing ${installedVersion} to ${candidateVersion} requires --confirm-downgrade. A package downgrade is not repository-state rollback.`,
    );
  }
};

const readRepositorySchemaVersion = async (repoRoot: string): Promise<number> => {
  const target = join(repoRoot, ".bearing/manifest.json");
  const targetState = await inspectInstallPath(target);
  if (targetState.kind !== "file" || targetState.linkCount !== 1) {
    throw new Error(
      `Bearing update is blocked because a Catalog repository has no safe regular manifest: ${repoRoot}. Repair or deactivate that repository before retrying.`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(target, "utf8"));
  } catch (error) {
    throw new Error(
      `Bearing update is blocked because a Catalog repository has no readable manifest: ${repoRoot}. Repair or deactivate that repository before retrying.`,
      { cause: error },
    );
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("schemaVersion" in parsed) ||
    typeof parsed.schemaVersion !== "number" ||
    !Number.isInteger(parsed.schemaVersion)
  ) {
    throw new Error(
      `Bearing update is blocked by an invalid repository manifest: ${repoRoot}. Repair it with a compatible Bearing version before retrying.`,
    );
  }
  return parsed.schemaVersion;
};

const assertCatalogCompatibility = async (homeDir: string): Promise<void> => {
  const state = await readCatalogState({ homeDir });
  if (state.state === "degraded") {
    throw new Error(
      "Bearing update is blocked while the Project Catalog uses its backup. Run `bearing catalog repair` and retry.",
    );
  }
  if (state.state === "failed") {
    throw new Error(
      "Bearing update is blocked because the Project Catalog is unusable. Follow Catalog recovery before retrying.",
    );
  }
  const incompatible: string[] = [];
  for (const entry of state.document.entries) {
    const schemaVersion = await readRepositorySchemaVersion(entry.repoRoot);
    if (schemaVersion !== 1) incompatible.push(`${entry.repoRoot} (schema ${schemaVersion})`);
  }
  if (incompatible.length > 0) {
    throw new Error(
      `Bearing update is blocked because this bundle reads repository schema 1 only: ${incompatible.join(
        ", ",
      )}. Install a compatible Bearing version or restore the version-specific verified backup; Bearing will not rewrite or discard repository state.`,
    );
  }
};

const removeExactTree = async (target: string): Promise<void> => {
  try {
    await rm(target, { recursive: true, force: false });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return;
    throw error;
  }
};

const inspectManagedLink = async (
  target: string,
  expectedSource: string,
  legacyCliSource?: string,
): Promise<ManagedLinkSnapshot> => {
  const state = await inspectInstallPath(target);
  if (state.kind === "missing") return { kind: "missing", target };
  if (state.kind === "symbolic-link") {
    const source = await readlink(target);
    if (source !== expectedSource && normalizedLinkTarget(target, source) !== expectedSource) {
      throw new Error(`Installation symlink target points outside the Bearing bundle: ${target}`);
    }
    return { kind: "symlink", target, source };
  }
  if (legacyCliSource !== undefined && state.kind === "file") {
    const bytes = await readFile(target);
    const legacyBytes = await readFile(legacyCliSource);
    if (!bytes.equals(legacyBytes) || state.linkCount !== 1) {
      throw new Error(`Installation target conflicts with existing content: ${target}`);
    }
    return { kind: "legacy-cli", target, bytes, mode: state.mode & 0o7777 };
  }
  throw new Error(`Installation symlink target conflicts with existing content: ${target}`);
};

const restoreManagedLink = async (snapshot: ManagedLinkSnapshot): Promise<void> => {
  try {
    await unlink(snapshot.target);
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
  if (snapshot.kind === "missing") return;
  await mkdir(dirname(snapshot.target), { recursive: true });
  if (snapshot.kind === "symlink") {
    await symlink(
      snapshot.source,
      snapshot.target,
      snapshot.source.endsWith("/dist/cli.js") ? "file" : "dir",
    );
    return;
  }
  await writeFileAtomically(snapshot.target, snapshot.bytes, snapshot.mode);
};

const replaceWithManagedLink = async (target: string, source: string): Promise<void> => {
  try {
    await unlink(target);
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
  await mkdir(dirname(target), { recursive: true });
  await symlink(source, target, source.endsWith("/dist/cli.js") ? "file" : "dir");
};

const listRegularFiles = async (root: string, directory = ""): Promise<readonly string[]> => {
  const entries = await readdir(join(root, directory), { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const locator = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await listRegularFiles(root, locator)));
    else if (entry.isFile()) files.push(locator);
    else throw new Error(`Bearing bundle contains an unsupported filesystem entry: ${locator}`);
  }
  return files.sort((left, right) => left.localeCompare(right, "en"));
};

const bundleMatches = async (
  current: string,
  staging: string,
  plans: readonly FileTargetPlan[],
): Promise<boolean> => {
  if ((await inspectInstallPath(current)).kind !== "directory") return false;
  const expected = plans
    .map((plan) => relative(staging, plan.target))
    .sort((left, right) => left.localeCompare(right, "en"));
  const actual = await listRegularFiles(current);
  if (actual.length !== expected.length || actual.some((value, index) => value !== expected[index]))
    return false;
  for (const plan of plans) {
    const locator = relative(staging, plan.target);
    if (!(await readFile(join(current, locator))).equals(plan.bytes)) return false;
    if (plan.executable) {
      const state = await inspectInstallPath(join(current, locator));
      if (state.kind !== "file" || (state.mode & 0o111) === 0) return false;
    }
  }
  return true;
};

const skillNamesForInstall = ["bearing"] as const;

const managedSurfaceTargets = (
  homeDir: string,
): readonly {
  target: string;
  source: string;
  selectedBy: AgentSurface;
}[] =>
  (["agent-skills", "claude"] as const).flatMap((surface) =>
    skillNamesForInstall.map((skillName) => ({
      target: join(
        homeDir,
        surface === "agent-skills" ? ".agents/skills" : ".claude/skills",
        skillName,
      ),
      source: join(homeDir, ".bearing/kit/current/skills", skillName),
      selectedBy: surface,
    })),
  );

export type InstallTransactionHooks = Readonly<{
  afterCurrentMoved?: () => Promise<void> | void;
}>;

export const installKit = async (
  options: InstallOptions,
  hooks: InstallTransactionHooks = {},
): Promise<InstallResult> => {
  if (options.surfaces.length === 0) throw new Error("Select at least one Agent Surface.");
  const homeDir = resolve(options.homeDir);
  const kitRoot = join(homeDir, ".bearing/kit");
  const current = join(kitRoot, "current");
  const currentState = await inspectInstallPath(current);
  if (currentState.kind === "symbolic-link" || currentState.kind === "file") {
    throw new Error(`Bearing current bundle must be a real directory: ${current}`);
  }
  const candidateVersion = await packageVersionAt(options.packageRoot);
  const installedVersion =
    currentState.kind === "directory" ? await installedPackageVersionAt(current) : undefined;
  if (installedVersion !== undefined) {
    assertSupportedDowngrade(candidateVersion, installedVersion, options.confirmDowngrade === true);
  }
  if (currentState.kind === "directory") await assertCatalogCompatibility(homeDir);

  const cliTarget = join(homeDir, ".bearing/bin/bearing");
  const cliSource = join(current, "dist/cli.js");
  const selected = new Set(options.surfaces);
  const surfaceTargets = managedSurfaceTargets(homeDir);
  await ensureInstallDirectoryTargets(homeDir, [
    cliTarget,
    ...surfaceTargets.map((item) => item.target),
  ]);
  const cliSnapshot = await inspectManagedLink(
    cliTarget,
    cliSource,
    currentState.kind === "directory" ? join(current, "dist/cli.js") : undefined,
  );
  const surfaceSnapshots = new Map<string, ManagedLinkSnapshot>();
  for (const item of surfaceTargets) {
    const state = await inspectInstallPath(item.target);
    if (selected.has(item.selectedBy)) {
      surfaceSnapshots.set(item.target, await inspectManagedLink(item.target, item.source));
      continue;
    }
    if (state.kind === "symbolic-link") {
      const source = await readlink(item.target);
      if (source === item.source || normalizedLinkTarget(item.target, source) === item.source) {
        surfaceSnapshots.set(item.target, { kind: "symlink", target: item.target, source });
      }
    }
  }

  const transaction = randomUUID();
  const staging = join(kitRoot, `.staged-${transaction}`);
  const backup = join(kitRoot, `.previous-${transaction}`);
  await ensureInstallDirectoryTargets(homeDir, [join(staging, "package.json"), cliTarget]);
  const bundlePlans = await buildBundlePlans(options.packageRoot, staging);
  let switched = false;
  let oldMoved = false;
  const mutatedLinks: ManagedLinkSnapshot[] = [];
  try {
    await applyInstallPlans(homeDir, bundlePlans);
    if ((await packageVersionAt(staging)) !== candidateVersion) {
      throw new Error("Staged Bearing bundle package version does not match the candidate.");
    }
    const linksAlreadyCurrent =
      cliSnapshot.kind === "symlink" &&
      surfaceTargets.every((item) => {
        const snapshot = surfaceSnapshots.get(item.target);
        return selected.has(item.selectedBy)
          ? snapshot?.kind === "symlink"
          : snapshot === undefined;
      });
    if ((await bundleMatches(current, staging, bundlePlans)) && linksAlreadyCurrent) {
      await removeExactTree(staging);
      return { outcome: "no-op", cliPath: cliTarget, changedTargets: [] };
    }
    if (cliSnapshot.kind !== "symlink") {
      mutatedLinks.push(cliSnapshot);
      await replaceWithManagedLink(cliTarget, cliSource);
    }
    for (const item of surfaceTargets) {
      const snapshot = surfaceSnapshots.get(item.target);
      if (selected.has(item.selectedBy)) {
        if (snapshot?.kind === "symlink") continue;
        if (snapshot === undefined) throw new Error(`Missing preflight state: ${item.target}`);
        mutatedLinks.push(snapshot);
        await replaceWithManagedLink(item.target, item.source);
        continue;
      }
      if (snapshot?.kind === "symlink") {
        mutatedLinks.push(snapshot);
        await unlink(item.target);
      }
    }
    if (currentState.kind === "directory") {
      await rename(current, backup);
      oldMoved = true;
      await hooks.afterCurrentMoved?.();
    }
    await rename(staging, current);
    switched = true;
  } catch (error) {
    const recoveryErrors: Error[] = [];
    try {
      if (switched) {
        const failed = join(kitRoot, `.failed-${transaction}`);
        await rename(current, failed);
        if (oldMoved) await rename(backup, current);
        await removeExactTree(failed);
      } else if (oldMoved) {
        await rename(backup, current);
      }
    } catch (recoveryError) {
      recoveryErrors.push(
        recoveryError instanceof Error
          ? recoveryError
          : new Error("Bundle recovery threw a non-Error value.", { cause: recoveryError }),
      );
    }
    for (const snapshot of [...mutatedLinks].reverse()) {
      try {
        await restoreManagedLink(snapshot);
      } catch (recoveryError) {
        recoveryErrors.push(
          recoveryError instanceof Error
            ? recoveryError
            : new Error("Managed-link recovery threw a non-Error value.", {
                cause: recoveryError,
              }),
        );
      }
    }
    try {
      await removeExactTree(staging);
    } catch (recoveryError) {
      recoveryErrors.push(
        recoveryError instanceof Error
          ? recoveryError
          : new Error("Staging cleanup threw a non-Error value.", { cause: recoveryError }),
      );
    }
    if (recoveryErrors.length > 0) {
      throw new Error("Bearing kit installation and complete-bundle recovery both failed.", {
        cause: new AggregateError([error, ...recoveryErrors]),
      });
    }
    throw new Error("Bearing kit installation failed; the previous complete bundle was restored.", {
      cause: error,
    });
  }
  if (oldMoved) await removeExactTree(backup);

  const changedTargets = [
    ".bearing/kit/current/",
    ...(cliSnapshot.kind === "symlink" ? [] : [relative(homeDir, cliTarget)]),
    ...mutatedLinks
      .filter((snapshot) => snapshot.target !== cliTarget)
      .map((snapshot) => relative(homeDir, snapshot.target)),
  ].sort();
  return {
    outcome: "applied",
    cliPath: cliTarget,
    changedTargets,
  };
};
