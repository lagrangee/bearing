import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { MattProviderFactory } from "../../src/provider-observation-acquisition";
import {
  createGitHubMattProvider,
  encodeGitHubMattNativeScope,
  type GitHubReadRequest,
  type GitHubReadResponse,
  type GitHubReadTransport,
} from "../../src/providers/matt-skills-v1/github";
import { setupRepository } from "../../src/repo-setup";
import { makeTemporaryDirectory, writeFixture, writeValidBearingState } from "../helpers";

export const githubContractLocator = "docs/agents/issue-tracker.md";
export const githubTriageLocator = "docs/agents/triage-labels.md";
export const githubCaptureGeneration = { fingerprint: "sha256:test-generation" };

export const standardGitHubMattContract = `# Issue tracker: GitHub

## Conventions

- Use the \`gh\` CLI for GitHub tracker reads.

## Pull requests as a triage surface

**PRs as a request surface: no.**

## When a skill says "publish to the issue tracker"

Create a GitHub issue.

## When a skill says "fetch the relevant ticket"

Run \`gh issue view <number> --comments\`.

## Wayfinding operations

Use one issue with child issues.
`;

export const standardGitHubMattAgentSurface = `# Repository instructions

## Agent skills

### Issue tracker

Issues and PRDs for this repo live as GitHub issues. See \`${githubContractLocator}\`.

### Triage labels

Use the repository mappings in \`${githubTriageLocator}\`.
`;

export const customGitHubTriageMapping = `# Triage Labels

| Label in mattpocock/skills | Label in our tracker | Meaning |
| --- | --- | --- |
| \`needs-triage\` | \`custom-triage\` | Evaluate |
| \`needs-info\` | \`custom-info\` | Waiting |
| \`ready-for-agent\` | \`custom-ready\` | Ready |
| \`ready-for-human\` | \`custom-human\` | Human |
| \`wontfix\` | \`custom-wontfix\` | Rejected |
| \`bug\` | \`custom-bug\` | Defect |
| \`enhancement\` | \`custom-enhancement\` | Feature |
`;

export const githubMattProviderFactoryFor = (
  transport: GitHubReadTransport,
): MattProviderFactory => {
  return (input) =>
    createGitHubMattProvider({
      repoRoot: input.repoRoot,
      contractLocator: input.configuration.contractLocator,
      capturedDocuments: input.capturedDocuments,
      transport,
      clock: () => new Date("2026-07-28T00:00:00.000Z"),
    });
};

export const writeStandardGitHubMattProductRepository = async (
  root: string,
  effort: Readonly<{
    title: string;
    intent: string;
    work: string;
  }>,
) => {
  const nativeScope = githubNativeScopeFor(githubMapIssue, "wayfinder-map");
  await writeFixture(root, "CONTEXT.md", `# ${effort.title}\n`);
  await writeFixture(root, "docs/agents/domain.md", "# Domain\n");
  await writeFixture(root, githubContractLocator, standardGitHubMattContract);
  await writeFixture(root, githubTriageLocator, customGitHubTriageMapping);
  await writeFixture(root, "AGENTS.md", standardGitHubMattAgentSurface);
  const contractBefore = await readFile(join(root, githubContractLocator));
  const triageBefore = await readFile(join(root, githubTriageLocator));
  const agentSurfaceBefore = await readFile(join(root, "AGENTS.md"), "utf8");
  const setup = await setupRepository({
    repoRoot: root,
    packageRoot: process.cwd(),
    surfaces: ["agent-skills"],
    profiles: [],
    provider: {
      key: "matt-skills/v1",
      contractLocator: githubContractLocator,
    },
  });
  await writeValidBearingState(root);
  await writeFixture(
    root,
    ".bearing/state/efforts/test.md",
    `---
Type: effort
Lifecycle: active
Planned at: null
Activated at: null
ID: effort:test
Title: ${effort.title}
Roadmap: roadmap:test
Target gate: gate:test
Authorities: []
Citations: []
Work binding:
  Provider: matt-skills/v1
  Native scope: ${nativeScope}
---

# Effort: ${effort.title}

## Intent

${effort.intent}

## Work

${effort.work}
`,
  );
  return {
    nativeScope,
    setup,
    contractBefore,
    triageBefore,
    agentSurfaceBefore,
  } as const;
};

export type GitHubFixtureResponse = Readonly<{
  first: GitHubReadResponse;
  revalidated?: GitHubReadResponse;
}>;

export class FixtureGitHubTransport implements GitHubReadTransport {
  readonly requests: GitHubReadRequest[] = [];

  constructor(private readonly fixtures: Readonly<Record<string, GitHubFixtureResponse>>) {}

  async get(request: GitHubReadRequest): Promise<GitHubReadResponse> {
    this.requests.push(request);
    const fixture = this.fixtures[request.endpoint];
    if (fixture === undefined) {
      if (/\/issues\/[1-9][0-9]*\/parent$/u.test(request.endpoint)) {
        return { status: 404, headers: {} };
      }
      throw new Error(`Unexpected fixture endpoint: ${request.endpoint}`);
    }
    return request.validator === undefined
      ? fixture.first
      : (fixture.revalidated ?? {
          status: 304,
          headers: { etag: request.validator },
        });
  }
}

export const githubFixtureResponse = (body: unknown, etag: string): GitHubReadResponse => ({
  status: 200,
  headers: { etag },
  body,
});

export const githubRepository = {
  id: 9001,
  node_id: "R_reference",
  name: "reference",
  full_name: "example/reference",
  html_url: "https://github.com/example/reference",
  owner: { login: "example", id: 90, node_id: "U_example" },
};

export const githubIncomingIssue = {
  id: 9109,
  node_id: "I_reference_9",
  number: 109,
  html_url: "https://github.com/example/reference/issues/109",
  repository_url: "https://api.github.com/repos/example/reference",
  title: "Support a custom-mapped enhancement",
  body: "Reporter prose with [external evidence](https://example.com/customer-report).",
  state: "open",
  state_reason: null,
  created_at: "2026-07-01T00:00:00Z",
  updated_at: "2026-07-02T00:00:00Z",
  closed_at: null,
  closed_by: null,
  labels: [
    { id: 1, node_id: "L_enhancement", name: "custom-enhancement" },
    { id: 2, node_id: "L_ready", name: "custom-ready" },
    { id: 3, node_id: "L_unrelated", name: "same-project" },
  ],
  assignees: [],
  milestone: { id: 44, node_id: "M_44", number: 4, title: "Later" },
  user: { login: "reporter", id: 91, node_id: "U_reporter" },
  author_association: "CONTRIBUTOR",
};

export const githubIssue = (input: {
  number: number;
  title: string;
  body: string;
  labels?: readonly string[];
  assignees?: readonly string[];
  state?: "open" | "closed";
  stateReason?: string | null;
}) => ({
  ...githubIncomingIssue,
  id: 9100 + input.number,
  node_id: `I_reference_${input.number}`,
  number: input.number,
  html_url: `https://github.com/example/reference/issues/${input.number}`,
  title: input.title,
  body: input.body,
  state: input.state ?? "open",
  state_reason: input.stateReason ?? null,
  updated_at: `2026-07-${String(input.number).padStart(2, "0")}T00:00:00Z`,
  closed_at: input.state === "closed" ? "2026-07-20T00:00:00Z" : null,
  closed_by: input.state === "closed" ? { login: "closer", id: 92, node_id: "U_closer" } : null,
  labels: (input.labels ?? []).map((name, index) => ({
    id: input.number * 100 + index,
    node_id: `L_${input.number}_${index}`,
    name,
  })),
  assignees: (input.assignees ?? []).map((login, index) => ({
    login,
    id: 100 + index,
    node_id: `U_${login}`,
  })),
  milestone: null,
});

export const githubNativeScopeFor = (
  issue: Readonly<{
    id: string | number;
    node_id: string;
    number: number;
    pull_request?: unknown;
  }>,
  rootKind: "wayfinder-map" | "parent-issue" | "standalone-request" = "standalone-request",
): string =>
  encodeGitHubMattNativeScope({
    host: "github.com",
    rootKind,
    repository: {
      owner: "example",
      name: "reference",
      databaseId: "9001",
      nodeId: "R_reference",
    },
    root: {
      objectKind: issue.pull_request === undefined ? "issue" : "pull-request",
      number: issue.number,
      databaseId: String(issue.id),
      nodeId: issue.node_id,
    },
  });

export const githubMapIssue = githubIssue({
  number: 1,
  title: "Reference Map",
  labels: ["wayfinder:map"],
  body: `## Destination

Prove one complete Matt-native semantic scope.

## Notes

- Keep provider-native identity outside the semantic oracle.

## Decisions so far

- [Research the semantic contract](https://github.com/example/reference/issues/3#issuecomment-301) — Use the versioned capture seam.

## Not yet specified

- Whether one source comment can be uniquely identified as an Answer.

## Out of scope

- Do not build a universal tracker ontology.
`,
});

export const githubSpecIssue = githubIssue({
  number: 2,
  title: "Reference Spec",
  labels: ["custom-ready"],
  body: `## Problem Statement

Local and GitHub must preserve the same accepted semantics.

## Solution

Capture one concrete Matt scope through a versioned provider seam.

## User Stories

A consumer can distinguish workflow truth without native identity coupling.

## Implementation Decisions

Keep provider-specific projection behind a provider-neutral wrapper.

## Testing Decisions

Compare public provider captures through a test-owned oracle.

## Out of Scope

Do not build a generic tracker ontology.

## Further Notes

Opaque relation references are capture-local.
`,
});

export const githubResearchIssue = githubIssue({
  number: 3,
  title: "Research the semantic contract",
  labels: ["wayfinder:research"],
  assignees: ["lago"],
  state: "closed",
  stateReason: "completed",
  body: `## Question

Which semantics are durable?
`,
});

export const githubDeliveryIssue = githubIssue({
  number: 4,
  title: "Implement provider capture",
  labels: ["custom-ready"],
  body: `## What to build

A versioned capture seam.

## Acceptance criteria

- [ ] Return independent state, freshness and completion.
- [ ] Keep the capture immutable.

## Blocked by

- [Research the semantic contract](https://github.com/example/reference/issues/3)
`,
});

export const githubScopedIncomingIssue = githubIssue({
  number: 5,
  title: "Support a custom-mapped enhancement",
  labels: ["custom-enhancement", "custom-ready", "same-project"],
  body: "Reporter prose with [external evidence](https://example.com/customer-report).",
});

export const githubComment = (input: {
  id: number;
  issue: number;
  body: string;
  author?: string;
}) => ({
  id: input.id,
  node_id: `IC_${input.id}`,
  html_url: `https://github.com/example/reference/issues/${input.issue}#issuecomment-${input.id}`,
  body: input.body,
  user: {
    login: input.author ?? "lago",
    id: input.id + 1000,
    node_id: `U_${input.author ?? "lago"}`,
  },
  created_at: "2026-07-20T00:00:00Z",
  updated_at: "2026-07-20T00:00:00Z",
  author_association: "OWNER",
});

export const createGitHubMattRepository = async (
  contractBody = standardGitHubMattContract,
): Promise<string> => {
  const root = await makeTemporaryDirectory("bearing-github-provider-");
  await writeFixture(root, githubContractLocator, contractBody);
  await writeFixture(root, githubTriageLocator, customGitHubTriageMapping);
  return root;
};

export const createReferenceGitHubFixtures = (): Record<string, GitHubFixtureResponse> => {
  const issues = [
    githubMapIssue,
    githubSpecIssue,
    githubResearchIssue,
    githubDeliveryIssue,
    githubScopedIncomingIssue,
  ];
  const fixtures: Record<string, GitHubFixtureResponse> = {
    "repos/example/reference": {
      first: githubFixtureResponse(githubRepository, '"repo-v1"'),
    },
  };
  for (const issue of issues) {
    const issueEndpoint = `repos/example/reference/issues/${issue.number}`;
    fixtures[issueEndpoint] = {
      first: githubFixtureResponse(issue, `"issue-${issue.number}-v1"`),
    };
    fixtures[`${issueEndpoint}/comments?per_page=100&page=1`] = {
      first: githubFixtureResponse(
        issue.number === 3
          ? [
              githubComment({
                id: 301,
                issue: 3,
                body: "Preserve workflow-specific lifecycle and evidence.",
              }),
              githubComment({
                id: 302,
                issue: 3,
                body: "This comment is not the Answer.",
                author: "reviewer",
              }),
            ]
          : [],
        `"comments-${issue.number}-v1"`,
      ),
    };
    fixtures[`${issueEndpoint}/dependencies/blocked_by?per_page=100&page=1`] = {
      first: githubFixtureResponse(
        issue.number === 4 ? [githubResearchIssue] : [],
        `"deps-${issue.number}-v1"`,
      ),
    };
    fixtures[`${issueEndpoint}/sub_issues?per_page=100&page=1`] = {
      first: githubFixtureResponse(
        issue.number === 1
          ? [githubResearchIssue, githubSpecIssue, githubScopedIncomingIssue]
          : issue.number === 2
            ? [githubDeliveryIssue]
            : [],
        `"children-${issue.number}-v1"`,
      ),
    };
  }
  return fixtures;
};
