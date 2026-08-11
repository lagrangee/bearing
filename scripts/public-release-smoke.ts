import { lstat, readFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { fromMarkdown } from "mdast-util-from-markdown";
import { toString as markdownToString } from "mdast-util-to-string";
import sanitizeHtml from "sanitize-html";
import { visit } from "unist-util-visit";
import {
  classifyFrozenPublication,
  type FrozenPublication,
  type Observed,
  type PublicationObservation,
} from "./publication-recovery";
import { sha256File, verifyReleaseCandidate } from "./release-candidate-lib";
import { assertExactReleaseCommit } from "./release-identity";

export type PublicObserved<T> = Observed<T>;

export type PublicReleaseAsset = Readonly<{ name: string; size: number; sha256: string }>;

export type PublicReleaseCandidate = Readonly<{
  packageName: string;
  packageVersion: string;
  sourceCommit: string;
  workflow: Readonly<{ name: string; runId: string; runAttempt: number }>;
  artifact: Readonly<{ sha256: string; npmShasum: string; npmIntegrity: string }>;
  releaseTag: string;
  releaseTitle: string;
  releaseNotes: string;
  releaseAssets: readonly PublicReleaseAsset[];
}>;

export const publicEntryNames = Object.freeze([
  "readme",
  "agentInstallation",
  "demo",
  "bugReport",
  "documentationReport",
  "questions",
  "ideas",
  "vulnerabilityReport",
] as const);

export type PublicEntryName = (typeof publicEntryNames)[number];

export const publicEntryRoutes = (
  candidate: Pick<PublicReleaseCandidate, "sourceCommit">,
): Readonly<Record<PublicEntryName, string>> =>
  Object.freeze({
    readme: "https://github.com/lagrangee/bearing",
    agentInstallation: `https://raw.githubusercontent.com/lagrangee/bearing/${candidate.sourceCommit}/docs/agent-installation.md`,
    demo: "https://lagrangee.github.io/bearing/",
    bugReport: "https://github.com/lagrangee/bearing/issues/new?template=bug_report.yml",
    documentationReport:
      "https://github.com/lagrangee/bearing/issues/new?template=documentation.yml",
    questions: "https://github.com/lagrangee/bearing/discussions/categories/q-a",
    ideas: "https://github.com/lagrangee/bearing/discussions/categories/ideas",
    vulnerabilityReport: "https://github.com/lagrangee/bearing/security/advisories/new",
  });

const exactReadmeRoute = (candidate: Pick<PublicReleaseCandidate, "sourceCommit">): string =>
  `https://raw.githubusercontent.com/lagrangee/bearing/${candidate.sourceCommit}/README.md`;

const linkedAgentInstallationRoute = (markdown: string, readmeUrl: string): string => {
  const links: string[] = [];
  visit(fromMarkdown(markdown), "link", (node) => {
    if (markdownToString(node).trim().toLowerCase() === "agent installation guide") {
      links.push(node.url);
    }
  });
  if (links.length !== 1) fail("public README Agent installation link is not unique");
  return new URL(links[0] ?? "", readmeUrl).href;
};

const loadsDemoDisclosure = (html: string): boolean => {
  let matches = 0;
  sanitizeHtml(html, {
    allowedTags: [],
    allowedAttributes: {},
    transformTags: {
      script: (tagName, attributes) => {
        if (attributes["src"] === "./mock-data.js" && attributes["type"] === "module") {
          matches += 1;
        }
        return { tagName, attribs: attributes };
      },
    },
  });
  return matches === 1;
};

export type PublicReleaseObservation = Readonly<{
  npm: PublicObserved<
    Readonly<{
      name: string;
      version: string;
      shasum: string;
      integrity: string;
      provenanceUrl?: string;
      provenancePredicateType?: string;
      provenance: Readonly<{
        subjectName: string;
        subjectSha512: string;
        sourceCommit: string;
        workflowRepository: string;
        workflowPath: string;
        invocationId: string;
        invocationSourceCommit: string;
        invocationWorkflowPath: string;
        invocationRunAttempt: number;
        invocationConclusion: string;
      }>;
    }>
  >;
  tag: PublicObserved<Readonly<{ tag: string; targetCommit: string }>>;
  release: PublicObserved<
    Readonly<{
      tag: string;
      title: string;
      notes: string;
      draft: boolean;
      prerelease: boolean;
      assets: readonly PublicReleaseAsset[];
    }>
  >;
  pages: PublicObserved<Readonly<{ status: string; sourceCommit: string }>>;
  entries: Readonly<
    Record<PublicEntryName, PublicObserved<Readonly<{ finalUrl: string; body: string }>>>
  >;
}>;

export interface PublicReleaseSurfaces {
  inspect(candidate: PublicReleaseCandidate): Promise<PublicReleaseObservation>;
}

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

const observedMap = <Input, Output>(
  observed: PublicObserved<Input>,
  map: (value: Input) => Output,
): PublicObserved<Output> =>
  observed.kind === "available" ? { kind: "available", value: map(observed.value) } : observed;

export class LivePublicReleaseSurfaces implements PublicReleaseSurfaces {
  private readonly fetch: FetchLike;
  private readonly githubToken: string | undefined;

  constructor(options: Readonly<{ fetch?: FetchLike; githubToken?: string }> = {}) {
    this.fetch = options.fetch ?? globalThis.fetch;
    this.githubToken = options.githubToken;
  }

  private async fetchJson<T>(url: string, github = false): Promise<PublicObserved<T>> {
    try {
      const headers = new Headers({ Accept: "application/vnd.github+json" });
      if (github) {
        headers.set("X-GitHub-Api-Version", "2022-11-28");
        if (this.githubToken !== undefined)
          headers.set("Authorization", `Bearer ${this.githubToken}`);
      }
      const response = await this.fetch(url, {
        headers,
        signal: AbortSignal.timeout(15_000),
      });
      if (response.status === 404) return { kind: "absent" };
      if (!response.ok) return { kind: "unverifiable", reason: `HTTP ${response.status}` };
      return { kind: "available", value: (await response.json()) as T };
    } catch (error) {
      return {
        kind: "unverifiable",
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async fetchText(
    url: string,
  ): Promise<PublicObserved<{ finalUrl: string; body: string }>> {
    try {
      const response = await this.fetch(url, { signal: AbortSignal.timeout(15_000) });
      if (response.status === 404) return { kind: "absent" };
      if (!response.ok) return { kind: "unverifiable", reason: `HTTP ${response.status}` };
      return { kind: "available", value: { finalUrl: response.url, body: await response.text() } };
    } catch (error) {
      return {
        kind: "unverifiable",
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async observeRelease(
    candidate: PublicReleaseCandidate,
  ): Promise<PublicReleaseObservation["release"]> {
    const observed = await this.fetchJson<{
      tag_name?: string;
      name?: string;
      body?: string;
      draft?: boolean;
      prerelease?: boolean;
      assets?: readonly { name?: string; size?: number; digest?: string | null }[];
    }>(
      `https://api.github.com/repos/lagrangee/bearing/releases/tags/${encodeURIComponent(candidate.releaseTag)}`,
      true,
    );
    if (observed.kind !== "available") return observed;
    try {
      const assets = (observed.value.assets ?? []).map((asset) => {
        const digest =
          asset.digest ??
          fail(`GitHub Release asset digest is unavailable: ${asset.name ?? "unknown"}`);
        if (!digest.startsWith("sha256:")) {
          fail(`GitHub Release asset digest is not SHA-256: ${asset.name ?? "unknown"}`);
        }
        return {
          name: asset.name ?? fail("GitHub Release asset name is unavailable"),
          size:
            asset.size ??
            fail(`GitHub Release asset size is unavailable: ${asset.name ?? "unknown"}`),
          sha256: digest.slice("sha256:".length),
        };
      });
      return {
        kind: "available",
        value: {
          tag: observed.value.tag_name ?? "",
          title: observed.value.name ?? "",
          notes: observed.value.body ?? "",
          draft: observed.value.draft ?? true,
          prerelease: observed.value.prerelease ?? true,
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

  private async observeNpm(
    candidate: PublicReleaseCandidate,
  ): Promise<PublicReleaseObservation["npm"]> {
    const packagePath = candidate.packageName.replace("/", "%2f");
    const metadata = await this.fetchJson<{
      name?: string;
      version?: string;
      dist?: {
        shasum?: string;
        integrity?: string;
        attestations?: {
          url?: string;
          provenance?: { predicateType?: string };
        };
      };
    }>(`https://registry.npmjs.org/${packagePath}/${candidate.packageVersion}`);
    if (metadata.kind !== "available") return metadata;
    const attestationUrl = metadata.value.dist?.attestations?.url;
    if (attestationUrl === undefined) {
      return { kind: "unverifiable", reason: "npm provenance attestation URL is unavailable" };
    }
    const expectedAttestationUrl = `https://registry.npmjs.org/-/npm/v1/attestations/${packagePath}@${candidate.packageVersion}`;
    if (attestationUrl !== expectedAttestationUrl) {
      return {
        kind: "available",
        value: {
          name: metadata.value.name ?? "",
          version: metadata.value.version ?? "",
          shasum: metadata.value.dist?.shasum ?? "",
          integrity: metadata.value.dist?.integrity ?? "",
          provenanceUrl: attestationUrl,
          ...(metadata.value.dist?.attestations?.provenance?.predicateType === undefined
            ? {}
            : {
                provenancePredicateType: metadata.value.dist.attestations.provenance.predicateType,
              }),
          provenance: {
            subjectName: "",
            subjectSha512: "",
            sourceCommit: "",
            workflowRepository: "",
            workflowPath: "",
            invocationId: "",
            invocationSourceCommit: "",
            invocationWorkflowPath: "",
            invocationRunAttempt: 0,
            invocationConclusion: "",
          },
        },
      };
    }
    const attestations = await this.fetchJson<{
      attestations?: readonly {
        predicateType?: string;
        bundle?: { dsseEnvelope?: { payload?: string } };
      }[];
    }>(attestationUrl);
    if (attestations.kind !== "available") return attestations;
    try {
      const matches = (attestations.value.attestations ?? []).filter(
        (attestation) => attestation.predicateType === "https://slsa.dev/provenance/v1",
      );
      if (matches.length !== 1) fail("npm SLSA provenance attestation is not unique");
      const match = matches[0] ?? fail("npm SLSA provenance attestation is unavailable");
      const payload =
        match.bundle?.dsseEnvelope?.payload ?? fail("npm SLSA provenance payload is unavailable");
      const statement = JSON.parse(Buffer.from(payload, "base64").toString("utf8")) as {
        subject?: readonly { name?: string; digest?: { sha512?: string } }[];
        predicate?: {
          buildDefinition?: {
            externalParameters?: {
              workflow?: { repository?: string; path?: string };
            };
            resolvedDependencies?: readonly { digest?: { gitCommit?: string } }[];
          };
          runDetails?: { metadata?: { invocationId?: string } };
        };
      };
      const subjects = statement.subject ?? [];
      if (subjects.length !== 1) fail("npm SLSA provenance subject is not unique");
      const subject = subjects[0] ?? fail("npm SLSA provenance subject is unavailable");
      const commits = (statement.predicate?.buildDefinition?.resolvedDependencies ?? [])
        .map((dependency) => dependency.digest?.gitCommit)
        .filter((commit): commit is string => commit !== undefined);
      if (commits.length !== 1) fail("npm SLSA provenance source commit is not unique");
      const sourceCommit = commits[0] ?? fail("npm SLSA provenance source commit is unavailable");
      const invocationId = statement.predicate?.runDetails?.metadata?.invocationId ?? "";
      const invocation =
        /^https:\/\/github\.com\/lagrangee\/bearing\/actions\/runs\/([1-9][0-9]*)\/attempts\/([1-9][0-9]*)$/u.exec(
          invocationId,
        ) ?? fail("npm SLSA provenance invocation is invalid");
      const invocationRunId = invocation[1] ?? fail("npm SLSA provenance run ID is unavailable");
      const actionRun = await this.fetchJson<{
        head_sha?: string;
        path?: string;
        run_attempt?: number;
        conclusion?: string | null;
      }>(`https://api.github.com/repos/lagrangee/bearing/actions/runs/${invocationRunId}`, true);
      if (actionRun.kind !== "available") return actionRun;
      return {
        kind: "available",
        value: {
          name: metadata.value.name ?? "",
          version: metadata.value.version ?? "",
          shasum: metadata.value.dist?.shasum ?? "",
          integrity: metadata.value.dist?.integrity ?? "",
          ...(attestationUrl === undefined ? {} : { provenanceUrl: attestationUrl }),
          ...(metadata.value.dist?.attestations?.provenance?.predicateType === undefined
            ? {}
            : {
                provenancePredicateType: metadata.value.dist.attestations.provenance.predicateType,
              }),
          provenance: {
            subjectName: subject.name ?? "",
            subjectSha512: subject.digest?.sha512 ?? "",
            sourceCommit,
            workflowRepository:
              statement.predicate?.buildDefinition?.externalParameters?.workflow?.repository ?? "",
            workflowPath:
              statement.predicate?.buildDefinition?.externalParameters?.workflow?.path ?? "",
            invocationId,
            invocationSourceCommit: actionRun.value.head_sha ?? "",
            invocationWorkflowPath: actionRun.value.path ?? "",
            invocationRunAttempt: actionRun.value.run_attempt ?? 0,
            invocationConclusion: actionRun.value.conclusion ?? "",
          },
        },
      };
    } catch (error) {
      return {
        kind: "unverifiable",
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async observeEntries(
    candidate: PublicReleaseCandidate,
  ): Promise<PublicReleaseObservation["entries"]> {
    const routes = publicEntryRoutes(candidate);
    const exactReadmeUrl = exactReadmeRoute(candidate);
    const [readmePage, readmeSource, demoPage, ...ordinary] = await Promise.all([
      this.fetchText(routes.readme),
      this.fetchText(exactReadmeUrl),
      this.fetchText(routes.demo),
      ...publicEntryNames
        .filter((name) => !["readme", "agentInstallation", "demo"].includes(name))
        .map(async (name) => [name, await this.fetchText(routes[name])] as const),
    ]);
    const entries = Object.fromEntries(ordinary) as Partial<
      Record<PublicEntryName, PublicObserved<Readonly<{ finalUrl: string; body: string }>>>
    >;
    if (readmePage.kind !== "available") {
      entries.readme = readmePage;
      entries.agentInstallation = readmePage;
    } else if (readmeSource.kind !== "available") {
      entries.readme = readmeSource;
      entries.agentInstallation = readmeSource;
    } else {
      entries.readme = {
        kind: "available",
        value: { finalUrl: readmePage.value.finalUrl, body: readmeSource.value.body },
      };
      try {
        entries.agentInstallation = await this.fetchText(
          linkedAgentInstallationRoute(readmeSource.value.body, exactReadmeUrl),
        );
      } catch (error) {
        entries.agentInstallation = {
          kind: "unverifiable",
          reason: error instanceof Error ? error.message : String(error),
        };
      }
    }
    if (demoPage.kind !== "available") {
      entries.demo = demoPage;
    } else if (!loadsDemoDisclosure(demoPage.value.body)) {
      entries.demo = {
        kind: "unverifiable",
        reason: "static demo disclosure script is not loaded",
      };
    } else {
      const disclosure = await this.fetchText(`${routes.demo}mock-data.js`);
      entries.demo =
        disclosure.kind === "available"
          ? {
              kind: "available",
              value: {
                finalUrl: demoPage.value.finalUrl,
                body: `${demoPage.value.body}\n${disclosure.value.body}`,
              },
            }
          : disclosure;
    }
    return entries as PublicReleaseObservation["entries"];
  }

  async inspect(candidate: PublicReleaseCandidate): Promise<PublicReleaseObservation> {
    const [npm, tag, release, pages, entries] = await Promise.all([
      this.observeNpm(candidate),
      this.fetchJson<{ ref?: string; object?: { type?: string; sha?: string } }>(
        `https://api.github.com/repos/lagrangee/bearing/git/ref/tags/${encodeURIComponent(candidate.releaseTag)}`,
        true,
      ),
      this.observeRelease(candidate),
      this.fetchJson<{ status?: string; commit?: string }>(
        "https://api.github.com/repos/lagrangee/bearing/pages/builds/latest",
        true,
      ),
      this.observeEntries(candidate),
    ]);
    return Object.freeze({
      npm,
      tag: observedMap(tag, (value) => ({
        tag: value.ref?.replace(/^refs\/tags\//u, "") ?? "",
        targetCommit: value.object?.type === "commit" ? (value.object.sha ?? "") : "",
      })),
      release,
      pages: observedMap(pages, (value) => ({
        status: value.status ?? "",
        sourceCommit: value.commit ?? "",
      })),
      entries,
    });
  }
}

export type PublicReleaseSmokeOptions = Readonly<{
  candidateReceipt: string;
  version: string;
  sourceCommit: string;
  workflowName: string;
  workflowRunId: string;
  workflowRunAttempt: number;
  frozenSha256: string;
}>;

const fail = (message: string): never => {
  throw new Error(message);
};

export const parsePublicReleaseSmokeArgs = (args: readonly string[]): PublicReleaseSmokeOptions => {
  const parsed = parseArgs({
    args: [...args],
    strict: true,
    allowPositionals: false,
    tokens: true,
    options: {
      "candidate-receipt": { type: "string" },
      version: { type: "string" },
      "source-commit": { type: "string" },
      "workflow-name": { type: "string" },
      "workflow-run-id": { type: "string" },
      "workflow-run-attempt": { type: "string" },
      "frozen-sha256": { type: "string" },
    },
  });
  for (const name of Object.keys(parsed.values)) {
    if (
      parsed.tokens.filter((token) => token.kind === "option" && token.name === name).length !== 1
    ) {
      fail(`--${name} may be provided only once`);
    }
  }
  const required = (name: keyof typeof parsed.values): string =>
    parsed.values[name] ?? fail(`missing --${name}`);
  const candidateReceipt = resolve(required("candidate-receipt"));
  const version = required("version");
  const sourceCommit = required("source-commit");
  const workflowName = required("workflow-name");
  const workflowRunId = required("workflow-run-id");
  const workflowRunAttemptText = required("workflow-run-attempt");
  const frozenSha256 = required("frozen-sha256");
  assertExactReleaseCommit(sourceCommit, "source commit");
  if (!/^[1-9][0-9]*$/u.test(workflowRunId)) fail("Candidate workflow run ID is invalid");
  if (!/^[1-9][0-9]*$/u.test(workflowRunAttemptText)) {
    fail("Candidate workflow run attempt is invalid");
  }
  const workflowRunAttempt = Number(workflowRunAttemptText);
  if (!Number.isSafeInteger(workflowRunAttempt)) fail("Candidate workflow run attempt is invalid");
  if (!/^[a-f0-9]{64}$/u.test(frozenSha256)) fail("frozen SHA-256 is invalid");
  return Object.freeze({
    candidateReceipt,
    version,
    sourceCommit,
    workflowName,
    workflowRunId,
    workflowRunAttempt,
    frozenSha256,
  });
};

export const loadPublicReleaseCandidate = async (
  options: PublicReleaseSmokeOptions,
): Promise<PublicReleaseCandidate> => {
  const receipt = await verifyReleaseCandidate(options.candidateReceipt, {
    version: options.version,
    sourceCommit: options.sourceCommit,
    workflowName: options.workflowName,
    workflowRunId: options.workflowRunId,
    workflowRunAttempt: options.workflowRunAttempt,
  });
  if (receipt.artifact.sha256 !== options.frozenSha256) {
    fail("frozen digest does not match the Candidate Receipt");
  }
  const root = dirname(options.candidateReceipt);
  const artifactPath = join(root, receipt.artifact.file);
  const manifestPath = join(root, receipt.manifest.file);
  const notesPath = join(root, receipt.releaseNotes.file);
  const releaseNotes = await readFile(notesPath, "utf8");
  const releaseAssets = await Promise.all(
    [artifactPath, options.candidateReceipt, manifestPath, notesPath].map(async (path) => ({
      name: basename(path),
      size: (await lstat(path)).size,
      sha256: await sha256File(path),
    })),
  );
  return Object.freeze({
    packageName: receipt.packageName,
    packageVersion: receipt.packageVersion,
    sourceCommit: receipt.sourceCommit,
    workflow: receipt.workflow,
    artifact: Object.freeze({
      sha256: receipt.artifact.sha256,
      npmShasum: receipt.artifact.npmShasum,
      npmIntegrity: receipt.artifact.npmIntegrity,
    }),
    releaseTag: `v${receipt.packageVersion}`,
    releaseTitle: `${receipt.packageName} ${receipt.packageVersion}`,
    releaseNotes,
    releaseAssets: Object.freeze(releaseAssets),
  });
};

type CheckState = "exact" | "absent" | "conflicting" | "unverifiable" | "wrong-route";

const observedState = <T>(
  observed: PublicObserved<T>,
  exact: (value: T) => boolean,
): Exclude<CheckState, "wrong-route"> =>
  observed.kind === "available" ? (exact(observed.value) ? "exact" : "conflicting") : observed.kind;

const publicationCandidate = (candidate: PublicReleaseCandidate): FrozenPublication => ({
  packageName: candidate.packageName,
  version: candidate.packageVersion,
  sourceCommit: candidate.sourceCommit,
  artifactPath: "",
  npmShasum: candidate.artifact.npmShasum,
  npmIntegrity: candidate.artifact.npmIntegrity,
  releaseTag: candidate.releaseTag,
  releaseTitle: candidate.releaseTitle,
  releaseNotesPath: "",
  releaseNotes: candidate.releaseNotes,
  releaseAssets: candidate.releaseAssets.map((asset) => ({ ...asset, path: "" })),
});

const publicationObservation = (
  candidate: PublicReleaseCandidate,
  observation: PublicReleaseObservation,
): PublicationObservation => ({
  package: { kind: "present" },
  npmVersion: observedMap(observation.npm, (value) => ({
    ...value,
    latest: candidate.packageVersion,
  })),
  tag: observation.tag,
  release: observation.release,
});

const provenanceMatchesCandidate = (
  candidate: PublicReleaseCandidate,
  observation: PublicReleaseObservation["npm"],
): boolean => {
  if (observation.kind !== "available") return false;
  const integrityPrefix = "sha512-";
  if (!candidate.artifact.npmIntegrity.startsWith(integrityPrefix)) return false;
  const subjectSha512 = Buffer.from(
    candidate.artifact.npmIntegrity.slice(integrityPrefix.length),
    "base64",
  ).toString("hex");
  const expectedSubject = `pkg:npm/${candidate.packageName.replace("@", "%40")}@${candidate.packageVersion}`;
  const provenance = observation.value.provenance;
  return (
    provenance.subjectName === expectedSubject &&
    provenance.subjectSha512 === subjectSha512 &&
    provenance.sourceCommit === candidate.sourceCommit &&
    provenance.workflowRepository === "https://github.com/lagrangee/bearing" &&
    provenance.workflowPath === ".github/workflows/publish.yml" &&
    provenance.invocationSourceCommit === candidate.sourceCommit &&
    provenance.invocationWorkflowPath === ".github/workflows/publish.yml" &&
    provenance.invocationRunAttempt > 0 &&
    provenance.invocationConclusion === "success" &&
    /^https:\/\/github\.com\/lagrangee\/bearing\/actions\/runs\/[1-9][0-9]*\/attempts\/[1-9][0-9]*$/u.test(
      provenance.invocationId,
    ) &&
    provenance.invocationId.endsWith(`/attempts/${provenance.invocationRunAttempt}`)
  );
};

const routeMatches = (actual: string, expected: string): boolean => {
  try {
    const actualUrl = new URL(actual);
    const expectedUrl = new URL(expected);
    if (actualUrl.origin === expectedUrl.origin && actualUrl.pathname === expectedUrl.pathname) {
      return [...expectedUrl.searchParams].every(
        ([name, value]) => actualUrl.searchParams.get(name) === value,
      );
    }
    if (actualUrl.origin !== "https://github.com" || actualUrl.pathname !== "/login") return false;
    const returnTo = actualUrl.searchParams.get("return_to") ?? "";
    return returnTo.includes(expectedUrl.pathname) && returnTo.includes(expectedUrl.search);
  } catch {
    return false;
  }
};

const contentMatches = (name: PublicEntryName, body: string): boolean => {
  const lower = body.toLowerCase();
  const normalized = lower.replace(/\s+/gu, " ");
  switch (name) {
    case "readme":
      return (
        lower.includes("agent installation guide") &&
        normalized.includes(
          "demo is a static sample, not a hosted bearing project, real repository, canonical planning surface, or proof of product value",
        ) &&
        lower.includes("private vulnerability reporting") &&
        lower.includes("discussions/categories/q-a") &&
        lower.includes("discussions/categories/ideas")
      );
    case "agentInstallation":
      return (
        lower.includes("released package") &&
        lower.includes("skill directory") &&
        lower.includes("repository setup")
      );
    case "demo":
      return (
        lower.includes("fixed-data static sample") &&
        lower.includes("not a hosted bearing project") &&
        lower.includes("does not pass a gate") &&
        lower.includes("suspected vulnerabilities stay private") &&
        lower.includes("best-effort") &&
        !normalized.includes("this is a real repository") &&
        !normalized.includes("is proof of product value") &&
        !normalized.includes("passes the gate")
      );
    default:
      return body.trim().length > 0;
  }
};

const entryState = (
  observed: PublicObserved<Readonly<{ finalUrl: string; body: string }>>,
  expectedUrl: string,
  name: PublicEntryName,
): CheckState => {
  if (observed.kind !== "available") return observed.kind;
  if (!routeMatches(observed.value.finalUrl, expectedUrl)) return "wrong-route";
  return contentMatches(name, observed.value.body) ? "exact" : "conflicting";
};

export const readPublicRelease = async (
  candidate: PublicReleaseCandidate,
  surfaces: PublicReleaseSurfaces,
) => {
  const observation = await surfaces.inspect(candidate);
  const publication = classifyFrozenPublication(
    publicationCandidate(candidate),
    publicationObservation(candidate, observation),
    { requireLatest: false },
  );
  const npm =
    publication.npmVersion === "exact" && !provenanceMatchesCandidate(candidate, observation.npm)
      ? "conflicting"
      : publication.npmVersion;
  const tag = publication.tag;
  const release = publication.release;
  const pages = observedState(
    observation.pages,
    (value) => value.status === "built" && value.sourceCommit === candidate.sourceCommit,
  );
  const routes = publicEntryRoutes(candidate);
  const entryChecks = Object.fromEntries(
    publicEntryNames.map((name) => [
      name,
      entryState(observation.entries[name], routes[name], name),
    ]),
  ) as Record<PublicEntryName, CheckState>;
  const firstIncompleteEntry = publicEntryNames.find((name) => entryChecks[name] !== "exact");
  const userEntry =
    firstIncompleteEntry === undefined ? "exact" : entryChecks[firstIncompleteEntry];

  const ordered = [
    ["npm", npm],
    ["tag", tag],
    ["release", release],
    ["pages", pages],
    ["user-entry", userEntry],
  ] as const;
  const exactPrefix: string[] = [];
  for (const [name, state] of ordered) {
    if (state !== "exact") break;
    exactPrefix.push(name);
  }
  const publicPrefix = exactPrefix.length === 0 ? "none" : exactPrefix.join("+");
  const firstIncomplete = ordered[exactPrefix.length];

  return Object.freeze({
    outcome: firstIncomplete === undefined ? ("passed" as const) : ("incomplete" as const),
    candidate: Object.freeze({
      packageName: candidate.packageName,
      packageVersion: candidate.packageVersion,
      sourceCommit: candidate.sourceCommit,
      workflow: candidate.workflow,
      frozenSha256: candidate.artifact.sha256,
    }),
    publicPrefix,
    checks: Object.freeze({ npm, tag, release, pages, userEntry }),
    resumptionPoint:
      firstIncomplete === undefined
        ? null
        : firstIncomplete[0] === "user-entry" && firstIncompleteEntry !== undefined
          ? `user-entry:${firstIncompleteEntry}`
          : firstIncomplete[0],
    authority: Object.freeze({
      publicationSuccess: false,
      effortConclusion: false,
      gatePassage: false,
      staticDemoDoesNotEstablish: Object.freeze([
        "hosted-product",
        "real-repository",
        "gate-proof",
      ] as const),
    }),
  });
};

export const publicReleaseSmokeUsage = `Usage:
  bun run release:public-smoke -- --candidate-receipt <absolute-path> \\
    --version <exact-version> --source-commit <exact-commit> \\
    --workflow-name <candidate-workflow-name> --workflow-run-id <run-id> \\
    --workflow-run-attempt <run-attempt> --frozen-sha256 <tarball-sha256>
`;

if (import.meta.main) {
  if (process.argv.slice(2).includes("--help")) {
    process.stdout.write(publicReleaseSmokeUsage);
  } else {
    try {
      const options = parsePublicReleaseSmokeArgs(process.argv.slice(2));
      const candidate = await loadPublicReleaseCandidate(options);
      const surfaces = new LivePublicReleaseSurfaces({
        ...(process.env["GITHUB_TOKEN"] === undefined
          ? {}
          : { githubToken: process.env["GITHUB_TOKEN"] }),
      });
      const result = await readPublicRelease(candidate, surfaces);
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      if (result.outcome !== "passed") process.exitCode = 1;
    } catch (error) {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    }
  }
}
