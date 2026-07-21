import { dirname } from "node:path";
import { upsertCatalogEntry } from "./catalog/store";
import { setupRepository } from "./repo-setup";
import type { AgentSurface, RepositorySetupResult } from "./types";

export type ReconcileRepositoryResult = Readonly<{
  outcome: "applied" | "no-op" | "blocked";
  repository: RepositorySetupResult;
  catalog:
    | Readonly<{ outcome: "applied" | "no-op"; entryId: string }>
    | Readonly<{ outcome: "failed"; message: string }>;
}>;

export const reconcileRepository = async (options: {
  readonly repoRoot: string;
  readonly packageRoot: string;
  readonly homeDir: string;
  readonly surfaces: readonly AgentSurface[];
  readonly profiles: readonly string[];
}): Promise<ReconcileRepositoryResult> => {
  const repository = await setupRepository(options);
  try {
    const catalog = await upsertCatalogEntry({
      homeDir: options.homeDir,
      repoRoot: dirname(dirname(repository.manifestPath)),
    });
    return {
      outcome:
        repository.outcome === "applied" || catalog.outcome === "applied" ? "applied" : "no-op",
      repository,
      catalog: { outcome: catalog.outcome, entryId: catalog.entry.entryId },
    };
  } catch (error) {
    return {
      outcome: "blocked",
      repository,
      catalog: {
        outcome: "failed",
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
};
