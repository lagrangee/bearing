import { expect, test } from "bun:test";
import { readFile, rm } from "node:fs/promises";
import { withBearingManagedPointer } from "../src/agent-surface-entry";
import { createProjectMaterializer } from "../src/portal/project-materializer";
import { buildProjectSnapshot } from "../src/project-snapshot/projection";
import type { MattProviderFactory } from "../src/provider-observation-acquisition";
import type { MattSkillsV1ProviderObservation } from "../src/providers/matt-skills-v1/capture";
import {
  GitHubReadError,
  type GitHubReadRequest,
  type GitHubReadTransport,
} from "../src/providers/matt-skills-v1/github";
import { prepareSync } from "../src/sync-plan";
import {
  createReferenceGitHubFixtures,
  FixtureGitHubTransport,
  githubComment,
  githubContractLocator,
  githubFixtureResponse,
  githubIssue,
  githubMattProviderFactoryFor,
  githubResearchIssue,
  githubScopedIncomingIssue,
  githubSpecIssue,
  githubTriageLocator,
  standardGitHubMattAgentSurface,
  writeStandardGitHubMattProductRepository,
} from "./fixtures/github-matt-api";
import { buildSnapshotForSyncPlan, captureConsoleLogs, makeTemporaryDirectory } from "./helpers";

const PACKAGE_VERSION = "0.1.1-test";
const CREDENTIAL_SENTINEL = "fixture-credential-must-never-enter-bearing";

const instrumentedProviderFactory = (
  transport: GitHubReadTransport,
): Readonly<{
  providerFactory: MattProviderFactory;
  captureCalls: () => number;
  captures: () => readonly MattSkillsV1ProviderObservation[];
}> => {
  let captureCalls = 0;
  const captures: MattSkillsV1ProviderObservation[] = [];
  const createProvider = githubMattProviderFactoryFor(transport);
  const providerFactory: MattProviderFactory = (input) => {
    expect(input.driver).toBe("github-issues");
    const provider = createProvider(input);
    return {
      id: provider.id,
      capture: async (binding) => {
        captureCalls += 1;
        const observation = await provider.capture(binding);
        captures.push(observation);
        return observation;
      },
    };
  };
  return { providerFactory, captureCalls: () => captureCalls, captures: () => captures };
};

const prepareStandardGitHubRepository = async (): Promise<
  Readonly<{ root: string; nativeScope: string }>
> => {
  const root = await makeTemporaryDirectory("bearing-packaged-github-");
  const prepared = await writeStandardGitHubMattProductRepository(root, {
    title: "GitHub Matt delivery",
    intent: "Exercise one deterministic GitHub provider capture through every product surface.",
    work: "- [Reference Map](https://github.com/example/reference/issues/1)",
  });
  expect(prepared.setup.outcome).toBe("applied");
  expect(await readFile(`${root}/${githubContractLocator}`)).toEqual(prepared.contractBefore);
  expect(await readFile(`${root}/${githubTriageLocator}`)).toEqual(prepared.triageBefore);
  const agentSurfaceAfter = await readFile(`${root}/AGENTS.md`, "utf8");
  expect(agentSurfaceAfter).toBe(withBearingManagedPointer(prepared.agentSurfaceBefore));
  expect(agentSurfaceAfter).toContain(standardGitHubMattAgentSurface.trimEnd());
  expect(agentSurfaceAfter).not.toContain("Work-management contract:");
  expect(agentSurfaceAfter).not.toContain("Provider contract:");
  expect(JSON.parse(await readFile(`${root}/.bearing/provider.json`, "utf8"))).toEqual({
    schemaVersion: 1,
    provider: "matt-skills/v1",
    contractLocator: githubContractLocator,
  });
  return { root, nativeScope: prepared.nativeScope };
};

test("standard GitHub Setup feeds one immutable provider capture through every product surface", async () => {
  const { root, nativeScope } = await prepareStandardGitHubRepository();
  try {
    const crossRepositoryChild = {
      ...githubIssue({
        number: 20,
        title: "External child",
        body: "External relation endpoint.",
      }),
      id: 20_020,
      node_id: "I_other_20",
      html_url: "https://github.com/other/repository/issues/20",
      repository_url: "https://api.github.com/repos/other/repository",
    };
    const unrelatedSameLabel = githubIssue({
      number: 98,
      title: "Unrelated same-label issue",
      labels: ["custom-ready", "same-project"],
      body: "Not a native child.",
    });
    const sourceIntakeIssue = githubIssue({
      number: 99,
      title: "Source intake issue",
      labels: ["custom-enhancement", "custom-ready"],
      body: "Links to the Map but is not a native child.",
    });
    const fixtures = createReferenceGitHubFixtures();
    fixtures["repos/example/reference/issues/1/sub_issues?per_page=100&page=1"] = {
      first: githubFixtureResponse(
        [githubResearchIssue, githubSpecIssue, githubScopedIncomingIssue, crossRepositoryChild],
        '"children-1-v1"',
      ),
    };
    fixtures["repos/example/reference/issues/98"] = {
      first: githubFixtureResponse(unrelatedSameLabel, '"issue-98-v1"'),
    };
    fixtures["repos/example/reference/issues/99"] = {
      first: githubFixtureResponse(sourceIntakeIssue, '"issue-99-v1"'),
    };
    const transport = new FixtureGitHubTransport(fixtures);
    const instrumented = instrumentedProviderFactory(transport);

    const plan = await prepareSync(root, {
      providerObservationIntent: "full-verification",
      providerFactory: instrumented.providerFactory,
    });
    expect(instrumented.captureCalls()).toBe(1);
    expect(plan.metrics.providerAcquisitionCount).toBe(1);
    expect(plan.diagnostics).toEqual([]);
    expect(plan.inputs).toEqual(
      expect.arrayContaining([
        ".bearing/provider.json",
        ".bearing/state/efforts/test.md",
        githubContractLocator,
        githubTriageLocator,
      ]),
    );
    const capture = plan.providerObservations[0];
    expect(capture?.id).toMatch(/^provider-observation:sha256:[a-f0-9]{64}$/);
    expect(capture).toMatchObject({
      state: "available",
      freshness: { assessment: "current" },
      coverage: { assessment: "complete" },
      completion: "incomplete",
      binding: { provider: "matt-skills/v1", nativeScope },
      projection: {
        map: {
          title: "Reference Map",
          lifecycle: { state: "active" },
        },
        spec: {
          title: "Reference Spec",
          lifecycle: { state: "ready-for-agent" },
        },
        wayfinderTickets: [
          {
            title: "Research the semantic contract",
            subtype: "research",
            claim: { state: "claimed", claimant: "lago" },
            lifecycle: { state: "resolved-on-route" },
            trackerClosure: { state: "closed", disposition: "completed" },
            answer: {
              availability: "available",
              content: {
                body: "Preserve workflow-specific lifecycle and evidence.",
                nativeIdentity: "IC_301",
              },
            },
          },
        ],
        deliveryTickets: [
          {
            title: "Implement provider capture",
            lifecycle: { state: "open" },
            trackerClosure: { state: "open" },
          },
        ],
        incomingIssues: [
          {
            title: "Support a custom-mapped enhancement",
            classification: {
              category: "enhancement",
              state: "ready-for-agent",
              nativeCategory: "custom-enhancement",
              nativeState: "custom-ready",
            },
          },
        ],
        graph: {
          blockedBy: [
            {
              blocked: "github:R_reference:I_reference_4",
              blocker: "github:R_reference:I_reference_3",
              evidence: "github-native",
            },
          ],
        },
      },
    });
    expect(Object.isFrozen(capture)).toBe(true);
    expect(capture?.projection?.deliveryTickets[0]?.acceptanceCriteria).toEqual([
      "Return independent state, freshness and completion.",
      "Keep the capture immutable.",
    ]);
    expect(capture?.projection?.wayfinderTickets[0]?.comments).toEqual([
      expect.objectContaining({
        role: "ordinary-comment",
        nativeIdentity: "IC_302",
        author: "reviewer",
      }),
    ]);
    expect(capture?.projection?.wayfinderTickets[0]?.native).toMatchObject({
      kind: "github",
      identity: {
        repositoryDatabaseId: "9001",
        repositoryNodeId: "R_reference",
        objectDatabaseId: "9103",
        objectNodeId: "I_reference_3",
        number: 3,
        url: "https://github.com/example/reference/issues/3",
      },
    });
    expect(capture?.projection?.wayfinderTickets[0]?.native.rawFacets).toEqual(
      expect.arrayContaining([
        { key: "assignees", values: ["lago|100|U_lago"] },
        {
          key: "timestamps",
          values: ["2026-07-01T00:00:00Z", "2026-07-03T00:00:00Z", "2026-07-20T00:00:00Z"],
        },
        { key: "closed-by", values: ["closer|92|U_closer"] },
      ]),
    );
    expect(capture?.projection?.map?.native.rawFacets).toContainEqual({
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
    expect(capture?.freshness.evidence).toEqual(
      expect.arrayContaining([
        { kind: "conditional-revalidation", value: "stable" },
        expect.objectContaining({
          kind: "endpoint-validator",
          value: expect.stringContaining('"issue-3-v1"'),
        }),
      ]),
    );
    expect(
      transport.requests.some(
        (request) =>
          request.endpoint.includes("other/repository") ||
          request.endpoint.endsWith("/issues/98") ||
          request.endpoint.endsWith("/issues/99") ||
          request.endpoint.endsWith("/issues"),
      ),
    ).toBe(false);

    const requestCountAfterSync = transport.requests.length;
    const inspect = plan.planningGraph.contextFor({ kind: "effort", id: "effort:test" });
    expect(inspect.state).toBe("complete");
    if (inspect.state === "invalid") throw new Error("Expected typed Effort Inspect context.");
    expect(inspect.context.providerCapture).toBe(capture);
    expect(inspect.context.effort.value.lifecycle).toBe("active");
    expect(plan.planningGraph.contextFor({ kind: "gate", id: "gate:test" })).toMatchObject({
      state: "complete",
      context: { gate: { value: { readiness: "not-ready" } } },
    });
    expect(plan.sitemap.toString("utf8")).toContain("github/example/reference/issues/4");

    const snapshot = await buildSnapshotForSyncPlan(root, PACKAGE_VERSION, plan);
    expect(snapshot.providerObservations[0]).toEqual(capture);
    expect(snapshot.providerObservationSelections[0]?.observationId).toBe(capture?.id);
    let portalSawGenerationCapture = false;
    const materializer = createProjectMaterializer({
      packageVersion: PACKAGE_VERSION,
      dependencies: {
        prepare: async () => plan,
        buildSnapshot: async (input) => {
          portalSawGenerationCapture = input.providerObservations === plan.providerObservations;
          return buildProjectSnapshot(input);
        },
      },
    });
    const portal = await materializer.run(root, "ensure-current");
    expect(portalSawGenerationCapture).toBe(true);
    expect(portal.snapshot.providerObservations[0]).toEqual(capture);
    expect(transport.requests).toHaveLength(requestCountAfterSync);

    const serializedProductState = [
      await readFile(`${root}/.bearing/provider.json`, "utf8"),
      plan.report.toString("utf8"),
      plan.sitemap.toString("utf8"),
      JSON.stringify(snapshot),
      JSON.stringify(portal.snapshot),
    ].join("\n");
    expect(serializedProductState).not.toMatch(/(?:gho_|github_pat_)/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

type DegradationScenario = Readonly<{
  name: string;
  createTransport: () => GitHubReadTransport;
  expectedState: "invalid" | "partial";
  expectedDiagnosticCodes: readonly string[];
  expectedFirstEndpoint?: string;
  expectedFreshnessEvidence?: Readonly<{ kind: string; value: string }>;
}>;

const degradationScenarios: readonly DegradationScenario[] = [
  {
    name: "network failure",
    createTransport: () => ({
      get: async () => {
        throw new GitHubReadError("network", CREDENTIAL_SENTINEL);
      },
    }),
    expectedState: "invalid",
    expectedDiagnosticCodes: ["matt.github.acquisition.network"],
    expectedFirstEndpoint: "repos/example/reference",
  },
  {
    name: "authentication failure",
    createTransport: () =>
      new FixtureGitHubTransport({
        "repos/example/reference": {
          first: {
            status: 401,
            headers: {},
            body: { message: `Requires authentication ${CREDENTIAL_SENTINEL}` },
          },
        },
      }),
    expectedState: "invalid",
    expectedDiagnosticCodes: ["matt.github.acquisition.authentication"],
    expectedFirstEndpoint: "repos/example/reference",
  },
  {
    name: "permission failure",
    createTransport: () => {
      const fixtures = createReferenceGitHubFixtures();
      fixtures["repos/example/reference/issues/1/sub_issues?per_page=100&page=1"] = {
        first: {
          status: 403,
          headers: {},
          body: { message: `Resource not accessible ${CREDENTIAL_SENTINEL}` },
        },
      };
      return new FixtureGitHubTransport(fixtures);
    },
    expectedState: "partial",
    expectedDiagnosticCodes: ["matt.github.acquisition.permission", "matt.github.scope.pagination"],
  },
  {
    name: "pagination failure",
    createTransport: () => {
      const fixtures = createReferenceGitHubFixtures();
      fixtures["repos/example/reference/issues/1/comments?per_page=100&page=1"] = {
        first: githubFixtureResponse(
          Array.from({ length: 100 }, (_, index) =>
            githubComment({
              id: 10_000 + index,
              issue: 1,
              body: `Page-one comment ${index + 1}`,
            }),
          ),
          '"comments-1-page-1"',
        ),
      };
      fixtures["repos/example/reference/issues/1/comments?per_page=100&page=2"] = {
        first: {
          status: 500,
          headers: {},
          body: { message: `Temporary upstream failure ${CREDENTIAL_SENTINEL}` },
        },
      };
      return new FixtureGitHubTransport(fixtures);
    },
    expectedState: "partial",
    expectedDiagnosticCodes: [
      "matt.github.acquisition.failed",
      "matt.github.pagination.incomplete",
    ],
  },
  {
    name: "freshness revalidation failure",
    createTransport: () => {
      const source = new FixtureGitHubTransport(createReferenceGitHubFixtures());
      return {
        get: async (request) => {
          if (request.validator !== undefined) {
            throw new GitHubReadError("network", CREDENTIAL_SENTINEL);
          }
          return source.get(request);
        },
      };
    },
    expectedState: "partial",
    expectedDiagnosticCodes: ["matt.github.acquisition.network"],
    expectedFreshnessEvidence: {
      kind: "conditional-revalidation",
      value: "failed",
    },
  },
];

for (const scenario of degradationScenarios) {
  test(`GitHub ${scenario.name} remains provider-scoped through Inspect and Portal`, async () => {
    const { root } = await prepareStandardGitHubRepository();
    try {
      const requests: GitHubReadRequest[] = [];
      const source = scenario.createTransport();
      const transport: GitHubReadTransport = {
        get: async (request) => {
          requests.push(request);
          return source.get(request);
        },
      };
      const instrumented = instrumentedProviderFactory(transport);

      const preparation = await captureConsoleLogs(() =>
        prepareSync(root, {
          providerObservationIntent: "full-verification",
          providerFactory: instrumented.providerFactory,
        }),
      );
      const plan = preparation.result;
      expect(instrumented.captureCalls()).toBe(1);
      if (scenario.expectedFirstEndpoint !== undefined) {
        expect(requests[0]?.endpoint).toBe(scenario.expectedFirstEndpoint);
      }
      const capture = instrumented.captures()[0];
      expect(capture).toMatchObject({
        state: scenario.expectedState,
        freshness: { assessment: "undetermined" },
        coverage: { assessment: "incomplete" },
      });
      expect(capture?.completion).not.toBe("complete");
      expect(capture?.id).toMatch(/^provider-observation:sha256:[a-f0-9]{64}$/);
      expect(capture?.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
        expect.arrayContaining(scenario.expectedDiagnosticCodes),
      );
      expect(plan.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
        expect.arrayContaining(scenario.expectedDiagnosticCodes),
      );
      expect(plan.providerObservations).toEqual([]);
      const selection = plan.providerObservationSelections[0];
      expect(selection).toMatchObject({
        observationId: null,
        effectiveFreshness: "undetermined",
        latestAttempt: {
          outcome: "failed",
        },
      });
      expect(selection?.latestAttempt?.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
        expect.arrayContaining(scenario.expectedDiagnosticCodes),
      );
      if (scenario.expectedFreshnessEvidence !== undefined) {
        expect(capture?.freshness.evidence).toContainEqual(scenario.expectedFreshnessEvidence);
      }

      const inspect = plan.planningGraph.contextFor({ kind: "effort", id: "effort:test" });
      expect(inspect.state).toBe("partial");
      if (inspect.state === "invalid") throw new Error("Expected typed Effort Inspect context.");
      expect(inspect.context.providerCapture).toBeUndefined();
      expect(inspect.context.effort.value.lifecycle).toBe("active");
      const gateInspect = plan.planningGraph.contextFor({ kind: "gate", id: "gate:test" });
      expect(gateInspect.state).toBe("partial");
      if (gateInspect.state === "invalid") throw new Error("Expected typed Gate Inspect context.");
      expect(gateInspect.context.gate.value.readiness).toBe("unknown");
      for (const code of scenario.expectedDiagnosticCodes) {
        expect(plan.report.toString("utf8")).toContain(code);
      }
      expect(plan.sitemap.toString("utf8")).toMatch(/[1-9][0-9]* blocking diagnostic\(s\)/u);

      const snapshot = await buildSnapshotForSyncPlan(root, PACKAGE_VERSION, plan);
      expect(snapshot.providerObservations).toEqual([]);
      const requestCountAfterSync = requests.length;
      const materialization = await captureConsoleLogs(() =>
        createProjectMaterializer({
          packageVersion: PACKAGE_VERSION,
          dependencies: {
            prepare: async () => plan,
            buildSnapshot: buildProjectSnapshot,
          },
        }).run(root, "ensure-current"),
      );
      const portal = materialization.result;
      expect(portal.snapshot.providerObservations).toEqual([]);
      expect(requests).toHaveLength(requestCountAfterSync);

      const persistedPaths = [
        ...new Bun.Glob("**/*").scanSync({
          cwd: `${root}/.bearing`,
          onlyFiles: true,
        }),
      ];
      const persistedState = await Promise.all(
        persistedPaths.map((path) => readFile(`${root}/.bearing/${path}`, "utf8")),
      );
      const serializedProductState = [
        ...persistedState,
        plan.report.toString("utf8"),
        plan.sitemap.toString("utf8"),
        JSON.stringify(capture),
        JSON.stringify(plan.diagnostics),
        JSON.stringify(snapshot),
        JSON.stringify(portal.snapshot),
        ...preparation.logs,
        ...materialization.logs,
      ].join("\n");
      expect(serializedProductState).not.toContain(CREDENTIAL_SENTINEL);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}
