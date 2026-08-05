import type { Stats } from "node:fs";
import { lstat, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import writeFileAtomic from "write-file-atomic";
import { z } from "zod";
import type { ProjectSnapshot } from "./contract";
import { PROJECT_SNAPSHOT_VERSION, projectSnapshotSchema } from "./schema";

const CACHE_DIRECTORY = ".bearing/cache";
const SNAPSHOT_FILENAME = "project-snapshot.json";

export type ProjectSnapshotCacheMalformedReason =
  | "unsafe-cache-boundary"
  | "unreadable-cache-boundary"
  | "unsafe-cache-file"
  | "unreadable-cache-file"
  | "invalid-json"
  | "invalid-snapshot";

export type ProjectSnapshotCacheResult =
  | Readonly<{ kind: "missing" }>
  | Readonly<{ kind: "available"; snapshot: ProjectSnapshot }>
  | Readonly<{ kind: "behind"; snapshot: ProjectSnapshot }>
  | Readonly<{ kind: "malformed"; reason: ProjectSnapshotCacheMalformedReason }>
  | Readonly<{ kind: "unsupported"; schemaVersion: number }>;

type InspectedPath =
  | Readonly<{ kind: "missing" }>
  | Readonly<{ kind: "available"; metadata: Stats }>
  | Readonly<{ kind: "unreadable" }>;

type WriteTarget =
  | Readonly<{ kind: "missing" }>
  | Readonly<{ kind: "regular-file"; mode: number }>
  | Readonly<{ kind: "unsafe" }>;

export class ProjectSnapshotCacheBoundaryError extends Error {
  readonly name = "ProjectSnapshotCacheBoundaryError";

  constructor(readonly target: string) {
    super(`Project Snapshot cache has an unsafe cache boundary: ${target}`);
  }
}

export class ProjectSnapshotCacheTargetError extends Error {
  readonly name = "ProjectSnapshotCacheTargetError";

  constructor(readonly target: string) {
    super(`Project Snapshot cache target must be one unlinked regular file: ${target}`);
  }
}

const isMissingPathError = (error: unknown): boolean =>
  error instanceof Error &&
  "code" in error &&
  (error.code === "ENOENT" || error.code === "ENOTDIR");

const inspectPath = async (target: string): Promise<InspectedPath> => {
  try {
    return { kind: "available", metadata: await lstat(target) };
  } catch (error) {
    if (!(error instanceof Error)) return { kind: "unreadable" };
    if (isMissingPathError(error)) return { kind: "missing" };
    return { kind: "unreadable" };
  }
};

const malformed = (reason: ProjectSnapshotCacheMalformedReason): ProjectSnapshotCacheResult => ({
  kind: "malformed",
  reason,
});

const cachePaths = (repoRoot: string) => {
  const bearing = join(repoRoot, ".bearing");
  const cache = join(repoRoot, CACHE_DIRECTORY);
  return { bearing, cache, target: join(cache, SNAPSHOT_FILENAME) };
};

const inspectReadBoundary = async (
  repoRoot: string,
): Promise<ProjectSnapshotCacheResult | Readonly<{ kind: "safe"; target: string }>> => {
  const paths = cachePaths(repoRoot);
  for (const directory of [paths.bearing, paths.cache]) {
    const inspected = await inspectPath(directory);
    if (inspected.kind === "missing") return { kind: "missing" };
    if (inspected.kind === "unreadable") return malformed("unreadable-cache-boundary");
    if (inspected.metadata.isSymbolicLink() || !inspected.metadata.isDirectory()) {
      return malformed("unsafe-cache-boundary");
    }
  }
  return { kind: "safe", target: paths.target };
};

const inspectWriteTarget = async (target: string): Promise<WriteTarget> => {
  const inspected = await inspectPath(target);
  if (inspected.kind === "missing") return { kind: "missing" };
  if (inspected.kind === "unreadable") return { kind: "unsafe" };
  if (
    inspected.metadata.isFile() &&
    !inspected.metadata.isSymbolicLink() &&
    inspected.metadata.nlink === 1
  ) {
    return { kind: "regular-file", mode: inspected.metadata.mode };
  }
  return { kind: "unsafe" };
};

const ensureWriteBoundary = async (repoRoot: string): Promise<string> => {
  const paths = cachePaths(repoRoot);
  const bearing = await inspectPath(paths.bearing);
  if (
    bearing.kind !== "available" ||
    bearing.metadata.isSymbolicLink() ||
    !bearing.metadata.isDirectory()
  ) {
    throw new ProjectSnapshotCacheBoundaryError(paths.bearing);
  }

  let cache = await inspectPath(paths.cache);
  if (cache.kind === "missing") {
    try {
      await mkdir(paths.cache, { mode: 0o755 });
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
    }
    cache = await inspectPath(paths.cache);
  }
  if (
    cache.kind !== "available" ||
    cache.metadata.isSymbolicLink() ||
    !cache.metadata.isDirectory()
  ) {
    throw new ProjectSnapshotCacheBoundaryError(paths.cache);
  }
  return paths.target;
};

export const readProjectSnapshotCache = async (
  repoRoot: string,
  currentSitemapFingerprint?: string,
): Promise<ProjectSnapshotCacheResult> => {
  const boundary = await inspectReadBoundary(repoRoot);
  if (boundary.kind !== "safe") return boundary;

  const inspected = await inspectPath(boundary.target);
  if (inspected.kind === "missing") return { kind: "missing" };
  if (inspected.kind === "unreadable") return malformed("unreadable-cache-file");
  if (
    inspected.metadata.isSymbolicLink() ||
    !inspected.metadata.isFile() ||
    inspected.metadata.nlink !== 1
  ) {
    return malformed("unsafe-cache-file");
  }

  let document: unknown;
  try {
    document = JSON.parse(await readFile(boundary.target, "utf8"));
  } catch (error) {
    if (error instanceof SyntaxError) return malformed("invalid-json");
    if (isMissingPathError(error)) return { kind: "missing" };
    return malformed("unreadable-cache-file");
  }

  const version = z.object({ schemaVersion: z.number().int() }).safeParse(document);
  if (!version.success) return malformed("invalid-snapshot");
  if (version.data.schemaVersion !== PROJECT_SNAPSHOT_VERSION) {
    return { kind: "unsupported", schemaVersion: version.data.schemaVersion };
  }
  const parsed = projectSnapshotSchema.safeParse(document);
  if (!parsed.success) return malformed("invalid-snapshot");
  if (
    currentSitemapFingerprint !== undefined &&
    parsed.data.basis.sitemapFingerprint !== currentSitemapFingerprint
  ) {
    return { kind: "behind", snapshot: parsed.data };
  }
  return { kind: "available", snapshot: parsed.data };
};

export const writeProjectSnapshotCache = async (
  repoRoot: string,
  snapshot: ProjectSnapshot,
): Promise<void> => {
  const validated = projectSnapshotSchema.parse(snapshot);
  const target = await ensureWriteBoundary(repoRoot);
  const targetState = await inspectWriteTarget(target);
  if (targetState.kind === "unsafe") throw new ProjectSnapshotCacheTargetError(target);
  const mode = targetState.kind === "regular-file" ? targetState.mode & 0o777 : 0o644;
  const bytes = Buffer.from(`${JSON.stringify(validated, null, 2)}\n`, "utf8");
  await writeFileAtomic(target, bytes, { mode });
};
