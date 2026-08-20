import { dirname } from "node:path";
import { upsertCatalogEntry } from "./catalog/store";
import { applyRepositoryConfigurationUnit } from "./repository-configuration-apply";
import type {
  AgentSurface,
  ExecutorRegistration,
  RepositoryConfigurationApplyResult,
  RuntimeChannel,
} from "./types";

export type ReconcileRepositoryResult = Readonly<{
  outcome: "applied" | "no-op" | "partial";
  repository: RepositoryConfigurationApplyResult;
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
  readonly runtime?: RuntimeChannel;
  readonly registrations?: readonly ExecutorRegistration[];
  readonly confirmRepair?: boolean;
  readonly confirmReactivate?: boolean;
  readonly retainProfiles?: readonly string[];
  readonly removeProfiles?: readonly string[];
  readonly provider?: Readonly<{
    key: "matt-skills/v1";
    contractLocator: string;
  }>;
}): Promise<ReconcileRepositoryResult> => {
  const repository = await applyRepositoryConfigurationUnit({
    ...options,
    executorHomeDir: options.homeDir,
    initializeReadModel: true,
  });
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
      outcome: "partial",
      repository,
      catalog: {
        outcome: "failed",
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
};
