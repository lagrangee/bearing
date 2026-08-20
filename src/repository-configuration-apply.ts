import { lstat, mkdir, readFile, rmdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { z } from "zod";
import {
  type AGENT_SURFACES,
  agentSurfaceEntryFile,
  withBearingManagedPointer,
  withoutBearingManagedPointer,
} from "./agent-surface-entry";
import {
  assertExecutorRegistrationsCurrent,
  readConfiguredExecutionProfiles,
  renderExecutionProfile,
  validateExecutorRegistrationSelection,
} from "./executor-registration";
import { inspectInstallPath } from "./install-boundary";
import type { TargetPlan } from "./install-manifest";
import { applyInstallPlans, type InstallTargetWriter, preflightInstallTargets } from "./installer";
import { readContainedFile, resolveRepositoryRoot } from "./path-boundary";
import { rebuildProjectReadModel } from "./project-read-model/provider-operations";
import {
  inspectProjectReadModel,
  projectReadModelPath,
  removeProjectReadModelForRebuild,
} from "./project-read-model/store";
import {
  assertMattProviderContractCurrent,
  assertRepositoryTargetPreconditionsCurrent,
  captureRepositoryTargetPreconditions,
  inspectMattProviderContract,
  planRepositoryIntegration,
  type RepositoryTargetPrecondition,
} from "./repository-integration-plan";
import { repositoryManifestSchema } from "./schema-definitions";
import type {
  RepositoryConfigurationApplyOptions,
  RepositoryConfigurationApplyResult,
} from "./types";

const packageSchema = z.object({ version: z.string().min(1) });
const profileNameSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u);
const lifecycleManifestSchema = repositoryManifestSchema;

const readOptional = async (target: string): Promise<Buffer | undefined> => {
  try {
    return await readFile(target);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
    throw error;
  }
};

const packageVersion = async (packageRoot: string): Promise<string> => {
  const metadata = packageSchema.parse(
    JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8")),
  );
  return metadata.version;
};

const validatedProfiles = (profiles: readonly string[]): string[] =>
  [...new Set(profiles.map((profile) => profileNameSchema.parse(profile)))].sort();

const changedFilePlans = async (plans: readonly TargetPlan[]): Promise<readonly TargetPlan[]> => {
  const changed: TargetPlan[] = [];
  for (const plan of plans) {
    if (plan.kind === "delete") {
      if ((await inspectInstallPath(plan.target)).kind !== "missing") changed.push(plan);
      continue;
    }
    if (!("bytes" in plan)) throw new Error(`Unsupported repository target plan: ${plan.target}`);
    const state = await inspectInstallPath(plan.target);
    if (state.kind === "missing") {
      changed.push(plan);
      continue;
    }
    if (state.kind !== "file" || state.linkCount !== 1) {
      throw new Error(`Repository target changed to an unsafe shape: ${plan.target}`);
    }
    if (!(await readFile(plan.target)).equals(plan.bytes)) changed.push(plan);
  }
  return changed;
};

const readLifecycleManifest = async (
  root: string,
): Promise<z.infer<typeof lifecycleManifestSchema> | undefined> => {
  const bytes = await readOptional(join(root, ".bearing/manifest.json"));
  if (bytes === undefined) return undefined;
  return lifecycleManifestSchema.parse(JSON.parse(bytes.toString("utf8")));
};

const ensureNamespaces = async (root: string): Promise<readonly string[]> => {
  const created: string[] = [];
  try {
    for (const directory of [
      join(root, ".bearing"),
      join(root, ".bearing/state"),
      join(root, ".bearing/cache"),
    ]) {
      try {
        const metadata = await lstat(directory);
        if (!metadata.isDirectory() || metadata.isSymbolicLink())
          throw new Error(`Bearing namespace is not a safe directory: ${directory}`);
      } catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
        await mkdir(directory);
        created.push(directory);
      }
    }
    return created;
  } catch (error) {
    await removeCreatedNamespaces(created);
    throw error;
  }
};

const removeCreatedNamespaces = async (directories: readonly string[]): Promise<void> => {
  for (const directory of [...directories].reverse()) await rmdir(directory);
};

const assertRepositoryPlansCurrent = async (
  root: string,
  plans: readonly TargetPlan[],
): Promise<void> => {
  for (const plan of plans) {
    if (plan.kind === "delete") {
      if ((await inspectInstallPath(plan.target)).kind !== "missing") {
        throw new Error(
          `Repository Configuration validation found an undeleted target: ${plan.target}`,
        );
      }
      continue;
    }
    if (!("bytes" in plan)) {
      throw new Error(
        `Repository Configuration validation found an unsupported target plan: ${plan.target}`,
      );
    }
    if (!(await readContainedFile(root, plan.target)).equals(plan.bytes)) {
      throw new Error(
        `Repository Configuration validation found unexpected repository bytes: ${plan.target}`,
      );
    }
  }
};

const buildFreshRepositoryPlans = async (
  root: string,
  options: RepositoryConfigurationApplyOptions & {
    provider: NonNullable<RepositoryConfigurationApplyOptions["provider"]>;
  },
): Promise<readonly TargetPlan[]> => {
  if (options.surfaces.length === 0) throw new Error("Select at least one Agent Surface.");
  const profiles = validatedProfiles(options.profiles);
  const registrations = validateExecutorRegistrationSelection(
    options.registrations ?? [],
    options.surfaces,
    (options.registrations ?? []).map((registration) => registration.profileKey),
  );
  const surfaces = [...new Set(options.surfaces)].sort();
  const plans: TargetPlan[] = [
    {
      target: join(root, ".bearing/manifest.json"),
      bytes: Buffer.from(
        `${JSON.stringify(
          {
            schemaVersion: 1,
            packageVersion: await packageVersion(options.packageRoot),
            status: "active",
            ...(options.runtime === "development" ? { runtime: "development" as const } : {}),
            surfaces,
            executorProfiles: profiles,
          },
          null,
          2,
        )}\n`,
        "utf8",
      ),
      executable: false,
    },
    {
      target: join(root, ".bearing/provider.json"),
      bytes: Buffer.from(
        `${JSON.stringify(
          {
            schemaVersion: 1,
            provider: options.provider.key,
            contractLocator: options.provider.contractLocator,
          },
          null,
          2,
        )}\n`,
        "utf8",
      ),
      executable: false,
    },
  ];
  for (const registration of registrations) {
    plans.push({
      target: join(root, ".bearing/executor-profiles", `${registration.profileKey}.md`),
      bytes: renderExecutionProfile(registration),
      executable: false,
    });
  }
  for (const surface of surfaces) {
    const target = join(root, agentSurfaceEntryFile(surface));
    const existing = await readOptional(target);
    plans.push({
      target,
      bytes: Buffer.from(
        withBearingManagedPointer(existing?.toString("utf8") ?? "", options.runtime),
        "utf8",
      ),
      executable: false,
    });
  }
  return plans.sort((left, right) => left.target.localeCompare(right.target, "en"));
};

const reconciliationProfileSelection = (
  options: RepositoryConfigurationApplyOptions,
  existingManifest: z.infer<typeof lifecycleManifestSchema> | undefined,
): Readonly<{
  profiles: readonly string[];
  retainedProfiles: readonly string[];
  removedProfiles: readonly string[];
}> => {
  const nominated = validatedProfiles(
    (options.registrations ?? []).map((registration) => registration.profileKey),
  );
  const retained = validatedProfiles(options.retainProfiles ?? []);
  const removed = validatedProfiles(options.removeProfiles ?? []);
  const disposition = [...nominated, ...retained, ...removed];
  if (new Set(disposition).size !== disposition.length) {
    throw new Error(
      "Each Execution Profile requires exactly one explicit add, update, retain, or remove disposition.",
    );
  }
  if (existingManifest === undefined) {
    if (retained.length > 0 || removed.length > 0) {
      throw new Error(
        "Repository Configuration cannot retain or remove an unconfigured Execution Profile.",
      );
    }
    return { profiles: nominated, retainedProfiles: [], removedProfiles: [] };
  }
  const existing = validatedProfiles(existingManifest.executorProfiles);
  const missingRevalidation = existing.filter((profile) => !disposition.includes(profile));
  if (missingRevalidation.length > 0) {
    throw new Error(
      `Existing Execution Profiles require a current semantic revalidation assessment or an explicit retain/remove decision: ${missingRevalidation.join(", ")}.`,
    );
  }
  const unknownRetains = retained.filter((profile) => !existing.includes(profile));
  const unknownRemovals = removed.filter((profile) => !existing.includes(profile));
  if (unknownRetains.length > 0 || unknownRemovals.length > 0) {
    throw new Error(
      `Execution Profile disposition references an unconfigured profile: ${[
        ...unknownRetains,
        ...unknownRemovals,
      ].join(", ")}.`,
    );
  }
  return {
    profiles: validatedProfiles([
      ...existing.filter((profile) => !removed.includes(profile)),
      ...nominated,
    ]),
    retainedProfiles: retained,
    removedProfiles: removed,
  };
};

const appendSurfaceRemovalPlans = async (
  root: string,
  plans: readonly TargetPlan[],
  previousSurfaces: readonly (typeof AGENT_SURFACES)[number][],
  selectedSurfaces: readonly (typeof AGENT_SURFACES)[number][],
): Promise<readonly TargetPlan[]> => {
  const revised = [...plans];
  for (const surface of previousSurfaces.filter((item) => !selectedSurfaces.includes(item))) {
    const target = join(root, agentSurfaceEntryFile(surface));
    const existing = await readOptional(target);
    if (existing === undefined) continue;
    const withoutPointer = Buffer.from(
      withoutBearingManagedPointer(existing.toString("utf8")),
      "utf8",
    );
    if (!withoutPointer.equals(existing)) {
      revised.push({ target, bytes: withoutPointer, executable: false });
    }
  }
  return revised.sort((left, right) => left.target.localeCompare(right.target, "en"));
};

export const applyRepositoryConfigurationUnit = async (
  options: RepositoryConfigurationApplyOptions,
  hooks: Readonly<{
    afterPlan?: (
      plan: Readonly<{
        repoRoot: string;
        preconditions: readonly RepositoryTargetPrecondition[];
      }>,
    ) => Promise<void>;
    writeTarget?: InstallTargetWriter;
  }> = {},
): Promise<RepositoryConfigurationApplyResult> => {
  const root = await resolveRepositoryRoot(options.repoRoot);
  const requestedProfiles = validatedProfiles(options.profiles);
  if (options.provider === undefined) {
    throw new Error(
      "Repository Configuration requires a selected-surface Matt provider contract; no repository writes were made.",
    );
  }
  {
    const provider = options.provider;
    const registrations = validateExecutorRegistrationSelection(
      options.registrations ?? [],
      options.surfaces,
      (options.registrations ?? []).map((registration) => registration.profileKey),
    );
    if (registrations.length > 0 && options.executorHomeDir === undefined) {
      throw new Error("Fresh Executor Registration validation requires its Agent Surface home.");
    }
    if (options.executorHomeDir !== undefined) {
      await assertExecutorRegistrationsCurrent(options.executorHomeDir, registrations);
    }
    const integrationPlan = await planRepositoryIntegration({
      ...options,
      repoRoot: root,
      profiles: requestedProfiles,
    });
    const providerPrerequisite = integrationPlan.stages.externalPrerequisites.items.find(
      (item) => item.capability === "matt-work-model-provider",
    );
    const blocker = integrationPlan.blockers[0];
    if (blocker !== undefined) throw new Error(blocker.message);
    if (providerPrerequisite?.state !== "satisfied") {
      throw new Error(
        "Matt provider contract is unsupported or unavailable; Repository Configuration made no repository writes.",
      );
    }
    if (integrationPlan.lifecycle.kind === "invalid-or-unsupported") {
      throw new Error(`Repository Configuration cannot apply: ${integrationPlan.lifecycle.reason}`);
    }
    if (integrationPlan.lifecycle.kind === "deactivated" && options.confirmReactivate !== true) {
      throw new Error(
        "Repository is deactivated. Reactivation requires --confirm-reactivate after reviewing the retained configuration; no repository writes were made.",
      );
    }
    const existingManifest =
      integrationPlan.lifecycle.kind === "fresh" ? undefined : await readLifecycleManifest(root);
    const profileSelection = reconciliationProfileSelection(options, existingManifest);
    if (
      existingManifest === undefined &&
      JSON.stringify(profileSelection.profiles) !== JSON.stringify(requestedProfiles)
    ) {
      throw new Error(
        "Requested Execution Profiles must exactly match nominated and explicitly retained profiles.",
      );
    }
    if (profileSelection.retainedProfiles.length > 0) {
      await readConfiguredExecutionProfiles(
        root,
        options.surfaces,
        profileSelection.retainedProfiles,
      );
    }
    const providerContract = await inspectMattProviderContract(
      root,
      provider.contractLocator,
      options.surfaces,
    );
    let plans = await buildFreshRepositoryPlans(root, {
      ...options,
      repoRoot: root,
      profiles: profileSelection.profiles,
      provider,
    });
    plans = await appendSurfaceRemovalPlans(
      root,
      plans,
      existingManifest?.surfaces ?? [],
      options.surfaces,
    );
    const removedProfileTargets = profileSelection.removedProfiles.map((profile) =>
      join(root, ".bearing/executor-profiles", `${profile}.md`),
    );
    const retainedProfileTargets = profileSelection.retainedProfiles.map((profile) =>
      join(root, ".bearing/executor-profiles", `${profile}.md`),
    );
    await preflightInstallTargets(root, [
      ...plans.map((plan) => plan.target),
      ...removedProfileTargets,
      ...retainedProfileTargets,
    ]);
    for (const target of removedProfileTargets) {
      const state = await inspectInstallPath(target);
      if (state.kind !== "file" || state.linkCount !== 1) {
        throw new Error(
          `Explicit Execution Profile removal requires one safe configured profile file: ${relative(root, target)}.`,
        );
      }
    }
    plans = [
      ...plans,
      ...removedProfileTargets.map((target): TargetPlan => ({ kind: "delete" as const, target })),
    ].sort((left, right) => left.target.localeCompare(right.target, "en"));
    const preconditions = await captureRepositoryTargetPreconditions(root, [
      ...plans.map((plan) => relative(root, plan.target)),
      ...retainedProfileTargets.map((target) => relative(root, target)),
    ]);
    await hooks.afterPlan?.({ repoRoot: root, preconditions });
    const changedPlans = await changedFilePlans(plans);
    if (integrationPlan.lifecycle.kind === "active" && changedPlans.length === 0) {
      await assertMattProviderContractCurrent(
        root,
        provider.contractLocator,
        options.surfaces,
        providerContract,
      );
      await assertRepositoryTargetPreconditionsCurrent(root, preconditions);
      return {
        outcome: "no-op",
        manifestPath: join(root, ".bearing/manifest.json"),
        changedTargets: [],
      };
    }
    if (integrationPlan.lifecycle.kind === "active" && options.confirmRepair !== true) {
      const degradedTargets = [...changedPlans.map((plan) => relative(root, plan.target))].sort();
      const bearingOwned = degradedTargets.filter((target) => target.startsWith(".bearing/"));
      const managedSurfaceBlocks = degradedTargets.filter(
        (target) => !target.startsWith(".bearing/"),
      );
      const ownerGroups = [
        ...(bearingOwned.length === 0
          ? []
          : [`bearing-repository-configuration=[${bearingOwned.join(", ")}]`]),
        ...(managedSurfaceBlocks.length === 0
          ? []
          : [`agent-surface-managed-block=[${managedSurfaceBlocks.join(", ")}]`]),
      ];
      throw new Error(
        `Active repository is degraded at: ${degradedTargets.join(
          ", ",
        )}. Owner-grouped drift: ${ownerGroups.join(
          "; ",
        )}. Repair was declined or not confirmed; pass --confirm-repair after reviewing these owner-scoped changes.`,
      );
    }
    const createdDirectories = await ensureNamespaces(root);
    let result: Awaited<ReturnType<typeof applyInstallPlans>>;
    const initializeReadModel =
      options.initializeReadModel === true &&
      (integrationPlan.lifecycle.kind === "fresh" ||
        integrationPlan.lifecycle.kind === "deactivated");
    const readModelBefore = initializeReadModel ? await inspectProjectReadModel(root) : undefined;
    const readModelTarget = projectReadModelPath(root);
    const readModelTargetState = initializeReadModel
      ? await inspectInstallPath(readModelTarget)
      : undefined;
    const readModelOriginal =
      readModelTargetState?.kind === "file" && readModelTargetState.linkCount === 1
        ? {
            target: readModelTarget,
            bytes: await readContainedFile(root, readModelTarget),
            executable: false,
            mode: readModelTargetState.mode & 0o7777,
          }
        : undefined;
    let readModel: RepositoryConfigurationApplyResult["readModel"];
    try {
      result = await applyInstallPlans(
        root,
        plans,
        hooks.writeTarget,
        async () => {
          await assertMattProviderContractCurrent(
            root,
            provider.contractLocator,
            options.surfaces,
            providerContract,
          );
          await assertRepositoryTargetPreconditionsCurrent(root, preconditions);
          if (options.executorHomeDir !== undefined) {
            await assertExecutorRegistrationsCurrent(options.executorHomeDir, registrations);
          }
        },
        async () => {
          await assertRepositoryPlansCurrent(root, plans);
          await assertMattProviderContractCurrent(
            root,
            provider.contractLocator,
            options.surfaces,
            providerContract,
          );
          if (options.executorHomeDir !== undefined) {
            await assertExecutorRegistrationsCurrent(options.executorHomeDir, registrations);
          }
          if (!initializeReadModel) return [];
          const rebuilt = await rebuildProjectReadModel(root);
          if (rebuilt.outcome !== "complete" || rebuilt.result.acquisitionCount !== 0) {
            throw new Error(
              "Repository Configuration could not initialize the local Project Read Model without provider acquisition.",
            );
          }
          readModel = {
            acquisitionCount: 0,
            missingEvidenceScopes: rebuilt.result.missingEvidenceScopes,
          };
          return [];
        },
        async () => {
          await assertRepositoryPlansCurrent(root, plans);
          await assertMattProviderContractCurrent(
            root,
            provider.contractLocator,
            options.surfaces,
            providerContract,
          );
          if (options.executorHomeDir !== undefined) {
            await assertExecutorRegistrationsCurrent(options.executorHomeDir, registrations);
          }
          if (initializeReadModel && (await inspectProjectReadModel(root)).state !== "ready") {
            throw new Error(
              "Repository Configuration did not publish a readable Project Read Model.",
            );
          }
        },
      );
    } catch (error) {
      if (readModelOriginal !== undefined) {
        try {
          await applyInstallPlans(root, [readModelOriginal]);
        } catch (cleanupError) {
          throw new AggregateError(
            [error, cleanupError],
            "Repository Configuration failed and could not restore its previous Project Read Model.",
          );
        }
      } else if (initializeReadModel && readModelBefore?.state === "missing") {
        try {
          await removeProjectReadModelForRebuild(root);
        } catch (cleanupError) {
          throw new AggregateError(
            [error, cleanupError],
            "Repository Configuration failed and could not remove its transaction-created Project Read Model.",
          );
        }
      }
      await removeCreatedNamespaces(createdDirectories);
      throw error;
    }
    const namespaceTargets = createdDirectories
      .filter((directory) => directory !== join(root, ".bearing"))
      .map((directory) => `${relative(root, directory)}/`);
    return {
      outcome: result.outcome === "applied" || namespaceTargets.length > 0 ? "applied" : "no-op",
      manifestPath: join(root, ".bearing/manifest.json"),
      changedTargets: [...result.changedTargets, ...namespaceTargets].sort(),
      ...(readModel === undefined ? {} : { readModel }),
    };
  }
};
