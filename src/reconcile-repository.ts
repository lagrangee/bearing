import { dirname } from "node:path";
import { upsertCatalogEntry } from "./catalog/store";
import { setupRepository } from "./repo-setup";
import { cutOverLegacyRepository } from "./repository-cutover";
import { planRepositoryIntegration } from "./repository-integration-plan";
import type { AgentSurface, ExecutorRegistration, RepositorySetupResult } from "./types";

export type ReconcileRepositoryResult = Readonly<{
  outcome: "applied" | "no-op" | "partial";
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
  readonly registrations?: readonly ExecutorRegistration[];
  readonly confirmRepair?: boolean;
  readonly confirmReactivate?: boolean;
  readonly acceptUpgradeDirection?: boolean;
  readonly confirmCutover?: boolean;
  readonly cutoverAt?: string;
  readonly cutoverPlanToken?: string;
  readonly retainProfiles?: readonly string[];
  readonly removeProfiles?: readonly string[];
  readonly provider?: Readonly<{
    key: "matt-skills/v1";
    contractLocator: string;
  }>;
}): Promise<ReconcileRepositoryResult> => {
  const explicitCutover =
    options.cutoverAt !== undefined ||
    options.cutoverPlanToken !== undefined ||
    options.acceptUpgradeDirection === true ||
    options.confirmCutover === true;
  const routeToCutover =
    explicitCutover &&
    (
      await planRepositoryIntegration({
        ...options,
        executorHomeDir: options.homeDir,
      })
    ).recoveryDiagnosis?.classification === "legacy-cutover";
  const repository = routeToCutover
    ? await cutOverLegacyRepository(options.repoRoot, {
        ...options,
        executorHomeDir: options.homeDir,
      })
    : await setupRepository({ ...options, executorHomeDir: options.homeDir });
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
