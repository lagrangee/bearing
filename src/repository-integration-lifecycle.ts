import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { inspectInstallPath } from "./install-boundary";
import { isRepositoryPathBoundaryError, readContainedFile } from "./path-boundary";
import { repositoryManifestSchema } from "./schema-definitions";

const MAXIMUM_REPOSITORY_MANIFEST_BYTES = 64 * 1024;

export type RepositoryIntegrationLifecycle = Readonly<{
  kind: "fresh" | "active" | "deactivated" | "invalid-or-unsupported";
  reason: string;
}>;

const invalidLifecycle = (reason: string): RepositoryIntegrationLifecycle => ({
  kind: "invalid-or-unsupported",
  reason,
});

export const inspectRepositoryIntegrationLifecycle = async (
  root: string,
): Promise<RepositoryIntegrationLifecycle> => {
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

  let source: string;
  try {
    source = (
      await readContainedFile(root, manifestPath, {
        maximumBytes: MAXIMUM_REPOSITORY_MANIFEST_BYTES,
      })
    ).toString("utf8");
  } catch (error) {
    if (isRepositoryPathBoundaryError(error)) {
      return invalidLifecycle(
        "The repository manifest could not be read safely within its bounded inspection.",
      );
    }
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
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
  const lifecycleManifest = repositoryManifestSchema.safeParse(parsed);
  if (lifecycleManifest.success) {
    return {
      kind: lifecycleManifest.data.status,
      reason:
        lifecycleManifest.data.status === "active"
          ? "The repository has an explicit active integration lifecycle."
          : "The repository has an explicit deactivated integration lifecycle.",
    };
  }
  return invalidLifecycle("The repository manifest schema is invalid or unsupported.");
};

export const assertActiveRepositoryIntegration = async (
  root: string,
  operation: "inspect" | "provider" | "reconcile-native" | "cache-rebuild" | "maintenance",
): Promise<void> => {
  const lifecycle = await inspectRepositoryIntegrationLifecycle(root);
  if (lifecycle.kind === "active") return;
  throw new Error(
    `Bearing ${operation} requires an Active Repository Configuration. Current lifecycle: ${lifecycle.kind}. ${lifecycle.reason}`,
  );
};
