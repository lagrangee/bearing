import { describe, expect, test } from "bun:test";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, lstat, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertGitHubRemoteIntegrity,
  authorizeGitHubJourneyCommand,
  bindGitHubJourneyCommandToScope,
  configureFixedGitHubValidationRepository,
  createGitHubJourneyObservation,
  deriveGitHubJourneyScopeKey,
  derivePackageScopeKey,
  parseGitHubRepositorySlug,
  provisionIsolatedGitHubAccountSelection,
  readFixedGitHubValidationRepository,
  redactGitHubJourneyScopeIdentity,
  sanitizeGitHubRemoteInventory,
  selectGitHubJourneyCandidateBranch,
  startGitHubJourneyCredentialBroker,
  validateGitHubJourneyRepositoryConfiguration,
  validateGitHubRepositoryAccess,
  verifyGitHubJourneyObservation,
  writeOrVerifyGitHubRemoteBaseline,
} from "../scripts/github-live-journey";

const rawInventory = (scopeKey: string, includeCandidate = true, includeMarker = false) => ({
  candidateBranchCommit: includeCandidate ? "1".repeat(40) : null,
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
      commentCount: 0,
      comments: [] as string[],
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
            body: includeMarker
              ? `Candidate private body\n\nReconciliation marker: ${scopeKey}:after-delivery`
              : "Candidate private body",
            commentCount: 0,
            comments: [] as string[],
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
            commentCount: 0,
            comments: [] as string[],
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
  test("requires an exact candidate-owned Active Configuration baseline", () => {
    const exact = {
      lifecycle: { state: "active", removalRequired: false },
      currentSelections: {
        surfaces: ["agent-skills"],
        provider: { key: "matt-skills/v1", contractLocator: "docs/agents/issue-tracker.md" },
        executorProfiles: [],
      },
      installedCapabilityEvidence: {
        managedPointers: { "agent-skills": "present", claude: "absent" },
      },
      pathSafety: { safe: true },
    } as const;
    expect(() => validateGitHubJourneyRepositoryConfiguration(exact)).not.toThrow();
    expect(() =>
      validateGitHubJourneyRepositoryConfiguration({
        ...exact,
        installedCapabilityEvidence: {
          managedPointers: { "agent-skills": "drifted", claude: "absent" },
        },
      }),
    ).toThrow("exact candidate configuration baseline");
  });

  test("keeps retired GitHub Journey commands outside the public Scenario runner", async () => {
    const result = Bun.spawnSync([process.execPath, "scripts/run-live-journey.ts", "--help"], {
      cwd: process.cwd(),
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain("configure-github-repository");
    expect(result.stdout.toString()).not.toContain("prepare-github");
    expect(result.stdout.toString()).not.toContain("run-github-turn");
    expect(result.stdout.toString()).not.toContain("evaluate-github");
    expect(result.stdout.toString()).toContain("prepare-scenario");
    expect(await readFile("scripts/run-live-journey.ts", "utf8")).not.toContain(
      "githubJourneyBrokerDirectory",
    );
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
      sourceIdentity: "abcdef0123456789",
      packIdentity: "123456/1",
      artifactSha256: "a".repeat(64),
      matrixDefinitionSha256: "b".repeat(64),
    };
    expect(derivePackageScopeKey(candidateScopeInput)).toMatch(/^bearing-live-0-1-1-[0-9a-f]{64}$/);
    expect(derivePackageScopeKey({ ...candidateScopeInput, packIdentity: "123456/2" })).not.toBe(
      derivePackageScopeKey(candidateScopeInput),
    );
    expect(
      derivePackageScopeKey({ ...candidateScopeInput, matrixDefinitionSha256: "c".repeat(64) }),
    ).not.toBe(derivePackageScopeKey(candidateScopeInput));
    const generationId = "11111111-1111-4111-8111-111111111111";
    const firstAttemptScope = deriveGitHubJourneyScopeKey({
      ...candidateScopeInput,
      generationId,
      journeyAttempt: 1,
    });
    expect(firstAttemptScope).toMatch(/^bearing-live-0-1-1-[0-9a-f]{64}$/);
    expect(
      deriveGitHubJourneyScopeKey({
        ...candidateScopeInput,
        generationId,
        journeyAttempt: 1,
      }),
    ).toBe(firstAttemptScope);
    expect(
      deriveGitHubJourneyScopeKey({
        ...candidateScopeInput,
        generationId,
        journeyAttempt: 2,
      }),
    ).not.toBe(firstAttemptScope);
    expect(
      deriveGitHubJourneyScopeKey({
        ...candidateScopeInput,
        generationId: "22222222-2222-4222-8222-222222222222",
        journeyAttempt: 1,
      }),
    ).not.toBe(firstAttemptScope);
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

  test("selects one candidate branch by exact scope identity without fixing its naming style", () => {
    const scopeKey = `bearing-live-0-1-1-${"a".repeat(20)}`;
    expect(
      selectGitHubJourneyCandidateBranch(
        [
          { ref: "refs/heads/main", object: { sha: "1".repeat(40) } },
          { ref: `refs/heads/delivery-${scopeKey}`, object: { sha: "2".repeat(40) } },
        ],
        scopeKey,
      ),
    ).toEqual({ name: `delivery-${scopeKey}`, sha: "2".repeat(40) });
    expect(selectGitHubJourneyCandidateBranch([], scopeKey)).toBeNull();
    expect(() =>
      selectGitHubJourneyCandidateBranch(
        [
          { ref: `refs/heads/${scopeKey}`, object: { sha: "2".repeat(40) } },
          { ref: `refs/heads/delivery/${scopeKey}`, object: { sha: "3".repeat(40) } },
        ],
        scopeKey,
      ),
    ).toThrow("ambiguous");
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

  test("fails one transient GitHub inventory attempt without product retry", async () => {
    const sourceRoot = await mkdtemp(join(tmpdir(), "bearing-github-transient-"));
    const fakeGitHub = join(sourceRoot, "fake-gh");
    const attempts = join(sourceRoot, "attempts");
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
      `#!/bin/sh\ncount=0\nif [ -f '${attempts}' ]; then count=$(cat '${attempts}'); fi\ncount=$((count + 1))\nprintf '%s' "$count" > '${attempts}'\nif [ "$count" -lt 3 ]; then printf '%s\\n' 'tls: x509 transient failure' >&2; exit 1; fi\nprintf '%s\\n' '${JSON.stringify({ data: { repository } })}'\n`,
    );
    await chmod(fakeGitHub, 0o700);
    expect(Bun.spawnSync(["git", "init", "-q"], { cwd: sourceRoot }).exitCode).toBe(0);

    await expect(
      configureFixedGitHubValidationRepository({
        sourceRoot,
        repositorySlug: "example/bearing-validation",
        githubProgram: fakeGitHub,
      }),
    ).rejects.toThrow("tls: x509 transient failure");
    expect(await readFile(attempts, "utf8")).toBe("1");
  });

  test("reuses only an exact pre-behavior GitHub remote baseline", async () => {
    const root = await mkdtemp(join(tmpdir(), "bearing-github-baseline-"));
    const path = join(root, "turn-01-before.json");
    const bytes = '{"repository":"fixed"}\n';

    await expect(writeOrVerifyGitHubRemoteBaseline({ path, bytes })).resolves.toBe("written");
    await expect(writeOrVerifyGitHubRemoteBaseline({ path, bytes })).resolves.toBe("reused");
    await writeFile(path, '{"repository":"changed"}\n');
    await expect(writeOrVerifyGitHubRemoteBaseline({ path, bytes })).rejects.toThrow(
      "remote state changed",
    );
  });

  test("normalizes the GitHub broker to one repository and rejects file or cross-repository access", () => {
    const repositorySlug = "example/bearing-validation";
    expect(
      authorizeGitHubJourneyCommand({
        args: ["issue", "list", "--limit", "20"],
        stdin: "",
        repositorySlug,
      }),
    ).toEqual({
      args: ["issue", "list", "--limit", "20", "--repo", repositorySlug],
      stdin: "",
      effect: { kind: "none" },
    });
    expect(
      authorizeGitHubJourneyCommand({
        args: [
          "api",
          "--method",
          "POST",
          "repos/example/bearing-validation/issues",
          "--raw-field",
          "title=[bearing-live-0-1-1-aaaaaaaaaaaaaaaaaaaa] Delivery scope",
          "--raw-field",
          "body=Candidate scope bearing-live-0-1-1-aaaaaaaaaaaaaaaaaaaa",
          "--jq",
          "{number,id,title,body}",
        ],
        stdin: "",
        repositorySlug,
      }),
    ).toEqual({
      args: [
        "api",
        "--method",
        "POST",
        "repos/example/bearing-validation/issues",
        "--header",
        "Accept: application/vnd.github+json",
        "--header",
        "X-GitHub-Api-Version: 2026-03-10",
        "--raw-field",
        "title=[bearing-live-0-1-1-aaaaaaaaaaaaaaaaaaaa] Delivery scope",
        "--raw-field",
        "body=Candidate scope bearing-live-0-1-1-aaaaaaaaaaaaaaaaaaaa",
        "--jq",
        "{number,id,title,body}",
      ],
      stdin: "",
      effect: {
        kind: "create",
        title: "[bearing-live-0-1-1-aaaaaaaaaaaaaaaaaaaa] Delivery scope",
        body: "Candidate scope bearing-live-0-1-1-aaaaaaaaaaaaaaaaaaaa",
      },
    });
    expect(
      authorizeGitHubJourneyCommand({
        args: [
          "api",
          "--method",
          "POST",
          "repos/example/bearing-validation/issues/20/sub_issues",
          "--field",
          "sub_issue_id=21",
        ],
        stdin: "",
        repositorySlug,
      }),
    ).toEqual({
      args: [
        "api",
        "--method",
        "POST",
        "repos/example/bearing-validation/issues/20/sub_issues",
        "--header",
        "Accept: application/vnd.github+json",
        "--header",
        "X-GitHub-Api-Version: 2026-03-10",
        "--field",
        "sub_issue_id=21",
      ],
      stdin: "",
      effect: { kind: "relation-write", issueNumber: 20, targetDatabaseId: 21 },
    });
    expect(
      authorizeGitHubJourneyCommand({
        args: [
          "api",
          "--method",
          "GET",
          "--hostname",
          "github.com",
          "--include",
          "--header",
          "Accept: application/vnd.github+json",
          "--header",
          "X-GitHub-Api-Version: 2026-03-10",
          "--header",
          'If-None-Match: "candidate-v1"',
          "repos/example/bearing-validation/issues/20",
        ],
        stdin: "",
        repositorySlug,
      }),
    ).toEqual({
      args: [
        "api",
        "--method",
        "GET",
        "repos/example/bearing-validation/issues/20",
        "--header",
        "Accept: application/vnd.github+json",
        "--header",
        "X-GitHub-Api-Version: 2026-03-10",
        "--header",
        'If-None-Match: "candidate-v1"',
        "--include",
      ],
      stdin: "",
      effect: { kind: "none" },
    });
    expect(
      authorizeGitHubJourneyCommand({
        args: [
          "api",
          "repos/example/bearing-validation/issues/20/dependencies/blocked_by",
          "-X",
          "POST",
          "-f",
          "issue_id=22",
        ],
        stdin: "",
        repositorySlug,
      }),
    ).toMatchObject({
      effect: { kind: "relation-write", issueNumber: 20, targetDatabaseId: 22 },
    });
    for (const args of [
      ["auth", "token"],
      ["issue", "delete", "20"],
      ["issue", "list", "--repo", "example/other"],
      ["issue", "view", "https://github.com/example/other/issues/20"],
      ["issue", "edit", "20", "--body-file", "/etc/passwd"],
      ["api", "repos/example/other/issues", "--method", "POST"],
      ["api", "https://api.github.com/repos/example/bearing-validation/issues"],
      ["api", "repos/example/bearing-validation/issues/20", "--input", "/etc/passwd"],
      ["api", "repos/example/bearing-validation/issues/20", "--field", "body=@/etc/passwd"],
      [
        "api",
        "repos/example/bearing-validation/issues/20",
        "--method",
        "PATCH",
        "--raw-field",
        "title=scoped",
        "--raw-field",
        "title=unscoped",
      ],
      ["api", "repos/example/bearing-validation/actions/secrets"],
      ["api", "repos/example/bearing-validation/../other/issues"],
      ["api", "graphql", "--raw-field", "query=query { viewer { login } }"],
      ["api", "repos/example/bearing-validation/issues/20", "--method", "DELETE"],
    ]) {
      expect(() => authorizeGitHubJourneyCommand({ args, stdin: "", repositorySlug })).toThrow();
    }
    expect(() =>
      authorizeGitHubJourneyCommand({
        args: ["api", "user"],
        stdin: "secret input",
        repositorySlug,
      }),
    ).toThrow("stdin");
  });

  test("binds natural GitHub Issue writes to the internal Journey scope", () => {
    const repositorySlug = "example/bearing-validation";
    const scopeKey = `bearing-live-0-1-1-${"a".repeat(20)}`;
    const authorized = authorizeGitHubJourneyCommand({
      args: [
        "issue",
        "create",
        "--title",
        "Candidate marker delivery",
        "--body",
        "Deliver the accepted candidate marker capability.",
        "--label",
        "enhancement",
        "--label",
        "needs-triage",
        "--json",
        "number,title,url,body",
      ],
      stdin: "",
      repositorySlug,
    });

    expect(bindGitHubJourneyCommandToScope(authorized, scopeKey)).toEqual({
      args: [
        "issue",
        "create",
        "--title",
        "Candidate marker delivery",
        "--body",
        `Deliver the accepted candidate marker capability.\n\n<!-- bearing-live-scope:${scopeKey} -->`,
        "--label",
        "enhancement",
        "--label",
        "needs-triage",
        "--json",
        "number,title,url,body",
        "--repo",
        repositorySlug,
      ],
      stdin: "",
      effect: {
        kind: "create",
        title: "Candidate marker delivery",
        body: `Deliver the accepted candidate marker capability.\n\n<!-- bearing-live-scope:${scopeKey} -->`,
      },
    });
  });

  test("keeps the internal Journey scope identity out of Agent-visible GitHub output", () => {
    const scopeKey = `bearing-live-0-1-1-${"a".repeat(20)}`;
    const output = JSON.stringify({
      title: "Ready Label Status Check",
      body: `Natural delivery body.\n\n<!-- bearing-live-scope:${scopeKey} -->`,
      ref: `refs/heads/delivery-${scopeKey}`,
    });

    const redacted = redactGitHubJourneyScopeIdentity(output, scopeKey);
    expect(redacted).not.toContain(scopeKey);
    expect(redacted).not.toContain("bearing-live-scope");
    expect(redacted).toContain("Natural delivery body.");
  });

  test("prepares isolated account selection and a non-secret per-turn credential broker", async () => {
    const testRoot = await mkdtemp("/private/tmp/bgj-");
    const root = join(testRoot, "long-validation-checkout-".repeat(5));
    await mkdir(root);
    const fakeGitHub = join(root, "fake-gh");
    const fakeGit = join(root, "fake-git");
    const issueReadAttempts = join(root, "issue-read-attempts");
    const agentHome = join(root, "agent-home");
    const scopeKey = `bearing-live-0-1-1-${"a".repeat(20)}`;
    await mkdir(agentHome);
    await mkdir(join(root, ".git"));
    await writeFile(
      join(root, ".git/config"),
      '[core]\n\trepositoryformatversion = 0\n[remote "origin"]\n\turl = https://github.com/example/bearing-validation.git\n[user]\n\tname = Bearing Live Matrix\n\temail = live-matrix@example.invalid\n',
    );
    await writeFile(
      fakeGitHub,
      [
        "#!/bin/sh",
        'if [ "$1" = "auth" ] && [ "$2" = "token" ]; then printf \'%s\\n\' \'fake-secret-token\'; exit 0; fi',
        `case " $* " in *' user '*) if [ -n "$GH_TOKEN" ]; then printf '{}\\n' > "\${GH_CONFIG_DIR:-$HOME/.config/gh}/hosts.yml"; fi; printf '%s\\n' 'example-agent';; *'issues?state=all&per_page=100'*) count=0; if [ -f '${issueReadAttempts}' ]; then count=$(cat '${issueReadAttempts}'); fi; count=$((count + 1)); printf '%s' "$count" > '${issueReadAttempts}'; if [ "$count" -eq 1 ]; then printf '%s\\n' '[[]]'; elif [ "$count" -eq 2 ]; then printf '%s\\n' '${JSON.stringify(
          [
            [
              {
                id: 21,
                number: 20,
                title: "Candidate marker delivery",
                body: `Parent body\n\n<!-- bearing-live-scope:${scopeKey} -->`,
              },
            ],
          ],
        )}'; else printf '%s\\n' '${JSON.stringify([
          [
            {
              id: 21,
              number: 20,
              title: "Candidate marker delivery",
              body: `Parent body\n\n<!-- bearing-live-scope:${scopeKey} -->`,
            },
            {
              id: 22,
              number: 21,
              title: "Implement candidate marker",
              body: `Child body\n\n<!-- bearing-live-scope:${scopeKey} -->`,
            },
            { id: 999, number: 1, title: "historical", body: "" },
          ],
        ])}'; fi;; *) printf '%s\\n' '{}';; esac`,
        "",
      ].join("\n"),
    );
    await chmod(fakeGitHub, 0o700);
    await writeFile(
      fakeGit,
      [
        "#!/bin/sh",
        `state=${JSON.stringify(`${fakeGit}.pushed`)}`,
        `scope=${JSON.stringify(scopeKey)}`,
        `head=${JSON.stringify("1".repeat(40))}`,
        "safe_hooks=0",
        "safe_credentials=0",
        'for argument in "$@"; do',
        '  [ "$argument" = "core.hooksPath=/dev/null" ] && safe_hooks=1',
        '  [ "$argument" = "credential.helper=" ] && safe_credentials=1',
        "done",
        'if [ "$safe_hooks" -ne 1 ] || [ "$safe_credentials" -ne 1 ] || [ "$GIT_CONFIG_GLOBAL" != "/dev/null" ]; then',
        "  printf '%s\\n' \"$" + '{BEARING_GITHUB_PUSH_TOKEN:-missing}" > "$0.unsafe-environment"',
        "  exit 65",
        "fi",
        'while [ "$1" = "-c" ]; do shift 2; done',
        'case "$1 $2" in',
        "  \"remote get-url\") printf '%s\\n' 'https://github.com/example/bearing-validation.git';;",
        '  "status --porcelain=v1") :;;',
        '  "rev-parse HEAD") printf \'%s\\n\' "$head";;',
        '  "check-ref-format --branch") :;;',
        '  "ls-remote --heads") [ "$3" = "https://github.com/example/bearing-validation.git" ] || exit 64; if [ -f "$state" ]; then printf \'%s\\t%s\\n\' "$head" "$(cat "$state")"; fi;;',
        `  "push https://github.com/example/bearing-validation.git") printf 'refs/heads/%s\\n' "\${3#HEAD:}" > "$state"; printf 'branch pushed\\n';;`,
        "  *) printf 'unexpected fake git command: %s\\n' \"$*\" >&2; exit 64;;",
        "esac",
        "",
      ].join("\n"),
    );
    await chmod(fakeGit, 0o700);

    await provisionIsolatedGitHubAccountSelection({
      program: fakeGitHub,
      agentHome,
      gitProgram: fakeGit,
    });
    const source = await readFile(join(agentHome, ".config/gh/hosts.yml"), "utf8");
    const preparedGitConfigSha256 = createHash("sha256")
      .update(await readFile(join(root, ".git/config")))
      .digest("hex");
    expect(source).toBe(
      "github.com:\n  git_protocol: https\n  users:\n    example-agent: {}\n  user: example-agent\n",
    );
    expect(source).not.toMatch(/oauth_token|token:/iu);
    const broker = await startGitHubJourneyCredentialBroker({
      program: fakeGitHub,
      agentHome,
      repositoryRoot: root,
      repositorySlug: "example/bearing-validation",
      scopeKey,
      preparedGitConfigSha256,
      gitProgram: fakeGit,
      baseEnvironment: { HOME: agentHome, CODEX_HOME: join(agentHome, ".codex"), PATH: "/bin" },
    });
    const environment = broker.environment;
    expect(broker.socketPath).toMatch(/^\/private\/tmp\/bgj-[0-9a-f]{24}\/broker\.sock$/u);
    expect(Buffer.byteLength(broker.socketPath, "utf8")).toBeLessThanOrEqual(103);
    const launcherPath = join(agentHome, ".local/bin/gh");
    const launcher = await readFile(launcherPath, "utf8");
    const gitLauncher = await readFile(join(agentHome, ".local/bin/git"), "utf8");
    const bearingLauncher = await readFile(join(agentHome, ".local/bin/bearing"), "utf8");
    const shellEnvironment = await readFile(
      join(agentHome, ".config/bearing-live-journey/.zprofile"),
      "utf8",
    );
    expect(launcher).toContain("github-client.ts");
    expect(launcher).not.toContain("BEARING_GITHUB_OPERATOR_HOME");
    expect(launcher).not.toContain("GH_CONFIG_DIR");
    expect(launcher).not.toContain("oauth_token");
    expect(gitLauncher).toContain("github-client.ts");
    expect(gitLauncher).toContain(fakeGit);
    expect(gitLauncher).not.toContain("fake-secret-token");
    const client = await readFile(
      join(agentHome, ".config/bearing-live-journey/github-client.ts"),
      "utf8",
    );
    expect(client).toContain('sandbox_permissions="require_escalated"');
    expect(client).toContain("Retry this exact gh or git push command once");
    expect(bearingLauncher).toContain(join(agentHome, ".bearing/bin/bearing"));
    expect(environment).not.toHaveProperty("GH_TOKEN");
    expect(environment).not.toHaveProperty("BEARING_GITHUB_OPERATOR_HOME");
    expect(environment["BEARING_GITHUB_BROKER_SOCKET"]).toBe(broker.socketPath);
    expect(environment).not.toHaveProperty("BEARING_GITHUB_BROKER_ENDPOINT");
    expect(environment).not.toHaveProperty("BEARING_GITHUB_BROKER_MAILBOX");
    expect(environment["BEARING_GITHUB_BROKER_AUTH"]).toMatch(/^[0-9a-f]{64}$/u);
    const socketPermission = `permissions.bearing_live_journey.network={enabled=true,unix_sockets={${JSON.stringify(
      broker.socketPath,
    )}="allow"}}`;
    expect(broker.codexArguments).toEqual([
      "-c",
      socketPermission,
      "-c",
      expect.stringMatching(/^auto_review\.policy=/u),
    ]);
    expect(broker.codexArguments.join(" ")).not.toContain("domains");
    expect(broker.codexArguments[3]).toContain("exact gh command");
    expect(broker.codexArguments[3]).toContain("fixed Journey repository");
    expect(broker.codexArguments[3]).toContain("Do not approve other escalated commands");
    expect(environment["PATH"]).toStartWith(join(agentHome, ".local/bin"));
    expect(shellEnvironment).toContain(join(agentHome, ".local/bin"));
    expect(environment["ZDOTDIR"]).toBe(join(agentHome, ".config/bearing-live-journey"));
    const loginShell = Bun.spawn(["/bin/zsh", "-lc", "gh api user --jq .login"], {
      env: environment,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(await loginShell.exited).toBe(0);
    expect((await new Response(loginShell.stdout).text()).trim()).toBe("example-agent");
    const nestedLogin = await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
      execFile(
        join(agentHome, ".local/bin/gh"),
        ["api", "user", "--jq", ".login"],
        { env: environment, timeout: 1_000 },
        (error, stdout, stderr) => {
          if (error !== null) {
            reject(error);
            return;
          }
          resolve({ stdout, stderr });
        },
      );
    });
    expect(nestedLogin).toEqual({ stdout: "example-agent\n", stderr: "" });
    if (process.platform === "darwin") {
      const sandboxedLogin = Bun.spawn(
        [
          "/usr/bin/sandbox-exec",
          "-p",
          "(version 1)(allow default)(deny network*)(allow network-outbound (remote unix-socket))",
          join(agentHome, ".local/bin/gh"),
          "api",
          "user",
          "--jq",
          ".login",
        ],
        { env: environment, stdout: "pipe", stderr: "pipe" },
      );
      const [sandboxedExitCode, sandboxedStdout, sandboxedStderr] = await Promise.all([
        sandboxedLogin.exited,
        new Response(sandboxedLogin.stdout).text(),
        new Response(sandboxedLogin.stderr).text(),
      ]);
      expect(sandboxedExitCode, sandboxedStderr).toBe(0);
      expect(sandboxedStdout.trim()).toBe("example-agent");
    }
    const tokenRead = Bun.spawn([join(agentHome, ".local/bin/gh"), "auth", "token"], {
      env: environment,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(await tokenRead.exited).not.toBe(0);
    expect(await new Response(tokenRead.stdout).text()).toBe("");
    const scopedCreate = Bun.spawn(
      [
        join(agentHome, ".local/bin/gh"),
        "issue",
        "create",
        "--title",
        "Candidate marker delivery",
        "--body",
        "Deliver the accepted candidate marker capability.",
      ],
      { env: environment, stdout: "pipe", stderr: "pipe" },
    );
    expect(await scopedCreate.exited).toBe(0);
    const secondCreate = Bun.spawn(
      [
        join(agentHome, ".local/bin/gh"),
        "issue",
        "create",
        "--title",
        "Implement candidate marker",
        "--body",
        "Implement and verify the accepted capability.",
      ],
      { env: environment, stdout: "pipe", stderr: "pipe" },
    );
    expect(await secondCreate.exited).toBe(0);
    const extraCreate = Bun.spawn(
      [
        join(agentHome, ".local/bin/gh"),
        "issue",
        "create",
        "--title",
        "Unexpected extra work",
        "--body",
        "This third Issue is outside the bounded Scenario.",
      ],
      { env: environment, stdout: "pipe", stderr: "pipe" },
    );
    expect(await extraCreate.exited).not.toBe(0);
    const allowedMutation = Bun.spawn(
      [
        join(agentHome, ".local/bin/gh"),
        "api",
        "--method",
        "POST",
        "repos/example/bearing-validation/issues/20/sub_issues",
        "--raw-field",
        "sub_issue_id=21",
      ],
      { env: environment, stdout: "pipe", stderr: "pipe" },
    );
    expect(await allowedMutation.exited).toBe(0);
    const crossRepositoryMutation = Bun.spawn(
      [
        join(agentHome, ".local/bin/gh"),
        "api",
        "--method",
        "POST",
        "repos/example/bearing-validation/issues/20/dependencies/blocked_by",
        "--raw-field",
        "issue_id=999",
      ],
      { env: environment, stdout: "pipe", stderr: "pipe" },
    );
    expect(await crossRepositoryMutation.exited).not.toBe(0);
    const historicalWrite = Bun.spawn([join(agentHome, ".local/bin/gh"), "issue", "close", "1"], {
      env: environment,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(await historicalWrite.exited).not.toBe(0);
    const identityPreservingEdit = Bun.spawn(
      [join(agentHome, ".local/bin/gh"), "issue", "edit", "20", "--body", "Updated body"],
      { env: environment, stdout: "pipe", stderr: "pipe" },
    );
    expect(await identityPreservingEdit.exited).toBe(0);
    const pushed = Bun.spawn(
      [
        join(agentHome, ".local/bin/git"),
        "-c",
        "credential.helper=!gh auth git-credential",
        "push",
        "--set-upstream",
        "origin",
        "HEAD:candidate-marker-delivery",
      ],
      { env: environment, stdout: "pipe", stderr: "pipe" },
    );
    expect(await pushed.exited).toBe(0);
    expect(await new Response(pushed.stdout).text()).toContain("branch pushed");
    expect(await readFile(`${fakeGit}.pushed`, "utf8")).toBe(`refs/heads/delivery-${scopeKey}\n`);
    await expect(lstat(`${fakeGit}.unsafe-environment`)).rejects.toMatchObject({ code: "ENOENT" });
    const duplicateScopeBranch = Bun.spawn(
      [join(agentHome, ".local/bin/git"), "push", "origin", `HEAD:${scopeKey}`],
      { env: environment, stdout: "pipe", stderr: "pipe" },
    );
    expect(await duplicateScopeBranch.exited).not.toBe(0);
    const wrongPush = Bun.spawn(
      [join(agentHome, ".local/bin/git"), "push", "--force", "origin", `HEAD:${scopeKey}`],
      { env: environment, stdout: "pipe", stderr: "pipe" },
    );
    expect(await wrongPush.exited).not.toBe(0);
    const fileInput = Bun.spawn(
      [
        join(agentHome, ".local/bin/gh"),
        "api",
        "repos/example/bearing-validation/issues/20",
        "--input",
        "/etc/passwd",
      ],
      { env: environment, stdout: "pipe", stderr: "pipe" },
    );
    expect(await fileInput.exited).not.toBe(0);
    expect(await readFile(join(agentHome, ".config/gh/hosts.yml"), "utf8")).toBe(source);
    await broker.stop();
    const afterStop = Bun.spawn([join(agentHome, ".local/bin/gh"), "api", "user"], {
      env: environment,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(await afterStop.exited).not.toBe(0);
    const compromisedMarker = join(root, "compromised-wrapper-ran");
    await writeFile(
      launcherPath,
      `#!/bin/sh\nprintf '%s\\n' compromised > ${JSON.stringify(compromisedMarker)}\nexit 64\n`,
      { mode: 0o700 },
    );
    await expect(
      startGitHubJourneyCredentialBroker({
        program: fakeGitHub,
        agentHome,
        repositoryRoot: root,
        repositorySlug: "example/bearing-validation",
        scopeKey,
        preparedGitConfigSha256,
        gitProgram: fakeGit,
        baseEnvironment: { HOME: agentHome, CODEX_HOME: join(agentHome, ".codex"), PATH: "/bin" },
      }),
    ).rejects.toThrow("support file conflicts");
    await expect(lstat(compromisedMarker)).rejects.toMatchObject({ code: "ENOENT" });
    await writeFile(launcherPath, launcher, { mode: 0o700 });
    const resumedBroker = await startGitHubJourneyCredentialBroker({
      program: fakeGitHub,
      agentHome,
      repositoryRoot: root,
      repositorySlug: "example/bearing-validation",
      scopeKey,
      preparedGitConfigSha256,
      gitProgram: fakeGit,
      baseEnvironment: { HOME: agentHome, CODEX_HOME: join(agentHome, ".codex"), PATH: "/bin" },
    });
    expect(resumedBroker.socketPath).toBe(broker.socketPath);
    expect(resumedBroker.environment["BEARING_GITHUB_BROKER_AUTH"]).toBe(
      environment["BEARING_GITHUB_BROKER_AUTH"],
    );
    await resumedBroker.stop();
    await writeFile(
      join(root, ".git/config"),
      "[core]\n\trepositoryformatversion = 0\n[http]\n\tproxy = http://127.0.0.1:7777\n",
    );
    await expect(
      startGitHubJourneyCredentialBroker({
        program: fakeGitHub,
        agentHome,
        repositoryRoot: root,
        repositorySlug: "example/bearing-validation",
        scopeKey,
        preparedGitConfigSha256,
        gitProgram: fakeGit,
        baseEnvironment: { HOME: agentHome, CODEX_HOME: join(agentHome, ".codex"), PATH: "/bin" },
      }),
    ).rejects.toThrow("configuration changed after Scenario preparation");
    await expect(
      provisionIsolatedGitHubAccountSelection({
        program: fakeGitHub,
        agentHome,
        gitProgram: fakeGit,
      }),
    ).resolves.toBeUndefined();
    await writeFile(join(agentHome, ".config/gh/hosts.yml"), "github.com: conflict\n");
    await expect(
      provisionIsolatedGitHubAccountSelection({
        program: fakeGitHub,
        agentHome,
        gitProgram: fakeGit,
      }),
    ).rejects.toThrow("conflicts");
  });

  test("keeps remote content private and rejects unrelated remote change", () => {
    const scopeKey = "bearing-live-0-1-1-abcdef012345-123456";
    const before = sanitizeGitHubRemoteInventory(rawInventory(scopeKey, false), scopeKey);
    const unchanged = sanitizeGitHubRemoteInventory(rawInventory(scopeKey), scopeKey);
    const integrity = assertGitHubRemoteIntegrity({
      before,
      after: unchanged,
      authorizedIssueNumbers: [20, 21],
      requireCandidateBranch: true,
    });

    expect(integrity.authorizedCandidateIssueCount).toBe(2);
    expect(unchanged.candidateBranchCommit).toBe("1".repeat(40));
    expect(JSON.stringify(before)).not.toContain("Historical private body");
    expect(JSON.stringify(before)).not.toContain("Candidate ticket body");
    expect(JSON.stringify(before)).not.toContain("example/bearing-validation");
    expect(() =>
      assertGitHubRemoteIntegrity({
        before,
        after: unchanged,
        authorizedIssueNumbers: [20],
      }),
    ).toThrow("unauthorized GitHub issue");

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
      durationMs: 100,
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
});
