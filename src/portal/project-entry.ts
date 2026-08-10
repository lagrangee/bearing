import type { CatalogAvailability } from "../catalog/availability";
import { catalogEntryIdSchema } from "../catalog/entry-id";
import { inspectRepository } from "../catalog/repository-inspection";
import type { CatalogReadResult, PortalDiagnostic } from "./contract";

type ProjectIdentity = Readonly<{ entryId: string; displayName: string }>;
export type AvailableProjectEntry = ProjectIdentity & Readonly<{ repoRoot: string }>;

export type ProjectEntryResult =
  | Readonly<{ kind: "available"; entry: AvailableProjectEntry }>
  | Readonly<{
      kind: "unavailable";
      project: ProjectIdentity & Readonly<{ availability: CatalogAvailability }>;
      diagnostic: PortalDiagnostic;
    }>
  | Readonly<{ kind: "catalog-failed"; diagnostic: PortalDiagnostic }>
  | Readonly<{ kind: "not-found" }>
  | Readonly<{ kind: "invalid-id" }>;

const unavailable = (
  entry: ProjectIdentity,
  availability: CatalogAvailability,
  code: string,
  message: string,
): ProjectEntryResult => ({
  kind: "unavailable",
  project: { ...entry, availability },
  diagnostic: { code, message },
});

export const resolveProjectEntry = async (options: {
  readonly entryId: string;
  readonly readCatalog: () => Promise<CatalogReadResult>;
}): Promise<ProjectEntryResult> => {
  if (!catalogEntryIdSchema.safeParse(options.entryId).success) return { kind: "invalid-id" };
  let catalog: CatalogReadResult;
  try {
    catalog = await options.readCatalog();
  } catch {
    return {
      kind: "catalog-failed",
      diagnostic: { code: "catalog-unavailable", message: "Project Catalog is unavailable." },
    };
  }
  if (catalog.state === "failed") return { kind: "catalog-failed", diagnostic: catalog.diagnostic };
  const entry = catalog.entries.find(({ entryId }) => entryId === options.entryId);
  if (entry === undefined) return { kind: "not-found" };
  const identity = { entryId: entry.entryId, displayName: entry.displayName };
  if (entry.availability !== "available") {
    return unavailable(
      identity,
      entry.availability,
      "project-unavailable",
      "The registered project is currently unavailable.",
    );
  }
  const inspection = await inspectRepository(entry.repoRoot, { requireCanonical: true });
  if (inspection.kind === "unavailable" && inspection.reason === "non-canonical") {
    return unavailable(
      identity,
      "unreadable",
      "project-unavailable",
      "The registered project location is no longer canonical.",
    );
  }
  if (inspection.kind === "unavailable" && inspection.reason !== "manifest") {
    return unavailable(
      identity,
      "unreadable",
      "project-unavailable",
      "The registered project cannot be read.",
    );
  }
  if (inspection.kind === "unavailable") {
    return unavailable(
      identity,
      inspection.availability,
      "project-unavailable",
      "The registered project no longer has a valid Bearing manifest.",
    );
  }
  return { kind: "available", entry: { ...identity, repoRoot: entry.repoRoot } };
};
