import { lstat } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

export type InstallPathState = Readonly<
  | { kind: "missing" }
  | { kind: "file"; mode: number; linkCount: number }
  | { kind: "directory" }
  | { kind: "symbolic-link" }
>;

export const inspectInstallPath = async (target: string): Promise<InstallPathState> => {
  try {
    const metadata = await lstat(target);
    if (metadata.isSymbolicLink()) return { kind: "symbolic-link" };
    if (metadata.isDirectory()) return { kind: "directory" };
    if (metadata.isFile()) return { kind: "file", mode: metadata.mode, linkCount: metadata.nlink };
    throw new Error(`Installation target has an unsupported file type: ${target}`);
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error.code === "ENOENT" || error.code === "ENOTDIR")
    ) {
      return { kind: "missing" };
    }
    throw error;
  }
};

export const ensureInstallDirectoryTargets = async (
  homeDir: string,
  targets: readonly string[],
): Promise<void> => {
  const root = resolve(homeDir);
  const rootState = await inspectInstallPath(root);
  if (rootState.kind === "symbolic-link") {
    throw new Error(`Installation home cannot be a symbolic link: ${root}`);
  }
  if (rootState.kind !== "directory") {
    throw new Error(`Installation home is unavailable or not a directory: ${root}`);
  }
  for (const target of targets) {
    const absoluteTarget = resolve(target);
    if (!isAbsolute(target) || target !== absoluteTarget) {
      throw new Error(`Installation target must be a normalized absolute path: ${target}`);
    }
    const fromRoot = relative(root, absoluteTarget);
    if (
      fromRoot === "" ||
      fromRoot === ".." ||
      fromRoot.startsWith(`..${sep}`) ||
      isAbsolute(fromRoot)
    ) {
      throw new Error(`Installation target is outside the selected home: ${target}`);
    }
    let parent = dirname(absoluteTarget);
    while (parent !== root) {
      const inspected = await inspectInstallPath(parent);
      if (inspected.kind === "symbolic-link") {
        throw new Error(`Installation target cannot use a symbolic link: ${parent}`);
      }
      if (inspected.kind === "file") {
        throw new Error(`Installation target is not a directory: ${parent}`);
      }
      parent = dirname(parent);
    }
  }
};

export const missingInstallParentDirectories = async (
  homeDir: string,
  targets: readonly string[],
): Promise<readonly string[]> => {
  const root = resolve(homeDir);
  const missing = new Set<string>();
  for (const target of targets) {
    let parent = dirname(target);
    while (parent !== root) {
      if ((await inspectInstallPath(parent)).kind === "missing") missing.add(parent);
      parent = dirname(parent);
    }
  }
  return [...missing].sort((left, right) => right.length - left.length);
};

export const preflightInstallTargets = async (
  homeDir: string,
  targets: readonly string[],
): Promise<void> => {
  await ensureInstallDirectoryTargets(homeDir, targets);
  for (const target of targets) {
    const inspected = await inspectInstallPath(target);
    if (inspected.kind === "symbolic-link") {
      throw new Error(`Installation target cannot use a symbolic link: ${target}`);
    }
    if (inspected.kind === "directory") {
      throw new Error(`Installation file target is a directory: ${target}`);
    }
  }
};
