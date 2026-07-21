import { join } from "node:path";
import packageMetadata from "../../package.json";
import { readProjectSnapshotCache } from "../project-snapshot/cache";
import type { ProjectSnapshot } from "../project-snapshot/contract";
import { readProjectSitemapCache } from "../sitemap-cache";
import { readSyncReceipt } from "../sync-receipt";
import type { ProjectView, SnapshotCacheView } from "./project-contract";
import type { AvailableProjectEntry } from "./project-entry";
import type { ProjectMaterializationResult } from "./project-materializer";

const cacheView = (
  result: Awaited<ReturnType<typeof readProjectSnapshotCache>>,
  expectedPackageVersion: string,
): SnapshotCacheView => {
  if (
    (result.kind === "available" || result.kind === "behind") &&
    result.snapshot.producer.packageVersion !== expectedPackageVersion
  ) {
    return {
      state: "version-mismatch",
      diagnostic: {
        code: "snapshot-version-mismatch",
        message: "The cached Project Snapshot version is not supported by this Host.",
      },
    };
  }
  switch (result.kind) {
    case "available":
      return { state: "available", snapshot: result.snapshot };
    case "behind":
      return { state: "behind", snapshot: result.snapshot };
    case "missing":
      return { state: "missing" };
    case "malformed":
      return {
        state: "malformed",
        diagnostic: {
          code: "snapshot-malformed",
          message: "The cached Project Snapshot cannot be interpreted.",
        },
      };
    case "unsupported":
      return {
        state: "version-mismatch",
        diagnostic: {
          code: "snapshot-version-mismatch",
          message: "The cached Project Snapshot version is not supported by this Host.",
        },
      };
  }
};
const trustedSnapshot = (cache: SnapshotCacheView): ProjectSnapshot | undefined =>
  cache.state === "available" || cache.state === "behind" ? cache.snapshot : undefined;
const diagnosticCounts = (snapshot: ProjectSnapshot | undefined) => {
  if (snapshot === undefined) return null;
  const blocking = snapshot.diagnostics.filter(
    (diagnostic) => diagnostic.impact === "blocking",
  ).length;
  const nonBlocking = snapshot.diagnostics.length - blocking;
  return { blocking, nonBlocking, total: snapshot.diagnostics.length };
};

export type ProjectRepoView = Pick<ProjectView, "cache" | "diagnosticCounts">;
type SitemapRead = Awaited<ReturnType<typeof readProjectSitemapCache>>;
export type ProjectViewReaders = Readonly<{
  readSitemap: typeof readProjectSitemapCache;
  readSnapshot: typeof readProjectSnapshotCache;
  readReceipt: typeof readSyncReceipt;
}>;

const defaultReaders: ProjectViewReaders = {
  readSitemap: readProjectSitemapCache,
  readSnapshot: readProjectSnapshotCache,
  readReceipt: readSyncReceipt,
};

export class ProjectViewConsistencyError extends Error {
  readonly name = "ProjectViewConsistencyError";

  constructor() {
    super("Project cache changed while a consistent view was being read.");
  }
}

const sameSitemapGeneration = (first: SitemapRead, second: SitemapRead): boolean => {
  if (first.kind !== second.kind) return false;
  switch (first.kind) {
    case "available":
      return (
        second.kind === "available" &&
        first.envelope.version === second.envelope.version &&
        first.envelope.inputFingerprint === second.envelope.inputFingerprint
      );
    case "malformed":
      return second.kind === "malformed" && first.reason === second.reason;
    case "unsupported":
      return second.kind === "unsupported" && first.version === second.version;
    case "missing":
      return true;
  }
};

export const composeProjectView = (
  entry: AvailableProjectEntry,
  repoView: ProjectRepoView,
): ProjectView => ({
  project: {
    entryId: entry.entryId,
    displayName: entry.displayName,
    availability: "available",
  },
  ...repoView,
});

export const projectRepoViewFromMaterialization = (
  result: ProjectMaterializationResult,
): ProjectRepoView => ({
  cache: {
    snapshot: { state: "available", snapshot: result.snapshot },
    receipt: result.receipt ?? null,
    retained: false,
  },
  diagnosticCounts: diagnosticCounts(result.snapshot),
});

export const readProjectRepoView = async (
  repoRoot: string,
  retainOnFailure = false,
  expectedPackageVersion = packageMetadata.version,
  readers: ProjectViewReaders = defaultReaders,
): Promise<ProjectRepoView> => {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const sitemap = await readers.readSitemap(repoRoot);
    const sitemapBasis =
      sitemap.kind === "available" ? sitemap.envelope.inputFingerprint : undefined;
    const snapshotResult = await readers.readSnapshot(repoRoot, sitemapBasis);
    const snapshot = cacheView(snapshotResult, expectedPackageVersion);
    const receiptResult = await readers.readReceipt(
      join(repoRoot, ".bearing/cache/sync-receipt.json"),
    );
    const revalidated = await readers.readSitemap(repoRoot);
    if (!sameSitemapGeneration(sitemap, revalidated)) continue;

    const trusted = trustedSnapshot(snapshot);
    const visibleBasis = trusted?.basis.sitemapFingerprint ?? sitemapBasis;
    // A newer Receipt beside a trustworthy behind Snapshot is a normal post-Sync state.
    // It cannot describe the visible Snapshot, so isolate it while preserving recovery access.
    const receipt =
      receiptResult.kind === "available" &&
      receiptResult.receipt.sitemap.fingerprint === visibleBasis
        ? receiptResult.receipt
        : null;

    return {
      cache: {
        snapshot,
        receipt,
        retained: retainOnFailure && trusted !== undefined,
      },
      diagnosticCounts: diagnosticCounts(trusted),
    };
  }
  throw new ProjectViewConsistencyError();
};

export const readProjectView = async (
  entry: AvailableProjectEntry,
  retained = false,
  expectedPackageVersion = packageMetadata.version,
): Promise<ProjectView> =>
  composeProjectView(
    entry,
    await readProjectRepoView(entry.repoRoot, retained, expectedPackageVersion),
  );
