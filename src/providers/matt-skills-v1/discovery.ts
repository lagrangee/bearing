import type { Dirent } from "node:fs";
import { lstat, opendir } from "node:fs/promises";
import { posix, resolve } from "node:path";
import { z } from "zod";
import { fingerprintInputRecords, normalizeLocator } from "../../fingerprint";
import {
  parseMarkdownDocument,
  queryMarkdownDocumentTitle,
  queryMarkdownField,
  queryMarkdownPreamble,
} from "../../markdown-document";
import {
  createNativeScopeDiscoveryObservation,
  type DiscoveredNativeScope,
  type NativeScopeDiscoveryClassification,
  type NativeScopeDiscoveryObservation,
  type NativeSubjectSummary,
} from "../../native-scope-discovery";
import type { ProviderDiagnostic } from "../../native-work-provider";
import {
  readContainedFile,
  resolveContainedPath,
  resolveRepositoryRoot,
} from "../../path-boundary";
import { MATT_SKILLS_V1_PROVIDER_ID } from "./capture";
import {
  acquireGitHubPages,
  type GitHubIssue,
  type GitHubReadResponse,
  type GitHubReadTransport,
  githubIssueSchema,
  githubRepositorySchema,
  parseTriageVocabulary,
} from "./github";
import { encodeGitHubMattNativeScope } from "./github-native-scope";
import { parseLocalMattContract } from "./local-markdown";

const MAXIMUM_DISCOVERY_FILE_BYTES = 1024 * 1024;
const DEFAULT_LOCAL_DISCOVERY_ENTRY_BUDGET = 20_000;
const DEFAULT_LOCAL_DISCOVERY_FILE_BUDGET = 10_000;
const DEFAULT_LOCAL_DISCOVERY_BYTE_BUDGET = 64 * 1024 * 1024;
const DEFAULT_GITHUB_DISCOVERY_REQUEST_BUDGET = 20_000;
const WAYFINDER_TYPES = new Set(["research", "prototype", "grilling", "task"]);

const diagnostic = (
  code: string,
  diagnosticClass: ProviderDiagnostic["class"],
  target: string,
  message: string,
  impact: ProviderDiagnostic["impact"] = "blocking",
): ProviderDiagnostic => ({
  code,
  class: diagnosticClass,
  impact,
  target,
  message,
});

const utf8Compare = (left: string, right: string): number =>
  Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));

type LocalInput = Readonly<{
  locator: string;
  bytes: Buffer;
  source: string;
  document: ReturnType<typeof parseMarkdownDocument>;
}>;

class LocalDiscoveryBudgetError extends Error {
  readonly name = "LocalDiscoveryBudgetError";
}

type LocalDiscoveryBudget = {
  readonly maximumEntries: number;
  readonly maximumFiles: number;
  readonly maximumBytes: number;
  entries: number;
  files: number;
  bytes: number;
};

const readDirectoryEntries = async (
  directory: string,
  budget: LocalDiscoveryBudget,
): Promise<Dirent[]> => {
  const entries: Dirent[] = [];
  const handle = await opendir(directory);
  for await (const entry of handle) {
    budget.entries += 1;
    if (budget.entries > budget.maximumEntries) {
      throw new LocalDiscoveryBudgetError("Local discovery exceeded its directory-entry budget.");
    }
    entries.push(entry);
  }
  return entries;
};

const readLocalInput = async (
  root: string,
  locator: string,
  maximumFileBytes: number,
  budget: LocalDiscoveryBudget,
): Promise<LocalInput> => {
  if (budget.files >= budget.maximumFiles || budget.bytes >= budget.maximumBytes) {
    throw new LocalDiscoveryBudgetError("Local discovery exceeded its file-read budget.");
  }
  const normalized = normalizeLocator(locator);
  const target = await resolveContainedPath(root, resolve(root, normalized));
  const metadata = await lstat(target);
  const remainingBytes = budget.maximumBytes - budget.bytes;
  const boundedBytes = Math.min(maximumFileBytes, remainingBytes);
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.nlink !== 1 ||
    metadata.size > boundedBytes
  ) {
    if (metadata.isFile() && metadata.size > boundedBytes) {
      throw new LocalDiscoveryBudgetError("Local discovery exceeded its bounded byte budget.");
    }
    throw new Error("Discovery input is not a bounded regular file.");
  }
  const bytes = await readContainedFile(root, target, { maximumBytes: boundedBytes });
  budget.files += 1;
  budget.bytes += bytes.length;
  const source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  return {
    locator: normalized,
    bytes,
    source,
    document: parseMarkdownDocument(source),
  };
};

const localSubjectIdentity = (locator: string): string => `local:${locator}`;

const localLifecycle = (
  status: string | undefined,
  nativeToSemantic: ReadonlyMap<string, string>,
): NativeSubjectSummary["lifecycle"] => {
  if (status === undefined) return "unknown";
  const semantic = nativeToSemantic.get(status) ?? status;
  return ["resolved", "wontfix", "closed"].includes(semantic) ? "closed" : "open";
};

const localSummary = (
  input: LocalInput,
  rootLocator: string,
  nativeToSemantic: ReadonlyMap<string, string>,
): Readonly<{ summary: NativeSubjectSummary; partial: boolean }> => {
  const title = queryMarkdownDocumentTitle(input.document);
  const preamble = queryMarkdownPreamble(input.document);
  const field = (label: string): string | undefined =>
    preamble.state !== "found"
      ? undefined
      : queryMarkdownField(input.document, { label, within: preamble.value }).state === "found"
        ? (
            queryMarkdownField(input.document, { label, within: preamble.value }) as Readonly<{
              state: "found";
              value: Readonly<{ value: string }>;
            }>
          ).value.value
        : undefined;
  const type = field("Type");
  const status = field("Status");
  const whatToBuild = field("What to build");
  const filename = posix.basename(input.locator);
  const classification: NativeScopeDiscoveryClassification =
    filename === "map.md"
      ? "map"
      : filename === "PRD.md" || filename === "spec.md"
        ? "spec"
        : type !== undefined && WAYFINDER_TYPES.has(type)
          ? "wayfinder"
          : whatToBuild !== undefined
            ? "delivery"
            : status !== undefined
              ? "incoming"
              : "unknown";
  const discoveredTitle =
    title.state === "found" && title.value.title.trim().length > 0
      ? title.value.title.trim()
      : posix.basename(input.locator, ".md");
  return {
    summary: {
      identity: localSubjectIdentity(input.locator),
      locator: input.locator,
      title: discoveredTitle,
      classification,
      lifecycle: localLifecycle(status, nativeToSemantic),
      parentIdentity: null,
      admission: [
        input.locator === `${rootLocator}/map.md`
          ? "contract-map"
          : input.locator === `${rootLocator}/PRD.md` || input.locator === `${rootLocator}/spec.md`
            ? "contract-spec"
            : "contract-direct-issue",
      ],
    },
    partial:
      title.state !== "found" ||
      (filename !== "map.md" &&
        filename !== "PRD.md" &&
        filename !== "spec.md" &&
        classification === "unknown"),
  };
};

const aggregateLifecycle = (
  subjects: readonly NativeSubjectSummary[],
): DiscoveredNativeScope["lifecycle"] => {
  const values = new Set(subjects.map((subject) => subject.lifecycle));
  if (values.size === 1) return subjects[0]?.lifecycle ?? "unknown";
  if (values.has("unknown")) return "unknown";
  return "mixed";
};

const localScopeTitle = (rootLocator: string, summaries: readonly NativeSubjectSummary[]): string =>
  summaries.find((summary) => summary.classification === "map")?.title ??
  summaries.find((summary) => summary.classification === "spec")?.title ??
  summaries[0]?.title ??
  posix.basename(rootLocator);

export const discoverLocalMattScopes = async (
  options: Readonly<{
    repoRoot: string;
    contractLocator: string;
    triageLocator?: string;
    maximumFileBytes?: number;
    maximumEntries?: number;
    maximumFiles?: number;
    maximumTotalBytes?: number;
    clock?: () => Date;
  }>,
): Promise<NativeScopeDiscoveryObservation> => {
  const observedAt = (options.clock ?? (() => new Date()))().toISOString();
  const maximumFileBytes = options.maximumFileBytes ?? MAXIMUM_DISCOVERY_FILE_BYTES;
  const budget: LocalDiscoveryBudget = {
    maximumEntries: Math.max(
      1,
      Math.floor(options.maximumEntries ?? DEFAULT_LOCAL_DISCOVERY_ENTRY_BUDGET),
    ),
    maximumFiles: Math.max(
      1,
      Math.floor(options.maximumFiles ?? DEFAULT_LOCAL_DISCOVERY_FILE_BUDGET),
    ),
    maximumBytes: Math.max(
      1,
      Math.floor(options.maximumTotalBytes ?? DEFAULT_LOCAL_DISCOVERY_BYTE_BUDGET),
    ),
    entries: 0,
    files: 0,
    bytes: 0,
  };
  const diagnostics: ProviderDiagnostic[] = [];
  let root: string;
  try {
    root = await resolveRepositoryRoot(options.repoRoot);
  } catch {
    return createNativeScopeDiscoveryObservation({
      provider: MATT_SKILLS_V1_PROVIDER_ID,
      state: "unavailable",
      observedAt,
      freshness: "undetermined",
      coverage: "incomplete",
      scopes: [],
      diagnostics: [
        diagnostic(
          "matt.local.discovery.repository-unavailable",
          "source",
          options.repoRoot,
          "The repository root could not be resolved for discovery.",
        ),
      ],
    });
  }

  let contract: LocalInput;
  try {
    contract = await readLocalInput(root, options.contractLocator, maximumFileBytes, budget);
  } catch {
    return createNativeScopeDiscoveryObservation({
      provider: MATT_SKILLS_V1_PROVIDER_ID,
      state: "unavailable",
      observedAt,
      freshness: "undetermined",
      coverage: "incomplete",
      scopes: [],
      diagnostics: [
        diagnostic(
          "matt.local.discovery.contract-unavailable",
          "contract",
          options.contractLocator,
          "The confirmed Local tracker contract could not be read safely.",
        ),
      ],
    });
  }
  const layout = parseLocalMattContract(contract, diagnostics);
  if (layout === undefined) {
    return createNativeScopeDiscoveryObservation({
      provider: MATT_SKILLS_V1_PROVIDER_ID,
      state: "unsupported",
      observedAt,
      freshness: "undetermined",
      coverage: "incomplete",
      scopes: [],
      diagnostics,
    });
  }
  const triageLocator =
    options.triageLocator ??
    normalizeLocator(posix.join(posix.dirname(options.contractLocator), "triage-labels.md"));
  let triage: LocalInput;
  try {
    triage = await readLocalInput(root, triageLocator, maximumFileBytes, budget);
  } catch {
    return createNativeScopeDiscoveryObservation({
      provider: MATT_SKILLS_V1_PROVIDER_ID,
      state: "unavailable",
      observedAt,
      freshness: "undetermined",
      coverage: "incomplete",
      scopes: [],
      diagnostics: [
        diagnostic(
          "matt.local.discovery.triage-unavailable",
          "mapping",
          triageLocator,
          "The confirmed Local triage vocabulary could not be read safely.",
        ),
      ],
    });
  }
  const vocabulary = parseTriageVocabulary(
    triage.source,
    triage.locator,
    diagnostics,
    "matt.local",
  );
  if (vocabulary === undefined || !vocabulary.complete) {
    return createNativeScopeDiscoveryObservation({
      provider: MATT_SKILLS_V1_PROVIDER_ID,
      state: "invalid",
      observedAt,
      freshness: "undetermined",
      coverage: "incomplete",
      scopes: [],
      diagnostics,
    });
  }

  let entries: Dirent[];
  try {
    const scratchRoot = await resolveContainedPath(root, resolve(root, ".scratch"));
    const scratchMetadata = await lstat(scratchRoot);
    if (!scratchMetadata.isDirectory() || scratchMetadata.isSymbolicLink()) {
      throw new Error("Local discovery root is not a safe directory.");
    }
    entries = await readDirectoryEntries(scratchRoot, budget);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return createNativeScopeDiscoveryObservation({
        provider: MATT_SKILLS_V1_PROVIDER_ID,
        state: "available",
        observedAt,
        freshness: "current",
        coverage: "complete",
        scopes: [],
        diagnostics: [],
        sourceRevision: fingerprintInputRecords([
          { locator: contract.locator, bytes: contract.bytes },
        ]).fingerprint,
      });
    }
    return createNativeScopeDiscoveryObservation({
      provider: MATT_SKILLS_V1_PROVIDER_ID,
      state: "unavailable",
      observedAt,
      freshness: "undetermined",
      coverage: "incomplete",
      scopes: [],
      diagnostics: [
        diagnostic(
          "matt.local.discovery.enumeration-unavailable",
          "source",
          ".scratch",
          error instanceof LocalDiscoveryBudgetError
            ? "Direct Local feature-root enumeration exceeded its bounded read budget."
            : "Direct Local feature roots could not be enumerated safely.",
        ),
      ],
    });
  }

  const captured: LocalInput[] = [contract, triage];
  const scopes: DiscoveredNativeScope[] = [];
  let complete = true;
  featureRoots: for (const entry of [...entries].sort((left, right) =>
    utf8Compare(left.name, right.name),
  )) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    const rootLocator = normalizeLocator(posix.join(".scratch", entry.name));
    const candidates: string[] = [];
    for (const filename of ["map.md", layout.specFilename]) {
      try {
        const target = await resolveContainedPath(root, resolve(root, rootLocator, filename));
        const metadata = await lstat(target);
        if (metadata.isFile() && !metadata.isSymbolicLink() && metadata.nlink === 1) {
          candidates.push(posix.join(rootLocator, filename));
        }
      } catch {
        // Absence is not an admitted candidate.
      }
    }
    const issueDirectory = resolve(root, rootLocator, "issues");
    try {
      const containedIssueDirectory = await resolveContainedPath(root, issueDirectory);
      const issueMetadata = await lstat(containedIssueDirectory);
      if (issueMetadata.isDirectory() && !issueMetadata.isSymbolicLink()) {
        const issueEntries = await readDirectoryEntries(containedIssueDirectory, budget);
        for (const issueEntry of issueEntries.sort((left, right) =>
          utf8Compare(left.name, right.name),
        )) {
          if (
            issueEntry.isFile() &&
            !issueEntry.isSymbolicLink() &&
            /^[0-9]{2}-.+\.md$/u.test(issueEntry.name)
          ) {
            candidates.push(posix.join(rootLocator, "issues", issueEntry.name));
          }
        }
      }
    } catch (error) {
      if (error instanceof LocalDiscoveryBudgetError) {
        complete = false;
        diagnostics.push(
          diagnostic(
            "matt.local.discovery.resource-budget",
            "acquisition",
            rootLocator,
            "Local discovery stopped at its operation-wide structural read budget.",
          ),
        );
        break;
      }
      // A scope does not require an issues directory.
    }
    if (candidates.length === 0) continue;

    const summaries: NativeSubjectSummary[] = [];
    let scopePartial = false;
    for (const locator of candidates) {
      try {
        const input = await readLocalInput(root, locator, maximumFileBytes, budget);
        captured.push(input);
        const decoded = localSummary(input, rootLocator, vocabulary.nativeToSemantic);
        summaries.push(decoded.summary);
        scopePartial ||= decoded.partial;
      } catch (error) {
        scopePartial = true;
        if (error instanceof LocalDiscoveryBudgetError) {
          complete = false;
          diagnostics.push(
            diagnostic(
              "matt.local.discovery.resource-budget",
              "acquisition",
              locator,
              "Local discovery stopped at its operation-wide structural read budget.",
            ),
          );
          break featureRoots;
        }
        diagnostics.push(
          diagnostic(
            "matt.local.discovery.summary-unavailable",
            "source",
            locator,
            "A direct scope artifact could not be read as a bounded UTF-8 Markdown summary.",
          ),
        );
      }
    }
    if (summaries.length === 0) {
      complete = false;
      continue;
    }
    if (scopePartial) {
      complete = false;
      diagnostics.push(
        diagnostic(
          "matt.local.discovery.summary-partial",
          "format",
          rootLocator,
          "The scope identity is trustworthy, but one or more summary roles are unavailable.",
        ),
      );
    }
    const ordered = summaries.sort((left, right) => utf8Compare(left.locator, right.locator));
    const map = ordered.find((summary) => summary.classification === "map");
    scopes.push({
      identity: `local-scope:${rootLocator}`,
      binding: { provider: MATT_SKILLS_V1_PROVIDER_ID, nativeScope: rootLocator },
      locator: rootLocator,
      driver: "local",
      rootRole: map === undefined ? "parent-scope" : "wayfinder-map",
      title: localScopeTitle(rootLocator, ordered),
      lifecycle: aggregateLifecycle(ordered),
      classification: map?.classification ?? ordered[0]?.classification ?? "unknown",
      admission: [
        map !== undefined
          ? "contract-map"
          : ordered.some((summary) => summary.classification === "spec")
            ? "contract-spec"
            : "contract-direct-issue",
      ],
      subjects: ordered,
    });
  }

  const sourceRevision = fingerprintInputRecords(
    captured.map((input) => ({ locator: input.locator, bytes: input.bytes })),
  ).fingerprint;
  return createNativeScopeDiscoveryObservation({
    provider: MATT_SKILLS_V1_PROVIDER_ID,
    state: complete ? "available" : "partial",
    observedAt,
    freshness: "current",
    coverage: complete ? "complete" : "incomplete",
    scopes: scopes.sort((left, right) => utf8Compare(left.locator, right.locator)),
    diagnostics,
    sourceRevision,
    coverageDimensions: [
      { key: "contract", state: "covered" },
      {
        key: "direct-root-enumeration",
        state: complete ? "covered" : "gap",
      },
      { key: "recursive-content", state: "excluded" },
    ],
  });
};

type GitHubDiscoveryOptions = Readonly<{
  repository: string;
  transport: GitHubReadTransport;
  mappedTriageLabels: readonly string[];
  pullRequests: "enabled" | "disabled";
  maximumRequests?: number;
  clock?: () => Date;
}>;

class GitHubDiscoveryRequestBudgetError extends Error {
  readonly name = "GitHubDiscoveryRequestBudgetError";
}

const githubRepositoryCoordinateSchema = z
  .string()
  .regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?\/[A-Za-z0-9_.-]+$/u);

const githubResponseDiagnostic = (
  response: GitHubReadResponse,
  endpoint: string,
): ProviderDiagnostic =>
  diagnostic(
    response.status === 403
      ? "matt.github.discovery.permission"
      : response.status === 429
        ? "matt.github.discovery.rate-limit"
        : "matt.github.discovery.acquisition",
    response.status === 403 ? "permission" : "acquisition",
    endpoint,
    `GitHub discovery read returned HTTP ${response.status}.`,
  );

const get = async (transport: GitHubReadTransport, endpoint: string): Promise<GitHubReadResponse> =>
  transport.get({ endpoint, apiVersion: "2026-03-10" });

const githubReadFailureDiagnostic = (error: unknown, target: string): ProviderDiagnostic =>
  error instanceof GitHubDiscoveryRequestBudgetError
    ? diagnostic(
        "matt.github.discovery.request-budget",
        "acquisition",
        target,
        "GitHub discovery stopped at its operation-wide read budget.",
      )
    : diagnostic(
        "matt.github.discovery.network",
        "network",
        target,
        "A network failure prevented the required GitHub discovery read.",
      );

const githubSubjectIdentity = (repositoryNodeId: string, issue: GitHubIssue): string =>
  `github:${repositoryNodeId}:${issue.node_id}`;

const githubClassification = (
  issue: GitHubIssue,
  mappedTriageLabels: ReadonlySet<string>,
): NativeScopeDiscoveryClassification => {
  const labels = new Set(issue.labels.map((label) => label.name));
  if (labels.has("wayfinder:map")) return "map";
  if (issue.pull_request !== undefined) return "request";
  if ([...labels].some((label) => label.startsWith("wayfinder:"))) return "wayfinder";
  if ([...labels].some((label) => mappedTriageLabels.has(label))) return "incoming";
  return "unknown";
};

const githubSummary = (
  repositoryNodeId: string,
  issue: GitHubIssue,
  parentIdentity: string | null,
  mappedTriageLabels: ReadonlySet<string>,
): NativeSubjectSummary => ({
  identity: githubSubjectIdentity(repositoryNodeId, issue),
  locator: issue.html_url,
  title: issue.title.trim().length === 0 ? `#${issue.number}` : issue.title,
  classification: githubClassification(issue, mappedTriageLabels),
  lifecycle: issue.state,
  parentIdentity,
  admission: issue.labels
    .map((label) => label.name)
    .filter((label) => label.startsWith("wayfinder:") || mappedTriageLabels.has(label))
    .map((label) => `label:${label}`),
});

const externalPullRequest = (issue: GitHubIssue): boolean =>
  issue.pull_request !== undefined &&
  ["CONTRIBUTOR", "FIRST_TIME_CONTRIBUTOR", "NONE"].includes(issue.author_association);

export const discoverGitHubMattScopes = async (
  options: GitHubDiscoveryOptions,
): Promise<NativeScopeDiscoveryObservation> => {
  const observedAt = (options.clock ?? (() => new Date()))().toISOString();
  const maximumRequests =
    options.maximumRequests === undefined
      ? DEFAULT_GITHUB_DISCOVERY_REQUEST_BUDGET
      : Math.max(1, Math.floor(options.maximumRequests));
  let requestCount = 0;
  const transport: GitHubReadTransport = {
    async get(request) {
      if (requestCount >= maximumRequests) throw new GitHubDiscoveryRequestBudgetError();
      requestCount += 1;
      return options.transport.get(request);
    },
  };
  const coordinate = githubRepositoryCoordinateSchema.safeParse(options.repository);
  if (!coordinate.success) {
    return createNativeScopeDiscoveryObservation({
      provider: MATT_SKILLS_V1_PROVIDER_ID,
      state: "invalid",
      observedAt,
      freshness: "undetermined",
      coverage: "incomplete",
      scopes: [],
      diagnostics: [
        diagnostic(
          "matt.github.discovery.repository-invalid",
          "identity",
          options.repository,
          "The confirmed GitHub repository coordinate is invalid.",
        ),
      ],
    });
  }
  const repositoryEndpoint = `repos/${coordinate.data}`;
  let repositoryResponse: GitHubReadResponse;
  try {
    repositoryResponse = await get(transport, repositoryEndpoint);
  } catch (error) {
    const failure = githubReadFailureDiagnostic(error, repositoryEndpoint);
    return createNativeScopeDiscoveryObservation({
      provider: MATT_SKILLS_V1_PROVIDER_ID,
      state: "unavailable",
      observedAt,
      freshness: "undetermined",
      coverage: "incomplete",
      scopes: [],
      diagnostics: [failure],
    });
  }
  const repository = githubRepositorySchema.safeParse(repositoryResponse.body);
  if (repositoryResponse.status !== 200 || !repository.success) {
    return createNativeScopeDiscoveryObservation({
      provider: MATT_SKILLS_V1_PROVIDER_ID,
      state: repositoryResponse.status === 403 ? "unavailable" : "invalid",
      observedAt,
      freshness: "undetermined",
      coverage: "incomplete",
      scopes: [],
      diagnostics: [githubResponseDiagnostic(repositoryResponse, repositoryEndpoint)],
    });
  }
  const expectedFullName = coordinate.data.toLowerCase();
  if (repository.data.full_name.toLowerCase() !== expectedFullName) {
    return createNativeScopeDiscoveryObservation({
      provider: MATT_SKILLS_V1_PROVIDER_ID,
      state: "invalid",
      observedAt,
      freshness: "undetermined",
      coverage: "incomplete",
      scopes: [],
      diagnostics: [
        diagnostic(
          "matt.github.discovery.identity-mismatch",
          "identity",
          repository.data.html_url,
          "GitHub repository identity does not match the confirmed repository.",
        ),
      ],
    });
  }

  let enumeration: Awaited<ReturnType<typeof acquireGitHubPages>> | undefined;
  try {
    enumeration = await acquireGitHubPages(transport, `${repositoryEndpoint}/issues?state=all`);
  } catch (error) {
    const failure = githubReadFailureDiagnostic(error, repositoryEndpoint);
    return createNativeScopeDiscoveryObservation({
      provider: MATT_SKILLS_V1_PROVIDER_ID,
      state: "unavailable",
      observedAt,
      freshness: "undetermined",
      coverage: "incomplete",
      scopes: [],
      diagnostics: [failure],
    });
  }
  const issueDecode = z.array(githubIssueSchema).safeParse(enumeration.values);
  if (!issueDecode.success || (enumeration.state === "failed" && enumeration.values.length === 0)) {
    return createNativeScopeDiscoveryObservation({
      provider: MATT_SKILLS_V1_PROVIDER_ID,
      state: enumeration.values.length === 0 ? "unavailable" : "invalid",
      observedAt,
      freshness: "undetermined",
      coverage: "incomplete",
      scopes: [],
      diagnostics: [
        enumeration.state === "failed"
          ? githubResponseDiagnostic(enumeration.response, enumeration.endpoint)
          : diagnostic(
              "matt.github.discovery.enumeration-invalid",
              "format",
              repositoryEndpoint,
              "GitHub issue enumeration could not be decoded.",
            ),
      ],
    });
  }

  const mappedLabels = new Set(options.mappedTriageLabels);
  const allIssues = new Map(issueDecode.data.map((issue) => [issue.node_id, issue]));
  const diagnostics: ProviderDiagnostic[] =
    enumeration.state === "failed"
      ? [githubResponseDiagnostic(enumeration.response, enumeration.endpoint)]
      : [];
  let complete = enumeration.state === "available";
  const admitted = issueDecode.data.filter((issue) => {
    if (issue.pull_request !== undefined) {
      return options.pullRequests === "enabled" && externalPullRequest(issue);
    }
    return issue.labels.some(
      (label) => label.name.startsWith("wayfinder:") || mappedLabels.has(label.name),
    );
  });
  const parents = new Map<string, GitHubIssue | null | undefined>();
  const readParent = async (issue: GitHubIssue): Promise<GitHubIssue | null | undefined> => {
    if (parents.has(issue.node_id)) return parents.get(issue.node_id);
    const endpoint = `${repositoryEndpoint}/issues/${issue.number}/parent`;
    let response: GitHubReadResponse;
    try {
      response = await get(transport, endpoint);
    } catch (error) {
      complete = false;
      diagnostics.push(githubReadFailureDiagnostic(error, endpoint));
      parents.set(issue.node_id, undefined);
      return undefined;
    }
    if (response.status === 404) {
      parents.set(issue.node_id, null);
      return null;
    }
    if (response.status !== 200) {
      complete = false;
      diagnostics.push(githubResponseDiagnostic(response, endpoint));
      parents.set(issue.node_id, undefined);
      return undefined;
    }
    const parent = githubIssueSchema.safeParse(response.body);
    const knownParent = parent.success ? allIssues.get(parent.data.node_id) : undefined;
    if (
      knownParent === undefined ||
      knownParent.repository_url !== `https://api.github.com/${repositoryEndpoint}`
    ) {
      complete = false;
      diagnostics.push(
        diagnostic(
          "matt.github.discovery.parent-invalid",
          "identity",
          endpoint,
          "A native parent is outside the complete confirmed repository enumeration.",
        ),
      );
      parents.set(issue.node_id, undefined);
      return undefined;
    }
    parents.set(issue.node_id, knownParent);
    return knownParent;
  };
  const roots = new Map<string, GitHubIssue>();
  for (const candidate of admitted) {
    let current: GitHubIssue | null = candidate;
    const lineage = new Set<string>();
    while (current !== null) {
      if (lineage.has(current.node_id)) {
        complete = false;
        diagnostics.push(
          diagnostic(
            "matt.github.discovery.parent-cycle",
            "identity",
            candidate.html_url,
            "Canonical parent hierarchy contains a cycle.",
          ),
        );
        current = null;
        break;
      }
      lineage.add(current.node_id);
      const parent = await readParent(current);
      if (parent === undefined) break;
      if (parent === null) {
        roots.set(current.node_id, current);
        current = null;
        break;
      }
      current = parent;
    }
  }
  const scopes: DiscoveredNativeScope[] = [];
  const claimed = new Set<string>();
  const validators = enumeration.validators.map((value) => ({
    kind: "github-etag",
    value,
  }));
  for (const rootIssue of [...roots.values()].sort((left, right) => left.number - right.number)) {
    if (claimed.has(rootIssue.node_id)) continue;
    if (
      rootIssue.pull_request !== undefined &&
      !admitted.some((candidate) => candidate.node_id === rootIssue.node_id)
    ) {
      complete = false;
      diagnostics.push(
        diagnostic(
          "matt.github.discovery.pull-request-root-not-admitted",
          "contract",
          rootIssue.html_url,
          "A pull request root did not satisfy the confirmed external request admission contract.",
        ),
      );
      continue;
    }
    if (
      rootIssue.pull_request !== undefined &&
      rootIssue.labels.some((label) => label.name === "wayfinder:map")
    ) {
      complete = false;
      diagnostics.push(
        diagnostic(
          "matt.github.discovery.root-kind-conflict",
          "identity",
          rootIssue.html_url,
          "A discovered root cannot be both a Wayfinder Map and an external pull request.",
        ),
      );
      continue;
    }

    const pending: Array<Readonly<{ issue: GitHubIssue; parent: GitHubIssue | null }>> = [
      { issue: rootIssue, parent: null },
    ];
    const scopeIssues = new Map<
      string,
      Readonly<{ issue: GitHubIssue; parent: GitHubIssue | null }>
    >();
    let scopeComplete = true;
    for (let cursor = 0; cursor < pending.length; cursor += 1) {
      const entry = pending[cursor];
      if (entry === undefined || scopeIssues.has(entry.issue.node_id)) continue;
      scopeIssues.set(entry.issue.node_id, entry);
      const childEndpoint = `${repositoryEndpoint}/issues/${entry.issue.number}/sub_issues`;
      let children: Awaited<ReturnType<typeof acquireGitHubPages>>;
      try {
        children = await acquireGitHubPages(transport, childEndpoint);
      } catch (error) {
        scopeComplete = false;
        diagnostics.push(githubReadFailureDiagnostic(error, childEndpoint));
        continue;
      }
      const decodedChildren = z.array(githubIssueSchema).safeParse(children.values);
      if (children.state === "failed" || !decodedChildren.success) {
        scopeComplete = false;
        diagnostics.push(
          children.state === "failed"
            ? githubResponseDiagnostic(children.response, children.endpoint)
            : diagnostic(
                "matt.github.discovery.hierarchy-invalid",
                "format",
                childEndpoint,
                "GitHub native children could not be decoded.",
              ),
        );
        continue;
      }
      for (const child of decodedChildren.data) {
        const known = allIssues.get(child.node_id);
        if (
          known === undefined ||
          child.repository_url !== `https://api.github.com/${repositoryEndpoint}`
        ) {
          scopeComplete = false;
          diagnostics.push(
            diagnostic(
              "matt.github.discovery.child-identity",
              "identity",
              child.html_url,
              "A native child is outside the complete confirmed repository enumeration.",
            ),
          );
          continue;
        }
        const canonicalParent = await readParent(known);
        if (
          !parents.has(known.node_id) ||
          canonicalParent === undefined ||
          canonicalParent === null ||
          canonicalParent.node_id !== entry.issue.node_id
        ) {
          scopeComplete = false;
          diagnostics.push(
            diagnostic(
              "matt.github.discovery.hierarchy-conflict",
              "identity",
              known.html_url,
              "Native parent and child hierarchy reads disagree.",
            ),
          );
          continue;
        }
        if (claimed.has(known.node_id) && !scopeIssues.has(known.node_id)) {
          scopeComplete = false;
          diagnostics.push(
            diagnostic(
              "matt.github.discovery.cross-scope-subject",
              "identity",
              known.html_url,
              "A native subject appears in more than one discovered scope.",
            ),
          );
          continue;
        }
        const existing =
          scopeIssues.get(known.node_id) ??
          pending.find((candidate) => candidate.issue.node_id === known.node_id);
        if (existing !== undefined && existing.parent?.node_id !== entry.issue.node_id) {
          scopeComplete = false;
          diagnostics.push(
            diagnostic(
              "matt.github.discovery.multiple-parents",
              "identity",
              known.html_url,
              "A native subject appears under multiple parents.",
            ),
          );
          continue;
        }
        pending.push({ issue: known, parent: entry.issue });
      }
    }
    if (scopeIssues.size === 0) continue;
    complete &&= scopeComplete;
    for (const nodeId of scopeIssues.keys()) claimed.add(nodeId);
    const rootKind =
      rootIssue.pull_request !== undefined
        ? ("standalone-request" as const)
        : rootIssue.labels.some((label) => label.name === "wayfinder:map")
          ? ("wayfinder-map" as const)
          : scopeIssues.size > 1
            ? ("parent-issue" as const)
            : ("standalone-request" as const);
    const binding = encodeGitHubMattNativeScope({
      host: "github.com",
      rootKind,
      repository: {
        owner: repository.data.owner.login,
        name: repository.data.name,
        databaseId: repository.data.id,
        nodeId: repository.data.node_id,
      },
      root: {
        objectKind: rootIssue.pull_request === undefined ? "issue" : "pull-request",
        number: rootIssue.number,
        databaseId: rootIssue.id,
        nodeId: rootIssue.node_id,
      },
    });
    const subjects = [...scopeIssues.values()]
      .map((entry) =>
        githubSummary(
          repository.data.node_id,
          entry.issue,
          entry.parent === null
            ? null
            : githubSubjectIdentity(repository.data.node_id, entry.parent),
          mappedLabels,
        ),
      )
      .sort((left, right) => {
        if (left.parentIdentity === null && right.parentIdentity !== null) return -1;
        if (left.parentIdentity !== null && right.parentIdentity === null) return 1;
        return utf8Compare(left.identity, right.identity);
      });
    scopes.push({
      identity: `github:${repository.data.node_id}:${rootIssue.node_id}`,
      binding: { provider: MATT_SKILLS_V1_PROVIDER_ID, nativeScope: binding },
      locator: rootIssue.html_url,
      driver: "github",
      rootRole:
        rootKind === "wayfinder-map"
          ? "wayfinder-map"
          : rootKind === "standalone-request"
            ? "standalone-request"
            : "parent-scope",
      title: rootIssue.title,
      lifecycle: aggregateLifecycle(subjects),
      classification: githubClassification(rootIssue, mappedLabels),
      admission: [...new Set(subjects.flatMap((subject) => subject.admission))].sort(
        (left, right) => utf8Compare(left, right),
      ),
      subjects,
    });
  }
  for (const [childNodeId, parent] of parents) {
    if (
      parent !== null &&
      parent !== undefined &&
      claimed.has(parent.node_id) &&
      !claimed.has(childNodeId)
    ) {
      complete = false;
      diagnostics.push(
        diagnostic(
          "matt.github.discovery.hierarchy-incomplete",
          "pagination",
          allIssues.get(childNodeId)?.html_url ?? childNodeId,
          "A canonical child is missing from its discovered parent hierarchy.",
        ),
      );
    }
  }

  const sourceRevision = fingerprintInputRecords(
    issueDecode.data.map((issue) => ({
      locator: `github/${repository.data.full_name}/issues/${issue.number}`,
      bytes: Buffer.from(
        JSON.stringify({
          id: issue.id,
          nodeId: issue.node_id,
          number: issue.number,
          state: issue.state,
          title: issue.title,
          labels: issue.labels.map((label) => label.name),
          updatedAt: issue.updated_at,
        }),
        "utf8",
      ),
    })),
  ).fingerprint;
  return createNativeScopeDiscoveryObservation({
    provider: MATT_SKILLS_V1_PROVIDER_ID,
    state: complete ? "available" : "partial",
    observedAt,
    sourceRevision,
    validators,
    freshness: complete ? "current" : "undetermined",
    coverage: complete ? "complete" : "incomplete",
    coverageDimensions: [
      { key: "repository-identity", state: "covered" },
      { key: "open-and-closed-enumeration", state: "covered" },
      { key: "native-hierarchy", state: complete ? "covered" : "gap" },
      { key: "non-native-expansion", state: "excluded" },
    ],
    scopes: scopes.sort((left, right) => utf8Compare(left.identity, right.identity)),
    diagnostics,
  });
};
