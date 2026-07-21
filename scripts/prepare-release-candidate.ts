import { spawnSync } from "node:child_process";
import { lstat, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import packageMetadata from "../package.json";
import type { BundleDependencyMetadata } from "./bundle-dependency-boundary";
import { assertCanonicalPackageBoundary } from "./release-boundary";
import {
  type CandidateManifest,
  type CandidateReceipt,
  candidateSchemaVersion,
  canonicalJson,
  sha256Bytes,
  sha256File,
  verifyReleaseCandidate,
} from "./release-candidate-lib";

type PackResult = Readonly<{
  id: string;
  name: string;
  version: string;
  filename: string;
  size: number;
  integrity: string;
  shasum: string;
  files: readonly Readonly<{ path: string; size: number; mode: number }>[];
}>;

const fail = (message: string): never => {
  throw new Error(message);
};

const run = (command: string, args: readonly string[]): string => {
  const result = spawnSync(command, [...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) fail(`${command} ${args.join(" ")} failed:\n${result.stderr}`);
  return result.stdout.trim();
};

const outputArgument = (): string => {
  const index = process.argv.indexOf("--out");
  const output = process.argv[index + 1];
  if (index === -1 || output === undefined) {
    return fail("usage: bun scripts/prepare-release-candidate.ts --out <empty-directory>");
  }
  return resolve(output);
};

const main = async (): Promise<void> => {
  if (packageMetadata.name !== "@lagrangee/bearing")
    fail("package name must be @lagrangee/bearing");
  if (packageMetadata.version !== "0.1.0")
    fail("first Public Preview candidate version must be 0.1.0");
  const changelog = await readFile("CHANGELOG.md", "utf8");
  if (!/^## 0\.1\.0 - Unreleased$/mu.test(changelog))
    fail("CHANGELOG must contain 0.1.0 - Unreleased");

  const sourceStatus = run("git", ["status", "--porcelain=v1", "--untracked-files=all"]);
  if (sourceStatus.length > 0) fail(`public source is not clean:\n${sourceStatus}`);
  const sourceCommit = run("git", ["rev-parse", "HEAD"]);
  if (!/^[a-f0-9]{40}$/u.test(sourceCommit)) fail("could not resolve an exact source commit");

  const output = outputArgument();
  await mkdir(output, { recursive: true });
  if ((await readdir(output)).length > 0) fail("candidate output directory must be empty");

  run("bun", ["scripts/build.ts"]);
  const postBuildTrackedStatus = run("git", ["status", "--porcelain=v1", "--untracked-files=no"]);
  if (postBuildTrackedStatus.length > 0) {
    fail(`candidate build changed tracked source:\n${postBuildTrackedStatus}`);
  }
  const packOutput = run("npm", [
    "pack",
    "--json",
    "--ignore-scripts",
    "--pack-destination",
    output,
  ]);
  const results = JSON.parse(packOutput) as PackResult[];
  if (results.length !== 1) fail("npm pack must produce exactly one artifact");
  const packed = results[0] ?? fail("npm pack did not produce an artifact");
  if (packed.name !== packageMetadata.name || packed.version !== packageMetadata.version) {
    fail("npm pack identity did not match package metadata");
  }
  const artifactPath = resolve(output, packed.filename);
  const packagePaths = packed.files.map((file) => file.path);
  assertCanonicalPackageBoundary(packagePaths);
  const bundleMetadata = JSON.parse(
    await readFile("dist/bundle-dependencies.json", "utf8"),
  ) as BundleDependencyMetadata;
  if (
    bundleMetadata.schemaVersion !== 1 ||
    bundleMetadata.packages.length === 0 ||
    bundleMetadata.bundles.cli.moduleCount === 0 ||
    bundleMetadata.bundles.portal.moduleCount === 0
  ) {
    fail("build dependency metadata is incomplete");
  }
  const files = [...packed.files]
    .map(({ path, size, mode }) => ({ path, size, mode }))
    .sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  const manifest: CandidateManifest = {
    schemaVersion: candidateSchemaVersion,
    packageName: packed.name,
    packageVersion: packed.version,
    sourceCommit,
    files,
  };
  const manifestFile = "candidate-manifest.json";
  const manifestPath = resolve(output, manifestFile);
  await writeFile(manifestPath, canonicalJson(manifest), { flag: "wx" });

  const receipt: CandidateReceipt = {
    schemaVersion: candidateSchemaVersion,
    packageName: packed.name,
    packageVersion: packed.version,
    sourceCommit,
    artifact: {
      file: packed.filename,
      size: (await lstat(artifactPath)).size,
      sha256: await sha256File(artifactPath),
      npmIntegrity: packed.integrity,
      npmShasum: packed.shasum,
    },
    manifest: {
      file: manifestFile,
      sha256: sha256Bytes(Buffer.from(canonicalJson(manifest))),
    },
  };
  const receiptPath = resolve(output, "candidate-receipt.json");
  await writeFile(receiptPath, canonicalJson(receipt), { flag: "wx" });
  await verifyReleaseCandidate(receiptPath, {
    version: packageMetadata.version,
    sourceCommit,
    repositoryRoot: process.cwd(),
  });

  const finalTrackedStatus = run("git", ["status", "--porcelain=v1", "--untracked-files=no"]);
  if (finalTrackedStatus.length > 0)
    fail(`candidate build changed tracked source:\n${finalTrackedStatus}`);
  process.stdout.write(`${receiptPath}\n`);
};

await main();
