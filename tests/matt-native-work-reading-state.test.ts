import { expect, test } from "bun:test";
import { encodeGitHubMattNativeScope } from "../src/providers/matt-skills-v1/github-native-scope";
import type { MattObservationView } from "../src/providers/matt-skills-v1/projection";
import {
  buildMattNativeWorkReadingState,
  type MattNativeWorkReadingContext,
  mattNativeWorkReadingContextForEffort,
  mattNativeWorkReadingContextForScope,
  NATIVE_WORK_READING_CONCLUSIONS,
} from "../src/providers/matt-skills-v1/reading-state";
import { createProjectOverviewFixture } from "./fixtures/project-overview";

const fixture = () => {
  const snapshot = createProjectOverviewFixture();
  const observation = snapshot.providerObservations.find(
    (candidate) => candidate.binding.nativeScope === ".scratch/portal",
  );
  if (observation === undefined) throw new Error("Expected the Portal provider observation.");
  return {
    observation,
    selections: snapshot.providerObservationSelections,
  };
};

const build = (
  context: MattNativeWorkReadingContext,
  mutate: (observation: MattObservationView) => MattObservationView = (observation) => observation,
) => {
  const { observation, selections } = fixture();
  const candidate = mutate(observation);
  const matchingSelections = selections.map((selection) =>
    selection.nativeScope === candidate.binding.nativeScope
      ? {
          ...selection,
          observationId: candidate.id,
          effectiveFreshness: candidate.freshness.assessment,
        }
      : selection,
  );
  return buildMattNativeWorkReadingState(candidate, matchingSelections, context);
};

test("locks the human vocabulary and derives completion only from trustworthy bound evidence", () => {
  expect(NATIVE_WORK_READING_CONCLUSIONS).toEqual([
    "Complete",
    "Open work remains",
    "Can't verify",
    "Binding needs attention",
  ]);

  const complete = build({ state: "bound", effortIds: ["effort:portal"] }, (observation) => ({
    ...observation,
    completion: "complete",
  }));
  const open = build({ state: "bound", effortIds: ["effort:portal"] });

  expect(complete).toMatchObject({
    conclusion: "Complete",
    why: {
      projectionState: "available",
      freshness: "current",
      coverage: "complete",
      completion: "complete",
      blockingDiagnosticCount: 0,
      causes: [],
    },
  });
  expect(open).toMatchObject({
    conclusion: "Open work remains",
    why: {
      projectionState: "available",
      freshness: "current",
      coverage: "complete",
      completion: "incomplete",
      blockingDiagnosticCount: 0,
      causes: [],
    },
  });
  expect(JSON.stringify([complete, open])).not.toContain("Needs refresh");
});

test("turns every untrustworthy evidence axis into Can't verify with concrete causes", () => {
  const bound = { state: "bound", effortIds: ["effort:portal"] } as const;
  const cases = [
    [
      "stale",
      build(bound, (observation) => ({
        ...observation,
        freshness: { ...observation.freshness, assessment: "stale" },
      })),
      "Freshness is stale.",
    ],
    [
      "partial",
      build(bound, (observation) => ({ ...observation, state: "partial" }) as MattObservationView),
      "Projection state is partial.",
    ],
    [
      "invalid",
      build(bound, (observation) => {
        const { projection: _projection, ...base } = observation as Extract<
          MattObservationView,
          { state: "available" | "partial" }
        >;
        return {
          ...base,
          state: "invalid",
          freshness: { ...base.freshness, assessment: "undetermined" },
          coverage: {
            assessment: "incomplete",
            dimensions: [{ key: "scope", state: "conflict", detail: "Capture is invalid." }],
          },
          completion: "undetermined",
        } as MattObservationView;
      }),
      "Projection state is invalid.",
    ],
    [
      "incomplete coverage",
      build(bound, (observation) => ({
        ...observation,
        coverage: {
          assessment: "incomplete",
          dimensions: [
            ...observation.coverage.dimensions,
            { key: "answers", state: "gap" as const, detail: "Answer coverage is incomplete." },
          ],
        },
        completion: "undetermined",
      })),
      "Coverage is incomplete.",
    ],
    [
      "coverage conflict",
      build(bound, (observation) => ({
        ...observation,
        coverage: {
          assessment: "incomplete",
          dimensions: [
            ...observation.coverage.dimensions,
            { key: "answers", state: "conflict" as const, detail: "Answer sources conflict." },
          ],
        },
        completion: "undetermined",
      })),
      "Coverage dimensions contain a conflict.",
    ],
    [
      "undetermined completion",
      build(bound, (observation) => ({ ...observation, completion: "undetermined" })),
      "Provider Completion is undetermined.",
    ],
    [
      "blocking diagnostic",
      build(bound, (observation) => ({
        ...observation,
        completion: "undetermined",
        diagnostics: [
          ...observation.diagnostics,
          {
            code: "matt.test.blocking",
            class: "mapping" as const,
            impact: "blocking" as const,
            target: observation.binding.nativeScope,
            message: "A required mapping is ambiguous.",
          },
        ],
      })),
      "1 blocking diagnostic withholds trust.",
    ],
  ] as const;

  for (const [name, reading, cause] of cases) {
    expect(reading.conclusion, name).toBe("Can't verify");
    expect(reading.why.causes, name).toContain(cause);
  }

  const { observation, selections } = fixture();
  const missingSelection = buildMattNativeWorkReadingState(observation, [], {
    state: "bound",
    effortIds: ["effort:portal"],
    nativeScope: observation.binding.nativeScope,
  });
  expect(missingSelection.conclusion).toBe("Can't verify");
  expect(missingSelection.why.causes).toContain("No current source evidence is selected.");

  const mismatchedSelection = buildMattNativeWorkReadingState(
    observation,
    selections.map((selection) =>
      selection.nativeScope === observation.binding.nativeScope
        ? { ...selection, observationId: "observation:other" }
        : selection,
    ),
    {
      state: "bound",
      effortIds: ["effort:portal"],
      nativeScope: observation.binding.nativeScope,
    },
  );
  expect(mismatchedSelection.conclusion).toBe("Can't verify");
});

test("keeps binding attention outside completion authority", () => {
  for (const reason of [
    "binding-conflict",
    "bound-unresolved",
    "identity-mismatch",
    "root-kind-conflict",
  ] as const) {
    const reading = build({
      state: "attention",
      reason,
      effortIds: ["effort:portal"],
    });
    expect(reading).toMatchObject({
      conclusion: "Binding needs attention",
      binding: { state: "attention", reason },
    });
  }
});

test("withholds a prior complete observation after the latest verification fails", () => {
  const { observation, selections } = fixture();
  const complete = { ...observation, completion: "complete" as const };
  const failedSelections = selections.map((selection) =>
    selection.nativeScope === observation.binding.nativeScope
      ? {
          ...selection,
          observationId: complete.id,
          effectiveFreshness: "undetermined" as const,
          latestAttempt: {
            intent: "all-scope-verification" as const,
            attemptedAt: "2026-07-31T07:00:00Z",
            outcome: "failed" as const,
            diagnostics: [
              {
                code: "provider.network.failed",
                impact: "blocking" as const,
                target: observation.binding.nativeScope,
                message: "The provider could not verify the current revision.",
              },
            ],
          },
        }
      : selection,
  );
  const reading = buildMattNativeWorkReadingState(complete, failedSelections, {
    state: "bound",
    effortIds: ["effort:portal"],
  });

  expect(reading.conclusion).toBe("Can't verify");
  expect(reading.why.causes).toContain(
    "The latest provider acquisition or verification attempt failed.",
  );
  expect(reading.observation.diagnostics).toContainEqual({
    origin: "latest-attempt",
    code: "provider.network.failed",
    impact: "blocking",
    target: ".scratch/portal",
    message: "The provider could not verify the current revision.",
  });
});

test("keeps a first acquisition failure bound while preserving its concrete diagnostic", () => {
  const { observation, selections } = fixture();
  const failedSelections = selections.map((selection) =>
    selection.nativeScope === observation.binding.nativeScope
      ? {
          ...selection,
          observationId: null,
          effectiveFreshness: "undetermined" as const,
          latestAttempt: {
            intent: "exact-scope-capture" as const,
            attemptedAt: "2026-07-31T07:00:00Z",
            outcome: "failed" as const,
            diagnostics: [
              {
                code: "provider.contract.unsupported",
                impact: "blocking" as const,
                target: observation.binding.nativeScope,
                message: "The provider contract is unsupported.",
              },
            ],
          },
        }
      : selection,
  );

  const reading = buildMattNativeWorkReadingState(undefined, failedSelections, {
    state: "bound",
    effortIds: ["effort:portal"],
    nativeScope: observation.binding.nativeScope,
  });

  expect(reading).toMatchObject({
    conclusion: "Can't verify",
    binding: { state: "bound", effortIds: ["effort:portal"] },
    why: {
      projectionState: "missing",
      freshness: "undetermined",
      blockingDiagnosticCount: 1,
    },
  });
  expect(reading.observation.diagnostics).toContainEqual({
    origin: "latest-attempt",
    code: "provider.contract.unsupported",
    impact: "blocking",
    target: ".scratch/portal",
    message: "The provider contract is unsupported.",
  });
  expect(reading.why.causes).toContain("The provider contract is unsupported.");
});

test("uses stable GitHub identity across locator changes and surfaces locator identity reuse", () => {
  const { observation, selections } = fixture();
  const githubScope = (owner: string, repositoryNodeId: string, rootNodeId: string): string =>
    encodeGitHubMattNativeScope({
      host: "github.com",
      rootKind: "wayfinder-map",
      repository: {
        owner,
        name: "bearing",
        databaseId: "repository-database",
        nodeId: repositoryNodeId,
      },
      root: {
        objectKind: "issue",
        number: 15,
        databaseId: "root-database",
        nodeId: rootNodeId,
      },
    });
  const originalScope = githubScope("old-owner", "repository-node", "root-node");
  const renamedScope = githubScope("new-owner", "repository-node", "root-node");
  const reusedLocatorScope = githubScope(
    "new-owner",
    "different-repository-node",
    "different-root-node",
  );
  const effort = {
    id: "effort:github",
    workBinding: { provider: "matt-skills/v1" as const, nativeScope: originalScope },
  };
  const renamedObservation = {
    ...observation,
    binding: { ...observation.binding, nativeScope: renamedScope },
  };
  const fixtureSelection = selections[0];
  if (fixtureSelection === undefined) throw new Error("Expected a provider selection.");
  const renamedSelection = [
    {
      ...fixtureSelection,
      nativeScope: originalScope,
      observationId: renamedObservation.id,
    },
  ];

  expect(
    mattNativeWorkReadingContextForEffort([effort], effort, renamedObservation, renamedSelection),
  ).toMatchObject({
    state: "bound",
    effortIds: ["effort:github"],
  });
  expect(mattNativeWorkReadingContextForScope([effort], renamedObservation)).toMatchObject({
    state: "bound",
    effortIds: ["effort:github"],
  });

  const reusedLocatorObservation = {
    ...observation,
    binding: { ...observation.binding, nativeScope: reusedLocatorScope },
  };
  const relocatedEffort = {
    ...effort,
    workBinding: { ...effort.workBinding, nativeScope: renamedScope },
  };
  expect(
    mattNativeWorkReadingContextForEffort(
      [relocatedEffort],
      relocatedEffort,
      reusedLocatorObservation,
      renamedSelection,
    ),
  ).toMatchObject({
    state: "attention",
    reason: "identity-mismatch",
    effortIds: ["effort:github"],
  });
  expect(
    mattNativeWorkReadingContextForScope([relocatedEffort], reusedLocatorObservation),
  ).toMatchObject({
    state: "attention",
    reason: "identity-mismatch",
    effortIds: ["effort:github"],
  });
});

test("retains progressive explanation and complete observation details without a refresh action", () => {
  const reading = build({ state: "bound", effortIds: ["effort:portal"] });

  expect(reading.impact).toContain("does not conclude the Effort or Gate");
  expect(reading.action).toBe("Continue work through the native tracker owner.");
  expect(reading.observation).toMatchObject({
    sourceRevision: { availability: "available" },
    observedAt: { availability: "available" },
    coverageDimensions: expect.arrayContaining([{ key: "scope", state: "covered" }]),
    validators: [],
    diagnostics: [],
  });
  expect(JSON.stringify(reading)).not.toContain("Needs refresh");
  expect(JSON.stringify(reading)).not.toContain("Refresh");
});
