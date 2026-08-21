import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, realpath, rmdir } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { z } from "zod";
import packageMetadata from "../package.json";
import {
  type DevelopmentBuildFreshnessRecord,
  developmentBuildInputSha256,
  inspectDevelopmentBuildFreshness,
} from "./development-build";
import type { TargetPlan } from "./install-manifest";
import { applyInstallPlans, preflightInstallTargets } from "./installer";
import { readContainedFile, resolveRepositoryRoot } from "./path-boundary";
import type { RuntimeExecutionContext, RuntimeReceipt } from "./runtime-context";
import { repositoryManifestSchema } from "./schema-definitions";

const sha256Schema = z.string().regex(/^sha256:[0-9a-f]{64}$/u);
const absolutePathSchema = z.string().min(1).refine(isAbsolute, "Expected an absolute path.");

export const developmentRuntimeBindingSchema = z.strictObject({
  schemaVersion: z.literal(1),
  channel: z.literal("development"),
  repositoryRoot: absolutePathSchema,
  cliLocator: absolutePathSchema,
  skillRoot: absolutePathSchema,
  runtimeManifest: absolutePathSchema,
  stateRoot: absolutePathSchema,
});

export const developmentRuntimeSourceIdentitySchema = z.strictObject({
  gitHead: z.string().regex(/^[0-9a-f]{40}$/u),
  dirty: z.boolean(),
});

export const developmentRuntimeManifestPayloadSchema = z.strictObject({
  schemaVersion: z.literal(2),
  runtimeContractVersion: z.literal(2),
  channel: z.literal("development"),
  packageVersion: z.string().min(1),
  builtFrom: developmentRuntimeSourceIdentitySchema,
  buildIdentity: sha256Schema,
});

export const developmentRuntimeManifestSchema = developmentRuntimeManifestPayloadSchema;

export type DevelopmentRuntimeManifestPayload = z.infer<
  typeof developmentRuntimeManifestPayloadSchema
>;
export type DevelopmentRuntimeManifest = z.infer<typeof developmentRuntimeManifestSchema>;

export type RuntimeDiagnostic = Readonly<{
  code: string;
  impact: "blocking";
  target: string;
  message: string;
}>;

export type RuntimeFailure = Readonly<{
  outcome: "unfulfilled" | "recovery-required" | "need-update";
  diagnostics: readonly RuntimeDiagnostic[];
}>;

export type RuntimeResolution =
  | Readonly<{
      outcome: "resolved";
      context: RuntimeExecutionContext;
      cliLocator: string;
      skillRoot: string;
    }>
  | RuntimeFailure;

export type DevelopmentRuntimeBootstrapResult =
  | Readonly<{
      outcome: "applied" | "no-op";
      binding: ".bearing/local/development-runtime.json";
      receipt: RuntimeReceipt;
    }>
  | RuntimeFailure;

const sha256 = (bytes: Uint8Array | string): string =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

export { sha256File } from "./development-build";

const git = (root: string, args: readonly string[]): string => {
  const result = spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `git ${args.join(" ")} failed.`);
  }
  return result.stdout.trim();
};

export type DevelopmentRuntimeSourceIdentity = Readonly<{
  gitHead: string;
  dirty: boolean;
}>;

export const developmentRuntimeSourceIdentity = async (
  sourceRoot: string,
): Promise<DevelopmentRuntimeSourceIdentity> => {
  const root = await realpath(resolve(sourceRoot));
  const gitHead = git(root, ["rev-parse", "HEAD"]);
  return {
    gitHead,
    dirty: git(root, ["status", "--porcelain=v1"]).length > 0,
  };
};

export const developmentRuntimeIdentity = (
  buildIdentity: string,
  sourceProvenance: DevelopmentRuntimeSourceIdentity,
): string =>
  sha256(
    `bearing-development-runtime-v2\n${JSON.stringify({ buildIdentity, sourceProvenance })}\n`,
  );

const diagnostic = (code: string, target: string, message: string): RuntimeDiagnostic => ({
  code,
  impact: "blocking",
  target,
  message,
});

const failed = (
  outcome: Exclude<RuntimeResolution["outcome"], "resolved">,
  code: string,
  target: string,
  message: string,
): RuntimeFailure => ({ outcome, diagnostics: [diagnostic(code, target, message)] });

const readJson = async (
  path: string,
): Promise<Readonly<{ state: "available"; value: unknown }> | Readonly<{ state: "missing" }>> => {
  try {
    return { state: "available", value: JSON.parse(await readFile(path, "utf8")) as unknown };
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return { state: "missing" };
    }
    throw error;
  }
};

const isWithin = (root: string, target: string): boolean => {
  const fromRoot = relative(root, target);
  return fromRoot === "" || (fromRoot !== ".." && !fromRoot.startsWith(`..${sep}`));
};

const canonicalRegularFile = async (path: string): Promise<string> => {
  const canonical = await realpath(path);
  const metadata = await lstat(canonical);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1) {
    throw new Error(`Expected one safe regular file: ${path}`);
  }
  return canonical;
};

const canonicalDirectory = async (path: string): Promise<string> => {
  const canonical = await realpath(path);
  const metadata = await lstat(canonical);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error(`Expected one safe directory: ${path}`);
  }
  return canonical;
};

const schemaVersion = (value: unknown): number | undefined =>
  typeof value === "object" &&
  value !== null &&
  "schemaVersion" in value &&
  typeof value.schemaVersion === "number" &&
  Number.isInteger(value.schemaVersion)
    ? value.schemaVersion
    : undefined;

const stateRootIdentity = (stateRoot: string): string =>
  sha256(`bearing-development-state-root-v1\n${stateRoot}\n`);

type DevelopmentRuntimeMaterialInspection =
  | Readonly<{
      status: "current";
      build: DevelopmentBuildFreshnessRecord;
      sourceProvenance: DevelopmentRuntimeSourceIdentity;
    }>
  | Readonly<{ status: "newer" }>
  | Readonly<{ status: "invalid" }>
  | Readonly<{ status: "stale" }>;

const inspectDevelopmentRuntimeMaterial = async (options: {
  packageRoot: string;
  runtimeManifestPath: string;
  sourceIdentity?: () => Promise<DevelopmentRuntimeSourceIdentity>;
  buildInputSha256?: () => Promise<string>;
}): Promise<DevelopmentRuntimeMaterialInspection> => {
  let runtimeValue: unknown;
  try {
    runtimeValue = JSON.parse(await readFile(options.runtimeManifestPath, "utf8")) as unknown;
  } catch {
    return { status: "invalid" };
  }
  if ((schemaVersion(runtimeValue) ?? 1) > 2) return { status: "newer" };
  const runtime = developmentRuntimeManifestSchema.safeParse(runtimeValue);
  if (!runtime.success) return { status: "invalid" };
  const declaredInputSha256 = await (
    options.buildInputSha256 ?? (() => developmentBuildInputSha256(options.packageRoot))
  )();
  const build = await inspectDevelopmentBuildFreshness({
    packageRoot: options.packageRoot,
    declaredInputSha256,
    expectedPackageVersion: packageMetadata.version,
  });
  if (
    build.status !== "current" ||
    runtime.data.packageVersion !== packageMetadata.version ||
    runtime.data.buildIdentity !== build.record.buildIdentity
  ) {
    return { status: "stale" };
  }
  const sourceProvenance = await (
    options.sourceIdentity ?? (() => developmentRuntimeSourceIdentity(options.packageRoot))
  )();
  return { status: "current", build: build.record, sourceProvenance };
};

const stableResolution = async (
  repositoryRoot: string,
  publicHomeDir: string,
  cliLocator: string,
  skillRoot: string,
): Promise<RuntimeResolution> => {
  const stateRoot = join(resolve(publicHomeDir), ".bearing");
  const receipt: RuntimeReceipt = {
    schemaVersion: 1,
    channel: "stable",
    runtimeIdentity: `package:${packageMetadata.version}`,
    stateRootIdentity: stateRootIdentity(stateRoot),
  };
  return {
    outcome: "resolved",
    context: {
      repositoryRoot,
      homeDir: resolve(publicHomeDir),
      projectReadModelPath: join(repositoryRoot, ".bearing", "cache", "project-read-model.sqlite"),
      receipt,
    },
    cliLocator,
    skillRoot,
  };
};

export const resolveRepositoryRuntime = async (options: {
  repoRoot: string;
  packageRoot: string;
  publicHomeDir: string;
  invokedCliPath: string;
  sourceIdentity?: () => Promise<DevelopmentRuntimeSourceIdentity>;
  buildInputSha256?: () => Promise<string>;
}): Promise<RuntimeResolution> => {
  const repositoryRoot = await resolveRepositoryRoot(options.repoRoot);
  const packageRoot = await canonicalDirectory(options.packageRoot);
  const manifestPath = join(repositoryRoot, ".bearing", "manifest.json");
  const source = await readJson(manifestPath);
  if (source.state === "missing") {
    return stableResolution(
      repositoryRoot,
      options.publicHomeDir,
      resolve(options.invokedCliPath),
      join(packageRoot, "skills", "bearing"),
    );
  }
  const parsedManifest = repositoryManifestSchema.safeParse(source.value);
  const declaresDevelopment =
    typeof source.value === "object" &&
    source.value !== null &&
    "runtime" in source.value &&
    source.value.runtime === "development";
  if (!parsedManifest.success) {
    if (!declaresDevelopment) {
      return stableResolution(
        repositoryRoot,
        options.publicHomeDir,
        resolve(options.invokedCliPath),
        join(packageRoot, "skills", "bearing"),
      );
    }
    return failed(
      (schemaVersion(source.value) ?? 1) > 1 ? "need-update" : "recovery-required",
      "development-runtime-declaration-invalid",
      ".bearing/manifest.json",
      "The Development Runtime declaration is invalid or newer than this resolver.",
    );
  }
  if (parsedManifest.data.runtime !== "development") {
    return stableResolution(
      repositoryRoot,
      options.publicHomeDir,
      resolve(options.invokedCliPath),
      join(packageRoot, "skills", "bearing"),
    );
  }

  const bindingLocator = ".bearing/local/development-runtime.json";
  const bindingPath = join(repositoryRoot, bindingLocator);
  let bindingValue: unknown;
  try {
    bindingValue = JSON.parse(
      (await readContainedFile(repositoryRoot, bindingPath)).toString("utf8"),
    );
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return failed(
        "unfulfilled",
        "development-runtime-binding-missing",
        bindingLocator,
        "Development Runtime requires one machine-local binding.",
      );
    }
    return failed(
      "recovery-required",
      "development-runtime-binding-unreadable",
      bindingLocator,
      "The machine-local Development Runtime binding is malformed or unsafe.",
    );
  }
  if ((schemaVersion(bindingValue) ?? 1) > 1) {
    return failed(
      "need-update",
      "development-runtime-binding-newer",
      bindingLocator,
      "The Development Runtime binding requires a newer resolver.",
    );
  }
  const binding = developmentRuntimeBindingSchema.safeParse(bindingValue);
  if (!binding.success) {
    return failed(
      "recovery-required",
      "development-runtime-binding-invalid",
      bindingLocator,
      "The Development Runtime binding schema is invalid.",
    );
  }

  try {
    const boundRepositoryRoot = await canonicalDirectory(binding.data.repositoryRoot);
    const cliLocator = await canonicalRegularFile(binding.data.cliLocator);
    const skillRoot = await canonicalDirectory(binding.data.skillRoot);
    const runtimeManifestPath = await canonicalRegularFile(binding.data.runtimeManifest);
    const stateRoot = await canonicalDirectory(binding.data.stateRoot);
    const expectedCli = await canonicalRegularFile(join(packageRoot, "dist", "cli.js"));
    const expectedSkill = await canonicalDirectory(join(packageRoot, "skills", "bearing-dev"));
    const discoveredSkill = await canonicalDirectory(
      join(packageRoot, ".agents", "skills", "bearing-dev"),
    );
    const expectedRuntimeManifest = await canonicalRegularFile(
      join(packageRoot, "dist", "development-runtime.json"),
    );
    if (
      boundRepositoryRoot !== repositoryRoot ||
      packageRoot !== repositoryRoot ||
      cliLocator !== expectedCli ||
      skillRoot !== expectedSkill ||
      discoveredSkill !== expectedSkill ||
      runtimeManifestPath !== expectedRuntimeManifest ||
      (await canonicalRegularFile(options.invokedCliPath)) !== cliLocator
    ) {
      return failed(
        "unfulfilled",
        "development-runtime-binding-mismatch",
        bindingLocator,
        "The Development Runtime binding does not select this source repository, Skill, and CLI.",
      );
    }
    const localRoot = await canonicalDirectory(join(repositoryRoot, ".bearing", "local"));
    if (!isWithin(localRoot, stateRoot) || !stateRoot.endsWith(`${sep}.bearing`)) {
      return failed(
        "recovery-required",
        "development-runtime-state-root-unsafe",
        bindingLocator,
        "The Development Runtime state root must be a safe .bearing directory under repository-local machine state.",
      );
    }
    const publicHomeDir = await canonicalDirectory(options.publicHomeDir);
    const publicRoot = join(publicHomeDir, ".bearing");
    if (stateRoot === publicRoot || isWithin(publicRoot, stateRoot)) {
      return failed(
        "unfulfilled",
        "development-runtime-public-root-selected",
        bindingLocator,
        "Development Runtime must not select the public Stable Kit state root.",
      );
    }

    const material = await inspectDevelopmentRuntimeMaterial({
      packageRoot,
      runtimeManifestPath,
      ...(options.sourceIdentity === undefined ? {} : { sourceIdentity: options.sourceIdentity }),
      ...(options.buildInputSha256 === undefined
        ? {}
        : { buildInputSha256: options.buildInputSha256 }),
    });
    if (material.status === "newer") {
      return failed(
        "need-update",
        "development-runtime-manifest-newer",
        "dist/development-runtime.json",
        "The built Development Runtime identity requires a newer resolver.",
      );
    }
    if (material.status === "invalid") {
      return failed(
        "recovery-required",
        "development-runtime-manifest-invalid",
        "dist/development-runtime.json",
        "The built Development Runtime identity manifest is invalid.",
      );
    }
    if (material.status === "stale") {
      return failed(
        "unfulfilled",
        "development-build-stale",
        "dist/development-build.json",
        "Development Runtime build inputs and published CLI or Portal outputs are not coherent.",
      );
    }
    const receipt: RuntimeReceipt = {
      schemaVersion: 1,
      channel: "development",
      runtimeIdentity: developmentRuntimeIdentity(
        material.build.buildIdentity,
        material.sourceProvenance,
      ),
      stateRootIdentity: stateRootIdentity(stateRoot),
      buildIdentity: material.build.buildIdentity,
      sourceProvenance: material.sourceProvenance,
      cliSha256: material.build.outputs.cliSha256,
      portalBuildId: material.build.outputs.portalBuildId,
    };
    return {
      outcome: "resolved",
      context: {
        repositoryRoot,
        homeDir: resolve(stateRoot, ".."),
        projectReadModelPath: join(
          repositoryRoot,
          ".bearing",
          "cache",
          "development",
          "project-read-model.sqlite",
        ),
        receipt,
      },
      cliLocator,
      skillRoot,
    };
  } catch {
    return failed(
      "unfulfilled",
      "development-runtime-material-unavailable",
      bindingLocator,
      "Development Runtime build, Skill, binding, or state material is unavailable.",
    );
  }
};

const ensureDirectory = async (path: string): Promise<boolean> => {
  try {
    const metadata = await lstat(path);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new Error(`Development Runtime path is not a safe directory: ${path}`);
    }
    return false;
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    await mkdir(path);
    return true;
  }
};

export const bootstrapDevelopmentRuntime = async (options: {
  repoRoot: string;
  packageRoot: string;
  publicHomeDir: string;
  invokedCliPath: string;
  sourceIdentity?: () => Promise<DevelopmentRuntimeSourceIdentity>;
  buildInputSha256?: () => Promise<string>;
}): Promise<DevelopmentRuntimeBootstrapResult> => {
  const repositoryRoot = await resolveRepositoryRoot(options.repoRoot);
  const packageRoot = await canonicalDirectory(options.packageRoot);
  if (repositoryRoot !== packageRoot) {
    return failed(
      "unfulfilled",
      "development-runtime-source-mismatch",
      ".bearing/local/development-runtime.json",
      "Development Runtime bootstrap must run from the selected source repository.",
    );
  }
  const declaration = await readJson(join(repositoryRoot, ".bearing", "manifest.json"));
  const parsedDeclaration =
    declaration.state === "available"
      ? repositoryManifestSchema.safeParse(declaration.value)
      : undefined;
  if (parsedDeclaration === undefined || !parsedDeclaration.success) {
    return failed(
      "recovery-required",
      "development-runtime-declaration-invalid",
      ".bearing/manifest.json",
      "Development Runtime bootstrap requires one valid Repository Configuration manifest.",
    );
  }
  if (parsedDeclaration.data.runtime !== "development") {
    return failed(
      "unfulfilled",
      "development-runtime-not-selected",
      ".bearing/manifest.json",
      "Select runtime development through Repository Configuration before bootstrap.",
    );
  }

  const cliLocator = join(packageRoot, "dist", "cli.js");
  const skillRoot = join(packageRoot, "skills", "bearing-dev");
  const publicSkillRoot = join(packageRoot, "skills", "bearing");
  const discoveredSkill = join(packageRoot, ".agents", "skills", "bearing-dev");
  const runtimeManifest = join(packageRoot, "dist", "development-runtime.json");
  try {
    await canonicalRegularFile(cliLocator);
    await canonicalDirectory(skillRoot);
    await canonicalDirectory(publicSkillRoot);
    if ((await canonicalDirectory(discoveredSkill)) !== (await realpath(skillRoot))) {
      return failed(
        "unfulfilled",
        "development-runtime-skill-entry-mismatch",
        ".agents/skills/bearing-dev",
        "Development Runtime requires one repository-local bearing-dev discovery entry.",
      );
    }
    await canonicalRegularFile(runtimeManifest);
    if ((await canonicalRegularFile(options.invokedCliPath)) !== (await realpath(cliLocator))) {
      return failed(
        "unfulfilled",
        "development-runtime-cli-mismatch",
        "dist/cli.js",
        "Development Runtime bootstrap must run through this source checkout's CLI.",
      );
    }
    const material = await inspectDevelopmentRuntimeMaterial({
      packageRoot,
      runtimeManifestPath: runtimeManifest,
      ...(options.sourceIdentity === undefined ? {} : { sourceIdentity: options.sourceIdentity }),
      ...(options.buildInputSha256 === undefined
        ? {}
        : { buildInputSha256: options.buildInputSha256 }),
    });
    if (material.status === "newer") {
      return failed(
        "need-update",
        "development-runtime-manifest-newer",
        "dist/development-runtime.json",
        "The built Development Runtime identity requires a newer resolver.",
      );
    }
    if (material.status === "invalid") {
      return failed(
        "recovery-required",
        "development-runtime-manifest-invalid",
        "dist/development-runtime.json",
        "Build the current source checkout before Development Runtime bootstrap.",
      );
    }
    if (material.status === "stale") {
      return failed(
        "unfulfilled",
        "development-build-stale",
        "dist/development-build.json",
        "Build the declared Development Runtime inputs before bootstrap.",
      );
    }

    const localRoot = join(repositoryRoot, ".bearing", "local");
    const stateHome = join(localRoot, "runtime-home");
    const stateRoot = join(stateHome, ".bearing");
    const created: string[] = [];
    try {
      for (const directory of [localRoot, stateHome, stateRoot]) {
        if (await ensureDirectory(directory)) created.push(directory);
      }
      const bindingPath = join(localRoot, "development-runtime.json");
      const binding = {
        schemaVersion: 1 as const,
        channel: "development" as const,
        repositoryRoot,
        cliLocator: await realpath(cliLocator),
        skillRoot: await realpath(skillRoot),
        runtimeManifest: await realpath(runtimeManifest),
        stateRoot: await realpath(stateRoot),
      };
      const plan: TargetPlan = {
        target: bindingPath,
        bytes: Buffer.from(`${JSON.stringify(binding, null, 2)}\n`, "utf8"),
        executable: false,
      };
      await preflightInstallTargets(repositoryRoot, [bindingPath]);
      const applied = await applyInstallPlans(repositoryRoot, [plan]);
      const resolved = await resolveRepositoryRuntime(options);
      if (resolved.outcome !== "resolved") return resolved;
      return {
        outcome: applied.outcome,
        binding: ".bearing/local/development-runtime.json",
        receipt: resolved.context.receipt,
      };
    } catch (error) {
      for (const directory of [...created].reverse()) {
        try {
          await rmdir(directory);
        } catch {
          break;
        }
      }
      throw error;
    }
  } catch {
    return failed(
      "unfulfilled",
      "development-runtime-material-unavailable",
      "dist/development-runtime.json",
      "Development Runtime build, Skill, or source CLI material is unavailable.",
    );
  }
};
