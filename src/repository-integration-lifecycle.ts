import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { compare as compareSemver, valid as validSemver } from "semver";
import type { z } from "zod";
import packageMetadata from "../package.json";
import { inspectInstallPath } from "./install-boundary";
import { isRepositoryPathBoundaryError, readContainedFile } from "./path-boundary";
import {
  olderActiveRepositoryManifestSchema,
  repositoryManifestSchema,
} from "./schema-definitions";

const MAXIMUM_REPOSITORY_MANIFEST_BYTES = 64 * 1024;

export type RepositoryUpdateContract = Readonly<{
  source: Readonly<{
    schemaVersion: 1;
    packageVersion: string;
  }>;
  target: Readonly<{
    requiredManifestFields: readonly string[];
    manifest: Readonly<{
      schemaVersion: 2;
      packageVersion: string;
      status: "active";
      runtime: "stable" | "development";
      surfaces: readonly ("agent-skills" | "claude")[];
      executorProfiles: readonly string[];
    }>;
    semanticInvariants: readonly string[];
    writeDomains: Readonly<{
      canonical: readonly [".bearing/manifest.json"];
      disposable: readonly string[];
    }>;
    validation: readonly string[];
  }>;
  guide: "references/journeys/update.md";
}>;

export type RepositoryIntegrationLifecycle = Readonly<{
  kind:
    | "fresh"
    | "active"
    | "deactivated"
    | "repository-update-required"
    | "kit-update-required"
    | "invalid-or-unsupported";
  reason: string;
  update?: RepositoryUpdateContract;
  repositorySchemaVersion?: number;
  runtimeSchemaVersion?: 2;
}>;

const invalidLifecycle = (reason: string): RepositoryIntegrationLifecycle => ({
  kind: "invalid-or-unsupported",
  reason,
});

const repositoryUpdate = (
  source: z.infer<typeof olderActiveRepositoryManifestSchema>,
): RepositoryUpdateContract => {
  const runtime = source.runtime ?? "stable";
  return {
    source: {
      schemaVersion: source.schemaVersion,
      packageVersion: source.packageVersion,
    },
    target: {
      requiredManifestFields: [
        "schemaVersion",
        "packageVersion",
        "status",
        "runtime",
        "surfaces",
        "executorProfiles",
      ],
      manifest: {
        schemaVersion: 2,
        packageVersion: packageMetadata.version,
        status: source.status,
        runtime,
        surfaces: source.surfaces,
        executorProfiles: source.executorProfiles,
      },
      semanticInvariants: [
        "preserve-status",
        "preserve-surfaces",
        "preserve-executor-profiles",
        "preserve-bearing-state-bytes",
        "preserve-provider-configuration-bytes",
        "preserve-execution-profile-bytes",
        "preserve-managed-instruction-bytes",
        "zero-native-work-writes",
        "reuse-only-validated-typed-provider-evidence",
        "preserve-provider-evidence-freshness-and-failure",
        "zero-provider-acquisition",
      ],
      writeDomains: {
        canonical: [".bearing/manifest.json"],
        disposable: [
          runtime === "development"
            ? ".bearing/cache/development/project-read-model.sqlite"
            : ".bearing/cache/project-read-model.sqlite",
        ],
      },
      validation: [
        "target-manifest",
        "semantic-invariants",
        "project-read-model-rebuild",
        "repository-lifecycle",
        "repository-diagnostics",
        "original-operation-retry",
      ],
    },
    guide: "references/journeys/update.md",
  };
};

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
    parsed.schemaVersion > 2
  ) {
    return {
      kind: "kit-update-required",
      reason: `Repository uses newer Bearing schema ${parsed.schemaVersion}; the installed Kit reads schema 2 only.`,
      repositorySchemaVersion: parsed.schemaVersion,
      runtimeSchemaVersion: 2,
    };
  }
  const mappableOlderActiveManifest = olderActiveRepositoryManifestSchema.safeParse(parsed);
  const targetPackageVersion = validSemver(packageMetadata.version);
  if (
    mappableOlderActiveManifest.success &&
    targetPackageVersion !== null &&
    compareSemver(mappableOlderActiveManifest.data.packageVersion, targetPackageVersion) < 0
  ) {
    return {
      kind: "repository-update-required",
      reason:
        "The repository has safely readable older Active semantics that can be evaluated against this Kit's target contract.",
      update: repositoryUpdate(mappableOlderActiveManifest.data),
    };
  }
  const lifecycleManifest = repositoryManifestSchema.safeParse(parsed);
  if (lifecycleManifest.success) {
    const repositoryVersion = validSemver(lifecycleManifest.data.packageVersion);
    const runtimeVersion = validSemver(packageMetadata.version);
    if (
      repositoryVersion !== null &&
      runtimeVersion !== null &&
      compareSemver(repositoryVersion, runtimeVersion) > 0
    ) {
      return {
        kind: "kit-update-required",
        reason: `Repository uses newer Bearing package ${repositoryVersion}; the installed Kit is ${runtimeVersion}.`,
      };
    }
  }
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
