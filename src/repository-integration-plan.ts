import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { z } from "zod";
import { agentSurfaceEntryFile } from "./agent-surface-entry";
import { inspectInstallPath } from "./install-boundary";
import { resolveRepositoryRoot } from "./path-boundary";
import { manifestSchema } from "./schema-definitions";
import type { RepositorySetupOptions } from "./types";

export type RepositoryIntegrationLifecycle = Readonly<{
  kind: "fresh" | "active" | "deactivated" | "invalid-or-unsupported";
  reason: string;
  legacyTransitionRequired?: boolean;
}>;

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
      owner: "bearing-setup";
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
  code: "unsafe-repository-target";
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

const plannedTargets = (
  root: string,
  options: Pick<RepositorySetupOptions, "surfaces" | "profiles">,
): readonly string[] => {
  const targets = [
    join(root, ".bearing/manifest.json"),
    join(root, ".bearing/provider.json"),
    ...options.profiles.map((profile) => join(root, ".bearing/executor-profiles", `${profile}.md`)),
    ...options.surfaces.map((surface) => join(root, agentSurfaceEntryFile(surface))),
  ];
  return uniqueSorted(targets).map((target) => relative(root, target));
};

const lifecycleManifestSchema = manifestSchema.extend({
  status: z.enum(["active", "deactivated"]),
});
const setupPlanningSelectionSchema = z.object({
  surfaces: z
    .array(z.enum(["agent-skills", "claude"]))
    .min(1, "Select at least one Agent Surface."),
  profiles: z.array(z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u)),
});

const invalidLifecycle = (reason: string): RepositoryIntegrationLifecycle => ({
  kind: "invalid-or-unsupported",
  reason,
});

const inspectLifecycle = async (root: string): Promise<RepositoryIntegrationLifecycle> => {
  const namespacePath = join(root, ".bearing");
  const namespace = await inspectInstallPath(namespacePath);
  if (namespace.kind === "missing") {
    return {
      kind: "fresh",
      reason: "No Bearing manifest or retained Bearing State is present.",
    };
  }
  if (namespace.kind !== "directory") {
    return invalidLifecycle("The Bearing namespace is not a safe repository directory.");
  }

  const manifestPath = join(namespacePath, "manifest.json");
  const manifest = await inspectInstallPath(manifestPath);
  if (manifest.kind === "missing") {
    const children = await readdir(namespacePath);
    const unexpected = children.filter((child) => child !== "cache" && child !== "state");
    if (unexpected.length > 0) {
      return invalidLifecycle(
        `Bearing configuration exists without a trustworthy repository manifest: ${unexpected.join(", ")}.`,
      );
    }

    const statePath = join(namespacePath, "state");
    const state = await inspectInstallPath(statePath);
    if (state.kind !== "missing" && state.kind !== "directory") {
      return invalidLifecycle("Retained Bearing State is not a safe repository directory.");
    }
    if (state.kind === "directory" && (await readdir(statePath)).length > 0) {
      return invalidLifecycle(
        "Retained Bearing State exists without a trustworthy repository manifest.",
      );
    }

    const cachePath = join(namespacePath, "cache");
    const cache = await inspectInstallPath(cachePath);
    if (cache.kind !== "missing" && cache.kind !== "directory") {
      return invalidLifecycle("Bearing cache is not a safe repository directory.");
    }
    return {
      kind: "fresh",
      reason: "No Bearing manifest, retained configuration, or retained Bearing State is present.",
    };
  }
  if (manifest.kind !== "file" || manifest.linkCount !== 1) {
    return invalidLifecycle("The repository manifest must be one safe single-link regular file.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch {
    return invalidLifecycle("The repository manifest is not valid JSON.");
  }
  if (
    typeof parsed === "object" &&
    parsed !== null &&
    "schemaVersion" in parsed &&
    typeof parsed.schemaVersion === "number" &&
    Number.isInteger(parsed.schemaVersion) &&
    parsed.schemaVersion > 1
  ) {
    return invalidLifecycle(
      `Repository uses newer Bearing schema ${parsed.schemaVersion}; this runtime reads schema 1 only.`,
    );
  }
  const lifecycleManifest = lifecycleManifestSchema.safeParse(parsed);
  if (lifecycleManifest.success) {
    return {
      kind: lifecycleManifest.data.status,
      reason:
        lifecycleManifest.data.status === "active"
          ? "The repository has an explicit active integration lifecycle."
          : "The repository has an explicit deactivated integration lifecycle.",
      legacyTransitionRequired: false,
    };
  }
  const legacyManifest = manifestSchema.safeParse(parsed);
  if (legacyManifest.success) {
    return {
      kind: "active",
      reason: "The repository has a valid 0.1.0 integration that requires explicit cutover.",
      legacyTransitionRequired: true,
    };
  }
  return invalidLifecycle("The repository manifest schema is invalid or unsupported.");
};

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
  const bytes = await readFile(absolute);
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

export const assertRepositoryIntegrationPlanCurrent = async (
  plan: RepositoryIntegrationPlan,
): Promise<void> => {
  const currentLifecycle = await inspectLifecycle(plan.repoRoot);
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
  options: RepositorySetupOptions,
): Promise<RepositoryIntegrationPlan> => {
  const root = await resolveRepositoryRoot(options.repoRoot);
  const selection = setupPlanningSelectionSchema.parse({
    surfaces: options.surfaces,
    profiles: options.profiles,
  });
  const normalizedOptions = {
    surfaces: [...new Set(selection.surfaces)].sort(),
    profiles: [...new Set(selection.profiles)].sort(),
  };
  const lifecycle = await inspectLifecycle(root);
  const targets = plannedTargets(root, normalizedOptions);
  const preconditions = await captureRepositoryTargetPreconditions(root, targets);
  const blockers = integrationBlockers(preconditions);
  const externalPrerequisites: readonly RepositoryExternalPrerequisite[] = [
    {
      capability: "bearing-package",
      owner: "package-manager",
      state: "satisfied",
    },
    {
      capability: "matt-work-model-provider",
      owner: "matt-skills",
      state: "not-evaluated",
    },
  ];
  const canApply =
    (lifecycle.kind === "fresh" || lifecycle.legacyTransitionRequired === true) &&
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
        owner: "bearing-setup" as const,
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
