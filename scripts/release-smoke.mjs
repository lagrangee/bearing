#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  access,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  readlink,
  realpath,
  rename,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import semver from "semver";
import { readReleaseTarGz } from "./release-archive.ts";
import { readmeRelativeTargets } from "./release-boundary.ts";

const PACKAGE_NAME = "@lagrangee/bearing";
const SUPPORTED_LANES = Object.freeze({ node24: 24, node26: 26 });
const SCRIPT_ROOT = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(SCRIPT_ROOT, "..");
export const RELEASE_SMOKE_SEED = join(PROJECT_ROOT, "tests/fixtures/release-smoke-seed");
const HARNESS_LOCATOR = "scripts/release-smoke.mjs";
const SEED_LOCATOR = "tests/fixtures/release-smoke-seed";
const GIT = "/usr/bin/git";
const GIT_ENVIRONMENT = Object.freeze({
  HOME: tmpdir(),
  PATH: "/usr/bin:/bin",
  LC_ALL: "C",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_NO_REPLACE_OBJECTS: "1",
  GIT_PAGER: "cat",
});

const usage = () => `Usage:
  node scripts/release-smoke.mjs --lane <node24|node26> \\
    --source-commit <full-commit> \\
    --candidate-receipt <absolute-path.json> \\
    --tarball <absolute-path.tgz> --sha256 <digest> --version <version> \\
    [--evidence <absolute-path.json>]

The node24 lane runs the deterministic exact-tarball release journey. The node26 lane runs
the lighter packaged-runtime compatibility check. Evidence is written only when requested.
`;

export const parseReleaseSmokeArgs = (args) => {
  const parsed = parseArgs({
    args,
    strict: true,
    allowPositionals: false,
    tokens: true,
    options: {
      help: { type: "boolean", short: "h" },
      lane: { type: "string" },
      "source-commit": { type: "string" },
      "candidate-receipt": { type: "string" },
      tarball: { type: "string" },
      sha256: { type: "string" },
      version: { type: "string" },
      evidence: { type: "string" },
    },
  });
  if (parsed.values.help === true) return { help: true };
  for (const name of [
    "lane",
    "source-commit",
    "candidate-receipt",
    "tarball",
    "sha256",
    "version",
    "evidence",
  ]) {
    if (parsed.tokens.filter((token) => token.kind === "option" && token.name === name).length > 1) {
      throw new Error(`--${name} may be provided only once.`);
    }
  }
  const options = {
    lane: parsed.values.lane,
    sourceCommit: parsed.values["source-commit"],
    candidateReceipt: parsed.values["candidate-receipt"],
    tarball: parsed.values.tarball,
    sha256: parsed.values.sha256,
    version: parsed.values.version,
    evidence: parsed.values.evidence,
  };

  if (!(options.lane in SUPPORTED_LANES)) {
    throw new Error("--lane must be node24 or node26.");
  }
  if (
    typeof options.sourceCommit !== "string" ||
    !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(options.sourceCommit)
  ) {
    throw new Error("--source-commit must be one explicit full lowercase commit ID.");
  }
  if (typeof options.candidateReceipt !== "string" || !isAbsolute(options.candidateReceipt)) {
    throw new Error("--candidate-receipt must be an absolute path to the candidate machine receipt.");
  }
  if (typeof options.tarball !== "string" || !isAbsolute(options.tarball)) {
    throw new Error("--tarball must be an absolute path to one exact .tgz artifact.");
  }
  if (!options.tarball.endsWith(".tgz")) throw new Error("--tarball must end in .tgz.");
  if (typeof options.sha256 !== "string" || !/^[0-9a-f]{64}$/u.test(options.sha256)) {
    throw new Error("--sha256 must be a lowercase 64-character SHA-256 digest.");
  }
  if (
    typeof options.version !== "string" ||
    semver.valid(options.version) !== options.version ||
    !options.version.startsWith("0.") ||
    options.version.includes("+")
  ) {
    throw new Error("--version must be an explicit 0.x package version.");
  }
  if (options.evidence !== undefined && !isAbsolute(options.evidence)) {
    throw new Error("--evidence must be an absolute path when provided.");
  }
  return Object.freeze(options);
};

export const assertLaneRuntime = (lane, nodeVersion = process.version) => {
  const expectedMajor = SUPPORTED_LANES[lane];
  if (expectedMajor === undefined) throw new Error(`Unknown release smoke lane: ${lane}.`);
  const runtimeVersion = semver.parse(nodeVersion);
  if (runtimeVersion === null || runtimeVersion.major !== expectedMajor) {
    throw new Error(`${lane} requires Node.js ${expectedMajor}; current runtime is ${nodeVersion}.`);
  }
  if (lane === "node24" && semver.lt(runtimeVersion, "24.15.0")) {
    throw new Error(`node24 requires Node.js 24.15.0 or later; current runtime is ${nodeVersion}.`);
  }
};

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

const framedDigest = (files) => {
  const digest = createHash("sha256");
  for (const file of [...files].sort((left, right) => left.path.localeCompare(right.path, "en"))) {
    digest.update(file.path, "utf8");
    digest.update("\0", "utf8");
    digest.update(String(file.bytes.byteLength), "utf8");
    digest.update("\0", "utf8");
    digest.update(file.bytes);
  }
  return digest.digest("hex");
};

export const validateCandidateTarball = async (tarball, expectedDigest) => {
  const metadata = await lstat(tarball).catch((error) => {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      throw new Error(`Candidate tarball does not exist: ${tarball}`);
    }
    throw error;
  });
  if (metadata.isSymbolicLink() || !metadata.isFile() || metadata.nlink !== 1) {
    throw new Error("Candidate tarball must be one single-link regular file, not a link.");
  }
  const canonical = await realpath(tarball);
  const digest = sha256(await readFile(canonical));
  if (digest !== expectedDigest) {
    throw new Error(`Candidate tarball digest mismatch: expected ${expectedDigest}, received ${digest}.`);
  }
  return Object.freeze({ path: canonical, digest });
};

const candidateObject = (value, label) => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object.`);
  }
  return value;
};

const candidateString = (value, label) => {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value;
};

const candidateLeafName = (value, label) => {
  const name = candidateString(value, label);
  if (basename(name) !== name || name === "." || name === ".." || name.includes("\0")) {
    throw new Error(`${label} must be one safe file name.`);
  }
  return name;
};

const candidateDigest = (value, label) => {
  const digest = candidateString(value, label);
  if (!/^[0-9a-f]{64}$/u.test(digest)) {
    throw new Error(`${label} must be a lowercase SHA-256 digest.`);
  }
  return digest;
};

const candidatePackagePath = (value, label) => {
  const path = candidateString(value, label);
  const segments = path.split("/");
  if (
    path.startsWith("/") ||
    path.includes("\\") ||
    /[\u0000-\u001f\u007f]/u.test(path) ||
    segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")
  ) {
    throw new Error(`${label} is unsafe: ${JSON.stringify(path)}.`);
  }
  return path;
};

const parseCandidateJson = (bytes, label) => {
  try {
    return candidateObject(JSON.parse(bytes.toString("utf8")), label);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith(`${label} must`)) throw error;
    throw new Error(`${label} could not be parsed as JSON.`, { cause: error });
  }
};

export const validateCandidateReceiptIdentity = async (
  receiptPath,
  { sourceCommit, packageVersion, candidate, repositoryRoot = PROJECT_ROOT },
) => {
  const receiptMetadata = await lstat(receiptPath);
  if (
    receiptMetadata.isSymbolicLink() ||
    !receiptMetadata.isFile() ||
    receiptMetadata.nlink !== 1
  ) {
    throw new Error("Candidate receipt must be one single-link regular file, not a link.");
  }
  const receiptBytes = await readFile(receiptPath);
  const receipt = candidateObject(JSON.parse(receiptBytes.toString("utf8")), "Candidate receipt");
  if (receipt.schemaVersion !== 1) throw new Error("Unsupported candidate receipt schema.");
  if (receipt.packageName !== PACKAGE_NAME) throw new Error("Candidate receipt package name mismatch.");
  if (receipt.packageVersion !== packageVersion) {
    throw new Error("Candidate receipt package version does not match --version.");
  }
  if (receipt.sourceCommit !== sourceCommit) {
    throw new Error("Candidate receipt source commit does not match --source-commit.");
  }
  if (!/^[0-9a-f]{40}$/u.test(receipt.sourceCommit)) {
    throw new Error("Candidate receipt source commit is invalid.");
  }

  const artifact = candidateObject(receipt.artifact, "Candidate receipt artifact");
  const artifactFile = candidateLeafName(artifact.file, "Candidate receipt artifact file");
  if (!artifactFile.endsWith(".tgz")) {
    throw new Error("Candidate receipt artifact file must end in .tgz.");
  }
  if (!Number.isSafeInteger(artifact.size) || artifact.size <= 0) {
    throw new Error("Candidate receipt artifact size is invalid.");
  }
  const artifactSha256 = candidateDigest(
    artifact.sha256,
    "Candidate receipt artifact digest",
  );
  const artifactPath = join(dirname(receiptPath), artifactFile);
  const artifactMetadata = await lstat(artifactPath);
  if (
    artifactMetadata.isSymbolicLink() ||
    !artifactMetadata.isFile() ||
    artifactMetadata.nlink !== 1
  ) {
    throw new Error("Candidate receipt artifact must be one single-link regular file.");
  }
  if ((await realpath(artifactPath)) !== candidate.path) {
    throw new Error("Candidate receipt artifact path does not match the supplied tarball.");
  }
  if (artifactFile !== basename(candidate.path)) {
    throw new Error("Candidate receipt artifact filename does not match the supplied tarball.");
  }
  if (artifact.size !== artifactMetadata.size) {
    throw new Error("Candidate receipt artifact size does not match the supplied tarball.");
  }
  if (artifactSha256 !== candidate.digest) {
    throw new Error("Candidate receipt artifact digest does not match --sha256.");
  }
  const artifactBytes = await readFile(candidate.path);
  if (artifactBytes.byteLength !== artifact.size || sha256(artifactBytes) !== artifactSha256) {
    throw new Error("Candidate receipt artifact bytes changed during identity verification.");
  }
  if (createHash("sha1").update(artifactBytes).digest("hex") !== artifact.npmShasum) {
    throw new Error("Candidate receipt npm shasum mismatch.");
  }
  const npmIntegrity = `sha512-${createHash("sha512").update(artifactBytes).digest("base64")}`;
  if (npmIntegrity !== artifact.npmIntegrity) {
    throw new Error("Candidate receipt npm integrity mismatch.");
  }

  const manifestIdentity = candidateObject(receipt.manifest, "Candidate receipt manifest");
  const manifestFile = candidateLeafName(
    manifestIdentity.file,
    "Candidate receipt manifest file",
  );
  const manifestDigest = candidateDigest(
    manifestIdentity.sha256,
    "Candidate receipt manifest digest",
  );
  const manifestPath = join(dirname(receiptPath), manifestFile);
  const manifestMetadata = await lstat(manifestPath);
  if (
    manifestMetadata.isSymbolicLink() ||
    !manifestMetadata.isFile() ||
    manifestMetadata.nlink !== 1
  ) {
    throw new Error("Candidate manifest must be one single-link regular file.");
  }
  const manifestBytes = await readFile(manifestPath);
  if (sha256(manifestBytes) !== manifestDigest) {
    throw new Error("Candidate receipt manifest digest mismatch.");
  }
  const manifest = parseCandidateJson(manifestBytes, "Candidate manifest");
  if (
    manifest.schemaVersion !== 1 ||
    manifest.packageName !== PACKAGE_NAME ||
    manifest.packageVersion !== packageVersion ||
    manifest.sourceCommit !== sourceCommit ||
    !Array.isArray(manifest.files) ||
    manifest.files.length === 0
  ) {
    throw new Error("Candidate manifest identity does not match the supplied candidate.");
  }
  const files = manifest.files.map((value, index) => {
    const file = candidateObject(value, `Candidate manifest file ${index}`);
    const path = candidatePackagePath(file.path, `Candidate manifest file ${index} path`);
    if (!Number.isSafeInteger(file.size) || file.size < 0) {
      throw new Error(`Candidate file size is invalid: ${path}.`);
    }
    if (!Number.isSafeInteger(file.mode) || file.mode < 0 || file.mode > 0o777) {
      throw new Error(`Candidate file mode is invalid: ${path}.`);
    }
    return Object.freeze({ path, size: file.size, mode: file.mode });
  });
  const paths = files.map((file) => file.path);
  if (
    new Set(paths).size !== paths.length ||
    [...paths].sort().join("\n") !== paths.join("\n")
  ) {
    throw new Error("Candidate manifest paths must be unique and sorted.");
  }

  const archiveEntries = await readReleaseTarGz(candidate.path);
  const artifactEntries = new Map();
  const artifactPaths = [];
  for (const entry of archiveEntries) {
    if (entry.type === "directory") {
      if (!entry.path.endsWith("/")) {
        throw new Error(`Candidate directory entry must end in a slash: ${entry.path}.`);
      }
      continue;
    }
    if (entry.type !== "file") {
      throw new Error(`Candidate archive entry type is not allowed: ${entry.path}.`);
    }
    if (entry.path.endsWith("/")) {
      throw new Error(`Candidate non-directory entry has a trailing slash: ${entry.path}.`);
    }
    artifactPaths.push(entry.path);
    artifactEntries.set(entry.path, entry);
  }
  artifactPaths.sort();
  const expectedArtifactPaths = paths.map((path) => `package/${path}`).sort();
  if (artifactPaths.join("\n") !== expectedArtifactPaths.join("\n")) {
    throw new Error("Candidate manifest file set does not match artifact contents.");
  }

  const canonicalRepository = await realpath(repositoryRoot);
  for (const file of files) {
    const archivePath = `package/${file.path}`;
    const archived = artifactEntries.get(archivePath);
    if (archived === undefined) {
      throw new Error(`Could not inspect candidate tar header: ${file.path}.`);
    }
    if ((archived.mode & ~0o777) !== 0) {
      throw new Error(`Candidate file has forbidden special permission bits: ${file.path}.`);
    }
    if ((archived.mode & 0o777) !== file.mode) {
      throw new Error(`Candidate file mode mismatch: ${file.path}.`);
    }
    if (archived.bytes.byteLength !== file.size) {
      throw new Error(`Candidate file size mismatch: ${file.path}.`);
    }
    if (!file.path.startsWith("dist/")) {
      let committed;
      try {
        committed = await runGit(canonicalRepository, ["show", `${sourceCommit}:${file.path}`]);
      } catch (error) {
        throw new Error(`Candidate input is not tracked at ${sourceCommit}: ${file.path}.`, {
          cause: error,
        });
      }
      if (!archived.bytes.equals(committed.stdoutBytes)) {
        throw new Error(`Candidate artifact bytes differ from ${sourceCommit}: ${file.path}.`);
      }
    }
  }

  const packedMetadataEntry = artifactEntries.get("package/package.json");
  if (packedMetadataEntry === undefined) {
    throw new Error("Candidate package metadata is absent from the exact tarball.");
  }
  const packedMetadata = candidateObject(
    JSON.parse(packedMetadataEntry.bytes.toString("utf8")),
    "Candidate package metadata",
  );
  if (packedMetadata.name !== PACKAGE_NAME || packedMetadata.version !== packageVersion) {
    throw new Error("Candidate package metadata identity mismatch.");
  }
  if (sha256(await readFile(candidate.path)) !== artifactSha256) {
    throw new Error("Candidate tarball bytes changed during receipt verification.");
  }
  return Object.freeze({
    path: await realpath(receiptPath),
    sha256: sha256(receiptBytes),
    sourceCommit,
    packageVersion,
    artifact: Object.freeze({
      file: artifactFile,
      size: artifact.size,
      sha256: artifactSha256,
    }),
    manifest: Object.freeze({ file: manifestFile, sha256: manifestDigest, files: files.length }),
  });
};

const inside = (parent, child) => {
  const locator = relative(parent, child);
  return locator === "" || (!locator.startsWith(`..${sep}`) && locator !== "..");
};

export const assertIsolationRoots = ({ workRoot, home, cache, repository, install }) => {
  const roots = [home, cache, repository, install].map((path) => resolve(path));
  if (new Set(roots).size !== roots.length) throw new Error("Clean-room roots must be distinct.");
  for (const root of roots) {
    if (!inside(resolve(workRoot), root) || root === resolve(workRoot)) {
      throw new Error("Every clean-room root must be a dedicated child of the disposable root.");
    }
    if (inside(PROJECT_ROOT, root) || inside(root, PROJECT_ROOT)) {
      throw new Error("Clean-room roots must not overlap the current checkout.");
    }
  }
  for (const left of roots) {
    for (const right of roots) {
      if (left !== right && (inside(left, right) || inside(right, left))) {
        throw new Error("Clean-room roots must not contain one another.");
      }
    }
  }
};

export const buildIsolatedEnvironment = ({ home, cache, install, workRoot }) => {
  const runtimeDirectory = dirname(process.execPath);
  const systemPath = [runtimeDirectory, "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"];
  return Object.freeze({
    HOME: home,
    PATH: [...new Set(systemPath)].join(":"),
    TMPDIR: workRoot,
    LANG: "C.UTF-8",
    CI: "1",
    NO_UPDATE_NOTIFIER: "1",
    npm_config_cache: cache,
    npm_config_prefix: install,
    npm_config_update_notifier: "false",
    npm_config_loglevel: "error",
    npm_config_audit: "false",
    npm_config_fund: "false",
  });
};

const collectFiles = async (root, directory = root) => {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name, "en"))) {
    const absolute = join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Release smoke seed contains a link: ${absolute}`);
    if (entry.isDirectory()) files.push(...(await collectFiles(root, absolute)));
    else if (entry.isFile()) files.push(relative(root, absolute).split(sep).join("/"));
    else throw new Error(`Release smoke seed contains an unsupported filesystem entry: ${absolute}`);
  }
  return files;
};

const REQUIRED_SEED_FILES = Object.freeze([
  "CONTEXT.md",
  "docs/agents/issue-tracker.md",
  "docs/agents/triage-labels.md",
  "scratch/release-smoke/PRD.md",
  "scratch/release-smoke/issues/01-orient.md",
  "scratch/release-smoke/map.md",
]);

export const auditReleaseSmokeSeed = async (seedRoot = RELEASE_SMOKE_SEED) => {
  const files = await collectFiles(seedRoot);
  for (const required of REQUIRED_SEED_FILES) {
    if (!files.includes(required)) throw new Error(`Release smoke seed is missing ${required}.`);
  }
  const forbiddenPaths = files.filter(
    (path) =>
      path === ".bearing" ||
      path.startsWith(".bearing/") ||
      path === ".git" ||
      path.startsWith(".git/") ||
      path.includes("evidence/") ||
      path.includes("catalog"),
  );
  if (forbiddenPaths.length > 0) {
    throw new Error(`Release smoke seed contains forbidden state: ${forbiddenPaths.join(", ")}`);
  }
  for (const path of files) {
    const source = await readFile(join(seedRoot, path), "utf8");
    if (/\/(?:Users|home)\/[^/]+\//u.test(source) || /-----BEGIN [A-Z ]+PRIVATE KEY-----/u.test(source)) {
      throw new Error(`Release smoke seed contains maintainer-local or secret material: ${path}`);
    }
  }
  return Object.freeze(files);
};

const materializeSeed = async (repository, sourceBinding) => {
  await mkdir(repository);
  for (const file of sourceBinding.seedFiles) {
    const materialized = file.path.startsWith("scratch/")
      ? `.scratch/${file.path.slice("scratch/".length)}`
      : file.path;
    const target = join(repository, ...materialized.split("/"));
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, file.bytes, { flag: "wx" });
  }
};

const runCommand = async (command, args, options) =>
  new Promise((resolveCommand, rejectCommand) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", rejectCommand);
    child.on("close", (exitCode, signal) => {
      const stdoutBytes = Buffer.concat(stdout);
      const stderrBytes = Buffer.concat(stderr);
      resolveCommand({
        exitCode: exitCode ?? -1,
        signal,
        stdout: stdoutBytes.toString("utf8"),
        stderr: stderrBytes.toString("utf8"),
        stdoutBytes,
        stderrBytes,
      });
    });
  });

const expectCommand = async (label, command, args, options) => {
  const result = await runCommand(command, args, options);
  if (result.exitCode !== 0) {
    throw new Error(`${label} failed (${result.exitCode}): ${result.stderr || result.stdout}`);
  }
  return result;
};

const runGit = async (projectRoot, args) =>
  expectCommand(`git ${args.join(" ")}`, GIT, args, {
    cwd: projectRoot,
    env: GIT_ENVIRONMENT,
  });

const regularTrackedBytes = async (projectRoot, locator) => {
  const target = join(projectRoot, ...locator.split("/"));
  const metadata = await lstat(target);
  if (metadata.isSymbolicLink() || !metadata.isFile() || metadata.nlink !== 1) {
    throw new Error(`Frozen smoke input must be one single-link regular file: ${locator}.`);
  }
  return readFile(target);
};

export const verifyFrozenSourceInputs = async ({
  projectRoot = PROJECT_ROOT,
  sourceCommit,
  harnessLocator = HARNESS_LOCATOR,
  seedLocator = SEED_LOCATOR,
}) => {
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(sourceCommit)) {
    throw new Error("Source commit must be one explicit full lowercase commit ID.");
  }
  const canonicalRoot = await realpath(projectRoot);
  const resolvedCommit = (
    await runGit(canonicalRoot, ["rev-parse", "--verify", `${sourceCommit}^{commit}`])
  ).stdout.trim();
  if (resolvedCommit !== sourceCommit) {
    throw new Error("Source commit does not resolve to the exact supplied commit ID.");
  }
  const head = (
    await runGit(canonicalRoot, ["rev-parse", "--verify", "HEAD^{commit}"])
  ).stdout.trim();
  if (head !== sourceCommit) {
    throw new Error(`Release smoke HEAD mismatch: expected ${sourceCommit}, received ${head}.`);
  }

  const absoluteSeed = join(canonicalRoot, ...seedLocator.split("/"));
  const currentSeedFiles = (await auditReleaseSmokeSeed(absoluteSeed)).map(
    (path) => `${seedLocator}/${path}`,
  );
  const committedSeedFiles = (
    await runGit(canonicalRoot, ["ls-tree", "-r", "--name-only", sourceCommit, "--", seedLocator])
  ).stdout
    .trim()
    .split("\n")
    .filter((path) => path.length > 0)
    .sort((left, right) => left.localeCompare(right, "en"));
  const currentLocators = [...currentSeedFiles].sort((left, right) =>
    left.localeCompare(right, "en"),
  );
  if (JSON.stringify(currentLocators) !== JSON.stringify(committedSeedFiles)) {
    throw new Error("Release smoke seed file set differs from the frozen source commit.");
  }

  const locators = [harnessLocator, ...currentLocators];
  const captured = [];
  for (const locator of locators) {
    const bytes = await regularTrackedBytes(canonicalRoot, locator);
    const committed = (await runGit(canonicalRoot, ["show", `${sourceCommit}:${locator}`]))
      .stdoutBytes;
    if (!bytes.equals(committed)) {
      throw new Error(`Release smoke input differs from frozen source commit: ${locator}.`);
    }
    captured.push(Object.freeze({ path: locator, bytes }));
  }
  const harness = captured.find((file) => file.path === harnessLocator);
  if (harness === undefined) throw new Error("Release smoke harness input was not captured.");
  const seedFiles = captured
    .filter((file) => file.path.startsWith(`${seedLocator}/`))
    .map((file) =>
      Object.freeze({
        path: file.path.slice(seedLocator.length + 1),
        bytes: file.bytes,
      }),
    );
  return Object.freeze({
    sourceCommit,
    harnessSha256: sha256(harness.bytes),
    seedDigest: framedDigest(seedFiles),
    seedManifest: Object.freeze(
      seedFiles.map((file) =>
        Object.freeze({ path: file.path, sha256: sha256(file.bytes), bytes: file.bytes.byteLength }),
      ),
    ),
    seedFiles: Object.freeze(seedFiles),
  });
};

const resolveNpm = async () => {
  const runtimeDirectory = dirname(process.execPath);
  const candidates = [
    join(runtimeDirectory, "npm"),
    "/opt/homebrew/bin/npm",
    "/usr/local/bin/npm",
    "/usr/bin/npm",
  ];
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {}
  }
  throw new Error("npm was not found beside the selected Node runtime or in a system location.");
};

const installedPackageRoot = (install) =>
  join(install, "lib/node_modules", ...PACKAGE_NAME.split("/"));

const assertInstalledIdentity = async (install, expectedVersion) => {
  const packageRoot = installedPackageRoot(install);
  const metadata = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
  if (metadata.name !== PACKAGE_NAME || metadata.version !== expectedVersion) {
    throw new Error(
      `Installed package identity mismatch: ${String(metadata.name)}@${String(metadata.version)}.`,
    );
  }
  const cli = join(packageRoot, "dist/cli.js");
  const cliMetadata = await lstat(cli);
  if (!cliMetadata.isFile() || cliMetadata.isSymbolicLink()) {
    throw new Error("Installed candidate CLI is not a regular package file.");
  }
  return Object.freeze({ packageRoot, cli });
};

const runCandidateCli = (cli, args, options) =>
  expectCommand(`bearing ${args.join(" ")}`, process.execPath, [cli, ...args], options);

export const checkPackagedDocumentation = async (packageRoot) => {
  const metadata = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
  const readmes = await Promise.all(
    ["README.md", "README.zh-CN.md"].map(async (path) => ({
      path,
      source: await readFile(join(packageRoot, path), "utf8"),
    })),
  );
  const readme = readmes[0]?.source.toLowerCase() ?? "";
  if (metadata.bugs?.url !== "https://github.com/lagrangee/bearing/issues") {
    throw new Error("Packaged metadata does not expose the canonical feedback route.");
  }
  const targets = readmes.flatMap(({ source }) => readmeRelativeTargets(source));
  for (const locator of targets) {
    const linked = join(packageRoot, ...locator.split("/"));
    const linkedMetadata = await lstat(linked).catch((error) => {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        throw new Error(`Packaged README target is absent from the exact tarball: ${locator}.`);
      }
      throw error;
    });
    if (linkedMetadata.isSymbolicLink() || !linkedMetadata.isFile()) {
      throw new Error(`Packaged README target is not a regular package file: ${locator}.`);
    }
  }
  if (!readme.includes("package-manager uninstall") || !readme.includes("separate recovery")) {
    throw new Error("Packaged README does not preserve package-manager uninstall ownership.");
  }
};

const pathExists = async (target) => {
  try {
    await lstat(target);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
};

const readCatalog = async (home) => {
  const { DatabaseSync } = await import("node:sqlite");
  const database = new DatabaseSync(join(home, ".bearing/catalog.sqlite"), { readOnly: true });
  try {
    return {
      entries: database
        .prepare(
          "SELECT entry_id AS entryId, repo_root AS repoRoot, display_name AS displayName FROM catalog_entries",
        )
        .all(),
    };
  } finally {
    database.close();
  }
};

const catalogContains = async (home, repository) => {
  const canonicalRepository = await realpath(repository);
  const catalog = await readCatalog(home);
  if (!Array.isArray(catalog.entries)) throw new Error("Temporary Project Catalog is malformed.");
  return catalog.entries.some((entry) => entry?.repoRoot === canonicalRepository);
};

const assertManagedPointersAbsent = async (repository) => {
  for (const name of ["AGENTS.md", "CLAUDE.md"]) {
    const source = await readFile(join(repository, name), "utf8");
    if (source.includes("bearing:managed-start") || source.includes("global `bearing` skill")) {
      throw new Error(`${name} retained its managed Bearing block after repository lifecycle.`);
    }
  }
};

const installArguments = Object.freeze([
  "install",
  "--surface",
  "agent-skills",
  "--surface",
  "claude",
]);

const setupArguments = (repository, { confirmReactivate = false } = {}) => [
  "setup",
  "--repo",
  repository,
  "--surface",
  "agent-skills",
  "--surface",
  "claude",
  "--provider-contract",
  "docs/agents/issue-tracker.md",
  ...(confirmReactivate ? ["--confirm-reactivate"] : []),
];

const proveIdempotentUpdate = async ({ cli, roots, environment }) => {
  const repeated = await runCandidateCli(cli, installArguments, {
    cwd: roots.repository,
    env: environment,
  });
  if (!repeated.stdout.includes("Outcome: no-op") || !repeated.stdout.includes("Changed targets: 0")) {
    throw new Error("Same-candidate install/update rerun was not a no-op.");
  }
};

const proveSurfaceConflict = async ({ cli, roots, environment, version }) => {
  const surfaceLink = join(roots.home, ".agents/skills/bearing");
  const outside = join(roots.workRoot, "external-surface-target");
  const sentinel = join(outside, "sentinel.txt");
  const sentinelBytes = Buffer.from("external target must stay unchanged\n", "utf8");
  const bundleMetadata = join(roots.home, ".bearing/kit/current/package.json");
  const bundleBytes = await readFile(bundleMetadata);
  await mkdir(outside);
  await writeFile(sentinel, sentinelBytes);
  await unlink(surfaceLink);
  await symlink(outside, surfaceLink);

  const conflicted = await runCommand(process.execPath, [cli, ...installArguments], {
    cwd: roots.repository,
    env: environment,
  });
  if (conflicted.exitCode === 0) {
    throw new Error("Unmanaged Agent Surface conflict did not fail closed.");
  }
  if (!(await readFile(sentinel)).equals(sentinelBytes) || (await readlink(surfaceLink)) !== outside) {
    throw new Error("Agent Surface conflict mutated the external target.");
  }
  if (!(await readFile(bundleMetadata)).equals(bundleBytes)) {
    throw new Error("Agent Surface preflight conflict mutated the current managed bundle.");
  }

  await unlink(surfaceLink);
  const restored = await runCandidateCli(cli, installArguments, {
    cwd: roots.repository,
    env: environment,
  });
  if (!restored.stdout.includes("Outcome: applied")) {
    throw new Error("Exact candidate did not restore its removed managed surface link.");
  }
  await assertGlobalSurface(roots.home, version);
};

const proveRepositoryLifecycle = async ({ cli, roots, environment }) => {
  const stateMarker = join(roots.repository, ".bearing/state/recovery-marker.txt");
  const stateBytes = Buffer.from("accepted state stays during deactivate\n", "utf8");
  const nativeWork = join(roots.repository, ".scratch/release-smoke/map.md");
  const nativeBytes = await readFile(nativeWork);
  await writeFile(stateMarker, stateBytes);
  if (!(await catalogContains(roots.home, roots.repository))) {
    throw new Error("Setup did not register the disposable repository in Project Catalog.");
  }

  const deactivated = await runCandidateCli(cli, ["deactivate", "--repo", roots.repository], {
    cwd: roots.repository,
    env: environment,
  });
  if (!deactivated.stdout.includes("Catalog: applied")) {
    throw new Error("Repository deactivation did not remove its Project Catalog entry.");
  }
  if (await pathExists(join(roots.repository, ".bearing/manifest.json"))) {
    throw new Error("Repository deactivation retained its enablement manifest.");
  }
  if (!(await readFile(stateMarker)).equals(stateBytes) || !(await readFile(nativeWork)).equals(nativeBytes)) {
    throw new Error("Repository deactivation did not preserve state and native work exactly.");
  }
  await assertManagedPointersAbsent(roots.repository);
  if (await catalogContains(roots.home, roots.repository)) {
    throw new Error("Repository deactivation retained its Project Catalog entry.");
  }

  await runCandidateCli(cli, setupArguments(roots.repository, { confirmReactivate: true }), {
    cwd: roots.repository,
    env: environment,
  });
  if (
    !(await readFile(stateMarker)).equals(stateBytes) ||
    !(await catalogContains(roots.home, roots.repository))
  ) {
    throw new Error("Repository re-setup did not preserve state and restore Catalog registration.");
  }

  const purgePlan = await runCandidateCli(
    cli,
    ["purge", "--repo", roots.repository, "--plan"],
    { cwd: roots.repository, env: environment },
  );
  const reviewedPurge = JSON.parse(purgePlan.stdout);
  if (
    reviewedPurge.outcome !== "cancelled" ||
    typeof reviewedPurge.confirmationToken !== "string" ||
    !/^[0-9a-f]{64}$/u.test(reviewedPurge.confirmationToken) ||
    !(await pathExists(join(roots.repository, ".bearing")))
  ) {
    throw new Error("Repository purge did not return one non-mutating confirmation plan.");
  }
  const purged = await runCandidateCli(
    cli,
    [
      "purge",
      "--repo",
      roots.repository,
      "--confirm-purge",
      "--purge-plan-token",
      reviewedPurge.confirmationToken,
      "--accept-no-recovery-export",
    ],
    { cwd: roots.repository, env: environment },
  );
  if (!purged.stdout.includes("Catalog: applied")) {
    throw new Error("Repository purge did not remove its Project Catalog entry.");
  }
  if (await pathExists(join(roots.repository, ".bearing"))) {
    throw new Error("Confirmed repository purge retained the .bearing namespace.");
  }
  if (!(await readFile(nativeWork)).equals(nativeBytes)) {
    throw new Error("Confirmed repository purge mutated native .scratch work.");
  }
  await assertManagedPointersAbsent(roots.repository);
  if (await catalogContains(roots.home, roots.repository)) {
    throw new Error("Confirmed repository purge retained its Project Catalog entry.");
  }
};

const proveDowngradeRefusal = async ({ cli, roots, environment }) => {
  const installedPackage = join(roots.home, ".bearing/kit/current/package.json");
  const metadata = JSON.parse(await readFile(installedPackage, "utf8"));
  const higherBytes = Buffer.from(
    `${JSON.stringify({ ...metadata, version: "0.2.0" }, null, 2)}\n`,
    "utf8",
  );
  await writeFile(installedPackage, higherBytes);
  const refused = await runCommand(process.execPath, [cli, ...installArguments], {
    cwd: roots.repository,
    env: environment,
  });
  if (refused.exitCode === 0 || !/requires --confirm-downgrade/iu.test(refused.stderr)) {
    throw new Error("Whole-bundle downgrade did not require explicit confirmation.");
  }
  if (!(await readFile(installedPackage)).equals(higherBytes)) {
    throw new Error("Refused package downgrade mutated the installed bundle metadata.");
  }
};

const assertGlobalSurface = async (home, version) => {
  const bundleMetadata = JSON.parse(
    await readFile(join(home, ".bearing/kit/current/package.json"), "utf8"),
  );
  if (bundleMetadata.name !== PACKAGE_NAME || bundleMetadata.version !== version) {
    throw new Error("Managed bundle identity does not match the installed candidate.");
  }
  for (const path of [
    ".agents/skills/bearing/SKILL.md",
    ".claude/skills/bearing/SKILL.md",
    ".bearing/bin/bearing",
  ]) {
    await access(join(home, path));
    const target = await realpath(join(home, path));
    if (!inside(home, target)) throw new Error(`Managed Agent Surface escapes temporary HOME: ${path}`);
  }
};

const runCompatibilityLane = async ({ candidate, options, roots, environment, cli, packageRoot }) => {
  const version = await runCandidateCli(cli, ["--version"], {
    cwd: roots.repository,
    env: environment,
  });
  if (version.stdout !== `${options.version}\n`) throw new Error("Packaged CLI version output mismatches.");
  const help = await runCandidateCli(cli, ["--help"], { cwd: roots.repository, env: environment });
  if (!help.stdout.includes(`Bearing ${options.version}`) || !help.stdout.includes("bearing setup")) {
    throw new Error("Packaged CLI help does not expose the expected candidate commands.");
  }
  await checkPackagedDocumentation(packageRoot);
  if (sha256(await readFile(candidate.path)) !== candidate.digest) {
    throw new Error("Candidate tarball bytes changed during compatibility smoke.");
  }
  return ["exact-artifact-install", "installed-package-identity", "cli-version-help", "packaged-guidance"];
};

const runFullLane = async ({ candidate, options, roots, environment, cli, packageRoot }) => {
  const checks = await runCompatibilityLane({
    candidate,
    options,
    roots,
    environment,
    cli,
    packageRoot,
  });
  const help = await runCandidateCli(cli, ["--help"], {
    cwd: roots.repository,
    env: environment,
  });
  if (help.stdout.includes("bearing uninstall")) {
    throw new Error("CLI incorrectly claims ownership of package-manager uninstall.");
  }
  await runCandidateCli(cli, installArguments, { cwd: roots.repository, env: environment });
  await assertGlobalSurface(roots.home, options.version);
  await proveIdempotentUpdate({ cli, roots, environment });
  await proveSurfaceConflict({ cli, roots, environment, version: options.version });
  await runCandidateCli(
    cli,
    setupArguments(roots.repository),
    { cwd: roots.repository, env: environment },
  );
  const manifestPath = join(roots.repository, ".bearing/manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (manifest.packageVersion !== options.version) {
    throw new Error("Repository manifest does not match the installed candidate version.");
  }
  for (const pointer of ["AGENTS.md", "CLAUDE.md"]) {
    const source = await readFile(join(roots.repository, pointer), "utf8");
    if (!source.includes("global `bearing` skill")) {
      throw new Error(`${pointer} does not contain the managed Bearing runbook pointer.`);
    }
  }
  const sync = await runCandidateCli(cli, ["sync", "--repo", roots.repository], {
    cwd: roots.repository,
    env: environment,
  });
  if (!sync.stdout.includes("Diagnostics: 0")) throw new Error("Golden-path Sync has diagnostics.");
  const sitemap = await readFile(join(roots.repository, ".bearing/cache/project-sitemap.md"), "utf8");
  if (!sitemap.includes(".scratch/release-smoke/map.md") || !sitemap.includes("01-orient.md")) {
    throw new Error("Golden-path Sync did not project the deterministic native tracker seed.");
  }

  const unsupported = join(roots.workRoot, "unsupported-schema-repository");
  await cp(roots.repository, unsupported, { recursive: true, errorOnExist: true });
  const unsupportedManifest = join(unsupported, ".bearing/manifest.json");
  const unsupportedDocument = JSON.parse(await readFile(unsupportedManifest, "utf8"));
  unsupportedDocument.schemaVersion = 999;
  const unsupportedBytes = Buffer.from(`${JSON.stringify(unsupportedDocument, null, 2)}\n`, "utf8");
  await writeFile(unsupportedManifest, unsupportedBytes);
  const unsupportedSync = await runCommand(
    process.execPath,
    [cli, "sync", "--repo", unsupported],
    { cwd: unsupported, env: environment },
  );
  if (unsupportedSync.exitCode === 0) {
    throw new Error("Unsupported repository schema did not fail with a non-zero exit status.");
  }
  if (!(await readFile(unsupportedManifest)).equals(unsupportedBytes)) {
    throw new Error("Unsupported repository schema input was rewritten instead of failing closed.");
  }
  if (!/unsupported|invalid-bearing-manifest|schema/iu.test(`${unsupportedSync.stdout}\n${unsupportedSync.stderr}`)) {
    throw new Error("Unsupported repository schema failure did not explain the incompatible state.");
  }
  checks.push(
    "same-candidate-update-no-op",
    "agent-surface-conflict-fail-closed",
    "managed-agent-surfaces",
    "ordinary-repository-setup",
    "deterministic-sync",
    "unsupported-schema-fail-closed",
    "repository-deactivate-preserves-state",
    "repository-purge-preserves-native-work",
    "package-downgrade-requires-confirmation",
    "package-uninstall-owned-by-package-manager",
  );
  await proveRepositoryLifecycle({ cli, roots, environment });
  await proveDowngradeRefusal({ cli, roots, environment });
  return checks;
};

const writeEvidence = async (target, receipt) => {
  await mkdir(dirname(target), { recursive: true });
  const temporary = `${target}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(receipt, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  await rename(temporary, target);
};

export const runReleaseSmoke = async (options) => {
  assertLaneRuntime(options.lane);
  const sourceBinding = await verifyFrozenSourceInputs({ sourceCommit: options.sourceCommit });
  const candidate = await validateCandidateTarball(options.tarball, options.sha256);
  const candidateReceipt = await validateCandidateReceiptIdentity(options.candidateReceipt, {
    sourceCommit: options.sourceCommit,
    packageVersion: options.version,
    candidate,
  });
  const workRoot = await realpath(
    await mkdtemp(join(tmpdir(), `bearing-release-smoke-${options.lane}-`)),
  );
  const roots = Object.freeze({
    workRoot,
    home: join(workRoot, "home"),
    cache: join(workRoot, "npm-cache"),
    repository: join(workRoot, "repository"),
    install: join(workRoot, "npm-prefix"),
  });
  try {
    assertIsolationRoots(roots);
    await Promise.all([
      mkdir(roots.home),
      mkdir(roots.cache),
      mkdir(roots.install),
      materializeSeed(roots.repository, sourceBinding),
    ]);
    const environment = buildIsolatedEnvironment(roots);
    const npm = await resolveNpm();
    await expectCommand(
      "install exact candidate tarball",
      npm,
      [
        "install",
        "--global",
        "--offline",
        "--ignore-scripts",
        "--no-package-lock",
        candidate.path,
      ],
      { cwd: workRoot, env: environment },
    );
    const installed = await assertInstalledIdentity(roots.install, options.version);
    const context = {
      candidate,
      options,
      roots,
      environment,
      cli: installed.cli,
      packageRoot: installed.packageRoot,
    };
    const checks =
      options.lane === "node24"
        ? await runFullLane(context)
        : await runCompatibilityLane(context);
    const receipt = Object.freeze({
      schemaVersion: 1,
      kind: "bearing-release-smoke-input",
      outcome: "passed",
      lane: options.lane,
      node: process.version,
      sourceCommit: sourceBinding.sourceCommit,
      candidateReceipt: {
        filename: basename(candidateReceipt.path),
        sha256: candidateReceipt.sha256,
        sourceCommit: candidateReceipt.sourceCommit,
        packageVersion: candidateReceipt.packageVersion,
        artifact: candidateReceipt.artifact,
        manifest: candidateReceipt.manifest,
      },
      harness: { path: HARNESS_LOCATOR, sha256: sourceBinding.harnessSha256 },
      seed: {
        root: SEED_LOCATOR,
        sha256: sourceBinding.seedDigest,
        manifest: sourceBinding.seedManifest,
      },
      package: { name: PACKAGE_NAME, version: options.version },
      tarball: { filename: basename(candidate.path), sha256: candidate.digest },
      isolation: ["temporary-home", "temporary-npm-cache", "temporary-repository", "exact-tarball-cli"],
      checks,
      coverageNotes: {
        catalogSplitOutcome:
          "Focused implementation tests only; the packaged CLI smoke does not inject a Catalog write failure.",
        packageUninstall:
          "Ownership and guidance only; the smoke does not invoke the maintainer package manager.",
        downgrade:
          "Refusal only; package downgrade is not repository-state rollback.",
      },
    });
    if (options.evidence !== undefined) await writeEvidence(options.evidence, receipt);
    return receipt;
  } finally {
    await rm(workRoot, { recursive: true, force: true });
  }
};

const isMain =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isMain) {
  try {
    const options = parseReleaseSmokeArgs(process.argv.slice(2));
    if (options.help === true) process.stdout.write(usage());
    else process.stdout.write(`${JSON.stringify(await runReleaseSmoke(options), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
