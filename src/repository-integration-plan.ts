import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { z } from "zod";
import { agentSurfaceEntryFile } from "./agent-surface-entry";
import {
  assertExecutorRegistrationsCurrent,
  validateExecutorRegistrationSelection,
} from "./executor-registration";
import { inspectInstallPath } from "./install-boundary";
import { pointsToMattContractLocator } from "./matt-agent-surface";
import { readContainedFile, resolveRepositoryRoot } from "./path-boundary";
import { validateMattSkillsV1Contract } from "./providers/matt-skills-v1";
import { displaySourceLocatorSchema } from "./reference-schema";
import {
  inspectRepositoryIntegrationLifecycle,
  type RepositoryIntegrationLifecycle,
} from "./repository-integration-lifecycle";
import { repositoryManifestSchema } from "./schema-definitions";
import type { RepositoryConfigurationApplyOptions } from "./types";

export type { RepositoryIntegrationLifecycle } from "./repository-integration-lifecycle";

export type RepositoryIntegrationPlan = Readonly<{
  planVersion: 1;
  repoRoot: string;
  lifecycle: RepositoryIntegrationLifecycle;
  canApply: boolean;
  blockers: readonly RepositoryIntegrationBlocker[];
  stages: Readonly<{
    externalPrerequisites: Readonly<{
      owner: "external-capabilities";
      mutation: "outside-repository-apply-unit";
      items: readonly RepositoryExternalPrerequisite[];
    }>;
    repositoryApplyUnit: Readonly<{
      owner: "bearing-repository-configuration";
      atomic: true;
      rollback: "restore-previous-repository-bytes";
      targets: readonly string[];
      preconditions: readonly RepositoryTargetPrecondition[];
    }>;
    projectCatalog: Readonly<{
      owner: "bearing-project-catalog";
      order: "after-repository-validation";
      rollback: "independent";
    }>;
  }>;
}>;

export type RepositoryIntegrationBlocker = Readonly<{
  code:
    | "unsafe-repository-target"
    | "repository-update-required"
    | "kit-update-required"
    | "unsupported-executor-registration"
    | "unsupported-provider-contract";
  target: string;
  message: string;
}>;

export type RepositoryExternalPrerequisite = Readonly<{
  capability: "bearing-package" | "matt-work-model-provider";
  owner: "package-manager" | "matt-skills";
  state: "satisfied" | "not-evaluated";
}>;

export type RepositoryTargetPrecondition = Readonly<{
  target: string;
  kind: "missing" | "file" | "directory" | "symbolic-link" | "unsafe-parent" | "unsupported";
  fingerprint?: string;
  mode?: number;
  linkCount?: number;
  unsafePath?: string;
  detail?: string;
}>;

const uniqueSorted = (values: readonly string[]): string[] =>
  [...new Set(values)].sort((left, right) => left.localeCompare(right, "en"));
const profileKeySchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u);
const validatedProfileDisposition = (profiles: readonly string[]): readonly string[] =>
  uniqueSorted(profiles.map((profile) => profileKeySchema.parse(profile)));

const plannedTargets = (
  root: string,
  options: Pick<RepositoryConfigurationApplyOptions, "surfaces" | "profiles" | "removeProfiles"> &
    Readonly<{
      existingSurfaces: readonly RepositoryConfigurationApplyOptions["surfaces"][number][];
    }>,
): readonly string[] => {
  const targets = [
    join(root, ".bearing/manifest.json"),
    join(root, ".bearing/provider.json"),
    ...options.profiles.map((profile) => join(root, ".bearing/executor-profiles", `${profile}.md`)),
    ...(options.removeProfiles ?? []).map((profile) =>
      join(root, ".bearing/executor-profiles", `${profile}.md`),
    ),
    ...[...new Set([...options.surfaces, ...options.existingSurfaces])].map((surface) =>
      join(root, agentSurfaceEntryFile(surface)),
    ),
  ];
  return uniqueSorted(targets).map((target) => relative(root, target));
};

const setupPlanningSelectionSchema = z.object({
  surfaces: z
    .array(z.enum(["agent-skills", "claude"]))
    .min(1, "Select at least one Agent Surface."),
  profiles: z.array(profileKeySchema),
  provider: z
    .strictObject({
      key: z.literal("matt-skills/v1"),
      contractLocator: displaySourceLocatorSchema,
    })
    .optional(),
});

const captureTargetPrecondition = async (
  root: string,
  target: string,
): Promise<RepositoryTargetPrecondition> => {
  const absolute = join(root, target);
  let parent = dirname(absolute);
  while (parent !== root) {
    try {
      const parentState = await inspectInstallPath(parent);
      if (parentState.kind === "symbolic-link" || parentState.kind === "file") {
        return {
          target,
          kind: "unsafe-parent",
          unsafePath: relative(root, parent),
          detail:
            parentState.kind === "symbolic-link"
              ? "parent path is a symbolic link"
              : "parent path is not a directory",
        };
      }
    } catch (error) {
      return {
        target,
        kind: "unsafe-parent",
        unsafePath: relative(root, parent),
        detail: error instanceof Error ? error.message : String(error),
      };
    }
    parent = dirname(parent);
  }

  let state: Awaited<ReturnType<typeof inspectInstallPath>>;
  try {
    state = await inspectInstallPath(absolute);
  } catch (error) {
    return {
      target,
      kind: "unsupported",
      detail: error instanceof Error ? error.message : String(error),
    };
  }
  if (state.kind !== "file") return { target, kind: state.kind };
  const bytes = await readContainedFile(root, absolute);
  return {
    target,
    kind: "file",
    fingerprint: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
    mode: state.mode & 0o7777,
    linkCount: state.linkCount,
  };
};

export const captureRepositoryTargetPreconditions = async (
  root: string,
  targets: readonly string[],
): Promise<readonly RepositoryTargetPrecondition[]> =>
  Promise.all(targets.map((target) => captureTargetPrecondition(root, target)));

const integrationBlockers = (
  preconditions: readonly RepositoryTargetPrecondition[],
): readonly RepositoryIntegrationBlocker[] =>
  preconditions.flatMap((precondition) => {
    if (
      precondition.kind === "symbolic-link" ||
      precondition.kind === "directory" ||
      precondition.kind === "unsafe-parent" ||
      precondition.kind === "unsupported" ||
      (precondition.kind === "file" && (precondition.linkCount ?? 0) !== 1)
    ) {
      return [
        {
          code: "unsafe-repository-target" as const,
          target: precondition.target,
          message:
            precondition.kind === "symbolic-link"
              ? `Installation target cannot use a symbolic link: ${precondition.target}`
              : precondition.kind === "directory"
                ? `Installation file target is a directory: ${precondition.target}`
                : precondition.kind === "unsafe-parent"
                  ? `Installation target has an unsafe parent ${
                      precondition.unsafePath ?? "(unknown)"
                    }: ${precondition.target}`
                  : precondition.kind === "unsupported"
                    ? `Installation target has an unsupported filesystem shape: ${precondition.target}`
                    : `Installation target cannot be hard-linked: ${precondition.target}`,
        },
      ];
    }
    return [];
  });

const equalJson = (left: unknown, right: unknown): boolean =>
  JSON.stringify(left) === JSON.stringify(right);

export type MattProviderContractInspection = Readonly<{
  supported: boolean;
  precondition: RepositoryTargetPrecondition;
}>;

export const inspectMattProviderContract = async (
  root: string,
  contractLocator: string,
  surfaces: RepositoryConfigurationApplyOptions["surfaces"],
): Promise<MattProviderContractInspection> => {
  const precondition = await captureTargetPrecondition(root, contractLocator);
  if (precondition.kind !== "file" || precondition.linkCount !== 1) {
    return Object.freeze({ supported: false, precondition: Object.freeze(precondition) });
  }
  const contract = (await readContainedFile(root, join(root, contractLocator))).toString("utf8");
  const selectedPointersSupported = await Promise.all(
    surfaces.map(async (surface) => {
      try {
        const pointer = (
          await readContainedFile(root, join(root, agentSurfaceEntryFile(surface)))
        ).toString("utf8");
        return pointsToMattContractLocator(pointer, contractLocator);
      } catch {
        return false;
      }
    }),
  );
  return Object.freeze({
    supported:
      validateMattSkillsV1Contract(contract).state === "supported" &&
      selectedPointersSupported.every(Boolean),
    precondition: Object.freeze(precondition),
  });
};

export const assertMattProviderContractCurrent = async (
  root: string,
  contractLocator: string,
  surfaces: RepositoryConfigurationApplyOptions["surfaces"],
  expected: MattProviderContractInspection,
): Promise<void> => {
  const current = await inspectMattProviderContract(root, contractLocator, surfaces);
  if (!current.supported || !equalJson(current.precondition, expected.precondition)) {
    throw new Error(
      `Matt provider contract changed after Repository Configuration review: ${contractLocator}`,
    );
  }
};

export const assertRepositoryIntegrationPlanCurrent = async (
  plan: RepositoryIntegrationPlan,
): Promise<void> => {
  const currentLifecycle = await inspectRepositoryIntegrationLifecycle(plan.repoRoot);
  if (!equalJson(currentLifecycle, plan.lifecycle)) {
    throw new Error("Repository lifecycle changed after repository integration planning.");
  }
  await assertRepositoryTargetPreconditionsCurrent(
    plan.repoRoot,
    plan.stages.repositoryApplyUnit.preconditions,
  );
};

export const assertRepositoryTargetPreconditionsCurrent = async (
  root: string,
  preconditions: readonly RepositoryTargetPrecondition[],
): Promise<void> => {
  for (const expected of preconditions) {
    const current = await captureTargetPrecondition(root, expected.target);
    if (!equalJson(current, expected)) {
      throw new Error(
        `Repository target changed after repository integration planning: ${expected.target}`,
      );
    }
  }
};

export const planRepositoryIntegration = async (
  options: RepositoryConfigurationApplyOptions,
): Promise<RepositoryIntegrationPlan> => {
  const root = await resolveRepositoryRoot(options.repoRoot);
  const selection = setupPlanningSelectionSchema.parse({
    surfaces: options.surfaces,
    profiles: options.profiles,
    provider: options.provider,
  });
  const normalizedOptions = {
    surfaces: [...new Set(selection.surfaces)].sort(),
    profiles: [...new Set(selection.profiles)].sort(),
    removeProfiles: validatedProfileDisposition(options.removeProfiles ?? []),
    provider: selection.provider,
  };
  const inspectedLifecycle = await inspectRepositoryIntegrationLifecycle(root);
  const lifecycle = inspectedLifecycle;
  const existingSurfaces =
    lifecycle.kind === "active" || lifecycle.kind === "deactivated"
      ? repositoryManifestSchema.parse(
          JSON.parse(await readFile(join(root, ".bearing/manifest.json"), "utf8")),
        ).surfaces
      : [];
  const targets = plannedTargets(root, { ...normalizedOptions, existingSurfaces });
  const preconditions = await captureRepositoryTargetPreconditions(root, targets);
  let executorRegistrationError: string | undefined;
  if (normalizedOptions.provider !== undefined) {
    try {
      const registrations = validateExecutorRegistrationSelection(
        options.registrations ?? [],
        normalizedOptions.surfaces,
        (options.registrations ?? []).map((registration) => registration.profileKey),
      );
      if (registrations.length > 0 && options.executorHomeDir === undefined) {
        throw new Error("Executor Registration planning requires the selected Agent Surface home.");
      }
      if (options.executorHomeDir !== undefined) {
        await assertExecutorRegistrationsCurrent(options.executorHomeDir, registrations);
      }
      if (lifecycle.kind === "active" || lifecycle.kind === "deactivated") {
        const manifest = repositoryManifestSchema.parse(
          JSON.parse(await readFile(join(root, ".bearing/manifest.json"), "utf8")),
        );
        const dispositions = new Set([
          ...registrations.map((registration) => registration.profileKey),
          ...validatedProfileDisposition(options.retainProfiles ?? []),
          ...normalizedOptions.removeProfiles,
        ]);
        const missingRevalidation = manifest.executorProfiles.filter(
          (profile) => !dispositions.has(profile),
        );
        if (missingRevalidation.length > 0) {
          throw new Error(
            `Existing Execution Profiles require a current semantic revalidation assessment or an explicit retain/remove decision: ${missingRevalidation.join(", ")}.`,
          );
        }
      }
    } catch (error) {
      executorRegistrationError = error instanceof Error ? error.message : String(error);
    }
  }
  const blockers = [
    ...integrationBlockers(preconditions),
    ...(executorRegistrationError !== undefined
      ? [
          {
            code: "unsupported-executor-registration" as const,
            target: ".bearing/executor-profiles",
            message: executorRegistrationError,
          },
        ]
      : []),
  ];
  const providerSatisfied =
    normalizedOptions.provider === undefined
      ? false
      : (
          await inspectMattProviderContract(
            root,
            normalizedOptions.provider.contractLocator,
            normalizedOptions.surfaces,
          )
        ).supported;
  const externalPrerequisites: readonly RepositoryExternalPrerequisite[] = [
    {
      capability: "bearing-package",
      owner: "package-manager",
      state: "satisfied",
    },
    {
      capability: "matt-work-model-provider",
      owner: "matt-skills",
      state: providerSatisfied ? "satisfied" : "not-evaluated",
    },
  ];
  const lifecycleCanApply =
    lifecycle.kind === "fresh" ||
    lifecycle.kind === "active" ||
    (lifecycle.kind === "deactivated" && options.confirmReactivate === true);
  const canApply =
    lifecycleCanApply &&
    blockers.length === 0 &&
    externalPrerequisites.every((prerequisite) => prerequisite.state === "satisfied");
  return Object.freeze({
    planVersion: 1,
    repoRoot: root,
    lifecycle: Object.freeze(lifecycle),
    canApply,
    blockers: Object.freeze(blockers.map((blocker) => Object.freeze(blocker))),
    stages: Object.freeze({
      externalPrerequisites: Object.freeze({
        owner: "external-capabilities" as const,
        mutation: "outside-repository-apply-unit" as const,
        items: Object.freeze(externalPrerequisites.map((item) => Object.freeze(item))),
      }),
      repositoryApplyUnit: Object.freeze({
        owner: "bearing-repository-configuration" as const,
        atomic: true as const,
        rollback: "restore-previous-repository-bytes" as const,
        targets: Object.freeze(targets),
        preconditions: Object.freeze(
          preconditions.map((precondition) => Object.freeze(precondition)),
        ),
      }),
      projectCatalog: Object.freeze({
        owner: "bearing-project-catalog" as const,
        order: "after-repository-validation" as const,
        rollback: "independent" as const,
      }),
    }),
  });
};
