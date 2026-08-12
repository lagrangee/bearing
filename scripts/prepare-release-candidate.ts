import { spawnSync } from "node:child_process";
import { lstat, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import packageMetadata from "../package.json";
import type { BundleDependencyMetadata } from "./bundle-dependency-boundary";
import { prepareReleaseCandidateNotes } from "./prepare-preview-release";
import { assertCanonicalPackageBoundary } from "./release-boundary";
import {
  type CandidateManifest,
  type CandidateReceipt,
  candidateSchemaVersion,
  releaseCandidateId,
  serializeCandidateJson,
  sha256Bytes,
  sha256File,
  verifyReleaseCandidate,
} from "./release-candidate-lib";
import { assertExactReleaseCommit } from "./release-identity";

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

const candidateArguments = (): Readonly<{
  output: string;
  version: string;
  sourceCommit: string;
}> => {
  const parsed = parseArgs({
    args: process.argv.slice(2),
    strict: true,
    allowPositionals: false,
    tokens: true,
    options: {
      out: { type: "string" },
      version: { type: "string" },
      "source-commit": { type: "string" },
    },
  });
  for (const name of ["out", "version", "source-commit"] as const) {
    if (
      parsed.tokens.filter((token) => token.kind === "option" && token.name === name).length > 1
    ) {
      fail(`--${name} may be provided only once`);
    }
  }
  return {
    output: resolve(parsed.values.out ?? fail("missing --out")),
    version: parsed.values.version ?? fail("missing --version"),
    sourceCommit: parsed.values["source-commit"] ?? fail("missing --source-commit"),
  };
};

const main = async (): Promise<void> => {
  const { output, version, sourceCommit } = candidateArguments();
  if (packageMetadata.name !== "@lagrangee/bearing")
    fail("package name must be @lagrangee/bearing");
  if (packageMetadata.version !== version) fail(`package version did not match ${version}`);
  assertExactReleaseCommit(sourceCommit, "source commit");
  const workflowName = process.env["GITHUB_WORKFLOW"] ?? fail("missing GITHUB_WORKFLOW");
  const workflowRunId = process.env["GITHUB_RUN_ID"] ?? fail("missing GITHUB_RUN_ID");
  const workflowRunAttemptText =
    process.env["GITHUB_RUN_ATTEMPT"] ?? fail("missing GITHUB_RUN_ATTEMPT");
  if (!/^[1-9][0-9]*$/u.test(workflowRunId)) fail("invalid GITHUB_RUN_ID");
  const workflowRunAttempt = Number(workflowRunAttemptText);
  if (!Number.isSafeInteger(workflowRunAttempt) || workflowRunAttempt <= 0) {
    fail("invalid GITHUB_RUN_ATTEMPT");
  }

  const sourceStatus = run("git", ["status", "--porcelain=v1", "--untracked-files=all"]);
  if (sourceStatus.length > 0) fail(`public source is not clean:\n${sourceStatus}`);
  if (run("git", ["rev-parse", "HEAD"]) !== sourceCommit) {
    fail("checked out HEAD does not match the requested source commit");
  }

  await mkdir(output, { recursive: true });
  if ((await readdir(output)).length > 0) fail("candidate output directory must be empty");
  const releaseNotesFile = "release-notes.md";
  const releaseNotesPath = resolve(output, releaseNotesFile);
  await prepareReleaseCandidateNotes({
    repositoryRoot: process.cwd(),
    expectedPackage: packageMetadata.name,
    expectedVersion: version,
    notesPath: releaseNotesPath,
  });

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
    bundleMetadata.schemaVersion !== 2 ||
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
  await writeFile(manifestPath, serializeCandidateJson(manifest), { flag: "wx" });

  const artifactSha256 = await sha256File(artifactPath);
  const receipt: CandidateReceipt = {
    schemaVersion: candidateSchemaVersion,
    packageName: packed.name,
    packageVersion: packed.version,
    sourceCommit,
    candidateId: releaseCandidateId(
      packed.name,
      packed.version,
      sourceCommit,
      artifactSha256,
      workflowRunId,
      workflowRunAttempt,
    ),
    workflow: {
      name: workflowName,
      runId: workflowRunId,
      runAttempt: workflowRunAttempt,
    },
    toolchain: {
      node: run("node", ["--version"]),
      bun: Bun.version,
      npm: run("npm", ["--version"]),
    },
    artifact: {
      file: packed.filename,
      size: (await lstat(artifactPath)).size,
      sha256: artifactSha256,
      npmIntegrity: packed.integrity,
      npmShasum: packed.shasum,
    },
    manifest: {
      file: manifestFile,
      sha256: sha256Bytes(Buffer.from(serializeCandidateJson(manifest))),
    },
    releaseNotes: {
      file: releaseNotesFile,
      sha256: await sha256File(releaseNotesPath),
    },
  };
  const receiptPath = resolve(output, "candidate-receipt.json");
  await writeFile(receiptPath, serializeCandidateJson(receipt), { flag: "wx" });
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
