import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { compare as compareSemver, valid as validSemver } from "semver";
import type { z } from "zod";
import packageMetadata from "../package.json";
import { inspectInstallPath } from "./install-boundary";
import { isRepositoryPathBoundaryError, readContainedFile } from "./path-boundary";
import { olderRepositoryManifestSchema, repositoryManifestSchema } from "./schema-definitions";

const MAXIMUM_REPOSITORY_MANIFEST_BYTES = 64 * 1024;

export type RepositoryUpdateContract = Readonly<{
  source: Readonly<{
    schemaVersion: 1;
    packageVersion: string;
    status: "active" | "deactivated";
  }>;
  target: Readonly<{
    requiredManifestFields: readonly string[];
    manifest: Readonly<{
      schemaVersion: 2;
      packageVersion: string;
      status: "active" | "deactivated";
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
  noWrite?: true;
  nextAction?: string;
}>;

const invalidLifecycle = (
  reason: string,
  nextAction = "Ask the repository semantic owner to identify a compatible Kit or separately authorize repository recovery, then run Configure Inspect again.",
): RepositoryIntegrationLifecycle => ({
  kind: "invalid-or-unsupported",
  reason,
  noWrite: true,
  nextAction,
});

const kitUpdateRequired = (
  reason: string,
  versions: Pick<
    RepositoryIntegrationLifecycle,
    "repositorySchemaVersion" | "runtimeSchemaVersion"
  > = {},
): RepositoryIntegrationLifecycle => ({
  kind: "kit-update-required",
  reason,
  ...versions,
  noWrite: true,
  nextAction:
    "Run a separately authorized Global Kit Update, then retry the original repository operation.",
});

const olderRepositoryAmbiguity = (parsed: unknown, error: z.ZodError): string | undefined => {
  if (typeof parsed !== "object" || parsed === null || !("schemaVersion" in parsed))
    return undefined;
  if (parsed.schemaVersion !== 1) return undefined;
  const unrecognized = error.issues.find((issue) => issue.code === "unrecognized_keys");
  const extraKeys =
    unrecognized !== undefined && "keys" in unrecognized && Array.isArray(unrecognized.keys)
      ? unrecognized.keys.filter((key): key is string => typeof key === "string").sort()
      : [];
  if (extraKeys.length > 0) {
    return `Older repository fields fall outside the target contract and cannot be preserved without separate authority: ${extraKeys.join(", ")}.`;
  }
  const fields = new Set(error.issues.map((issue) => issue.path[0]));
  if (fields.has("status")) {
    return "Older repository lifecycle status is missing or ambiguous; Active versus Deactivated meaning cannot be established.";
  }
  if (fields.has("runtime")) {
    return "Older repository Runtime meaning is invalid or ambiguous and cannot be converted safely.";
  }
  if (fields.has("surfaces")) {
    return "Older repository Agent Surface selections are invalid or ambiguous.";
  }
  if (fields.has("executorProfiles")) {
    return "Older repository Execution Profile selections are invalid or ambiguous.";
  }
  return undefined;
};

const repositoryUpdate = (
  source: z.infer<typeof olderRepositoryManifestSchema>,
): RepositoryUpdateContract => {
  const runtime = source.runtime ?? "stable";
  return {
    source: {
      schemaVersion: source.schemaVersion,
      packageVersion: source.packageVersion,
      status: source.status,
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
        ...(source.status === "deactivated"
          ? [
              "no-active-project-read-model-creation",
              "reactivation-requires-separate-repository-configuration",
            ]
          : []),
      ],
      writeDomains: {
        canonical: [".bearing/manifest.json"],
        disposable:
          source.status === "deactivated"
            ? []
            : [
                runtime === "development"
                  ? ".bearing/cache/development/project-read-model.sqlite"
                  : ".bearing/cache/project-read-model.sqlite",
              ],
      },
      validation: [
        "target-manifest",
        "semantic-invariants",
        ...(source.status === "active" ? ["project-read-model-rebuild"] : []),
        "repository-lifecycle",
        ...(source.status === "active"
          ? ["repository-diagnostics", "original-operation-retry"]
          : []),
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
    return invalidLifecycle(
      "The Bearing namespace is not a safe repository directory.",
      "Ask the repository filesystem owner to restore a safe Bearing namespace, then run Configure Inspect again.",
    );
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
    return invalidLifecycle(
      "The repository manifest must be one safe single-link regular file.",
      "Ask the repository filesystem owner to restore a safe repository manifest, then run Configure Inspect again.",
    );
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
        "Ask the repository filesystem owner to restore safe access, then run Configure Inspect again.",
      );
    }
    return invalidLifecycle(
      "The repository manifest could not be read because repository access is unavailable.",
      "Ask the repository filesystem owner to restore readable access, then run Configure Inspect again.",
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    return invalidLifecycle(
      "The repository manifest is not valid JSON.",
      "Restore a verified repository backup or obtain separate authority for repository recovery, then run Configure Inspect again.",
    );
  }
  if (
    typeof parsed === "object" &&
    parsed !== null &&
    "schemaVersion" in parsed &&
    typeof parsed.schemaVersion === "number" &&
    Number.isInteger(parsed.schemaVersion) &&
    parsed.schemaVersion > 2
  ) {
    return kitUpdateRequired(
      `Repository uses newer Bearing schema ${parsed.schemaVersion}; the installed Kit reads schema 2 only.`,
      { repositorySchemaVersion: parsed.schemaVersion, runtimeSchemaVersion: 2 },
    );
  }
  const mappableOlderManifest = olderRepositoryManifestSchema.safeParse(parsed);
  const targetPackageVersion = validSemver(packageMetadata.version);
  if (mappableOlderManifest.success && targetPackageVersion !== null) {
    const sourceComparison = compareSemver(
      mappableOlderManifest.data.packageVersion,
      targetPackageVersion,
    );
    if (sourceComparison > 0) {
      return kitUpdateRequired(
        `Repository uses newer Bearing package ${mappableOlderManifest.data.packageVersion}; the installed Kit is ${targetPackageVersion}.`,
      );
    }
    return {
      kind: "repository-update-required",
      reason:
        "The repository has safely readable older semantics that can be evaluated against this Kit's target contract.",
      update: repositoryUpdate(mappableOlderManifest.data),
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
      return kitUpdateRequired(
        `Repository uses newer Bearing package ${repositoryVersion}; the installed Kit is ${runtimeVersion}.`,
      );
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
  const ambiguity = mappableOlderManifest.success
    ? undefined
    : olderRepositoryAmbiguity(parsed, mappableOlderManifest.error);
  return invalidLifecycle(
    ambiguity ?? "The repository manifest schema is invalid or unsupported.",
    ambiguity === undefined
      ? undefined
      : "Ask the repository semantic owner to clarify this meaning or grant separate recovery authority, then run Configure Inspect again.",
  );
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
