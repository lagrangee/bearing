import { randomUUID } from "node:crypto";
import { basename } from "node:path";
import {
  CatalogDuplicateRepositoryError,
  CatalogEntryNotFoundError,
  CatalogMoveConfirmationRequiredError,
} from "./errors";
import type { CatalogDocument, CatalogEntry } from "./model";
import { parseCatalogDocument, parseCatalogRepositoryRoot } from "./model";
import { inspectRepository, type RepositoryInspection } from "./repository-inspection";
import { runCatalogTransaction } from "./transaction";

const manifestError = (inspection: Exclude<RepositoryInspection, { kind: "available" }>): Error => {
  if (inspection.availability === "invalid-manifest") {
    return new Error("Repository Bearing manifest is invalid.");
  }
  return new Error("Repository does not contain a safe Bearing manifest.");
};

const validateRepositoryManifest = async (repoRoot: string): Promise<void> => {
  const inspection = await inspectRepository(repoRoot, { requireCanonical: true });
  if (inspection.kind === "available") return;
  if (inspection.reason !== "manifest" || inspection.availability !== "invalid-manifest") {
    throw new Error("Repository does not contain a safe Bearing manifest.");
  }
  throw manifestError(inspection);
};

const validatedRepositoryRoot = async (repoRoot: string): Promise<string> => {
  const inspection = await inspectRepository(repoRoot, { requireCanonical: false });
  if (inspection.kind === "available") return inspection.canonicalRoot;
  if (inspection.reason === "manifest") throw manifestError(inspection);
  throw new Error(`Repository root is unavailable or not a directory: ${repoRoot}`);
};

const entryAt = (document: CatalogDocument, entryId: string): CatalogEntry => {
  const entry = document.entries.find((candidate) => candidate.entryId === entryId);
  if (entry === undefined) throw new CatalogEntryNotFoundError(entryId);
  return entry;
};

const replaceEntry = (document: CatalogDocument, replacement: CatalogEntry): CatalogDocument =>
  parseCatalogDocument({
    version: 1,
    entries: document.entries.map((entry) =>
      entry.entryId === replacement.entryId ? replacement : entry,
    ),
  });

const repositoryIsAvailable = async (repoRoot: string): Promise<boolean> => {
  const inspection = await inspectRepository(repoRoot, { requireCanonical: true });
  return inspection.kind === "available";
};

export type CatalogUpsertResult = Readonly<{
  outcome: "applied" | "no-op";
  entry: CatalogEntry;
}>;

export const upsertCatalogEntry = async (options: {
  readonly homeDir: string;
  readonly repoRoot: string;
  readonly createEntryId?: () => string;
  readonly lockTimeoutMs?: number;
}): Promise<CatalogUpsertResult> => {
  const canonicalRoot = await validatedRepositoryRoot(options.repoRoot);
  return runCatalogTransaction<CatalogUpsertResult>({
    homeDir: options.homeDir,
    ...(options.lockTimeoutMs === undefined ? {} : { lockTimeoutMs: options.lockTimeoutMs }),
    mutate: async (current) => {
      await validateRepositoryManifest(canonicalRoot);
      const existing = current.entries.find((entry) => entry.repoRoot === canonicalRoot);
      if (existing !== undefined) return { result: { outcome: "no-op", entry: existing } };
      const entry = {
        entryId: (options.createEntryId ?? randomUUID)(),
        repoRoot: canonicalRoot,
        displayName: basename(canonicalRoot),
      };
      const next = parseCatalogDocument({ version: 1, entries: [...current.entries, entry] });
      return { result: { outcome: "applied", entry }, next };
    },
  });
};

export type CatalogEntryMutationResult = Readonly<{
  outcome: "applied" | "no-op";
  entry: CatalogEntry;
}>;

export const renameCatalogEntry = async (options: {
  readonly homeDir: string;
  readonly entryId: string;
  readonly displayName: string;
  readonly lockTimeoutMs?: number;
}): Promise<CatalogEntryMutationResult> =>
  runCatalogTransaction<CatalogEntryMutationResult>({
    homeDir: options.homeDir,
    ...(options.lockTimeoutMs === undefined ? {} : { lockTimeoutMs: options.lockTimeoutMs }),
    mutate: (current) => {
      const existing = entryAt(current, options.entryId);
      const replacement = { ...existing, displayName: options.displayName };
      const next = replaceEntry(current, replacement);
      const entry = entryAt(next, options.entryId);
      return entry.displayName === existing.displayName
        ? { result: { outcome: "no-op", entry } }
        : { result: { outcome: "applied", entry }, next };
    },
  });

export type CatalogRemovalResult =
  | Readonly<{ outcome: "applied"; removedEntry: CatalogEntry }>
  | Readonly<{ outcome: "no-op" }>;

const removeCatalogEntry = async (
  options: Readonly<{ homeDir: string; lockTimeoutMs?: number }>,
  matches: (entry: CatalogEntry) => boolean,
): Promise<CatalogRemovalResult> =>
  runCatalogTransaction<CatalogRemovalResult>({
    homeDir: options.homeDir,
    ...(options.lockTimeoutMs === undefined ? {} : { lockTimeoutMs: options.lockTimeoutMs }),
    mutate: (current) => {
      const removedEntry = current.entries.find(matches);
      if (removedEntry === undefined) return { result: { outcome: "no-op" } };
      const next = parseCatalogDocument({
        version: 1,
        entries: current.entries.filter((entry) => entry.entryId !== removedEntry.entryId),
      });
      return { result: { outcome: "applied", removedEntry }, next };
    },
  });

export const forgetCatalogEntry = async (options: {
  readonly homeDir: string;
  readonly entryId: string;
  readonly lockTimeoutMs?: number;
}): Promise<CatalogRemovalResult> =>
  removeCatalogEntry(options, (entry) => entry.entryId === options.entryId);

export const removeCatalogEntryByRepoRoot = async (options: {
  readonly homeDir: string;
  readonly repoRoot: string;
  readonly lockTimeoutMs?: number;
}): Promise<CatalogRemovalResult> => {
  const canonicalRoot = parseCatalogRepositoryRoot(options.repoRoot);
  return removeCatalogEntry(options, (entry) => entry.repoRoot === canonicalRoot);
};

export const relinkCatalogEntry = async (options: {
  readonly homeDir: string;
  readonly entryId: string;
  readonly newRepoRoot: string;
  readonly confirmMove?: boolean;
  readonly lockTimeoutMs?: number;
}): Promise<CatalogEntryMutationResult> => {
  const canonicalRoot = await validatedRepositoryRoot(options.newRepoRoot);
  return runCatalogTransaction<CatalogEntryMutationResult>({
    homeDir: options.homeDir,
    ...(options.lockTimeoutMs === undefined ? {} : { lockTimeoutMs: options.lockTimeoutMs }),
    mutate: async (current) => {
      const existing = entryAt(current, options.entryId);
      if (existing.repoRoot === canonicalRoot) {
        return { result: { outcome: "no-op", entry: existing } };
      }
      if (current.entries.some((entry) => entry.repoRoot === canonicalRoot)) {
        throw new CatalogDuplicateRepositoryError();
      }
      if ((await repositoryIsAvailable(existing.repoRoot)) && options.confirmMove !== true) {
        throw new CatalogMoveConfirmationRequiredError();
      }
      if ((await validatedRepositoryRoot(options.newRepoRoot)) !== canonicalRoot) {
        throw new Error("Repository location changed during Catalog relink.");
      }
      const entry = { ...existing, repoRoot: canonicalRoot };
      return { result: { outcome: "applied", entry }, next: replaceEntry(current, entry) };
    },
  });
};
