import type { Stats } from "node:fs";
import { lstat } from "node:fs/promises";
import { join } from "node:path";

const CACHE_DIRECTORY = ".bearing/cache";
const FIXED_OUTPUTS = [
  "sync-report.md",
  "project-sitemap.md",
  "project-snapshot.json",
  "sync-receipt.json",
] as const;

type PathState =
  | Readonly<{ kind: "missing" }>
  | Readonly<{ kind: "available"; metadata: Stats }>
  | Readonly<{ kind: "unreadable" }>;

export type ProjectCacheBoundaryResult =
  | Readonly<{ kind: "safe" }>
  | Readonly<{
      kind: "unsafe";
      reason: "unsafe-boundary" | "unsafe-output" | "unreadable";
      locator: string;
    }>;

const inspect = async (target: string): Promise<PathState> => {
  try {
    return { kind: "available", metadata: await lstat(target) };
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error.code === "ENOENT" || error.code === "ENOTDIR")
    ) {
      return { kind: "missing" };
    }
    return { kind: "unreadable" };
  }
};

const unsafe = (
  reason: Exclude<ProjectCacheBoundaryResult, Readonly<{ kind: "safe" }>>["reason"],
  locator: string,
): ProjectCacheBoundaryResult => ({ kind: "unsafe", reason, locator });

export const inspectProjectCacheBoundary = async (
  repoRoot: string,
): Promise<ProjectCacheBoundaryResult> => {
  const bearing = await inspect(join(repoRoot, ".bearing"));
  if (bearing.kind === "unreadable") return unsafe("unreadable", ".bearing");
  if (
    bearing.kind !== "available" ||
    bearing.metadata.isSymbolicLink() ||
    !bearing.metadata.isDirectory()
  ) {
    return unsafe("unsafe-boundary", ".bearing");
  }

  const cache = await inspect(join(repoRoot, CACHE_DIRECTORY));
  if (cache.kind === "missing") return { kind: "safe" };
  if (cache.kind === "unreadable") return unsafe("unreadable", CACHE_DIRECTORY);
  if (cache.metadata.isSymbolicLink() || !cache.metadata.isDirectory()) {
    return unsafe("unsafe-boundary", CACHE_DIRECTORY);
  }

  for (const output of FIXED_OUTPUTS) {
    const locator = `${CACHE_DIRECTORY}/${output}`;
    const target = await inspect(join(repoRoot, CACHE_DIRECTORY, output));
    if (target.kind === "missing") continue;
    if (target.kind === "unreadable") return unsafe("unreadable", locator);
    if (
      target.metadata.isSymbolicLink() ||
      !target.metadata.isFile() ||
      target.metadata.nlink !== 1
    ) {
      return unsafe("unsafe-output", locator);
    }
  }
  return { kind: "safe" };
};
