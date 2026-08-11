import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { z } from "zod";
import {
  CODEX_E2E_RUNTIME,
  codexE2ELaunchContract,
  inspectCodexE2EOperatorContext,
} from "./codex-e2e-runtime";
import {
  createLiveJourneyObservation,
  type LiveMatrixCandidate,
  liveMatrixCandidateSchema,
  readCleanJourneyGeneration,
  readGeneratedEvidenceFile,
  verifyCleanJourneyGeneration,
  verifyLiveJourneyObservation,
} from "./live-journey-matrix";
import { sha256Bytes, sha256File } from "./release-digest";

const fail = (message: string): never => {
  throw new Error(message);
};

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

export const deriveCandidateScopeKey = (input: {
  packageVersion: string;
  sourceCommit: string;
  workflowRunId: string;
  workflowRunAttempt: number;
  artifactSha256: string;
  matrixDefinitionSha256: string;
}): string => {
  const version = input.packageVersion
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "");
  if (
    version.length === 0 ||
    input.sourceCommit.length === 0 ||
    input.workflowRunId.length === 0 ||
    !Number.isSafeInteger(input.workflowRunAttempt) ||
    input.workflowRunAttempt <= 0 ||
    !/^[0-9a-f]{64}$/u.test(input.artifactSha256) ||
    !/^[0-9a-f]{64}$/u.test(input.matrixDefinitionSha256)
  ) {
    fail("Candidate identity cannot produce a GitHub native scope key.");
  }
  const identitySha256 = canonicalDigest({
    packageVersion: input.packageVersion,
    sourceCommit: input.sourceCommit,
    workflowRunId: input.workflowRunId,
    workflowRunAttempt: input.workflowRunAttempt,
    artifactSha256: input.artifactSha256,
    matrixDefinitionSha256: input.matrixDefinitionSha256,
  });
  return `bearing-live-${version}-${identitySha256}`;
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
  repository: rawRepositorySettingsSchema,
  labels: z.array(rawLabelSchema),
  issues: z.array(rawIssueSchema),
});

const hashedIdentity = (kind: string, value: string): string => digestText(`${kind}\0${value}`);

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
    issues: Object.freeze(issues.map((issue) => Object.freeze(issue))),
  });
};

export type GitHubRemoteInventory = ReturnType<typeof sanitizeGitHubRemoteInventory>;

export const assertGitHubRemoteIntegrity = (input: {
  before: GitHubRemoteInventory;
  after: GitHubRemoteInventory;
  authorizedIssueNumbers: readonly number[];
  requireCompleteAuthorizedSet?: boolean;
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
      historicalIssues: historicalAfter,
      authorizedIssues: authorizedAfter,
    }),
  });
};

const githubCaseIds = ["GITHUB-01", "GITHUB-02", "GITHUB-03", "GITHUB-04"] as const;
const githubCaseIdSchema = z.enum(githubCaseIds);
const evidencePointerSchema = z
  .string()
  .min(1)
  .refine((value) => !value.startsWith("/") && !value.split(/[\\/]/u).includes(".."));
const verdictSchema = z.object({
  caseId: githubCaseIdSchema,
  outcome: z.enum(["pass", "fail", "blocked", "not-run"]),
  judgmentBasis: z.string().trim().min(1).max(600),
  observationPointers: z.array(evidencePointerSchema).min(1),
});

export const validateGitHubJourneyVerdicts = (input: readonly unknown[]) => {
  const verdicts = z.array(verdictSchema).parse(input);
  if (
    verdicts.length !== githubCaseIds.length ||
    new Set(verdicts.map(({ caseId }) => caseId)).size !== githubCaseIds.length ||
    githubCaseIds.some((caseId) => !verdicts.some((verdict) => verdict.caseId === caseId))
  ) {
    fail("Coordinator evaluation requires each GitHub Case exactly once.");
  }
  return verdicts;
};

export const createGitHubJourneyEvaluation = (input: {
  candidate: LiveMatrixCandidate;
  codexCliVersion: string;
  coordinatorIdentity: string;
  durationMs: number;
  repositoryIdentitySha256: string;
  remoteIntegritySha256: string;
  verdicts: readonly unknown[];
}) => {
  const candidate = liveMatrixCandidateSchema.parse(input.candidate);
  const verdicts = validateGitHubJourneyVerdicts(input.verdicts);
  if (
    input.codexCliVersion.trim() !== input.codexCliVersion ||
    input.codexCliVersion.length === 0 ||
    input.coordinatorIdentity.trim() !== input.coordinatorIdentity ||
    input.coordinatorIdentity.length === 0 ||
    !Number.isSafeInteger(input.durationMs) ||
    input.durationMs < 0 ||
    !/^[0-9a-f]{64}$/u.test(input.repositoryIdentitySha256) ||
    !/^[0-9a-f]{64}$/u.test(input.remoteIntegritySha256)
  ) {
    fail("Coordinator evaluation metadata is invalid.");
  }
  return Object.freeze({
    schemaVersion: 1 as const,
    journey: "github-and-active-reconciliation" as const,
    candidate: Object.freeze({
      packageName: candidate.packageName,
      packageVersion: candidate.packageVersion,
      sourceCommit: candidate.sourceCommit,
      workflow: Object.freeze(candidate.workflow),
      artifact: Object.freeze({ file: candidate.artifact.file, sha256: candidate.artifact.sha256 }),
      matrixDefinitionSha256: candidate.matrixDefinitionSha256,
    }),
    codex: Object.freeze({
      cliVersion: input.codexCliVersion,
      requestedModel: CODEX_E2E_RUNTIME.model,
      requestedReasoningEffort: CODEX_E2E_RUNTIME.reasoningEffort,
    }),
    coordinatorIdentity: input.coordinatorIdentity,
    durationMs: input.durationMs,
    remoteIntegrity: Object.freeze({
      repositoryIdentitySha256: input.repositoryIdentitySha256,
      sha256: input.remoteIntegritySha256,
    }),
    outcome: verdicts.every(({ outcome }) => outcome === "pass")
      ? ("pass" as const)
      : ("not-pass" as const),
    cases: Object.freeze(verdicts.map((verdict) => Object.freeze(verdict))),
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
        comments { totalCount }
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
                  comments: z.object({ totalCount: z.number().int().nonnegative() }),
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

  return sanitizeGitHubRemoteInventory({ repository, labels, issues }, input.scopeKey);
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

const assertGitHubCheckout = async (
  root: string,
  expectedSlug: string,
  githubProgram: string,
): Promise<string> => {
  const canonical = await realpath(resolve(root));
  const result = Bun.spawnSync([githubProgram, "repo", "view", "--json", "nameWithOwner"], {
    cwd: canonical,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    fail(result.stderr.toString().trim() || "GitHub checkout identity lookup failed.");
  }
  const identity = z
    .object({ nameWithOwner: repositorySlugSchema })
    .parse(JSON.parse(result.stdout.toString()));
  if (identity.nameWithOwner.toLowerCase() !== expectedSlug.toLowerCase()) {
    fail("GitHub Validation Repository checkout origin does not match the fixed remote identity.");
  }
  return canonical;
};

const githubManifestSchema = z.object({
  schemaVersion: z.literal(1),
  generationId: z.string().uuid(),
  journey: z.literal("github-and-active-reconciliation"),
  candidate: liveMatrixCandidateSchema,
  cleanManifest: z.object({ path: z.string(), sha256: z.string().regex(/^[0-9a-f]{64}$/u) }),
  operatorContextFingerprint: z.string().regex(/^[0-9a-f]{64}$/u),
  paths: z.object({
    sourceRoot: z.string(),
    workspaceRoot: z.string(),
    candidateManifest: z.string(),
    candidateManifestDigest: z.string(),
    sessionState: z.string(),
    agentHome: z.string(),
    repository: z.string(),
    observations: z.string(),
    transcripts: z.string(),
    remoteInventories: z.string(),
    baselineInventory: z.string(),
  }),
  launch: z.object({
    environment: z.object({ HOME: z.string(), CODEX_HOME: z.string() }),
    initial: z.object({
      program: z.string(),
      arguments: z.array(z.string()),
      appendPromptAsFinalArgument: z.literal(true),
    }),
    resume: z.object({
      program: z.string(),
      arguments: z.array(z.string()),
      appendPromptAsFinalArgument: z.literal(true),
    }),
  }),
  github: z.object({
    program: z.string().min(1),
    repositorySlug: repositorySlugSchema,
    repositoryIdentitySha256: z.string().regex(/^[0-9a-f]{64}$/u),
    viewerPermission: permissionSchema,
    scopeKey: z.string().min(1),
    baselineInventorySha256: z.string().regex(/^[0-9a-f]{64}$/u),
  }),
});

export const prepareGitHubJourneyGeneration = async (input: {
  cleanManifestPath: string;
  repositoryRoot: string;
  githubProgram?: string;
  codexProgram?: string;
}) => {
  const cleanManifestPath = resolve(input.cleanManifestPath);
  const clean = await verifyCleanJourneyGeneration(
    await readCleanJourneyGeneration(cleanManifestPath),
  );
  const fixedRepository = await readFixedGitHubValidationRepository(clean.paths.sourceRoot);
  const repositorySlug = fixedRepository.configuration.repositorySlug;
  const githubProgram = input.githubProgram ?? "gh";
  const repositoryRoot = await assertGitHubCheckout(
    input.repositoryRoot,
    repositorySlug,
    githubProgram,
  );
  if (git(repositoryRoot, ["status", "--porcelain=v1"]) !== "") {
    fail("GitHub Validation Repository checkout must be clean before Journey preparation.");
  }
  const remote = await inspectGitHubRepository(githubProgram, repositorySlug);
  if (
    hashedIdentity("repository", remote.id) !==
    fixedRepository.configuration.repositoryIdentitySha256
  ) {
    fail("Configured GitHub Validation Repository identity does not match the live remote.");
  }
  const scopeKey = deriveCandidateScopeKey({
    packageVersion: clean.candidate.packageVersion,
    sourceCommit: clean.candidate.sourceCommit,
    workflowRunId: clean.candidate.workflow.runId,
    workflowRunAttempt: clean.candidate.workflow.runAttempt,
    artifactSha256: clean.candidate.artifact.sha256,
    matrixDefinitionSha256: clean.candidate.matrixDefinitionSha256,
  });
  const baseline = await captureGitHubRemoteInventory({
    program: githubProgram,
    repositorySlug,
    scopeKey,
  });
  if (baseline.issues.some((issue) => issue.candidateScoped)) {
    fail("Candidate-scoped GitHub native work already exists before this Matrix generation.");
  }
  const root = clean.paths.workspaceRoot;
  const observations = join(root, "github/observations");
  const transcripts = join(root, "github/transcripts");
  const remoteInventories = join(root, "github/remote-inventories");
  const candidateManifest = join(root, "github-candidate-manifest.json");
  const sessionState = join(root, "github-codex-session.json");
  const baselineInventory = join(remoteInventories, "baseline.json");
  await mkdir(join(root, "github"), { recursive: false });
  await Promise.all([
    mkdir(observations, { recursive: false }),
    mkdir(transcripts, { recursive: false }),
    mkdir(remoteInventories, { recursive: false }),
  ]);
  const baselineBytes = `${JSON.stringify(baseline, null, 2)}\n`;
  await writeFile(baselineInventory, baselineBytes, { flag: "wx" });
  const operatorContext = await inspectCodexE2EOperatorContext(clean.launch.environment.CODEX_HOME);
  const launch = codexE2ELaunchContract({
    repositoryRoot,
    isolatedHome: clean.paths.agentHome,
    codexHome: clean.launch.environment.CODEX_HOME,
    disabledOperatorSkillPaths: operatorContext.disabledSkills.map(({ locator }) => locator),
    ...(input.codexProgram === undefined ? {} : { program: input.codexProgram }),
  });
  const manifest = Object.freeze({
    schemaVersion: 1 as const,
    generationId: clean.generationId,
    journey: "github-and-active-reconciliation" as const,
    candidate: clean.candidate,
    cleanManifest: Object.freeze({
      path: cleanManifestPath,
      sha256: await sha256File(cleanManifestPath),
    }),
    operatorContextFingerprint: clean.operatorContextFingerprint,
    paths: Object.freeze({
      sourceRoot: clean.paths.sourceRoot,
      workspaceRoot: root,
      candidateManifest,
      candidateManifestDigest: `${candidateManifest}.sha256`,
      sessionState,
      agentHome: clean.paths.agentHome,
      repository: repositoryRoot,
      observations,
      transcripts,
      remoteInventories,
      baselineInventory,
    }),
    launch,
    github: Object.freeze({
      program: githubProgram,
      repositorySlug,
      repositoryIdentitySha256: baseline.repositoryIdentitySha256,
      viewerPermission: remote.viewerPermission,
      scopeKey,
      baselineInventorySha256: digestText(baselineBytes),
    }),
  });
  const manifestBytes = `${JSON.stringify(manifest, null, 2)}\n`;
  await writeFile(candidateManifest, manifestBytes, { flag: "wx" });
  await writeFile(`${candidateManifest}.sha256`, `${digestText(manifestBytes)}\n`, { flag: "wx" });
  return manifest;
};

export const readGitHubJourneyGeneration = async (path: string) => {
  const manifestPath = resolve(path);
  const bytes = await readFile(manifestPath, "utf8");
  if ((await readFile(`${manifestPath}.sha256`, "utf8")).trim() !== digestText(bytes)) {
    fail("GitHub Candidate Manifest digest mismatch before Codex launch.");
  }
  const parsed = githubManifestSchema.parse(JSON.parse(bytes));
  if (
    parsed.paths.candidateManifest !== manifestPath ||
    parsed.paths.candidateManifestDigest !== `${manifestPath}.sha256`
  ) {
    fail("GitHub Candidate Manifest locator mismatch before Codex launch.");
  }
  return parsed;
};

export const verifyGitHubJourneyGeneration = async (manifest: unknown) => {
  const parsed = githubManifestSchema.parse(manifest);
  const clean = await verifyCleanJourneyGeneration(
    await readCleanJourneyGeneration(parsed.cleanManifest.path),
  );
  const fixedRepository = await readFixedGitHubValidationRepository(parsed.paths.sourceRoot);
  if (
    fixedRepository.configuration.repositorySlug !== parsed.github.repositorySlug ||
    fixedRepository.configuration.repositoryIdentitySha256 !==
      parsed.github.repositoryIdentitySha256
  ) {
    fail("Fixed GitHub Validation Repository configuration changed after preparation.");
  }
  if (
    (await sha256File(parsed.cleanManifest.path)) !== parsed.cleanManifest.sha256 ||
    clean.generationId !== parsed.generationId ||
    JSON.stringify(clean.candidate) !== JSON.stringify(parsed.candidate) ||
    clean.paths.agentHome !== parsed.paths.agentHome ||
    clean.paths.sourceRoot !== parsed.paths.sourceRoot
  ) {
    fail("GitHub Journey identity does not match the verified Clean generation.");
  }
  await assertGitHubCheckout(
    parsed.paths.repository,
    parsed.github.repositorySlug,
    parsed.github.program,
  );
  const remote = await inspectGitHubRepository(parsed.github.program, parsed.github.repositorySlug);
  if (
    hashedIdentity("repository", remote.id) !== parsed.github.repositoryIdentitySha256 ||
    remote.viewerPermission !== parsed.github.viewerPermission
  ) {
    fail("GitHub Validation Repository access boundary changed after preparation.");
  }
  const baselineBytes = await readFile(parsed.paths.baselineInventory);
  if (sha256Bytes(baselineBytes) !== parsed.github.baselineInventorySha256) {
    fail("GitHub baseline inventory digest mismatch before Codex launch.");
  }
  const operatorContext = await inspectCodexE2EOperatorContext(
    parsed.launch.environment.CODEX_HOME,
  );
  if (operatorContext.fingerprint !== parsed.operatorContextFingerprint) {
    fail("Codex operator context changed after GitHub Journey preparation.");
  }
  const expectedLaunch = codexE2ELaunchContract({
    repositoryRoot: parsed.paths.repository,
    isolatedHome: parsed.paths.agentHome,
    codexHome: parsed.launch.environment.CODEX_HOME,
    disabledOperatorSkillPaths: operatorContext.disabledSkills.map(({ locator }) => locator),
    program: parsed.launch.initial.program,
  });
  if (JSON.stringify(expectedLaunch) !== JSON.stringify(parsed.launch)) {
    fail("Fixed GitHub Codex launch contract mismatch before tested behavior.");
  }
  return parsed;
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
