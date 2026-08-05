import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

type OrientationFixture = Readonly<{
  provider: "local-markdown" | "github";
  state: Readonly<{
    repositoryBytes: string;
    nativeWorkBytes: string;
    canonicalPlanningBytes: string;
    projectBrief: null;
  }>;
  primaryReads: readonly string[];
  scopes: readonly Readonly<{
    id: string;
    lifecycle: "active" | "concluded";
    subjects: readonly Readonly<{
      id: string;
      state: "open" | "blocked" | "resolved";
      baselineRequired?: boolean;
    }>[];
  }>[];
  evidence: readonly Readonly<{
    class: "repository-fact" | "native-work-fact" | "agent-inference" | "unresolved-question";
    availability: "available" | "partial" | "conflicting" | "inference" | "unresolved";
  }>[];
  expectedExpandedSubjects: readonly string[];
  expectedOutput: Readonly<{
    completedBaseline: readonly string[];
    projectSummaryDraft: string;
    futureRoadmaps: readonly Readonly<{
      horizon: string;
      candidateGates: readonly string[];
    }>[];
    historicalPlanningCreated: readonly string[];
    conflictsPromotedToFacts: readonly string[];
  }>;
}>;

const loadFixture = async (
  name: string,
): Promise<Readonly<{ source: string; value: OrientationFixture }>> => {
  const source = await readFile(`tests/fixtures/project-orientation/${name}.json`, "utf8");
  return { source, value: JSON.parse(source) as OrientationFixture };
};

const selectProgressiveSubjects = (fixture: OrientationFixture): string[] =>
  fixture.scopes.flatMap((scope) =>
    scope.subjects
      .filter((subject) =>
        scope.lifecycle === "active"
          ? subject.state === "open" || subject.state === "blocked"
          : subject.baselineRequired === true,
      )
      .map((subject) => `${scope.id}/${subject.id}`),
  );

describe("Project Orientation provider fixtures", () => {
  for (const name of ["local-markdown", "github"] as const) {
    test(`${name} preserves progressive selection, evidence states, and source bytes`, async () => {
      const before = await loadFixture(name);
      const beforeState = JSON.stringify(before.value.state);
      const transientInventory = before.value.scopes.map((scope) => ({
        ...scope,
        subjects: [...scope.subjects],
      }));

      expect(before.value.provider).toBe(name);
      expect(before.value.primaryReads).toEqual([
        "project-summary",
        "project-sitemap",
        "canonical-planning",
        "primary-docs",
        "manifests",
        "source-test-topology",
      ]);
      expect(selectProgressiveSubjects({ ...before.value, scopes: transientInventory })).toEqual([
        ...before.value.expectedExpandedSubjects,
      ]);
      expect(before.value.evidence).toEqual(
        expect.arrayContaining([
          { class: "repository-fact", availability: "available" },
          { class: "agent-inference", availability: "inference" },
          { class: "unresolved-question", availability: "unresolved" },
        ]),
      );
      expect(
        before.value.evidence.find((entry) => entry.class === "native-work-fact")?.availability,
      ).toBe(name === "github" ? "conflicting" : "partial");
      expect(before.value.expectedOutput.completedBaseline).toEqual(
        before.value.scopes.flatMap((scope) =>
          scope.subjects
            .filter((subject) => subject.baselineRequired === true)
            .map((subject) => `${scope.id}/${subject.id}`),
        ),
      );
      expect(before.value.expectedOutput.projectSummaryDraft.length).toBeGreaterThan(0);
      for (const roadmap of before.value.expectedOutput.futureRoadmaps) {
        expect(roadmap.horizon.length).toBeGreaterThan(0);
        expect(roadmap.candidateGates.length).toBeGreaterThan(0);
      }
      expect(before.value.expectedOutput.historicalPlanningCreated).toEqual([]);
      expect(before.value.expectedOutput.conflictsPromotedToFacts).toEqual([]);
      transientInventory.splice(0, transientInventory.length);
      expect(transientInventory).toEqual([]);
      expect(JSON.stringify(before.value.state)).toBe(beforeState);
      expect(before.value.state.projectBrief).toBeNull();

      const after = await loadFixture(name);
      expect(after.source).toBe(before.source);
      expect(after.value.state).toEqual(before.value.state);
    });
  }
});
