import { constants } from "node:fs";
import { lstat, open, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

export type RepositoryPathBoundaryReason =
  | "changed"
  | "outside"
  | "shared-file"
  | "symbolic-link"
  | "unsupported-shape";

export class RepositoryPathBoundaryError extends Error {
  readonly code = "ERR_BEARING_REPOSITORY_PATH_BOUNDARY";
  readonly reason: RepositoryPathBoundaryReason;

  constructor(reason: RepositoryPathBoundaryReason, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "RepositoryPathBoundaryError";
    this.reason = reason;
  }
}

const BOUNDARY_REASONS: ReadonlySet<string> = new Set<RepositoryPathBoundaryReason>([
  "changed",
  "outside",
  "shared-file",
  "symbolic-link",
  "unsupported-shape",
]);

export const isRepositoryPathBoundaryError = (
  error: unknown,
): error is RepositoryPathBoundaryError =>
  error instanceof RepositoryPathBoundaryError ||
  (error instanceof Error &&
    "code" in error &&
    error.code === "ERR_BEARING_REPOSITORY_PATH_BOUNDARY" &&
    "reason" in error &&
    typeof error.reason === "string" &&
    BOUNDARY_REASONS.has(error.reason));

const isContained = (root: string, target: string): boolean => {
  const fromRoot = relative(root, target);
  return (
    fromRoot === "" ||
    (fromRoot !== ".." && !fromRoot.startsWith(`..${sep}`) && !isAbsolute(fromRoot))
  );
};

export const resolveRepositoryRoot = async (repoRoot: string): Promise<string> => {
  try {
    const root = await realpath(resolve(repoRoot));
    const metadata = await stat(root);
    if (!metadata.isDirectory()) {
      throw new Error(`Repository root is unavailable or not a directory: ${repoRoot}`);
    }
    return root;
  } catch (error) {
    if (error instanceof Error && "code" in error) {
      throw new Error(`Repository root is unavailable or not a directory: ${repoRoot}`, {
        cause: error,
      });
    }
    throw error;
  }
};

export const resolveContainedPath = async (root: string, target: string): Promise<string> => {
  let apparent: Awaited<ReturnType<typeof lstat>>;
  try {
    apparent = await lstat(target);
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error.code === "ENOENT" || error.code === "ENOTDIR")
    ) {
      let ancestor = dirname(target);
      while (ancestor !== dirname(ancestor)) {
        try {
          await resolveContainedPath(root, ancestor);
          break;
        } catch (ancestorError) {
          if (
            ancestorError instanceof Error &&
            "code" in ancestorError &&
            (ancestorError.code === "ENOENT" || ancestorError.code === "ENOTDIR")
          ) {
            ancestor = dirname(ancestor);
            continue;
          }
          throw ancestorError;
        }
      }
    }
    throw error;
  }
  let resolved: string;
  try {
    resolved = await realpath(target);
  } catch (error) {
    if (apparent.isSymbolicLink()) {
      throw new RepositoryPathBoundaryError(
        "symbolic-link",
        `Repository input must not be a symbolic link: ${target}`,
        { cause: error },
      );
    }
    throw error;
  }
  if (!isContained(root, resolved)) {
    throw new RepositoryPathBoundaryError(
      "outside",
      `Repository input resolves outside the repository: ${target}`,
    );
  }
  if (apparent.isSymbolicLink()) {
    throw new RepositoryPathBoundaryError(
      "symbolic-link",
      `Repository input must not be a symbolic link: ${target}`,
    );
  }
  const metadata = await lstat(resolved);
  if (metadata.dev !== apparent.dev || metadata.ino !== apparent.ino) {
    throw new RepositoryPathBoundaryError(
      "changed",
      `Repository input changed while its boundary was being checked: ${target}`,
    );
  }
  if (metadata.isFile()) {
    if (metadata.nlink !== 1) {
      throw new RepositoryPathBoundaryError(
        "shared-file",
        `Repository input must be one unlinked regular file: ${target}`,
      );
    }
  } else if (!metadata.isDirectory()) {
    throw new RepositoryPathBoundaryError(
      "unsupported-shape",
      `Repository input must be a regular file or directory: ${target}`,
    );
  }
  return resolved;
};

const sameFile = (
  left: Readonly<{ dev: number | bigint; ino: number | bigint }>,
  right: Readonly<{ dev: number | bigint; ino: number | bigint }>,
): boolean => left.dev === right.dev && left.ino === right.ino;

export const readContainedFile = async (root: string, target: string): Promise<Buffer> => {
  const resolved = await resolveContainedPath(root, target);
  const before = await lstat(resolved);
  if (!before.isFile() || before.nlink !== 1) {
    throw new RepositoryPathBoundaryError(
      before.isFile() ? "shared-file" : "unsupported-shape",
      before.isFile()
        ? `Repository input must be one unlinked regular file: ${target}`
        : `Repository input must be a regular file: ${target}`,
    );
  }
  const handle = await open(resolved, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = await handle.stat();
    if (!sameFile(before, opened)) {
      throw new RepositoryPathBoundaryError(
        "changed",
        `Repository input changed before it could be read: ${target}`,
      );
    }
    if (!opened.isFile() || opened.nlink !== 1) {
      throw new RepositoryPathBoundaryError(
        opened.isFile() ? "shared-file" : "unsupported-shape",
        opened.isFile()
          ? `Repository input must be one unlinked regular file: ${target}`
          : `Repository input must be a regular file: ${target}`,
      );
    }
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (!sameFile(opened, after)) {
      throw new RepositoryPathBoundaryError(
        "changed",
        `Repository input changed while it was being read: ${target}`,
      );
    }
    if (after.nlink !== 1) {
      throw new RepositoryPathBoundaryError(
        "shared-file",
        `Repository input must be one unlinked regular file: ${target}`,
      );
    }
    return bytes;
  } finally {
    await handle.close();
  }
};
