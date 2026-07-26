import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { z } from "zod";
import { inspectInstallPath } from "./install-boundary";
import { resolveRepositoryRoot } from "./path-boundary";
import { manifestSchema } from "./schema-definitions";
import type { AgentSurface, RepositorySetupOptions } from "./types";

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
  kind: "missing" | "file" | "directory" | "symbolic-link";
  fingerprint?: string;
  mode?: number;
  linkCount?: number;
}>;

const entryFile = (surface: AgentSurface): string =>
  surface === "agent-skills" ? "AGENTS.md" : "CLAUDE.md";

const SUPPORTED_SURFACES = ["agent-skills", "claude"] as const;
const START_MARKER = "<!-- bearing:managed-start -->";
const END_MARKER = "<!-- bearing:managed-end -->";

const uniqueSorted = (values: readonly string[]): string[] =>
  [...new Set(values)].sort((left, right) => left.localeCompare(right, "en"));

const plannedTargets = async (
  root: string,
  options: Pick<RepositorySetupOptions, "surfaces" | "profiles">,
): Promise<readonly string[]> => {
  const targets = [
    join(root, ".bearing/manifest.json"),
    ...options.profiles.map((profile) => join(root, ".bearing/executor-profiles", `${profile}.md`)),
    ...options.surfaces.map((surface) => join(root, entryFile(surface))),
  ];
  for (const surface of SUPPORTED_SURFACES.filter(
    (candidate) => !options.surfaces.includes(candidate),
  )) {
    const target = join(root, entryFile(surface));
    const state = await inspectInstallPath(target);
    if (state.kind !== "file" || state.linkCount !== 1) continue;
    const source = await readFile(target, "utf8");
    if (source.includes(START_MARKER) || source.includes(END_MARKER)) targets.push(target);
  }
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
    const statePath = join(namespacePath, "state");
    const state = await inspectInstallPath(statePath);
    if (state.kind === "missing") {
      return {
        kind: "fresh",
        reason: "No Bearing manifest or retained Bearing State is present.",
      };
    }
    if (state.kind !== "directory") {
      return invalidLifecycle("Retained Bearing State is not a safe repository directory.");
    }
    if ((await readdir(statePath)).length === 0) {
      return {
        kind: "fresh",
        reason: "No Bearing manifest or retained Bearing State is present.",
      };
    }
    return invalidLifecycle(
      "Retained Bearing State exists without a trustworthy repository manifest.",
    );
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
  const state = await inspectInstallPath(absolute);
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

const captureTargetPreconditions = async (
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
  for (const expected of plan.stages.repositoryApplyUnit.preconditions) {
    const current = await captureTargetPrecondition(plan.repoRoot, expected.target);
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
  const targets = await plannedTargets(root, normalizedOptions);
  const preconditions = await captureTargetPreconditions(root, targets);
  const blockers = integrationBlockers(preconditions);
  const canApply =
    (lifecycle.kind === "fresh" || lifecycle.legacyTransitionRequired === true) &&
    blockers.length === 0;
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
