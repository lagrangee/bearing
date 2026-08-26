import { realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, posix, relative, resolve, sep } from "node:path";
import { normalizeLocator } from "../../fingerprint";

export const canonicalizeLocalNativeReference = async (
  repositoryRoot: string,
  reference: string,
): Promise<string> => {
  const target = isAbsolute(reference) ? resolve(reference) : resolve(repositoryRoot, reference);
  const canonicalTarget = isAbsolute(reference)
    ? await realpath(target).catch(async (error: unknown) => {
        if (
          !(error instanceof Error) ||
          !("code" in error) ||
          (error.code !== "ENOENT" && error.code !== "ENOTDIR")
        ) {
          throw error;
        }
        return join(await realpath(dirname(target)), basename(target));
      })
    : target;
  const repositoryRelative = relative(repositoryRoot, canonicalTarget);
  if (
    repositoryRelative === "" ||
    repositoryRelative === ".." ||
    repositoryRelative.startsWith(`..${sep}`) ||
    isAbsolute(repositoryRelative)
  ) {
    throw new Error("Local native reference is outside the repository.");
  }
  return normalizeLocator(repositoryRelative.split(sep).join("/"));
};

export const localNativeReferenceBelongsToScope = (
  nativeScope: string,
  reference: string,
): boolean => {
  const scope = normalizeLocator(nativeScope);
  const subject = normalizeLocator(reference);
  const withinScope = posix.relative(scope, subject);
  if (
    withinScope === "" ||
    withinScope === ".." ||
    withinScope.startsWith("../") ||
    posix.isAbsolute(withinScope)
  ) {
    return false;
  }
  return (
    (posix.dirname(withinScope) === "." && withinScope.endsWith(".md")) ||
    (posix.dirname(withinScope) === "issues" && withinScope.endsWith(".md"))
  );
};
