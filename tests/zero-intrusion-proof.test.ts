import { expect, test } from "bun:test";
import { lstat, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { bearingManagedRange, withBearingManagedPointer } from "../src/agent-surface-entry";
import { createProjectMaterializer } from "../src/portal/project-materializer";
import { buildProjectSnapshot } from "../src/project-snapshot/projection";
import type {
  GitHubReadRequest,
  GitHubReadResponse,
  GitHubReadTransport,
} from "../src/providers/matt-skills-v1/github";
import { setupRepository } from "../src/repo-setup";
import { commitSyncPlan, prepareSync, type SyncPlan } from "../src/sync-plan";
import {
  createReferenceGitHubFixtures,
  FixtureGitHubTransport,
  type GitHubFixtureResponse,
  githubFixtureResponse,
  githubIssue,
  githubMapIssue,
  githubMattProviderFactoryFor,
  writeStandardGitHubMattProductRepository,
} from "./fixtures/github-matt-api";
import {
  buildSnapshotForSyncPlan,
  captureConsoleLogs,
  makeTemporaryDirectory,
  writeFixture,
  writeStandardMattLocalRepository,
  writeValidBearingState,
} from "./helpers";

const PACKAGE_VERSION = "0.1.1-test";
const CREDENTIAL_SENTINEL = "credential-store-value-must-remain-external";

export const ZERO_INTRUSION_PROOF_BOUNDARY = {
  evidenceKind: "deterministic-fixture",
  proves: ["local-native-bytes-and-mode", "github-native-state", "credential-residue"],
  liveGitHubValidation: {
    state: "not-run",
    owner: "ticket-17",
  },
} as const;

type FileSnapshot = Readonly<{
  mode: number;
  bytes: string;
}>;

const snapshotFiles = async (
  root: string,
  locators: readonly string[],
): Promise<Readonly<Record<string, FileSnapshot>>> => {
  const entries = await Promise.all(
    locators.map(async (locator) => {
      const target = join(root, locator);
      const metadata = await lstat(target);
      if (!metadata.isFile() || metadata.isSymbolicLink()) {
        throw new TypeError(`Zero-intrusion fixture is not a regular file: ${locator}`);
      }
      return [
        locator,
        {
          mode: metadata.mode & 0o7777,
          bytes: (await readFile(target)).toString("base64"),
        },
      ] as const;
    }),
  );
  return Object.fromEntries(entries);
};

const assertNoExactCredentialResidue = async (
  root: string,
  surfaces: readonly Readonly<{
    name: string;
    value: string | Uint8Array;
  }>[],
): Promise<void> => {
  const sentinel = Buffer.from(CREDENTIAL_SENTINEL, "utf8");
  const bearingFiles = [
    ...new Bun.Glob("**/*").scanSync({
      cwd: join(root, ".bearing"),
      onlyFiles: true,
    }),
  ];
  for (const locator of bearingFiles) {
    expect((await readFile(join(root, ".bearing", locator))).includes(sentinel), locator).toBe(
      false,
    );
  }
  for (const surface of surfaces) {
    expect(Buffer.from(surface.value).includes(sentinel), surface.name).toBe(false);
  }
};

const writeCompleteLocalScope = async (root: string): Promise<readonly string[]> => {
  await writeStandardMattLocalRepository(root);
  await writeFixture(
    root,
    ".scratch/work/PRD.md",
    `# Zero Intrusion Spec

Status: ready-for-agent

## Problem Statement

Bearing must preserve Matt-owned bytes.

## Solution

Use a read-only provider capture.

## User Stories

A maintainer can audit an exact before and after proof.

## Implementation Decisions

Keep native mutation with Matt skills.

## Testing Decisions

Compare every dedicated file byte and mode.

## Out of Scope

Do not add Bearing metadata to Matt work.

## Further Notes

The shared Agent Surface permits one exact managed block.
`,
  );
  await writeFixture(
    root,
    ".scratch/work/issues/02-deliver.md",
    `# Prove zero intrusion

**What to build:** A deterministic before and after proof.

Status: resolved

- [x] Preserve native files.
- [x] Keep credentials external.

## Answer

The proof is complete.

## Comments

This Matt-owned comment must remain unchanged.
`,
  );
  await writeFixture(
    root,
    ".scratch/work/issues/03-incoming.md",
    `# Preserve an incoming request

Category: enhancement

Status: ready-for-agent

Reporter content remains tracker-owned.

## Comments

No Bearing metadata belongs here.
`,
  );
  return [
    "docs/agents/issue-tracker.md",
    "docs/agents/triage-labels.md",
    ".scratch/work/map.md",
    ".scratch/work/PRD.md",
    ".scratch/work/issues/01-finish.md",
    ".scratch/work/issues/02-deliver.md",
    ".scratch/work/issues/03-incoming.md",
  ];
};

const assertCompleteProductRead = async (root: string, plan: SyncPlan): Promise<void> => {
  expect(plan.diagnostics).toEqual([]);
  const effort = plan.planningGraph.contextFor({ kind: "effort", id: "effort:test" });
  expect(effort.state).toBe("complete");
  if (effort.state === "invalid") throw new TypeError("Expected typed Effort inspection.");
  expect(effort.context.providerCapture).toBe(plan.providerCaptures[0]);
  const snapshot = await buildSnapshotForSyncPlan(root, PACKAGE_VERSION, plan);
  expect(snapshot.providerCaptures).toEqual(plan.providerCaptures);
  const portal = await createProjectMaterializer({
    packageVersion: PACKAGE_VERSION,
    dependencies: {
      prepare: async () => plan,
      buildSnapshot: buildProjectSnapshot,
    },
  }).run(root, "ensure-current");
  expect(portal.snapshot.providerCaptures).toEqual(plan.providerCaptures);
};

test("Local Setup through Portal changes only Bearing state and the exact managed block", async () => {
  const root = await makeTemporaryDirectory("bearing-zero-intrusion-local-");
  try {
    expect([...new Bun.Glob("**/*").scanSync({ cwd: root, onlyFiles: true })]).toEqual([]);
    const nativeLocators = await writeCompleteLocalScope(root);
    const nativeBefore = await snapshotFiles(root, nativeLocators);
    const agentSurfaceBefore = await readFile(join(root, "AGENTS.md"), "utf8");

    const setup = await setupRepository({
      repoRoot: root,
      packageRoot: process.cwd(),
      surfaces: ["agent-skills"],
      profiles: [],
      provider: {
        key: "matt-skills/v1",
        contractLocator: "docs/agents/issue-tracker.md",
      },
    });
    expect(setup.outcome).toBe("applied");
    await writeValidBearingState(root);

    const plan = await prepareSync(root);
    await commitSyncPlan(plan);
    await assertCompleteProductRead(root, plan);

    expect(await snapshotFiles(root, nativeLocators)).toEqual(nativeBefore);
    const agentSurfaceAfter = await readFile(join(root, "AGENTS.md"), "utf8");
    expect(agentSurfaceAfter).toBe(withBearingManagedPointer(agentSurfaceBefore));
    expect(bearingManagedRange(agentSurfaceBefore)).toBeUndefined();
    expect(bearingManagedRange(agentSurfaceAfter)).toBeDefined();
    expect(JSON.parse(await readFile(join(root, ".bearing/provider.json"), "utf8"))).toEqual({
      schemaVersion: 1,
      provider: "matt-skills/v1",
      contractLocator: "docs/agents/issue-tracker.md",
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

const unboundPullRequest = {
  ...githubIssue({
    number: 6,
    title: "Unbound external pull request",
    labels: ["custom-human"],
    assignees: ["reviewer"],
    body: "This pull request is not in the bound Map hierarchy.",
  }),
  pull_request: {
    url: "https://api.github.com/repos/example/reference/pulls/6",
    html_url: "https://github.com/example/reference/pull/6",
  },
};

const endpointBody = (
  fixtures: Readonly<Record<string, GitHubFixtureResponse>>,
  endpoint: string,
): unknown => {
  const response = fixtures[endpoint]?.first;
  if (response?.status !== 200) {
    throw new TypeError(`Missing deterministic GitHub proof endpoint: ${endpoint}`);
  }
  return response.body;
};

class CredentialBearingTransport implements GitHubReadTransport {
  readonly requests: GitHubReadRequest[] = [];
  credentialBearingResponses = 0;

  constructor(private readonly source: GitHubReadTransport) {}

  async get(request: GitHubReadRequest): Promise<GitHubReadResponse> {
    this.requests.push(request);
    const response = await this.source.get(request);
    this.credentialBearingResponses += 1;
    return {
      ...response,
      headers: {
        ...response.headers,
        "x-test-credential-debug": CREDENTIAL_SENTINEL,
      },
    };
  }
}

const createGitHubZeroIntrusionHarness = () => {
  const fixtures = createReferenceGitHubFixtures();
  fixtures["repos/example/reference/issues/6"] = {
    first: githubFixtureResponse(unboundPullRequest, '"pull-6-v1"'),
  };
  const transport = new CredentialBearingTransport(new FixtureGitHubTransport(fixtures));
  const issueNumbers = [1, 2, 3, 4, 5] as const;
  const snapshot = () =>
    structuredClone({
      repository: endpointBody(fixtures, "repos/example/reference"),
      issues: issueNumbers.map((number) =>
        endpointBody(fixtures, `repos/example/reference/issues/${number}`),
      ),
      pullRequests: [endpointBody(fixtures, "repos/example/reference/issues/6")],
      parentChild: issueNumbers.map((number) => ({
        parent: number,
        children: endpointBody(
          fixtures,
          `repos/example/reference/issues/${number}/sub_issues?per_page=100&page=1`,
        ),
      })),
      dependencies: issueNumbers.map((number) => ({
        issue: number,
        blockers: endpointBody(
          fixtures,
          `repos/example/reference/issues/${number}/dependencies/blocked_by?per_page=100&page=1`,
        ),
      })),
      comments: issueNumbers.map((number) => ({
        issue: number,
        comments: endpointBody(
          fixtures,
          `repos/example/reference/issues/${number}/comments?per_page=100&page=1`,
        ),
      })),
    });
  return { fixtures, transport, snapshot };
};

const writeGitHubProofRepository = async (root: string): Promise<void> => {
  const prepared = await writeStandardGitHubMattProductRepository(root, {
    title: "GitHub zero-intrusion proof",
    intent: "Read one deterministic GitHub scope without native mutation.",
    work: "- [Reference Map](https://github.com/example/reference/issues/1)",
  });
  expect(prepared.setup.outcome).toBe("applied");
};

test("deterministic GitHub before and after proof preserves every native facet", async () => {
  const root = await makeTemporaryDirectory("bearing-zero-intrusion-github-");
  const harness = createGitHubZeroIntrusionHarness();
  try {
    await writeGitHubProofRepository(root);
    const before = harness.snapshot();
    expect(before).toMatchObject({
      repository: {
        id: 9001,
        node_id: "R_reference",
        full_name: "example/reference",
      },
      issues: expect.arrayContaining([
        expect.objectContaining({
          number: 3,
          state: "closed",
          labels: expect.any(Array),
          assignees: expect.any(Array),
          created_at: expect.any(String),
          updated_at: expect.any(String),
          closed_at: expect.any(String),
        }),
      ]),
      pullRequests: [
        expect.objectContaining({
          number: 6,
          pull_request: expect.objectContaining({
            html_url: "https://github.com/example/reference/pull/6",
          }),
        }),
      ],
      parentChild: expect.any(Array),
      dependencies: expect.any(Array),
      comments: expect.any(Array),
    });

    const execution = await captureConsoleLogs(async () => {
      const plan = await prepareSync(root, {
        providerFactory: githubMattProviderFactoryFor(harness.transport),
      });
      await commitSyncPlan(plan);
      const requestCountAfterSync = harness.transport.requests.length;
      await assertCompleteProductRead(root, plan);
      return {
        plan,
        requestCountAfterSync,
        snapshot: await buildSnapshotForSyncPlan(root, PACKAGE_VERSION, plan),
      };
    });
    const { plan, requestCountAfterSync, snapshot } = execution.result;
    expect(harness.transport.credentialBearingResponses).toBeGreaterThan(0);
    expect(
      harness.transport.requests.every(
        (request) => !JSON.stringify(request).includes(CREDENTIAL_SENTINEL),
      ),
    ).toBe(true);
    expect(harness.transport.requests).toHaveLength(requestCountAfterSync);
    expect(harness.snapshot()).toEqual(before);
    expect(plan.providerCaptures[0]).toMatchObject({
      state: "available",
      freshness: { assessment: "current" },
      coverage: { assessment: "complete" },
    });
    expect(ZERO_INTRUSION_PROOF_BOUNDARY).toEqual({
      evidenceKind: "deterministic-fixture",
      proves: ["local-native-bytes-and-mode", "github-native-state", "credential-residue"],
      liveGitHubValidation: {
        state: "not-run",
        owner: "ticket-17",
      },
    });
    await assertNoExactCredentialResidue(root, [
      { name: "input fingerprint", value: plan.fingerprint },
      { name: "Sync report", value: plan.report },
      { name: "Sitemap", value: plan.sitemap },
      { name: "provider capture and evidence", value: JSON.stringify(plan.providerCaptures) },
      { name: "diagnostics", value: JSON.stringify(plan.diagnostics) },
      { name: "Snapshot", value: JSON.stringify(snapshot) },
      { name: "captured console logs", value: execution.logs.join("\n") },
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

class SettlingRetryTransport implements GitHubReadTransport {
  readonly requests: GitHubReadRequest[] = [];
  private changed = false;
  private readonly before: FixtureGitHubTransport;
  private readonly after: FixtureGitHubTransport;

  constructor() {
    const beforeFixtures = createReferenceGitHubFixtures();
    const afterFixtures = createReferenceGitHubFixtures();
    afterFixtures["repos/example/reference/issues/1"] = {
      first: githubFixtureResponse(
        {
          ...githubMapIssue,
          updated_at: "2026-07-29T00:00:00Z",
        },
        '"issue-1-v2"',
      ),
    };
    this.before = new FixtureGitHubTransport(beforeFixtures);
    this.after = new FixtureGitHubTransport(afterFixtures);
  }

  async get(request: GitHubReadRequest): Promise<GitHubReadResponse> {
    this.requests.push(request);
    if (
      !this.changed &&
      request.endpoint === "repos/example/reference/issues/1" &&
      request.validator !== undefined
    ) {
      this.changed = true;
      return {
        status: 200,
        headers: { etag: '"issue-1-v2"' },
        body: {
          ...githubMapIssue,
          updated_at: "2026-07-29T00:00:00Z",
        },
      };
    }
    return (this.changed ? this.after : this.before).get(request);
  }
}

test("credential residue stays absent after one successful full retry", async () => {
  const root = await makeTemporaryDirectory("bearing-credential-retry-");
  try {
    await writeGitHubProofRepository(root);
    const transport = new CredentialBearingTransport(new SettlingRetryTransport());
    const execution = await captureConsoleLogs(async () => {
      const plan = await prepareSync(root, {
        providerFactory: githubMattProviderFactoryFor(transport),
      });
      await commitSyncPlan(plan);
      return {
        plan,
        snapshot: await buildSnapshotForSyncPlan(root, PACKAGE_VERSION, plan),
      };
    });
    const { plan, snapshot } = execution.result;
    const capture = plan.providerCaptures[0];
    expect(capture?.state).toBe("available");
    expect(capture?.freshness.assessment).toBe("current");
    expect(capture?.freshness.evidence).toContainEqual({
      kind: "full-retry-count",
      value: "1",
    });
    expect(transport.credentialBearingResponses).toBeGreaterThan(0);
    expect(
      transport.requests.every((request) => !JSON.stringify(request).includes(CREDENTIAL_SENTINEL)),
    ).toBe(true);
    await assertNoExactCredentialResidue(root, [
      { name: "input fingerprint", value: plan.fingerprint },
      { name: "Sync report", value: plan.report },
      { name: "Sitemap", value: plan.sitemap },
      { name: "provider capture and evidence", value: JSON.stringify(capture) },
      { name: "diagnostics", value: JSON.stringify(plan.diagnostics) },
      { name: "Snapshot", value: JSON.stringify(snapshot) },
      { name: "captured console logs", value: execution.logs.join("\n") },
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
