import { describe, expect, test } from "bun:test";
import { lstat, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { createGitHubMattProvider } from "../src/providers/matt-skills-v1/github";
import { createLocalMarkdownMattProvider } from "../src/providers/matt-skills-v1/local-markdown";
import type { MattScopeProjection } from "../src/providers/matt-skills-v1/model";
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
  mattEquivalenceGeneration,
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
} from "./helpers/matt-reference-oracle";

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
      }).capture(
        { provider: "matt-skills/v1", nativeScope: mattEquivalenceLocalScope },
        mattEquivalenceGeneration,
      );

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
      }).capture(
        { provider: "matt-skills/v1", nativeScope: mattEquivalenceGitHubScope },
        mattEquivalenceGeneration,
      );

      expect(local).not.toEqual(github);
      const localAliases = mattEquivalenceAliases("local");
      const githubAliases = mattEquivalenceAliases("github");
      const localView = mattReferenceEquivalenceView(local, localAliases);
      const githubView = mattReferenceEquivalenceView(github, githubAliases);
      expect(localView).toEqual(expectedMattEquivalenceSemantics);
      expect(githubView).toEqual(expectedMattEquivalenceSemantics);
      expect(localView).toEqual(githubView);

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
      }).capture(
        { provider: "matt-skills/v1", nativeScope: mattEquivalenceLocalScope },
        mattEquivalenceGeneration,
      );
      const transport = createMattEquivalenceGitHubTransport();
      const github = await createGitHubMattProvider({
        repoRoot: githubRoot,
        contractLocator: githubContractLocator,
        triageLocator: githubTriageLocator,
        transport,
        clock: () => new Date("2026-07-28T00:00:00Z"),
      }).capture(
        { provider: "matt-skills/v1", nativeScope: mattEquivalenceGitHubScope },
        mattEquivalenceGeneration,
      );

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
          expect.arrayContaining(["mode", "size", "markdown"]),
        );
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
          expect.arrayContaining(["body", "labels", "assignees", "state", "timestamps"]),
        );
      }

      expect(github.projection?.wayfinderTickets[1]?.native.rawFacets).toContainEqual({
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
