import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { assertCanonicalPackageBoundary, assertPackagedReadmeTargets } from "./release-boundary";
import { sha256Bytes, sha256File } from "./release-digest";
import { assertCandidateSourcesMatchCommit } from "./release-source-boundary";

export { sha256Bytes, sha256File } from "./release-digest";

export const candidateSchemaVersion = 1;

export type CandidateManifest = Readonly<{
  schemaVersion: 1;
  packageName: string;
  packageVersion: string;
  sourceCommit: string;
  files: readonly Readonly<{ path: string; size: number; mode: number }>[];
}>;

export type CandidateReceipt = Readonly<{
  schemaVersion: 1;
  packageName: string;
  packageVersion: string;
  sourceCommit: string;
  artifact: Readonly<{
    file: string;
    size: number;
    sha256: string;
    npmIntegrity: string;
    npmShasum: string;
  }>;
  manifest: Readonly<{ file: string; sha256: string }>;
}>;

const fail = (message: string): never => {
  throw new Error(message);
};

export const canonicalJson = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

const parseJson = async <T>(path: string): Promise<T> => {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch (error) {
    return fail(
      `could not parse ${basename(path)}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
};

const assertLeafName = (value: string, label: string): void => {
  if (value.length === 0 || basename(value) !== value || value === "." || value === "..") {
    fail(`${label} must be a file name in the candidate directory`);
  }
};

const assertPackagePath = (value: string): void => {
  const segments = value.split("/");
  if (
    value.length === 0 ||
    value.startsWith("/") ||
    value.includes("\\") ||
    value.includes("\0") ||
    segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")
  ) {
    fail(`unsafe candidate manifest path: ${value}`);
  }
};

const assertSha256 = (value: string, label: string): void => {
  if (!/^[a-f0-9]{64}$/u.test(value)) fail(`${label} must be a lowercase SHA-256 digest`);
};

export const verifyReleaseCandidate = async (
  receiptPath: string,
  expected: Readonly<{
    version?: string;
    sourceCommit?: string;
    repositoryRoot?: string;
  }> = {},
): Promise<CandidateReceipt> => {
  const receipt = await parseJson<CandidateReceipt>(receiptPath);
  if (receipt.schemaVersion !== candidateSchemaVersion)
    fail("unsupported candidate receipt schema");
  if (receipt.packageName !== "@lagrangee/bearing") fail("candidate package name mismatch");
  if (receipt.packageVersion !== "0.1.0") fail("candidate package version must be 0.1.0");
  if (!/^[a-f0-9]{40}$/u.test(receipt.sourceCommit)) fail("candidate source commit is invalid");
  if (expected.version !== undefined && receipt.packageVersion !== expected.version) {
    fail(`candidate version ${receipt.packageVersion} did not match ${expected.version}`);
  }
  if (expected.sourceCommit !== undefined && receipt.sourceCommit !== expected.sourceCommit) {
    fail(`candidate source commit ${receipt.sourceCommit} did not match ${expected.sourceCommit}`);
  }

  assertLeafName(receipt.artifact.file, "candidate artifact");
  assertLeafName(receipt.manifest.file, "candidate manifest");
  if (!receipt.artifact.file.endsWith(".tgz")) fail("candidate artifact must be a tgz file");
  if (!Number.isSafeInteger(receipt.artifact.size) || receipt.artifact.size <= 0) {
    fail("candidate artifact size is invalid");
  }
  assertSha256(receipt.artifact.sha256, "candidate artifact digest");
  assertSha256(receipt.manifest.sha256, "candidate manifest digest");

  const candidateDirectory = dirname(receiptPath);
  const artifactPath = join(candidateDirectory, receipt.artifact.file);
  const manifestPath = join(candidateDirectory, receipt.manifest.file);
  const artifactBytes = await readFile(artifactPath);
  if (artifactBytes.byteLength !== receipt.artifact.size) fail("candidate artifact size mismatch");
  if (sha256Bytes(artifactBytes) !== receipt.artifact.sha256)
    fail("candidate artifact digest mismatch");
  const npmShasum = createHash("sha1").update(artifactBytes).digest("hex");
  if (npmShasum !== receipt.artifact.npmShasum) fail("candidate npm shasum mismatch");
  const npmIntegrity = `sha512-${createHash("sha512").update(artifactBytes).digest("base64")}`;
  if (npmIntegrity !== receipt.artifact.npmIntegrity) fail("candidate npm integrity mismatch");
  if ((await sha256File(manifestPath)) !== receipt.manifest.sha256) {
    fail("candidate manifest digest mismatch");
  }

  const manifest = await parseJson<CandidateManifest>(manifestPath);
  if (manifest.schemaVersion !== candidateSchemaVersion)
    fail("unsupported candidate manifest schema");
  if (manifest.packageName !== receipt.packageName)
    fail("candidate manifest package name mismatch");
  if (manifest.packageVersion !== receipt.packageVersion)
    fail("candidate manifest version mismatch");
  if (manifest.sourceCommit !== receipt.sourceCommit) fail("candidate manifest commit mismatch");
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
    fail("candidate manifest must contain package files");
  }
  for (const file of manifest.files) {
    assertPackagePath(file.path);
    if (!Number.isSafeInteger(file.size) || file.size < 0) {
      fail(`candidate file size is invalid: ${file.path}`);
    }
    if (!Number.isSafeInteger(file.mode) || file.mode < 0 || file.mode > 0o777) {
      fail(`candidate file mode is invalid: ${file.path}`);
    }
  }
  const paths = manifest.files.map((file) => file.path);
  if (new Set(paths).size !== paths.length || [...paths].sort().join("\n") !== paths.join("\n")) {
    fail("candidate manifest paths must be unique and sorted");
  }
  assertCanonicalPackageBoundary(paths);

  const tarList = spawnSync("tar", ["-tzf", artifactPath], { encoding: "utf8" });
  if (tarList.status !== 0) fail(`could not list candidate artifact: ${tarList.stderr}`);
  const tarVerbose = spawnSync("tar", ["-tvzf", artifactPath], { encoding: "utf8" });
  if (tarVerbose.status !== 0) {
    fail(`could not inspect candidate artifact headers: ${tarVerbose.stderr}`);
  }
  const listedPaths = tarList.stdout.split("\n").filter((path) => path.length > 0);
  const verboseHeaders = tarVerbose.stdout.split("\n").filter((line) => line.length > 0);
  if (listedPaths.length !== verboseHeaders.length) {
    fail("candidate artifact header listing is inconsistent");
  }
  const artifactPaths: string[] = [];
  const tarPermissions = new Map<string, string>();
  for (const [index, path] of listedPaths.entries()) {
    const permissionToken =
      verboseHeaders[index]?.trimStart().split(/\s+/u, 1)[0] ??
      fail(`could not parse candidate tar header: ${path}`);
    if (permissionToken.length !== 10) {
      fail(`could not parse candidate tar header: ${path}`);
    }
    if (permissionToken[0] === "d") continue;
    if (permissionToken[0] !== "-") {
      const displayPath = path.startsWith("package/") ? path.slice("package/".length) : path;
      fail(`candidate file type is not regular: ${displayPath}`);
    }
    artifactPaths.push(path);
    tarPermissions.set(path, permissionToken.slice(1));
  }
  artifactPaths.sort();
  const expectedArtifactPaths = paths.map((path) => `package/${path}`).sort();
  if (artifactPaths.join("\n") !== expectedArtifactPaths.join("\n")) {
    fail("candidate manifest file set does not match artifact contents");
  }
  const readmes: string[] = [];
  for (const file of manifest.files) {
    const permissions =
      tarPermissions.get(`package/${file.path}`) ??
      fail(`candidate tar header is missing: ${file.path}`);
    if (/[sStT]/u.test(permissions)) {
      fail(`candidate file mode contains special permission bits: ${file.path}`);
    }
    if (!/^[rwx-]{9}$/u.test(permissions)) {
      fail(`could not parse candidate file mode: ${file.path}`);
    }
    let mode = 0;
    for (const [index, character] of [...permissions].entries()) {
      if (character !== "-") {
        if (index % 3 !== 2 || /[xst]/u.test(character)) mode |= 1 << (8 - index);
      }
    }
    if (mode !== file.mode) {
      fail(`candidate file mode mismatch: ${file.path}`);
    }
    const extracted = spawnSync("tar", ["-xOf", artifactPath, `package/${file.path}`], {
      encoding: "buffer",
      maxBuffer: Math.max(file.size + 1024, 1024 * 1024),
    });
    if (extracted.status !== 0) fail(`could not read candidate file ${file.path}`);
    if (extracted.stdout.byteLength !== file.size)
      fail(`candidate file size mismatch: ${file.path}`);
    if (file.path === "README.md" || file.path === "README.zh-CN.md") {
      readmes.push(extracted.stdout.toString("utf8"));
    }
  }
  assertPackagedReadmeTargets(paths, readmes);

  const packedMetadata = spawnSync("tar", ["-xOf", artifactPath, "package/package.json"], {
    encoding: "utf8",
  });
  if (packedMetadata.status !== 0)
    fail(`could not read candidate package metadata: ${packedMetadata.stderr}`);
  const packageMetadata = JSON.parse(packedMetadata.stdout) as { name?: string; version?: string };
  if (packageMetadata.name !== receipt.packageName) fail("packed package name mismatch");
  if (packageMetadata.version !== receipt.packageVersion) fail("packed package version mismatch");

  if (expected.repositoryRoot !== undefined) {
    assertCandidateSourcesMatchCommit(
      artifactPath,
      paths,
      receipt.sourceCommit,
      expected.repositoryRoot,
    );
  }

  return receipt;
};
