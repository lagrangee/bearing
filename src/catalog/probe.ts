import type { CatalogEntry, ProbedCatalogEntry } from "./model";
import { inspectRepository } from "./repository-inspection";
import { readCatalogState } from "./store";

const probeEntry = async (entry: CatalogEntry): Promise<ProbedCatalogEntry> => {
  const inspection = await inspectRepository(entry.repoRoot, { requireCanonical: true });
  if (inspection.kind === "available") return { ...entry, availability: "available" };
  return {
    ...entry,
    availability: inspection.availability,
    ...(inspection.reason === "non-canonical"
      ? { detail: "Repository locator is no longer canonical." }
      : {}),
  };
};

const compareEntries = (left: CatalogEntry, right: CatalogEntry): number => {
  const byName = left.displayName.localeCompare(right.displayName, "en", { sensitivity: "base" });
  return byName !== 0 ? byName : left.repoRoot.localeCompare(right.repoRoot, "en");
};

export const readCatalog = async (options: {
  readonly homeDir: string;
}): Promise<
  | Readonly<{ state: "ready"; entries: readonly ProbedCatalogEntry[] }>
  | Readonly<{
      state: "degraded";
      entries: readonly ProbedCatalogEntry[];
      diagnostic: Readonly<{ code: "catalog-current-invalid"; message: string }>;
    }>
  | Readonly<{
      state: "failed";
      entries: readonly ProbedCatalogEntry[];
      diagnostic: Readonly<{ code: "catalog-unusable"; message: string }>;
    }>
> => {
  const catalog = await readCatalogState(options);
  if (catalog.state === "failed") return { ...catalog, entries: [] };
  const sorted = catalog.document.entries.toSorted(compareEntries);
  const entries = await Promise.all(sorted.map(probeEntry));
  return catalog.state === "degraded"
    ? { state: "degraded", entries, diagnostic: catalog.diagnostic }
    : { state: "ready", entries };
};
