import { describe, expect, test } from "bun:test";
import { lstat, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { documentPresentationBlocksPlainText } from "../src/document-presentation";
import { createGitHubMattProvider } from "../src/providers/matt-skills-v1/github";
import { createLocalMarkdownMattProvider } from "../src/providers/matt-skills-v1/local-markdown";
import type { MattScopeProjection } from "../src/providers/matt-skills-v1/model";
import { mattSkillsV1ProviderObservationSchema } from "../src/providers/matt-skills-v1/schema";
import {
  createGitHubMattRepository,
  githubContractLocator,
  githubTriageLocator,
} from "./fixtures/github-matt-api";
import {
  createMattEquivalenceGitHubTransport,
  expectedMattEquivalenceSemantics,
  githubRequestBudget,
  mattEquivalenceAliases,
  mattEquivalenceGitHubObjectCount,
  mattEquivalenceGitHubScope,
  mattEquivalenceLocalContractLocator,
  mattEquivalenceLocalScope,
  mattEquivalenceTriageLocator,
  writeMattEquivalenceLocalRepository,
} from "./fixtures/matt-equivalence-scenario";
import {
  mattReferenceEquivalenceView,
  mattReferenceRelationPartition,
  mattReferenceSemanticAvailabilityView,
} from "./helpers/matt-reference-oracle";

const expectedSemanticAvailability = {
  map: {
    "map.destination": "available",
    "map.notes": "available",
    "map.decisions": "available",
    "map.fog": "available",
    "map.out-of-scope": "available",
    "map.resolution-evidence": "confirmed-empty",
  },
  spec: {
    "spec.problem": "available",
    "spec.solution": "available",
    "spec.user-stories": "available",
    "spec.implementation": "available",
    "spec.testing": "available",
    "spec.out-of-scope": "available",
    "spec.further-notes": "available",
  },
  research: {
    "wayfinder.question": "available",
    "wayfinder.claim": "available",
    "wayfinder.answer": "available",
    "wayfinder.comments": "available",
  },
  prototype: {
    "wayfinder.question": "available",
    "wayfinder.claim": "available",
    "wayfinder.answer": "confirmed-empty",
    "wayfinder.comments": "confirmed-empty",
  },
  grilling: {
    "wayfinder.question": "available",
    "wayfinder.claim": "available",
    "wayfinder.answer": "confirmed-empty",
    "wayfinder.comments": "confirmed-empty",
  },
  task: {
    "wayfinder.question": "available",
    "wayfinder.claim": "available",
    "wayfinder.answer": "confirmed-empty",
    "wayfinder.comments": "confirmed-empty",
  },
  "delivery-one": {
    "delivery.what-to-build": "available",
    "delivery.acceptance-criteria": "available",
    "delivery.completion-evidence": "confirmed-empty",
    "delivery.comments": "confirmed-empty",
  },
  "incoming-enhancement": {
    "incoming.classification": "available",
    "incoming.content": "available",
    "incoming.routing": "available",
  },
} as const;

const projectionObjects = (
  projection: MattScopeProjection | undefined,
): readonly NonNullable<
  | MattScopeProjection["map"]
  | MattScopeProjection["spec"]
  | MattScopeProjection["wayfinderTickets"][number]
  | MattScopeProjection["deliveryTickets"][number]
  | MattScopeProjection["incomingIssues"][number]
>[] =>
  projection === undefined
    ? []
    : [
        ...(projection.map === undefined ? [] : [projection.map]),
        ...(projection.spec === undefined ? [] : [projection.spec]),
        ...projection.wayfinderTickets,
        ...projection.deliveryTickets,
        ...projection.incomingIssues,
      ];

const snapshotTree = async (
  root: string,
  locator: string,
): Promise<Readonly<Record<string, string>>> => {
  const result: Record<string, string> = {};
  for (const relative of new Bun.Glob("**/*").scanSync({
    cwd: join(root, locator),
    onlyFiles: true,
  })) {
    const target = join(root, locator, relative);
    const metadata = await lstat(target);
    result[relative] = `${metadata.mode}:${(await readFile(target)).toString("base64")}`;
  }
  return result;
};

describe("Matt Local/GitHub semantic equivalence", () => {
  test("derives empty semantic availability through both production adapters", async () => {
    const localRoot = await writeMattEquivalenceLocalRepository();
    const githubRoot = await createGitHubMattRepository();
    try {
      const localQuestion = join(localRoot, mattEquivalenceLocalScope, "issues/03-research.md");
      await Bun.write(
        localQuestion,
        (await readFile(localQuestion, "utf8")).replace(
          "## Question\n\nWhich semantics are durable?",
          "## Question\n\n",
        ),
      );
      const local = await createLocalMarkdownMattProvider({
        repoRoot: localRoot,
        contractLocator: mattEquivalenceLocalContractLocator,
        triageLocator: mattEquivalenceTriageLocator,
        clock: () => new Date("2026-07-28T00:00:00Z"),
      }).capture({ provider: "matt-skills/v1", nativeScope: mattEquivalenceLocalScope });
      const github = await createGitHubMattProvider({
        repoRoot: githubRoot,
        contractLocator: githubContractLocator,
        triageLocator: githubTriageLocator,
        transport: createMattEquivalenceGitHubTransport({
          researchBody: "## Question\n\n",
          deliveryBody: `## What to build

## Acceptance criteria

- [ ] Return independent state, freshness and completion.
- [ ] Keep the capture immutable.
`,
        }),
        clock: () => new Date("2026-07-28T00:00:00Z"),
      }).capture({ provider: "matt-skills/v1", nativeScope: mattEquivalenceGitHubScope });

      expect(mattSkillsV1ProviderObservationSchema.safeParse(local).success).toBe(true);
      expect(mattSkillsV1ProviderObservationSchema.safeParse(github).success).toBe(true);
      if (
        (local.state !== "available" && local.state !== "partial") ||
        (github.state !== "available" && github.state !== "partial")
      ) {
        throw new Error("Expected readable production adapter projections.");
      }
      expect(
        local.projection.wayfinderTickets
          .find((ticket) => ticket.title === "Research the semantic contract")
          ?.semanticSections.find((section) => section.role === "wayfinder.question"),
      ).toEqual({ role: "wayfinder.question", availability: "confirmed-empty" });
      expect(
        github.projection.wayfinderTickets
          .find((ticket) => ticket.title === "Research the semantic contract")
          ?.semanticSections.find((section) => section.role === "wayfinder.question"),
      ).toEqual({ role: "wayfinder.question", availability: "confirmed-empty" });
      expect(
        github.projection.deliveryTickets[0]?.semanticSections.find(
          (section) => section.role === "delivery.what-to-build",
        ),
      ).toEqual({ role: "delivery.what-to-build", availability: "confirmed-empty" });
    } finally {
      await Promise.all([
        rm(localRoot, { recursive: true, force: true }),
        rm(githubRoot, { recursive: true, force: true }),
      ]);
    }
  });

  test("derives unsupported comment semantics from the production GitHub adapter capability", async () => {
    const githubRoot = await createGitHubMattRepository();
    try {
      const github = await createGitHubMattProvider({
        repoRoot: githubRoot,
        contractLocator: githubContractLocator,
        triageLocator: githubTriageLocator,
        transport: createMattEquivalenceGitHubTransport({
          unsupportedCommentsFor: [3],
        }),
        clock: () => new Date("2026-07-28T00:00:00Z"),
      }).capture({ provider: "matt-skills/v1", nativeScope: mattEquivalenceGitHubScope });

      expect(mattSkillsV1ProviderObservationSchema.safeParse(github).success).toBe(true);
      if (github.state !== "available" && github.state !== "partial") {
        throw new Error("Expected a readable GitHub projection with scoped capability loss.");
      }
      const research = github.projection.wayfinderTickets.find(
        (ticket) => ticket.title === "Research the semantic contract",
      );
      expect(research?.answer).toEqual({
        availability: "unavailable",
        reason: "source-contract-gap",
      });
      expect(research?.semanticSections).toEqual(
        expect.arrayContaining([
          { role: "wayfinder.answer", availability: "unsupported" },
          { role: "wayfinder.comments", availability: "unsupported" },
        ]),
      );
    } finally {
      await rm(githubRoot, { recursive: true, force: true });
    }
  });

  test("preserves ordinary Incoming prose as semantic issue content through both production adapters", async () => {
    const localRoot = await writeMattEquivalenceLocalRepository();
    const githubRoot = await createGitHubMattRepository();
    const issueBody = "Customer cannot finish the workflow after choosing the advanced option.";
    try {
      await Bun.write(
        join(localRoot, mattEquivalenceLocalScope, "issues/08-incoming.md"),
        `# Support a custom-mapped enhancement

Category: custom-enhancement

Status: custom-ready

${issueBody}
`,
      );
      const local = await createLocalMarkdownMattProvider({
        repoRoot: localRoot,
        contractLocator: mattEquivalenceLocalContractLocator,
        triageLocator: mattEquivalenceTriageLocator,
        clock: () => new Date("2026-07-28T00:00:00Z"),
      }).capture({ provider: "matt-skills/v1", nativeScope: mattEquivalenceLocalScope });
      const github = await createGitHubMattProvider({
        repoRoot: githubRoot,
        contractLocator: githubContractLocator,
        triageLocator: githubTriageLocator,
        transport: createMattEquivalenceGitHubTransport({ incomingBody: issueBody }),
        clock: () => new Date("2026-07-28T00:00:00Z"),
      }).capture({ provider: "matt-skills/v1", nativeScope: mattEquivalenceGitHubScope });

      expect(mattSkillsV1ProviderObservationSchema.safeParse(local).success).toBe(true);
      expect(mattSkillsV1ProviderObservationSchema.safeParse(github).success).toBe(true);
      if (
        (local.state !== "available" && local.state !== "partial") ||
        (github.state !== "available" && github.state !== "partial")
      ) {
        throw new Error("Expected readable production adapter projections.");
      }
      for (const incoming of [
        local.projection.incomingIssues[0],
        github.projection.incomingIssues[0],
      ]) {
        expect(incoming?.content.map((document) => document.role)).toEqual(["issue-body"]);
        expect(
          incoming?.content.map((document) =>
            documentPresentationBlocksPlainText(document.document.sections[0]?.blocks ?? []),
          ),
        ).toEqual([issueBody]);
        expect(
          incoming?.semanticSections.find((section) => section.role === "incoming.content"),
        ).toEqual({ role: "incoming.content", availability: "available" });
      }
    } finally {
      await Promise.all([
        rm(localRoot, { recursive: true, force: true }),
        rm(githubRoot, { recursive: true, force: true }),
      ]);
    }
  });

  test("projects one reference scenario through both production adapters and a test-owned oracle", async () => {
    const localRoot = await writeMattEquivalenceLocalRepository();
    const githubRoot = await createGitHubMattRepository();
    try {
      const localBefore = await snapshotTree(localRoot, mattEquivalenceLocalScope);
      const localEvents: string[] = [];
      const local = await createLocalMarkdownMattProvider({
        repoRoot: localRoot,
        contractLocator: mattEquivalenceLocalContractLocator,
        triageLocator: mattEquivalenceTriageLocator,
        clock: () => new Date("2026-07-28T00:00:00Z"),
        onCaptureEvent: (event) => {
          if (event.kind === "content-read") localEvents.push(event.locator);
        },
      }).capture({ provider: "matt-skills/v1", nativeScope: mattEquivalenceLocalScope });

      const githubBefore = await Promise.all(
        [githubContractLocator, githubTriageLocator].map((locator) =>
          readFile(join(githubRoot, locator), "utf8"),
        ),
      );
      const transport = createMattEquivalenceGitHubTransport();
      const github = await createGitHubMattProvider({
        repoRoot: githubRoot,
        contractLocator: githubContractLocator,
        triageLocator: githubTriageLocator,
        transport,
        clock: () => new Date("2026-07-28T00:00:00Z"),
      }).capture({ provider: "matt-skills/v1", nativeScope: mattEquivalenceGitHubScope });

      expect(local).not.toEqual(github);
      const localAliases = mattEquivalenceAliases("local");
      const githubAliases = mattEquivalenceAliases("github");
      const localView = mattReferenceEquivalenceView(local, localAliases);
      const githubView = mattReferenceEquivalenceView(github, githubAliases);
      expect(localView).toEqual(expectedMattEquivalenceSemantics);
      expect(githubView).toEqual(expectedMattEquivalenceSemantics);
      expect(localView).toEqual(githubView);
      expect(mattReferenceSemanticAvailabilityView(local, localAliases)).toEqual(
        expectedSemanticAvailability,
      );
      expect(mattReferenceSemanticAvailabilityView(github, githubAliases)).toEqual(
        expectedSemanticAvailability,
      );
      if (
        (local.state !== "available" && local.state !== "partial") ||
        (github.state !== "available" && github.state !== "partial") ||
        local.projection.spec === undefined ||
        github.projection.spec === undefined
      ) {
        throw new TypeError("Expected equivalent Local and GitHub Spec documents.");
      }
      expect(local.projection.spec.document).toEqual(github.projection.spec.document);
      expect(
        local.projection.spec.document.sections.find(
          (section) => section.sourceIdentity === "spec.source.compatibility-notes",
        ),
      ).toEqual({
        sourceIdentity: "spec.source.compatibility-notes",
        title: "Compatibility Notes",
        sourceOrder: 2,
        availability: "available",
        blocks: [
          {
            kind: "paragraph",
            inlines: [
              {
                kind: "text",
                value:
                  "An additive source section stays readable without provider-specific Portal code.",
              },
            ],
          },
        ],
      });

      const localRelations = mattReferenceRelationPartition(local, localAliases);
      const githubRelations = mattReferenceRelationPartition(github, githubAliases);
      expect(localRelations.workflow).toEqual(expectedMattEquivalenceSemantics.parentChild);
      expect(githubRelations.workflow).toEqual(expectedMattEquivalenceSemantics.parentChild);
      expect(localRelations.nativeAcquisition).toEqual([]);
      expect(githubRelations.nativeAcquisition).toEqual([
        { relation: "map>spec", evidence: "github-native" },
        { relation: "map>incoming-enhancement", evidence: "github-native" },
      ]);
      if (local.state !== "available" && local.state !== "partial") {
        throw new TypeError("Expected an available Local reference projection.");
      }
      if (local.projection.map === undefined || local.projection.spec === undefined) {
        throw new TypeError("Expected the complete Local reference projection.");
      }
      const unpartitionedRelationCapture = {
        ...local,
        projection: {
          ...local.projection,
          graph: {
            ...local.projection.graph,
            parentChild: [
              ...local.projection.graph.parentChild,
              {
                parent: local.projection.map.ref,
                child: local.projection.spec.ref,
                evidence: "matt-contract" as const,
              },
            ],
          },
        },
      };
      expect(() =>
        mattReferenceRelationPartition(unpartitionedRelationCapture, localAliases),
      ).toThrow(TypeError);

      expect(await snapshotTree(localRoot, mattEquivalenceLocalScope)).toEqual(localBefore);
      expect(new Set(localEvents).size).toBe(localEvents.length);
      expect(
        local.freshness.evidence.find((item) => item.kind === "content-read-count")?.value,
      ).toBe(String(localEvents.length));
      expect(
        await Promise.all(
          [githubContractLocator, githubTriageLocator].map((locator) =>
            readFile(join(githubRoot, locator), "utf8"),
          ),
        ),
      ).toEqual(githubBefore);

      const budget = githubRequestBudget(transport.requests);
      expect(budget.uniqueEndpointCount).toBeLessThanOrEqual(
        1 + mattEquivalenceGitHubObjectCount * 5,
      );
      expect(budget.maximumRequestsForOneEndpoint).toBeLessThanOrEqual(2);
      expect(transport.requests.length).toBeLessThanOrEqual(budget.linearUpperBound);
      expect(transport.requests.some((request) => /[?&]page=[2-9]/u.test(request.endpoint))).toBe(
        false,
      );
    } finally {
      await Promise.all([
        rm(localRoot, { recursive: true, force: true }),
        rm(githubRoot, { recursive: true, force: true }),
      ]);
    }
  });

  test("preserves provider-native identity and evidence without requiring serialized equality", async () => {
    const localRoot = await writeMattEquivalenceLocalRepository();
    const githubRoot = await createGitHubMattRepository();
    try {
      const local = await createLocalMarkdownMattProvider({
        repoRoot: localRoot,
        contractLocator: mattEquivalenceLocalContractLocator,
        triageLocator: mattEquivalenceTriageLocator,
        clock: () => new Date("2026-07-28T00:00:00Z"),
      }).capture({ provider: "matt-skills/v1", nativeScope: mattEquivalenceLocalScope });
      const transport = createMattEquivalenceGitHubTransport();
      const github = await createGitHubMattProvider({
        repoRoot: githubRoot,
        contractLocator: githubContractLocator,
        triageLocator: githubTriageLocator,
        transport,
        clock: () => new Date("2026-07-28T00:00:00Z"),
      }).capture({ provider: "matt-skills/v1", nativeScope: mattEquivalenceGitHubScope });

      const localObjects = projectionObjects(local.projection);
      const githubObjects = projectionObjects(github.projection);
      expect(localObjects).toHaveLength(mattEquivalenceGitHubObjectCount);
      expect(githubObjects).toHaveLength(mattEquivalenceGitHubObjectCount);
      expect(localObjects.every((object) => object.native.kind === "local")).toBe(true);
      expect(githubObjects.every((object) => object.native.kind === "github")).toBe(true);

      const localLocators = localObjects.map((object) =>
        object.native.kind === "local" ? object.native.identity.locator : "",
      );
      expect(new Set(localLocators).size).toBe(localLocators.length);
      for (const object of localObjects) {
        expect(object.native.rawFacets.map((facet) => facet.key)).toEqual(
          expect.arrayContaining(["mode", "size"]),
        );
        expect(object.native.rawFacets.map((facet) => facet.key)).not.toContain("markdown");
      }

      const githubUrls = githubObjects.map((object) =>
        object.native.kind === "github" ? object.native.identity.url : "",
      );
      expect(new Set(githubUrls).size).toBe(githubUrls.length);
      for (const object of githubObjects) {
        if (object.native.kind !== "github") throw new TypeError("Expected GitHub evidence.");
        expect(object.native.identity).toMatchObject({
          repositoryDatabaseId: "9001",
          repositoryNodeId: "R_reference",
          owner: "example",
          repository: "reference",
        });
        expect(object.native.rawFacets.map((facet) => facet.key)).toEqual(
          expect.arrayContaining(["labels", "assignees", "state", "timestamps"]),
        );
        expect(object.native.rawFacets.map((facet) => facet.key)).not.toContain("body");
      }

      expect(github.projection?.wayfinderTickets[3]?.native.rawFacets).toContainEqual({
        key: "assignees",
        values: ["lago|100|U_lago"],
      });
      expect(github.projection?.wayfinderTickets[0]?.native.rawFacets).toContainEqual(
        expect.objectContaining({
          key: "comments",
          values: expect.arrayContaining([
            expect.stringContaining("301|"),
            expect.stringContaining("302|"),
          ]),
        }),
      );
      expect(github.freshness.evidence).toEqual(
        expect.arrayContaining([
          { kind: "conditional-revalidation", value: "stable" },
          expect.objectContaining({
            kind: "endpoint-validator",
            value: expect.stringContaining('"issue-3-equivalence-v1"'),
          }),
        ]),
      );
      expect(JSON.stringify(local)).not.toBe(JSON.stringify(github));
    } finally {
      await Promise.all([
        rm(localRoot, { recursive: true, force: true }),
        rm(githubRoot, { recursive: true, force: true }),
      ]);
    }
  });
});
