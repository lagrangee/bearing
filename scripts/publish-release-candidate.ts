import { spawnSync } from "node:child_process";
import { lstat, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { parseArgs } from "node:util";
import {
  bootstrapFrozenPackage,
  type FrozenPublication,
  type Observed,
  type PublicationObservation,
  type PublicationSurfaces,
  recoverFrozenPublication,
} from "./publication-recovery";
import { sha256Bytes, sha256File, verifyReleaseCandidate } from "./release-candidate-lib";
import { assertExactReleaseCommit } from "./release-identity";

const fail = (message: string): never => {
  throw new Error(message);
};

const run = (
  command: string,
  args: readonly string[],
  options: Readonly<{ cwd?: string; env?: NodeJS.ProcessEnv }> = {},
): string => {
  const result = spawnSync(command, [...args], {
    cwd: options.cwd,
    env: options.env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    fail(`${command} ${args.join(" ")} failed:\n${result.stderr}`);
  }
  return result.stdout.trim();
};

const fetchJson = async <T>(url: string, token?: string): Promise<Observed<T>> => {
  try {
    const headers = new Headers({ Accept: "application/vnd.github+json" });
    if (token !== undefined) {
      headers.set("Authorization", `Bearer ${token}`);
      headers.set("X-GitHub-Api-Version", "2022-11-28");
    }
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) });
    if (response.status === 404) return { kind: "absent" };
    if (!response.ok) return { kind: "unverifiable", reason: `HTTP ${response.status}` };
    return { kind: "available", value: (await response.json()) as T };
  } catch (error) {
    return {
      kind: "unverifiable",
      reason: error instanceof Error ? error.message : String(error),
    };
  }
};

const asObserved = <Input, Output>(
  result: Observed<Input>,
  map: (value: Input) => Output,
): Observed<Output> =>
  result.kind === "available" ? { kind: "available", value: map(result.value) } : result;

class LivePublicationSurfaces implements PublicationSurfaces {
  private readonly npmPath: string;

  constructor(
    private readonly candidate: FrozenPublication,
    private readonly repository: string,
    private readonly githubApiUrl: string,
    private readonly githubToken: string,
    private readonly bootstrapToken: string | undefined,
  ) {
    this.npmPath = "@lagrangee%2fbearing";
  }

  private async npmObservation(candidate: FrozenPublication): Promise<{
    package: PublicationObservation["package"];
    version: PublicationObservation["npmVersion"];
  }> {
    const [packument, version] = await Promise.all([
      fetchJson<Readonly<{ "dist-tags"?: Readonly<Record<string, string>> }>>(
        `https://registry.npmjs.org/${this.npmPath}`,
      ),
      fetchJson<
        Readonly<{
          name?: string;
          version?: string;
          dist?: Readonly<{
            shasum?: string;
            integrity?: string;
            attestations?: Readonly<{
              url?: string;
              provenance?: Readonly<{ predicateType?: string }>;
            }>;
          }>;
        }>
      >(`https://registry.npmjs.org/${this.npmPath}/${candidate.version}`),
    ]);
    const packageState: PublicationObservation["package"] =
      packument.kind === "absent"
        ? { kind: "absent" }
        : packument.kind === "unverifiable"
          ? packument
          : { kind: "present" };
    const versionState = asObserved(version, (metadata) => {
      const provenancePredicateType = metadata.dist?.attestations?.provenance?.predicateType;
      const provenanceUrl = metadata.dist?.attestations?.url;
      return {
        name: metadata.name ?? "",
        version: metadata.version ?? "",
        shasum: metadata.dist?.shasum ?? "",
        integrity: metadata.dist?.integrity ?? "",
        latest:
          packument.kind === "available" ? (packument.value["dist-tags"]?.["latest"] ?? "") : "",
        ...(provenanceUrl === undefined ? {} : { provenanceUrl }),
        ...(provenancePredicateType === undefined ? {} : { provenancePredicateType }),
      };
    });
    return { package: packageState, version: versionState };
  }

  private async releaseObservation(
    candidate: FrozenPublication,
  ): Promise<PublicationObservation["release"]> {
    const release = await fetchJson<
      Readonly<{
        tag_name?: string;
        name?: string;
        body?: string;
        draft?: boolean;
        prerelease?: boolean;
        assets?: readonly Readonly<{
          name?: string;
          browser_download_url?: string;
        }>[];
      }>
    >(
      `${this.githubApiUrl}/repos/${this.repository}/releases/tags/${candidate.releaseTag}`,
      this.githubToken,
    );
    if (release.kind !== "available") return release;
    try {
      const assets = await Promise.all(
        (release.value.assets ?? []).map(async (asset) => {
          const name = asset.name ?? fail("GitHub Release asset name is unavailable");
          const url =
            asset.browser_download_url ?? fail(`GitHub Release asset URL is unavailable: ${name}`);
          const response = await fetch(url, {
            headers: { Authorization: `Bearer ${this.githubToken}` },
            signal: AbortSignal.timeout(30_000),
          });
          if (!response.ok) fail(`GitHub Release asset is unavailable: ${name}`);
          const bytes = Buffer.from(await response.arrayBuffer());
          return { name, size: bytes.byteLength, sha256: sha256Bytes(bytes) };
        }),
      );
      return {
        kind: "available",
        value: {
          tag: release.value.tag_name ?? "",
          title: release.value.name ?? "",
          notes: release.value.body ?? "",
          draft: release.value.draft ?? true,
          prerelease: release.value.prerelease ?? true,
          assets,
        },
      };
    } catch (error) {
      return {
        kind: "unverifiable",
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async inspect(): Promise<PublicationObservation> {
    const candidate = this.candidate;
    const [npm, tag, release] = await Promise.all([
      this.npmObservation(candidate),
      fetchJson<Readonly<{ ref?: string; object?: Readonly<{ type?: string; sha?: string }> }>>(
        `${this.githubApiUrl}/repos/${this.repository}/git/ref/tags/${candidate.releaseTag}`,
        this.githubToken,
      ),
      this.releaseObservation(candidate),
    ]);
    return {
      package: npm.package,
      npmVersion: npm.version,
      tag: asObserved(tag, (value) => ({
        tag: value.ref?.replace(/^refs\/tags\//u, "") ?? "",
        targetCommit: value.object?.type === "commit" ? (value.object.sha ?? "") : "",
      })),
      release,
    };
  }

  async publishNpm(candidate: FrozenPublication, authority: "bootstrap" | "trusted") {
    const env = { ...process.env };
    delete env["NPM_BOOTSTRAP_TOKEN"];
    delete env["NODE_AUTH_TOKEN"];
    if (authority === "bootstrap") {
      env["NODE_AUTH_TOKEN"] = this.bootstrapToken ?? fail("bootstrap credential is unavailable");
    }
    run(
      "npm",
      ["publish", candidate.artifactPath, "--access", "public", "--provenance", "--tag", "latest"],
      { env },
    );
    for (let attempt = 1; attempt <= 6; attempt += 1) {
      const observed = await this.npmObservation(candidate);
      if (observed.version.kind === "available") return;
      if (observed.version.kind === "unverifiable") {
        fail(`npm registry postcondition is unverifiable: ${observed.version.reason}`);
      }
      if (attempt < 6) await delay(5_000);
    }
    fail("npm registry did not expose the published version within the bounded retry window");
  }

  async smokeInstalledPackage(candidate: FrozenPublication) {
    const root = await mkdtemp(join(tmpdir(), "bearing-publication-smoke-"));
    try {
      run("npm", ["init", "--yes"], { cwd: root });
      run(
        "npm",
        [
          "install",
          "--ignore-scripts",
          "--no-audit",
          "--no-fund",
          "--save-exact",
          "--registry=https://registry.npmjs.org",
          `${candidate.packageName}@${candidate.version}`,
        ],
        { cwd: root },
      );
      const installed = JSON.parse(
        await readFile(join(root, "node_modules/@lagrangee/bearing/package.json"), "utf8"),
      ) as { name?: string; version?: string };
      if (installed.name !== candidate.packageName || installed.version !== candidate.version) {
        fail("installed package identity does not match the frozen Candidate");
      }
      if (
        run(join(root, "node_modules/.bin/bearing"), ["--version"], { cwd: root }) !==
        candidate.version
      ) {
        fail("installed package CLI version does not match the frozen Candidate");
      }
      run("npm", ["audit", "signatures", "--registry=https://registry.npmjs.org"], { cwd: root });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }

  async createTag(candidate: FrozenPublication) {
    run("gh", [
      "api",
      "--method",
      "POST",
      `repos/${this.repository}/git/refs`,
      "--field",
      `ref=refs/tags/${candidate.releaseTag}`,
      "--field",
      `sha=${candidate.sourceCommit}`,
    ]);
  }

  async createRelease(candidate: FrozenPublication) {
    run("gh", [
      "release",
      "create",
      candidate.releaseTag,
      ...candidate.releaseAssets.map((asset) => asset.path),
      "--repo",
      this.repository,
      "--verify-tag",
      "--title",
      candidate.releaseTitle,
      "--notes-file",
      candidate.releaseNotesPath,
    ]);
  }
}

const loadCandidate = async (
  receiptPath: string,
  expected: Readonly<{
    version: string;
    sourceCommit: string;
    frozenSha256: string;
    workflowRunId: string;
    workflowRunAttempt: number;
  }>,
): Promise<FrozenPublication> => {
  const receipt = await verifyReleaseCandidate(receiptPath, {
    version: expected.version,
    sourceCommit: expected.sourceCommit,
    workflowName: "Prepare candidate artifact",
    workflowRunId: expected.workflowRunId,
    workflowRunAttempt: expected.workflowRunAttempt,
  });
  if (receipt.artifact.sha256 !== expected.frozenSha256) {
    fail("frozen digest does not match the Candidate receipt");
  }
  const root = dirname(receiptPath);
  const artifactPath = join(root, receipt.artifact.file);
  const manifestPath = join(root, receipt.manifest.file);
  const releaseNotesPath = join(root, receipt.releaseNotes.file);
  const releaseNotes = await readFile(releaseNotesPath, "utf8");
  const paths = [artifactPath, receiptPath, manifestPath, releaseNotesPath];
  const releaseAssets = await Promise.all(
    paths.map(async (path) => ({
      path,
      name: basename(path),
      size: (await lstat(path)).size,
      sha256: await sha256File(path),
    })),
  );
  return {
    packageName: receipt.packageName,
    version: receipt.packageVersion,
    sourceCommit: receipt.sourceCommit,
    artifactPath,
    npmShasum: receipt.artifact.npmShasum,
    npmIntegrity: receipt.artifact.npmIntegrity,
    releaseTag: `v${receipt.packageVersion}`,
    releaseTitle: `${receipt.packageName} ${receipt.packageVersion}`,
    releaseNotesPath,
    releaseNotes,
    releaseAssets,
  };
};

const argumentsFromCli = () => {
  const parsed = parseArgs({
    args: process.argv.slice(2),
    strict: true,
    allowPositionals: false,
    tokens: true,
    options: {
      receipt: { type: "string" },
      version: { type: "string" },
      "source-commit": { type: "string" },
      "frozen-sha256": { type: "string" },
      "workflow-run-id": { type: "string" },
      "workflow-run-attempt": { type: "string" },
      "bootstrap-absent-package": { type: "boolean" },
    },
  });
  for (const name of [
    "receipt",
    "version",
    "source-commit",
    "frozen-sha256",
    "workflow-run-id",
    "workflow-run-attempt",
    "bootstrap-absent-package",
  ] as const) {
    if (
      parsed.tokens.filter((token) => token.kind === "option" && token.name === name).length > 1
    ) {
      fail(`--${name} may be provided only once`);
    }
  }
  const receipt = resolve(parsed.values.receipt ?? fail("missing --receipt"));
  const version = parsed.values.version ?? fail("missing --version");
  const sourceCommit = parsed.values["source-commit"] ?? fail("missing --source-commit");
  const frozenSha256 = parsed.values["frozen-sha256"] ?? fail("missing --frozen-sha256");
  const workflowRunId = parsed.values["workflow-run-id"] ?? fail("missing --workflow-run-id");
  const runAttemptText =
    parsed.values["workflow-run-attempt"] ?? fail("missing --workflow-run-attempt");
  assertExactReleaseCommit(sourceCommit, "source commit");
  if (!/^[a-f0-9]{64}$/u.test(frozenSha256)) fail("frozen SHA-256 is invalid");
  if (!/^[1-9][0-9]*$/u.test(workflowRunId)) fail("Candidate run ID is invalid");
  if (!/^[1-9][0-9]*$/u.test(runAttemptText)) fail("Candidate run attempt is invalid");
  const workflowRunAttempt = Number(runAttemptText);
  if (!Number.isSafeInteger(workflowRunAttempt)) fail("Candidate run attempt is invalid");
  return {
    receipt,
    version,
    sourceCommit,
    frozenSha256,
    workflowRunId,
    workflowRunAttempt,
    bootstrapAbsentPackage: parsed.values["bootstrap-absent-package"] === true,
  };
};

const main = async () => {
  const args = argumentsFromCli();
  const repository = process.env["GITHUB_REPOSITORY"] ?? fail("missing GITHUB_REPOSITORY");
  const githubApiUrl = process.env["GITHUB_API_URL"] ?? fail("missing GITHUB_API_URL");
  const githubToken = process.env["GH_TOKEN"] ?? fail("missing GH_TOKEN");
  const bootstrapToken = args.bootstrapAbsentPackage
    ? process.env["NPM_BOOTSTRAP_TOKEN"] || fail("missing NPM_BOOTSTRAP_TOKEN")
    : undefined;
  delete process.env["NPM_BOOTSTRAP_TOKEN"];
  delete process.env["NODE_AUTH_TOKEN"];
  const candidate = await loadCandidate(args.receipt, args);
  const surfaces = new LivePublicationSurfaces(
    candidate,
    repository,
    githubApiUrl,
    githubToken,
    bootstrapToken,
  );
  if (args.bootstrapAbsentPackage) {
    await bootstrapFrozenPackage(candidate, surfaces);
  } else {
    await recoverFrozenPublication(candidate, surfaces);
  }
  process.stdout.write(`${candidate.releaseTag}\n`);
};

await main();
