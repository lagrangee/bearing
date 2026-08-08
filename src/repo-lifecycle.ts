import { randomUUID } from "node:crypto";
import { rename, rm } from "node:fs/promises";
import { join, relative } from "node:path";
import type { z } from "zod";
import { agentSurfaceEntryFile, withoutBearingManagedPointer } from "./agent-surface-entry";
import { unregisterCatalogEntry } from "./catalog/store";
import { inspectInstallPath } from "./install-boundary";
import type { TargetPlan } from "./install-manifest";
import { applyInstallPlans } from "./installer";
import { readContainedFile, resolveRepositoryRoot } from "./path-boundary";
import { repositoryManifestSchema } from "./schema-definitions";
import type { AgentSurface } from "./types";

const pointerPlans = async (
  root: string,
  surfaces: readonly AgentSurface[],
): Promise<Readonly<{ plans: readonly TargetPlan[]; originals: readonly TargetPlan[] }>> => {
  const plans: TargetPlan[] = [];
  const originals: TargetPlan[] = [];
  for (const surface of surfaces) {
    const target = join(root, agentSurfaceEntryFile(surface));
    const state = await inspectInstallPath(target);
    if (state.kind === "missing") continue;
    if (state.kind !== "file" || state.linkCount !== 1) {
      throw new Error(
        `Repository lifecycle refuses an unsafe registered Agent Surface target: ${relative(
          root,
          target,
        )}.`,
      );
    }
    const existing = await readContainedFile(root, target);
    const revised = Buffer.from(withoutBearingManagedPointer(existing.toString("utf8")), "utf8");
    if (revised.equals(existing)) continue;
    plans.push({ target, bytes: revised, executable: false });
    originals.push({ target, bytes: existing, executable: false });
  }
  return { plans, originals };
};

const assertPointerOriginalsCurrent = async (
  root: string,
  originals: readonly TargetPlan[],
): Promise<void> => {
  for (const original of originals) {
    const state = await inspectInstallPath(original.target);
    if (
      !("bytes" in original) ||
      state.kind !== "file" ||
      state.linkCount !== 1 ||
      !(await readContainedFile(root, original.target)).equals(original.bytes)
    ) {
      throw new Error(
        `Registered Agent Surface changed after lifecycle review: ${relative(
          root,
          original.target,
        )}.`,
      );
    }
  }
};

const lifecycleManifestSchema = repositoryManifestSchema;
type LifecycleManifest = z.infer<typeof lifecycleManifestSchema>;

const readLifecycleManifest = async (
  root: string,
  manifestPath: string,
): Promise<LifecycleManifest | undefined> => {
  const manifestState = await inspectInstallPath(manifestPath);
  if (manifestState.kind === "missing") return undefined;
  if (manifestState.kind !== "file" || manifestState.linkCount !== 1) {
    throw new Error(
      "Repository Bearing manifest must be one single-link regular file before lifecycle changes.",
    );
  }
  const bytes = await readContainedFile(root, manifestPath);
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    throw new Error(
      "Repository Bearing manifest is unreadable. Use the compatible Bearing version or restore a verified backup before lifecycle changes.",
      { cause: error },
    );
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("schemaVersion" in parsed) ||
    typeof parsed.schemaVersion !== "number" ||
    !Number.isInteger(parsed.schemaVersion)
  ) {
    throw new Error(
      "Repository Bearing manifest has no supported schema identity. Use the compatible Bearing version or restore a verified backup before lifecycle changes.",
    );
  }
  if (parsed.schemaVersion > 1) {
    throw new Error(
      `Repository uses newer Bearing schema ${parsed.schemaVersion}; this runtime reads schema 1 only. Install a compatible newer Bearing version. Lifecycle changes fail closed and preserve repository state.`,
    );
  }
  if (parsed.schemaVersion !== 1) {
    throw new Error(`Repository Bearing schema ${parsed.schemaVersion} is unsupported.`);
  }
  const manifest = lifecycleManifestSchema.safeParse(parsed);
  if (!manifest.success) {
    throw new Error(
      "Repository Bearing manifest is not a valid 0.1.1 lifecycle manifest. Use recovery or the compatible Bearing version before lifecycle changes.",
    );
  }
  return manifest.data;
};

export type RepositoryLifecycleResult = Readonly<{
  outcome: "applied" | "no-op" | "partial" | "blocked";
  repository: Readonly<{
    outcome: "applied" | "no-op";
    changedTargets: readonly string[];
    cleanup?:
      | Readonly<{ outcome: "complete" }>
      | Readonly<{ outcome: "residue"; location: string; message: string }>;
  }>;
  catalog:
    | Readonly<{ outcome: "applied" | "no-op" }>
    | Readonly<{ outcome: "failed"; message: string }>;
}>;

const removeCatalogAfterLifecycle = async (
  homeDir: string,
  repoRoot: string,
  repository: RepositoryLifecycleResult["repository"],
): Promise<RepositoryLifecycleResult> => {
  try {
    const catalog = await unregisterCatalogEntry({ homeDir, repoRoot });
    return {
      outcome:
        repository.cleanup?.outcome === "residue"
          ? "blocked"
          : repository.outcome === "applied" || catalog.outcome === "applied"
            ? "applied"
            : "no-op",
      repository,
      catalog: { outcome: catalog.outcome },
    };
  } catch (error) {
    return {
      outcome: repository.cleanup?.outcome === "residue" ? "blocked" : "partial",
      repository,
      catalog: {
        outcome: "failed",
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
};

export const deactivateRepository = async (options: {
  repoRoot: string;
  homeDir: string;
}): Promise<RepositoryLifecycleResult> => {
  const root = await resolveRepositoryRoot(options.repoRoot);
  const namespace = join(root, ".bearing");
  const namespaceState = await inspectInstallPath(namespace);
  if (namespaceState.kind === "symbolic-link" || namespaceState.kind === "file") {
    throw new Error("Repository deactivation refuses an unsafe `.bearing` namespace shape.");
  }
  const manifestPath = join(namespace, "manifest.json");
  const manifest = await readLifecycleManifest(root, manifestPath);
  if (namespaceState.kind === "directory" && manifest === undefined) {
    throw new Error(
      "Repository deactivation requires a valid lifecycle manifest; retained namespace state without one is Invalid/Unsupported.",
    );
  }
  const pointers = await pointerPlans(root, manifest?.surfaces ?? []);
  const manifestPlan: readonly TargetPlan[] =
    manifest?.status === "active"
      ? [
          {
            target: manifestPath,
            bytes: Buffer.from(
              `${JSON.stringify({ ...manifest, status: "deactivated" }, null, 2)}\n`,
              "utf8",
            ),
            executable: false,
          },
        ]
      : [];
  const cachePath = join(namespace, "cache");
  const cacheState = await inspectInstallPath(cachePath);
  if (cacheState.kind !== "missing" && cacheState.kind !== "directory") {
    throw new Error("Repository deactivation refuses an unsafe `.bearing/cache` shape.");
  }
  let cacheQuarantine: string | undefined;
  try {
    await applyInstallPlans(
      root,
      [...manifestPlan, ...pointers.plans],
      undefined,
      async () => {
        const current = await readLifecycleManifest(root, manifestPath);
        if (JSON.stringify(current) !== JSON.stringify(manifest)) {
          throw new Error("Repository lifecycle changed after deactivation review.");
        }
        await assertPointerOriginalsCurrent(root, pointers.originals);
      },
      async () => undefined,
      async () => {
        if (cacheState.kind !== "directory") return;
        if ((await inspectInstallPath(cachePath)).kind !== "directory") {
          throw new Error("Repository cache changed to an unsafe shape during deactivation.");
        }
        cacheQuarantine = join(namespace, `.cache-deactivate-${randomUUID()}`);
        await rename(cachePath, cacheQuarantine);
      },
    );
  } catch (error) {
    if (
      cacheQuarantine !== undefined &&
      (await inspectInstallPath(cacheQuarantine)).kind === "directory" &&
      (await inspectInstallPath(cachePath)).kind === "missing"
    ) {
      await rename(cacheQuarantine, cachePath);
    }
    throw new Error("Bearing repository deactivation failed; repository targets were restored.", {
      cause: error,
    });
  }
  let cleanup: RepositoryLifecycleResult["repository"]["cleanup"];
  if (cacheQuarantine !== undefined) {
    try {
      await rm(cacheQuarantine, { recursive: true, force: false });
      cleanup = { outcome: "complete" };
    } catch (error) {
      cleanup = {
        outcome: "residue",
        location: cacheQuarantine,
        message: `Repository deactivation committed, but disposable cache cleanup left a detached residue: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
  }
  const changedTargets = [
    ...(manifestPlan.length > 0 ? [relative(root, manifestPath)] : []),
    ...pointers.plans.map((plan) => relative(root, plan.target)),
    ...(cacheState.kind === "directory" ? [".bearing/cache/"] : []),
  ].sort();
  return removeCatalogAfterLifecycle(options.homeDir, root, {
    outcome: changedTargets.length === 0 ? "no-op" : "applied",
    changedTargets,
    ...(cleanup === undefined ? {} : { cleanup }),
  });
};
