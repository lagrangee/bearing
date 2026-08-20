import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import packageMetadata from "../package.json";
import { inspectInstallPath } from "./install-boundary";
import { isRepositoryPathBoundaryError, readContainedFile } from "./path-boundary";
import { repositoryManifestSchema } from "./schema-definitions";

const MAXIMUM_REPOSITORY_MANIFEST_BYTES = 64 * 1024;

export type RepositoryIntegrationLifecycle = Readonly<{
  kind:
    | "fresh"
    | "active"
    | "deactivated"
    | "repository-update-required"
    | "kit-update-required"
    | "invalid-or-unsupported";
  reason: string;
  update?: Readonly<{
    fromPackageVersion: string;
    toPackageVersion: string;
    guide: "references/journeys/update.md";
  }>;
  repositorySchemaVersion?: number;
  runtimeSchemaVersion?: 1;
}>;

const invalidLifecycle = (reason: string): RepositoryIntegrationLifecycle => ({
  kind: "invalid-or-unsupported",
  reason,
});

const preview010ManifestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  packageVersion: z.literal("0.1.0"),
  surfaces: z
    .array(z.enum(["agent-skills", "claude"]))
    .min(1)
    .refine((surfaces) => new Set(surfaces).size === surfaces.length),
  executorProfiles: z
    .array(z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u))
    .refine((profiles) => new Set(profiles).size === profiles.length),
});

const developmentLineStart011ManifestSchema = repositoryManifestSchema.extend({
  packageVersion: z.literal("0.1.1"),
  status: z.literal("active"),
  runtime: z.literal("development"),
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
    return {
      kind: "kit-update-required",
      reason: `Repository uses newer Bearing schema ${parsed.schemaVersion}; the installed Kit reads schema 1 only.`,
      repositorySchemaVersion: parsed.schemaVersion,
      runtimeSchemaVersion: 1,
    };
  }
  const preview010Manifest = preview010ManifestSchema.safeParse(parsed);
  if (preview010Manifest.success && packageMetadata.version === "0.1.1") {
    return {
      kind: "repository-update-required",
      reason:
        "The repository uses the supported 0.1.0 Preview shape and requires the Agent-guided 0.1.1 repository update.",
      update: {
        fromPackageVersion: "0.1.0",
        toPackageVersion: "0.1.1",
        guide: "references/journeys/update.md",
      },
    };
  }
  const developmentLineStart011Manifest = developmentLineStart011ManifestSchema.safeParse(parsed);
  if (developmentLineStart011Manifest.success && packageMetadata.version === "0.1.2-dev") {
    return {
      kind: "repository-update-required",
      reason:
        "The source repository uses the listed active 0.1.1 Development Configuration and requires the Agent-guided 0.1.2-dev Development Line Start update.",
      update: {
        fromPackageVersion: "0.1.1",
        toPackageVersion: "0.1.2-dev",
        guide: "references/journeys/update.md",
      },
    };
  }
  const lifecycleManifest = repositoryManifestSchema.safeParse(parsed);
  if (
    lifecycleManifest.success &&
    lifecycleManifest.data.packageVersion === packageMetadata.version
  ) {
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
