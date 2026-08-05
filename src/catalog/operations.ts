import { randomUUID } from "node:crypto";
import { basename } from "node:path";
import { parseCatalogEntryId } from "./entry-id";
import {
  CatalogDuplicateRepositoryError,
  CatalogEntryNotFoundError,
  CatalogMoveConfirmationRequiredError,
} from "./errors";
import type { CatalogDocument, CatalogEntry } from "./model";
import { catalogEntrySchema, parseCatalogDocument, parseCatalogRepositoryRoot } from "./model";
import { readCatalogDocument } from "./recovery";
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
}): Promise<CatalogUpsertResult> => {
  const canonicalRoot = await validatedRepositoryRoot(options.repoRoot);
  await validateRepositoryManifest(canonicalRoot);
  const candidateEntry = catalogEntrySchema.parse({
    entryId: parseCatalogEntryId((options.createEntryId ?? randomUUID)()),
    repoRoot: canonicalRoot,
    displayName: basename(canonicalRoot),
  });
  return runCatalogTransaction<CatalogUpsertResult>({
    homeDir: options.homeDir,
    mutate: (current) => {
      const existing = current.entries.find((entry) => entry.repoRoot === canonicalRoot);
      if (existing !== undefined) return { result: { outcome: "no-op", entry: existing } };
      const next = parseCatalogDocument({
        version: 1,
        entries: [...current.entries, candidateEntry],
      });
      return { result: { outcome: "applied", entry: candidateEntry }, next };
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
}): Promise<CatalogEntryMutationResult> => {
  const entryId = parseCatalogEntryId(options.entryId);
  const displayName = catalogEntrySchema.shape.displayName.parse(options.displayName);
  return runCatalogTransaction<CatalogEntryMutationResult>({
    homeDir: options.homeDir,
    mutate: (current) => {
      const existing = entryAt(current, entryId);
      const replacement = { ...existing, displayName };
      const next = replaceEntry(current, replacement);
      const entry = entryAt(next, entryId);
      return entry.displayName === existing.displayName
        ? { result: { outcome: "no-op", entry } }
        : { result: { outcome: "applied", entry }, next };
    },
  });
};

export type CatalogRemovalResult =
  | Readonly<{ outcome: "applied"; removedEntry: CatalogEntry }>
  | Readonly<{ outcome: "no-op" }>;

const removeCatalogEntry = async (
  options: Readonly<{ homeDir: string }>,
  matches: (entry: CatalogEntry) => boolean,
): Promise<CatalogRemovalResult> =>
  runCatalogTransaction<CatalogRemovalResult>({
    homeDir: options.homeDir,
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
}): Promise<CatalogRemovalResult> => {
  const entryId = parseCatalogEntryId(options.entryId);
  return removeCatalogEntry(options, (entry) => entry.entryId === entryId);
};

export const removeCatalogEntryByRepoRoot = async (options: {
  readonly homeDir: string;
  readonly repoRoot: string;
}): Promise<CatalogRemovalResult> => {
  const canonicalRoot = parseCatalogRepositoryRoot(options.repoRoot);
  return removeCatalogEntry(options, (entry) => entry.repoRoot === canonicalRoot);
};

export const removeCatalogEntryByExactIdentity = async (options: {
  readonly homeDir: string;
  readonly repoRoot: string;
  readonly expectedEntry?: CatalogEntry;
  readonly assertBeforeMutation?: () => Promise<void>;
}): Promise<CatalogRemovalResult> => {
  const canonicalRoot = parseCatalogRepositoryRoot(options.repoRoot);
  const expectedEntry =
    options.expectedEntry === undefined
      ? undefined
      : catalogEntrySchema.parse(options.expectedEntry);
  await options.assertBeforeMutation?.();
  return runCatalogTransaction<CatalogRemovalResult>({
    homeDir: options.homeDir,
    mutate: (current) => {
      const matching = current.entries.find((entry) => entry.repoRoot === canonicalRoot);
      if (expectedEntry === undefined) {
        if (matching !== undefined) {
          throw new Error(
            "Project Catalog gained an unreviewed matching entry after Purge confirmation.",
          );
        }
        return { result: { outcome: "no-op" } };
      }
      if (matching === undefined) return { result: { outcome: "no-op" } };
      if (JSON.stringify(matching) !== JSON.stringify(expectedEntry)) {
        throw new Error(
          "Project Catalog matching entry identity changed after Purge confirmation.",
        );
      }
      const next = parseCatalogDocument({
        version: 1,
        entries: current.entries.filter((entry) => entry.entryId !== matching.entryId),
      });
      return { result: { outcome: "applied", removedEntry: matching }, next };
    },
  });
};

export const relinkCatalogEntry = async (options: {
  readonly homeDir: string;
  readonly entryId: string;
  readonly newRepoRoot: string;
  readonly confirmMove?: boolean;
}): Promise<CatalogEntryMutationResult> => {
  const entryId = parseCatalogEntryId(options.entryId);
  const canonicalRoot = await validatedRepositoryRoot(options.newRepoRoot);
  const before = await readCatalogDocument({ homeDir: options.homeDir });
  const beforeEntry = entryAt(before, entryId);
  const oldRepositoryWasAvailable = await repositoryIsAvailable(beforeEntry.repoRoot);
  return runCatalogTransaction<CatalogEntryMutationResult>({
    homeDir: options.homeDir,
    mutate: (current) => {
      const existing = entryAt(current, entryId);
      if (existing.repoRoot === canonicalRoot) {
        return { result: { outcome: "no-op", entry: existing } };
      }
      if (current.entries.some((entry) => entry.repoRoot === canonicalRoot)) {
        throw new CatalogDuplicateRepositoryError();
      }
      if (existing.repoRoot !== beforeEntry.repoRoot) {
        throw new Error("Repository location changed during Catalog relink.");
      }
      if (oldRepositoryWasAvailable && options.confirmMove !== true) {
        throw new CatalogMoveConfirmationRequiredError();
      }
      const entry = { ...existing, repoRoot: canonicalRoot };
      return { result: { outcome: "applied", entry }, next: replaceEntry(current, entry) };
    },
  });
};
