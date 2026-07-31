import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, rename, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createNativeScopeDiscoveryObservation,
  type NativeScopeDiscoveryProvider,
  readNativeScopeDiscoveryStore,
  selectNativeScopeDiscovery,
} from "../src/native-scope-discovery";
import {
  discoverGitHubMattScopes,
  discoverLocalMattScopes,
} from "../src/providers/matt-skills-v1/discovery";
import type {
  GitHubReadRequest,
  GitHubReadResponse,
  GitHubReadTransport,
} from "../src/providers/matt-skills-v1/github";
import { prepareSync } from "../src/sync-plan";
import { createValidBearingRepo } from "./helpers";

const contract = `# Issue tracker: Local Markdown

Provider contract: \`matt-skills/v1\`

## Conventions

- One feature per directory: \`.scratch/<feature-slug>/\`
- The PRD is \`.scratch/<feature-slug>/PRD.md\`
- Implementation issues are \`.scratch/<feature-slug>/issues/<NN>-<slug>.md\`, numbered from \`01\`
- Triage state is recorded as a \`Status:\` line
- See \`triage-labels.md\`

## Wayfinding operations

- Map: \`.scratch/<effort>/map.md\`
- Child ticket: \`.scratch/<effort>/issues/NN-<slug>.md\`
`;

const triage = `# Triage Labels

| Label in mattpocock/skills | Label in our tracker |
| --- | --- |
| needs-triage | needs-triage |
| needs-info | needs-info |
| ready-for-agent | ready-for-agent |
| ready-for-human | ready-for-human |
| wontfix | wontfix |
`;

const issue = (title: string, status = "ready-for-agent") => `# ${title}

**What to build:** Deliver ${title}.

**Status:** ${status}

- [ ] Acceptance
`;

const createLocalRepo = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), "bearing-native-discovery-"));
  await mkdir(join(root, "docs/agents"), { recursive: true });
  await mkdir(join(root, ".bearing/cache"), { recursive: true });
  await mkdir(join(root, ".scratch/alpha/issues"), { recursive: true });
  await mkdir(join(root, ".scratch/alpha/research"), { recursive: true });
  await mkdir(join(root, ".scratch/beta/issues"), { recursive: true });
  await mkdir(join(root, ".scratch/not-a-scope/evidence"), { recursive: true });
  await writeFile(join(root, "docs/agents/issue-tracker.md"), contract);
  await writeFile(join(root, "docs/agents/triage-labels.md"), triage);
  await writeFile(join(root, ".scratch/alpha/PRD.md"), "# Alpha product\n");
  await writeFile(join(root, ".scratch/alpha/issues/01-first.md"), issue("First"));
  await writeFile(join(root, ".scratch/alpha/research/notes.md"), "# Research should not leak\n");
  await writeFile(join(root, ".scratch/beta/issues/01-malformed.md"), "# Still identity-bearing\n");
  await writeFile(join(root, ".scratch/not-a-scope/evidence/report.md"), "# Evidence only\n");
  return root;
};

const githubRepository = {
  id: 7,
  node_id: "R_repo",
  name: "project",
  full_name: "owner/project",
  html_url: "https://github.com/owner/project",
  owner: { login: "owner", id: 8, node_id: "U_owner" },
};

const githubIssue = (
  number: number,
  nodeId: string,
  title: string,
  labels: readonly string[],
  state: "open" | "closed" = "open",
) => ({
  id: number,
  node_id: nodeId,
  number,
  html_url: `https://github.com/owner/project/issues/${number}`,
  repository_url: "https://api.github.com/repos/owner/project",
  title,
  body: "",
  state,
  created_at: "2026-07-30T00:00:00Z",
  updated_at: "2026-07-31T00:00:00Z",
  closed_at: state === "closed" ? "2026-07-31T00:00:00Z" : null,
  labels: labels.map((name) => ({ name })),
  assignees: [],
  user: { login: "owner", id: 8, node_id: "U_owner" },
  author_association: "OWNER",
});

describe("Matt Native Scope Discovery", () => {
  test("Local discovery admits only contract-declared direct roots and publishes summaries", async () => {
    const root = await createLocalRepo();
    const before = await readdir(join(root, ".scratch"), { recursive: true });
    const observation = await discoverLocalMattScopes({
      repoRoot: root,
      contractLocator: "docs/agents/issue-tracker.md",
      triageLocator: "docs/agents/triage-labels.md",
      clock: () => new Date("2026-07-31T06:00:00.000Z"),
    });
    const after = await readdir(join(root, ".scratch"), { recursive: true });

    expect(after.sort()).toEqual(before.sort());
    expect(observation.state).toBe("partial");
    expect(observation.coverage.assessment).toBe("incomplete");
    expect(observation.scopes.map((scope) => scope.binding.nativeScope)).toEqual([
      ".scratch/alpha",
      ".scratch/beta",
    ]);
    expect(observation.scopes[0]?.subjects.map((subject) => subject.locator)).toEqual([
      ".scratch/alpha/PRD.md",
      ".scratch/alpha/issues/01-first.md",
    ]);
    expect(observation.scopes.flatMap((scope) => scope.subjects)).not.toContainEqual(
      expect.objectContaining({ title: "Research should not leak" }),
    );
    expect(observation.scopes[1]).toEqual(
      expect.objectContaining({
        rootRole: "parent-scope",
        subjects: [
          expect.objectContaining({
            classification: "unknown",
            locator: ".scratch/beta/issues/01-malformed.md",
            title: "Still identity-bearing",
          }),
        ],
      }),
    );
    expect(observation.diagnostics).toContainEqual(
      expect.objectContaining({ code: "matt.local.discovery.summary-partial" }),
    );
    expect(JSON.stringify(observation)).not.toContain("Deliver First");
  });

  test("Local scope move creates a new locator identity", async () => {
    const root = await createLocalRepo();
    const first = await discoverLocalMattScopes({
      repoRoot: root,
      contractLocator: "docs/agents/issue-tracker.md",
    });
    await rename(join(root, ".scratch/alpha"), join(root, ".scratch/renamed"));
    const second = await discoverLocalMattScopes({
      repoRoot: root,
      contractLocator: "docs/agents/issue-tracker.md",
    });
    expect(first.scopes[0]?.identity).not.toBe(second.scopes.at(-1)?.identity);
    expect(second.scopes.map((scope) => scope.binding.nativeScope)).toContain(".scratch/renamed");
  });

  test("Local discovery rejects a .scratch root symlink instead of confirming empty", async () => {
    const root = await createLocalRepo();
    const external = await mkdtemp(join(tmpdir(), "bearing-external-scratch-"));
    await rename(join(root, ".scratch"), join(root, ".scratch-original"));
    await symlink(external, join(root, ".scratch"), "dir");

    const observation = await discoverLocalMattScopes({
      repoRoot: root,
      contractLocator: "docs/agents/issue-tracker.md",
    });

    expect(observation.state).toBe("unavailable");
    expect(observation.coverage.assessment).toBe("incomplete");
    expect(observation.confirmedEmpty).toBe(false);
    expect(observation.scopes).toEqual([]);
  });

  test("Local discovery stops with explicit uncertainty at its operation-wide read budget", async () => {
    const root = await createLocalRepo();
    const observation = await discoverLocalMattScopes({
      repoRoot: root,
      contractLocator: "docs/agents/issue-tracker.md",
      maximumFiles: 2,
    });

    expect(observation.state).toBe("partial");
    expect(observation.coverage.assessment).toBe("incomplete");
    expect(observation.confirmedEmpty).toBe(false);
    expect(observation.diagnostics).toContainEqual(
      expect.objectContaining({ code: "matt.local.discovery.resource-budget" }),
    );
  });

  test("Local discovery uses the confirmed triage vocabulary for coarse lifecycle", async () => {
    const root = await createLocalRepo();
    await writeFile(
      join(root, "docs/agents/triage-labels.md"),
      triage.replace("| wontfix | wontfix |", "| wontfix | declined |"),
    );
    await writeFile(join(root, ".scratch/alpha/issues/01-first.md"), issue("First", "declined"));
    const observation = await discoverLocalMattScopes({
      repoRoot: root,
      contractLocator: "docs/agents/issue-tracker.md",
    });

    expect(
      observation.scopes
        .flatMap((scope) => scope.subjects)
        .find((subject) => subject.title === "First")?.lifecycle,
    ).toBe("closed");
  });

  test("Discovery observation identity and subject hierarchy are content-addressed", async () => {
    const root = await createLocalRepo();
    const observation = await discoverLocalMattScopes({
      repoRoot: root,
      contractLocator: "docs/agents/issue-tracker.md",
    });
    const scope = observation.scopes[0];
    if (scope === undefined) throw new Error("Expected one Local discovery scope.");
    const subject = scope.subjects[0];
    if (subject === undefined) throw new Error("Expected one Local discovery subject.");
    expect(() =>
      createNativeScopeDiscoveryObservation({
        provider: observation.provider,
        state: observation.state,
        observedAt: observation.observedAt,
        freshness: observation.freshness.assessment,
        coverage: observation.coverage.assessment,
        scopes: [
          {
            ...scope,
            subjects: [
              {
                ...subject,
                identity: "subject:a",
                parentIdentity: "subject:b",
              },
              {
                ...subject,
                identity: "subject:b",
                parentIdentity: "subject:a",
              },
            ],
          },
        ],
        diagnostics: observation.diagnostics,
      }),
    ).toThrow(/acyclic/u);
  });

  test("ordinary selection reuses the immutable latest view without provider acquisition", async () => {
    const root = await createLocalRepo();
    let acquisitions = 0;
    const provider: NativeScopeDiscoveryProvider = {
      id: "matt-skills/v1",
      discover: async () => {
        acquisitions += 1;
        return discoverLocalMattScopes({
          repoRoot: root,
          contractLocator: "docs/agents/issue-tracker.md",
        });
      },
    };
    const explicit = await selectNativeScopeDiscovery({
      repoRoot: root,
      intent: "explicit-discovery",
      provider,
    });
    await writeFile(explicit.storePath, explicit.storeBytes);
    expect((await readNativeScopeDiscoveryStore(root)).kind).toBe("available");
    const ordinary = await selectNativeScopeDiscovery({
      repoRoot: root,
      intent: "ordinary-sync",
      provider: {
        id: "matt-skills/v1",
        discover: async () => {
          throw new Error("ordinary Sync must not acquire");
        },
      },
    });

    expect(acquisitions).toBe(1);
    expect(ordinary.operation.acquisitionCount).toBe(0);
    expect(ordinary.view?.observationId).toBe(explicit.view?.observationId);
    expect(ordinary.storeChanged).toBe(false);
  });

  test("a failed latest attempt preserves prior scopes and exposes the attempt", async () => {
    const root = await createLocalRepo();
    const success = await selectNativeScopeDiscovery({
      repoRoot: root,
      intent: "explicit-discovery",
      provider: {
        id: "matt-skills/v1",
        discover: () =>
          discoverLocalMattScopes({
            repoRoot: root,
            contractLocator: "docs/agents/issue-tracker.md",
          }),
      },
    });
    await writeFile(success.storePath, success.storeBytes);
    const failed = await selectNativeScopeDiscovery({
      repoRoot: root,
      intent: "explicit-discovery",
      provider: {
        id: "matt-skills/v1",
        discover: async () =>
          createNativeScopeDiscoveryObservation({
            provider: "matt-skills/v1",
            state: "unavailable",
            observedAt: "2026-07-31T06:10:00.000Z",
            freshness: "undetermined",
            coverage: "incomplete",
            scopes: [],
            diagnostics: [
              {
                code: "matt.discovery.network",
                class: "network",
                impact: "blocking",
                target: "github.com",
                message: "The repository could not be read.",
              },
            ],
          }),
      },
    });

    expect(failed.view?.scopes.length).toBeGreaterThan(0);
    expect(failed.view?.freshness).toBe("undetermined");
    expect(failed.view?.latestAttempt).toEqual(
      expect.objectContaining({ state: "unavailable", observedAt: "2026-07-31T06:10:00.000Z" }),
    );
  });

  test("discovery history stays bounded to the selected observation and latest attempt", async () => {
    const root = await createLocalRepo();
    const success = await selectNativeScopeDiscovery({
      repoRoot: root,
      intent: "explicit-discovery",
      provider: {
        id: "matt-skills/v1",
        discover: () =>
          discoverLocalMattScopes({
            repoRoot: root,
            contractLocator: "docs/agents/issue-tracker.md",
          }),
      },
    });
    await writeFile(success.storePath, success.storeBytes);
    for (const minute of [10, 11, 12]) {
      const failed = await selectNativeScopeDiscovery({
        repoRoot: root,
        intent: "explicit-discovery",
        provider: {
          id: "matt-skills/v1",
          discover: async () =>
            createNativeScopeDiscoveryObservation({
              provider: "matt-skills/v1",
              state: "unavailable",
              observedAt: `2026-07-31T08:${minute}:00.000Z`,
              freshness: "undetermined",
              coverage: "incomplete",
              scopes: [],
              diagnostics: [
                {
                  code: "matt.discovery.network",
                  class: "network",
                  impact: "blocking",
                  target: "github.com",
                  message: "The repository could not be read.",
                },
              ],
            }),
        },
      });
      await writeFile(failed.storePath, failed.storeBytes);
    }

    const read = await readNativeScopeDiscoveryStore(root);
    expect(read.kind).toBe("available");
    expect(read.kind === "available" ? read.store.observations : []).toHaveLength(2);
  });

  test("store consistency rejects a latest attempt that contradicts its observation", async () => {
    const root = await createLocalRepo();
    const explicit = await selectNativeScopeDiscovery({
      repoRoot: root,
      intent: "explicit-discovery",
      provider: {
        id: "matt-skills/v1",
        discover: () =>
          discoverLocalMattScopes({
            repoRoot: root,
            contractLocator: "docs/agents/issue-tracker.md",
          }),
      },
    });
    const observationId = explicit.store.selection.observationId;
    if (observationId === null) throw new Error("Expected a selected discovery observation.");
    await writeFile(
      explicit.storePath,
      JSON.stringify({
        ...explicit.store,
        selection: {
          ...explicit.store.selection,
          latestAttempt: {
            observationId,
            state: "unavailable",
            observedAt: explicit.view?.observedAt,
            diagnostics: [],
          },
        },
      }),
    );

    expect((await readNativeScopeDiscoveryStore(root)).kind).toBe("malformed");
  });

  test("store consistency rejects content drift and hidden failed history", async () => {
    const root = await createLocalRepo();
    const success = await selectNativeScopeDiscovery({
      repoRoot: root,
      intent: "explicit-discovery",
      provider: {
        id: "matt-skills/v1",
        discover: () =>
          discoverLocalMattScopes({
            repoRoot: root,
            contractLocator: "docs/agents/issue-tracker.md",
          }),
      },
    });
    const tampered = JSON.parse(success.storeBytes.toString("utf8")) as {
      observations: Array<{ scopes: Array<{ title: string }> }>;
    };
    const firstScope = tampered.observations[0]?.scopes[0];
    if (firstScope === undefined) throw new Error("Expected one persisted discovery scope.");
    firstScope.title = "Tampered without a new identity";
    await writeFile(success.storePath, JSON.stringify(tampered));
    expect((await readNativeScopeDiscoveryStore(root)).kind).toBe("malformed");

    await writeFile(success.storePath, success.storeBytes);
    const failed = await selectNativeScopeDiscovery({
      repoRoot: root,
      intent: "explicit-discovery",
      provider: {
        id: "matt-skills/v1",
        discover: async () =>
          createNativeScopeDiscoveryObservation({
            provider: "matt-skills/v1",
            state: "unavailable",
            observedAt: "2026-07-31T08:15:00.000Z",
            freshness: "undetermined",
            coverage: "incomplete",
            scopes: [],
            diagnostics: [
              {
                code: "matt.discovery.network",
                class: "network",
                impact: "blocking",
                target: "github.com",
                message: "The repository could not be read.",
              },
            ],
          }),
      },
    });
    await writeFile(
      failed.storePath,
      JSON.stringify({
        ...failed.store,
        selection: {
          observationId: success.store.selection.observationId,
          effectiveFreshness: "current",
          latestAttempt: null,
        },
      }),
    );
    expect((await readNativeScopeDiscoveryStore(root)).kind).toBe("malformed");

    const stale = await selectNativeScopeDiscovery({
      repoRoot: root,
      intent: "explicit-discovery",
      provider: {
        id: "matt-skills/v1",
        discover: async () =>
          createNativeScopeDiscoveryObservation({
            provider: "matt-skills/v1",
            state: "available",
            observedAt: "2026-07-31T08:30:00.000Z",
            freshness: "stale",
            coverage: "complete",
            scopes: success.view?.scopes ?? [],
            diagnostics: [],
          }),
      },
    });
    await writeFile(
      stale.storePath,
      JSON.stringify({
        ...stale.store,
        selection: {
          ...stale.store.selection,
          effectiveFreshness: "current",
        },
      }),
    );
    expect((await readNativeScopeDiscoveryStore(root)).kind).toBe("malformed");
  });

  test("an oversized provider result becomes a bounded failed attempt", async () => {
    const root = await createLocalRepo();
    const baseline = await discoverLocalMattScopes({
      repoRoot: root,
      contractLocator: "docs/agents/issue-tracker.md",
    });
    const oversizedScope = baseline.scopes[0];
    if (oversizedScope === undefined) throw new Error("Expected one Local discovery scope.");
    const selected = await selectNativeScopeDiscovery({
      repoRoot: root,
      intent: "explicit-discovery",
      provider: {
        id: "matt-skills/v1",
        discover: async () =>
          createNativeScopeDiscoveryObservation({
            provider: "matt-skills/v1",
            state: "available",
            observedAt: "2026-07-31T08:20:00.000Z",
            freshness: "current",
            coverage: "complete",
            scopes: [{ ...oversizedScope, title: "x".repeat(8 * 1024 * 1024) }],
            diagnostics: [],
          }),
      },
    });

    expect(selected.storeBytes.length).toBeLessThan(16 * 1024 * 1024);
    expect(selected.view?.state).toBe("invalid");
    expect(selected.view?.latestAttempt?.diagnostics).toContainEqual(
      expect.objectContaining({ code: "matt.discovery.resource-budget" }),
    );
    await writeFile(selected.storePath, selected.storeBytes);
    expect((await readNativeScopeDiscoveryStore(root)).kind).toBe("available");
  });

  test("a first unavailable attempt remains visible instead of collapsing to never-run", async () => {
    const root = await createLocalRepo();
    const unavailable = await selectNativeScopeDiscovery({
      repoRoot: root,
      intent: "explicit-discovery",
      provider: {
        id: "matt-skills/v1",
        discover: async () =>
          createNativeScopeDiscoveryObservation({
            provider: "matt-skills/v1",
            state: "unsupported",
            observedAt: "2026-07-31T06:20:00.000Z",
            freshness: "undetermined",
            coverage: "incomplete",
            scopes: [],
            diagnostics: [
              {
                code: "matt.discovery.unsupported",
                class: "acquisition",
                impact: "blocking",
                target: "driver",
                message: "No confirmed discovery driver is available.",
              },
            ],
          }),
      },
    });

    expect(unavailable.operation.outcome).toBe("unavailable");
    expect(unavailable.view).toMatchObject({
      state: "unsupported",
      freshness: "undetermined",
      scopes: [],
      latestAttempt: {
        state: "unsupported",
        observedAt: "2026-07-31T06:20:00.000Z",
      },
    });
  });

  test("GitHub discovery completes all pages and uses native hierarchy for membership", async () => {
    const requests: GitHubReadRequest[] = [];
    const map = githubIssue(1, "I_map", "Map", ["wayfinder:map"]);
    const unlabeledChild = githubIssue(2, "I_child", "Unlabeled child", [], "closed");
    const unrelated = githubIssue(3, "I_other", "Nearby but unrelated", []);
    const filler = Array.from({ length: 98 }, (_, index) =>
      githubIssue(index + 100, `I_filler_${index}`, `Unrelated ${index}`, []),
    );
    const responses = new Map<string, GitHubReadResponse>([
      ["repos/owner/project", { status: 200, headers: {}, body: githubRepository }],
      [
        "repos/owner/project/issues?state=all&per_page=100&page=1",
        { status: 200, headers: {}, body: [map, unrelated, ...filler] },
      ],
      [
        "repos/owner/project/issues?state=all&per_page=100&page=2",
        { status: 200, headers: {}, body: [unlabeledChild] },
      ],
      ["repos/owner/project/issues/1/parent", { status: 404, headers: {} }],
      [
        "repos/owner/project/issues/1/sub_issues?per_page=100&page=1",
        { status: 200, headers: {}, body: [unlabeledChild] },
      ],
      ["repos/owner/project/issues/2/parent", { status: 200, headers: {}, body: map }],
      [
        "repos/owner/project/issues/2/sub_issues?per_page=100&page=1",
        { status: 200, headers: {}, body: [] },
      ],
    ]);
    const transport: GitHubReadTransport = {
      get: async (request) => {
        requests.push(request);
        return responses.get(request.endpoint) ?? { status: 404, headers: {} };
      },
    };
    const observation = await discoverGitHubMattScopes({
      repository: "owner/project",
      transport,
      mappedTriageLabels: ["ready-for-agent"],
      pullRequests: "disabled",
      clock: () => new Date("2026-07-31T06:20:00.000Z"),
    });

    expect(observation.state).toBe("available");
    expect(observation.coverage.assessment).toBe("complete");
    expect(observation.scopes).toHaveLength(1);
    expect(observation.scopes[0]?.subjects.map((subject) => subject.title)).toEqual([
      "Map",
      "Unlabeled child",
    ]);
    expect(observation.scopes[0]?.subjects).not.toContainEqual(
      expect.objectContaining({ title: "Nearby but unrelated" }),
    );
    expect(requests.map((request) => request.endpoint)).toContain(
      "repos/owner/project/issues?state=all&per_page=100&page=2",
    );
    expect(
      requests
        .map((request) => request.endpoint)
        .filter((endpoint) => endpoint.endsWith("/parent")),
    ).toEqual(["repos/owner/project/issues/1/parent", "repos/owner/project/issues/2/parent"]);
    expect(JSON.stringify(observation)).not.toContain('"body"');
  });

  test("GitHub discovery never trusts issue-shaped content from a failed page", async () => {
    const map = githubIssue(1, "I_map", "Map", ["wayfinder:map"]);
    const filler = Array.from({ length: 99 }, (_, index) =>
      githubIssue(index + 100, `I_filler_${index}`, `Unrelated ${index}`, []),
    );
    const forged = githubIssue(999, "I_forged", "Forged from HTTP 500", ["ready-for-agent"]);
    const responses = new Map<string, GitHubReadResponse>([
      ["repos/owner/project", { status: 200, headers: {}, body: githubRepository }],
      [
        "repos/owner/project/issues?state=all&per_page=100&page=1",
        { status: 200, headers: {}, body: [map, ...filler] },
      ],
      [
        "repos/owner/project/issues?state=all&per_page=100&page=2",
        { status: 500, headers: {}, body: [forged] },
      ],
      ["repos/owner/project/issues/1/parent", { status: 404, headers: {} }],
      [
        "repos/owner/project/issues/1/sub_issues?per_page=100&page=1",
        { status: 200, headers: {}, body: [] },
      ],
    ]);
    const observation = await discoverGitHubMattScopes({
      repository: "owner/project",
      transport: {
        get: async (request) => responses.get(request.endpoint) ?? { status: 404, headers: {} },
      },
      mappedTriageLabels: ["ready-for-agent"],
      pullRequests: "disabled",
    });

    expect(observation.state).toBe("partial");
    expect(observation.scopes.map((scope) => scope.title)).toEqual(["Map"]);
    expect(JSON.stringify(observation)).not.toContain("Forged from HTTP 500");
  });

  test("GitHub admission follows canonical parents to an unlabeled scope root", async () => {
    const parent = githubIssue(1, "I_parent", "Unlabeled parent", []);
    const admittedChild = githubIssue(2, "I_admitted", "Admitted child", ["ready-for-agent"]);
    const responses = new Map<string, GitHubReadResponse>([
      ["repos/owner/project", { status: 200, headers: {}, body: githubRepository }],
      [
        "repos/owner/project/issues?state=all&per_page=100&page=1",
        { status: 200, headers: {}, body: [parent, admittedChild] },
      ],
      ["repos/owner/project/issues/1/parent", { status: 404, headers: {} }],
      ["repos/owner/project/issues/2/parent", { status: 200, headers: {}, body: parent }],
      [
        "repos/owner/project/issues/1/sub_issues?per_page=100&page=1",
        { status: 200, headers: {}, body: [admittedChild] },
      ],
      [
        "repos/owner/project/issues/2/sub_issues?per_page=100&page=1",
        { status: 200, headers: {}, body: [] },
      ],
    ]);
    const observation = await discoverGitHubMattScopes({
      repository: "owner/project",
      transport: {
        get: async (request) => responses.get(request.endpoint) ?? { status: 404, headers: {} },
      },
      mappedTriageLabels: ["ready-for-agent"],
      pullRequests: "disabled",
    });

    expect(observation.state).toBe("available");
    expect(observation.scopes).toHaveLength(1);
    expect(observation.scopes[0]).toMatchObject({
      title: "Unlabeled parent",
      rootRole: "parent-scope",
      admission: ["label:ready-for-agent"],
    });
    expect(observation.scopes[0]?.subjects.map((subject) => subject.title)).toEqual([
      "Unlabeled parent",
      "Admitted child",
    ]);
  });

  test("GitHub admits a non-map Wayfinder leaf as a standalone request", async () => {
    const research = githubIssue(1, "I_research", "Research the boundary", ["wayfinder:research"]);
    const responses = new Map<string, GitHubReadResponse>([
      ["repos/owner/project", { status: 200, headers: {}, body: githubRepository }],
      [
        "repos/owner/project/issues?state=all&per_page=100&page=1",
        { status: 200, headers: {}, body: [research] },
      ],
      ["repos/owner/project/issues/1/parent", { status: 404, headers: {} }],
      [
        "repos/owner/project/issues/1/sub_issues?per_page=100&page=1",
        { status: 200, headers: {}, body: [] },
      ],
    ]);
    const observation = await discoverGitHubMattScopes({
      repository: "owner/project",
      transport: {
        get: async (request) => responses.get(request.endpoint) ?? { status: 404, headers: {} },
      },
      mappedTriageLabels: ["ready-for-agent"],
      pullRequests: "disabled",
    });

    expect(observation.state).toBe("available");
    expect(observation.confirmedEmpty).toBe(false);
    expect(observation.scopes).toHaveLength(1);
    expect(observation.scopes[0]).toMatchObject({
      rootRole: "standalone-request",
      classification: "wayfinder",
      admission: ["label:wayfinder:research"],
    });
  });

  test("GitHub admits a mapped triage leaf as a standalone request", async () => {
    const incoming = githubIssue(1, "I_incoming", "Needs handling", ["ready-for-agent"]);
    const responses = new Map<string, GitHubReadResponse>([
      ["repos/owner/project", { status: 200, headers: {}, body: githubRepository }],
      [
        "repos/owner/project/issues?state=all&per_page=100&page=1",
        { status: 200, headers: {}, body: [incoming] },
      ],
      ["repos/owner/project/issues/1/parent", { status: 404, headers: {} }],
      [
        "repos/owner/project/issues/1/sub_issues?per_page=100&page=1",
        { status: 200, headers: {}, body: [] },
      ],
    ]);
    const observation = await discoverGitHubMattScopes({
      repository: "owner/project",
      transport: {
        get: async (request) => responses.get(request.endpoint) ?? { status: 404, headers: {} },
      },
      mappedTriageLabels: ["ready-for-agent"],
      pullRequests: "disabled",
    });

    expect(observation.scopes[0]).toMatchObject({
      rootRole: "standalone-request",
      classification: "incoming",
      admission: ["label:ready-for-agent"],
    });
  });

  test("GitHub discovery fails partial when parent and child hierarchy reads disagree", async () => {
    const parent = githubIssue(1, "I_parent", "Parent", []);
    const admittedChild = githubIssue(2, "I_admitted", "Admitted child", ["ready-for-agent"]);
    const responses = new Map<string, GitHubReadResponse>([
      ["repos/owner/project", { status: 200, headers: {}, body: githubRepository }],
      [
        "repos/owner/project/issues?state=all&per_page=100&page=1",
        { status: 200, headers: {}, body: [parent, admittedChild] },
      ],
      ["repos/owner/project/issues/1/parent", { status: 404, headers: {} }],
      ["repos/owner/project/issues/2/parent", { status: 200, headers: {}, body: parent }],
      [
        "repos/owner/project/issues/1/sub_issues?per_page=100&page=1",
        { status: 200, headers: {}, body: [] },
      ],
    ]);
    const observation = await discoverGitHubMattScopes({
      repository: "owner/project",
      transport: {
        get: async (request) => responses.get(request.endpoint) ?? { status: 404, headers: {} },
      },
      mappedTriageLabels: ["ready-for-agent"],
      pullRequests: "disabled",
    });

    expect(observation.state).toBe("partial");
    expect(observation.confirmedEmpty).toBe(false);
    expect(observation.diagnostics).toContainEqual(
      expect.objectContaining({ code: "matt.github.discovery.hierarchy-incomplete" }),
    );
  });

  test("GitHub discovery enforces one operation-wide request budget", async () => {
    const map = githubIssue(1, "I_map", "Map", ["wayfinder:map"]);
    const requests: GitHubReadRequest[] = [];
    const observation = await discoverGitHubMattScopes({
      repository: "owner/project",
      transport: {
        get: async (request) => {
          requests.push(request);
          if (request.endpoint === "repos/owner/project") {
            return { status: 200, headers: {}, body: githubRepository };
          }
          return { status: 200, headers: {}, body: [map] };
        },
      },
      mappedTriageLabels: ["ready-for-agent"],
      pullRequests: "disabled",
      maximumRequests: 2,
    });

    expect(requests).toHaveLength(2);
    expect(observation.state).toBe("partial");
    expect(observation.confirmedEmpty).toBe(false);
    expect(observation.diagnostics).toContainEqual(
      expect.objectContaining({ code: "matt.github.discovery.request-budget" }),
    );
  });

  test("GitHub permission failure is unavailable, never confirmed empty", async () => {
    const observation = await discoverGitHubMattScopes({
      repository: "owner/project",
      transport: {
        get: async () => ({ status: 403, headers: {} }),
      },
      mappedTriageLabels: ["ready-for-agent"],
      pullRequests: "disabled",
    });
    expect(observation.state).toBe("unavailable");
    expect(observation.coverage.assessment).toBe("incomplete");
    expect(observation.scopes).toEqual([]);
    expect(observation.confirmedEmpty).toBe(false);
  });

  test("ordinary Bearing Sync has zero discovery acquisition while explicit Sync performs one", async () => {
    const root = await createValidBearingRepo();
    let acquisitions = 0;
    const provider: NativeScopeDiscoveryProvider = {
      id: "matt-skills/v1",
      discover: async () => {
        acquisitions += 1;
        return createNativeScopeDiscoveryObservation({
          provider: "matt-skills/v1",
          state: "available",
          observedAt: "2026-07-31T06:30:00.000Z",
          freshness: "current",
          coverage: "complete",
          scopes: [],
          diagnostics: [],
        });
      },
    };
    const factory = () => provider;
    const ordinary = await prepareSync(root, {
      nativeScopeDiscoveryProviderFactory: factory,
    });
    const explicit = await prepareSync(root, {
      nativeScopeDiscoveryIntent: "explicit-discovery",
      nativeScopeDiscoveryProviderFactory: factory,
    });

    expect(acquisitions).toBe(1);
    expect(ordinary.nativeScopeDiscoveryOperation).toEqual({
      intent: "ordinary-sync",
      outcome: "never-run",
      acquisitionCount: 0,
    });
    expect(explicit.nativeScopeDiscoveryOperation).toMatchObject({
      intent: "explicit-discovery",
      outcome: "acquired",
      acquisitionCount: 1,
    });
    expect(ordinary.metrics.nativeScopeDiscoveryAcquisitionCount).toBe(0);
    expect(explicit.metrics.nativeScopeDiscoveryAcquisitionCount).toBe(1);
  });
});
