import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { posix, resolve } from "node:path";
import stableStringify from "safe-stable-stringify";
import { z } from "zod";
import { normalizeLocator } from "../../fingerprint";
import {
  type MarkdownDocument,
  type MarkdownSection,
  markdownNarrative,
  parseMarkdownDocument,
  queryMarkdownField,
  queryMarkdownLinks,
  queryMarkdownList,
  queryMarkdownLists,
  queryMarkdownSection,
  queryMarkdownTable,
} from "../../markdown-document";
import { affectedReadReferences } from "../../native-reconciliation-contract";
import {
  type CapturedProviderDocuments,
  createProviderScopeObservation,
  type NativeWorkReconciliationInput,
  type ProviderDiagnostic,
  type ProviderFreshnessEvidence,
} from "../../native-work-provider";
import {
  readContainedFile,
  resolveContainedPath,
  resolveRepositoryRoot,
} from "../../path-boundary";
import { projectExpectedNativeSourceEventTime } from "../../source-event-time";
import { validateMattSkillsV1Contract } from "../matt-skills-v1";
import {
  MATT_SKILLS_V1_PROVIDER_ID,
  type MattSkillsV1Provider,
  type MattSkillsV1ProviderObservation,
} from "./capture";
import { parseGitHubCliIncludedResponse } from "./github-cli-response";
import { decodeGitHubMattNativeScope } from "./github-native-scope";

export {
  decodeGitHubMattNativeScope,
  encodeGitHubMattNativeScope,
  type GitHubMattNativeScope,
} from "./github-native-scope";

import type {
  MattAuthoredContent,
  MattBlockedByRelation,
  MattContent,
  MattDeliveryTicket,
  MattIncomingIssue,
  MattMap,
  MattNativeEvidence,
  MattObjectReference,
  MattParentChildRelation,
  MattRawFacet,
  MattScopeProjection,
  MattSourceAnchor,
  MattSpec,
  MattTrackerClosure,
  MattWayfinderTicket,
} from "./model";
import {
  MATT_SPEC_SECTION_DEFINITIONS,
  semanticAvailabilityForItems,
  semanticSection,
} from "./semantic-sections";
import { projectMattSpecDocument } from "./spec-document";

export const GITHUB_API_VERSION = "2026-03-10" as const;
const PAGE_SIZE = 100;
const REQUIRED_TRIAGE_ROLES = [
  "needs-triage",
  "needs-info",
  "ready-for-agent",
  "ready-for-human",
  "wontfix",
] as const;
const WAYFINDER_SUBTYPES = ["research", "prototype", "grilling", "task"] as const;
type TriageSemanticRole = (typeof REQUIRED_TRIAGE_ROLES)[number] | "bug" | "enhancement";

export type TriageVocabulary = Readonly<{
  semanticToNative: ReadonlyMap<TriageSemanticRole, string>;
  nativeToSemantic: ReadonlyMap<string, TriageSemanticRole>;
  complete: boolean;
}>;

export type GitHubReadRequest = Readonly<{
  endpoint: string;
  apiVersion: typeof GITHUB_API_VERSION;
  validator?: string;
}>;

export type GitHubReadResponse = Readonly<{
  status: number;
  headers: Readonly<Record<string, string>>;
  body?: unknown;
}>;

export type GitHubReadFailureKind =
  | "authentication"
  | "permission"
  | "rate-limit"
  | "network"
  | "timeout"
  | "acquisition";

export class GitHubReadError extends Error {
  readonly kind: GitHubReadFailureKind;

  constructor(kind: GitHubReadFailureKind, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "GitHubReadError";
    this.kind = kind;
  }
}

export interface GitHubReadTransport {
  get(request: GitHubReadRequest): Promise<GitHubReadResponse>;
}

export type GitHubCommandResult = Readonly<{
  exitCode: number;
  stdout: string;
  stderr: string;
}>;

export type GitHubCommandExecutor = (
  command: string,
  args: readonly string[],
) => Promise<GitHubCommandResult>;

export type GitHubMattProviderOptions = Readonly<{
  repoRoot: string;
  contractLocator: string;
  triageLocator?: string;
  capturedDocuments?: CapturedProviderDocuments;
  transport?: GitHubReadTransport;
  clock?: () => Date;
}>;

type ResolvedGitHubMattProviderOptions = GitHubMattProviderOptions &
  Readonly<{ transport: GitHubReadTransport }>;

const executeGitHubCommand: GitHubCommandExecutor = (command, args) =>
  new Promise((resolveCommand, rejectCommand) => {
    execFile(
      command,
      [...args],
      {
        encoding: "utf8",
        maxBuffer: 16 * 1024 * 1024,
        timeout: 60_000,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (error !== null && typeof error.code !== "number") {
          rejectCommand(
            new GitHubReadError(
              error.killed ? "timeout" : "acquisition",
              error.killed ? "GitHub CLI read timed out." : "GitHub CLI could not be started.",
              { cause: error },
            ),
          );
          return;
        }
        resolveCommand({
          exitCode: error === null ? 0 : typeof error.code === "number" ? error.code : 1,
          stdout,
          stderr,
        });
      },
    );
  });

const failureKindForCommand = (stderr: string): GitHubReadFailureKind => {
  const normalized = stderr.toLowerCase();
  if (
    normalized.includes("rate limit") ||
    normalized.includes("secondary rate") ||
    normalized.includes("http 429")
  ) {
    return "rate-limit";
  }
  if (
    normalized.includes("authentication") ||
    normalized.includes("bad credentials") ||
    normalized.includes("auth login") ||
    normalized.includes("http 401")
  ) {
    return "authentication";
  }
  if (
    normalized.includes("resource not accessible") ||
    normalized.includes("forbidden") ||
    normalized.includes("http 403")
  ) {
    return "permission";
  }
  if (normalized.includes("timeout") || normalized.includes("timed out")) return "timeout";
  if (
    normalized.includes("network") ||
    normalized.includes("connection") ||
    normalized.includes("resolve") ||
    normalized.includes("dns") ||
    normalized.includes("tls") ||
    normalized.includes("socket") ||
    /\bhttp 5[0-9]{2}\b/u.test(normalized)
  ) {
    return "network";
  }
  return "acquisition";
};

const commandFailureMessage = (kind: GitHubReadFailureKind): string => {
  const messages: Readonly<Record<GitHubReadFailureKind, string>> = {
    authentication: "GitHub CLI authentication failed.",
    permission: "GitHub CLI permission denied this read.",
    "rate-limit": "GitHub API rate limiting prevented this read.",
    network: "GitHub CLI could not complete the network read.",
    timeout: "GitHub CLI read timed out.",
    acquisition: "GitHub CLI could not complete this read.",
  };
  return messages[kind];
};

export const createGhCliGitHubReadTransport = (
  options: Readonly<{ execute?: GitHubCommandExecutor }> = {},
): GitHubReadTransport => {
  const execute = options.execute ?? executeGitHubCommand;
  return {
    async get(request) {
      const endpointPath = request.endpoint.split("?", 1)[0] ?? "";
      const endpointSegments = endpointPath.split("/");
      if (
        !/^repos\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_./?=&-]+)?$/u.test(
          request.endpoint,
        ) ||
        endpointSegments.some((segment) => segment === "." || segment === "..")
      ) {
        throw new GitHubReadError(
          "acquisition",
          "GitHub REST endpoint is outside the read-only repository boundary.",
        );
      }
      const args = [
        "api",
        "--method",
        "GET",
        "--hostname",
        "github.com",
        "--include",
        "--header",
        "Accept: application/vnd.github+json",
        "--header",
        `X-GitHub-Api-Version: ${request.apiVersion}`,
        ...(request.validator === undefined
          ? []
          : ["--header", `If-None-Match: ${request.validator}`]),
        request.endpoint,
      ];
      const result = await execute("gh", args);
      let included: GitHubReadResponse | undefined;
      try {
        included = parseGitHubCliIncludedResponse(result.stdout);
      } catch (error) {
        throw new GitHubReadError("acquisition", "GitHub CLI returned a non-JSON response body.", {
          cause: error,
        });
      }
      if (included !== undefined) return included;
      const statusMatch = /\bHTTP\s+([1-5][0-9]{2})\b/u.exec(result.stderr);
      const status = statusMatch?.[1] === undefined ? undefined : Number(statusMatch[1]);
      if (status === 404 || status === 410) return { status, headers: {} };
      const kind = failureKindForCommand(result.stderr);
      throw new GitHubReadError(kind, commandFailureMessage(kind));
    },
  };
};

export const githubRepositorySchema = z.object({
  id: z.union([z.number(), z.string()]).transform(String),
  node_id: z.string().min(1),
  name: z.string().min(1),
  full_name: z.string().min(1),
  html_url: z.string().url(),
  owner: z.object({
    login: z.string().min(1),
    id: z.union([z.number(), z.string()]).transform(String),
    node_id: z.string().min(1),
  }),
});

const labelSchema = z.union([
  z.string().transform((name) => ({ name, id: undefined, nodeId: undefined })),
  z
    .object({
      name: z.string(),
      id: z.union([z.number(), z.string()]).optional(),
      node_id: z.string().optional(),
    })
    .transform((label) => ({
      name: label.name,
      ...(label.id === undefined ? {} : { id: String(label.id) }),
      ...(label.node_id === undefined ? {} : { nodeId: label.node_id }),
    })),
]);

const accountSchema = z.object({
  login: z.string().min(1),
  id: z.union([z.number(), z.string()]).transform(String),
  node_id: z.string().min(1),
});

export const githubIssueSchema = z.object({
  id: z.union([z.number(), z.string()]).transform(String),
  node_id: z.string().min(1),
  number: z.number().int().positive(),
  html_url: z.string().url(),
  repository_url: z.string().url(),
  title: z.string(),
  body: z
    .string()
    .nullable()
    .transform((value) => value ?? ""),
  state: z.enum(["open", "closed"]),
  state_reason: z.string().nullable().optional(),
  created_at: z.string(),
  updated_at: z.string(),
  closed_at: z.string().nullable().optional(),
  closed_by: accountSchema.nullable().optional(),
  labels: z.array(labelSchema),
  assignees: z.array(accountSchema),
  milestone: z
    .object({
      id: z.union([z.number(), z.string()]).transform(String),
      node_id: z.string().min(1),
      number: z.number().int(),
      title: z.string(),
    })
    .nullable()
    .optional(),
  user: accountSchema,
  author_association: z.string(),
  pull_request: z.object({ url: z.string().url() }).optional(),
});

const commentSchema = z.object({
  id: z.union([z.number(), z.string()]).transform(String),
  node_id: z.string().min(1),
  html_url: z.string().url(),
  body: z.string(),
  user: accountSchema,
  created_at: z.string(),
  updated_at: z.string(),
  author_association: z.string(),
});

export type GitHubIssue = z.infer<typeof githubIssueSchema>;
export type GitHubRepository = z.infer<typeof githubRepositorySchema>;
type GitHubComment = z.infer<typeof commentSchema>;

type AcquiredIssue = Readonly<{
  issue: GitHubIssue;
  document: MarkdownDocument;
  comments: readonly GitHubComment[];
  commentsCapability: "available" | "unsupported" | "failed";
  dependencies: readonly GitHubIssue[];
  dependencyCapability: "available" | "unsupported" | "failed";
  parentCapability: "available" | "absent" | "unsupported" | "failed";
  nativeParent?: GitHubIssue;
  externalAnchors: MattSourceAnchor[];
  relationFacets: MattRawFacet[];
}>;

type ObservedResponse = Readonly<{
  endpoint: string;
  status: number;
  validator?: string;
  body: unknown;
}>;
type AcquiredProviderFreshnessEvidence = ProviderFreshnessEvidence &
  Readonly<{
    capturedAt: string;
    sourceRevision?: string;
    sourceObservedAt?: string;
  }>;

const diagnostic = (
  code: string,
  diagnosticClass: ProviderDiagnostic["class"],
  target: string,
  message: string,
): ProviderDiagnostic => ({
  code,
  class: diagnosticClass,
  impact: "blocking",
  target,
  message,
});

const captureWithoutProjection = (
  input: Readonly<{
    binding: Parameters<MattSkillsV1Provider["capture"]>[0];
    capturedAt: string;
    state: "absent" | "invalid";
    freshness: "current" | "undetermined";
    freshnessEvidence?: AcquiredProviderFreshnessEvidence;
    diagnostics: readonly ProviderDiagnostic[];
  }>,
): MattSkillsV1ProviderObservation =>
  createProviderScopeObservation({
    provider: MATT_SKILLS_V1_PROVIDER_ID,
    binding: input.binding,
    state: input.state,
    freshness:
      input.freshnessEvidence ??
      ({
        assessment: input.freshness,
        capturedAt: input.capturedAt,
        evidence: [{ kind: "github-scope", value: input.binding.nativeScope }],
      } satisfies AcquiredProviderFreshnessEvidence),
    coverage: {
      assessment:
        input.state === "absent" && input.freshness === "current" ? "complete" : "incomplete",
      dimensions: [
        {
          key: input.state === "absent" ? "root-existence" : "scope-acquisition",
          state: input.state === "absent" && input.freshness === "current" ? "covered" : "gap",
        },
      ],
    },
    completion:
      input.state === "absent" && input.freshness === "current" ? "incomplete" : "undetermined",
    diagnostics: input.diagnostics,
  });

const readRepositoryDocument = async (
  root: string,
  locator: string,
): Promise<string | undefined> => {
  try {
    const normalized = normalizeLocator(locator);
    const target = await resolveContainedPath(root, resolve(root, normalized));
    return new TextDecoder("utf-8", { fatal: true }).decode(await readContainedFile(root, target));
  } catch {
    return undefined;
  }
};

const readInterpretationDocument = async (
  options: GitHubMattProviderOptions,
  root: string,
  locator: string,
): Promise<string | undefined> =>
  options.capturedDocuments === undefined
    ? readRepositoryDocument(root, locator)
    : options.capturedDocuments.get(locator)?.source;

export const parseTriageVocabulary = (
  source: string,
  locator: string,
  diagnostics: ProviderDiagnostic[],
  diagnosticOwner: "matt.github" | "matt.local" = "matt.github",
): TriageVocabulary | undefined => {
  const table = queryMarkdownTable(parseMarkdownDocument(source));
  if (table.state !== "found") {
    diagnostics.push(
      diagnostic(
        `${diagnosticOwner}.mapping.ambiguous`,
        "mapping",
        locator,
        `Triage vocabulary table is ${table.state}.`,
      ),
    );
    return undefined;
  }
  const semanticColumn = table.value.columns.findIndex(
    (column) => column === "Label in mattpocock/skills" || column === "Semantic role",
  );
  const nativeColumn = table.value.columns.indexOf("Label in our tracker");
  if (semanticColumn === -1 || nativeColumn === -1) {
    diagnostics.push(
      diagnostic(
        `${diagnosticOwner}.mapping.ambiguous`,
        "mapping",
        locator,
        "Triage vocabulary is missing a semantic or tracker-value column.",
      ),
    );
    return undefined;
  }
  const semanticToNative = new Map<TriageSemanticRole, string>();
  const nativeToSemantic = new Map<string, TriageSemanticRole>();
  const candidates: Array<Readonly<{ semantic: TriageSemanticRole; native: string }>> = [];
  const semanticCounts = new Map<TriageSemanticRole, number>();
  let ambiguous = false;
  for (const row of table.value.rows) {
    const semantic = row[semanticColumn];
    const native = row[nativeColumn];
    if (
      semantic === undefined ||
      !(
        REQUIRED_TRIAGE_ROLES.includes(semantic as (typeof REQUIRED_TRIAGE_ROLES)[number]) ||
        semantic === "bug" ||
        semantic === "enhancement"
      )
    ) {
      continue;
    }
    const semanticRole = semantic as TriageSemanticRole;
    semanticCounts.set(semanticRole, (semanticCounts.get(semanticRole) ?? 0) + 1);
    if (native === undefined || native.trim().length === 0) {
      ambiguous = true;
      continue;
    }
    candidates.push({ semantic: semanticRole, native });
  }
  const nativeCounts = new Map<string, number>();
  for (const candidate of candidates) {
    nativeCounts.set(candidate.native, (nativeCounts.get(candidate.native) ?? 0) + 1);
  }
  for (const candidate of candidates) {
    if (semanticCounts.get(candidate.semantic) !== 1 || nativeCounts.get(candidate.native) !== 1) {
      ambiguous = true;
      continue;
    }
    semanticToNative.set(candidate.semantic, candidate.native);
    nativeToSemantic.set(candidate.native, candidate.semantic);
  }
  if (REQUIRED_TRIAGE_ROLES.some((role) => !semanticToNative.has(role))) ambiguous = true;
  if (ambiguous) {
    diagnostics.push(
      diagnostic(
        `${diagnosticOwner}.mapping.ambiguous`,
        "mapping",
        locator,
        "Triage vocabulary contains missing, duplicate or conflicting mappings.",
      ),
    );
  }
  return { semanticToNative, nativeToSemantic, complete: !ambiguous };
};

export const externalPullRequestsEnabled = (contractSource: string): boolean => {
  const document = parseMarkdownDocument(contractSource);
  const pullRequests = queryMarkdownSection(document, {
    title: "Pull requests as a triage surface",
  });
  if (pullRequests.state !== "found") return false;
  const field = queryMarkdownField(document, {
    label: "PRs as a request surface",
    within: pullRequests.value,
  });
  return field.state === "found" && field.value.value.trim().toLowerCase() === "yes.";
};

const validatorFor = (response: GitHubReadResponse): string | undefined =>
  response.headers["etag"] ?? response.headers["last-modified"];

const responseForReadError = (error: GitHubReadError): GitHubReadResponse => ({
  status: 0,
  headers: { "x-bearing-failure-kind": error.kind },
});

const acquire = async (
  transport: GitHubReadTransport,
  endpoint: string,
  observed: ObservedResponse[],
): Promise<GitHubReadResponse> => {
  let response: GitHubReadResponse;
  try {
    response = await transport.get({ endpoint, apiVersion: GITHUB_API_VERSION });
  } catch (error) {
    if (!(error instanceof GitHubReadError)) throw error;
    response = responseForReadError(error);
  }
  const validator = validatorFor(response);
  observed.push({
    endpoint,
    status: response.status,
    ...(validator === undefined ? {} : { validator }),
    body: response.body,
  });
  return response;
};

type PageAcquisition =
  | Readonly<{ state: "available"; values: readonly unknown[] }>
  | Readonly<{ state: "unsupported" }>
  | Readonly<{
      state: "failed";
      values: readonly unknown[];
      response: GitHubReadResponse;
    }>;

const acquirePages = async (
  transport: GitHubReadTransport,
  endpoint: string,
  observed: ObservedResponse[],
): Promise<PageAcquisition> => {
  const values: unknown[] = [];
  for (let page = 1; page <= 10_000; page += 1) {
    const pageEndpoint = `${endpoint}${endpoint.includes("?") ? "&" : "?"}per_page=${PAGE_SIZE}&page=${page}`;
    const response = await acquire(transport, pageEndpoint, observed);
    if (page === 1 && response.status === 410) return { state: "unsupported" };
    if (response.status !== 200 || !Array.isArray(response.body)) {
      return { state: "failed", values, response };
    }
    values.push(...response.body);
    if (response.body.length < PAGE_SIZE) return { state: "available", values };
  }
  return {
    state: "failed",
    values,
    response: {
      status: 0,
      headers: { "x-bearing-failure-kind": "acquisition" },
    },
  };
};

export type GitHubPageRead =
  | Readonly<{ state: "available"; values: readonly unknown[]; validators: readonly string[] }>
  | Readonly<{
      state: "failed";
      values: readonly unknown[];
      validators: readonly string[];
      response: GitHubReadResponse;
      endpoint: string;
    }>;

export const acquireGitHubPages = async (
  transport: GitHubReadTransport,
  endpoint: string,
): Promise<GitHubPageRead> => {
  const observed: ObservedResponse[] = [];
  const acquisition = await acquirePages(transport, endpoint, observed);
  const validators = observed.flatMap((response) =>
    response.validator === undefined ? [] : [response.validator],
  );
  if (acquisition.state === "available") {
    return { state: "available", values: acquisition.values, validators };
  }
  const last = observed.at(-1);
  return {
    state: "failed",
    values: acquisition.state === "unsupported" ? [] : acquisition.values,
    validators,
    response:
      acquisition.state === "unsupported" ? { status: 410, headers: {} } : acquisition.response,
    endpoint: last?.endpoint ?? endpoint,
  };
};

const acquisitionFailureDiagnostic = (
  response: GitHubReadResponse,
  target: string,
): ProviderDiagnostic => {
  const syntheticKind = response.headers["x-bearing-failure-kind"];
  const kind: GitHubReadFailureKind =
    syntheticKind === "authentication" ||
    syntheticKind === "permission" ||
    syntheticKind === "rate-limit" ||
    syntheticKind === "network" ||
    syntheticKind === "timeout" ||
    syntheticKind === "acquisition"
      ? syntheticKind
      : response.status === 401
        ? "authentication"
        : response.status === 429 ||
            (response.status === 403 && response.headers["x-ratelimit-remaining"] === "0")
          ? "rate-limit"
          : response.status === 403
            ? "permission"
            : "acquisition";
  const diagnosticClass: ProviderDiagnostic["class"] =
    kind === "authentication" || kind === "permission"
      ? "permission"
      : kind === "network" || kind === "timeout"
        ? "network"
        : "acquisition";
  const messages: Readonly<Record<GitHubReadFailureKind, string>> = {
    authentication: "GitHub authentication did not authorize this read.",
    permission: "GitHub denied access to this required read.",
    "rate-limit": "GitHub rate limiting prevented this required read.",
    network: "A network failure prevented this required GitHub read.",
    timeout: "The required GitHub read timed out.",
    acquisition: "The required GitHub resource could not be acquired.",
  };
  const code =
    kind === "acquisition" ? "matt.github.acquisition.failed" : `matt.github.acquisition.${kind}`;
  return diagnostic(code, diagnosticClass, target, messages[kind]);
};

const stableBody = (value: unknown): string => {
  const serialized = stableStringify(
    value === undefined ? { presence: "absent" } : { presence: "present", value },
  );
  if (serialized === undefined) {
    throw new TypeError("GitHub response normalization requires a JSON-serializable value.");
  }
  return serialized;
};

type RevalidationResult =
  | Readonly<{ state: "stable" }>
  | Readonly<{ state: "changed" }>
  | Readonly<{
      state: "failed";
      endpoint: string;
      response: GitHubReadResponse;
    }>;

const revalidate = async (
  transport: GitHubReadTransport,
  observed: readonly ObservedResponse[],
): Promise<RevalidationResult> => {
  for (const response of observed) {
    if (response.status !== 200 && response.status !== 404 && response.status !== 410) continue;
    let current: GitHubReadResponse;
    try {
      current = await transport.get({
        endpoint: response.endpoint,
        apiVersion: GITHUB_API_VERSION,
        ...(response.validator === undefined ? {} : { validator: response.validator }),
      });
    } catch (error) {
      if (!(error instanceof GitHubReadError)) throw error;
      return {
        state: "failed",
        endpoint: response.endpoint,
        response: responseForReadError(error),
      };
    }
    if (current.status === 304) continue;
    if (
      current.status === 0 ||
      current.status === 401 ||
      current.status === 403 ||
      current.status === 429 ||
      current.status >= 500
    ) {
      return { state: "failed", endpoint: response.endpoint, response: current };
    }
    if (
      current.status !== response.status ||
      stableBody(current.body) !== stableBody(response.body) ||
      (response.validator !== undefined &&
        validatorFor(current) !== undefined &&
        validatorFor(current) !== response.validator)
    ) {
      return { state: "changed" };
    }
  }
  return { state: "stable" };
};

const sourceRevision = (input: {
  observed: readonly ObservedResponse[];
  observationWindow: Readonly<{ startedAt: string; endedAt: string }>;
  acquisitionComplete: boolean;
  revalidation: RevalidationResult["state"];
  fullRetryCount: number;
  blocking: boolean;
}): string =>
  `sha256:${createHash("sha256")
    .update(
      stableBody({
        apiVersion: GITHUB_API_VERSION,
        responses: input.observed,
        observationWindow: input.observationWindow,
        coverage: {
          acquisitionComplete: input.acquisitionComplete,
          blocking: input.blocking,
        },
        revalidation: input.revalidation,
        fullRetryCount: input.fullRetryCount,
      }),
    )
    .digest("hex")}`;

type ObservedGenerationFinalization = Readonly<{
  revalidation: RevalidationResult;
  sourceObservedAt: string;
  retryRequired: boolean;
  diagnostics: readonly ProviderDiagnostic[];
}>;

const finalizeObservedGeneration = async (input: {
  transport: GitHubReadTransport;
  observed: readonly ObservedResponse[];
  fullRetryCount: number;
  target: string;
  clock: () => Date;
}): Promise<ObservedGenerationFinalization> => {
  const revalidation = await revalidate(input.transport, input.observed);
  const diagnostics: ProviderDiagnostic[] = [];
  if (revalidation.state === "failed") {
    diagnostics.push(acquisitionFailureDiagnostic(revalidation.response, revalidation.endpoint));
  } else if (revalidation.state === "changed") {
    diagnostics.push(
      diagnostic(
        "matt.github.concurrent-change",
        "concurrency",
        input.target,
        "GitHub response set changed during conditional revalidation.",
      ),
    );
  }
  return {
    revalidation,
    sourceObservedAt: input.clock().toISOString(),
    retryRequired: revalidation.state === "changed" && input.fullRetryCount === 0,
    diagnostics,
  };
};

const freshnessForObservedGeneration = (input: {
  finalization: ObservedGenerationFinalization;
  observed: readonly ObservedResponse[];
  capturedAt: string;
  fullRetryCount: number;
  assessment: "current" | "undetermined";
  acquisitionComplete: boolean;
  blocking: boolean;
  extraEvidence?: ProviderFreshnessEvidence["evidence"];
}): AcquiredProviderFreshnessEvidence => ({
  assessment: input.assessment,
  capturedAt: input.capturedAt,
  sourceRevision: sourceRevision({
    observed: input.observed,
    observationWindow: {
      startedAt: input.capturedAt,
      endedAt: input.finalization.sourceObservedAt,
    },
    acquisitionComplete: input.acquisitionComplete,
    revalidation: input.finalization.revalidation.state,
    fullRetryCount: input.fullRetryCount,
    blocking: input.blocking,
  }),
  sourceObservedAt: input.finalization.sourceObservedAt,
  evidence: [
    { kind: "github-api-version", value: GITHUB_API_VERSION },
    {
      kind: "observation-window",
      value: `${input.capturedAt}/${input.finalization.sourceObservedAt}`,
    },
    { kind: "request-count", value: String(input.observed.length) },
    { kind: "full-retry-count", value: String(input.fullRetryCount) },
    {
      kind: "conditional-revalidation",
      value: input.finalization.revalidation.state,
    },
    ...(input.extraEvidence ?? []),
    ...input.observed.map((item) => ({
      kind: "endpoint-validator",
      value: `${item.endpoint}|${item.validator ?? "content-digest"}`,
    })),
  ],
});

const issueReference = (repository: GitHubRepository, issue: GitHubIssue): MattObjectReference =>
  `github:${repository.node_id}:${issue.node_id}` as MattObjectReference;

const repositoryApiUrl = (repository: GitHubRepository): string =>
  `https://api.github.com/repos/${repository.owner.login}/${repository.name}`;

const canonicalIssueUrl = (repository: GitHubRepository, issue: GitHubIssue): string =>
  `https://github.com/${repository.owner.login}/${repository.name}/${
    issue.pull_request === undefined ? "issues" : "pull"
  }/${issue.number}`;

const canonicalIssueUrlForNumber = (repository: GitHubRepository, number: number): string =>
  `https://github.com/${repository.owner.login}/${repository.name}/issues/${number}`;

const hasCanonicalRepositoryLocation = (
  repository: GitHubRepository,
  issue: GitHubIssue,
): boolean =>
  issue.repository_url === repositoryApiUrl(repository) &&
  issue.html_url === canonicalIssueUrl(repository, issue);

const isCanonicalSameRepositoryIssue = (
  repository: GitHubRepository,
  issue: GitHubIssue,
): boolean => issue.pull_request === undefined && hasCanonicalRepositoryLocation(repository, issue);

const nativeRelationIdentity = (issue: GitHubIssue): string =>
  [issue.repository_url, issue.id, issue.node_id, issue.number, issue.html_url].join("|");

const fallbackRelationIdentity = (repository: GitHubRepository, number: number): string =>
  [
    repositoryApiUrl(repository),
    repository.node_id,
    repository.owner.login,
    repository.name,
    number,
    canonicalIssueUrlForNumber(repository, number),
  ].join("|");

const appendRelationFacet = (acquired: AcquiredIssue, key: string, value: string): void => {
  const index = acquired.relationFacets.findIndex((facet) => facet.key === key);
  const existing = index === -1 ? undefined : acquired.relationFacets[index];
  if (existing?.values.includes(value)) return;
  if (existing === undefined) {
    acquired.relationFacets.push({ key, values: [value] });
    return;
  }
  acquired.relationFacets[index] = { key, values: [...existing.values, value] };
};

const appendExternalRelationEvidence = (
  acquired: AcquiredIssue,
  key: string,
  target: string,
  identity: string,
): void => {
  if (
    !acquired.externalAnchors.some(
      (anchor) => anchor.kind === "external" && anchor.target === target,
    )
  ) {
    acquired.externalAnchors.push({ kind: "external", target });
  }
  appendRelationFacet(acquired, key, identity);
};

const nativeEvidenceFor = (
  repository: GitHubRepository,
  issue: GitHubIssue,
  comments: readonly GitHubComment[] = [],
  extraAnchors: readonly MattSourceAnchor[] = [],
  extraRawFacets: readonly MattRawFacet[] = [],
): MattNativeEvidence => {
  const sourceAnchors: MattSourceAnchor[] = [{ kind: "source", target: issue.html_url }];
  const externalTargets = new Set<string>();
  const appendExternal = (target: string): void => {
    if (externalTargets.has(target)) return;
    externalTargets.add(target);
    sourceAnchors.push({ kind: "external", target });
  };
  for (const anchor of extraAnchors) {
    if (anchor.kind === "external") appendExternal(anchor.target);
    else sourceAnchors.push(anchor);
  }
  const document = parseMarkdownDocument(issue.body);
  for (const link of queryMarkdownLinks(document)) {
    if (URL.canParse(link.target)) {
      appendExternal(link.target);
    }
  }
  const rawFacets: MattRawFacet[] = [
    { key: "labels", values: issue.labels.map((label) => label.name) },
    {
      key: "assignees",
      values: issue.assignees.map(
        (assignee) => `${assignee.login}|${assignee.id}|${assignee.node_id}`,
      ),
    },
    { key: "state", values: [issue.state] },
    ...(issue.state_reason === null || issue.state_reason === undefined
      ? []
      : [{ key: "state-reason", values: [issue.state_reason] }]),
    {
      key: "timestamps",
      values: [
        issue.created_at,
        issue.updated_at,
        ...(issue.closed_at === null || issue.closed_at === undefined ? [] : [issue.closed_at]),
      ],
    },
    ...(issue.closed_by === null || issue.closed_by === undefined
      ? []
      : [
          {
            key: "closed-by",
            values: [`${issue.closed_by.login}|${issue.closed_by.id}|${issue.closed_by.node_id}`],
          },
        ]),
    ...(issue.milestone === null || issue.milestone === undefined
      ? []
      : [
          {
            key: "milestone",
            values: [
              [
                issue.milestone.id,
                issue.milestone.node_id,
                issue.milestone.number,
                issue.milestone.title,
              ].join("|"),
            ],
          },
        ]),
    {
      key: "comments",
      values: comments.map(
        (comment) =>
          `${comment.id}|${comment.node_id}|${comment.user.login}|${comment.created_at}|${comment.updated_at}`,
      ),
    },
    {
      key: "author",
      values: [
        `${issue.user.login}|${issue.user.id}|${issue.user.node_id}|${issue.author_association}`,
      ],
    },
    ...extraRawFacets,
  ];
  return {
    kind: "github",
    identity: {
      repositoryDatabaseId: repository.id,
      repositoryNodeId: repository.node_id,
      objectKind: issue.pull_request === undefined ? "issue" : "pull-request",
      objectDatabaseId: issue.id,
      objectNodeId: issue.node_id,
      number: issue.number,
      url: issue.html_url,
      owner: repository.owner.login,
      repository: repository.name,
    },
    createdAt: projectExpectedNativeSourceEventTime(issue.created_at),
    lastUpdated: projectExpectedNativeSourceEventTime(issue.updated_at),
    trackerClosure: trackerClosureFor(issue),
    sourceAnchors,
    rawFacets,
  };
};

const nativeEvidenceForAcquired = (
  repository: GitHubRepository,
  acquired: AcquiredIssue,
): MattNativeEvidence =>
  nativeEvidenceFor(
    repository,
    acquired.issue,
    acquired.comments,
    acquired.externalAnchors,
    acquired.relationFacets,
  );

const trackerClosureFor = (issue: GitHubIssue): MattTrackerClosure => {
  if (issue.state === "open") return { state: "open" };
  const disposition =
    issue.state_reason === "completed"
      ? "completed"
      : issue.state_reason === "not_planned"
        ? "not-planned"
        : "unknown";
  return {
    state: "closed",
    disposition,
    closedAt: projectExpectedNativeSourceEventTime(issue.closed_at),
    ...(issue.closed_by === null || issue.closed_by === undefined
      ? {}
      : { actor: issue.closed_by.login }),
  };
};

const section = (acquired: AcquiredIssue, title: string): MarkdownSection | undefined => {
  const result = queryMarkdownSection(acquired.document, { title });
  return result.state === "found" ? result.value : undefined;
};

type CompatibleSectionResult =
  | Readonly<{ state: "found"; title: string; section: MarkdownSection }>
  | Readonly<{ state: "absent" | "ambiguous" }>;

const compatibleSection = (
  acquired: AcquiredIssue,
  titles: readonly string[],
  role: string,
  diagnostics: ProviderDiagnostic[],
): CompatibleSectionResult => {
  const found: Readonly<{ title: string; section: MarkdownSection }>[] = [];
  let ambiguous = false;
  for (const title of titles) {
    const result = queryMarkdownSection(acquired.document, { title });
    if (result.state === "found") found.push({ title, section: result.value });
    if (result.state === "ambiguous") ambiguous = true;
  }
  if (ambiguous || found.length > 1) {
    diagnostics.push(
      diagnostic(
        "matt.github.semantic-section.ambiguous",
        "format",
        acquired.issue.html_url,
        `Provider semantic role ${role} has ambiguous compatible headings.`,
      ),
    );
    return { state: "ambiguous" };
  }
  const only = found[0];
  return only === undefined ? { state: "absent" } : { state: "found", ...only };
};

const sectionItems = (
  acquired: AcquiredIssue,
  title: string,
): readonly Readonly<{
  text: string;
  checked?: boolean;
  links?: readonly Readonly<{ label: string; target: string; title?: string }>[];
}>[] => {
  const target = section(acquired, title);
  if (target === undefined) return [];
  const list = queryMarkdownList(acquired.document, { within: target });
  return list.state === "found" ? list.value.items : [];
};

type MarkdownSectionItem = ReturnType<typeof sectionItems>[number];

const mapSectionItems = (
  acquired: AcquiredIssue,
  title: string,
  diagnostics: ProviderDiagnostic[],
): readonly MarkdownSectionItem[] => {
  const target = queryMarkdownSection(acquired.document, { title });
  if (target.state === "ambiguous") {
    diagnostics.push(
      diagnostic(
        "matt.github.role.ambiguous-map-structure",
        "format",
        acquired.issue.html_url,
        `Map section "${title}" is duplicated or malformed.`,
      ),
    );
    return [];
  }
  if (target.state === "absent") return [];
  const list = queryMarkdownList(acquired.document, { within: target.value });
  if (list.state === "ambiguous") {
    diagnostics.push(
      diagnostic(
        "matt.github.role.ambiguous-map-structure",
        "format",
        acquired.issue.html_url,
        `Map section "${title}" contains multiple or conflicting lists.`,
      ),
    );
    return [];
  }
  return list.state === "found" ? list.value.items : [];
};

const compatibleMapSectionItems = (
  acquired: AcquiredIssue,
  titles: readonly string[],
  role: string,
  diagnostics: ProviderDiagnostic[],
): Readonly<{
  items: readonly MarkdownSectionItem[];
  availability: "available" | "confirmed-empty" | "unavailable";
}> => {
  const target = compatibleSection(acquired, titles, role, diagnostics);
  if (target.state !== "found") return { items: [], availability: "unavailable" };
  const list = queryMarkdownList(acquired.document, { within: target.section });
  if (list.state === "ambiguous") {
    diagnostics.push(
      diagnostic(
        "matt.github.semantic-section.ambiguous",
        "format",
        acquired.issue.html_url,
        `Provider semantic role ${role} contains ambiguous list content.`,
      ),
    );
  }
  const items = list.state === "found" ? list.value.items : [];
  return {
    items,
    availability: semanticAvailabilityForItems(
      "found",
      items.length,
      target.section.markdown.trim().length > 0 && items.length === 0,
    ),
  };
};

const commentContent = (comment: GitHubComment): MattAuthoredContent => {
  const document = parseMarkdownDocument(comment.body);
  const agentBrief = queryMarkdownSection(document, { title: "Agent Brief" });
  const triageNotes = queryMarkdownSection(document, { title: "Triage Notes" });
  const role =
    agentBrief.state === "found"
      ? "agent-brief"
      : triageNotes.state === "found"
        ? "triage-note"
        : "ordinary-comment";
  const body =
    agentBrief.state === "found"
      ? agentBrief.value.markdown
      : triageNotes.state === "found"
        ? triageNotes.value.markdown
        : comment.body;
  return {
    role,
    body,
    nativeIdentity: comment.node_id,
    author: comment.user.login,
    authoredAt: projectExpectedNativeSourceEventTime(comment.created_at),
    sourceAnchor: { kind: "source", target: comment.html_url },
  };
};

type CanonicalGitHubIssueLink = Readonly<{
  number: number;
  commentId?: string;
}>;

const canonicalIssueLink = (
  target: string,
  repository: GitHubRepository,
): CanonicalGitHubIssueLink | undefined => {
  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    return undefined;
  }
  if (parsed.hostname !== "github.com") return undefined;
  const segments = parsed.pathname.split("/").filter((segment) => segment.length > 0);
  if (
    segments.length !== 4 ||
    segments[0] !== repository.owner.login ||
    segments[1] !== repository.name ||
    (segments[2] !== "issues" && segments[2] !== "pull")
  ) {
    return undefined;
  }
  const numberSource = segments[3] ?? "";
  if (!/^[1-9][0-9]*$/u.test(numberSource)) return undefined;
  const number = Number(numberSource);
  if (!Number.isSafeInteger(number) || number <= 0) return undefined;
  const fragmentMatch = /^#issuecomment-([1-9][0-9]*)$/u.exec(parsed.hash);
  const fragment = fragmentMatch?.[1];
  return {
    number,
    ...(fragment === undefined || fragment.length === 0 ? {} : { commentId: fragment }),
  };
};

const numericIssueReference = (value: string): number | undefined => {
  const trimmed = value.trim();
  const match = /^#([1-9][0-9]*)$/u.exec(trimmed);
  if (match?.[1] === undefined) return undefined;
  const number = Number(match[1]);
  return Number.isSafeInteger(number) && number > 0 ? number : undefined;
};

const bodyBlockerNumbers = (
  acquired: AcquiredIssue,
  repository: GitHubRepository,
): readonly number[] => {
  const numbers = new Set<number>();
  for (const item of sectionItems(acquired, "Blocked by")) {
    for (const link of item.links ?? []) {
      const target = canonicalIssueLink(link.target, repository);
      if (target !== undefined) numbers.add(target.number);
    }
    const direct = numericIssueReference(item.text);
    if (direct !== undefined) numbers.add(direct);
  }
  const field = queryMarkdownField(acquired.document, {
    label: "Blocked by",
  });
  if (field.state === "found") {
    for (const value of field.value.value.split(",")) {
      const direct = numericIssueReference(value);
      if (direct !== undefined) numbers.add(direct);
    }
  }
  return [...numbers];
};

const bodyChildNumbers = (
  acquired: AcquiredIssue,
  repository: GitHubRepository,
): readonly number[] => {
  if (!acquired.issue.labels.some((label) => label.name === "wayfinder:map")) return [];
  const numbers: number[] = [];
  for (const list of queryMarkdownLists(acquired.document)) {
    for (const item of list.items) {
      if (item.checked === undefined) continue;
      const candidates = (item.links ?? []).flatMap((link) => {
        const target = canonicalIssueLink(link.target, repository);
        return target === undefined ? [] : [target.number];
      });
      if (candidates.length === 1 && candidates[0] !== undefined) {
        numbers.push(candidates[0]);
      }
    }
  }
  return numbers;
};

const bodyParentNumber = (acquired: AcquiredIssue): number | undefined => {
  const field = queryMarkdownField(acquired.document, {
    label: "Part of",
    separator: "space",
  });
  return field.state === "found" ? numericIssueReference(field.value.value) : undefined;
};

const wouldCreateParentCycle = (
  childNodeId: string,
  parentNodeId: string,
  parentByChild: ReadonlyMap<string, string>,
): boolean => {
  const visited = new Set<string>();
  let current: string | undefined = parentNodeId;
  while (current !== undefined && !visited.has(current)) {
    if (current === childNodeId) return true;
    visited.add(current);
    current = parentByChild.get(current);
  }
  return false;
};

const gistAfterLinkLabel = (text: string, label: string): string => {
  const suffix = text.startsWith(label) ? text.slice(label.length).trim() : text.trim();
  return suffix.startsWith("—") || suffix.startsWith("-") ? suffix.slice(1).trim() : suffix;
};

const mapEntries = (
  map: AcquiredIssue,
  items: readonly MarkdownSectionItem[],
  repository: GitHubRepository,
  byNumber: ReadonlyMap<number, AcquiredIssue>,
  diagnostics: ProviderDiagnostic[],
  anchorKind: "decision" | "disposition",
): readonly Readonly<{
  ticket?: MattObjectReference;
  text: string;
  anchor: MattSourceAnchor;
}>[] =>
  items.map((item, index) => {
    const nativeLinks = (item.links ?? []).flatMap((link) => {
      const target = canonicalIssueLink(link.target, repository);
      return target === undefined ? [] : [{ link, target }];
    });
    if (nativeLinks.length > 1) {
      diagnostics.push(
        diagnostic(
          "matt.github.workflow.route-ambiguous",
          "format",
          `${map.issue.html_url}#${anchorKind}-${index + 1}`,
          "One Matt Map route entry contains more than one canonical ticket link.",
        ),
      );
    }
    const only = nativeLinks.length === 1 ? nativeLinks[0] : undefined;
    const linked = only === undefined ? undefined : byNumber.get(only.target.number);
    return {
      ...(linked === undefined ? {} : { ticket: issueReference(repository, linked.issue) }),
      text: only === undefined ? item.text : gistAfterLinkLabel(item.text, only.link.label),
      anchor: {
        kind: anchorKind,
        target: only?.link.target ?? `${map.issue.html_url}#${anchorKind}-${index + 1}`,
      },
    };
  });

const decodeMap = (
  acquired: AcquiredIssue,
  repository: GitHubRepository,
  byNumber: ReadonlyMap<number, AcquiredIssue>,
  diagnostics: ProviderDiagnostic[],
): MattMap | undefined => {
  const destination = section(acquired, "Destination");
  if (destination === undefined) return undefined;
  const notesSection = compatibleMapSectionItems(acquired, ["Notes"], "map.notes", diagnostics);
  const fogSection = compatibleMapSectionItems(
    acquired,
    ["Not yet specified", "Fog"],
    "map.fog",
    diagnostics,
  );
  const decisions = mapEntries(
    acquired,
    mapSectionItems(acquired, "Decisions so far", diagnostics),
    repository,
    byNumber,
    diagnostics,
    "decision",
  );
  const outOfScope = mapEntries(
    acquired,
    mapSectionItems(acquired, "Out of scope", diagnostics),
    repository,
    byNumber,
    diagnostics,
    "disposition",
  );
  const collectionAvailability = (
    title: string,
    count: number,
  ): "available" | "confirmed-empty" | "unavailable" => {
    const result = queryMarkdownSection(acquired.document, { title });
    return semanticAvailabilityForItems(
      result.state,
      count,
      result.state === "found" && result.value.markdown.trim().length > 0 && count === 0,
    );
  };
  return {
    kind: "map",
    ref: issueReference(repository, acquired.issue),
    title: acquired.issue.title,
    destination: destination.markdown,
    notes: notesSection.items.map((item) => item.text),
    decisions: decisions.map((entry) => ({
      ...(entry.ticket === undefined ? {} : { ticket: entry.ticket }),
      gist: entry.text,
      sourceAnchor: entry.anchor,
    })),
    fog: fogSection.items.map((item) => item.text),
    outOfScope: outOfScope.map((entry) => ({
      ...(entry.ticket === undefined ? {} : { ticket: entry.ticket }),
      rationale: entry.text,
      sourceAnchor: entry.anchor,
    })),
    lifecycle:
      acquired.issue.state === "closed"
        ? {
            state: "resolved",
            resolutionEvidence: decisions.map((entry) => entry.anchor),
          }
        : { state: "active" },
    semanticSections: [
      semanticSection(
        "map.destination",
        destination.markdown.trim().length === 0 ? "confirmed-empty" : "available",
      ),
      semanticSection("map.notes", notesSection.availability),
      semanticSection(
        "map.decisions",
        collectionAvailability("Decisions so far", decisions.length),
      ),
      semanticSection("map.fog", fogSection.availability),
      semanticSection(
        "map.out-of-scope",
        collectionAvailability("Out of scope", outOfScope.length),
      ),
      semanticSection(
        "map.resolution-evidence",
        acquired.issue.state === "closed"
          ? decisions.length === 0
            ? "unavailable"
            : "available"
          : "confirmed-empty",
      ),
    ],
    native: nativeEvidenceForAcquired(repository, acquired),
  };
};

const decodeSpec = (
  acquired: AcquiredIssue,
  repository: GitHubRepository,
  vocabulary: TriageVocabulary | undefined,
  diagnostics: ProviderDiagnostic[],
): MattSpec | undefined => {
  const projected = projectMattSpecDocument(acquired.document);
  if (projected.semanticSections.every((section) => section.availability === "unavailable")) {
    return undefined;
  }
  for (const issue of projected.diagnostics) {
    diagnostics.push(diagnostic(issue.code, "format", acquired.issue.html_url, issue.message));
  }
  const labels = acquired.issue.labels.map((label) => label.name);
  const readyLabel = vocabulary?.semanticToNative.get("ready-for-agent");
  const lifecycle =
    acquired.issue.state === "closed" && acquired.issue.state_reason === "not_planned"
      ? "superseded"
      : readyLabel !== undefined && labels.includes(readyLabel)
        ? "ready-for-agent"
        : "draft";
  return {
    kind: "spec",
    ref: issueReference(repository, acquired.issue),
    title: acquired.issue.title,
    document: projected.document,
    lifecycle: { state: lifecycle },
    semanticSections: projected.semanticSections,
    native: nativeEvidenceForAcquired(repository, acquired),
  };
};

const decodeDelivery = (
  acquired: AcquiredIssue,
  repository: GitHubRepository,
): MattDeliveryTicket | undefined => {
  const whatToBuild = section(acquired, "What to build");
  const acceptance = sectionItems(acquired, "Acceptance criteria");
  if (
    whatToBuild === undefined ||
    acceptance.length === 0 ||
    acceptance.some((item) => item.checked === undefined)
  ) {
    return undefined;
  }
  return {
    kind: "delivery-ticket",
    ref: issueReference(repository, acquired.issue),
    title: acquired.issue.title,
    whatToBuild: whatToBuild.markdown,
    acceptanceCriteria: acceptance.map((item) => item.text),
    lifecycle:
      acquired.issue.state === "open"
        ? { state: "open" }
        : { state: "completion-unavailable", reason: "source-contract-gap" },
    trackerClosure: trackerClosureFor(acquired.issue),
    comments: acquired.comments.map(commentContent),
    semanticSections: [
      semanticSection(
        "delivery.what-to-build",
        whatToBuild.markdown.trim().length === 0 ? "confirmed-empty" : "available",
      ),
      semanticSection(
        "delivery.acceptance-criteria",
        acceptance.length === 0 ? "confirmed-empty" : "available",
      ),
      semanticSection(
        "delivery.completion-evidence",
        acquired.issue.state === "open" ? "confirmed-empty" : "unavailable",
      ),
      semanticSection(
        "delivery.comments",
        acquired.comments.length > 0
          ? "available"
          : acquired.commentsCapability === "unsupported"
            ? "unsupported"
            : acquired.commentsCapability === "failed"
              ? "unavailable"
              : "confirmed-empty",
      ),
    ],
    native: nativeEvidenceForAcquired(repository, acquired),
  };
};

const decodeWayfinder = (
  acquired: AcquiredIssue,
  repository: GitHubRepository,
  map: MattMap | undefined,
  diagnostics: ProviderDiagnostic[],
): MattWayfinderTicket | undefined => {
  const subtypeLabels = acquired.issue.labels
    .map((label) => label.name)
    .flatMap((label) => (label.startsWith("wayfinder:") ? [label.slice("wayfinder:".length)] : []))
    .filter((value): value is MattWayfinderTicket["subtype"] =>
      WAYFINDER_SUBTYPES.some((subtype) => subtype === value),
    );
  const wayfinderSignals = acquired.issue.labels
    .map((label) => label.name)
    .filter((label) => label.startsWith("wayfinder:"));
  const question = section(acquired, "Question");
  if (subtypeLabels.length !== 1 || wayfinderSignals.length !== 1 || question === undefined) {
    return undefined;
  }
  const reference = issueReference(repository, acquired.issue);
  const decisions = map?.decisions.filter((entry) => entry.ticket === reference) ?? [];
  const dispositions = map?.outOfScope.filter((entry) => entry.ticket === reference) ?? [];
  const routeAmbiguous = decisions.length + dispositions.length > 1;
  const decision = !routeAmbiguous && decisions.length === 1 ? decisions[0] : undefined;
  const disposition = !routeAmbiguous && dispositions.length === 1 ? dispositions[0] : undefined;
  if (routeAmbiguous) {
    diagnostics.push(
      diagnostic(
        "matt.github.workflow.route-ambiguous",
        "mapping",
        acquired.issue.html_url,
        "Wayfinder ticket has duplicate or conflicting canonical Map route pointers.",
      ),
    );
  }
  const decisionLink =
    decision === undefined
      ? undefined
      : canonicalIssueLink(decision.sourceAnchor.target, repository);
  const answerComment =
    decisionLink?.commentId === undefined
      ? undefined
      : acquired.comments.filter((comment) => comment.id === decisionLink.commentId);
  const referencedAnswerCount =
    decisionLink?.commentId === undefined
      ? 0
      : [...(map?.decisions ?? []), ...(map?.outOfScope ?? [])].filter(
          (entry) =>
            canonicalIssueLink(entry.sourceAnchor.target, repository)?.commentId ===
            decisionLink.commentId,
        ).length;
  const uniqueAnswer =
    answerComment?.length === 1 && referencedAnswerCount === 1 ? answerComment[0] : undefined;
  const claim: MattWayfinderTicket["claim"] =
    acquired.issue.assignees.length === 0
      ? { state: "unclaimed" }
      : acquired.issue.assignees.length === 1
        ? {
            state: "claimed",
            claimant: (acquired.issue.assignees[0] as GitHubIssue["assignees"][number]).login,
          }
        : { state: "claimed", claimantAmbiguous: true };
  const trackerClosure = trackerClosureFor(acquired.issue);
  if (acquired.issue.assignees.length > 1) {
    diagnostics.push(
      diagnostic(
        "matt.github.workflow.claimant-ambiguous",
        "mapping",
        acquired.issue.html_url,
        "Wayfinder ticket is claimed, but multiple assignees prevent one claimant identity.",
      ),
    );
  }
  if (
    trackerClosure.state === "closed" &&
    decision === undefined &&
    disposition === undefined &&
    !routeAmbiguous
  ) {
    diagnostics.push(
      diagnostic(
        "matt.github.workflow.closed-without-route",
        "mapping",
        acquired.issue.html_url,
        "Closed Wayfinder ticket has no canonical Map decision or out-of-scope pointer.",
      ),
    );
  }
  return {
    kind: "wayfinder-ticket",
    ref: reference,
    title: acquired.issue.title,
    subtype: subtypeLabels[0] as MattWayfinderTicket["subtype"],
    question: question.markdown,
    claim,
    answer:
      uniqueAnswer === undefined
        ? {
            availability: "unavailable",
            reason:
              acquired.commentsCapability !== "available"
                ? "source-contract-gap"
                : decision !== undefined || acquired.comments.length > 0
                  ? "no-unique-native-reference"
                  : "not-authored",
          }
        : {
            availability: "available",
            content: {
              ...commentContent(uniqueAnswer),
              role: "answer",
              sourceAnchor: { kind: "answer", target: uniqueAnswer.html_url },
            },
          },
    comments: acquired.comments.filter((comment) => comment !== uniqueAnswer).map(commentContent),
    lifecycle:
      trackerClosure.state === "closed" && decision !== undefined
        ? { state: "resolved-on-route", decisionSource: decision.sourceAnchor }
        : trackerClosure.state === "closed" && disposition !== undefined
          ? {
              state: "ruled-out-of-scope",
              dispositionSource: disposition.sourceAnchor,
            }
          : { state: "open" },
    trackerClosure:
      trackerClosure.state === "closed" && disposition !== undefined
        ? { ...trackerClosure, disposition: "wontfix" }
        : trackerClosure,
    semanticSections: [
      semanticSection(
        "wayfinder.question",
        question.markdown.trim().length === 0 ? "confirmed-empty" : "available",
      ),
      semanticSection("wayfinder.claim", "available"),
      semanticSection(
        "wayfinder.answer",
        uniqueAnswer !== undefined
          ? "available"
          : acquired.commentsCapability === "unsupported"
            ? "unsupported"
            : acquired.commentsCapability === "failed"
              ? "unavailable"
              : decision === undefined && acquired.comments.length === 0
                ? "confirmed-empty"
                : "unavailable",
      ),
      semanticSection(
        "wayfinder.comments",
        acquired.comments.filter((comment) => comment !== uniqueAnswer).length > 0
          ? "available"
          : acquired.commentsCapability === "unsupported"
            ? "unsupported"
            : acquired.commentsCapability === "failed"
              ? "unavailable"
              : "confirmed-empty",
      ),
    ],
    native: nativeEvidenceForAcquired(repository, acquired),
  };
};

const isRequiredTriageRole = (
  value: TriageSemanticRole,
): value is (typeof REQUIRED_TRIAGE_ROLES)[number] =>
  REQUIRED_TRIAGE_ROLES.some((role) => role === value);

const incomingIssueFor = (
  repository: GitHubRepository,
  acquired: AcquiredIssue,
  vocabulary: TriageVocabulary | undefined,
  diagnostics: ProviderDiagnostic[],
): MattIncomingIssue => {
  const { issue } = acquired;
  const labels = issue.labels.map((label) => label.name);
  const semanticLabels = labels.flatMap((label) => {
    const semantic = vocabulary?.nativeToSemantic.get(label);
    return semantic === undefined ? [] : [semantic];
  });
  const categories = semanticLabels.filter(
    (value): value is "bug" | "enhancement" => value === "bug" || value === "enhancement",
  );
  const states = semanticLabels.filter(isRequiredTriageRole);
  const category: MattIncomingIssue["classification"]["category"] =
    categories.length === 0
      ? "unknown"
      : categories.length === 1
        ? (categories[0] as "bug" | "enhancement")
        : "ambiguous";
  const state: MattIncomingIssue["classification"]["state"] =
    states.length === 0
      ? "unknown"
      : states.length === 1
        ? (states[0] as (typeof REQUIRED_TRIAGE_ROLES)[number])
        : "ambiguous";
  if (
    categories.length > 1 ||
    states.length > 1 ||
    (categories.length === 0) !== (states.length === 0)
  ) {
    diagnostics.push(
      diagnostic(
        "matt.github.triage.ambiguous",
        "mapping",
        issue.html_url,
        "Incoming request has incomplete or conflicting mapped category/state labels.",
      ),
    );
  }
  const nativeCategory =
    categories.length === 1
      ? labels.find((label) => vocabulary?.nativeToSemantic.get(label) === categories[0])
      : undefined;
  const nativeState =
    states.length === 1
      ? labels.find((label) => vocabulary?.nativeToSemantic.get(label) === states[0])
      : undefined;
  const content: MattContent[] = [
    ...(issue.body.trim().length === 0
      ? []
      : [{ role: "issue-body" as const, body: markdownNarrative(acquired.document) }]),
    ...nativeEvidenceForAcquired(repository, acquired).sourceAnchors.flatMap((anchor) =>
      anchor.kind === "external"
        ? [
            {
              role: "source-anchor",
              body: anchor.target,
              sourceAnchor: anchor,
            } as const,
          ]
        : [],
    ),
    ...acquired.comments.map(commentContent),
  ];
  return {
    kind: "incoming-issue",
    ref: issueReference(repository, issue),
    title: issue.title,
    classification: {
      category,
      state,
      ...(nativeCategory === undefined ? {} : { nativeCategory }),
      ...(nativeState === undefined ? {} : { nativeState }),
    },
    content,
    lifecycle:
      issue.state === "open"
        ? { state: "open" }
        : {
            state: "closed",
            disposition:
              state === "wontfix"
                ? "wontfix"
                : issue.state_reason === "not_planned"
                  ? "not-planned"
                  : issue.state_reason === "completed"
                    ? "completed"
                    : "unknown",
            closedAt: projectExpectedNativeSourceEventTime(issue.closed_at),
          },
    semanticSections: [
      semanticSection(
        "incoming.classification",
        category === "ambiguous" || category === "unknown" ? "unavailable" : "available",
      ),
      semanticSection(
        "incoming.content",
        content.length > 0
          ? "available"
          : acquired.commentsCapability === "unsupported"
            ? "unsupported"
            : acquired.commentsCapability === "failed"
              ? "unavailable"
              : "confirmed-empty",
      ),
      semanticSection(
        "incoming.routing",
        state === "ambiguous" || state === "unknown" ? "unavailable" : "available",
      ),
    ],
    native: nativeEvidenceForAcquired(repository, acquired),
  };
};

const collectBlockedByRelations = (
  acquired: readonly AcquiredIssue[],
  repository: GitHubRepository,
  diagnostics: ProviderDiagnostic[],
): readonly MattBlockedByRelation[] => {
  const acquiredByNode = new Map(acquired.map((entry) => [entry.issue.node_id, entry]));
  const byNumber = new Map(acquired.map((entry) => [entry.issue.number, entry]));
  const blockedBy: MattBlockedByRelation[] = [];
  for (const entry of acquired) {
    for (const dependency of entry.dependencies) {
      const blocker = acquiredByNode.get(dependency.node_id);
      if (blocker === undefined) continue;
      blockedBy.push({
        blocked: issueReference(repository, entry.issue),
        blocker: issueReference(repository, blocker.issue),
        evidence: "github-native",
      });
    }
    const fallbackNumbers = bodyBlockerNumbers(entry, repository);
    if (entry.dependencyCapability !== "failed") {
      for (const blockerNumber of fallbackNumbers) {
        if (byNumber.has(blockerNumber)) continue;
        const target = canonicalIssueUrlForNumber(repository, blockerNumber);
        appendExternalRelationEvidence(
          entry,
          "fallback-external-blocked-by",
          target,
          fallbackRelationIdentity(repository, blockerNumber),
        );
      }
    }
    if (entry.dependencyCapability === "unsupported") {
      for (const blockerNumber of fallbackNumbers) {
        const blocker = byNumber.get(blockerNumber);
        if (blocker === undefined) continue;
        blockedBy.push({
          blocked: issueReference(repository, entry.issue),
          blocker: issueReference(repository, blocker.issue),
          evidence: "matt-body-fallback",
        });
      }
      continue;
    }
    if (entry.dependencyCapability !== "available" || fallbackNumbers.length === 0) continue;
    const nativeTargets = entry.dependencies.map((blocker) => blocker.html_url).sort();
    const fallbackTargets = fallbackNumbers
      .map((number) => canonicalIssueUrlForNumber(repository, number))
      .sort();
    if (nativeTargets.join("\n") === fallbackTargets.join("\n")) continue;
    diagnostics.push(
      diagnostic(
        "matt.github.relation.native-fallback-conflict",
        "identity",
        entry.issue.html_url,
        "GitHub native dependencies and Matt body fallback disagree.",
      ),
    );
    for (const blockerNumber of fallbackNumbers) {
      const blocker = byNumber.get(blockerNumber);
      appendRelationFacet(
        entry,
        "relation-conflict:blocked-by-fallback",
        blocker === undefined
          ? fallbackRelationIdentity(repository, blockerNumber)
          : String(issueReference(repository, blocker.issue)),
      );
    }
  }
  return blockedBy;
};

const captureGitHubScope = async (
  options: ResolvedGitHubMattProviderOptions,
  binding: Parameters<MattSkillsV1Provider["capture"]>[0],
  fullRetryCount = 0,
): Promise<MattSkillsV1ProviderObservation> => {
  const capturedAt = (options.clock ?? (() => new Date()))().toISOString();
  const diagnostics: ProviderDiagnostic[] = [];
  let root: string;
  try {
    root = await resolveRepositoryRoot(options.repoRoot);
  } catch {
    return captureWithoutProjection({
      binding,
      capturedAt,
      state: "invalid",
      freshness: "undetermined",
      diagnostics: [
        diagnostic(
          "matt.github.repository.unavailable",
          "source",
          options.repoRoot,
          "Repository root is unavailable while reading the confirmed GitHub contract.",
        ),
      ],
    });
  }
  const contractLocator = normalizeLocator(options.contractLocator);
  const triageLocator = normalizeLocator(
    options.triageLocator ?? posix.join(posix.dirname(contractLocator), "triage-labels.md"),
  );
  const contractSource = await readInterpretationDocument(options, root, contractLocator);
  const contract =
    contractSource === undefined ? undefined : validateMattSkillsV1Contract(contractSource);
  if (
    contractSource === undefined ||
    contract?.state !== "supported" ||
    contract.driver !== "github-issues"
  ) {
    return captureWithoutProjection({
      binding,
      capturedAt,
      state: "invalid",
      freshness: "undetermined",
      diagnostics: [
        diagnostic(
          "matt.github.contract.unsupported",
          "contract",
          contractLocator,
          "Confirmed repository contract does not select matt-skills/v1 GitHub Issues.",
        ),
      ],
    });
  }
  const pullRequestsEnabled = externalPullRequestsEnabled(contractSource);
  const triageSource = await readInterpretationDocument(options, root, triageLocator);
  const vocabulary =
    triageSource === undefined
      ? undefined
      : parseTriageVocabulary(triageSource, triageLocator, diagnostics);
  if (triageSource === undefined) {
    diagnostics.push(
      diagnostic(
        "matt.github.mapping.unavailable",
        "mapping",
        triageLocator,
        "Repository triage vocabulary could not be read.",
      ),
    );
  }
  const scope = decodeGitHubMattNativeScope(binding.nativeScope);
  if (scope === undefined) {
    return captureWithoutProjection({
      binding,
      capturedAt,
      state: "invalid",
      freshness: "undetermined",
      diagnostics: [
        ...diagnostics,
        diagnostic(
          "matt.github.scope.invalid",
          "identity",
          binding.nativeScope,
          "GitHub native scope identity is malformed or uses an unsupported host.",
        ),
      ],
    });
  }

  const observed: ObservedResponse[] = [];
  const finalizeObservedCapture = async (input: {
    state: "absent" | "invalid";
    target: string;
    diagnostics: readonly ProviderDiagnostic[];
  }): Promise<MattSkillsV1ProviderObservation> => {
    const finalization = await finalizeObservedGeneration({
      transport: options.transport,
      observed,
      fullRetryCount,
      target: input.target,
      clock: options.clock ?? (() => new Date()),
    });
    if (finalization.retryRequired) {
      return captureGitHubScope(options, binding, 1);
    }
    const finalDiagnostics = [...input.diagnostics, ...finalization.diagnostics];
    const freshness = finalization.revalidation.state === "stable" ? "current" : "undetermined";
    const blocking = input.state === "invalid" || finalization.revalidation.state !== "stable";
    return captureWithoutProjection({
      binding,
      capturedAt,
      state: input.state,
      freshness,
      freshnessEvidence: freshnessForObservedGeneration({
        finalization,
        observed,
        capturedAt,
        fullRetryCount,
        assessment: freshness,
        acquisitionComplete: finalization.revalidation.state === "stable",
        blocking,
        extraEvidence: [{ kind: "github-scope", value: binding.nativeScope }],
      }),
      diagnostics: finalDiagnostics,
    });
  };
  const repositoryEndpoint = `repos/${scope.repository.owner}/${scope.repository.name}`;
  const repositoryResponse = await acquire(options.transport, repositoryEndpoint, observed);
  const repositoryResult = githubRepositorySchema.safeParse(repositoryResponse.body);
  if (repositoryResponse.status !== 200 || !repositoryResult.success) {
    const failureDiagnostics = [
      ...diagnostics,
      repositoryResponse.status !== 200 && repositoryResponse.status !== 404
        ? acquisitionFailureDiagnostic(repositoryResponse, repositoryEndpoint)
        : diagnostic(
            "matt.github.repository.acquisition",
            "acquisition",
            repositoryEndpoint,
            "GitHub repository identity could not be acquired and decoded.",
          ),
    ];
    if (repositoryResponse.status !== 200 && repositoryResponse.status !== 404) {
      return captureWithoutProjection({
        binding,
        capturedAt,
        state: "invalid",
        freshness: "undetermined",
        diagnostics: failureDiagnostics,
      });
    }
    return finalizeObservedCapture({
      state: repositoryResponse.status === 404 ? "absent" : "invalid",
      target: repositoryEndpoint,
      diagnostics: failureDiagnostics,
    });
  }
  const repository = repositoryResult.data;
  if (
    repository.id !== scope.repository.databaseId ||
    repository.node_id !== scope.repository.nodeId ||
    repository.owner.login !== scope.repository.owner ||
    repository.name !== scope.repository.name ||
    repository.full_name !== `${scope.repository.owner}/${scope.repository.name}` ||
    repository.html_url !== `https://github.com/${scope.repository.owner}/${scope.repository.name}`
  ) {
    return finalizeObservedCapture({
      state: "invalid",
      target: repository.html_url,
      diagnostics: [
        ...diagnostics,
        diagnostic(
          "matt.github.identity.rebind-required",
          "identity",
          repository.html_url,
          "GitHub repository locator and native identity differ; explicit rebind is required.",
        ),
      ],
    });
  }

  const issueEndpoint = `${repositoryEndpoint}/issues/${scope.root.number}`;
  const issueResponse = await acquire(options.transport, issueEndpoint, observed);
  const issueResult = githubIssueSchema.safeParse(issueResponse.body);
  if (issueResponse.status !== 200 || !issueResult.success) {
    const failureDiagnostics = [
      ...diagnostics,
      issueResponse.status !== 200 && issueResponse.status !== 404
        ? acquisitionFailureDiagnostic(issueResponse, issueEndpoint)
        : diagnostic(
            "matt.github.root.acquisition",
            "acquisition",
            issueEndpoint,
            "GitHub root identity and body could not be acquired and decoded.",
          ),
    ];
    if (issueResponse.status !== 200 && issueResponse.status !== 404) {
      return captureWithoutProjection({
        binding,
        capturedAt,
        state: "invalid",
        freshness: "undetermined",
        diagnostics: failureDiagnostics,
      });
    }
    return finalizeObservedCapture({
      state: issueResponse.status === 404 ? "absent" : "invalid",
      target: issueEndpoint,
      diagnostics: failureDiagnostics,
    });
  }
  const issue = issueResult.data;
  const objectKind = issue.pull_request === undefined ? "issue" : "pull-request";
  if (
    issue.id !== scope.root.databaseId ||
    issue.node_id !== scope.root.nodeId ||
    issue.number !== scope.root.number ||
    objectKind !== scope.root.objectKind ||
    !hasCanonicalRepositoryLocation(repository, issue)
  ) {
    return finalizeObservedCapture({
      state: "invalid",
      target: issue.html_url,
      diagnostics: [
        ...diagnostics,
        diagnostic(
          "matt.github.identity.rebind-required",
          "identity",
          issue.html_url,
          "GitHub root locator and native identity differ; explicit rebind is required.",
        ),
      ],
    });
  }
  if (objectKind === "pull-request") {
    if (scope.rootKind !== "standalone-request") {
      return finalizeObservedCapture({
        state: "invalid",
        target: issue.html_url,
        diagnostics: [
          ...diagnostics,
          diagnostic(
            "matt.github.root.pr-kind",
            "contract",
            issue.html_url,
            "A pull request may only be bound as a standalone request.",
          ),
        ],
      });
    }
    if (!pullRequestsEnabled) {
      return finalizeObservedCapture({
        state: "invalid",
        target: issue.html_url,
        diagnostics: [
          ...diagnostics,
          diagnostic(
            "matt.github.root.pr-not-enabled",
            "contract",
            issue.html_url,
            "Repository contract does not enable pull requests as a triage surface.",
          ),
        ],
      });
    }
    if (!["CONTRIBUTOR", "FIRST_TIME_CONTRIBUTOR", "NONE"].includes(issue.author_association)) {
      return finalizeObservedCapture({
        state: "invalid",
        target: issue.html_url,
        diagnostics: [
          ...diagnostics,
          diagnostic(
            "matt.github.root.pr-not-external",
            "contract",
            issue.html_url,
            "Pull request author association is not an external Matt request.",
          ),
        ],
      });
    }
  }
  if (
    (scope.rootKind !== "standalone-request" && objectKind !== "issue") ||
    (scope.rootKind === "wayfinder-map" &&
      !issue.labels.some((label) => label.name === "wayfinder:map")) ||
    (scope.rootKind === "parent-issue" &&
      issue.labels.some((label) => label.name === "wayfinder:map"))
  ) {
    diagnostics.push(
      diagnostic(
        "matt.github.root.role",
        "contract",
        issue.html_url,
        "GitHub root kind does not match its Matt-owned native role.",
      ),
    );
  }

  const pending: GitHubIssue[] = [issue];
  const discoveredByNode = new Map([[issue.node_id, issue]]);
  const parentByChild = new Map<string, string>();
  const acquired: AcquiredIssue[] = [];
  const parentChild: MattParentChildRelation[] = [];
  const nativeChildrenByParent = new Map<string, readonly GitHubIssue[]>();
  let acquisitionComplete = true;
  for (let cursor = 0; cursor < pending.length; cursor += 1) {
    const currentIssue = pending[cursor];
    if (currentIssue === undefined) continue;
    const currentEndpoint = `${repositoryEndpoint}/issues/${currentIssue.number}`;
    const parentResponse = await acquire(options.transport, `${currentEndpoint}/parent`, observed);
    const parent =
      parentResponse.status === 200 ? githubIssueSchema.safeParse(parentResponse.body) : undefined;
    const parentIdentityValid =
      parent?.success === true &&
      parent.data.pull_request === undefined &&
      (parent.data.repository_url !== repositoryApiUrl(repository) ||
        hasCanonicalRepositoryLocation(repository, parent.data));
    const commentPages = await acquirePages(
      options.transport,
      `${currentEndpoint}/comments`,
      observed,
    );
    const dependencyPages = await acquirePages(
      options.transport,
      `${currentEndpoint}/dependencies/blocked_by`,
      observed,
    );
    const comments =
      commentPages.state !== "available"
        ? undefined
        : z.array(commentSchema).safeParse(commentPages.values);
    const dependencies =
      dependencyPages.state !== "available"
        ? undefined
        : z.array(githubIssueSchema).safeParse(dependencyPages.values);
    if (
      (parentResponse.status !== 200 &&
        parentResponse.status !== 404 &&
        parentResponse.status !== 410) ||
      (parentResponse.status === 200 && !parentIdentityValid) ||
      comments === undefined ||
      !comments.success ||
      (dependencyPages.state !== "unsupported" &&
        (dependencies === undefined || !dependencies.success))
    ) {
      acquisitionComplete = false;
      if (
        parentResponse.status !== 200 &&
        parentResponse.status !== 404 &&
        parentResponse.status !== 410
      ) {
        diagnostics.push(acquisitionFailureDiagnostic(parentResponse, `${currentEndpoint}/parent`));
      } else if (parentResponse.status === 200 && !parentIdentityValid) {
        diagnostics.push(
          diagnostic(
            "matt.github.parent.invalid",
            "format",
            `${currentEndpoint}/parent`,
            "GitHub native parent identity could not be decoded.",
          ),
        );
      }
      if (commentPages.state === "failed") {
        diagnostics.push(
          acquisitionFailureDiagnostic(commentPages.response, `${currentEndpoint}/comments`),
        );
      }
      if (dependencyPages.state === "failed") {
        diagnostics.push(
          acquisitionFailureDiagnostic(
            dependencyPages.response,
            `${currentEndpoint}/dependencies/blocked_by`,
          ),
        );
      }
      diagnostics.push(
        diagnostic(
          "matt.github.pagination.incomplete",
          "pagination",
          currentIssue.html_url,
          "Required GitHub parent, comments or dependency resources were not acquired and decoded completely.",
        ),
      );
    }
    const acquiredCurrent: AcquiredIssue = {
      issue: currentIssue,
      document: parseMarkdownDocument(currentIssue.body),
      comments: comments?.success === true ? comments.data : [],
      commentsCapability:
        commentPages.state === "available" && comments?.success === true
          ? "available"
          : commentPages.state === "unsupported"
            ? "unsupported"
            : "failed",
      dependencies: dependencies?.success === true ? dependencies.data : [],
      dependencyCapability:
        dependencyPages.state === "available" && dependencies?.success === true
          ? "available"
          : dependencyPages.state === "unsupported"
            ? "unsupported"
            : "failed",
      parentCapability:
        parentResponse.status === 200 && parentIdentityValid
          ? "available"
          : parentResponse.status === 404
            ? "absent"
            : parentResponse.status === 410
              ? "unsupported"
              : "failed",
      ...(parentIdentityValid && parent?.success === true ? { nativeParent: parent.data } : {}),
      externalAnchors: [],
      relationFacets: [],
    };
    acquired.push(acquiredCurrent);
    if (scope.rootKind === "standalone-request") continue;

    const childPages = await acquirePages(
      options.transport,
      `${currentEndpoint}/sub_issues`,
      observed,
    );
    const children =
      childPages.state !== "available"
        ? undefined
        : z.array(githubIssueSchema).safeParse(childPages.values);
    if (childPages.state === "unsupported") {
      if (
        scope.rootKind === "parent-issue" &&
        currentIssue.node_id === issue.node_id &&
        !currentIssue.labels.some((label) => label.name === "wayfinder:map")
      ) {
        acquisitionComplete = false;
        diagnostics.push(
          diagnostic(
            "matt.github.scope.fallback-unavailable",
            "contract",
            currentIssue.html_url,
            "Native hierarchy is unavailable and this parent root has no Matt contract-defined hierarchy fallback.",
          ),
        );
      }
      for (const childNumber of bodyChildNumbers(acquiredCurrent, repository)) {
        if (childNumber === currentIssue.number) {
          acquisitionComplete = false;
          diagnostics.push(
            diagnostic(
              "matt.github.scope.fallback-cycle",
              "identity",
              currentIssue.html_url,
              "Matt task-list fallback cannot make an issue its own child.",
            ),
          );
          continue;
        }
        const childEndpoint = `${repositoryEndpoint}/issues/${childNumber}`;
        const childResponse = await acquire(options.transport, childEndpoint, observed);
        const child = githubIssueSchema.safeParse(childResponse.body);
        if (
          childResponse.status !== 200 ||
          !child.success ||
          !isCanonicalSameRepositoryIssue(repository, child.data)
        ) {
          acquisitionComplete = false;
          diagnostics.push(
            diagnostic(
              "matt.github.scope.fallback-child",
              "acquisition",
              childEndpoint,
              "Matt task-list fallback child could not be acquired as one same-repository issue.",
            ),
          );
          continue;
        }
        const childDocument: AcquiredIssue = {
          issue: child.data,
          document: parseMarkdownDocument(child.data.body),
          comments: [],
          commentsCapability: "unsupported",
          dependencies: [],
          dependencyCapability: "failed",
          parentCapability: "unsupported",
          externalAnchors: [],
          relationFacets: [],
        };
        if (bodyParentNumber(childDocument) !== currentIssue.number) {
          acquisitionComplete = false;
          diagnostics.push(
            diagnostic(
              "matt.github.scope.fallback-parent",
              "identity",
              child.data.html_url,
              "Matt task-list fallback child does not confirm the same parent with Part of.",
            ),
          );
          continue;
        }
        const previousParent = parentByChild.get(child.data.node_id);
        if (wouldCreateParentCycle(child.data.node_id, currentIssue.node_id, parentByChild)) {
          acquisitionComplete = false;
          diagnostics.push(
            diagnostic(
              "matt.github.scope.hierarchy-cycle",
              "identity",
              child.data.html_url,
              "Matt fallback hierarchy contains a parent-child cycle.",
            ),
          );
          continue;
        }
        if (previousParent === currentIssue.node_id) {
          acquisitionComplete = false;
          diagnostics.push(
            diagnostic(
              "matt.github.scope.duplicate-child",
              "identity",
              child.data.html_url,
              "Matt fallback hierarchy repeats one child under the same parent.",
            ),
          );
          continue;
        }
        if (previousParent !== undefined && previousParent !== currentIssue.node_id) {
          acquisitionComplete = false;
          diagnostics.push(
            diagnostic(
              "matt.github.scope.ambiguous-parent",
              "identity",
              child.data.html_url,
              "Matt fallback child appears under more than one in-scope parent.",
            ),
          );
          continue;
        }
        parentByChild.set(child.data.node_id, currentIssue.node_id);
        parentChild.push({
          parent: issueReference(repository, currentIssue),
          child: issueReference(repository, child.data),
          evidence: "matt-body-fallback",
        });
        if (!discoveredByNode.has(child.data.node_id)) {
          discoveredByNode.set(child.data.node_id, child.data);
          pending.push(child.data);
        }
      }
      continue;
    }
    if (children === undefined || !children.success) {
      acquisitionComplete = false;
      if (childPages.state === "failed") {
        diagnostics.push(
          acquisitionFailureDiagnostic(childPages.response, `${currentEndpoint}/sub_issues`),
        );
      }
      diagnostics.push(
        diagnostic(
          "matt.github.scope.pagination",
          "pagination",
          currentIssue.html_url,
          "GitHub native sub-issues were not acquired and decoded completely.",
        ),
      );
      continue;
    }
    nativeChildrenByParent.set(currentIssue.node_id, children.data);
    for (const childSummary of children.data) {
      if (childSummary.repository_url !== repositoryApiUrl(repository)) {
        appendExternalRelationEvidence(
          acquiredCurrent,
          "native-external-child",
          childSummary.html_url,
          nativeRelationIdentity(childSummary),
        );
        continue;
      }
      if (childSummary.pull_request !== undefined) {
        acquisitionComplete = false;
        diagnostics.push(
          diagnostic(
            "matt.github.scope.invalid-child",
            "contract",
            childSummary.html_url,
            "Map and parent scope descendants must be GitHub issues.",
          ),
        );
        continue;
      }
      const previousParent = parentByChild.get(childSummary.node_id);
      if (wouldCreateParentCycle(childSummary.node_id, currentIssue.node_id, parentByChild)) {
        acquisitionComplete = false;
        diagnostics.push(
          diagnostic(
            "matt.github.scope.hierarchy-cycle",
            "identity",
            childSummary.html_url,
            "GitHub native hierarchy contains a parent-child cycle.",
          ),
        );
        continue;
      }
      if (previousParent === currentIssue.node_id) {
        acquisitionComplete = false;
        diagnostics.push(
          diagnostic(
            "matt.github.scope.duplicate-child",
            "identity",
            childSummary.html_url,
            "GitHub native hierarchy repeats one child under the same parent.",
          ),
        );
        continue;
      }
      if (previousParent !== undefined && previousParent !== currentIssue.node_id) {
        acquisitionComplete = false;
        diagnostics.push(
          diagnostic(
            "matt.github.scope.ambiguous-parent",
            "identity",
            childSummary.html_url,
            "GitHub child appears under more than one in-scope parent.",
          ),
        );
        continue;
      }
      parentByChild.set(childSummary.node_id, currentIssue.node_id);
      parentChild.push({
        parent: issueReference(repository, currentIssue),
        child: issueReference(repository, childSummary),
        evidence: "github-native",
      });
      if (discoveredByNode.has(childSummary.node_id)) continue;
      const childEndpoint = `${repositoryEndpoint}/issues/${childSummary.number}`;
      const childResponse = await acquire(options.transport, childEndpoint, observed);
      const child = githubIssueSchema.safeParse(childResponse.body);
      if (
        childResponse.status !== 200 ||
        !child.success ||
        child.data.id !== childSummary.id ||
        child.data.node_id !== childSummary.node_id ||
        child.data.number !== childSummary.number ||
        !isCanonicalSameRepositoryIssue(repository, child.data)
      ) {
        acquisitionComplete = false;
        diagnostics.push(
          diagnostic(
            "matt.github.scope.child-acquisition",
            "acquisition",
            childSummary.html_url,
            "GitHub native child identity and full issue body could not be acquired consistently.",
          ),
        );
        continue;
      }
      discoveredByNode.set(child.data.node_id, child.data);
      pending.push(child.data);
    }
  }

  const acquiredByNode = new Map(acquired.map((entry) => [entry.issue.node_id, entry]));
  const byNumber = new Map(acquired.map((entry) => [entry.issue.number, entry]));
  for (const entry of acquired) {
    const nativeParent = entry.nativeParent;
    if (nativeParent !== undefined) {
      const parentInScope = acquiredByNode.get(nativeParent.node_id);
      const parentIdentity = nativeRelationIdentity(nativeParent);
      entry.relationFacets.push({
        key: "native-parent",
        values: [parentIdentity],
      });
      const expectedParent = parentByChild.get(entry.issue.node_id);
      if (parentInScope === undefined) {
        entry.externalAnchors.push({ kind: "external", target: nativeParent.html_url });
      }
      if (
        (expectedParent !== undefined && expectedParent !== nativeParent.node_id) ||
        (expectedParent === undefined && parentInScope !== undefined)
      ) {
        acquisitionComplete = false;
        entry.relationFacets.push({
          key: "relation-conflict:native-parent",
          values: [parentIdentity],
        });
        diagnostics.push(
          diagnostic(
            "matt.github.relation.native-parent-conflict",
            "identity",
            entry.issue.html_url,
            "GitHub native parent disagrees with the in-scope parent-child traversal.",
          ),
        );
      }
    }
    const fallbackParentNumber = bodyParentNumber(entry);
    if (fallbackParentNumber !== undefined && entry.parentCapability !== "failed") {
      const fallbackParent = byNumber.get(fallbackParentNumber);
      if (fallbackParent === undefined) {
        const target = canonicalIssueUrlForNumber(repository, fallbackParentNumber);
        appendExternalRelationEvidence(
          entry,
          "fallback-external-parent",
          target,
          fallbackRelationIdentity(repository, fallbackParentNumber),
        );
      }
      if (entry.parentCapability !== "unsupported") {
        const nativeMatchesFallback =
          entry.parentCapability === "available" &&
          nativeParent !== undefined &&
          nativeParent.repository_url === repositoryApiUrl(repository) &&
          nativeParent.number === fallbackParentNumber;
        if (!nativeMatchesFallback) {
          acquisitionComplete = false;
          diagnostics.push(
            diagnostic(
              "matt.github.relation.native-fallback-conflict",
              "identity",
              entry.issue.html_url,
              "GitHub native parent and Matt body fallback disagree.",
            ),
          );
          appendRelationFacet(
            entry,
            "relation-conflict:parent-fallback",
            fallbackParent === undefined
              ? fallbackRelationIdentity(repository, fallbackParentNumber)
              : String(issueReference(repository, fallbackParent.issue)),
          );
        }
      }
    }
    for (const dependency of entry.dependencies) {
      if (!acquiredByNode.has(dependency.node_id)) {
        appendExternalRelationEvidence(
          entry,
          "native-external-blocked-by",
          dependency.html_url,
          nativeRelationIdentity(dependency),
        );
      }
    }
  }
  for (const entry of acquired) {
    const nativeChildren = nativeChildrenByParent.get(entry.issue.node_id);
    if (nativeChildren === undefined) continue;
    const fallbackNumbers = bodyChildNumbers(entry, repository);
    if (fallbackNumbers.length === 0) continue;
    for (const number of fallbackNumbers) {
      const child = byNumber.get(number);
      if (child === undefined) {
        const target = canonicalIssueUrlForNumber(repository, number);
        appendExternalRelationEvidence(
          entry,
          "fallback-external-child",
          target,
          fallbackRelationIdentity(repository, number),
        );
      }
    }
    const nativeTargets = nativeChildren.map((child) => child.html_url).sort();
    const fallbackTargets = fallbackNumbers
      .map((number) => canonicalIssueUrlForNumber(repository, number))
      .sort();
    if (nativeTargets.join("\n") === fallbackTargets.join("\n")) continue;
    diagnostics.push(
      diagnostic(
        "matt.github.relation.native-fallback-conflict",
        "identity",
        entry.issue.html_url,
        "GitHub native parent-child relations and Matt body fallback disagree.",
      ),
    );
    for (const number of fallbackNumbers) {
      const child = byNumber.get(number);
      appendRelationFacet(
        entry,
        "relation-conflict:parent-child-fallback",
        child === undefined
          ? fallbackRelationIdentity(repository, number)
          : String(issueReference(repository, child.issue)),
      );
    }
  }
  const blockedBy = collectBlockedByRelations(acquired, repository, diagnostics);
  const mapCandidates = acquired.filter((entry) =>
    entry.issue.labels.some((label) => label.name === "wayfinder:map"),
  );
  if (mapCandidates.length > 1) {
    diagnostics.push(
      diagnostic(
        "matt.github.role.ambiguous-map",
        "format",
        issue.html_url,
        "Bound GitHub scope contains more than one Matt Map role.",
      ),
    );
  }
  for (const candidate of mapCandidates) {
    const mapSignals = candidate.issue.labels
      .map((label) => label.name)
      .filter((label) => label.startsWith("wayfinder:"));
    if (mapSignals.length !== 1 || mapSignals[0] !== "wayfinder:map") {
      diagnostics.push(
        diagnostic(
          "matt.github.role.ambiguous-map",
          "format",
          candidate.issue.html_url,
          "Map issue has unknown or conflicting Wayfinder role evidence.",
        ),
      );
    }
  }
  const mapProjection =
    mapCandidates.length === 1 && mapCandidates[0] !== undefined
      ? decodeMap(mapCandidates[0], repository, byNumber, diagnostics)
      : undefined;
  if (scope.rootKind === "wayfinder-map" && mapProjection === undefined) {
    diagnostics.push(
      diagnostic(
        "matt.github.role.map-incomplete",
        "format",
        issue.html_url,
        "Bound Wayfinder Map root lacks its complete canonical body.",
      ),
    );
  }

  const wayfinderTickets: MattWayfinderTicket[] = [];
  const deliveryTickets: MattDeliveryTicket[] = [];
  const incomingIssues: MattIncomingIssue[] = [];
  const specCandidates: MattSpec[] = [];
  for (const entry of acquired) {
    if (mapCandidates.includes(entry)) continue;
    const wayfinderLabels = entry.issue.labels.filter((label) =>
      label.name.startsWith("wayfinder:"),
    );
    if (wayfinderLabels.length > 0) {
      const wayfinder = decodeWayfinder(entry, repository, mapProjection, diagnostics);
      if (wayfinder === undefined) {
        diagnostics.push(
          diagnostic(
            "matt.github.role.ambiguous-wayfinder",
            "format",
            entry.issue.html_url,
            "Wayfinder labels conflict or the canonical Question body is incomplete.",
          ),
        );
      } else {
        wayfinderTickets.push(wayfinder);
      }
      continue;
    }
    const spec = decodeSpec(entry, repository, vocabulary, diagnostics);
    const delivery = decodeDelivery(entry, repository);
    const specStructure = MATT_SPEC_SECTION_DEFINITIONS.flatMap((definition) =>
      [definition.title, ...definition.aliases].map((title) =>
        queryMarkdownSection(entry.document, { title }),
      ),
    );
    const deliveryStructure = [
      queryMarkdownSection(entry.document, { title: "What to build" }),
      queryMarkdownSection(entry.document, { title: "Acceptance criteria" }),
    ];
    const hasSpecSignal = specStructure.some((result) => result.state !== "absent");
    const hasDeliverySignal = deliveryStructure.some((result) => result.state !== "absent");
    const ambiguousStructure =
      [...specStructure, ...deliveryStructure].some((result) => result.state === "ambiguous") ||
      (hasSpecSignal && spec === undefined) ||
      (hasDeliverySignal && delivery === undefined);
    if (ambiguousStructure) {
      diagnostics.push(
        diagnostic(
          "matt.github.role.ambiguous-structure",
          "format",
          entry.issue.html_url,
          "GitHub issue contains partial or ambiguous canonical Spec or Delivery structure.",
        ),
      );
      continue;
    }
    if (spec !== undefined && delivery !== undefined) {
      diagnostics.push(
        diagnostic(
          "matt.github.role.conflict",
          "format",
          entry.issue.html_url,
          "GitHub issue matches both canonical Spec and Delivery body roles.",
        ),
      );
      continue;
    }
    if (spec !== undefined) {
      specCandidates.push(spec);
      continue;
    }
    if (delivery !== undefined) {
      deliveryTickets.push(delivery);
      continue;
    }
    incomingIssues.push(incomingIssueFor(repository, entry, vocabulary, diagnostics));
  }
  if (specCandidates.length > 1) {
    diagnostics.push(
      diagnostic(
        "matt.github.role.ambiguous-spec",
        "format",
        issue.html_url,
        "Bound GitHub scope contains more than one complete canonical Spec body.",
      ),
    );
  }
  const specProjection = specCandidates.length === 1 ? specCandidates[0] : undefined;
  const projectedReferences = new Set([
    ...(mapProjection === undefined ? [] : [mapProjection.ref]),
    ...(specProjection === undefined ? [] : [specProjection.ref]),
    ...wayfinderTickets.map((ticket) => ticket.ref),
    ...deliveryTickets.map((ticket) => ticket.ref),
    ...incomingIssues.map((incoming) => incoming.ref),
  ]);
  const projection: MattScopeProjection = {
    ...(mapProjection === undefined ? {} : { map: mapProjection }),
    ...(specProjection === undefined ? {} : { spec: specProjection }),
    wayfinderTickets,
    deliveryTickets,
    incomingIssues,
    structuralOrder: acquired
      .map((entry) => issueReference(repository, entry.issue))
      .filter((reference) => projectedReferences.has(reference)),
    graph: { parentChild, blockedBy },
  };
  const finalization = await finalizeObservedGeneration({
    transport: options.transport,
    observed,
    fullRetryCount,
    target: issue.html_url,
    clock: options.clock ?? (() => new Date()),
  });
  if (finalization.retryRequired) {
    return captureGitHubScope(options, binding, 1);
  }
  diagnostics.push(...finalization.diagnostics);
  if (finalization.revalidation.state === "failed") acquisitionComplete = false;
  const current = finalization.revalidation.state === "stable";
  const freshnessCurrent = current && acquisitionComplete;
  const blocking = diagnostics.some((item) => item.impact === "blocking");
  return createProviderScopeObservation({
    provider: MATT_SKILLS_V1_PROVIDER_ID,
    binding,
    state: blocking ? "partial" : "available",
    freshness: freshnessForObservedGeneration({
      finalization,
      observed,
      capturedAt,
      fullRetryCount,
      assessment: freshnessCurrent ? "current" : "undetermined",
      acquisitionComplete,
      blocking,
      extraEvidence: [
        ...acquired.map((entry) => ({
          kind: "object-updated-at",
          value: `${entry.issue.node_id}|${entry.issue.updated_at}`,
        })),
      ],
    }),
    coverage: {
      assessment: blocking ? "incomplete" : "complete",
      dimensions: [
        { key: "contract", state: "covered" },
        {
          key: "vocabulary",
          state: vocabulary?.complete === true ? "covered" : "gap",
        },
        {
          key: "scope-membership",
          state: acquisitionComplete ? "covered" : "gap",
        },
        {
          key: "roles-and-relations",
          state: blocking ? "gap" : "covered",
        },
        {
          key: "freshness",
          state: freshnessCurrent ? "covered" : "gap",
        },
      ],
    },
    completion: blocking || !freshnessCurrent ? "undetermined" : "incomplete",
    diagnostics,
    projection,
  });
};

const githubProjectedObjects = (
  projection: MattScopeProjection,
): readonly (
  | MattMap
  | MattSpec
  | MattWayfinderTicket
  | MattDeliveryTicket
  | MattIncomingIssue
)[] => [
  ...(projection.map === undefined ? [] : [projection.map]),
  ...(projection.spec === undefined ? [] : [projection.spec]),
  ...projection.wayfinderTickets,
  ...projection.deliveryTickets,
  ...projection.incomingIssues,
];

const githubScopeCompletion = (projection: MattScopeProjection): "complete" | "incomplete" => {
  if (projection.map !== undefined && projection.map.lifecycle.state !== "resolved") {
    return "incomplete";
  }
  if (projection.map !== undefined && projection.map.fog.length > 0) return "incomplete";
  if (
    projection.spec !== undefined &&
    projection.spec.lifecycle.state !== "ready-for-agent" &&
    projection.spec.lifecycle.state !== "superseded"
  ) {
    return "incomplete";
  }
  if (projection.wayfinderTickets.some((ticket) => ticket.lifecycle.state === "open")) {
    return "incomplete";
  }
  if (projection.deliveryTickets.some((ticket) => ticket.lifecycle.state !== "completed")) {
    return "incomplete";
  }
  if (projection.incomingIssues.some((issue) => issue.classification.state !== "wontfix")) {
    return "incomplete";
  }
  return "complete";
};

const githubIssueNumberFromReference = (
  reference: string,
  repository: GitHubRepository,
  projection: MattScopeProjection,
): number | undefined => {
  const existing = githubProjectedObjects(projection).find(
    (object) =>
      object.ref === reference ||
      (object.native.kind === "github" &&
        (object.native.identity.url === reference ||
          String(object.native.identity.number) === reference ||
          `#${object.native.identity.number}` === reference)),
  );
  if (existing?.native.kind === "github") return existing.native.identity.number;
  if (!URL.canParse(reference)) return undefined;
  const url = new URL(reference);
  if (
    url.protocol !== "https:" ||
    url.hostname !== "github.com" ||
    url.username.length > 0 ||
    url.password.length > 0
  ) {
    return undefined;
  }
  const segments = url.pathname.split("/").filter((segment) => segment.length > 0);
  if (
    segments.length !== 4 ||
    segments[0] !== repository.owner.login ||
    segments[1] !== repository.name ||
    (segments[2] !== "issues" && segments[2] !== "pull")
  ) {
    return undefined;
  }
  const number = Number(segments[3]);
  return Number.isSafeInteger(number) && number > 0 ? number : undefined;
};

const reconcileGitHubScope = async (
  options: ResolvedGitHubMattProviderOptions,
  input: NativeWorkReconciliationInput<"matt-skills/v1", MattScopeProjection>,
  retryCount = 0,
): Promise<MattSkillsV1ProviderObservation> => {
  const capturedAt = (options.clock ?? (() => new Date()))().toISOString();
  const diagnostics: ProviderDiagnostic[] = [];
  const priorProjection: MattScopeProjection = input.prior?.projection ?? {
    wayfinderTickets: [],
    deliveryTickets: [],
    incomingIssues: [],
    structuralOrder: [],
    graph: { parentChild: [], blockedBy: [] },
  };
  const partialBasis =
    input.prior === undefined ||
    !input.prior.coverage.dimensions.some(
      (dimension) =>
        (dimension.key === "scope-membership" || dimension.key === "scope-membership-basis") &&
        dimension.state === "covered",
    );
  let root: string;
  try {
    root = await resolveRepositoryRoot(options.repoRoot);
  } catch {
    return captureWithoutProjection({
      binding: input.binding,
      capturedAt,
      state: "invalid",
      freshness: "undetermined",
      diagnostics: [
        diagnostic(
          "matt.github.repository.unavailable",
          "source",
          options.repoRoot,
          "Repository root is unavailable while reconciling affected GitHub native work.",
        ),
      ],
    });
  }
  const contractLocator = normalizeLocator(options.contractLocator);
  const triageLocator = normalizeLocator(
    options.triageLocator ?? posix.join(posix.dirname(contractLocator), "triage-labels.md"),
  );
  const contractSource = await readInterpretationDocument(options, root, contractLocator);
  const contract =
    contractSource === undefined ? undefined : validateMattSkillsV1Contract(contractSource);
  if (
    contractSource === undefined ||
    contract?.state !== "supported" ||
    contract.driver !== "github-issues"
  ) {
    return captureWithoutProjection({
      binding: input.binding,
      capturedAt,
      state: "invalid",
      freshness: "undetermined",
      diagnostics: [
        diagnostic(
          "matt.github.contract.unsupported",
          "contract",
          contractLocator,
          "Confirmed repository contract does not select matt-skills/v1 GitHub Issues.",
        ),
      ],
    });
  }
  const triageSource = await readInterpretationDocument(options, root, triageLocator);
  const vocabulary =
    triageSource === undefined
      ? undefined
      : parseTriageVocabulary(triageSource, triageLocator, diagnostics);
  if (triageSource === undefined) {
    diagnostics.push(
      diagnostic(
        "matt.github.mapping.unavailable",
        "mapping",
        triageLocator,
        "Repository triage vocabulary could not be read.",
      ),
    );
  }
  const scope = decodeGitHubMattNativeScope(input.binding.nativeScope);
  if (scope === undefined) {
    return captureWithoutProjection({
      binding: input.binding,
      capturedAt,
      state: "invalid",
      freshness: "undetermined",
      diagnostics: [
        ...diagnostics,
        diagnostic(
          "matt.github.scope.invalid",
          "identity",
          input.binding.nativeScope,
          "GitHub native scope identity is malformed or uses an unsupported host.",
        ),
      ],
    });
  }

  const observed: ObservedResponse[] = [];
  const repositoryEndpoint = `repos/${scope.repository.owner}/${scope.repository.name}`;
  const repositoryResponse = await acquire(options.transport, repositoryEndpoint, observed);
  const repositoryResult = githubRepositorySchema.safeParse(repositoryResponse.body);
  if (repositoryResponse.status !== 200 || !repositoryResult.success) {
    return captureWithoutProjection({
      binding: input.binding,
      capturedAt,
      state: "invalid",
      freshness: "undetermined",
      diagnostics: [
        ...diagnostics,
        acquisitionFailureDiagnostic(repositoryResponse, repositoryEndpoint),
      ],
    });
  }
  const repository = repositoryResult.data;
  if (
    repository.id !== scope.repository.databaseId ||
    repository.node_id !== scope.repository.nodeId ||
    repository.owner.login !== scope.repository.owner ||
    repository.name !== scope.repository.name ||
    repository.full_name !== `${scope.repository.owner}/${scope.repository.name}`
  ) {
    diagnostics.push(
      diagnostic(
        "matt.github.identity.rebind-required",
        "identity",
        repository.html_url,
        "GitHub repository locator and native identity differ; explicit rebind is required.",
      ),
    );
  }

  const readReferences = affectedReadReferences(input.affected);
  const issueNumbers = new Set<number>();
  for (const reference of readReferences) {
    const number = githubIssueNumberFromReference(reference, repository, priorProjection);
    if (number === undefined) {
      diagnostics.push(
        diagnostic(
          "matt.github.reconciliation.reference-invalid",
          "identity",
          repository.html_url,
          "Affected GitHub native reference does not resolve inside the bound repository.",
        ),
      );
    } else {
      issueNumbers.add(number);
    }
  }
  const priorProjectedNumbers = new Set(
    githubProjectedObjects(priorProjection).flatMap((object) =>
      object.native.kind === "github" ? [object.native.identity.number] : [],
    ),
  );
  const relationEndpointIsInScope = (number: number): boolean =>
    issueNumbers.has(number) || priorProjectedNumbers.has(number);

  const acquired: AcquiredIssue[] = [];
  const parentChild: MattParentChildRelation[] = [];
  const blockedBy: MattBlockedByRelation[] = [];
  let acquisitionComplete = true;
  for (const number of [...issueNumbers].sort((left, right) => left - right)) {
    const issueEndpoint = `${repositoryEndpoint}/issues/${number}`;
    const issueResponse = await acquire(options.transport, issueEndpoint, observed);
    const issueResult = githubIssueSchema.safeParse(issueResponse.body);
    if (
      issueResponse.status !== 200 ||
      !issueResult.success ||
      !isCanonicalSameRepositoryIssue(repository, issueResult.data)
    ) {
      acquisitionComplete = false;
      diagnostics.push(
        issueResponse.status === 200
          ? diagnostic(
              "matt.github.reconciliation.subject-invalid",
              "identity",
              issueEndpoint,
              "Affected GitHub subject identity or repository location is invalid.",
            )
          : acquisitionFailureDiagnostic(issueResponse, issueEndpoint),
      );
      continue;
    }
    const issue = issueResult.data;
    const currentEndpoint = `${repositoryEndpoint}/issues/${issue.number}`;
    const parentResponse = await acquire(options.transport, `${currentEndpoint}/parent`, observed);
    const commentPages = await acquirePages(
      options.transport,
      `${currentEndpoint}/comments`,
      observed,
    );
    const dependencyPages = await acquirePages(
      options.transport,
      `${currentEndpoint}/dependencies/blocked_by`,
      observed,
    );
    const childPages = await acquirePages(
      options.transport,
      `${currentEndpoint}/sub_issues`,
      observed,
    );
    const parent =
      parentResponse.status === 200 ? githubIssueSchema.safeParse(parentResponse.body) : undefined;
    const comments =
      commentPages.state === "available"
        ? z.array(commentSchema).safeParse(commentPages.values)
        : undefined;
    const dependencies =
      dependencyPages.state === "available"
        ? z.array(githubIssueSchema).safeParse(dependencyPages.values)
        : undefined;
    const children =
      childPages.state === "available"
        ? z.array(githubIssueSchema).safeParse(childPages.values)
        : undefined;
    const parentIdentityValid =
      parent?.success === true &&
      parent.data.pull_request === undefined &&
      (parent.data.repository_url !== repositoryApiUrl(repository) ||
        hasCanonicalRepositoryLocation(repository, parent.data));
    const relationReadsComplete =
      (parentResponse.status === 200
        ? parentIdentityValid
        : parentResponse.status === 404 || parentResponse.status === 410) &&
      (commentPages.state === "unsupported" || comments?.success === true) &&
      (dependencyPages.state === "unsupported" || dependencies?.success === true) &&
      (childPages.state === "unsupported" || children?.success === true);
    if (!relationReadsComplete) {
      acquisitionComplete = false;
      diagnostics.push(
        diagnostic(
          "matt.github.reconciliation.relations-incomplete",
          "pagination",
          issue.html_url,
          "Affected GitHub subject relations or comments were not acquired completely.",
        ),
      );
    }
    const entry: AcquiredIssue = {
      issue,
      document: parseMarkdownDocument(issue.body),
      comments: comments?.success === true ? comments.data : [],
      commentsCapability:
        comments?.success === true
          ? "available"
          : commentPages.state === "unsupported"
            ? "unsupported"
            : "failed",
      dependencies: dependencies?.success === true ? dependencies.data : [],
      dependencyCapability:
        dependencies?.success === true
          ? "available"
          : dependencyPages.state === "unsupported"
            ? "unsupported"
            : "failed",
      parentCapability:
        parentResponse.status === 200 && parentIdentityValid
          ? "available"
          : parentResponse.status === 404
            ? "absent"
            : parentResponse.status === 410
              ? "unsupported"
              : "failed",
      ...(parentIdentityValid && parent?.success === true ? { nativeParent: parent.data } : {}),
      externalAnchors: [],
      relationFacets: [],
    };
    acquired.push(entry);
    if (parentIdentityValid && parent?.success === true) {
      if (
        parent.data.repository_url === repositoryApiUrl(repository) &&
        relationEndpointIsInScope(parent.data.number)
      ) {
        parentChild.push({
          parent: issueReference(repository, parent.data),
          child: issueReference(repository, issue),
          evidence: "github-native",
        });
      } else {
        appendExternalRelationEvidence(
          entry,
          "native-external-parent",
          parent.data.html_url,
          nativeRelationIdentity(parent.data),
        );
      }
    }
    if (children?.success === true) {
      for (const child of children.data) {
        if (
          child.repository_url === repositoryApiUrl(repository) &&
          relationEndpointIsInScope(child.number)
        ) {
          parentChild.push({
            parent: issueReference(repository, issue),
            child: issueReference(repository, child),
            evidence: "github-native",
          });
        } else {
          appendExternalRelationEvidence(
            entry,
            "native-external-child",
            child.html_url,
            nativeRelationIdentity(child),
          );
        }
      }
    }
    if (dependencies?.success === true) {
      for (const dependency of dependencies.data) {
        if (
          dependency.repository_url === repositoryApiUrl(repository) &&
          relationEndpointIsInScope(dependency.number)
        ) {
          blockedBy.push({
            blocked: issueReference(repository, issue),
            blocker: issueReference(repository, dependency),
            evidence: "github-native",
          });
        } else {
          appendExternalRelationEvidence(
            entry,
            "native-external-blocked-by",
            dependency.html_url,
            nativeRelationIdentity(dependency),
          );
        }
      }
    }
  }

  const priorByNumber = new Map(
    githubProjectedObjects(priorProjection).flatMap((object) =>
      object.native.kind === "github" ? [[object.native.identity.number, object] as const] : [],
    ),
  );
  const byNumber = new Map<number, AcquiredIssue>(
    acquired.map((entry) => [entry.issue.number, entry]),
  );
  for (const [number, object] of priorByNumber) {
    if (byNumber.has(number) || object.native.kind !== "github") continue;
    byNumber.set(number, {
      issue: {
        id: object.native.identity.objectDatabaseId,
        node_id: object.native.identity.objectNodeId,
        number,
        title: object.title,
        body: "",
        state: object.native.trackerClosure.state === "open" ? "open" : "closed",
        state_reason: null,
        created_at:
          object.native.createdAt.availability === "available"
            ? object.native.createdAt.value
            : capturedAt,
        updated_at:
          object.native.lastUpdated.availability === "available"
            ? object.native.lastUpdated.value
            : capturedAt,
        closed_at: null,
        html_url: object.native.identity.url,
        repository_url: repositoryApiUrl(repository),
        labels: [],
        assignees: [],
        user: {
          login: "bearing-reconciliation-basis",
          id: "bearing-reconciliation-basis",
          node_id: "bearing-reconciliation-basis",
        },
        author_association: "NONE",
      },
      document: parseMarkdownDocument(""),
      comments: [],
      commentsCapability: "unsupported",
      dependencies: [],
      dependencyCapability: "unsupported",
      parentCapability: "unsupported",
      externalAnchors: [],
      relationFacets: [],
    });
  }

  const targetedRefs = new Set(acquired.map((entry) => issueReference(repository, entry.issue)));
  const mapEntry = acquired.find((entry) =>
    entry.issue.labels.some((label) => label.name === "wayfinder:map"),
  );
  const mapProjection =
    mapEntry === undefined
      ? priorProjection.map
      : decodeMap(mapEntry, repository, byNumber, diagnostics);
  const changedWayfinder: MattWayfinderTicket[] = [];
  const changedDelivery: MattDeliveryTicket[] = [];
  const changedIncoming: MattIncomingIssue[] = [];
  let changedSpec: MattSpec | undefined;
  for (const entry of acquired) {
    if (entry === mapEntry) continue;
    if (entry.issue.labels.some((label) => label.name.startsWith("wayfinder:"))) {
      const ticket = decodeWayfinder(entry, repository, mapProjection, diagnostics);
      if (ticket === undefined) {
        diagnostics.push(
          diagnostic(
            "matt.github.role.ambiguous-wayfinder",
            "format",
            entry.issue.html_url,
            "Affected GitHub issue has incomplete or conflicting Wayfinder role evidence.",
          ),
        );
      } else {
        changedWayfinder.push(ticket);
      }
      continue;
    }
    const spec = decodeSpec(entry, repository, vocabulary, diagnostics);
    const delivery = decodeDelivery(entry, repository);
    if (spec !== undefined && delivery !== undefined) {
      diagnostics.push(
        diagnostic(
          "matt.github.role.conflict",
          "format",
          entry.issue.html_url,
          "Affected GitHub issue matches both canonical Spec and Delivery roles.",
        ),
      );
    } else if (spec !== undefined) {
      changedSpec = spec;
    } else if (delivery !== undefined) {
      changedDelivery.push(delivery);
    } else {
      changedIncoming.push(incomingIssueFor(repository, entry, vocabulary, diagnostics));
    }
  }
  const mergeChanged = <Value extends { ref: MattObjectReference }>(
    prior: readonly Value[],
    changed: readonly Value[],
  ): Value[] => {
    const changedByReference = new Map(changed.map((value) => [value.ref, value]));
    const priorReferences = new Set(prior.map((value) => value.ref));
    return [
      ...prior.flatMap((value) => {
        if (!targetedRefs.has(value.ref)) return [value];
        const replacement = changedByReference.get(value.ref);
        return replacement === undefined ? [] : [replacement];
      }),
      ...changed.filter((value) => !priorReferences.has(value.ref)),
    ];
  };
  const wayfinderTickets = mergeChanged(priorProjection.wayfinderTickets, changedWayfinder);
  const deliveryTickets = mergeChanged(priorProjection.deliveryTickets, changedDelivery);
  const incomingIssues = mergeChanged(priorProjection.incomingIssues, changedIncoming);
  const specProjection =
    changedSpec ??
    (priorProjection.spec !== undefined && targetedRefs.has(priorProjection.spec.ref)
      ? undefined
      : priorProjection.spec);
  const touchedRelationRefs = targetedRefs;
  const retainedParentChild = priorProjection.graph.parentChild.filter(
    (relation) =>
      !touchedRelationRefs.has(relation.parent) && !touchedRelationRefs.has(relation.child),
  );
  const retainedBlockedBy = priorProjection.graph.blockedBy.filter(
    (relation) =>
      !touchedRelationRefs.has(relation.blocked) && !touchedRelationRefs.has(relation.blocker),
  );
  const allObjects = [
    ...(mapProjection === undefined ? [] : [mapProjection]),
    ...(specProjection === undefined ? [] : [specProjection]),
    ...wayfinderTickets,
    ...deliveryTickets,
    ...incomingIssues,
  ];
  const objectRefs = new Set(allObjects.map((object) => object.ref));
  const priorStructuralReferences = new Set(priorProjection.structuralOrder);
  const structuralOrder = [
    ...priorProjection.structuralOrder.filter((reference) => objectRefs.has(reference)),
    ...acquired
      .map((entry) => issueReference(repository, entry.issue))
      .filter(
        (reference) => objectRefs.has(reference) && !priorStructuralReferences.has(reference),
      ),
  ];
  const projection: MattScopeProjection = {
    ...(mapProjection === undefined ? {} : { map: mapProjection }),
    ...(specProjection === undefined ? {} : { spec: specProjection }),
    wayfinderTickets,
    deliveryTickets,
    incomingIssues,
    structuralOrder: [...new Set(structuralOrder)],
    graph: {
      parentChild: [
        ...new Map(
          [...retainedParentChild, ...parentChild].map((relation) => [
            `${relation.parent}\0${relation.child}`,
            relation,
          ]),
        ).values(),
      ],
      blockedBy: [
        ...new Map(
          [...retainedBlockedBy, ...blockedBy].map((relation) => [
            `${relation.blocked}\0${relation.blocker}`,
            relation,
          ]),
        ).values(),
      ],
    },
  };

  const finalization = await finalizeObservedGeneration({
    transport: options.transport,
    observed,
    fullRetryCount: retryCount,
    target: repository.html_url,
    clock: options.clock ?? (() => new Date()),
  });
  if (finalization.retryRequired) {
    return reconcileGitHubScope(options, input, 1);
  }
  diagnostics.push(...finalization.diagnostics);
  if (finalization.revalidation.state !== "stable") acquisitionComplete = false;
  const blocking = diagnostics.some((item) => item.impact === "blocking");
  const current = acquisitionComplete && !blocking;
  const state = partialBasis || blocking ? "partial" : "available";
  const coverageComplete = !partialBasis && current;
  return createProviderScopeObservation({
    provider: MATT_SKILLS_V1_PROVIDER_ID,
    binding: input.binding,
    state,
    freshness: freshnessForObservedGeneration({
      finalization,
      observed,
      capturedAt,
      fullRetryCount: retryCount,
      assessment: current ? "current" : "undetermined",
      acquisitionComplete,
      blocking,
      extraEvidence: [
        ...(input.prior === undefined
          ? []
          : [{ kind: "reconciliation-basis", value: input.prior.id }]),
        { kind: "affected-reference-count", value: String(readReferences.length) },
        ...acquired.map((entry) => ({
          kind: "object-updated-at",
          value: `${entry.issue.node_id}|${entry.issue.updated_at}`,
        })),
      ],
    }),
    coverage: {
      assessment: coverageComplete ? "complete" : "incomplete",
      dimensions: [
        { key: "contract", state: "covered" },
        { key: "vocabulary", state: vocabulary?.complete === true ? "covered" : "gap" },
        {
          key: "affected-subjects-and-relations",
          state: current ? "covered" : "gap",
        },
        {
          key: "scope-membership-basis",
          state: partialBasis ? "excluded" : "covered",
          ...(partialBasis
            ? { detail: "No prior full-scope observation was available; completion is excluded." }
            : {}),
        },
      ],
    },
    completion:
      coverageComplete && state === "available"
        ? githubScopeCompletion(projection)
        : "undetermined",
    diagnostics: [
      ...diagnostics,
      ...(partialBasis
        ? [
            {
              code: "matt.github.reconciliation.partial-basis",
              class: "acquisition" as const,
              impact: "non-blocking" as const,
              target: repository.html_url,
              message:
                "Targeted detail was observed without a prior full-scope basis; completion remains unavailable.",
            },
          ]
        : []),
    ],
    projection,
  });
};

export const createGitHubMattProvider = (
  options: GitHubMattProviderOptions,
): MattSkillsV1Provider => ({
  id: MATT_SKILLS_V1_PROVIDER_ID,
  capture: (binding) =>
    captureGitHubScope(
      {
        ...options,
        transport: options.transport ?? createGhCliGitHubReadTransport(),
      },
      binding,
    ),
  reconcile: (input) =>
    reconcileGitHubScope(
      {
        ...options,
        transport: options.transport ?? createGhCliGitHubReadTransport(),
      },
      input,
    ),
});
