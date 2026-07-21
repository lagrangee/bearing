import { lstat } from "node:fs/promises";
import { join } from "node:path";
import { readProjectSnapshotCache } from "../project-snapshot/cache";
import type { SourceRecord } from "../project-snapshot/contract";
import { sourceReferenceSchema } from "../project-snapshot/source-reference";
import { readProjectSitemapCache } from "../sitemap-cache";
import type { CatalogReadResult } from "./contract";
import { resolveProjectEntry } from "./project-entry";

export type ProjectSourceResolutionCode =
  | "project-unavailable"
  | "snapshot-unavailable"
  | "source-reference-not-found"
  | "source-target-unavailable"
  | "unsafe-source-target";

export type ProjectSourceResolutionResult =
  | Readonly<{ kind: "resolved"; source: SourceRecord }>
  | Readonly<{ kind: "rejected"; code: ProjectSourceResolutionCode }>;

const rejected = (code: ProjectSourceResolutionCode): ProjectSourceResolutionResult => ({
  kind: "rejected",
  code,
});

type SourceTargetState = "safe" | "missing" | "unsafe";

const inspectSourceTarget = async (
  repoRoot: string,
  locator: string,
): Promise<SourceTargetState> => {
  const segments = locator.split("/");
  let target = repoRoot;
  for (const [index, segment] of segments.entries()) {
    target = join(target, segment);
    let metadata: Awaited<ReturnType<typeof lstat>>;
    try {
      metadata = await lstat(target);
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        (error.code === "ENOENT" || error.code === "ENOTDIR")
      ) {
        return "missing";
      }
      return "unsafe";
    }
    if (metadata.isSymbolicLink()) return "unsafe";
    const isTarget = index === segments.length - 1;
    if (!isTarget && !metadata.isDirectory()) return "unsafe";
    if (isTarget && (!metadata.isFile() || metadata.nlink !== 1)) return "unsafe";
  }
  return "safe";
};

export const resolveProjectSourceReference = async (options: {
  readonly entryId: string;
  readonly reference: string;
  readonly readCatalog: () => Promise<CatalogReadResult>;
}): Promise<ProjectSourceResolutionResult> => {
  const reference = sourceReferenceSchema.safeParse(options.reference);
  if (!reference.success) return rejected("source-reference-not-found");

  const entry = await resolveProjectEntry({
    entryId: options.entryId,
    readCatalog: options.readCatalog,
  });
  if (entry.kind !== "available") return rejected("project-unavailable");

  const sitemap = await readProjectSitemapCache(entry.entry.repoRoot);
  if (sitemap.kind !== "available") return rejected("snapshot-unavailable");
  const cache = await readProjectSnapshotCache(
    entry.entry.repoRoot,
    sitemap.envelope.inputFingerprint,
  );
  if (cache.kind !== "available") return rejected("snapshot-unavailable");

  const source = cache.snapshot.sources.find((candidate) => candidate.reference === reference.data);
  if (source === undefined) return rejected("source-reference-not-found");
  const target = await inspectSourceTarget(entry.entry.repoRoot, source.displayLocator);
  if (target === "missing") return rejected("source-target-unavailable");
  if (target === "unsafe") {
    return rejected("unsafe-source-target");
  }
  return { kind: "resolved", source };
};
