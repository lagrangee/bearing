import { lstat, mkdir, readFile, rmdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { z } from "zod";
import {
  AGENT_SURFACES,
  agentSurfaceEntryFile,
  withBearingManagedPointer,
  withoutBearingManagedPointer,
} from "./agent-surface-entry";
import type { TargetPlan } from "./install-manifest";
import { applyInstallPlans, type InstallTargetWriter, preflightInstallTargets } from "./installer";
import { resolveRepositoryRoot } from "./path-boundary";
import {
  assertRepositoryTargetPreconditionsCurrent,
  captureRepositoryTargetPreconditions,
  type RepositoryTargetPrecondition,
} from "./repository-integration-plan";
import { manifestSchema } from "./schema-definitions";
import type { RepositorySetupOptions, RepositorySetupResult } from "./types";

const packageSchema = z.object({ version: z.string().min(1) });
const profileNameSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u);

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

const assertCompatibleExistingManifest = async (root: string): Promise<void> => {
  const target = join(root, ".bearing/manifest.json");
  const existing = await readOptional(target);
  if (existing === undefined) return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(existing.toString("utf8"));
  } catch (error) {
    throw new Error(
      "Repository Bearing manifest is unreadable. Restore a verified backup or use the compatible Bearing version that created it; setup will not overwrite repository truth.",
      { cause: error },
    );
  }
  const version = z.object({ schemaVersion: z.number().int() }).safeParse(parsed);
  if (version.success && version.data.schemaVersion > 1) {
    throw new Error(
      `Repository uses newer Bearing schema ${version.data.schemaVersion}; this runtime reads schema 1 only. Install a compatible newer Bearing version. Downgrade will not rewrite or discard repository state.`,
    );
  }
  const validated = manifestSchema.safeParse(parsed);
  if (!validated.success) {
    throw new Error(
      "Repository Bearing manifest is invalid for schema 1. Restore a verified backup or repair it with the compatible Bearing version; setup will not overwrite repository truth.",
    );
  }
};

const validatedProfiles = (profiles: readonly string[]): string[] =>
  [...new Set(profiles.map((profile) => profileNameSchema.parse(profile)))].sort();

const legacyCandidateTargets = (root: string, profiles: readonly string[]): string[] => [
  join(root, ".bearing/manifest.json"),
  ...profiles.map((profile) => join(root, ".bearing/executor-profiles", `${profile}.md`)),
  ...AGENT_SURFACES.map((surface) => join(root, agentSurfaceEntryFile(surface))),
  join(root, ".bearing/state/.boundary-check"),
  join(root, ".bearing/cache/.boundary-check"),
];

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

const buildLegacyRepositoryPlans = async (
  root: string,
  options: RepositorySetupOptions,
): Promise<readonly TargetPlan[]> => {
  if (options.surfaces.length === 0) throw new Error("Select at least one Agent Surface.");
  const surfaces = [...new Set(options.surfaces)].sort();
  const profiles = validatedProfiles(options.profiles);
  const plans: TargetPlan[] = [];

  const manifest = {
    schemaVersion: 1,
    packageVersion: await packageVersion(options.packageRoot),
    surfaces,
    executorProfiles: profiles,
  };
  plans.push({
    target: join(root, ".bearing/manifest.json"),
    bytes: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8"),
    executable: false,
  });

  for (const profile of profiles) {
    const source = await readFile(
      join(options.packageRoot, "templates/executor-profiles", `${profile}.md`),
    );
    const target = join(root, ".bearing/executor-profiles", `${profile}.md`);
    const existing = await readOptional(target);
    plans.push({ target, bytes: existing ?? source, executable: false });
  }

  for (const surface of surfaces) {
    const target = join(root, agentSurfaceEntryFile(surface));
    const existing = await readOptional(target);
    plans.push({
      target,
      bytes: Buffer.from(withBearingManagedPointer(existing?.toString("utf8") ?? ""), "utf8"),
      executable: false,
    });
  }
  for (const surface of AGENT_SURFACES.filter((surface) => !surfaces.includes(surface))) {
    const target = join(root, agentSurfaceEntryFile(surface));
    const existing = await readOptional(target);
    if (existing === undefined) continue;
    const source = existing.toString("utf8");
    const revised = withoutBearingManagedPointer(source);
    if (revised === source) continue;
    plans.push({ target, bytes: Buffer.from(revised, "utf8"), executable: false });
  }
  return plans.sort((left, right) => left.target.localeCompare(right.target, "en"));
};

export const setupRepository = async (
  options: RepositorySetupOptions,
  hooks: Readonly<{
    afterPlan?: (
      plan: Readonly<{
        repoRoot: string;
        preconditions: readonly RepositoryTargetPrecondition[];
      }>,
    ) => Promise<void>;
    writeTarget?: InstallTargetWriter;
  }> = {},
): Promise<RepositorySetupResult> => {
  const root = await resolveRepositoryRoot(options.repoRoot);
  const profiles = validatedProfiles(options.profiles);
  await assertCompatibleExistingManifest(root);
  await preflightInstallTargets(root, legacyCandidateTargets(root, profiles));
  // Ticket 08 adds the read-only 0.1.1 planning seam without cutting the current 0.1.0
  // setup execution over to provider-aware semantics. Later delivery tickets own that cutover.
  const plans = await buildLegacyRepositoryPlans(root, {
    ...options,
    repoRoot: root,
    profiles,
  });
  const plannedTargets = plans.map((plan) => relative(root, plan.target));
  const preconditions = await captureRepositoryTargetPreconditions(root, plannedTargets);
  const compatibilityPlan = Object.freeze({
    repoRoot: root,
    preconditions: Object.freeze(preconditions),
  });
  await hooks.afterPlan?.(compatibilityPlan);
  const createdDirectories = await ensureNamespaces(root);
  let result: Awaited<ReturnType<typeof applyInstallPlans>>;
  try {
    result = await applyInstallPlans(root, plans, hooks.writeTarget, async () => {
      await assertRepositoryTargetPreconditionsCurrent(root, preconditions);
    });
  } catch (error) {
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
  };
};
