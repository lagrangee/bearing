import { describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertGitHubRemoteIntegrity,
  configureFixedGitHubValidationRepository,
  createGitHubJourneyEvaluation,
  createGitHubJourneyObservation,
  deriveCandidateScopeKey,
  parseGitHubRepositorySlug,
  readFixedGitHubValidationRepository,
  sanitizeGitHubRemoteInventory,
  validateGitHubRepositoryAccess,
  verifyGitHubJourneyObservation,
} from "../scripts/github-live-journey";

const rawInventory = (scopeKey: string, includeCandidate = true) => ({
  repository: {
    id: "R_private",
    nameWithOwner: "example/bearing-validation",
    isPrivate: true,
    viewerPermission: "WRITE",
    hasIssuesEnabled: true,
    defaultBranchRef: { name: "main" },
    isArchived: false,
    mergeCommitAllowed: true,
    rebaseMergeAllowed: true,
    squashMergeAllowed: true,
    deleteBranchOnMerge: true,
    hasDiscussionsEnabled: false,
    hasProjectsEnabled: false,
    hasWikiEnabled: false,
    isFork: false,
    isTemplate: false,
    description: null,
    homepageUrl: null,
  },
  labels: [{ id: "L_ready", name: "ready-for-agent", color: "0e8a16", description: null }],
  issues: [
    {
      id: "I_historical",
      number: 1,
      state: "CLOSED",
      stateReason: "COMPLETED",
      title: "Historical validation scope",
      body: "Historical private body",
      labels: [{ id: "L_ready", name: "ready-for-agent" }],
      assignees: [],
      milestone: null,
      parent: null,
      subIssues: [],
      blockedBy: [],
      blocking: [],
    },
    ...(includeCandidate
      ? [
          {
            id: "I_candidate",
            number: 20,
            state: "OPEN",
            stateReason: null,
            title: `${scopeKey} candidate map`,
            body: "Candidate private body",
            labels: [{ id: "L_ready", name: "ready-for-agent" }],
            assignees: [{ id: "U_agent", login: "agent" }],
            milestone: null,
            parent: null,
            subIssues: [{ id: "I_candidate_child", number: 21 }],
            blockedBy: [],
            blocking: [{ id: "I_candidate_child", number: 21 }],
          },
          {
            id: "I_candidate_child",
            number: 21,
            state: "OPEN",
            stateReason: null,
            title: `${scopeKey} candidate ticket`,
            body: "Candidate ticket body",
            labels: [{ id: "L_ready", name: "ready-for-agent" }],
            assignees: [],
            milestone: null,
            parent: { id: "I_candidate", number: 20 },
            subIssues: [],
            blockedBy: [{ id: "I_candidate", number: 20 }],
            blocking: [],
          },
        ]
      : []),
  ],
});

describe("GitHub and Active Reconciliation live Journey", () => {
  test("exposes the GitHub support commands through the shared runner", () => {
    const result = Bun.spawnSync([process.execPath, "scripts/run-live-journey.ts", "--help"], {
      cwd: process.cwd(),
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain("prepare-github");
    expect(result.stdout.toString()).toContain("configure-github-repository");
    expect(result.stdout.toString()).toContain("run-github-turn");
    expect(result.stdout.toString()).toContain("evaluate-github");
  });

  test("binds one private repository and one candidate-scoped identity", () => {
    expect(parseGitHubRepositorySlug("example/bearing-validation")).toEqual({
      owner: "example",
      name: "bearing-validation",
      slug: "example/bearing-validation",
    });
    expect(() => parseGitHubRepositorySlug("https://github.com/example/repo")).toThrow(
      "owner/name",
    );
    const candidateScopeInput = {
      packageVersion: "0.1.1",
      sourceCommit: "abcdef0123456789",
      workflowRunId: "123456",
      workflowRunAttempt: 1,
      artifactSha256: "a".repeat(64),
      matrixDefinitionSha256: "b".repeat(64),
    };
    expect(deriveCandidateScopeKey(candidateScopeInput)).toMatch(
      /^bearing-live-0-1-1-[0-9a-f]{64}$/,
    );
    expect(deriveCandidateScopeKey({ ...candidateScopeInput, workflowRunAttempt: 2 })).not.toBe(
      deriveCandidateScopeKey(candidateScopeInput),
    );
    expect(
      deriveCandidateScopeKey({ ...candidateScopeInput, matrixDefinitionSha256: "c".repeat(64) }),
    ).not.toBe(deriveCandidateScopeKey(candidateScopeInput));
    expect(
      validateGitHubRepositoryAccess({
        id: "R_private",
        nameWithOwner: "example/bearing-validation",
        isPrivate: true,
        viewerPermission: "WRITE",
        hasIssuesEnabled: true,
      }),
    ).toMatchObject({ isPrivate: true, viewerPermission: "WRITE" });
    expect(() =>
      validateGitHubRepositoryAccess({
        id: "R_public",
        nameWithOwner: "example/public",
        isPrivate: false,
        viewerPermission: "ADMIN",
        hasIssuesEnabled: true,
      }),
    ).toThrow("private");
  });

  test("configures one fixed private repository identity and refuses silent replacement", async () => {
    const sourceRoot = await mkdtemp(join(tmpdir(), "bearing-fixed-github-repository-"));
    const fakeGitHub = join(sourceRoot, "fake-gh");
    const repository = {
      id: "R_private",
      nameWithOwner: "example/bearing-validation",
      isPrivate: true,
      viewerPermission: "ADMIN",
      hasIssuesEnabled: true,
      defaultBranchRef: { name: "main" },
      isArchived: false,
      mergeCommitAllowed: true,
      rebaseMergeAllowed: true,
      squashMergeAllowed: true,
      deleteBranchOnMerge: true,
      hasDiscussionsEnabled: false,
      hasProjectsEnabled: false,
      hasWikiEnabled: false,
      isFork: false,
      isTemplate: false,
      description: null,
      homepageUrl: null,
    };
    await writeFile(
      fakeGitHub,
      `#!/bin/sh\nprintf '%s\\n' '${JSON.stringify({ data: { repository } })}'\n`,
    );
    await chmod(fakeGitHub, 0o700);
    const initialized = Bun.spawnSync(["git", "init", "-q"], { cwd: sourceRoot });
    expect(initialized.exitCode).toBe(0);

    await configureFixedGitHubValidationRepository({
      sourceRoot,
      repositorySlug: "example/bearing-validation",
      githubProgram: fakeGitHub,
    });
    await expect(readFixedGitHubValidationRepository(sourceRoot)).resolves.toMatchObject({
      configuration: { repositorySlug: "example/bearing-validation" },
    });
    await expect(
      configureFixedGitHubValidationRepository({
        sourceRoot,
        repositorySlug: "example/another-validation",
        githubProgram: fakeGitHub,
      }),
    ).rejects.toThrow("already configured");
  });

  test("keeps remote content private and rejects unrelated remote change", () => {
    const scopeKey = "bearing-live-0-1-1-abcdef012345-123456";
    const before = sanitizeGitHubRemoteInventory(rawInventory(scopeKey, false), scopeKey);
    const unchanged = sanitizeGitHubRemoteInventory(rawInventory(scopeKey), scopeKey);
    const integrity = assertGitHubRemoteIntegrity({
      before,
      after: unchanged,
      authorizedIssueNumbers: [20, 21],
    });

    expect(integrity.authorizedCandidateIssueCount).toBe(2);
    expect(JSON.stringify(before)).not.toContain("Historical private body");
    expect(JSON.stringify(before)).not.toContain("Candidate ticket body");
    expect(JSON.stringify(before)).not.toContain("example/bearing-validation");

    const changed = rawInventory(scopeKey);
    const historical = changed.issues[0];
    if (historical === undefined) throw new Error("Historical issue fixture is missing.");
    historical.state = "OPEN";
    expect(() =>
      assertGitHubRemoteIntegrity({
        before,
        after: sanitizeGitHubRemoteInventory(changed, scopeKey),
        authorizedIssueNumbers: [20, 21],
      }),
    ).toThrow("unauthorized GitHub issue");

    const relationshipChanged = rawInventory(scopeKey);
    const historicalRelationship = relationshipChanged.issues[0];
    if (historicalRelationship === undefined)
      throw new Error("Historical issue fixture is missing.");
    historicalRelationship.blocking = [{ id: "I_candidate", number: 20 }];
    expect(() =>
      assertGitHubRemoteIntegrity({
        before,
        after: sanitizeGitHubRemoteInventory(relationshipChanged, scopeKey),
        authorizedIssueNumbers: [20, 21],
      }),
    ).toThrow("issue or relationship");
  });

  test("verifies bounded Codex and remote observation evidence", async () => {
    const scopeKey = "bearing-live-0-1-1-abcdef012345-123456";
    const workspace = await mkdtemp(join(tmpdir(), "bearing-github-observation-"));
    await Promise.all([
      mkdir(join(workspace, "github/observations"), { recursive: true }),
      mkdir(join(workspace, "github/transcripts"), { recursive: true }),
      mkdir(join(workspace, "github/remote-inventories"), { recursive: true }),
    ]);
    const stdout = [
      JSON.stringify({ type: "thread.started", thread_id: "private-session" }),
      JSON.stringify({ type: "turn.completed" }),
    ].join("\n");
    const remoteBeforeBytes = `${JSON.stringify(
      sanitizeGitHubRemoteInventory(rawInventory(scopeKey, false), scopeKey),
    )}\n`;
    const remoteAfterBytes = `${JSON.stringify(
      sanitizeGitHubRemoteInventory(rawInventory(scopeKey), scopeKey),
    )}\n`;
    const observation = createGitHubJourneyObservation({
      turn: 1,
      codexCliVersion: "codex-cli 0.147.0",
      exitCode: 0,
      stdout,
      stderr: "",
      before: { repository: "a".repeat(64), agentHome: "b".repeat(64) },
      after: { repository: "c".repeat(64), agentHome: "d".repeat(64) },
      transcriptPointer: "github/transcripts/turn-01.jsonl",
      stderrPointer: "github/transcripts/turn-01.stderr.log",
      remoteBeforePointer: "github/remote-inventories/turn-01-before.json",
      remoteBeforeBytes,
      remoteAfterPointer: "github/remote-inventories/turn-01-after.json",
      remoteAfterBytes,
    });
    await Promise.all([
      writeFile(join(workspace, "github/transcripts/turn-01.jsonl"), stdout),
      writeFile(join(workspace, "github/transcripts/turn-01.stderr.log"), ""),
      writeFile(
        join(workspace, "github/remote-inventories/turn-01-before.json"),
        remoteBeforeBytes,
      ),
      writeFile(join(workspace, "github/remote-inventories/turn-01-after.json"), remoteAfterBytes),
      writeFile(join(workspace, "github/observations/turn-01.json"), JSON.stringify(observation)),
    ]);

    await expect(
      verifyGitHubJourneyObservation({
        workspaceRoot: workspace,
        pointer: "github/observations/turn-01.json",
        expectedCodexCliVersion: "codex-cli 0.147.0",
      }),
    ).resolves.toMatchObject({ turn: 1, base: { terminalBoundary: "turn.completed" } });
    await writeFile(join(workspace, "github/remote-inventories/turn-01-after.json"), "{}\n");
    await expect(
      verifyGitHubJourneyObservation({
        workspaceRoot: workspace,
        pointer: "github/observations/turn-01.json",
        expectedCodexCliVersion: "codex-cli 0.147.0",
      }),
    ).rejects.toThrow("remote inventory digest mismatch");
  });

  test("requires one Coordinator verdict for every GitHub Case", () => {
    const verdicts = (["GITHUB-01", "GITHUB-02", "GITHUB-03", "GITHUB-04"] as const).map(
      (caseId, index) => ({
        caseId,
        outcome: "pass" as const,
        judgmentBasis: `Observed the required owner boundary in turn ${index + 1}.`,
        observationPointers: [`github/observations/turn-0${index + 1}.json`],
      }),
    );
    const input = {
      candidate: {
        packageName: "@lagrangee/bearing" as const,
        packageVersion: "0.1.1",
        sourceCommit: "a".repeat(40),
        workflow: { name: "Prepare candidate artifact", runId: "123456", runAttempt: 1 },
        artifact: {
          path: "/private/generated/candidate.tgz",
          file: "candidate.tgz",
          sha256: "b".repeat(64),
        },
        matrixDefinitionSha256: "c".repeat(64),
      },
      codexCliVersion: "codex-cli 0.147.0",
      coordinatorIdentity: "Codex coordinating agent",
      durationMs: 1234,
      repositoryIdentitySha256: "d".repeat(64),
      remoteIntegritySha256: "e".repeat(64),
      verdicts,
    };
    const result = createGitHubJourneyEvaluation(input);

    expect(result.outcome).toBe("pass");
    expect(result.cases).toEqual(verdicts);
    expect(JSON.stringify(result)).not.toContain("example/bearing-validation");
    expect(() => createGitHubJourneyEvaluation({ ...input, verdicts: verdicts.slice(1) })).toThrow(
      "each GitHub Case exactly once",
    );
  });
});
