import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { discoverPlanningAuditInputs } from "../src/discovery";
import {
  createGhCliGitHubReadTransport,
  createGitHubMattProvider,
  encodeGitHubMattNativeScope,
  type GitHubCommandExecutor,
  GitHubReadError,
  type GitHubReadRequest,
  type GitHubReadResponse,
  type GitHubReadTransport,
} from "../src/providers/matt-skills-v1/github";
import {
  githubComment as comment,
  standardGitHubMattContract as contract,
  githubContractLocator as contractLocator,
  createGitHubMattRepository as createRepository,
  githubDeliveryIssue as deliveryIssue,
  FixtureGitHubTransport,
  type GitHubFixtureResponse as FixtureResponse,
  githubIssue,
  githubIncomingIssue as incomingIssue,
  githubMapIssue as mapIssue,
  githubNativeScopeFor as nativeScopeFor,
  githubRepository as repository,
  githubResearchIssue as researchIssue,
  githubFixtureResponse as response,
  githubScopedIncomingIssue as scopedIncomingIssue,
  githubSpecIssue as specIssue,
  customGitHubTriageMapping as triage,
  githubTriageLocator as triageLocator,
} from "./fixtures/github-matt-api";
import { makeTemporaryDirectory, writeFixture } from "./helpers";

describe("GitHub matt-skills/v1 capture", () => {
  test("captures one standalone issue through the public seam with custom mapping and current revalidation", async () => {
    const root = await createRepository();
    const transport = new FixtureGitHubTransport({
      "repos/example/reference": {
        first: response(repository, '"repo-v1"'),
      },
      "repos/example/reference/issues/109": {
        first: response(incomingIssue, '"issue-109-v1"'),
      },
      "repos/example/reference/issues/109/comments?per_page=100&page=1": {
        first: response([], '"comments-109-v1"'),
      },
      "repos/example/reference/issues/109/dependencies/blocked_by?per_page=100&page=1": {
        first: response([], '"blocked-109-v1"'),
      },
    });
    const nativeScope = nativeScopeFor(incomingIssue);
    const result = await createGitHubMattProvider({
      repoRoot: root,
      contractLocator,
      triageLocator,
      transport,
      clock: () => new Date("2026-07-28T00:00:00Z"),
    }).capture({ provider: "matt-skills/v1", nativeScope });

    expect(result.state).toBe("available");
    expect(result.freshness.assessment).toBe("current");
    expect(result.coverage.assessment).toBe("complete");
    expect(result.completion).toBe("incomplete");
    expect(result.diagnostics).toEqual([]);
    expect(result.sourceRevision).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(result.projection?.map).toBeUndefined();
    expect(result.projection?.wayfinderTickets).toEqual([]);
    expect(result.projection?.deliveryTickets).toEqual([]);
    expect(result.projection?.incomingIssues).toHaveLength(1);
    expect(result.projection?.incomingIssues[0]).toMatchObject({
      title: "Support a custom-mapped enhancement",
      classification: {
        category: "enhancement",
        state: "ready-for-agent",
        nativeCategory: "custom-enhancement",
        nativeState: "custom-ready",
      },
      lifecycle: { state: "open" },
      native: {
        kind: "github",
        createdAt: {
          availability: "available",
          value: "2026-07-01T00:00:00Z",
          precision: "second",
          basis: "source-event",
        },
        lastUpdated: {
          availability: "available",
          value: "2026-07-02T00:00:00Z",
          precision: "second",
        },
        identity: {
          repositoryDatabaseId: "9001",
          repositoryNodeId: "R_reference",
          objectKind: "issue",
          objectDatabaseId: "9109",
          objectNodeId: "I_reference_9",
          number: 109,
          url: "https://github.com/example/reference/issues/109",
          owner: "example",
          repository: "reference",
        },
      },
    });
    expect(result.projection?.structuralOrder.map(String)).toEqual([
      "github:R_reference:I_reference_9",
    ]);
    expect(result.projection?.incomingIssues[0]?.native.rawFacets).toEqual(
      expect.arrayContaining([
        {
          key: "labels",
          values: ["custom-enhancement", "custom-ready", "same-project"],
        },
        {
          key: "milestone",
          values: ["44|M_44|4|Later"],
        },
      ]),
    );
    expect(result.projection?.graph).toEqual({ parentChild: [], blockedBy: [] });
    expect(transport.requests.filter((request) => request.validator === undefined)).toHaveLength(6);
    expect(transport.requests.filter((request) => request.validator !== undefined)).toHaveLength(4);
    expect(
      transport.requests.filter((request) => request.endpoint.endsWith("/parent")),
    ).toHaveLength(2);
    expect(JSON.stringify(result)).not.toContain("token");
  });

  test("keeps a missing GitHub closure time unavailable instead of falling back to capture time", async () => {
    const root = await createRepository();
    const closed = {
      ...githubIssue({
        number: 110,
        title: "Closed without a source timestamp",
        body: "Reporter prose.",
        labels: ["custom-enhancement", "custom-wontfix"],
        state: "closed",
        stateReason: "not_planned",
      }),
      closed_at: null,
      updated_at: "2026-07-30T00:00:00Z",
    };
    const transport = new FixtureGitHubTransport({
      "repos/example/reference": {
        first: response(repository, '"repo-v1"'),
      },
      "repos/example/reference/issues/110": {
        first: response(closed, '"issue-110-v1"'),
      },
      "repos/example/reference/issues/110/comments?per_page=100&page=1": {
        first: response([], '"comments-110-v1"'),
      },
      "repos/example/reference/issues/110/dependencies/blocked_by?per_page=100&page=1": {
        first: response([], '"blocked-110-v1"'),
      },
    });
    const result = await createGitHubMattProvider({
      repoRoot: root,
      contractLocator,
      triageLocator,
      transport,
      clock: () => new Date("2099-12-31T23:59:59Z"),
    }).capture({
      provider: "matt-skills/v1",
      nativeScope: nativeScopeFor(closed),
    });

    expect(result.projection?.incomingIssues[0]).toMatchObject({
      lifecycle: {
        state: "closed",
        disposition: "wontfix",
        closedAt: { availability: "unavailable" },
      },
    });
    expect(JSON.stringify(result.projection)).not.toContain("2099-12-31T23:59:59");
  });

  test("uses generation-captured contract and vocabulary after repository files change", async () => {
    const root = await makeTemporaryDirectory("bearing-github-provider-custom-contract-");
    const customContractLocator = "config/matt/issue-tracker.md";
    const customTriageLocator = "config/matt/triage-labels.md";
    await writeFixture(root, customContractLocator, contract);
    await writeFixture(root, customTriageLocator, triage);
    await writeFixture(
      root,
      ".bearing/provider.json",
      JSON.stringify({
        schemaVersion: 1,
        provider: "matt-skills/v1",
        contractLocator: customContractLocator,
      }),
    );
    const discovery = await discoverPlanningAuditInputs(root);
    expect(discovery.inputs).toEqual([
      ".bearing/provider.json",
      customContractLocator,
      customTriageLocator,
    ]);
    const capturedDocuments = new Map(
      await Promise.all(
        discovery.inputs.map(async (locator) => {
          const bytes = await readFile(join(root, locator));
          return [locator, { locator, source: bytes.toString("utf8"), bytes }] as const;
        }),
      ),
    );
    await writeFixture(root, customContractLocator, "# Changed after generation capture\n");
    await writeFixture(root, customTriageLocator, "# Changed after generation capture\n");
    const transport = new FixtureGitHubTransport({
      "repos/example/reference": {
        first: response(repository, '"repo-v1"'),
      },
      "repos/example/reference/issues/109": {
        first: response(incomingIssue, '"issue-109-v1"'),
      },
      "repos/example/reference/issues/109/comments?per_page=100&page=1": {
        first: response([], '"comments-109-v1"'),
      },
      "repos/example/reference/issues/109/dependencies/blocked_by?per_page=100&page=1": {
        first: response([], '"blocked-109-v1"'),
      },
    });

    const result = await createGitHubMattProvider({
      repoRoot: root,
      contractLocator: customContractLocator,
      triageLocator: customTriageLocator,
      capturedDocuments,
      transport,
      clock: () => new Date("2026-07-28T00:00:00Z"),
    }).capture({ provider: "matt-skills/v1", nativeScope: nativeScopeFor(incomingIssue) });

    expect(result.state).toBe("available");
    expect(result.diagnostics).toEqual([]);
    expect(result.projection?.incomingIssues[0]).toMatchObject({
      classification: {
        category: "enhancement",
        state: "ready-for-agent",
        nativeCategory: "custom-enhancement",
        nativeState: "custom-ready",
      },
    });
  });

  test("captures a transitive native Map scope with workflow roles, relations and a uniquely referenced Answer", async () => {
    const root = await createRepository();
    const issues = [mapIssue, specIssue, researchIssue, deliveryIssue, scopedIncomingIssue];
    const fixtures: Record<string, FixtureResponse> = {
      "repos/example/reference": {
        first: response(repository, '"repo-v1"'),
      },
    };
    for (const issue of issues) {
      const issueEndpoint = `repos/example/reference/issues/${issue.number}`;
      fixtures[issueEndpoint] = {
        first: response(issue, `"issue-${issue.number}-v1"`),
      };
      fixtures[`${issueEndpoint}/comments?per_page=100&page=1`] = {
        first: response(
          issue.number === 3
            ? [
                comment({
                  id: 301,
                  issue: 3,
                  body: "Preserve workflow-specific lifecycle and evidence.",
                }),
                comment({
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
        first: response(issue.number === 4 ? [researchIssue] : [], `"deps-${issue.number}-v1"`),
      };
      fixtures[`${issueEndpoint}/sub_issues?per_page=100&page=1`] = {
        first: response(
          issue.number === 1
            ? [researchIssue, specIssue, scopedIncomingIssue]
            : issue.number === 2
              ? [deliveryIssue]
              : [],
          `"children-${issue.number}-v1"`,
        ),
      };
    }
    const transport = new FixtureGitHubTransport(fixtures);
    const nativeScope = nativeScopeFor(mapIssue, "wayfinder-map");
    const result = await createGitHubMattProvider({
      repoRoot: root,
      contractLocator,
      triageLocator,
      transport,
      clock: () => new Date("2026-07-28T00:00:00Z"),
    }).capture({ provider: "matt-skills/v1", nativeScope });

    expect(result.state).toBe("available");
    expect(result.freshness.assessment).toBe("current");
    expect(result.coverage.assessment).toBe("complete");
    expect(result.completion).toBe("incomplete");
    expect(result.diagnostics).toEqual([]);
    expect(result.projection?.map).toMatchObject({
      title: "Reference Map",
      destination: {
        version: 1,
        sections: [
          {
            semanticRole: "map.destination",
            availability: "available",
            blocks: [
              {
                kind: "paragraph",
                inlines: [
                  {
                    kind: "text",
                    value: "Prove one complete Matt-native semantic scope.",
                  },
                ],
              },
            ],
          },
        ],
      },
      notes: ["Keep provider-native identity outside the semantic oracle."],
      decisions: [
        {
          gist: "Use the versioned capture seam.",
          sourceAnchor: {
            kind: "decision",
            target: "https://github.com/example/reference/issues/3#issuecomment-301",
          },
        },
      ],
      fog: ["Whether one source comment can be uniquely identified as an Answer."],
      lifecycle: { state: "active" },
    });
    expect(result.projection?.spec).toMatchObject({
      title: "Reference Spec",
      lifecycle: { state: "ready-for-agent" },
    });
    expect(
      result.projection?.spec?.document.sections.map((section) =>
        section.semanticRole?.slice("spec.".length),
      ),
    ).toEqual([
      "problem",
      "solution",
      "user-stories",
      "implementation",
      "testing",
      "out-of-scope",
      "further-notes",
    ]);
    expect(result.projection?.wayfinderTickets).toHaveLength(1);
    expect(result.projection?.wayfinderTickets[0]).toMatchObject({
      title: "Research the semantic contract",
      subtype: "research",
      question: {
        version: 1,
        sections: [
          {
            semanticRole: "wayfinder.question",
            availability: "available",
            blocks: [
              {
                kind: "paragraph",
                inlines: [{ kind: "text", value: "Which semantics are durable?" }],
              },
            ],
          },
        ],
      },
      claim: { state: "claimed", claimant: "lago" },
      answer: {
        availability: "available",
        content: {
          role: "answer",
          document: {
            version: 1,
            sections: [
              {
                semanticRole: "wayfinder.answer",
                availability: "available",
                blocks: [
                  {
                    kind: "paragraph",
                    inlines: [
                      {
                        kind: "text",
                        value: "Preserve workflow-specific lifecycle and evidence.",
                      },
                    ],
                  },
                ],
              },
            ],
          },
          nativeIdentity: "IC_301",
          authoredAt: {
            availability: "available",
            value: "2026-07-20T00:00:00Z",
            precision: "second",
            basis: "source-event",
          },
        },
      },
      comments: [
        {
          role: "ordinary-comment",
          document: {
            version: 1,
            sections: [
              {
                semanticRole: "wayfinder.comments",
                availability: "available",
                blocks: [
                  {
                    kind: "paragraph",
                    inlines: [{ kind: "text", value: "This comment is not the Answer." }],
                  },
                ],
              },
            ],
          },
          nativeIdentity: "IC_302",
          author: "reviewer",
          authoredAt: {
            availability: "available",
            value: "2026-07-20T00:00:00Z",
            precision: "second",
            basis: "source-event",
          },
        },
      ],
      lifecycle: { state: "resolved-on-route" },
      trackerClosure: {
        state: "closed",
        disposition: "completed",
        closedAt: {
          availability: "available",
          value: "2026-07-20T00:00:00Z",
          precision: "second",
          basis: "source-event",
        },
      },
    });
    expect(result.projection?.deliveryTickets[0]).toMatchObject({
      title: "Implement provider capture",
      whatToBuild: "A versioned capture seam.",
      acceptanceCriteria: [
        "Return independent state, freshness and completion.",
        "Keep the capture immutable.",
      ],
      lifecycle: { state: "open" },
      trackerClosure: { state: "open" },
    });
    expect(result.projection?.incomingIssues[0]?.classification).toMatchObject({
      category: "enhancement",
      state: "ready-for-agent",
    });
    expect(result.projection?.graph.parentChild.map((relation) => relation.evidence)).toEqual([
      "github-native",
      "github-native",
      "github-native",
      "github-native",
    ]);
    expect(result.projection?.graph.parentChild.map((relation) => String(relation.child))).toEqual([
      "github:R_reference:I_reference_3",
      "github:R_reference:I_reference_2",
      "github:R_reference:I_reference_5",
      "github:R_reference:I_reference_4",
    ]);
    expect(
      result.projection?.graph.blockedBy.map((relation) => ({
        blocked: String(relation.blocked),
        blocker: String(relation.blocker),
        evidence: relation.evidence,
      })),
    ).toEqual([
      {
        blocked: "github:R_reference:I_reference_4",
        blocker: "github:R_reference:I_reference_3",
        evidence: "github-native",
      },
    ]);
  });

  test("keeps tracker closure as an independent native event for closed Map and Spec issues", async () => {
    const root = await createRepository();
    const closedMap = {
      ...mapIssue,
      state: "closed" as const,
      state_reason: "completed",
      closed_at: "2026-07-21T01:02:03Z",
      closed_by: { login: "closer", id: 92, node_id: "U_closer" },
    };
    const closedSpec = {
      ...specIssue,
      state: "closed" as const,
      state_reason: "completed",
      closed_at: "2026-07-22T04:05:06Z",
      closed_by: { login: "closer", id: 92, node_id: "U_closer" },
    };
    const fixtures: Record<string, FixtureResponse> = {
      "repos/example/reference": {
        first: response(repository, '"repo-v1"'),
      },
    };
    for (const issue of [closedMap, closedSpec]) {
      const issueEndpoint = `repos/example/reference/issues/${issue.number}`;
      fixtures[issueEndpoint] = {
        first: response(issue, `"issue-${issue.number}-v1"`),
      };
      fixtures[`${issueEndpoint}/comments?per_page=100&page=1`] = {
        first: response([], `"comments-${issue.number}-v1"`),
      };
      fixtures[`${issueEndpoint}/dependencies/blocked_by?per_page=100&page=1`] = {
        first: response([], `"deps-${issue.number}-v1"`),
      };
      fixtures[`${issueEndpoint}/sub_issues?per_page=100&page=1`] = {
        first: response(
          issue.number === closedMap.number ? [closedSpec] : [],
          `"children-${issue.number}-v1"`,
        ),
      };
    }

    const result = await createGitHubMattProvider({
      repoRoot: root,
      contractLocator,
      triageLocator,
      transport: new FixtureGitHubTransport(fixtures),
      clock: () => new Date("2026-07-28T00:00:00Z"),
    }).capture({
      provider: "matt-skills/v1",
      nativeScope: nativeScopeFor(closedMap, "wayfinder-map"),
    });

    expect(result.projection?.map).toMatchObject({
      lifecycle: { state: "resolved" },
      native: {
        trackerClosure: {
          state: "closed",
          closedAt: {
            availability: "available",
            value: "2026-07-21T01:02:03Z",
            precision: "second",
            basis: "source-event",
          },
        },
      },
    });
    expect(result.projection?.spec).toMatchObject({
      lifecycle: { state: "ready-for-agent" },
      native: {
        trackerClosure: {
          state: "closed",
          closedAt: {
            availability: "available",
            value: "2026-07-22T04:05:06Z",
            precision: "second",
            basis: "source-event",
          },
        },
      },
    });
  });

  test("keeps scope-external and cross-repository relations as references without aggregation", async () => {
    const boundedMap = githubIssue({
      number: 1,
      title: "Bounded Map",
      labels: ["wayfinder:map"],
      body: `## Destination

Keep the bound scope closed.

## Notes

- [Same-label source](https://github.com/example/reference/issues/99) remains external.
`,
    });
    const boundedDelivery = githubIssue({
      number: 4,
      title: "Bounded delivery",
      labels: ["custom-ready", "same-project"],
      body: `## What to build

A bounded delivery.

## Acceptance criteria

- [ ] Never aggregate by labels, milestone, project or links.
`,
    });
    const crossRepositoryChild = {
      ...githubIssue({
        number: 20,
        title: "Cross-repository child endpoint",
        body: "External child.",
      }),
      id: 20_020,
      node_id: "I_other_20",
      html_url: "https://github.com/other/repository/issues/20",
      repository_url: "https://api.github.com/repos/other/repository",
    };
    const externalBlocker = {
      ...githubIssue({
        number: 21,
        title: "External blocker",
        body: "External dependency.",
      }),
      id: 20_021,
      node_id: "I_other_21",
      html_url: "https://github.com/other/repository/issues/21",
      repository_url: "https://api.github.com/repos/other/repository",
    };
    const fixtures: Record<string, FixtureResponse> = {
      "repos/example/reference": {
        first: response(repository, '"repo-v1"'),
      },
    };
    for (const issue of [boundedMap, boundedDelivery]) {
      const endpoint = `repos/example/reference/issues/${issue.number}`;
      fixtures[endpoint] = { first: response(issue, `"issue-${issue.number}-v1"`) };
      fixtures[`${endpoint}/comments?per_page=100&page=1`] = {
        first: response([], `"comments-${issue.number}-v1"`),
      };
      fixtures[`${endpoint}/dependencies/blocked_by?per_page=100&page=1`] = {
        first: response(
          issue.number === 4 ? [externalBlocker] : [],
          `"dependencies-${issue.number}-v1"`,
        ),
      };
      fixtures[`${endpoint}/sub_issues?per_page=100&page=1`] = {
        first: response(
          issue.number === 1 ? [boundedDelivery, crossRepositoryChild] : [],
          `"children-${issue.number}-v1"`,
        ),
      };
    }
    const transport = new FixtureGitHubTransport(fixtures);
    const nativeScope = nativeScopeFor(boundedMap, "wayfinder-map");
    const result = await createGitHubMattProvider({
      repoRoot: await createRepository(),
      contractLocator,
      triageLocator,
      transport,
      clock: () => new Date("2026-07-28T00:00:00Z"),
    }).capture({ provider: "matt-skills/v1", nativeScope });

    expect(result.state).toBe("available");
    expect(result.projection?.deliveryTickets).toHaveLength(1);
    expect(result.projection?.incomingIssues).toEqual([]);
    expect(result.projection?.map?.native.sourceAnchors).toEqual(
      expect.arrayContaining([
        {
          kind: "external",
          target: "https://github.com/example/reference/issues/99",
        },
        {
          kind: "external",
          target: "https://github.com/other/repository/issues/20",
        },
      ]),
    );
    expect(result.projection?.map?.native.rawFacets).toContainEqual({
      key: "native-external-child",
      values: [
        [
          crossRepositoryChild.repository_url,
          String(crossRepositoryChild.id),
          crossRepositoryChild.node_id,
          String(crossRepositoryChild.number),
          crossRepositoryChild.html_url,
        ].join("|"),
      ],
    });
    expect(result.projection?.deliveryTickets[0]?.native.sourceAnchors).toEqual(
      expect.arrayContaining([
        {
          kind: "external",
          target: "https://github.com/other/repository/issues/21",
        },
      ]),
    );
    expect(result.projection?.deliveryTickets[0]?.native.rawFacets).toContainEqual({
      key: "native-external-blocked-by",
      values: [
        [
          externalBlocker.repository_url,
          String(externalBlocker.id),
          externalBlocker.node_id,
          String(externalBlocker.number),
          externalBlocker.html_url,
        ].join("|"),
      ],
    });
    expect(
      transport.requests.some(
        (request) =>
          request.endpoint.includes("other/repository") ||
          request.endpoint.includes("/issues/99") ||
          request.endpoint.endsWith("/issues"),
      ),
    ).toBe(false);
  });

  test("reads a standalone issue native parent as an external relation without expanding scope", async () => {
    const nativeParent = githubIssue({
      number: 2,
      title: "Out-of-scope parent",
      body: "Parent identity is relation evidence, not standalone scope membership.",
    });
    const transport = new FixtureGitHubTransport({
      "repos/example/reference": {
        first: response(repository, '"repo-v1"'),
      },
      "repos/example/reference/issues/109": {
        first: response(incomingIssue, '"issue-v1"'),
      },
      "repos/example/reference/issues/109/parent": {
        first: response(nativeParent, '"parent-v1"'),
      },
      "repos/example/reference/issues/109/comments?per_page=100&page=1": {
        first: response([], '"comments-v1"'),
      },
      "repos/example/reference/issues/109/dependencies/blocked_by?per_page=100&page=1": {
        first: response([], '"dependencies-v1"'),
      },
    });
    const nativeScope = nativeScopeFor(incomingIssue);
    const result = await createGitHubMattProvider({
      repoRoot: await createRepository(),
      contractLocator,
      triageLocator,
      transport,
      clock: () => new Date("2026-07-28T00:00:00Z"),
    }).capture({ provider: "matt-skills/v1", nativeScope });

    expect(result.state).toBe("available");
    expect(result.projection?.graph.parentChild).toEqual([]);
    expect(result.projection?.incomingIssues[0]?.native.sourceAnchors).toContainEqual({
      kind: "external",
      target: "https://github.com/example/reference/issues/2",
    });
    expect(
      transport.requests.filter(
        (request) => request.endpoint === "repos/example/reference/issues/109/parent",
      ),
    ).toHaveLength(2);
    expect(
      transport.requests.some((request) => request.endpoint === "repos/example/reference/issues/2"),
    ).toBe(false);
  });

  test("preserves conflicting body hierarchy evidence without merging it into the native graph", async () => {
    const conflictMap = githubIssue({
      number: 1,
      title: "Hierarchy conflict Map",
      labels: ["wayfinder:map"],
      body: `## Destination

Expose hierarchy disagreement.

## Work

- [ ] [Fallback child](https://github.com/example/reference/issues/3)
`,
    });
    const nativeParent = githubIssue({
      number: 2,
      title: "Native parent",
      body: "Parent body.",
    });
    const conflictingChild = githubIssue({
      number: 3,
      title: "Conflicting child",
      body: "Part of #1",
    });
    const issues = [conflictMap, nativeParent, conflictingChild];
    const fixtures: Record<string, FixtureResponse> = {
      "repos/example/reference": {
        first: response(repository, '"repo-v1"'),
      },
    };
    for (const issue of issues) {
      const endpoint = `repos/example/reference/issues/${issue.number}`;
      fixtures[endpoint] = { first: response(issue, `"issue-${issue.number}-v1"`) };
      fixtures[`${endpoint}/comments?per_page=100&page=1`] = {
        first: response([], `"comments-${issue.number}-v1"`),
      };
      fixtures[`${endpoint}/dependencies/blocked_by?per_page=100&page=1`] = {
        first: response([], `"dependencies-${issue.number}-v1"`),
      };
      fixtures[`${endpoint}/sub_issues?per_page=100&page=1`] = {
        first: response(
          issue.number === 1 ? [nativeParent] : issue.number === 2 ? [conflictingChild] : [],
          `"children-${issue.number}-v1"`,
        ),
      };
    }
    const nativeScope = nativeScopeFor(conflictMap, "wayfinder-map");
    const result = await createGitHubMattProvider({
      repoRoot: await createRepository(),
      contractLocator,
      triageLocator,
      transport: new FixtureGitHubTransport(fixtures),
      clock: () => new Date("2026-07-28T00:00:00Z"),
    }).capture({ provider: "matt-skills/v1", nativeScope });

    expect(result.state).toBe("partial");
    expect(result.diagnostics.map((item) => item.code)).toContain(
      "matt.github.relation.native-fallback-conflict",
    );
    expect(
      result.projection?.graph.parentChild.map((relation) => ({
        parent: String(relation.parent),
        child: String(relation.child),
        evidence: relation.evidence,
      })),
    ).toEqual([
      {
        parent: "github:R_reference:I_reference_1",
        child: "github:R_reference:I_reference_2",
        evidence: "github-native",
      },
      {
        parent: "github:R_reference:I_reference_2",
        child: "github:R_reference:I_reference_3",
        evidence: "github-native",
      },
    ]);
    expect(result.projection?.map?.native.rawFacets).toContainEqual({
      key: "relation-conflict:parent-child-fallback",
      values: ["github:R_reference:I_reference_3"],
    });
  });

  test("does not downgrade hierarchy acquisition failures to body fallback", async () => {
    const guardedMap = githubIssue({
      number: 1,
      title: "Permission-guarded Map",
      labels: ["wayfinder:map"],
      body: `## Destination

Do not mistake permission failure for unsupported hierarchy.

## Work

- [ ] [Fallback-looking child](https://github.com/example/reference/issues/2)
`,
    });
    const transport = new FixtureGitHubTransport({
      "repos/example/reference": {
        first: response(repository, '"repo-v1"'),
      },
      "repos/example/reference/issues/1": {
        first: response(guardedMap, '"issue-v1"'),
      },
      "repos/example/reference/issues/1/comments?per_page=100&page=1": {
        first: response([], '"comments-v1"'),
      },
      "repos/example/reference/issues/1/dependencies/blocked_by?per_page=100&page=1": {
        first: response([], '"dependencies-v1"'),
      },
      "repos/example/reference/issues/1/sub_issues?per_page=100&page=1": {
        first: {
          status: 403,
          headers: {},
          body: { message: "Resource not accessible by integration" },
        },
      },
    });
    const nativeScope = nativeScopeFor(guardedMap, "wayfinder-map");
    const result = await createGitHubMattProvider({
      repoRoot: await createRepository(),
      contractLocator,
      triageLocator,
      transport,
      clock: () => new Date("2026-07-28T00:00:00Z"),
    }).capture({ provider: "matt-skills/v1", nativeScope });

    expect(result.state).toBe("partial");
    expect(result.freshness.assessment).toBe("undetermined");
    expect(result.projection?.graph.parentChild).toEqual([]);
    expect(result.diagnostics.map((item) => item.code)).toContain(
      "matt.github.acquisition.permission",
    );
    expect(
      transport.requests.some((request) => request.endpoint === "repos/example/reference/issues/2"),
    ).toBe(false);
  });

  test("admits only an explicitly enabled external PR as a standalone request", async () => {
    const enabledContract = contract.replace(
      "**PRs as a request surface: no.**",
      "**PRs as a request surface: yes.**",
    );
    const externalPullRequest = {
      ...githubIssue({
        number: 6,
        title: "Contributed request",
        labels: ["custom-enhancement", "custom-ready"],
        body: "Please consider this attached contribution.",
      }),
      html_url: "https://github.com/example/reference/pull/6",
      pull_request: {
        url: "https://api.github.com/repos/example/reference/pulls/6",
      },
      author_association: "FIRST_TIME_CONTRIBUTOR",
    };
    const fixtures: Record<string, FixtureResponse> = {
      "repos/example/reference": {
        first: response(repository, '"repo-v1"'),
      },
      "repos/example/reference/issues/6": {
        first: response(externalPullRequest, '"pr-6-v1"'),
      },
      "repos/example/reference/issues/6/comments?per_page=100&page=1": {
        first: response([], '"comments-6-v1"'),
      },
      "repos/example/reference/issues/6/dependencies/blocked_by?per_page=100&page=1": {
        first: response([], '"deps-6-v1"'),
      },
    };
    const nativeScope = nativeScopeFor(externalPullRequest);
    const captureWith = async (contractBody: string, issue = externalPullRequest) => {
      const root = await createRepository(contractBody);
      const transport = new FixtureGitHubTransport({
        ...fixtures,
        "repos/example/reference/issues/6": {
          first: response(issue, '"pr-6-v1"'),
        },
      });
      return createGitHubMattProvider({
        repoRoot: root,
        contractLocator,
        triageLocator,
        transport,
        clock: () => new Date("2026-07-28T00:00:00Z"),
      }).capture({ provider: "matt-skills/v1", nativeScope });
    };

    const eligible = await captureWith(enabledContract);
    expect(eligible.state).toBe("available");
    expect(eligible.projection?.incomingIssues[0]?.native).toMatchObject({
      kind: "github",
      identity: { objectKind: "pull-request", number: 6 },
    });

    const disabled = await captureWith(contract);
    expect(disabled.state).toBe("invalid");
    expect(disabled.diagnostics.map((item) => item.code)).toContain(
      "matt.github.root.pr-not-enabled",
    );

    const internal = await captureWith(enabledContract, {
      ...externalPullRequest,
      author_association: "MEMBER",
    });
    expect(internal.state).toBe("invalid");
    expect(internal.diagnostics.map((item) => item.code)).toContain(
      "matt.github.root.pr-not-external",
    );
  });

  test("requires explicit rebind for repository rename, transfer, redirect and URL mismatch", async () => {
    const root = await createRepository();
    const nativeScope = nativeScopeFor(incomingIssue);
    const captureWith = async (
      repositoryValue: typeof repository,
      issueValue: typeof incomingIssue,
    ) =>
      createGitHubMattProvider({
        repoRoot: root,
        contractLocator,
        triageLocator,
        transport: new FixtureGitHubTransport({
          "repos/example/reference": {
            first: response(repositoryValue, '"repo-v1"'),
          },
          "repos/example/reference/issues/109": {
            first: response(issueValue, '"issue-v1"'),
          },
          "repos/example/reference/issues/109/comments?per_page=100&page=1": {
            first: response([], '"comments-v1"'),
          },
          "repos/example/reference/issues/109/dependencies/blocked_by?per_page=100&page=1": {
            first: response([], '"dependencies-v1"'),
          },
        }),
        clock: () => new Date("2026-07-28T00:00:00Z"),
      }).capture({ provider: "matt-skills/v1", nativeScope });

    const captures = await Promise.all([
      captureWith(
        {
          ...repository,
          name: "renamed",
          full_name: "example/renamed",
          html_url: "https://github.com/example/renamed",
        },
        incomingIssue,
      ),
      captureWith(
        {
          ...repository,
          html_url: "https://github.com/example/reference-redirect",
        },
        incomingIssue,
      ),
      captureWith(repository, {
        ...incomingIssue,
        html_url: "https://github.com/other/repository/issues/109",
        repository_url: "https://api.github.com/repos/other/repository",
      }),
      captureWith(repository, {
        ...incomingIssue,
        html_url: "https://github.com/example/reference/issues/109?redirected=1",
      }),
    ]);

    for (const capture of captures) {
      expect(capture.state).toBe("invalid");
      expect(capture.freshness.assessment).toBe("current");
      expect(capture.diagnostics.map((item) => item.code)).toContain(
        "matt.github.identity.rebind-required",
      );
      expect(capture.binding.nativeScope).toBe(nativeScope);
    }
  });

  test("uses only repository-owned triage mappings for GitHub state and category semantics", async () => {
    const stateOnlyTriage = `# Triage Labels

| Label in mattpocock/skills | Label in our tracker | Meaning |
| --- | --- | --- |
| \`needs-triage\` | \`custom-triage\` | Evaluate |
| \`needs-info\` | \`custom-info\` | Waiting |
| \`ready-for-agent\` | \`custom-ready\` | Ready |
| \`ready-for-human\` | \`custom-human\` | Human |
| \`wontfix\` | \`custom-wontfix\` | Rejected |
`;
    const root = await makeTemporaryDirectory("bearing-github-mapping-owned-");
    await writeFixture(root, contractLocator, contract);
    await writeFixture(root, triageLocator, stateOnlyTriage);
    const issueWithUnmappedCategory = githubIssue({
      number: 6,
      title: "Do not hardcode a category mapping",
      labels: ["enhancement", "custom-ready"],
      body: "Classification requires repository-owned evidence.",
    });
    const incomingScope = nativeScopeFor(issueWithUnmappedCategory);
    const incoming = await createGitHubMattProvider({
      repoRoot: root,
      contractLocator,
      triageLocator,
      transport: new FixtureGitHubTransport({
        "repos/example/reference": {
          first: response(repository, '"repo-v1"'),
        },
        "repos/example/reference/issues/6": {
          first: response(issueWithUnmappedCategory, '"issue-v1"'),
        },
        "repos/example/reference/issues/6/comments?per_page=100&page=1": {
          first: response([], '"comments-v1"'),
        },
        "repos/example/reference/issues/6/dependencies/blocked_by?per_page=100&page=1": {
          first: response([], '"dependencies-v1"'),
        },
      }),
      clock: () => new Date("2026-07-28T00:00:00Z"),
    }).capture({ provider: "matt-skills/v1", nativeScope: incomingScope });

    expect(incoming.state).toBe("partial");
    expect(incoming.projection?.incomingIssues[0]?.classification).toEqual({
      category: "unknown",
      state: "ready-for-agent",
      nativeState: "custom-ready",
    });
    expect(incoming.diagnostics.map((item) => item.code)).toContain("matt.github.triage.ambiguous");

    const specWithDefaultLookingLabel = {
      ...specIssue,
      labels: [{ id: 2, node_id: "L_default_ready", name: "ready-for-agent" }],
    };
    const specScope = nativeScopeFor(specWithDefaultLookingLabel);
    const spec = await createGitHubMattProvider({
      repoRoot: root,
      contractLocator,
      triageLocator,
      transport: new FixtureGitHubTransport({
        "repos/example/reference": {
          first: response(repository, '"repo-v1"'),
        },
        "repos/example/reference/issues/2": {
          first: response(specWithDefaultLookingLabel, '"spec-v1"'),
        },
        "repos/example/reference/issues/2/comments?per_page=100&page=1": {
          first: response([], '"comments-v1"'),
        },
        "repos/example/reference/issues/2/dependencies/blocked_by?per_page=100&page=1": {
          first: response([], '"dependencies-v1"'),
        },
      }),
      clock: () => new Date("2026-07-28T00:00:00Z"),
    }).capture({ provider: "matt-skills/v1", nativeScope: specScope });

    expect(spec.state).toBe("available");
    expect(spec.projection?.spec?.lifecycle).toEqual({ state: "draft" });
  });

  test("fails closed on ambiguous repository mapping and conflicting canonical role evidence", async () => {
    const ambiguousTriage = `${triage.trimEnd()}
| \`ready-for-agent\` | \`another-ready\` | Conflicting duplicate |
`;
    const mappingRoot = await makeTemporaryDirectory("bearing-github-mapping-");
    await writeFixture(mappingRoot, contractLocator, contract);
    await writeFixture(mappingRoot, triageLocator, ambiguousTriage);
    const standaloneScope = nativeScopeFor(incomingIssue);
    const mapping = await createGitHubMattProvider({
      repoRoot: mappingRoot,
      contractLocator,
      triageLocator,
      transport: new FixtureGitHubTransport({
        "repos/example/reference": {
          first: response(repository, '"repo-v1"'),
        },
        "repos/example/reference/issues/109": {
          first: response(incomingIssue, '"issue-v1"'),
        },
        "repos/example/reference/issues/109/comments?per_page=100&page=1": {
          first: response([], '"comments-v1"'),
        },
        "repos/example/reference/issues/109/dependencies/blocked_by?per_page=100&page=1": {
          first: response([], '"dependencies-v1"'),
        },
      }),
      clock: () => new Date("2026-07-28T00:00:00Z"),
    }).capture({ provider: "matt-skills/v1", nativeScope: standaloneScope });
    expect(mapping.state).toBe("partial");
    expect(mapping.coverage.assessment).toBe("incomplete");
    expect(mapping.diagnostics.map((item) => item.code)).toContain("matt.github.mapping.ambiguous");
    expect(mapping.projection?.incomingIssues[0]?.classification).toEqual({
      category: "enhancement",
      state: "unknown",
      nativeCategory: "custom-enhancement",
    });

    const conflictingRole = githubIssue({
      number: 8,
      title: "Do not classify from title",
      labels: ["wayfinder:research", "wayfinder:future"],
      body: `## Question

Which canonical role owns this issue?
`,
    });
    const roleScope = nativeScopeFor(conflictingRole);
    const role = await createGitHubMattProvider({
      repoRoot: await createRepository(),
      contractLocator,
      triageLocator,
      transport: new FixtureGitHubTransport({
        "repos/example/reference": {
          first: response(repository, '"repo-v1"'),
        },
        "repos/example/reference/issues/8": {
          first: response(conflictingRole, '"issue-v1"'),
        },
        "repos/example/reference/issues/8/comments?per_page=100&page=1": {
          first: response([], '"comments-v1"'),
        },
        "repos/example/reference/issues/8/dependencies/blocked_by?per_page=100&page=1": {
          first: response([], '"dependencies-v1"'),
        },
      }),
      clock: () => new Date("2026-07-28T00:00:00Z"),
    }).capture({ provider: "matt-skills/v1", nativeScope: roleScope });
    expect(role.state).toBe("partial");
    expect(role.projection?.wayfinderTickets).toEqual([]);
    expect(role.projection?.incomingIssues).toEqual([]);
    expect(role.diagnostics.map((item) => item.code)).toContain(
      "matt.github.role.ambiguous-wayfinder",
    );

    const partialDelivery = githubIssue({
      number: 9,
      title: "Partial canonical delivery",
      labels: ["custom-ready"],
      body: `## What to build

A role that is not yet structurally complete.
`,
    });
    const partialScope = nativeScopeFor(partialDelivery);
    const partial = await createGitHubMattProvider({
      repoRoot: await createRepository(),
      contractLocator,
      triageLocator,
      transport: new FixtureGitHubTransport({
        "repos/example/reference": {
          first: response(repository, '"repo-v1"'),
        },
        "repos/example/reference/issues/9": {
          first: response(partialDelivery, '"issue-v1"'),
        },
        "repos/example/reference/issues/9/comments?per_page=100&page=1": {
          first: response([], '"comments-v1"'),
        },
        "repos/example/reference/issues/9/dependencies/blocked_by?per_page=100&page=1": {
          first: response([], '"dependencies-v1"'),
        },
      }),
      clock: () => new Date("2026-07-28T00:00:00Z"),
    }).capture({ provider: "matt-skills/v1", nativeScope: partialScope });
    expect(partial.state).toBe("partial");
    expect(partial.projection?.deliveryTickets).toEqual([]);
    expect(partial.projection?.incomingIssues).toEqual([]);
    expect(partial.diagnostics.map((item) => item.code)).toContain(
      "matt.github.role.ambiguous-structure",
    );
  });

  test("fails closed when a valid triage row has a blank duplicate semantic mapping", async () => {
    const blankDuplicateTriage = `${triage.trimEnd()}
| \`ready-for-agent\` |  | Blank conflicting duplicate |
`;
    const root = await makeTemporaryDirectory("bearing-github-blank-mapping-");
    await writeFixture(root, contractLocator, contract);
    await writeFixture(root, triageLocator, blankDuplicateTriage);
    const nativeScope = nativeScopeFor(incomingIssue);
    const result = await createGitHubMattProvider({
      repoRoot: root,
      contractLocator,
      triageLocator,
      transport: new FixtureGitHubTransport({
        "repos/example/reference": {
          first: response(repository, '"repo-v1"'),
        },
        "repos/example/reference/issues/109": {
          first: response(incomingIssue, '"issue-v1"'),
        },
        "repos/example/reference/issues/109/comments?per_page=100&page=1": {
          first: response([], '"comments-v1"'),
        },
        "repos/example/reference/issues/109/dependencies/blocked_by?per_page=100&page=1": {
          first: response([], '"dependencies-v1"'),
        },
      }),
      clock: () => new Date("2026-07-28T00:00:00Z"),
    }).capture({ provider: "matt-skills/v1", nativeScope });

    expect(result.state).toBe("partial");
    expect(result.diagnostics.map((item) => item.code)).toContain("matt.github.mapping.ambiguous");
    expect(result.projection?.incomingIssues[0]?.classification).toEqual({
      category: "enhancement",
      state: "unknown",
      nativeCategory: "custom-enhancement",
    });
  });

  test("uses body dependency fallback only for proven unsupported capability and preserves conflicts", async () => {
    const relationMap = githubIssue({
      number: 1,
      title: "Relation Map",
      labels: ["wayfinder:map"],
      body: `## Destination

Prove dependency authority.
`,
    });
    const blocker = githubIssue({
      number: 3,
      title: "Primary blocker",
      labels: ["wayfinder:research"],
      body: `## Question

What blocks delivery?
`,
    });
    const alternate = githubIssue({
      number: 5,
      title: "Alternate blocker",
      labels: ["wayfinder:prototype"],
      body: `## Question

Could another edge block delivery?
`,
    });
    const blocked = githubIssue({
      number: 4,
      title: "Blocked delivery",
      labels: ["custom-ready"],
      body: `## What to build

A dependency-aware capture.

## Acceptance criteria

- [ ] Preserve the authoritative edge.

## Blocked by

- [Primary blocker](https://github.com/example/reference/issues/3)
`,
    });
    const issues = [relationMap, blocker, blocked, alternate];
    const nativeScope = nativeScopeFor(relationMap, "wayfinder-map");
    const captureWith = async (dependencyResponse: GitHubReadResponse) => {
      const root = await createRepository();
      const fixtures: Record<string, FixtureResponse> = {
        "repos/example/reference": {
          first: response(repository, '"repo-v1"'),
        },
      };
      for (const issue of issues) {
        const endpoint = `repos/example/reference/issues/${issue.number}`;
        fixtures[endpoint] = {
          first: response(issue, `"issue-${issue.number}-v1"`),
        };
        fixtures[`${endpoint}/comments?per_page=100&page=1`] = {
          first: response([], `"comments-${issue.number}-v1"`),
        };
        fixtures[`${endpoint}/dependencies/blocked_by?per_page=100&page=1`] = {
          first:
            issue.number === 4 ? dependencyResponse : response([], `"deps-${issue.number}-v1"`),
        };
        fixtures[`${endpoint}/sub_issues?per_page=100&page=1`] = {
          first: response(
            issue.number === 1 ? [blocker, blocked, alternate] : [],
            `"children-${issue.number}-v1"`,
          ),
        };
      }
      const transport = new FixtureGitHubTransport(fixtures);
      return createGitHubMattProvider({
        repoRoot: root,
        contractLocator,
        triageLocator,
        transport,
        clock: () => new Date("2026-07-28T00:00:00Z"),
      }).capture({ provider: "matt-skills/v1", nativeScope });
    };

    const fallback = await captureWith({
      status: 410,
      headers: {},
      body: { message: "Gone" },
    });
    expect(fallback.state).toBe("available");
    expect(fallback.freshness.assessment).toBe("current");
    expect(fallback.projection?.graph.blockedBy.map((relation) => relation.evidence)).toEqual([
      "matt-body-fallback",
    ]);

    const permission = await captureWith({
      status: 403,
      headers: {},
      body: { message: "Resource not accessible by integration" },
    });
    expect(permission.state).toBe("partial");
    expect(permission.freshness.assessment).toBe("undetermined");
    expect(permission.projection?.graph.blockedBy).toEqual([]);
    expect(permission.diagnostics.map((item) => item.code)).toContain(
      "matt.github.pagination.incomplete",
    );

    const conflict = await captureWith(response([alternate], '"deps-4-v1"'));
    expect(conflict.state).toBe("partial");
    expect(conflict.freshness.assessment).toBe("current");
    expect(conflict.projection?.graph.blockedBy.map((relation) => relation.evidence)).toEqual([
      "github-native",
    ]);
    expect(conflict.projection?.deliveryTickets[0]?.native.rawFacets).toContainEqual({
      key: "relation-conflict:blocked-by-fallback",
      values: ["github:R_reference:I_reference_3"],
    });
    expect(conflict.diagnostics.map((item) => item.code)).toContain(
      "matt.github.relation.native-fallback-conflict",
    );
  });

  test("preserves scope-external body relation evidence when native capabilities are unsupported", async () => {
    const issueWithFallbackRelations = {
      ...incomingIssue,
      body: `Part of #2

Blocked by: #3
`,
    };
    const endpoint = "repos/example/reference/issues/109";
    const result = await createGitHubMattProvider({
      repoRoot: await createRepository(),
      contractLocator,
      triageLocator,
      transport: new FixtureGitHubTransport({
        "repos/example/reference": {
          first: response(repository, '"repo-v1"'),
        },
        [endpoint]: {
          first: response(issueWithFallbackRelations, '"issue-v1"'),
        },
        [`${endpoint}/parent`]: {
          first: { status: 410, headers: {}, body: { message: "Gone" } },
        },
        [`${endpoint}/comments?per_page=100&page=1`]: {
          first: response([], '"comments-v1"'),
        },
        [`${endpoint}/dependencies/blocked_by?per_page=100&page=1`]: {
          first: { status: 410, headers: {}, body: { message: "Gone" } },
        },
      }),
      clock: () => new Date("2026-07-28T00:00:00Z"),
    }).capture({
      provider: "matt-skills/v1",
      nativeScope: nativeScopeFor(issueWithFallbackRelations),
    });

    expect(result.state).toBe("available");
    expect(result.projection?.graph.parentChild).toEqual([]);
    expect(result.projection?.graph.blockedBy).toEqual([]);
    expect(result.projection?.incomingIssues[0]?.native.sourceAnchors).toEqual(
      expect.arrayContaining([
        {
          kind: "external",
          target: "https://github.com/example/reference/issues/2",
        },
        {
          kind: "external",
          target: "https://github.com/example/reference/issues/3",
        },
      ]),
    );
    expect(result.projection?.incomingIssues[0]?.native.rawFacets).toEqual(
      expect.arrayContaining([
        {
          key: "fallback-external-parent",
          values: [
            "https://api.github.com/repos/example/reference|R_reference|example|reference|2|https://github.com/example/reference/issues/2",
          ],
        },
        {
          key: "fallback-external-blocked-by",
          values: [
            "https://api.github.com/repos/example/reference|R_reference|example|reference|3|https://github.com/example/reference/issues/3",
          ],
        },
      ]),
    );
  });

  test("fails closed on external body relations that disagree with available native evidence", async () => {
    const captureStandalone = async (
      body: string,
      parent: GitHubReadResponse,
      dependencies: GitHubReadResponse,
    ) => {
      const issue = { ...incomingIssue, body };
      const endpoint = "repos/example/reference/issues/109";
      return createGitHubMattProvider({
        repoRoot: await createRepository(),
        contractLocator,
        triageLocator,
        transport: new FixtureGitHubTransport({
          "repos/example/reference": {
            first: response(repository, '"repo-v1"'),
          },
          [endpoint]: {
            first: response(issue, '"issue-v1"'),
          },
          [`${endpoint}/parent`]: {
            first: parent,
          },
          [`${endpoint}/comments?per_page=100&page=1`]: {
            first: response([], '"comments-v1"'),
          },
          [`${endpoint}/dependencies/blocked_by?per_page=100&page=1`]: {
            first: dependencies,
          },
        }),
        clock: () => new Date("2026-07-28T00:00:00Z"),
      }).capture({ provider: "matt-skills/v1", nativeScope: nativeScopeFor(issue) });
    };

    const blockedBy = await captureStandalone(
      "Blocked by: #99",
      { status: 404, headers: {}, body: { message: "Not Found" } },
      response([], '"deps-v1"'),
    );
    expect(blockedBy.state).toBe("partial");
    expect(blockedBy.diagnostics.map((item) => item.code)).toContain(
      "matt.github.relation.native-fallback-conflict",
    );
    expect(blockedBy.projection?.incomingIssues[0]?.native.rawFacets).toContainEqual({
      key: "fallback-external-blocked-by",
      values: [
        "https://api.github.com/repos/example/reference|R_reference|example|reference|99|https://github.com/example/reference/issues/99",
      ],
    });

    const parent = await captureStandalone(
      "Part of #99",
      { status: 404, headers: {}, body: { message: "Not Found" } },
      response([], '"deps-v1"'),
    );
    expect(parent.state).toBe("partial");
    expect(parent.diagnostics.map((item) => item.code)).toContain(
      "matt.github.relation.native-fallback-conflict",
    );
    expect(parent.projection?.incomingIssues[0]?.native.rawFacets).toContainEqual({
      key: "fallback-external-parent",
      values: [
        "https://api.github.com/repos/example/reference|R_reference|example|reference|99|https://github.com/example/reference/issues/99",
      ],
    });

    const mapWithExternalFallback = githubIssue({
      number: 1,
      title: "Native-empty Map",
      labels: ["wayfinder:map"],
      body: `## Destination

Keep native emptiness authoritative.

## Work

- [ ] [External fallback child](https://github.com/example/reference/issues/99)
`,
    });
    const mapEndpoint = "repos/example/reference/issues/1";
    const map = await createGitHubMattProvider({
      repoRoot: await createRepository(),
      contractLocator,
      triageLocator,
      transport: new FixtureGitHubTransport({
        "repos/example/reference": {
          first: response(repository, '"repo-v1"'),
        },
        [mapEndpoint]: {
          first: response(mapWithExternalFallback, '"issue-v1"'),
        },
        [`${mapEndpoint}/comments?per_page=100&page=1`]: {
          first: response([], '"comments-v1"'),
        },
        [`${mapEndpoint}/dependencies/blocked_by?per_page=100&page=1`]: {
          first: response([], '"deps-v1"'),
        },
        [`${mapEndpoint}/sub_issues?per_page=100&page=1`]: {
          first: response([], '"children-v1"'),
        },
      }),
      clock: () => new Date("2026-07-28T00:00:00Z"),
    }).capture({
      provider: "matt-skills/v1",
      nativeScope: nativeScopeFor(mapWithExternalFallback, "wayfinder-map"),
    });
    expect(map.state).toBe("partial");
    expect(map.diagnostics.map((item) => item.code)).toContain(
      "matt.github.relation.native-fallback-conflict",
    );
    expect(map.projection?.map?.native.rawFacets).toContainEqual({
      key: "fallback-external-child",
      values: [
        "https://api.github.com/repos/example/reference|R_reference|example|reference|99|https://github.com/example/reference/issues/99",
      ],
    });
  });

  test("does not expand a parent root through ordinary task-list links when native hierarchy is unsupported", async () => {
    const parent = githubIssue({
      number: 2,
      title: "Fallback Spec",
      labels: ["custom-ready"],
      body: `## Problem Statement

Native hierarchy is unavailable.

## Solution

Use only the Matt-owned fallback.

## User Stories

A parent scope remains bounded.

## Implementation Decisions

Require both task-list membership and Part of evidence.

## Testing Decisions

Exercise the public capture seam.

## Out of Scope

Do not scan repository issues.

## Further Notes

Fallback remains provider-internal.

## Delivery tickets

- [ ] [Deliver the fallback](https://github.com/example/reference/issues/4)
`,
    });
    const child = githubIssue({
      number: 4,
      title: "Deliver the fallback",
      labels: ["custom-ready"],
      body: `Part of #2

## What to build

A bounded parent capture.

## Acceptance criteria

- [ ] Preserve fallback parent evidence.
`,
    });
    const root = await createRepository();
    const fixtures: Record<string, FixtureResponse> = {
      "repos/example/reference": {
        first: response(repository, '"repo-v1"'),
      },
    };
    for (const issue of [parent, child]) {
      const endpoint = `repos/example/reference/issues/${issue.number}`;
      fixtures[endpoint] = {
        first: response(issue, `"issue-${issue.number}-v1"`),
      };
      fixtures[`${endpoint}/comments?per_page=100&page=1`] = {
        first: response([], `"comments-${issue.number}-v1"`),
      };
      fixtures[`${endpoint}/dependencies/blocked_by?per_page=100&page=1`] = {
        first: response([], `"deps-${issue.number}-v1"`),
      };
      fixtures[`${endpoint}/sub_issues?per_page=100&page=1`] = {
        first: {
          status: 410,
          headers: {},
          body: { message: "Gone" },
        },
      };
    }
    const transport = new FixtureGitHubTransport(fixtures);
    const nativeScope = nativeScopeFor(parent, "parent-issue");
    const result = await createGitHubMattProvider({
      repoRoot: root,
      contractLocator,
      triageLocator,
      transport,
      clock: () => new Date("2026-07-28T00:00:00Z"),
    }).capture({ provider: "matt-skills/v1", nativeScope });

    expect(result.state).toBe("partial");
    expect(result.freshness.assessment).toBe("undetermined");
    expect(result.coverage.assessment).toBe("incomplete");
    expect(result.diagnostics.map((item) => item.code)).toContain(
      "matt.github.scope.fallback-unavailable",
    );
    expect(result.projection?.spec?.title).toBe("Fallback Spec");
    expect(result.projection?.deliveryTickets).toEqual([]);
    expect(result.projection?.graph.parentChild).toEqual([]);
    expect(
      transport.requests.some(
        (request) =>
          request.endpoint === "repos/example/reference/issues/4" ||
          request.endpoint.includes("repos/example/reference/issues?"),
      ),
    ).toBe(false);
  });

  test("uses the Matt Map task-list plus Part of fallback only after native hierarchy is proven unsupported", async () => {
    const fallbackMap = githubIssue({
      number: 1,
      title: "Fallback Map",
      labels: ["wayfinder:map"],
      body: `## Destination

Keep fallback membership bounded to the Matt Map contract.

## Work

- [ ] [Research fallback scope](https://github.com/example/reference/issues/3)
- [ ] [Near-match ordinary link](https://github.com/example/reference/issues/99draft)
`,
    });
    const fallbackChild = githubIssue({
      number: 3,
      title: "Research fallback scope",
      labels: ["wayfinder:research"],
      body: `Part of #1

## Question

Which issue belongs to the fallback scope?
`,
    });
    const fixtures: Record<string, FixtureResponse> = {
      "repos/example/reference": {
        first: response(repository, '"repo-v1"'),
      },
    };
    for (const issue of [fallbackMap, fallbackChild]) {
      const endpoint = `repos/example/reference/issues/${issue.number}`;
      fixtures[endpoint] = { first: response(issue, `"issue-${issue.number}-v1"`) };
      fixtures[`${endpoint}/parent`] = {
        first: { status: 410, headers: {}, body: { message: "Gone" } },
      };
      fixtures[`${endpoint}/comments?per_page=100&page=1`] = {
        first: response([], `"comments-${issue.number}-v1"`),
      };
      fixtures[`${endpoint}/dependencies/blocked_by?per_page=100&page=1`] = {
        first: response([], `"deps-${issue.number}-v1"`),
      };
      fixtures[`${endpoint}/sub_issues?per_page=100&page=1`] = {
        first: { status: 410, headers: {}, body: { message: "Gone" } },
      };
    }
    const transport = new FixtureGitHubTransport(fixtures);
    const nativeScope = nativeScopeFor(fallbackMap, "wayfinder-map");
    const result = await createGitHubMattProvider({
      repoRoot: await createRepository(),
      contractLocator,
      triageLocator,
      transport,
      clock: () => new Date("2026-07-28T00:00:00Z"),
    }).capture({ provider: "matt-skills/v1", nativeScope });

    expect(result.state).toBe("available");
    expect(result.freshness.assessment).toBe("current");
    expect(result.projection?.wayfinderTickets.map((ticket) => ticket.title)).toEqual([
      "Research fallback scope",
    ]);
    expect(
      result.projection?.graph.parentChild.map((relation) => ({
        parent: String(relation.parent),
        child: String(relation.child),
        evidence: relation.evidence,
      })),
    ).toEqual([
      {
        parent: "github:R_reference:I_reference_1",
        child: "github:R_reference:I_reference_3",
        evidence: "matt-body-fallback",
      },
    ]);
    expect(
      transport.requests.filter((request) =>
        request.endpoint.endsWith("/sub_issues?per_page=100&page=1"),
      ),
    ).toHaveLength(4);
    expect(
      transport.requests.filter((request) => request.endpoint.endsWith("/parent")),
    ).toHaveLength(4);
    expect(transport.requests.some((request) => request.endpoint.includes("/issues/99"))).toBe(
      false,
    );
  });

  test("does not coerce near-match issue references into fallback relations", async () => {
    const referenceMap = githubIssue({
      number: 1,
      title: "Exact reference Map",
      labels: ["wayfinder:map"],
      body: `## Destination

Accept only exact issue references.
`,
    });
    const blocker = githubIssue({
      number: 3,
      title: "Potential blocker",
      labels: ["wayfinder:research"],
      body: `## Question

Is this an exact blocker?
`,
    });
    const blocked = githubIssue({
      number: 4,
      title: "Near-match dependency",
      labels: ["custom-ready"],
      body: `## What to build

Reject suffix-coerced issue numbers.

## Acceptance criteria

- [ ] Preserve exact references only.

Blocked by: #3draft
`,
    });
    const fixtures: Record<string, FixtureResponse> = {
      "repos/example/reference": {
        first: response(repository, '"repo-v1"'),
      },
    };
    for (const issue of [referenceMap, blocker, blocked]) {
      const endpoint = `repos/example/reference/issues/${issue.number}`;
      fixtures[endpoint] = { first: response(issue, `"issue-${issue.number}-v1"`) };
      fixtures[`${endpoint}/comments?per_page=100&page=1`] = {
        first: response([], `"comments-${issue.number}-v1"`),
      };
      fixtures[`${endpoint}/dependencies/blocked_by?per_page=100&page=1`] = {
        first:
          issue.number === 4
            ? { status: 410, headers: {}, body: { message: "Gone" } }
            : response([], `"deps-${issue.number}-v1"`),
      };
      fixtures[`${endpoint}/sub_issues?per_page=100&page=1`] = {
        first: response(
          issue.number === 1 ? [blocker, blocked] : [],
          `"children-${issue.number}-v1"`,
        ),
      };
    }
    const nativeScope = nativeScopeFor(referenceMap, "wayfinder-map");
    const result = await createGitHubMattProvider({
      repoRoot: await createRepository(),
      contractLocator,
      triageLocator,
      transport: new FixtureGitHubTransport(fixtures),
      clock: () => new Date("2026-07-28T00:00:00Z"),
    }).capture({ provider: "matt-skills/v1", nativeScope });

    expect(result.state).toBe("available");
    expect(result.projection?.graph.blockedBy).toEqual([]);
  });

  test("preserves scope-external native parent identity and fails closed on traversal conflict", async () => {
    const parentConflictMap = githubIssue({
      number: 1,
      title: "Parent conflict Map",
      labels: ["wayfinder:map"],
      body: `## Destination

Preserve both native hierarchy identities.
`,
    });
    const child = githubIssue({
      number: 3,
      title: "Child with another native parent",
      labels: ["wayfinder:research"],
      body: `## Question

Which native parent is authoritative?
`,
    });
    const externalParent = githubIssue({
      number: 2,
      title: "Scope-external native parent",
      body: "This parent is outside the explicitly bound descendant scope.",
    });
    const fixtures: Record<string, FixtureResponse> = {
      "repos/example/reference": {
        first: response(repository, '"repo-v1"'),
      },
    };
    for (const issue of [parentConflictMap, child]) {
      const endpoint = `repos/example/reference/issues/${issue.number}`;
      fixtures[endpoint] = { first: response(issue, `"issue-${issue.number}-v1"`) };
      fixtures[`${endpoint}/comments?per_page=100&page=1`] = {
        first: response([], `"comments-${issue.number}-v1"`),
      };
      fixtures[`${endpoint}/dependencies/blocked_by?per_page=100&page=1`] = {
        first: response([], `"deps-${issue.number}-v1"`),
      };
      fixtures[`${endpoint}/sub_issues?per_page=100&page=1`] = {
        first: response(issue.number === 1 ? [child] : [], `"children-${issue.number}-v1"`),
      };
    }
    fixtures["repos/example/reference/issues/3/parent"] = {
      first: response(externalParent, '"parent-3-v1"'),
    };
    const result = await createGitHubMattProvider({
      repoRoot: await createRepository(),
      contractLocator,
      triageLocator,
      transport: new FixtureGitHubTransport(fixtures),
      clock: () => new Date("2026-07-28T00:00:00Z"),
    }).capture({
      provider: "matt-skills/v1",
      nativeScope: nativeScopeFor(parentConflictMap, "wayfinder-map"),
    });

    expect(result.state).toBe("partial");
    expect(result.diagnostics.map((item) => item.code)).toContain(
      "matt.github.relation.native-parent-conflict",
    );
    expect(result.projection?.wayfinderTickets[0]?.native.sourceAnchors).toContainEqual({
      kind: "external",
      target: externalParent.html_url,
    });
    expect(result.projection?.wayfinderTickets[0]?.native.rawFacets).toContainEqual({
      key: "native-parent",
      values: [
        [
          externalParent.repository_url,
          String(externalParent.id),
          externalParent.node_id,
          String(externalParent.number),
          externalParent.html_url,
        ].join("|"),
      ],
    });
    expect(
      result.projection?.graph.parentChild.map((relation) => ({
        parent: String(relation.parent),
        child: String(relation.child),
        evidence: relation.evidence,
      })),
    ).toEqual([
      {
        parent: "github:R_reference:I_reference_1",
        child: "github:R_reference:I_reference_3",
        evidence: "github-native",
      },
    ]);
  });

  test("preserves zero and multiple-assignee claims without fabricating route resolution or Answer comments", async () => {
    const lifecycleMap = githubIssue({
      number: 1,
      title: "Lifecycle Map",
      labels: ["wayfinder:map"],
      body: `## Destination

Preserve GitHub workflow evidence.

## Decisions so far

- [Multiple claimant ticket](https://github.com/example/reference/issues/3) — Keep the route pointer without guessing an Answer.
`,
    });
    const unclaimed = githubIssue({
      number: 2,
      title: "Unclaimed ticket",
      labels: ["wayfinder:prototype"],
      body: `## Question

Who should claim this?
`,
    });
    const multipleClaimants = githubIssue({
      number: 3,
      title: "Multiple claimant ticket",
      labels: ["wayfinder:research"],
      assignees: ["lago", "blue"],
      state: "closed",
      stateReason: "completed",
      body: `## Question

Can one claimant be identified?
`,
    });
    const closedWithoutRoute = githubIssue({
      number: 4,
      title: "Closed without route",
      labels: ["wayfinder:task"],
      state: "closed",
      stateReason: "completed",
      body: `## Question

Does closure alone prove resolution?
`,
    });
    const issues = [lifecycleMap, unclaimed, multipleClaimants, closedWithoutRoute];
    const root = await createRepository();
    const fixtures: Record<string, FixtureResponse> = {
      "repos/example/reference": {
        first: response(repository, '"repo-v1"'),
      },
    };
    for (const issue of issues) {
      const endpoint = `repos/example/reference/issues/${issue.number}`;
      fixtures[endpoint] = {
        first: response(issue, `"issue-${issue.number}-v1"`),
      };
      fixtures[`${endpoint}/comments?per_page=100&page=1`] = {
        first: response(
          issue.number === 3
            ? [
                comment({
                  id: 303,
                  issue: 3,
                  body: "This ordinary comment is not uniquely referenced.",
                }),
              ]
            : issue.number === 4
              ? [
                  comment({
                    id: 404,
                    issue: 4,
                    body: "Closing prose is still not a route decision.",
                  }),
                ]
              : [],
          `"comments-${issue.number}-v1"`,
        ),
      };
      fixtures[`${endpoint}/dependencies/blocked_by?per_page=100&page=1`] = {
        first: response([], `"deps-${issue.number}-v1"`),
      };
      fixtures[`${endpoint}/sub_issues?per_page=100&page=1`] = {
        first: response(
          issue.number === 1 ? [unclaimed, multipleClaimants, closedWithoutRoute] : [],
          `"children-${issue.number}-v1"`,
        ),
      };
    }
    const nativeScope = nativeScopeFor(lifecycleMap, "wayfinder-map");
    const result = await createGitHubMattProvider({
      repoRoot: root,
      contractLocator,
      triageLocator,
      transport: new FixtureGitHubTransport(fixtures),
      clock: () => new Date("2026-07-28T00:00:00Z"),
    }).capture({ provider: "matt-skills/v1", nativeScope });

    expect(result.state).toBe("partial");
    expect(result.freshness.assessment).toBe("current");
    expect(result.projection?.wayfinderTickets[0]?.claim).toEqual({
      state: "unclaimed",
    });
    expect(result.projection?.wayfinderTickets[1]).toMatchObject({
      claim: { state: "claimed", claimantAmbiguous: true },
      lifecycle: { state: "resolved-on-route" },
      trackerClosure: { state: "closed", disposition: "completed" },
      answer: {
        availability: "unavailable",
        reason: "no-unique-native-reference",
      },
      comments: [
        {
          role: "ordinary-comment",
          document: {
            version: 1,
            sections: [
              {
                semanticRole: "wayfinder.comments",
                availability: "available",
                blocks: [
                  {
                    kind: "paragraph",
                    inlines: [
                      {
                        kind: "text",
                        value: "This ordinary comment is not uniquely referenced.",
                      },
                    ],
                  },
                ],
              },
            ],
          },
          nativeIdentity: "IC_303",
        },
      ],
    });
    expect(result.projection?.wayfinderTickets[1]?.native.rawFacets).toEqual(
      expect.arrayContaining([
        {
          key: "timestamps",
          values: ["2026-07-01T00:00:00Z", "2026-07-03T00:00:00Z", "2026-07-20T00:00:00Z"],
        },
        {
          key: "closed-by",
          values: ["closer|92|U_closer"],
        },
      ]),
    );
    expect(result.projection?.wayfinderTickets[2]).toMatchObject({
      lifecycle: { state: "open" },
      trackerClosure: { state: "closed", disposition: "completed" },
      answer: {
        availability: "unavailable",
        reason: "no-unique-native-reference",
      },
    });
    expect(result.diagnostics.map((item) => item.code)).toEqual(
      expect.arrayContaining([
        "matt.github.workflow.claimant-ambiguous",
        "matt.github.workflow.closed-without-route",
      ]),
    );
  });

  test("fails closed when duplicate Map route sections or lists make decision evidence ambiguous", async () => {
    const duplicateSectionsMap = githubIssue({
      number: 1,
      title: "Duplicate route sections Map",
      labels: ["wayfinder:map"],
      body: `## Destination

Do not erase ambiguous route evidence.

## Decisions so far

- First decision candidate.

## Decisions so far

- Second decision candidate.
`,
    });
    const multipleListsMap = githubIssue({
      number: 2,
      title: "Multiple route lists Map",
      labels: ["wayfinder:map"],
      body: `## Destination

Do not select one of multiple route lists.

## Decisions so far

- First decision candidate.

Intervening prose keeps the lists structurally distinct.

- Second decision candidate.
`,
    });
    const captureMap = async (map: ReturnType<typeof githubIssue>) => {
      const endpoint = `repos/example/reference/issues/${map.number}`;
      return createGitHubMattProvider({
        repoRoot: await createRepository(),
        contractLocator,
        triageLocator,
        transport: new FixtureGitHubTransport({
          "repos/example/reference": {
            first: response(repository, '"repo-v1"'),
          },
          [endpoint]: {
            first: response(map, `"issue-${map.number}-v1"`),
          },
          [`${endpoint}/comments?per_page=100&page=1`]: {
            first: response([], `"comments-${map.number}-v1"`),
          },
          [`${endpoint}/dependencies/blocked_by?per_page=100&page=1`]: {
            first: response([], `"deps-${map.number}-v1"`),
          },
          [`${endpoint}/sub_issues?per_page=100&page=1`]: {
            first: response([], `"children-${map.number}-v1"`),
          },
        }),
        clock: () => new Date("2026-07-28T00:00:00Z"),
      }).capture({
        provider: "matt-skills/v1",
        nativeScope: nativeScopeFor(map, "wayfinder-map"),
      });
    };

    for (const result of [
      await captureMap(duplicateSectionsMap),
      await captureMap(multipleListsMap),
    ]) {
      expect(result.state).toBe("partial");
      expect(result.diagnostics.map((item) => item.code)).toContain(
        "matt.github.role.ambiguous-map-structure",
      );
      expect(result.projection?.map?.decisions).toEqual([]);
    }
  });

  test("fails closed when Map route or Answer pointers are not unique", async () => {
    const ambiguousMap = githubIssue({
      number: 1,
      title: "Ambiguous route Map",
      labels: ["wayfinder:map"],
      body: `## Destination

Require one durable route pointer.

## Decisions so far

- [Research route](https://github.com/example/reference/issues/3#issuecomment-303) — First gist.
- [Research route](https://github.com/example/reference/issues/3#issuecomment-303) — Duplicate gist.
`,
    });
    const closedTicket = githubIssue({
      number: 3,
      title: "Research route",
      labels: ["wayfinder:research"],
      state: "closed",
      stateReason: "completed",
      body: `## Question

Which route pointer is canonical?
`,
    });
    const fixtures: Record<string, FixtureResponse> = {
      "repos/example/reference": {
        first: response(repository, '"repo-v1"'),
      },
    };
    for (const issue of [ambiguousMap, closedTicket]) {
      const endpoint = `repos/example/reference/issues/${issue.number}`;
      fixtures[endpoint] = { first: response(issue, `"issue-${issue.number}-v1"`) };
      fixtures[`${endpoint}/comments?per_page=100&page=1`] = {
        first: response(
          issue.number === 3
            ? [comment({ id: 303, issue: 3, body: "One comment, two Map references." })]
            : [],
          `"comments-${issue.number}-v1"`,
        ),
      };
      fixtures[`${endpoint}/dependencies/blocked_by?per_page=100&page=1`] = {
        first: response([], `"deps-${issue.number}-v1"`),
      };
      fixtures[`${endpoint}/sub_issues?per_page=100&page=1`] = {
        first: response(issue.number === 1 ? [closedTicket] : [], `"children-${issue.number}-v1"`),
      };
    }
    const nativeScope = nativeScopeFor(ambiguousMap, "wayfinder-map");
    const result = await createGitHubMattProvider({
      repoRoot: await createRepository(),
      contractLocator,
      triageLocator,
      transport: new FixtureGitHubTransport(fixtures),
      clock: () => new Date("2026-07-28T00:00:00Z"),
    }).capture({ provider: "matt-skills/v1", nativeScope });

    expect(result.state).toBe("partial");
    expect(result.diagnostics.map((item) => item.code)).toContain(
      "matt.github.workflow.route-ambiguous",
    );
    expect(result.projection?.wayfinderTickets[0]).toMatchObject({
      lifecycle: { state: "open" },
      answer: {
        availability: "unavailable",
        reason: "no-unique-native-reference",
      },
      comments: [
        {
          role: "ordinary-comment",
          document: {
            version: 1,
            sections: [
              {
                semanticRole: "wayfinder.comments",
                availability: "available",
                blocks: [
                  {
                    kind: "paragraph",
                    inlines: [{ kind: "text", value: "One comment, two Map references." }],
                  },
                ],
              },
            ],
          },
          nativeIdentity: "IC_303",
        },
      ],
    });
  });

  test("fails closed when one Map route entry contains multiple canonical ticket links", async () => {
    const ambiguousEntryMap = githubIssue({
      number: 1,
      title: "Ambiguous entry Map",
      labels: ["wayfinder:map"],
      body: `## Destination

Require one canonical ticket per route entry.

## Decisions so far

- [First route](https://github.com/example/reference/issues/2) conflicts with [second route](https://github.com/example/reference/issues/3).
`,
    });
    const endpoint = "repos/example/reference/issues/1";
    const result = await createGitHubMattProvider({
      repoRoot: await createRepository(),
      contractLocator,
      triageLocator,
      transport: new FixtureGitHubTransport({
        "repos/example/reference": {
          first: response(repository, '"repo-v1"'),
        },
        [endpoint]: {
          first: response(ambiguousEntryMap, '"issue-v1"'),
        },
        [`${endpoint}/comments?per_page=100&page=1`]: {
          first: response([], '"comments-v1"'),
        },
        [`${endpoint}/dependencies/blocked_by?per_page=100&page=1`]: {
          first: response([], '"dependencies-v1"'),
        },
        [`${endpoint}/sub_issues?per_page=100&page=1`]: {
          first: response([], '"children-v1"'),
        },
      }),
      clock: () => new Date("2026-07-28T00:00:00Z"),
    }).capture({
      provider: "matt-skills/v1",
      nativeScope: nativeScopeFor(ambiguousEntryMap, "wayfinder-map"),
    });

    expect(result.state).toBe("partial");
    expect(result.diagnostics.map((item) => item.code)).toContain(
      "matt.github.workflow.route-ambiguous",
    );
  });

  test("revalidates an early root absence before trusting it as current", async () => {
    let rootIssueReads = 0;
    const requests: GitHubReadRequest[] = [];
    const endpoint = "repos/example/reference/issues/109";
    const transport: GitHubReadTransport = {
      async get(request) {
        requests.push(request);
        if (request.validator !== undefined) {
          return { status: 304, headers: { etag: request.validator } };
        }
        if (request.endpoint === "repos/example/reference") {
          return response(repository, '"repo-v1"');
        }
        if (request.endpoint === endpoint) {
          rootIssueReads += 1;
          return rootIssueReads === 1
            ? { status: 404, headers: {}, body: { message: "Not Found" } }
            : response(incomingIssue, '"issue-v1"');
        }
        if (request.endpoint === `${endpoint}/parent`) {
          return { status: 404, headers: {}, body: { message: "Not Found" } };
        }
        if (
          request.endpoint === `${endpoint}/comments?per_page=100&page=1` ||
          request.endpoint === `${endpoint}/dependencies/blocked_by?per_page=100&page=1`
        ) {
          return response([], '"page-v1"');
        }
        throw new Error(`Unexpected endpoint: ${request.endpoint}`);
      },
    };
    const result = await createGitHubMattProvider({
      repoRoot: await createRepository(),
      contractLocator,
      triageLocator,
      transport,
      clock: () => new Date("2026-07-28T00:00:00Z"),
    }).capture({ provider: "matt-skills/v1", nativeScope: nativeScopeFor(incomingIssue) });

    expect(result.state).toBe("available");
    expect(result.freshness.assessment).toBe("current");
    expect(result.projection?.incomingIssues[0]?.title).toBe(incomingIssue.title);
    expect(result.freshness.evidence).toContainEqual({
      kind: "full-retry-count",
      value: "1",
    });
    expect(rootIssueReads).toBe(3);
    expect(
      requests.filter(
        (request) => request.endpoint === endpoint && request.validator === undefined,
      ),
    ).toHaveLength(3);
  });

  test("retries one full generation after validator change and degrades on continuing mutation", async () => {
    const versionedIssue = (version: number) => ({
      ...incomingIssue,
      title: `Version ${version}`,
      updated_at: `2026-07-2${version}T00:00:00Z`,
    });
    class ChangingTransport implements GitHubReadTransport {
      readonly requests: GitHubReadRequest[] = [];
      round = 0;

      constructor(private readonly keepChanging: boolean) {}

      async get(request: GitHubReadRequest): Promise<GitHubReadResponse> {
        this.requests.push(request);
        if (request.endpoint === "repos/example/reference" && request.validator === undefined) {
          this.round += 1;
        }
        const page =
          request.endpoint.includes("/comments?") ||
          request.endpoint.includes("/dependencies/blocked_by?");
        if (request.validator === undefined) {
          if (request.endpoint.endsWith("/parent")) {
            return { status: 404, headers: {} };
          }
          if (request.endpoint === "repos/example/reference") {
            return response(repository, `"repo-v${this.round}"`);
          }
          if (request.endpoint === "repos/example/reference/issues/109") {
            return response(versionedIssue(this.round), `"issue-v${this.round}"`);
          }
          if (page) return response([], `"page-v${this.round}"`);
        }
        if (
          request.endpoint === "repos/example/reference/issues/109" &&
          (this.round === 1 || this.keepChanging)
        ) {
          return response(versionedIssue(this.round + 1), `"issue-v${this.round + 1}"`);
        }
        return {
          status: 304,
          headers: request.validator === undefined ? {} : { etag: request.validator },
        };
      }
    }
    const nativeScope = nativeScopeFor(incomingIssue);
    const captureWith = async (transport: GitHubReadTransport) => {
      const root = await createRepository();
      return createGitHubMattProvider({
        repoRoot: root,
        contractLocator,
        triageLocator,
        transport,
        clock: () => new Date("2026-07-28T00:00:00Z"),
      }).capture({ provider: "matt-skills/v1", nativeScope });
    };

    const settles = new ChangingTransport(false);
    const current = await captureWith(settles);
    expect(current.state).toBe("available");
    expect(current.freshness.assessment).toBe("current");
    expect(current.projection?.incomingIssues[0]?.title).toBe("Version 2");
    expect(current.freshness.evidence).toContainEqual({
      kind: "full-retry-count",
      value: "1",
    });
    expect(settles.round).toBe(2);

    const changing = new ChangingTransport(true);
    const unstable = await captureWith(changing);
    expect(unstable.state).toBe("partial");
    expect(unstable.freshness.assessment).toBe("undetermined");
    expect(unstable.projection?.incomingIssues[0]?.title).toBe("Version 2");
    expect(unstable.diagnostics.map((item) => item.code)).toContain(
      "matt.github.concurrent-change",
    );
    expect(changing.round).toBe(2);
  });

  test("fully pages required resources and scopes auth, rate-limit and network failures", async () => {
    const nativeScope = nativeScopeFor(incomingIssue);
    const root = await createRepository();
    const firstPage = Array.from({ length: 100 }, (_, index) =>
      comment({
        id: 10_000 + index,
        issue: 109,
        body: `Page one comment ${index + 1}.`,
      }),
    );
    const pagination = await createGitHubMattProvider({
      repoRoot: root,
      contractLocator,
      triageLocator,
      transport: new FixtureGitHubTransport({
        "repos/example/reference": {
          first: response(repository, '"repo-v1"'),
        },
        "repos/example/reference/issues/109": {
          first: response(incomingIssue, '"issue-v1"'),
        },
        "repos/example/reference/issues/109/comments?per_page=100&page=1": {
          first: response(firstPage, '"comments-page-1"'),
        },
        "repos/example/reference/issues/109/comments?per_page=100&page=2": {
          first: response(
            [comment({ id: 20_001, issue: 109, body: "Page two comment." })],
            '"comments-page-2"',
          ),
        },
        "repos/example/reference/issues/109/dependencies/blocked_by?per_page=100&page=1": {
          first: response([], '"deps-v1"'),
        },
      }),
      clock: () => new Date("2026-07-28T00:00:00Z"),
    }).capture({ provider: "matt-skills/v1", nativeScope });
    expect(pagination.state).toBe("available");
    expect(
      pagination.projection?.incomingIssues[0]?.content.filter(
        (content) => content.role === "ordinary-comment",
      ),
    ).toHaveLength(101);

    const auth = await createGitHubMattProvider({
      repoRoot: root,
      contractLocator,
      triageLocator,
      transport: new FixtureGitHubTransport({
        "repos/example/reference": {
          first: {
            status: 401,
            headers: {},
            body: { message: "Requires authentication" },
          },
        },
      }),
      clock: () => new Date("2026-07-28T00:00:00Z"),
    }).capture({ provider: "matt-skills/v1", nativeScope });
    expect(auth.state).toBe("invalid");
    expect(auth.freshness.assessment).toBe("undetermined");
    expect(auth.diagnostics.map((item) => item.code)).toContain(
      "matt.github.acquisition.authentication",
    );

    const rateLimited = await createGitHubMattProvider({
      repoRoot: root,
      contractLocator,
      triageLocator,
      transport: new FixtureGitHubTransport({
        "repos/example/reference": {
          first: response(repository, '"repo-v1"'),
        },
        "repos/example/reference/issues/109": {
          first: response(incomingIssue, '"issue-v1"'),
        },
        "repos/example/reference/issues/109/comments?per_page=100&page=1": {
          first: response([], '"comments-v1"'),
        },
        "repos/example/reference/issues/109/dependencies/blocked_by?per_page=100&page=1": {
          first: {
            status: 403,
            headers: {
              "x-ratelimit-remaining": "0",
              "x-ratelimit-reset": "1785244800",
            },
            body: { message: "API rate limit exceeded" },
          },
        },
      }),
      clock: () => new Date("2026-07-28T00:00:00Z"),
    }).capture({ provider: "matt-skills/v1", nativeScope });
    expect(rateLimited.state).toBe("partial");
    expect(rateLimited.freshness.assessment).toBe("undetermined");
    expect(rateLimited.diagnostics.map((item) => item.code)).toContain(
      "matt.github.acquisition.rate-limit",
    );

    const partialPage = await createGitHubMattProvider({
      repoRoot: root,
      contractLocator,
      triageLocator,
      transport: new FixtureGitHubTransport({
        "repos/example/reference": {
          first: response(repository, '"repo-v1"'),
        },
        "repos/example/reference/issues/109": {
          first: response(incomingIssue, '"issue-v1"'),
        },
        "repos/example/reference/issues/109/comments?per_page=100&page=1": {
          first: response(firstPage, '"comments-page-1"'),
        },
        "repos/example/reference/issues/109/comments?per_page=100&page=2": {
          first: {
            status: 500,
            headers: {},
            body: { message: "Temporary upstream failure" },
          },
        },
        "repos/example/reference/issues/109/dependencies/blocked_by?per_page=100&page=1": {
          first: {
            status: 410,
            headers: {},
            body: { message: "Gone" },
          },
        },
      }),
      clock: () => new Date("2026-07-28T00:00:00Z"),
    }).capture({ provider: "matt-skills/v1", nativeScope });
    expect(partialPage.state).toBe("partial");
    expect(partialPage.freshness.assessment).toBe("undetermined");
    expect(partialPage.diagnostics.map((item) => item.code)).toEqual(
      expect.arrayContaining([
        "matt.github.acquisition.failed",
        "matt.github.pagination.incomplete",
      ]),
    );
    expect(partialPage.projection?.incomingIssues[0]?.content).toEqual(
      expect.not.arrayContaining([expect.objectContaining({ role: "ordinary-comment" })]),
    );

    class NetworkFailureTransport implements GitHubReadTransport {
      async get(request: GitHubReadRequest): Promise<GitHubReadResponse> {
        if (request.endpoint === "repos/example/reference") {
          return response(repository, '"repo-v1"');
        }
        throw new GitHubReadError("network", "Connection reset.");
      }
    }
    const network = await createGitHubMattProvider({
      repoRoot: root,
      contractLocator,
      triageLocator,
      transport: new NetworkFailureTransport(),
      clock: () => new Date("2026-07-28T00:00:00Z"),
    }).capture({ provider: "matt-skills/v1", nativeScope });
    expect(network.state).toBe("invalid");
    expect(network.freshness.assessment).toBe("undetermined");
    expect(network.diagnostics.map((item) => item.code)).toContain(
      "matt.github.acquisition.network",
    );
  });

  test("scopes conditional revalidation failures without retrying or aborting capture", async () => {
    const requests: GitHubReadRequest[] = [];
    const transport: GitHubReadTransport = {
      async get(request) {
        requests.push(request);
        if (request.validator !== undefined) {
          throw new GitHubReadError("network", "A sensitive network detail.");
        }
        if (request.endpoint === "repos/example/reference") {
          return response(repository, '"repo-v1"');
        }
        if (request.endpoint === "repos/example/reference/issues/109") {
          return response(incomingIssue, '"issue-v1"');
        }
        if (request.endpoint === "repos/example/reference/issues/109/parent") {
          return { status: 404, headers: {} };
        }
        if (
          request.endpoint === "repos/example/reference/issues/109/comments?per_page=100&page=1" ||
          request.endpoint ===
            "repos/example/reference/issues/109/dependencies/blocked_by?per_page=100&page=1"
        ) {
          return response([], '"page-v1"');
        }
        throw new Error(`Unexpected endpoint: ${request.endpoint}`);
      },
    };
    const nativeScope = nativeScopeFor(incomingIssue);
    const capture = await createGitHubMattProvider({
      repoRoot: await createRepository(),
      contractLocator,
      triageLocator,
      transport,
      clock: () => new Date("2026-07-28T00:00:00Z"),
    }).capture({ provider: "matt-skills/v1", nativeScope });

    expect(capture.state).toBe("partial");
    expect(capture.freshness.assessment).toBe("undetermined");
    expect(capture.diagnostics.map((item) => item.code)).toContain(
      "matt.github.acquisition.network",
    );
    expect(
      requests.filter(
        (request) =>
          request.endpoint === "repos/example/reference" && request.validator === undefined,
      ),
    ).toHaveLength(1);
    expect(JSON.stringify(capture)).not.toContain("sensitive");
  });

  test("records the observation window, object timestamps and revision evidence deterministically", async () => {
    const nativeScope = nativeScopeFor(incomingIssue);
    const captureWithWindow = async (end: string) => {
      const times = [new Date("2026-07-28T00:00:00.000Z"), new Date(end)];
      return createGitHubMattProvider({
        repoRoot: await createRepository(),
        contractLocator,
        triageLocator,
        transport: new FixtureGitHubTransport({
          "repos/example/reference": {
            first: response(repository, '"repo-v1"'),
          },
          "repos/example/reference/issues/109": {
            first: response(incomingIssue, '"issue-v1"'),
          },
          "repos/example/reference/issues/109/comments?per_page=100&page=1": {
            first: response([], '"comments-v1"'),
          },
          "repos/example/reference/issues/109/dependencies/blocked_by?per_page=100&page=1": {
            first: response([], '"dependencies-v1"'),
          },
        }),
        clock: () => times.shift() ?? new Date(end),
      }).capture({ provider: "matt-skills/v1", nativeScope });
    };

    const first = await captureWithWindow("2026-07-28T00:00:05.000Z");
    const replay = await captureWithWindow("2026-07-28T00:00:05.000Z");
    const later = await captureWithWindow("2026-07-28T00:00:06.000Z");
    expect(first.freshness.evidence).toEqual(
      expect.arrayContaining([
        {
          kind: "observation-window",
          value: "2026-07-28T00:00:00.000Z/2026-07-28T00:00:05.000Z",
        },
        {
          kind: "object-updated-at",
          value: "I_reference_9|2026-07-02T00:00:00Z",
        },
        { kind: "conditional-revalidation", value: "stable" },
      ]),
    );
    expect(first.sourceRevision).toBe(replay.sourceRevision);
    expect(first.sourceRevision).not.toBe(later.sourceRevision);
  });

  test("uses gh api as a bounded read-only transport without exposing credentials", async () => {
    const calls: Array<{ command: string; args: readonly string[] }> = [];
    const credentialSentinel = "credential-value-must-never-be-echoed";
    const execute: GitHubCommandExecutor = async (command, args) => {
      calls.push({ command, args });
      if (args.some((argument) => argument.startsWith("If-None-Match:"))) {
        return {
          exitCode: 0,
          stdout: 'HTTP/2.0 304 Not Modified\r\netag: "repo-v1"\r\n\r\n',
          stderr: "",
        };
      }
      return {
        exitCode: 0,
        stdout:
          'HTTP/2.0 200 OK\r\ncontent-type: application/json; charset=utf-8\r\netag: "repo-v1"\r\n\r\n{"ok":true}',
        stderr: "",
      };
    };
    const transport = createGhCliGitHubReadTransport({ execute });

    expect(
      await transport.get({
        endpoint: "repos/example/reference",
        apiVersion: "2026-03-10",
      }),
    ).toEqual({
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        etag: '"repo-v1"',
      },
      body: { ok: true },
    });
    expect(
      await transport.get({
        endpoint: "repos/example/reference",
        apiVersion: "2026-03-10",
        validator: '"repo-v1"',
      }),
    ).toEqual({
      status: 304,
      headers: { etag: '"repo-v1"' },
    });
    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expect(call.command).toBe("gh");
      expect(call.args).toContain("--method");
      expect(call.args[call.args.indexOf("--method") + 1]).toBe("GET");
      expect(call.args).toContain("--include");
      expect(call.args).toContain("Accept: application/vnd.github+json");
      expect(call.args).toContain("X-GitHub-Api-Version: 2026-03-10");
      expect(call.args.join(" ")).not.toContain(credentialSentinel);
      expect(call.args).not.toContain("POST");
      expect(call.args).not.toContain("PATCH");
      expect(call.args).not.toContain("PUT");
      expect(call.args).not.toContain("DELETE");
    }
    await expect(
      transport.get({
        endpoint: "repos/example/reference/../../user",
        apiVersion: "2026-03-10",
      }),
    ).rejects.toMatchObject({
      kind: "acquisition",
      message: "GitHub REST endpoint is outside the read-only repository boundary.",
    });
    expect(calls).toHaveLength(2);
    expect(() =>
      encodeGitHubMattNativeScope({
        host: "github.com",
        rootKind: "standalone-request",
        repository: {
          owner: "../other",
          name: "reference",
          databaseId: "9001",
          nodeId: "R_reference",
        },
        root: {
          objectKind: "issue",
          number: 1,
          databaseId: "9101",
          nodeId: "I_reference_1",
        },
      }),
    ).toThrow();

    const authentication = createGhCliGitHubReadTransport({
      execute: async () => ({
        exitCode: 1,
        stdout: "",
        stderr: `authentication failed for token ${credentialSentinel}`,
      }),
    });
    await expect(
      authentication.get({
        endpoint: "repos/example/reference",
        apiVersion: "2026-03-10",
      }),
    ).rejects.toMatchObject({
      kind: "authentication",
      message: "GitHub CLI authentication failed.",
    });
    try {
      await authentication.get({
        endpoint: "repos/example/reference",
        apiVersion: "2026-03-10",
      });
    } catch (error) {
      expect(String(error)).not.toContain(credentialSentinel);
    }
  });
});
