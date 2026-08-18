import { createHash, timingSafeEqual } from "node:crypto";
import { chmod, lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import {
  createLiveJourneyObservation,
  readGeneratedEvidenceFile,
  verifyLiveJourneyObservation,
} from "./live-journey-matrix";
import { sha256Bytes } from "./release-digest";

const fail = (message: string): never => {
  throw new Error(message);
};

const githubBrokerScopeKeyPattern = /^bearing-live-[a-z0-9-]+-(?:[0-9a-f]{20}|[0-9a-f]{64})$/u;

const evidencePointerSchema = z
  .string()
  .min(1)
  .refine((value) => !value.startsWith("/") && !value.split(/[\\/]/u).includes(".."));

const digestText = (value: string): string =>
  createHash("sha256").update(value, "utf8").digest("hex");

const canonicalDigest = (value: unknown): string => digestText(`${JSON.stringify(value)}\n`);

const repositorySlugSchema = z
  .string()
  .regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u, "GitHub repository must use owner/name.");

export const parseGitHubRepositorySlug = (value: string) => {
  const slug = repositorySlugSchema.parse(value);
  const [owner, name] = slug.split("/") as [string, string];
  return Object.freeze({ owner, name, slug });
};

const permissionSchema = z.enum(["ADMIN", "MAINTAIN", "WRITE", "TRIAGE", "READ"]);
const repositoryAccessSchema = z.object({
  id: z.string().min(1),
  nameWithOwner: repositorySlugSchema,
  isPrivate: z.boolean(),
  viewerPermission: permissionSchema,
  hasIssuesEnabled: z.boolean(),
  isArchived: z.boolean().optional(),
});

const githubJourneyRepositoryConfigurationSchema = z.object({
  lifecycle: z
    .object({ state: z.literal("active"), removalRequired: z.literal(false) })
    .passthrough(),
  currentSelections: z.object({
    surfaces: z.tuple([z.literal("agent-skills")]),
    provider: z.object({
      key: z.literal("matt-skills/v1"),
      contractLocator: z.literal("docs/agents/issue-tracker.md"),
    }),
    executorProfiles: z.tuple([]),
  }),
  installedCapabilityEvidence: z.object({
    managedPointers: z.object({
      "agent-skills": z.literal("present"),
      claude: z.literal("absent"),
    }),
  }),
  pathSafety: z.object({ safe: z.literal(true) }).passthrough(),
});

export const validateGitHubJourneyRepositoryConfiguration = (input: unknown) => {
  const result = githubJourneyRepositoryConfigurationSchema.safeParse(input);
  if (!result.success) {
    fail("GitHub Validation Repository requires an exact candidate configuration baseline.");
  }
  return result.data;
};

export const validateGitHubRepositoryAccess = (input: unknown) => {
  const repository = repositoryAccessSchema.parse(input);
  if (!repository.isPrivate) fail("GitHub Validation Repository must be private.");
  if (!repository.hasIssuesEnabled) fail("GitHub Validation Repository must have Issues enabled.");
  if (repository.isArchived === true) fail("GitHub Validation Repository must not be archived.");
  if (!["ADMIN", "MAINTAIN", "WRITE", "TRIAGE"].includes(repository.viewerPermission)) {
    fail("GitHub Validation Repository access must permit issue delivery.");
  }
  return repository;
};

export const derivePackageScopeKey = (input: {
  packageVersion: string;
  sourceIdentity: string;
  packIdentity: string;
  artifactSha256: string;
  matrixDefinitionSha256: string;
}): string => {
  const version = input.packageVersion
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "");
  if (
    version.length === 0 ||
    input.sourceIdentity.length === 0 ||
    input.packIdentity.length === 0 ||
    !/^[0-9a-f]{64}$/u.test(input.artifactSha256) ||
    !/^[0-9a-f]{64}$/u.test(input.matrixDefinitionSha256)
  ) {
    fail("Matrix package identity cannot produce a GitHub native scope key.");
  }
  const identitySha256 = canonicalDigest({
    packageVersion: input.packageVersion,
    sourceIdentity: input.sourceIdentity,
    packIdentity: input.packIdentity,
    artifactSha256: input.artifactSha256,
    matrixDefinitionSha256: input.matrixDefinitionSha256,
  });
  return `bearing-live-${version}-${identitySha256}`;
};

export const deriveGitHubJourneyScopeKey = (input: {
  packageVersion: string;
  sourceIdentity: string;
  packIdentity: string;
  artifactSha256: string;
  matrixDefinitionSha256: string;
  generationId: string;
  journeyAttempt: number;
}): string => {
  const packageScopeKey = derivePackageScopeKey(input);
  const generationId = z.string().uuid().parse(input.generationId);
  const journeyAttempt = z.number().int().positive().parse(input.journeyAttempt);
  const scopeIdentity = canonicalDigest({ packageScopeKey, generationId, journeyAttempt });
  return packageScopeKey.replace(/[0-9a-f]{64}$/u, scopeIdentity);
};

const rawLabelSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  color: z.string().optional(),
  description: z.string().nullable().optional(),
});

const rawIssueLabelSchema = rawLabelSchema.pick({ id: true, name: true });
const rawIssueActorSchema = z.object({ id: z.string().min(1), login: z.string() });
const rawIssueRelationSchema = z.object({
  id: z.string().min(1),
  number: z.number().int().positive(),
});
const rawIssueSchema = z.object({
  id: z.string().min(1),
  number: z.number().int().positive(),
  state: z.string().min(1),
  stateReason: z.string().nullable().optional(),
  title: z.string(),
  body: z.string().nullable().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  closedAt: z.string().nullable().optional(),
  commentCount: z.number().int().nonnegative().optional(),
  comments: z.array(z.string()).optional(),
  labels: z.array(rawIssueLabelSchema),
  assignees: z.array(rawIssueActorSchema),
  milestone: z
    .object({ id: z.string().min(1), number: z.number().int().positive(), title: z.string() })
    .nullable(),
  parent: rawIssueRelationSchema.nullable(),
  subIssues: z.array(rawIssueRelationSchema),
  blockedBy: z.array(rawIssueRelationSchema),
  blocking: z.array(rawIssueRelationSchema),
});

const rawRepositorySettingsSchema = repositoryAccessSchema.extend({
  defaultBranchRef: z.object({ name: z.string() }).nullable(),
  isArchived: z.boolean(),
  mergeCommitAllowed: z.boolean(),
  rebaseMergeAllowed: z.boolean(),
  squashMergeAllowed: z.boolean(),
  deleteBranchOnMerge: z.boolean(),
  hasDiscussionsEnabled: z.boolean(),
  hasProjectsEnabled: z.boolean(),
  hasWikiEnabled: z.boolean(),
  isFork: z.boolean(),
  isTemplate: z.boolean(),
  description: z.string().nullable(),
  homepageUrl: z.string().nullable(),
});

const rawInventorySchema = z.object({
  candidateBranchCommit: z
    .string()
    .regex(/^[0-9a-f]{40}$/u)
    .nullable(),
  repository: rawRepositorySettingsSchema,
  labels: z.array(rawLabelSchema),
  issues: z.array(rawIssueSchema),
});

const hashedIdentity = (kind: string, value: string): string => digestText(`${kind}\0${value}`);

const rawGitReferenceSchema = z.object({
  ref: z.string().startsWith("refs/heads/"),
  object: z.object({ sha: z.string().regex(/^[0-9a-f]{40}$/u) }),
});

export const selectGitHubJourneyCandidateBranch = (input: unknown, scopeKey: string) => {
  if (!githubBrokerScopeKeyPattern.test(scopeKey)) {
    fail("GitHub Journey branch selection requires one exact scope key.");
  }
  const candidates = z
    .array(rawGitReferenceSchema)
    .parse(input)
    .filter(({ ref }) => ref.slice("refs/heads/".length).includes(scopeKey));
  if (candidates.length > 1) {
    fail("GitHub Journey candidate branch identity is ambiguous.");
  }
  const candidate = candidates[0];
  return candidate === undefined
    ? null
    : Object.freeze({ name: candidate.ref.slice("refs/heads/".length), sha: candidate.object.sha });
};

const candidateRemoteHeads = (stdout: string, scopeKey: string) => {
  const references = stdout
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => {
      const match =
        /^([0-9a-f]{40})\t(refs\/heads\/.+)$/u.exec(line) ??
        fail("Git Journey remote branch inventory is invalid.");
      return { ref: match[2], object: { sha: match[1] } };
    });
  return selectGitHubJourneyCandidateBranch(references, scopeKey);
};

export const sanitizeGitHubRemoteInventory = (input: unknown, scopeKey: string) => {
  const parsed = rawInventorySchema.parse(input);
  const repositoryIdentitySha256 = hashedIdentity("repository", parsed.repository.id);
  const settings = {
    isPrivate: parsed.repository.isPrivate,
    hasIssuesEnabled: parsed.repository.hasIssuesEnabled,
    defaultBranch: parsed.repository.defaultBranchRef?.name ?? null,
    isArchived: parsed.repository.isArchived,
    mergeCommitAllowed: parsed.repository.mergeCommitAllowed,
    rebaseMergeAllowed: parsed.repository.rebaseMergeAllowed,
    squashMergeAllowed: parsed.repository.squashMergeAllowed,
    deleteBranchOnMerge: parsed.repository.deleteBranchOnMerge,
    hasDiscussionsEnabled: parsed.repository.hasDiscussionsEnabled,
    hasProjectsEnabled: parsed.repository.hasProjectsEnabled,
    hasWikiEnabled: parsed.repository.hasWikiEnabled,
    isFork: parsed.repository.isFork,
    isTemplate: parsed.repository.isTemplate,
    descriptionSha256: digestText(parsed.repository.description ?? ""),
    homepageUrlSha256: digestText(parsed.repository.homepageUrl ?? ""),
  };
  const labels = parsed.labels
    .map((label) => ({
      identitySha256: hashedIdentity("label", label.id),
      valueSha256: canonicalDigest({
        name: label.name,
        color: label.color ?? null,
        description: label.description ?? null,
      }),
    }))
    .sort((left, right) => left.identitySha256.localeCompare(right.identitySha256));
  const issues = parsed.issues
    .map((issue) => ({
      number: issue.number,
      identitySha256: hashedIdentity("issue", issue.id),
      candidateScoped: issue.title.includes(scopeKey) || (issue.body ?? "").includes(scopeKey),
      state: issue.state,
      stateReason: issue.stateReason ?? null,
      titleSha256: digestText(issue.title),
      bodySha256: digestText(issue.body ?? ""),
      reconciliationMarkerPresent:
        (issue.body ?? "").includes(`Reconciliation marker: ${scopeKey}:after-delivery`) ||
        (issue.comments ?? []).some((comment) =>
          comment.includes(`Reconciliation marker: ${scopeKey}:after-delivery`),
        ),
      createdAt: issue.createdAt ?? null,
      updatedAt: issue.updatedAt ?? null,
      closedAt: issue.closedAt ?? null,
      commentCount: issue.commentCount ?? 0,
      labels: issue.labels
        .map((label) => hashedIdentity("label", label.id))
        .sort((left, right) => left.localeCompare(right)),
      assignees: issue.assignees
        .map((actor) => hashedIdentity("actor", actor.id))
        .sort((left, right) => left.localeCompare(right)),
      milestoneSha256:
        issue.milestone === null
          ? null
          : canonicalDigest({
              id: issue.milestone.id,
              number: issue.milestone.number,
              title: issue.milestone.title,
            }),
      parent:
        issue.parent === null
          ? null
          : {
              number: issue.parent.number,
              identitySha256: hashedIdentity("issue", issue.parent.id),
            },
      subIssues: issue.subIssues
        .map((child) => ({
          number: child.number,
          identitySha256: hashedIdentity("issue", child.id),
        }))
        .sort((left, right) => left.number - right.number),
      blockedBy: issue.blockedBy
        .map((dependency) => ({
          number: dependency.number,
          identitySha256: hashedIdentity("issue", dependency.id),
        }))
        .sort((left, right) => left.number - right.number),
      blocking: issue.blocking
        .map((dependency) => ({
          number: dependency.number,
          identitySha256: hashedIdentity("issue", dependency.id),
        }))
        .sort((left, right) => left.number - right.number),
    }))
    .sort((left, right) => left.number - right.number);
  return Object.freeze({
    schemaVersion: 1 as const,
    repositoryIdentitySha256,
    repositoryPrivate: parsed.repository.isPrivate,
    viewerPermission: parsed.repository.viewerPermission,
    settingsSha256: canonicalDigest(settings),
    labelsSha256: canonicalDigest(labels),
    candidateBranchCommit: parsed.candidateBranchCommit,
    issues: Object.freeze(issues.map((issue) => Object.freeze(issue))),
  });
};

export type GitHubRemoteInventory = ReturnType<typeof sanitizeGitHubRemoteInventory>;

export const assertGitHubRemoteIntegrity = (input: {
  before: GitHubRemoteInventory;
  after: GitHubRemoteInventory;
  authorizedIssueNumbers: readonly number[];
  requireCompleteAuthorizedSet?: boolean;
  requireCandidateBranch?: boolean;
}) => {
  const authorized = new Set(input.authorizedIssueNumbers);
  if (
    authorized.size !== input.authorizedIssueNumbers.length ||
    input.authorizedIssueNumbers.some((number) => !Number.isSafeInteger(number) || number <= 0)
  ) {
    fail("Authorized GitHub issue numbers must be unique positive integers.");
  }
  if (input.before.repositoryIdentitySha256 !== input.after.repositoryIdentitySha256) {
    fail("GitHub Validation Repository identity changed during the Journey.");
  }
  if (input.before.settingsSha256 !== input.after.settingsSha256) {
    fail("Unauthorized GitHub repository settings changed during the Journey.");
  }
  if (input.before.labelsSha256 !== input.after.labelsSha256) {
    fail("Unauthorized GitHub labels changed during the Journey.");
  }
  if (input.before.candidateBranchCommit !== null) {
    fail("Candidate-scoped GitHub branch is not fresh for this Matrix generation.");
  }
  if (input.requireCandidateBranch === true && input.after.candidateBranchCommit === null) {
    fail("Completed GitHub delivery has no isolated remote branch readback.");
  }
  if (input.before.issues.some((issue) => authorized.has(issue.number) || issue.candidateScoped)) {
    fail("Candidate-scoped GitHub native work is not fresh for this Matrix generation.");
  }
  const authorizedAfter = input.after.issues.filter((issue) => authorized.has(issue.number));
  if (
    (input.requireCompleteAuthorizedSet !== false && authorizedAfter.length !== authorized.size) ||
    authorizedAfter.some((issue) => !issue.candidateScoped)
  ) {
    fail("Authorized GitHub issues do not form the fresh candidate-scoped native work.");
  }
  const historicalBefore = input.before.issues.filter((issue) => !authorized.has(issue.number));
  const historicalAfter = input.after.issues.filter((issue) => !authorized.has(issue.number));
  if (JSON.stringify(historicalBefore) !== JSON.stringify(historicalAfter)) {
    fail("An unauthorized GitHub issue or relationship changed during the Journey.");
  }
  return Object.freeze({
    repositoryIdentitySha256: input.after.repositoryIdentitySha256,
    authorizedCandidateIssueCount: authorizedAfter.length,
    integritySha256: canonicalDigest({
      repository: input.after.repositoryIdentitySha256,
      settings: input.after.settingsSha256,
      labels: input.after.labelsSha256,
      candidateBranchCommit: input.after.candidateBranchCommit,
      historicalIssues: historicalAfter,
      authorizedIssues: authorizedAfter,
    }),
  });
};

const repositoryAccessQuery = `query($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    id nameWithOwner isPrivate viewerPermission hasIssuesEnabled
    defaultBranchRef { name }
    isArchived mergeCommitAllowed rebaseMergeAllowed squashMergeAllowed deleteBranchOnMerge
    hasDiscussionsEnabled hasProjectsEnabled hasWikiEnabled isFork isTemplate description homepageUrl
  }
}`;

const repositoryLabelsQuery = `query($owner: String!, $name: String!, $cursor: String) {
  repository(owner: $owner, name: $name) {
    labels(first: 100, after: $cursor) {
      nodes { id name color description }
      pageInfo { hasNextPage endCursor }
    }
  }
}`;

const repositoryIssuesQuery = `query($owner: String!, $name: String!, $cursor: String) {
  repository(owner: $owner, name: $name) {
    issues(first: 50, after: $cursor, orderBy: {field: CREATED_AT, direction: ASC}) {
      nodes {
        id number state stateReason title body createdAt updatedAt closedAt
        comments(first: 100) { nodes { body } totalCount pageInfo { hasNextPage } }
        labels(first: 100) { nodes { id name } pageInfo { hasNextPage } }
        assignees(first: 100) { nodes { id login } pageInfo { hasNextPage } }
        milestone { id number title }
        parent { id number }
        subIssues(first: 100) { nodes { id number } pageInfo { hasNextPage } }
        blockedBy(first: 100) { nodes { id number } pageInfo { hasNextPage } }
        blocking(first: 100) { nodes { id number } pageInfo { hasNextPage } }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
}`;

const runGitHubGraphQL = async (
  program: string,
  variables: Readonly<Record<string, string | undefined>>,
  query: string,
) => {
  const args = ["api", "graphql", "--raw-field", `query=${query}`];
  for (const [key, value] of Object.entries(variables)) {
    if (value !== undefined) args.push("--raw-field", `${key}=${value}`);
  }
  const process = Bun.spawn([program, ...args], {
    env: globalThis.process.env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ]);
  if (exitCode !== 0) fail(stderr.trim() || "GitHub API request failed.");
  return JSON.parse(stdout) as unknown;
};

const runGitHubCommand = async (input: {
  program: string;
  args: readonly string[];
  environment: Readonly<Record<string, string | undefined>>;
  failureMessage: string;
}): Promise<string> => {
  const process = Bun.spawn([input.program, ...input.args], {
    env: input.environment,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ]);
  if (exitCode !== 0) fail(stderr.trim() || input.failureMessage);
  return stdout.trim();
};

const isolatedGitHubEnvironment = (
  agentHome: string,
  githubConfigDirectory: string,
): Record<string, string> => {
  const environment = Object.fromEntries(
    Object.entries(globalThis.process.env).filter(
      ([key, value]) =>
        value !== undefined &&
        ![
          "GH_CONFIG_DIR",
          "GH_ENTERPRISE_TOKEN",
          "GH_HOST",
          "GH_TOKEN",
          "GITHUB_ENTERPRISE_TOKEN",
          "GITHUB_TOKEN",
        ].includes(key),
    ),
  ) as Record<string, string>;
  environment["HOME"] = agentHome;
  environment["GH_CONFIG_DIR"] = githubConfigDirectory;
  return environment;
};

const operatorGitHubLogin = async (program: string): Promise<string> => {
  const login = await runGitHubCommand({
    program,
    args: ["api", "user", "--jq", ".login"],
    environment: globalThis.process.env,
    failureMessage: "Operator GitHub account lookup failed.",
  });
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/u.test(login)) {
    fail("Operator GitHub login is invalid.");
  }
  return login;
};

const operatorGitHubToken = async (program: string): Promise<string> => {
  const token = await runGitHubCommand({
    program,
    args: ["auth", "token", "--hostname", "github.com"],
    environment: globalThis.process.env,
    failureMessage: "Operator GitHub credential lookup failed.",
  });
  if (token.length === 0 || /[\r\n]/u.test(token)) fail("Operator GitHub credential is invalid.");
  return token;
};

const githubBrokerRequestSchema = z
  .object({
    auth: z.string().regex(/^[0-9a-f]{64}$/u),
    tool: z.enum(["gh", "git"]),
    args: z.array(z.string()).max(100),
    stdin: z.string().max(4_000_000),
  })
  .strict();

const githubBrokerResponseSchema = z
  .object({ exitCode: z.number().int(), stdout: z.string(), stderr: z.string() })
  .strict();

type GitHubJourneyOption = { type: "boolean" | "string"; short?: string; multiple?: boolean };
type GitHubJourneyOptionValue = boolean | string | readonly boolean[] | readonly string[];
type GitHubJourneyCommandEffect =
  | Readonly<{ kind: "none" }>
  | Readonly<{ kind: "create"; title: string; body: string }>
  | Readonly<{ kind: "issue-write"; issueNumber: number; title?: string; body?: string }>
  | Readonly<{
      kind: "relation-write";
      issueNumber: number;
      targetDatabaseId: number;
    }>;

type AuthorizedGitHubJourneyCommand = Readonly<{
  args: readonly string[];
  stdin: "";
  effect: GitHubJourneyCommandEffect;
}>;

const parseGitHubJourneyOptions = (
  args: readonly string[],
  options: Readonly<Record<string, GitHubJourneyOption>>,
): Readonly<{
  positionals: readonly string[];
  values: Readonly<Record<string, GitHubJourneyOptionValue | undefined>>;
}> => {
  try {
    const parsed = parseArgs({
      args: [...args],
      allowPositionals: true,
      strict: true,
      options,
    });
    return {
      positionals: parsed.positionals,
      values: parsed.values as Readonly<Record<string, GitHubJourneyOptionValue | undefined>>,
    };
  } catch {
    return fail("GitHub command options are outside the Journey capability.");
  }
};

const stringOptionValues = (
  values: Readonly<Record<string, GitHubJourneyOptionValue | undefined>>,
  name: string,
): readonly string[] => {
  const value = values[name];
  if (value === undefined) return [];
  if (typeof value === "string") return [value];
  if (Array.isArray(value) && value.every((entry) => typeof entry === "string")) return value;
  return fail("GitHub command options are outside the Journey capability.");
};

const normalizeParsedOptions = (
  values: Readonly<Record<string, GitHubJourneyOptionValue | undefined>>,
  options: Readonly<Record<string, GitHubJourneyOption>>,
  omitted: ReadonlySet<string> = new Set(),
): string[] => {
  const normalized: string[] = [];
  for (const [name, option] of Object.entries(options)) {
    if (omitted.has(name)) continue;
    if (option.type === "boolean") {
      if (values[name] === true) normalized.push(`--${name}`);
      continue;
    }
    for (const value of stringOptionValues(values, name)) normalized.push(`--${name}`, value);
  }
  return normalized;
};

const issueOptions = {
  list: {
    repo: { type: "string", short: "R" },
    state: { type: "string", short: "s" },
    assignee: { type: "string", short: "a" },
    author: { type: "string", short: "A" },
    label: { type: "string", short: "l", multiple: true },
    milestone: { type: "string", short: "m" },
    search: { type: "string", short: "S" },
    limit: { type: "string", short: "L" },
    json: { type: "string" },
    jq: { type: "string" },
  },
  view: {
    repo: { type: "string", short: "R" },
    comments: { type: "boolean", short: "c" },
    json: { type: "string" },
    jq: { type: "string" },
  },
  create: {
    repo: { type: "string", short: "R" },
    title: { type: "string", short: "t" },
    body: { type: "string", short: "b" },
    assignee: { type: "string", short: "a", multiple: true },
    label: { type: "string", short: "l", multiple: true },
    milestone: { type: "string", short: "m" },
    json: { type: "string" },
  },
  edit: {
    repo: { type: "string", short: "R" },
    title: { type: "string", short: "t" },
    body: { type: "string", short: "b" },
    "add-assignee": { type: "string", multiple: true },
    "remove-assignee": { type: "string", multiple: true },
    "add-label": { type: "string", multiple: true },
    "remove-label": { type: "string", multiple: true },
    milestone: { type: "string", short: "m" },
  },
  close: {
    repo: { type: "string", short: "R" },
    comment: { type: "string", short: "c" },
    reason: { type: "string", short: "r" },
  },
  reopen: {
    repo: { type: "string", short: "R" },
    comment: { type: "string", short: "c" },
  },
  comment: {
    repo: { type: "string", short: "R" },
    body: { type: "string", short: "b" },
    "edit-last": { type: "boolean" },
    "delete-last": { type: "boolean" },
    "create-if-none": { type: "boolean" },
  },
} as const satisfies Readonly<Record<string, Readonly<Record<string, GitHubJourneyOption>>>>;

const apiOptions = {
  method: { type: "string", short: "X" },
  "raw-field": { type: "string", short: "f", multiple: true },
  field: { type: "string", short: "F", multiple: true },
  input: { type: "string" },
  hostname: { type: "string" },
  header: { type: "string", short: "H", multiple: true },
  include: { type: "boolean", short: "i" },
  paginate: { type: "boolean" },
  slurp: { type: "boolean" },
  jq: { type: "string" },
  silent: { type: "boolean" },
} as const satisfies Readonly<Record<string, GitHubJourneyOption>>;

const normalizeApiEndpoint = (endpoint: string): Readonly<{ path: string; value: string }> => {
  if (
    endpoint.includes("\\") ||
    endpoint.includes("://") ||
    endpoint.startsWith("//") ||
    endpoint.includes("@")
  ) {
    fail("GitHub API endpoint is outside the Journey capability.");
  }
  const source = endpoint.replace(/^\//u, "");
  for (const segment of source.split(/[/?]/u)) {
    const decoded = (() => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return fail("GitHub API endpoint is outside the Journey capability.");
      }
    })();
    if (decoded === "." || decoded === ".." || decoded.includes("/") || decoded.includes("\\")) {
      fail("GitHub API endpoint is outside the Journey capability.");
    }
  }
  const url = new URL(source, "https://api.github.com/");
  const path = url.pathname.replace(/^\//u, "");
  const query = url.searchParams.toString();
  return { path, value: query.length === 0 ? path : `${path}?${query}` };
};

const apiFields = (
  values: Readonly<Record<string, GitHubJourneyOptionValue | undefined>>,
  option: "raw-field" | "field",
): readonly Readonly<{ key: string; value: string }>[] =>
  stringOptionValues(values, option).map((field) => {
    const separator = field.indexOf("=");
    if (separator <= 0) fail("GitHub API field is outside the Journey capability.");
    return { key: field.slice(0, separator), value: field.slice(separator + 1) };
  });

const normalizedApiHeaders = [
  "--header",
  "Accept: application/vnd.github+json",
  "--header",
  "X-GitHub-Api-Version: 2026-03-10",
] as const;

export const authorizeGitHubJourneyCommand = (input: {
  args: readonly string[];
  stdin: string;
  repositorySlug: string;
}): AuthorizedGitHubJourneyCommand => {
  parseGitHubRepositorySlug(input.repositorySlug);
  if (input.stdin.length > 0) fail("GitHub command stdin is outside the Journey capability.");
  const [command, subcommand] = input.args;
  const safeHelpCommand =
    (command === "help" && input.args.length === 1) ||
    (command === "api" && subcommand === "--help" && input.args.length === 2) ||
    (["issue", "label", "repo"].includes(command ?? "") &&
      subcommand === "--help" &&
      input.args.length === 2);
  if (safeHelpCommand) return { args: input.args, stdin: "", effect: { kind: "none" } };

  if (command === "issue") {
    if (subcommand === undefined || !(subcommand in issueOptions)) {
      return fail("GitHub issue command is outside the Journey capability.");
    }
    const issueSubcommand = subcommand as keyof typeof issueOptions;
    const options = issueOptions[issueSubcommand];
    const parsed = parseGitHubJourneyOptions(input.args.slice(2), options);
    const repository = stringOptionValues(parsed.values, "repo")[0];
    if (repository !== undefined && repository !== input.repositorySlug) {
      fail("GitHub command is outside the Journey repository.");
    }
    const needsIssueNumber = !["list", "create"].includes(issueSubcommand);
    if (
      parsed.positionals.length !== (needsIssueNumber ? 1 : 0) ||
      (needsIssueNumber && !/^[1-9]\d*$/u.test(parsed.positionals[0] ?? ""))
    ) {
      fail("GitHub issue selector is outside the Journey capability.");
    }
    const issueNumber = needsIssueNumber ? Number(parsed.positionals[0]) : undefined;
    const effect: GitHubJourneyCommandEffect =
      issueSubcommand === "create"
        ? {
            kind: "create",
            title: stringOptionValues(parsed.values, "title")[0] ?? "",
            body: stringOptionValues(parsed.values, "body")[0] ?? "",
          }
        : issueSubcommand === "list" || issueSubcommand === "view"
          ? { kind: "none" }
          : {
              kind: "issue-write",
              issueNumber: issueNumber ?? fail("GitHub issue selector is unavailable."),
              ...(issueSubcommand === "edit" &&
              stringOptionValues(parsed.values, "title")[0] !== undefined
                ? { title: stringOptionValues(parsed.values, "title")[0] }
                : {}),
              ...(issueSubcommand === "edit" &&
              stringOptionValues(parsed.values, "body")[0] !== undefined
                ? { body: stringOptionValues(parsed.values, "body")[0] }
                : {}),
            };
    return {
      args: [
        "issue",
        issueSubcommand,
        ...parsed.positionals,
        ...normalizeParsedOptions(parsed.values, options, new Set(["repo"])),
        "--repo",
        input.repositorySlug,
      ],
      stdin: "",
      effect,
    };
  }

  if (command === "label" && subcommand === "list") {
    const options = {
      repo: { type: "string", short: "R" },
      limit: { type: "string", short: "L" },
      search: { type: "string", short: "S" },
      json: { type: "string" },
      jq: { type: "string" },
    } as const satisfies Readonly<Record<string, GitHubJourneyOption>>;
    const parsed = parseGitHubJourneyOptions(input.args.slice(2), options);
    if (parsed.positionals.length !== 0)
      fail("GitHub label command is outside the Journey capability.");
    const repository = stringOptionValues(parsed.values, "repo")[0];
    if (repository !== undefined && repository !== input.repositorySlug) {
      fail("GitHub command is outside the Journey repository.");
    }
    return {
      args: [
        "label",
        "list",
        ...normalizeParsedOptions(parsed.values, options, new Set(["repo"])),
        "--repo",
        input.repositorySlug,
      ],
      stdin: "",
      effect: { kind: "none" },
    };
  }

  if (command === "repo" && subcommand === "view") {
    const options = {
      json: { type: "string" },
      jq: { type: "string" },
    } as const satisfies Readonly<Record<string, GitHubJourneyOption>>;
    const parsed = parseGitHubJourneyOptions(input.args.slice(2), options);
    if (
      parsed.positionals.length > 1 ||
      (parsed.positionals[0] !== undefined && parsed.positionals[0] !== input.repositorySlug)
    ) {
      fail("GitHub repo command is outside the Journey capability.");
    }
    return {
      args: [
        "repo",
        "view",
        input.repositorySlug,
        ...normalizeParsedOptions(parsed.values, options),
      ],
      stdin: "",
      effect: { kind: "none" },
    };
  }

  if (command !== "api") fail("GitHub command is outside the Journey capability.");
  const parsed = parseGitHubJourneyOptions(input.args.slice(1), apiOptions);
  if (parsed.positionals.length !== 1)
    fail("GitHub API command is outside the Journey capability.");
  if (parsed.values["input"] !== undefined) {
    fail("GitHub API command options are outside the Journey capability.");
  }
  const hostname = stringOptionValues(parsed.values, "hostname")[0];
  if (hostname !== undefined && hostname !== "github.com") {
    fail("GitHub API hostname is outside the Journey capability.");
  }
  const conditionalHeaders = stringOptionValues(parsed.values, "header").flatMap((header) => {
    if (
      header === "Accept: application/vnd.github+json" ||
      header === "X-GitHub-Api-Version: 2026-03-10"
    ) {
      return [];
    }
    if (/^If-None-Match: [^\r\n]{1,512}$/u.test(header)) return [header];
    return fail("GitHub API header is outside the Journey capability.");
  });
  const endpoint = normalizeApiEndpoint(parsed.positionals[0] ?? "");
  const method = (stringOptionValues(parsed.values, "method")[0] ?? "GET").toUpperCase();
  if (!new Set(["GET", "PATCH", "POST"]).has(method)) {
    fail("GitHub API method is outside the Journey capability.");
  }
  if (
    endpoint.path !== "user" &&
    endpoint.path !== `repos/${input.repositorySlug}` &&
    !endpoint.path.startsWith(`repos/${input.repositorySlug}/`)
  ) {
    fail("GitHub API command is outside the Journey capability.");
  }
  const rawFields = apiFields(parsed.values, "raw-field");
  const typedFields = apiFields(parsed.values, "field");
  const outputOptions = normalizeParsedOptions(parsed.values, {
    jq: apiOptions.jq,
    silent: apiOptions.silent,
  });
  if (method === "GET") {
    if (rawFields.length > 0 || typedFields.length > 0) {
      fail("GitHub API GET fields are outside the Journey capability.");
    }
    const issueReadPattern = new RegExp(
      `^repos/${input.repositorySlug.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}/issues(?:/\\d+(?:/(?:comments|sub_issues|parent|dependencies/(?:blocked_by|blocking)))?)?$`,
      "u",
    );
    if (
      endpoint.path !== "user" &&
      endpoint.path !== `repos/${input.repositorySlug}` &&
      endpoint.path !== `repos/${input.repositorySlug}/labels` &&
      !issueReadPattern.test(endpoint.path)
    ) {
      fail("GitHub API read is outside the Journey capability.");
    }
    return {
      args: [
        "api",
        "--method",
        "GET",
        endpoint.value,
        ...normalizedApiHeaders,
        ...(parsed.values["paginate"] === true ? ["--paginate"] : []),
        ...(parsed.values["slurp"] === true ? ["--slurp"] : []),
        ...outputOptions,
        ...conditionalHeaders.flatMap((header) => ["--header", header]),
        ...(parsed.values["include"] === true ? ["--include"] : []),
      ],
      stdin: "",
      effect: { kind: "none" },
    };
  }
  if (
    parsed.values["paginate"] === true ||
    parsed.values["slurp"] === true ||
    parsed.values["include"] === true ||
    conditionalHeaders.length > 0
  ) {
    fail("GitHub API write options are outside the Journey capability.");
  }
  if (method === "PATCH" && typedFields.length > 0) {
    fail("GitHub API PATCH fields are outside the Journey capability.");
  }
  const repositoryPattern = input.repositorySlug.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const duplicateScalarField = ["title", "body", "state", "state_reason", "milestone"].find(
    (key) => rawFields.filter((field) => field.key === key).length > 1,
  );
  if (duplicateScalarField !== undefined) {
    fail("GitHub API scalar field is repeated outside the Journey capability.");
  }
  if (
    method === "POST" &&
    endpoint.path === `repos/${input.repositorySlug}/issues` &&
    typedFields.length === 0 &&
    rawFields.every((field) => /^(?:title|body)$/u.test(field.key))
  ) {
    const title =
      rawFields.find((field) => field.key === "title")?.value ??
      fail("GitHub Issue title is outside the Journey capability.");
    const body = rawFields.find((field) => field.key === "body")?.value ?? "";
    if (title.length === 0) {
      fail("GitHub Issue title is outside the Journey capability.");
    }
    return {
      args: [
        "api",
        "--method",
        "POST",
        endpoint.path,
        ...normalizedApiHeaders,
        ...rawFields.flatMap((field) => ["--raw-field", `${field.key}=${field.value}`]),
        ...outputOptions,
      ],
      stdin: "",
      effect: { kind: "create", title, body },
    };
  }
  if (
    method === "PATCH" &&
    new RegExp(`^repos/${repositoryPattern}/issues/\\d+$`, "u").test(endpoint.path) &&
    rawFields.every((field) =>
      /^(?:title|body|state|state_reason|milestone|assignees\[\]|labels\[\])$/u.test(field.key),
    )
  ) {
    const issueNumber = Number(endpoint.path.split("/").at(-1));
    const title = rawFields.find((field) => field.key === "title")?.value;
    const body = rawFields.find((field) => field.key === "body")?.value;
    return {
      args: [
        "api",
        "--method",
        "PATCH",
        endpoint.path,
        ...normalizedApiHeaders,
        ...rawFields.flatMap((field) => ["--raw-field", `${field.key}=${field.value}`]),
        ...outputOptions,
      ],
      stdin: "",
      effect: {
        kind: "issue-write",
        issueNumber,
        ...(title === undefined ? {} : { title }),
        ...(body === undefined ? {} : { body }),
      },
    };
  }
  const relation = endpoint.path.match(
    new RegExp(
      `^repos/${repositoryPattern}/issues/(\\d+)/(sub_issues|dependencies/blocked_by)$`,
      "u",
    ),
  );
  if (method === "POST" && relation !== null) {
    const relationKind = relation[2];
    const fieldName = relationKind === "sub_issues" ? "sub_issue_id" : "issue_id";
    const relationFields = [...rawFields, ...typedFields];
    if (relationFields.length !== 1 || relationFields[0]?.key !== fieldName) {
      fail("GitHub relation write fields are outside the Journey capability.");
    }
    const relationField = relationFields[0];
    if (relationField === undefined) {
      return fail("GitHub relation write fields are outside the Journey capability.");
    }
    const value = relationField.value;
    if (!/^[1-9]\d*$/u.test(value) || !Number.isSafeInteger(Number(value))) {
      fail("GitHub relation target is outside the Journey capability.");
    }
    const relationTargetDatabaseId = Number(value);
    return {
      args: [
        "api",
        "--method",
        "POST",
        endpoint.path,
        ...normalizedApiHeaders,
        "--field",
        `${fieldName}=${relationTargetDatabaseId}`,
        ...outputOptions,
      ],
      stdin: "",
      effect: {
        kind: "relation-write",
        issueNumber: Number(relation[1] ?? fail("GitHub relation source is unavailable.")),
        targetDatabaseId: relationTargetDatabaseId,
      },
    };
  }
  return fail("GitHub API command is outside the Journey capability.");
};

const githubJourneyScopeMarker = (scopeKey: string): string =>
  `<!-- bearing-live-scope:${scopeKey} -->`;

export const redactGitHubJourneyScopeIdentity = (value: string, scopeKey: string): string => {
  if (!githubBrokerScopeKeyPattern.test(scopeKey)) {
    fail("GitHub broker scope key is invalid.");
  }
  return value
    .replaceAll(githubJourneyScopeMarker(scopeKey), "")
    .replaceAll(scopeKey, "[internal-scope]");
};

const appendGitHubJourneyScopeMarker = (body: string, scopeKey: string): string => {
  const marker = githubJourneyScopeMarker(scopeKey);
  if (body.includes(marker)) return body;
  return body.length === 0 ? marker : `${body}\n\n${marker}`;
};

const replaceGitHubJourneyBodyArgument = (
  args: readonly string[],
  body: string,
): readonly string[] => {
  const normalized = [...args];
  if (normalized[0] === "issue") {
    const bodyIndex = normalized.indexOf("--body");
    if (bodyIndex >= 0) {
      normalized[bodyIndex + 1] = body;
      return normalized;
    }
    const repositoryIndex = normalized.indexOf("--repo");
    normalized.splice(repositoryIndex < 0 ? normalized.length : repositoryIndex, 0, "--body", body);
    return normalized;
  }
  for (let index = 0; index < normalized.length - 1; index += 1) {
    if (normalized[index] === "--raw-field" && normalized[index + 1]?.startsWith("body=")) {
      normalized[index + 1] = `body=${body}`;
      return normalized;
    }
  }
  normalized.push("--raw-field", `body=${body}`);
  return normalized;
};

export const bindGitHubJourneyCommandToScope = (
  command: AuthorizedGitHubJourneyCommand,
  scopeKey: string,
): AuthorizedGitHubJourneyCommand => {
  if (!githubBrokerScopeKeyPattern.test(scopeKey)) {
    fail("GitHub broker scope key is invalid.");
  }
  if (command.effect.kind === "create") {
    const body = appendGitHubJourneyScopeMarker(command.effect.body, scopeKey);
    return {
      args: replaceGitHubJourneyBodyArgument(command.args, body),
      stdin: "",
      effect: { ...command.effect, body },
    };
  }
  if (command.effect.kind !== "issue-write" || command.effect.body === undefined) return command;
  const body = appendGitHubJourneyScopeMarker(command.effect.body, scopeKey);
  return {
    args: replaceGitHubJourneyBodyArgument(command.args, body),
    stdin: "",
    effect: { ...command.effect, body },
  };
};

const githubBrokerIssueSchema = z.object({
  id: z.number().int().positive(),
  number: z.number().int().positive(),
  title: z.string(),
  body: z.string().nullable(),
});
const readGitHubBrokerIssues = async (input: {
  repositorySlug: string;
  program: string;
  environment: Readonly<Record<string, string>>;
}) => {
  const stdout = await runGitHubCommand({
    program: input.program,
    args: [
      "api",
      `repos/${input.repositorySlug}/issues?state=all&per_page=100`,
      "--header",
      "Accept: application/vnd.github+json",
      "--header",
      "X-GitHub-Api-Version: 2026-03-10",
      "--paginate",
      "--slurp",
    ],
    environment: input.environment,
    failureMessage: "GitHub broker Issue scope lookup failed.",
  });
  if (Buffer.byteLength(stdout, "utf8") > 4_000_000) {
    fail("GitHub broker Issue scope lookup exceeded the broker limit.");
  }
  return z.array(z.array(githubBrokerIssueSchema.passthrough())).parse(JSON.parse(stdout)).flat();
};

const assertGitHubJourneyWriteAuthorized = async (input: {
  effect: GitHubJourneyCommandEffect;
  scopeKey: string;
  repositorySlug: string;
  program: string;
  environment: Readonly<Record<string, string>>;
}): Promise<void> => {
  const effect = input.effect;
  if (effect.kind === "none") return;
  if (!githubBrokerScopeKeyPattern.test(input.scopeKey)) {
    fail("GitHub broker scope key is invalid.");
  }
  const candidateScoped = (issue: Readonly<{ title: string; body: string | null }>): boolean =>
    issue.title.includes(input.scopeKey) || (issue.body ?? "").includes(input.scopeKey);
  if (effect.kind === "create") {
    if (!candidateScoped({ title: effect.title, body: effect.body })) {
      fail("GitHub Issue creation is outside the current Journey scope.");
    }
    const issues = await readGitHubBrokerIssues(input);
    if (issues.filter(candidateScoped).length >= 2) {
      fail("GitHub Issue creation exceeds the bounded Journey scope.");
    }
    return;
  }
  const issues = await readGitHubBrokerIssues(input);
  const source = issues.find((issue) => issue.number === effect.issueNumber);
  if (source === undefined || !candidateScoped(source)) {
    return fail("GitHub Issue write is outside the current Journey scope.");
  }
  if (effect.kind === "issue-write") {
    const next = {
      title: effect.title ?? source.title,
      body: effect.body ?? source.body,
    };
    if (!candidateScoped(next)) {
      fail("GitHub Issue write would remove the current Journey scope identity.");
    }
    return;
  }
  const target = issues.find((issue) => issue.id === effect.targetDatabaseId);
  if (target === undefined || !candidateScoped(target)) {
    fail("GitHub relation write targets an Issue outside the current Journey scope.");
  }
};

const githubJourneyEnvironment = (input: {
  agentHome: string;
  baseEnvironment: Readonly<Record<string, string>>;
  brokerSocketPath: string;
  brokerAuth: string;
}): Record<string, string> => {
  const wrapperDirectory = join(input.agentHome, ".local", "bin");
  const shellEnvironmentDirectory = join(input.agentHome, ".config", "bearing-live-journey");
  return {
    ...input.baseEnvironment,
    HOME: input.agentHome,
    PATH: `${wrapperDirectory}:${input.baseEnvironment["PATH"] ?? ""}`,
    ZDOTDIR: shellEnvironmentDirectory,
    BEARING_GITHUB_BROKER_SOCKET: input.brokerSocketPath,
    BEARING_GITHUB_BROKER_AUTH: input.brokerAuth,
  };
};

export const provisionIsolatedGitHubAccountSelection = async (input: {
  program: string;
  agentHome: string;
  gitProgram?: string;
}): Promise<void> => {
  const login = await operatorGitHubLogin(input.program);
  const configDirectory = join(input.agentHome, ".config/gh");
  const configPath = join(configDirectory, "hosts.yml");
  const expectedConfiguration = `github.com:\n  git_protocol: https\n  users:\n    ${login}: {}\n  user: ${login}\n`;
  let configurationExists = false;
  try {
    await lstat(configPath);
    configurationExists = true;
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
  if (configurationExists) {
    if ((await readFile(configPath, "utf8")) !== expectedConfiguration) {
      fail("Isolated GitHub account selection conflicts with this Journey account.");
    }
  } else {
    await mkdir(configDirectory, { recursive: true });
    await writeFile(configPath, expectedConfiguration, { flag: "wx", mode: 0o600 });
  }

  const bunProgram = Bun.which("bun") ?? fail("Bun is unavailable for the isolated GitHub client.");
  const gitProgram =
    Bun.which(input.gitProgram ?? "git") ??
    fail("Git is unavailable for the isolated GitHub client.");
  const wrapperDirectory = join(input.agentHome, ".local", "bin");
  const wrapperPath = join(wrapperDirectory, "gh");
  const gitWrapperPath = join(wrapperDirectory, "git");
  const clientPath = join(input.agentHome, ".config", "bearing-live-journey", "github-client.ts");
  const expectedWrapper = `#!/bin/sh\nexec ${JSON.stringify(bunProgram)} ${JSON.stringify(clientPath)} gh "$@"\n`;
  const expectedGitWrapper = `#!/bin/sh
is_push() {
  while [ "$1" = "-c" ]; do
    [ "$#" -ge 3 ] || return 1
    shift 2
  done
  [ "$1" = "push" ]
}
if is_push "$@"; then
  while [ "$1" = "-c" ]; do shift 2; done
  exec ${JSON.stringify(bunProgram)} ${JSON.stringify(clientPath)} git "$@"
fi
exec ${JSON.stringify(gitProgram)} "$@"
`;
  const expectedClient = `import { createConnection } from "node:net";
const socketPath = process.env["BEARING_GITHUB_BROKER_SOCKET"];
const auth = process.env["BEARING_GITHUB_BROKER_AUTH"];
if (socketPath === undefined || auth === undefined) throw new Error("GitHub Journey credential broker is unavailable.");
const [tool, ...args] = process.argv.slice(2);
if (tool !== "gh" && tool !== "git") throw new Error("GitHub Journey broker tool is invalid.");
const readsStdin = tool === "gh" && args.some((arg, index) =>
  (arg === "--input" && args[index + 1] === "-") || arg === "--input=-" || arg.endsWith("=@-")
);
const stdin = readsStdin ? await new Response(Bun.stdin.stream()).text() : "";
let bytes: string;
try {
  bytes = await new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    const socket = createConnection({ path: socketPath }, () =>
      socket.write(JSON.stringify({ auth, tool, args, stdin }) + "\\n"),
    );
    socket.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    socket.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    socket.on("error", reject);
  });
} catch (error) {
  if (
    error instanceof Error &&
    "code" in error &&
    ["EACCES", "ENOENT", "EPERM"].includes(String(error.code))
  ) {
    process.stderr.write(
      'GitHub Journey broker is outside the inner command sandbox. Retry this exact gh or git push command once with sandbox_permissions="require_escalated"; repository and command restrictions remain enforced.\\n',
    );
    process.exit(77);
  }
  throw error;
}
const result = JSON.parse(bytes) as { exitCode: number; stdout: string; stderr: string };
process.stdout.write(result.stdout);
process.stderr.write(result.stderr);
process.exit(result.exitCode);
`;
  await mkdir(wrapperDirectory, { recursive: true });
  const expectedBearingWrapper = `#!/bin/sh\nexec ${JSON.stringify(join(input.agentHome, ".bearing", "bin", "bearing"))} "$@"\n`;
  const bearingWrapperPath = join(wrapperDirectory, "bearing");
  const expectedShellEnvironment = `export PATH=${JSON.stringify(`${wrapperDirectory}:$PATH`)}\n`;
  const shellEnvironmentDirectory = join(input.agentHome, ".config", "bearing-live-journey");
  const shellEnvironmentPath = join(shellEnvironmentDirectory, ".zprofile");
  await mkdir(shellEnvironmentDirectory, { recursive: true });
  for (const [path, bytes, mode] of [
    [wrapperPath, expectedWrapper, 0o700],
    [gitWrapperPath, expectedGitWrapper, 0o700],
    [bearingWrapperPath, expectedBearingWrapper, 0o700],
    [shellEnvironmentPath, expectedShellEnvironment, 0o600],
    [clientPath, expectedClient, 0o600],
  ] as const) {
    try {
      if ((await readFile(path, "utf8")) !== bytes) {
        fail("Isolated GitHub support file conflicts with this Journey account.");
      }
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
      await writeFile(path, bytes, { flag: "wx", mode });
    }
  }
};

export const startGitHubJourneyCredentialBroker = async (input: {
  program: string;
  agentHome: string;
  repositoryRoot: string;
  repositorySlug: string;
  scopeKey: string;
  preparedGitConfigSha256: string;
  gitProgram?: string;
  baseEnvironment: Readonly<Record<string, string>>;
}) => {
  if (!githubBrokerScopeKeyPattern.test(input.scopeKey)) {
    fail("GitHub Journey credential broker scope key is invalid.");
  }
  await provisionIsolatedGitHubAccountSelection({
    program: input.program,
    agentHome: input.agentHome,
    ...(input.gitProgram === undefined ? {} : { gitProgram: input.gitProgram }),
  });
  const githubProgram = Bun.which(input.program) ?? input.program;
  const gitProgram =
    Bun.which(input.gitProgram ?? "git") ??
    fail("Git is unavailable for the GitHub Journey broker.");
  const brokerIdentity = canonicalDigest({
    agentHome: resolve(input.agentHome),
    repositoryRoot: resolve(input.repositoryRoot),
    repositorySlug: input.repositorySlug,
    scopeKey: input.scopeKey,
  });
  const brokerAuth = canonicalDigest({ brokerIdentity, capability: "github-journey-broker-v1" });
  const expectedAuth = Buffer.from(brokerAuth, "utf8");
  const gitDirectory = join(resolve(input.repositoryRoot), ".git");
  const gitDirectoryState = await lstat(gitDirectory);
  if (!gitDirectoryState.isDirectory()) {
    fail("GitHub Journey validation checkout must have one local .git directory.");
  }
  const gitConfigPath = join(gitDirectory, "config");
  if (
    !/^[0-9a-f]{64}$/u.test(input.preparedGitConfigSha256) ||
    sha256Bytes(await readFile(gitConfigPath)) !== input.preparedGitConfigSha256
  ) {
    fail("Git Journey repository configuration changed after Scenario preparation.");
  }
  const credential = {
    login: await operatorGitHubLogin(input.program),
    token: await operatorGitHubToken(input.program),
  };
  const runtimeDirectory = join("/private/tmp", `bgj-${brokerIdentity.slice(0, 24)}`);
  const brokerSocketPath = join(runtimeDirectory, "broker.sock");
  try {
    await lstat(runtimeDirectory);
    fail("GitHub Journey credential broker runtime directory already exists.");
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
  await mkdir(runtimeDirectory, { mode: 0o700 });
  const askPassPath = join(runtimeDirectory, "git-askpass.sh");
  await writeFile(
    askPassPath,
    "#!/bin/sh\ncase \"$1\" in *Username*) printf '%s\\n' 'x-access-token';; *Password*) printf '%s\\n' \"$BEARING_GITHUB_PUSH_TOKEN\";; *) exit 1;; esac\n",
    { flag: "wx", mode: 0o700 },
  );
  const brokerConfigDirectory = await mkdtemp("/private/tmp/bearing-github-config-");
  let stopped = false;
  const processRequest = async (
    bytes: string,
  ): Promise<z.infer<typeof githubBrokerResponseSchema>> => {
    let response: z.infer<typeof githubBrokerResponseSchema>;
    try {
      const decoded = JSON.parse(bytes) as unknown;
      const parsed = githubBrokerRequestSchema.safeParse(decoded);
      const suppliedAuth = parsed.success ? Buffer.from(parsed.data.auth, "utf8") : Buffer.alloc(0);
      if (
        !parsed.success ||
        suppliedAuth.byteLength !== expectedAuth.byteLength ||
        !timingSafeEqual(suppliedAuth, expectedAuth)
      ) {
        response = {
          exitCode: 64,
          stdout: "",
          stderr: "GitHub command is outside the Journey capability.\n",
        };
      } else {
        let exitCode: number;
        let stdout: string;
        let stderr: string;
        if (parsed.data.tool === "gh") {
          const authorized = bindGitHubJourneyCommandToScope(
            authorizeGitHubJourneyCommand({
              args: parsed.data.args,
              stdin: parsed.data.stdin,
              repositorySlug: input.repositorySlug,
            }),
            input.scopeKey,
          );
          const environment = isolatedGitHubEnvironment(input.agentHome, brokerConfigDirectory);
          environment["GH_TOKEN"] = credential.token;
          await assertGitHubJourneyWriteAuthorized({
            effect: authorized.effect,
            scopeKey: input.scopeKey,
            repositorySlug: input.repositorySlug,
            program: githubProgram,
            environment,
          });
          const child = Bun.spawn([githubProgram, ...authorized.args], {
            cwd: input.repositoryRoot,
            env: environment,
            stdin: "ignore",
            stdout: "pipe",
            stderr: "pipe",
          });
          [exitCode, stdout, stderr] = await Promise.all([
            child.exited,
            new Response(child.stdout).text(),
            new Response(child.stderr).text(),
          ]);
        } else {
          if (parsed.data.stdin.length > 0)
            fail("Git push stdin is outside the Journey capability.");
          const refspec = parsed.data.args.at(-1) ?? "";
          const argumentPrefix = parsed.data.args.slice(0, -1);
          const allowedPrefixes = [
            ["push", "origin"],
            ["push", "--set-upstream", "origin"],
            ["push", "-u", "origin"],
          ];
          if (
            !allowedPrefixes.some(
              (candidate) => JSON.stringify(candidate) === JSON.stringify(argumentPrefix),
            )
          ) {
            fail("Git push is outside the current Journey branch capability.");
          }
          const requestedBranchName = refspec.startsWith("HEAD:") ? refspec.slice(5) : refspec;
          if (["main", "master"].includes(requestedBranchName)) {
            fail("Git push branch is outside the isolated Journey scope.");
          }
          const pushedBranchName = `delivery-${input.scopeKey}`;
          const normalizedRefspec = `HEAD:${pushedBranchName}`;
          const environment = isolatedGitHubEnvironment(input.agentHome, brokerConfigDirectory);
          environment["GIT_ASKPASS"] = askPassPath;
          environment["GIT_TERMINAL_PROMPT"] = "0";
          environment["GIT_CONFIG_NOSYSTEM"] = "1";
          environment["GIT_CONFIG_GLOBAL"] = "/dev/null";
          environment["BEARING_GITHUB_PUSH_TOKEN"] = credential.token;
          const runGit = async (args: readonly string[]) => {
            if (sha256Bytes(await readFile(gitConfigPath)) !== input.preparedGitConfigSha256) {
              fail("Git Journey repository configuration changed after broker preparation.");
            }
            const child = Bun.spawn(
              [
                gitProgram,
                "-c",
                "core.hooksPath=/dev/null",
                "-c",
                "core.fsmonitor=false",
                "-c",
                "credential.helper=",
                ...args,
              ],
              {
                cwd: input.repositoryRoot,
                env: environment,
                stdin: "ignore",
                stdout: "pipe",
                stderr: "pipe",
              },
            );
            const [code, out, error] = await Promise.all([
              child.exited,
              new Response(child.stdout).text(),
              new Response(child.stderr).text(),
            ]);
            return { code, out, error } as const;
          };
          const expectedRemote = `https://github.com/${input.repositorySlug}.git`;
          const remote = await runGit(["remote", "get-url", "--push", "origin"]);
          if (remote.code !== 0 || remote.out.trim() !== expectedRemote) {
            fail("Git push origin is outside the fixed Journey repository.");
          }
          const status = await runGit(["status", "--porcelain=v1"]);
          if (status.code !== 0 || status.out.trim().length > 0) {
            fail("Git push requires one clean committed Journey delivery.");
          }
          const head = await runGit(["rev-parse", "HEAD"]);
          if (head.code !== 0 || !/^[0-9a-f]{40}$/u.test(head.out.trim())) {
            fail("Git push HEAD identity is unavailable.");
          }
          const requestedBranchFormat = await runGit([
            "check-ref-format",
            "--branch",
            requestedBranchName,
          ]);
          const branchFormat = await runGit(["check-ref-format", "--branch", pushedBranchName]);
          if (requestedBranchFormat.code !== 0 || branchFormat.code !== 0) {
            fail("Git push branch name is invalid.");
          }
          if (!refspec.startsWith("HEAD:")) {
            const currentBranch = await runGit(["symbolic-ref", "--short", "HEAD"]);
            if (currentBranch.code !== 0 || currentBranch.out.trim() !== requestedBranchName) {
              fail("Git push local branch identity does not match the Journey scope branch.");
            }
          }
          const before = await runGit(["ls-remote", "--heads", expectedRemote]);
          if (before.code !== 0 || candidateRemoteHeads(before.out, input.scopeKey) !== null) {
            fail("Git Journey branch is not fresh or could not be inspected.");
          }
          const pushed = await runGit(["push", expectedRemote, normalizedRefspec]);
          if (pushed.code !== 0) {
            ({ code: exitCode, out: stdout, error: stderr } = pushed);
          } else {
            const after = await runGit(["ls-remote", "--heads", expectedRemote]);
            const readback = candidateRemoteHeads(after.out, input.scopeKey);
            if (
              after.code !== 0 ||
              readback?.name !== pushedBranchName ||
              readback.sha !== head.out.trim()
            ) {
              fail("Git Journey branch readback does not match the committed delivery.");
            }
            ({ code: exitCode, out: stdout, error: stderr } = pushed);
          }
        }
        const agentStdout = redactGitHubJourneyScopeIdentity(stdout, input.scopeKey);
        const agentStderr = redactGitHubJourneyScopeIdentity(stderr, input.scopeKey);
        response =
          agentStdout.includes(credential.token) || agentStderr.includes(credential.token)
            ? {
                exitCode: 70,
                stdout: "",
                stderr: "GitHub credential output was blocked.\n",
              }
            : githubBrokerResponseSchema.parse({
                exitCode,
                stdout: agentStdout,
                stderr: agentStderr,
              });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      response = {
        exitCode: 70,
        stdout: "",
        stderr:
          message.startsWith("GitHub ") || message.startsWith("Git ")
            ? `${message}\n`
            : "GitHub broker failed.\n",
      };
    }
    return response;
  };
  const server = createServer((socket) => {
    const chunks: Buffer[] = [];
    let byteLength = 0;
    let processed = false;
    socket.on("data", (chunk) => {
      if (processed) return;
      byteLength += chunk.byteLength;
      if (byteLength > 4_100_000) {
        socket.destroy(new Error("GitHub broker request is too large."));
        return;
      }
      chunks.push(Buffer.from(chunk));
      const bytes = Buffer.concat(chunks).toString("utf8");
      if (!bytes.endsWith("\n")) return;
      processed = true;
      void processRequest(bytes.slice(0, -1))
        .then((response) => socket.end(JSON.stringify(response)))
        .catch(() =>
          socket.end(
            JSON.stringify({
              exitCode: 70,
              stdout: "",
              stderr: "GitHub broker failed.\n",
            }),
          ),
        );
    });
  });
  try {
    await new Promise<void>((resolveListen, rejectListen) => {
      server.once("error", rejectListen);
      server.listen(brokerSocketPath, () => {
        server.off("error", rejectListen);
        resolveListen();
      });
    });
    await chmod(brokerSocketPath, 0o600);
  } catch (error) {
    await Promise.all([
      rm(runtimeDirectory, { recursive: true, force: true }),
      rm(brokerConfigDirectory, { recursive: true, force: true }),
    ]);
    throw error;
  }
  const stop = async (): Promise<void> => {
    if (stopped) return;
    stopped = true;
    await new Promise<void>((resolveClose, rejectClose) =>
      server.close((error) => (error === undefined ? resolveClose() : rejectClose(error))),
    );
    await Promise.all([
      rm(runtimeDirectory, { recursive: true, force: true }),
      rm(brokerConfigDirectory, { recursive: true, force: true }),
    ]);
  };
  const environment = githubJourneyEnvironment({
    agentHome: input.agentHome,
    baseEnvironment: input.baseEnvironment,
    brokerSocketPath,
    brokerAuth,
  });
  const wrapperPath = join(input.agentHome, ".local", "bin", "gh");
  try {
    const isolatedLogin = await runGitHubCommand({
      program: wrapperPath,
      args: ["api", "user", "--jq", ".login"],
      environment,
      failureMessage: "Isolated GitHub authentication is unavailable.",
    });
    if (isolatedLogin !== credential.login) {
      fail("Isolated GitHub account selection changed account identity.");
    }
  } catch (error) {
    await stop();
    throw error;
  }
  return Object.freeze({
    environment: Object.freeze(environment),
    runtimeDirectory,
    socketPath: brokerSocketPath,
    codexArguments: Object.freeze([
      "-c",
      `permissions.bearing_live_journey.network={enabled=true,unix_sockets={${JSON.stringify(
        brokerSocketPath,
      )}="allow"}}`,
      "-c",
      `auto_review.policy=${JSON.stringify(
        "The isolated gh executable and exact git push send commands through a broker restricted to the fixed Journey repository and current scope. When the visible user request asks to deliver the current candidate scope, approve the exact gh command needed to manage that scope or the exact git push to its isolated branch. Do not approve other escalated commands, unrelated issues, historical scope changes, credential access, another branch, or another repository.",
      )}`,
    ]),
    stop,
  });
};

export const inspectGitHubRepository = async (program: string, repositorySlug: string) => {
  const repository = parseGitHubRepositorySlug(repositorySlug);
  const response = z
    .object({ data: z.object({ repository: rawRepositorySettingsSchema.nullable() }) })
    .parse(
      await runGitHubGraphQL(
        program,
        { owner: repository.owner, name: repository.name },
        repositoryAccessQuery,
      ),
    );
  const found = response.data.repository ?? fail("GitHub Validation Repository is unavailable.");
  if (found.nameWithOwner.toLowerCase() !== repository.slug.toLowerCase()) {
    fail("GitHub Validation Repository identity does not match owner/name.");
  }
  validateGitHubRepositoryAccess(found);
  return found;
};

export const captureGitHubRemoteInventory = async (input: {
  program: string;
  repositorySlug: string;
  scopeKey: string;
}) => {
  const repositorySlug = parseGitHubRepositorySlug(input.repositorySlug);
  const repository = await inspectGitHubRepository(input.program, repositorySlug.slug);
  const branchPages = z.array(z.array(rawGitReferenceSchema)).parse(
    JSON.parse(
      await runGitHubCommand({
        program: input.program,
        args: [
          "api",
          `repos/${repositorySlug.slug}/git/matching-refs/heads`,
          "--paginate",
          "--slurp",
        ],
        environment: globalThis.process.env,
        failureMessage: "GitHub Journey branch inventory failed.",
      }),
    ),
  );
  const branch = selectGitHubJourneyCandidateBranch(branchPages.flat(), input.scopeKey);
  const labels: unknown[] = [];
  let labelCursor: string | undefined;
  do {
    const response = z
      .object({
        data: z.object({
          repository: z.object({
            labels: z.object({
              nodes: z.array(rawLabelSchema),
              pageInfo: z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() }),
            }),
          }),
        }),
      })
      .parse(
        await runGitHubGraphQL(
          input.program,
          { owner: repositorySlug.owner, name: repositorySlug.name, cursor: labelCursor },
          repositoryLabelsQuery,
        ),
      );
    labels.push(...response.data.repository.labels.nodes);
    labelCursor = response.data.repository.labels.pageInfo.hasNextPage
      ? (response.data.repository.labels.pageInfo.endCursor ??
        fail("GitHub label pagination cursor is missing."))
      : undefined;
  } while (labelCursor !== undefined);

  const issues: unknown[] = [];
  let issueCursor: string | undefined;
  do {
    const response = z
      .object({
        data: z.object({
          repository: z.object({
            issues: z.object({
              nodes: z.array(
                z.object({
                  id: z.string(),
                  number: z.number(),
                  state: z.string(),
                  stateReason: z.string().nullable(),
                  title: z.string(),
                  body: z.string().nullable(),
                  createdAt: z.string(),
                  updatedAt: z.string(),
                  closedAt: z.string().nullable(),
                  comments: z.object({
                    nodes: z.array(z.object({ body: z.string() })),
                    totalCount: z.number().int().nonnegative(),
                    pageInfo: z.object({ hasNextPage: z.boolean() }),
                  }),
                  labels: z.object({
                    nodes: z.array(rawIssueLabelSchema),
                    pageInfo: z.object({ hasNextPage: z.boolean() }),
                  }),
                  assignees: z.object({
                    nodes: z.array(rawIssueActorSchema),
                    pageInfo: z.object({ hasNextPage: z.boolean() }),
                  }),
                  milestone: rawIssueSchema.shape.milestone,
                  parent: rawIssueRelationSchema.nullable(),
                  subIssues: z.object({
                    nodes: z.array(rawIssueRelationSchema),
                    pageInfo: z.object({ hasNextPage: z.boolean() }),
                  }),
                  blockedBy: z.object({
                    nodes: z.array(rawIssueRelationSchema),
                    pageInfo: z.object({ hasNextPage: z.boolean() }),
                  }),
                  blocking: z.object({
                    nodes: z.array(rawIssueRelationSchema),
                    pageInfo: z.object({ hasNextPage: z.boolean() }),
                  }),
                }),
              ),
              pageInfo: z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() }),
            }),
          }),
        }),
      })
      .parse(
        await runGitHubGraphQL(
          input.program,
          { owner: repositorySlug.owner, name: repositorySlug.name, cursor: issueCursor },
          repositoryIssuesQuery,
        ),
      );
    for (const issue of response.data.repository.issues.nodes) {
      if (
        issue.comments.pageInfo.hasNextPage ||
        issue.labels.pageInfo.hasNextPage ||
        issue.assignees.pageInfo.hasNextPage ||
        issue.subIssues.pageInfo.hasNextPage ||
        issue.blockedBy.pageInfo.hasNextPage ||
        issue.blocking.pageInfo.hasNextPage
      ) {
        fail(`GitHub issue #${issue.number} exceeds the bounded inventory relation limit.`);
      }
      issues.push({
        ...issue,
        commentCount: issue.comments.totalCount,
        comments: issue.comments.nodes.map((comment) => comment.body),
        labels: issue.labels.nodes,
        assignees: issue.assignees.nodes,
        subIssues: issue.subIssues.nodes,
        blockedBy: issue.blockedBy.nodes,
        blocking: issue.blocking.nodes,
      });
    }
    issueCursor = response.data.repository.issues.pageInfo.hasNextPage
      ? (response.data.repository.issues.pageInfo.endCursor ??
        fail("GitHub issue pagination cursor is missing."))
      : undefined;
  } while (issueCursor !== undefined);

  return sanitizeGitHubRemoteInventory(
    { candidateBranchCommit: branch?.sha ?? null, repository, labels, issues },
    input.scopeKey,
  );
};

const git = (root: string, args: readonly string[]): string => {
  const result = Bun.spawnSync(["git", ...args], { cwd: root, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0)
    fail(result.stderr.toString().trim() || `git ${args.join(" ")} failed.`);
  return result.stdout.toString().trim();
};

const fixedRepositoryConfigSchema = z.object({
  schemaVersion: z.literal(1),
  repositorySlug: repositorySlugSchema,
  repositoryIdentitySha256: z.string().regex(/^[0-9a-f]{64}$/u),
});

const fixedRepositoryConfigPath = (sourceRoot: string): string =>
  join(
    git(sourceRoot, ["rev-parse", "--absolute-git-dir"]),
    "bearing-live-journey/github-validation-repository.json",
  );

export const configureFixedGitHubValidationRepository = async (input: {
  sourceRoot: string;
  repositorySlug: string;
  githubProgram?: string;
}) => {
  const sourceRoot = await realpath(resolve(input.sourceRoot));
  const githubProgram = input.githubProgram ?? "gh";
  const repositorySlug = parseGitHubRepositorySlug(input.repositorySlug).slug;
  const path = fixedRepositoryConfigPath(sourceRoot);
  try {
    await lstat(path);
    fail("A fixed GitHub Validation Repository is already configured for this checkout.");
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
  const repository = await inspectGitHubRepository(githubProgram, repositorySlug);
  const configuration = fixedRepositoryConfigSchema.parse({
    schemaVersion: 1,
    repositorySlug,
    repositoryIdentitySha256: hashedIdentity("repository", repository.id),
  });
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(configuration, null, 2)}\n`, {
    flag: "wx",
    mode: 0o600,
  });
  return { path, configuration } as const;
};

export const readFixedGitHubValidationRepository = async (sourceRoot: string) => {
  const path = fixedRepositoryConfigPath(sourceRoot);
  const configuration = fixedRepositoryConfigSchema.parse(JSON.parse(await readFile(path, "utf8")));
  return { path, configuration } as const;
};

export const writeOrVerifyGitHubRemoteBaseline = async (input: {
  path: string;
  bytes: string;
}): Promise<"written" | "reused"> => {
  try {
    await writeFile(input.path, input.bytes, { flag: "wx" });
    return "written";
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
  }
  if ((await readFile(input.path, "utf8")) !== input.bytes) {
    fail("GitHub remote state changed after a pre-behavior harness failure.");
  }
  return "reused";
};

const remoteEvidenceSchema = z.object({
  pointer: evidencePointerSchema,
  sha256: z.string().regex(/^[0-9a-f]{64}$/u),
  bytes: z.number().int().nonnegative(),
});
const githubObservationSchema = z.object({
  turn: z.number().int().positive(),
  remote: z.object({ before: remoteEvidenceSchema, after: remoteEvidenceSchema }),
});

export const createGitHubJourneyObservation = (
  input: Parameters<typeof createLiveJourneyObservation>[0] & {
    remoteBeforePointer: string;
    remoteBeforeBytes: string;
    remoteAfterPointer: string;
    remoteAfterBytes: string;
  },
) => {
  const base = createLiveJourneyObservation(input);
  return Object.freeze({
    ...base,
    remote: Object.freeze({
      before: Object.freeze({
        pointer: evidencePointerSchema.parse(input.remoteBeforePointer),
        sha256: digestText(input.remoteBeforeBytes),
        bytes: Buffer.byteLength(input.remoteBeforeBytes),
      }),
      after: Object.freeze({
        pointer: evidencePointerSchema.parse(input.remoteAfterPointer),
        sha256: digestText(input.remoteAfterBytes),
        bytes: Buffer.byteLength(input.remoteAfterBytes),
      }),
    }),
  });
};

export const verifyGitHubJourneyObservation = async (input: {
  workspaceRoot: string;
  pointer: string;
  expectedCodexCliVersion: string;
}) => {
  const base = await verifyLiveJourneyObservation(input);
  const observationFile = await readGeneratedEvidenceFile(input.workspaceRoot, input.pointer);
  const extension = githubObservationSchema.parse(
    JSON.parse(observationFile.bytes.toString("utf8")),
  );
  const inventories: { before?: GitHubRemoteInventory; after?: GitHubRemoteInventory } = {};
  for (const phase of ["before", "after"] as const) {
    const evidence = extension.remote[phase];
    if (!evidence.pointer.startsWith("github/remote-inventories/")) {
      fail("GitHub observation must reference a generated remote inventory.");
    }
    const file = await readGeneratedEvidenceFile(input.workspaceRoot, evidence.pointer);
    if (file.bytes.byteLength !== evidence.bytes || sha256Bytes(file.bytes) !== evidence.sha256) {
      fail(`GitHub remote inventory digest mismatch: ${evidence.pointer}`);
    }
    inventories[phase] = JSON.parse(file.bytes.toString("utf8")) as GitHubRemoteInventory;
  }
  return {
    base,
    turn: extension.turn,
    before: inventories.before ?? fail("GitHub before inventory is unavailable."),
    after: inventories.after ?? fail("GitHub after inventory is unavailable."),
  };
};
