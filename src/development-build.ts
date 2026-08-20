import { createHash, randomUUID } from "node:crypto";
import { lstat, readdir, readFile, rename, rm } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { z } from "zod";
import { loadPortalAssets } from "./portal/assets";

const sha256Schema = z.string().regex(/^sha256:[0-9a-f]{64}$/u);

export const DEVELOPMENT_BUILD_CONTRACT_VERSION = 1 as const;

const developmentBuildOutputsSchema = z.strictObject({
  cliSha256: sha256Schema,
  portalBuildId: z.string().regex(/^[0-9a-f]{64}$/u),
  bundleDependenciesSha256: sha256Schema,
});

export const developmentBuildFreshnessPayloadSchema = z.strictObject({
  schemaVersion: z.literal(1),
  buildContractVersion: z.literal(DEVELOPMENT_BUILD_CONTRACT_VERSION),
  channel: z.literal("development"),
  packageVersion: z.string().min(1),
  declaredInputSha256: sha256Schema,
  outputs: developmentBuildOutputsSchema,
});

export const developmentBuildFreshnessRecordSchema = developmentBuildFreshnessPayloadSchema.extend({
  buildIdentity: sha256Schema,
});

export type DevelopmentBuildFreshnessPayload = z.infer<
  typeof developmentBuildFreshnessPayloadSchema
>;
export type DevelopmentBuildFreshnessRecord = z.infer<typeof developmentBuildFreshnessRecordSchema>;

export type DevelopmentBuildFreshnessInspection =
  | Readonly<{ status: "current"; record: DevelopmentBuildFreshnessRecord }>
  | Readonly<{
      status: "stale";
      reason: "record-unavailable" | "declared-input-mismatch" | "output-mismatch";
    }>;

const declaredBuildInputFiles = [
  "index.html",
  "package-lock.json",
  "package.json",
  "scripts/build.ts",
  "scripts/bundle-dependency-boundary.ts",
  "scripts/dependency-license-overrides.ts",
  "tsconfig.json",
  "vite.config.ts",
] as const;

const declaredBuildInputDirectories = ["src"] as const;

const sha256 = (bytes: Uint8Array | string): string =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

export const sha256File = async (path: string): Promise<string> => sha256(await readFile(path));

const treeFiles = async (root: string, directory = root): Promise<readonly string[]> => {
  const files: string[] = [];
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((left, right) =>
    left.name.localeCompare(right.name, "en"),
  )) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await treeFiles(root, path)));
    else if (entry.isFile()) files.push(relative(root, path).replaceAll(sep, "/"));
    else throw new Error(`Build input contains an unsupported entry: ${path}`);
  }
  return files;
};

const buildInputLocators = async (root: string): Promise<readonly string[]> => {
  const locators: string[] = [...declaredBuildInputFiles];
  for (const directory of declaredBuildInputDirectories) {
    locators.push(...(await treeFiles(root, join(root, directory))));
  }
  return locators.sort((left, right) => left.localeCompare(right, "en"));
};

export const developmentBuildInputSha256 = async (packageRoot: string): Promise<string> => {
  const frames: string[] = [];
  for (const locator of await buildInputLocators(packageRoot)) {
    const path = join(packageRoot, locator);
    const metadata = await lstat(path);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1) {
      throw new Error(`Build input must be one safe regular file: ${path}`);
    }
    frames.push(`${locator}\0${await sha256File(path)}\n`);
  }
  return sha256(
    `bearing-development-build-inputs-v${DEVELOPMENT_BUILD_CONTRACT_VERSION}\n${frames.join("")}`,
  );
};

export const developmentBuildIdentity = (payload: DevelopmentBuildFreshnessPayload): string =>
  sha256(
    `bearing-development-build-v${DEVELOPMENT_BUILD_CONTRACT_VERSION}\n${JSON.stringify(payload)}\n`,
  );

export const createDevelopmentBuildFreshnessRecord = (options: {
  packageVersion: string;
  declaredInputSha256: string;
  cliSha256: string;
  portalBuildId: string;
  bundleDependenciesSha256: string;
}): DevelopmentBuildFreshnessRecord => {
  const payload = developmentBuildFreshnessPayloadSchema.parse({
    schemaVersion: 1,
    buildContractVersion: DEVELOPMENT_BUILD_CONTRACT_VERSION,
    channel: "development",
    packageVersion: options.packageVersion,
    declaredInputSha256: options.declaredInputSha256,
    outputs: {
      cliSha256: options.cliSha256,
      portalBuildId: options.portalBuildId,
      bundleDependenciesSha256: options.bundleDependenciesSha256,
    },
  });
  return developmentBuildFreshnessRecordSchema.parse({
    ...payload,
    buildIdentity: developmentBuildIdentity(payload),
  });
};

export const inspectDevelopmentBuildFreshness = async (options: {
  packageRoot: string;
  declaredInputSha256: string;
  expectedPackageVersion?: string;
}): Promise<DevelopmentBuildFreshnessInspection> => {
  let record: DevelopmentBuildFreshnessRecord;
  try {
    const value = JSON.parse(
      await readFile(join(options.packageRoot, "dist", "development-build.json"), "utf8"),
    ) as unknown;
    record = developmentBuildFreshnessRecordSchema.parse(value);
    const { buildIdentity: _buildIdentity, ...payloadValue } = record;
    const payload = developmentBuildFreshnessPayloadSchema.parse(payloadValue);
    if (
      record.buildIdentity !== developmentBuildIdentity(payload) ||
      (options.expectedPackageVersion !== undefined &&
        record.packageVersion !== options.expectedPackageVersion)
    ) {
      return { status: "stale", reason: "record-unavailable" };
    }
  } catch {
    return { status: "stale", reason: "record-unavailable" };
  }
  if (record.declaredInputSha256 !== options.declaredInputSha256) {
    return { status: "stale", reason: "declared-input-mismatch" };
  }
  try {
    const portal = await loadPortalAssets(options.packageRoot, record.packageVersion);
    if (
      record.outputs.cliSha256 !==
        (await sha256File(join(options.packageRoot, "dist", "cli.js"))) ||
      record.outputs.bundleDependenciesSha256 !==
        (await sha256File(join(options.packageRoot, "dist", "bundle-dependencies.json"))) ||
      record.outputs.portalBuildId !== portal.manifest.buildId
    ) {
      return { status: "stale", reason: "output-mismatch" };
    }
  } catch {
    return { status: "stale", reason: "output-mismatch" };
  }
  return { status: "current", record };
};

const exists = async (path: string): Promise<boolean> => {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
};

export const publishAtomicDevelopmentBuild = async (
  stagedDist: string,
  finalDist: string,
): Promise<void> => {
  const previousDist = join(dirname(finalDist), `.bearing-dist-previous-${randomUUID()}`);
  const hadPrevious = await exists(finalDist);
  if (hadPrevious) await rename(finalDist, previousDist);
  try {
    await rename(stagedDist, finalDist);
  } catch (error) {
    if (hadPrevious) await rename(previousDist, finalDist);
    throw error;
  }
  if (hadPrevious) {
    try {
      await rm(previousDist, { recursive: true, force: true });
    } catch {
      // Publication already committed atomically. Cleanup cannot turn it into a failed build.
    }
  }
};
