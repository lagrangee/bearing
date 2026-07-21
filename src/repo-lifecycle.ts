import { randomUUID } from "node:crypto";
import { readFile, rename, rm, unlink } from "node:fs/promises";
import { join, relative } from "node:path";
import { removeCatalogEntryByRepoRoot } from "./catalog/store";
import { inspectInstallPath } from "./install-boundary";
import type { TargetPlan } from "./install-manifest";
import { applyInstallPlans } from "./installer";
import { resolveRepositoryRoot } from "./path-boundary";

const START_MARKER = "<!-- bearing:managed-start -->";
const END_MARKER = "<!-- bearing:managed-end -->";
const ENTRY_FILES = ["AGENTS.md", "CLAUDE.md"] as const;

const readOptional = async (target: string): Promise<Buffer | undefined> => {
  try {
    return await readFile(target);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
    throw error;
  }
};

const withoutManagedPointer = (source: string): string => {
  const starts = [...source.matchAll(new RegExp(START_MARKER, "gu"))];
  const ends = [...source.matchAll(new RegExp(END_MARKER, "gu"))];
  if (starts.length === 0 && ends.length === 0) return source;
  const start = starts[0]?.index;
  const endStart = ends[0]?.index;
  if (
    starts.length !== 1 ||
    ends.length !== 1 ||
    start === undefined ||
    endStart === undefined ||
    endStart < start
  ) {
    throw new Error("Agent Surface entry contains a malformed Bearing managed block.");
  }
  return `${source.slice(0, start)}${source.slice(endStart + END_MARKER.length)}`;
};

const pointerPlans = async (
  root: string,
): Promise<Readonly<{ plans: readonly TargetPlan[]; originals: readonly TargetPlan[] }>> => {
  const plans: TargetPlan[] = [];
  const originals: TargetPlan[] = [];
  for (const name of ENTRY_FILES) {
    const target = join(root, name);
    const existing = await readOptional(target);
    if (existing === undefined) continue;
    const revised = Buffer.from(withoutManagedPointer(existing.toString("utf8")), "utf8");
    if (revised.equals(existing)) continue;
    plans.push({ target, bytes: revised, executable: false });
    originals.push({ target, bytes: existing, executable: false });
  }
  return { plans, originals };
};

const assertManifestNotNewer = async (manifestPath: string): Promise<boolean> => {
  const manifestState = await inspectInstallPath(manifestPath);
  if (manifestState.kind === "missing") return false;
  if (manifestState.kind !== "file" || manifestState.linkCount !== 1) {
    throw new Error(
      "Repository Bearing manifest must be one single-link regular file before lifecycle changes.",
    );
  }
  const bytes = await readFile(manifestPath);
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
  return true;
};

export type RepositoryLifecycleResult = Readonly<{
  outcome: "applied" | "no-op" | "blocked";
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
    const catalog = await removeCatalogEntryByRepoRoot({ homeDir, repoRoot });
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
      outcome: "blocked",
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
  const manifestExists = await assertManifestNotNewer(manifestPath);
  const pointers = await pointerPlans(root);
  if (pointers.plans.length > 0) await applyInstallPlans(root, pointers.plans);
  let manifestStaging: string | undefined;
  try {
    if (manifestExists) {
      manifestStaging = join(root, ".bearing", `.manifest-deactivate-${randomUUID()}`);
      await rename(manifestPath, manifestStaging);
      await unlink(manifestStaging);
    }
  } catch (error) {
    if (
      manifestStaging !== undefined &&
      (await inspectInstallPath(manifestStaging)).kind === "file"
    ) {
      await rename(manifestStaging, manifestPath);
    }
    if (pointers.originals.length > 0) await applyInstallPlans(root, pointers.originals);
    throw new Error("Bearing repository deactivation failed; repository targets were restored.", {
      cause: error,
    });
  }
  const changedTargets = [
    ...(manifestExists ? [relative(root, manifestPath)] : []),
    ...pointers.plans.map((plan) => relative(root, plan.target)),
  ].sort();
  return removeCatalogAfterLifecycle(options.homeDir, root, {
    outcome: changedTargets.length === 0 ? "no-op" : "applied",
    changedTargets,
  });
};

export type PurgeTransactionHooks = Readonly<{
  removeQuarantine?: (target: string) => Promise<void>;
}>;

export const purgeRepository = async (
  options: {
    repoRoot: string;
    homeDir: string;
    confirmed: boolean;
  },
  hooks: PurgeTransactionHooks = {},
): Promise<RepositoryLifecycleResult> => {
  if (!options.confirmed) {
    throw new Error(
      "Repository purge requires --confirm-purge. It removes only the repository `.bearing` namespace and managed root blocks; native `.scratch` work, source, docs, and user Catalog data remain outside that delete set.",
    );
  }
  const root = await resolveRepositoryRoot(options.repoRoot);
  const namespace = join(root, ".bearing");
  const namespaceState = await inspectInstallPath(namespace);
  if (namespaceState.kind === "symbolic-link" || namespaceState.kind === "file") {
    throw new Error("Repository purge refuses an unsafe `.bearing` namespace shape.");
  }
  if (namespaceState.kind === "directory") {
    await assertManifestNotNewer(join(namespace, "manifest.json"));
  }
  const pointers = await pointerPlans(root);
  if (pointers.plans.length > 0) await applyInstallPlans(root, pointers.plans);
  let quarantine: string | undefined;
  let cleanup: RepositoryLifecycleResult["repository"]["cleanup"];
  try {
    if (namespaceState.kind === "directory") {
      quarantine = join(root, `.bearing-purge-${randomUUID()}`);
      await rename(namespace, quarantine);
    }
  } catch (error) {
    if (
      quarantine !== undefined &&
      (await inspectInstallPath(quarantine)).kind === "directory" &&
      (await inspectInstallPath(namespace)).kind === "missing"
    ) {
      await rename(quarantine, namespace);
    }
    if (pointers.originals.length > 0) await applyInstallPlans(root, pointers.originals);
    throw new Error(
      "Bearing repository purge failed before commit; original targets were restored.",
      {
        cause: error,
      },
    );
  }
  if (quarantine !== undefined) {
    try {
      await (hooks.removeQuarantine ?? ((target) => rm(target, { recursive: true, force: false })))(
        quarantine,
      );
      const residueState = await inspectInstallPath(quarantine);
      cleanup =
        residueState.kind === "missing"
          ? { outcome: "complete" }
          : {
              outcome: "residue",
              location: quarantine,
              message:
                "Repository purge committed, but cleanup left a detached partial quarantine. It is not a backup and no restoration was claimed; inspect and remove only this exact path.",
            };
    } catch (error) {
      const residueState = await inspectInstallPath(quarantine);
      cleanup =
        residueState.kind === "missing"
          ? { outcome: "complete" }
          : {
              outcome: "residue",
              location: quarantine,
              message: `Repository purge committed, but cleanup failed and may have partially deleted the detached quarantine. It is not a backup and no restoration was claimed: ${
                error instanceof Error ? error.message : String(error)
              }`,
            };
    }
  }
  const changedTargets = [
    ...(namespaceState.kind === "directory" ? [".bearing/"] : []),
    ...pointers.plans.map((plan) => relative(root, plan.target)),
  ].sort();
  return removeCatalogAfterLifecycle(options.homeDir, root, {
    outcome: changedTargets.length === 0 ? "no-op" : "applied",
    changedTargets,
    ...(cleanup === undefined ? {} : { cleanup }),
  });
};
