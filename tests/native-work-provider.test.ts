import { describe, expect, test } from "bun:test";
import {
  assessProviderObservationEvidence,
  createProviderScopeObservation,
  type ProviderConfiguration,
  type WorkBinding,
} from "../src/native-work-provider";
import { fingerprintProviderObservationSelection } from "../src/provider-evidence-selection";
import type { MattSkillsV1Provider } from "../src/providers/matt-skills-v1/capture";
import {
  createMattReferenceAliases,
  createMattReferenceProjection,
  createMattReferenceProvider,
  expectedMattReferenceSemantics,
} from "./fixtures/matt-reference-scenario";
import { mattReferenceSemanticView } from "./helpers/matt-reference-oracle";

const providerConfiguration: ProviderConfiguration<"matt-skills/v1"> = {
  provider: "matt-skills/v1",
  contractLocator: "docs/agents/issue-tracker.md",
};

const binding: WorkBinding<"matt-skills/v1"> = {
  provider: "matt-skills/v1",
  nativeScope: "scope:reference",
};

describe("NativeWorkProvider capture contract", () => {
  test("returns one deeply immutable scope capture through the public semantic seam", async () => {
    let calls = 0;
    const provider: MattSkillsV1Provider = {
      id: "matt-skills/v1",
      capture: async (requestedBinding) => {
        calls += 1;
        return createProviderScopeObservation({
          provider: "matt-skills/v1",
          binding: requestedBinding,
          state: "partial",
          freshness: {
            assessment: "current",
            capturedAt: "2026-07-28T00:00:00Z",
            sourceRevision: "sha256:reference-source",
            evidence: [{ kind: "fixture", value: "reference" }],
          },
          coverage: {
            assessment: "incomplete",
            dimensions: [
              { key: "scope-membership", state: "covered" },
              {
                key: "answer",
                state: "gap",
                detail: "One Answer has no unique native reference.",
              },
            ],
          },
          completion: "undetermined",
          diagnostics: [
            {
              code: "matt.answer.unavailable",
              class: "mapping",
              impact: "blocking",
              target: requestedBinding.nativeScope,
              message: "One Answer has no unique native reference.",
            },
          ],
          projection: createMattReferenceProjection("local"),
        });
      },
    };

    const capture = await provider.capture(binding);

    expect(calls).toBe(1);
    expect(capture.provider).toBe(provider.id);
    expect(capture.binding).toEqual(binding);
    expect(capture).not.toHaveProperty("generation");
    expect(capture.id).toMatch(/^provider-observation:sha256:[a-f0-9]{64}$/);
    expect(capture.state).toBe("partial");
    expect(capture.freshness.assessment).toBe("current");
    expect(capture.coverage.assessment).toBe("incomplete");
    expect(capture.completion).toBe("undetermined");
    expect(capture.diagnostics).toHaveLength(1);
    expect(capture.projection).toBeDefined();
    expect(Object.isFrozen(capture)).toBe(true);
    expect(Object.isFrozen(capture.coverage.dimensions)).toBe(true);
    expect(Object.isFrozen(capture.projection?.wayfinderTickets[0]?.native.rawFacets)).toBe(true);
    expect(() =>
      (
        capture.coverage.dimensions as {
          key: string;
          state: string;
        }[]
      ).push({ key: "late-mutation", state: "gap" }),
    ).toThrow();
  });

  test("keeps state, freshness and completion independent while forbidding false completion", () => {
    const staleAvailable = createProviderScopeObservation({
      provider: "matt-skills/v1",
      binding,
      state: "available",
      freshness: {
        assessment: "stale",
        capturedAt: "2026-07-28T00:00:00Z",
        evidence: [{ kind: "fixture", value: "last-known-complete" }],
      },
      coverage: {
        assessment: "complete",
        dimensions: [{ key: "scope-membership", state: "covered" }],
      },
      completion: "incomplete",
      diagnostics: [],
      projection: createMattReferenceProjection("github"),
    });
    expect(staleAvailable.state).toBe("available");
    expect(staleAvailable.freshness.assessment).toBe("stale");
    expect(staleAvailable.coverage.assessment).toBe("complete");
    expect(staleAvailable.completion).toBe("incomplete");

    const absent = createProviderScopeObservation({
      provider: "matt-skills/v1",
      binding,
      state: "absent",
      freshness: {
        assessment: "current",
        capturedAt: "2026-07-28T00:00:00Z",
        evidence: [{ kind: "fixture", value: "root-not-found" }],
      },
      coverage: {
        assessment: "complete",
        dimensions: [{ key: "root-existence", state: "covered" }],
      },
      completion: "incomplete",
      diagnostics: [],
    });
    expect(absent.state).toBe("absent");
    expect(absent.freshness.assessment).toBe("current");
    expect(absent.completion).toBe("incomplete");

    expect(() =>
      createProviderScopeObservation({
        provider: "matt-skills/v1",
        binding,
        state: "partial",
        freshness: {
          assessment: "current",
          capturedAt: "2026-07-28T00:00:00Z",
          evidence: [],
        },
        coverage: { assessment: "complete", dimensions: [] },
        completion: "complete",
        diagnostics: [],
        projection: createMattReferenceProjection("local"),
      }),
    ).toThrow("complete");

    expect(() =>
      createProviderScopeObservation({
        provider: "matt-skills/v1",
        binding,
        state: "available",
        freshness: {
          assessment: "current",
          capturedAt: "2026-07-28T00:00:00Z",
          evidence: [],
        },
        coverage: {
          assessment: "complete",
          dimensions: [{ key: "answer", state: "gap" }],
        },
        completion: "complete",
        diagnostics: [],
        projection: createMattReferenceProjection("local"),
      }),
    ).toThrow("gaps");

    expect(() =>
      createProviderScopeObservation({
        provider: "matt-skills/v1",
        binding,
        state: "available",
        freshness: {
          assessment: "current",
          capturedAt: "2026-07-28T00:00:00Z",
          evidence: [],
        },
        coverage: {
          assessment: "complete",
          dimensions: [{ key: "scope-membership", state: "covered" }],
        },
        completion: "complete",
        diagnostics: [
          {
            code: "matt.mapping.blocked",
            class: "mapping",
            impact: "blocking",
            target: binding.nativeScope,
            message: "The mapping is blocked.",
          },
        ],
        projection: createMattReferenceProjection("local"),
      }),
    ).toThrow("blocking diagnostics");
  });

  test("assesses executable frontier evidence from wrapper axes without deriving completion", () => {
    const available = {
      state: "available" as const,
      freshness: { assessment: "current" as const },
      coverage: {
        assessment: "complete" as const,
        dimensions: [{ state: "covered" as const }],
      },
      completion: "incomplete" as const,
      diagnostics: [],
    };

    expect(assessProviderObservationEvidence(available)).toEqual({
      projectionState: "available",
      freshness: "current",
      coverage: "complete",
      completion: "incomplete",
      blockingDiagnosticCount: 0,
      frontierEvidence: "trustworthy",
    });

    const degraded = [
      { ...available, state: "partial" as const },
      { ...available, state: "absent" as const },
      { ...available, state: "invalid" as const },
      { ...available, freshness: { assessment: "stale" as const } },
      { ...available, freshness: { assessment: "undetermined" as const } },
      {
        ...available,
        coverage: {
          assessment: "incomplete" as const,
          dimensions: [{ state: "gap" as const }],
        },
      },
      { ...available, completion: "undetermined" as const },
      {
        ...available,
        diagnostics: [{ impact: "blocking" as const }],
      },
    ];
    for (const capture of degraded) {
      expect(assessProviderObservationEvidence(capture).frontierEvidence).toBe("withheld");
    }

    expect(assessProviderObservationEvidence(undefined)).toEqual({
      projectionState: "missing",
      freshness: "undetermined",
      coverage: "undetermined",
      completion: "undetermined",
      blockingDiagnosticCount: 0,
      frontierEvidence: "withheld",
    });
  });

  test("delegates deep immutability of validated structural data to the package boundary", () => {
    const capture = createProviderScopeObservation({
      provider: "matt-skills/v1",
      binding,
      state: "available",
      freshness: {
        assessment: "current",
        capturedAt: "2026-07-28T00:00:00Z",
        evidence: [],
      },
      coverage: {
        assessment: "complete",
        dimensions: [{ key: "scope-membership", state: "covered" }],
      },
      completion: "incomplete",
      diagnostics: [],
      projection: {
        semanticChild: {
          value: "immutable",
        },
      },
    });

    if (capture.state !== "available") {
      throw new TypeError("Expected an available structural capture.");
    }
    expect(Object.isFrozen(capture.projection)).toBe(true);
    expect(Object.isFrozen(capture.projection.semanticChild)).toBe(true);
  });

  test("rejects provider values outside the string-keyed structural contract", () => {
    const createCaptureWithProjection = (projection: unknown) =>
      createProviderScopeObservation({
        provider: "matt-skills/v1",
        binding,
        state: "available",
        freshness: {
          assessment: "current",
          capturedAt: "2026-07-28T00:00:00Z",
          evidence: [],
        },
        coverage: {
          assessment: "complete",
          dimensions: [{ key: "scope-membership", state: "covered" }],
        },
        completion: "incomplete",
        diagnostics: [],
        projection,
      } as never);

    expect(() => createCaptureWithProjection(new Map([["mutable", "value"]]))).toThrow(
      "string-keyed structural",
    );
    expect(() =>
      createCaptureWithProjection({
        [Symbol("hidden")]: {
          mutable: true,
        },
      }),
    ).toThrow("string-keyed structural");
    expect(() => createCaptureWithProjection(undefined)).toThrow("require one projection");

    expect(() =>
      createProviderScopeObservation({
        provider: "matt-skills/v1",
        binding,
        state: "invalid",
        freshness: {
          assessment: "undetermined",
          capturedAt: "2026-07-28T00:00:00Z",
          evidence: [],
        },
        coverage: {
          assessment: "incomplete",
          dimensions: [{ key: "source", state: "gap" }],
        },
        completion: "undetermined",
        diagnostics: [],
        projection: {},
      } as never),
    ).toThrow("forbid it");
  });

  test("represents expected acquisition failures as scoped captures without throwing", async () => {
    for (const failureClass of [
      "source",
      "contract",
      "mapping",
      "permission",
      "acquisition",
    ] as const) {
      const provider: MattSkillsV1Provider = {
        id: "matt-skills/v1",
        capture: async (requestedBinding) =>
          createProviderScopeObservation({
            provider: "matt-skills/v1",
            binding: requestedBinding,
            state: "invalid",
            freshness: {
              assessment: "undetermined",
              capturedAt: "2026-07-28T00:00:00Z",
              evidence: [{ kind: failureClass, value: "expected-failure" }],
            },
            coverage: {
              assessment: "incomplete",
              dimensions: [
                {
                  key: failureClass,
                  state: "gap",
                  detail: `Expected ${failureClass} failure.`,
                },
              ],
            },
            completion: "undetermined",
            diagnostics: [
              {
                code: `matt.${failureClass}.failure`,
                class: failureClass,
                impact: "blocking",
                target: requestedBinding.nativeScope,
                message: `The ${failureClass} input is unavailable.`,
              },
            ],
          }),
      };

      await expect(provider.capture(binding)).resolves.toMatchObject({
        state: "invalid",
        freshness: { assessment: "undetermined" },
        coverage: { assessment: "incomplete" },
        completion: "undetermined",
        diagnostics: [{ class: failureClass }],
      });
    }
  });

  test("keeps provider configuration and work binding free of tracker driver state", () => {
    expect(Object.keys(providerConfiguration).sort()).toEqual(["contractLocator", "provider"]);
    expect(Object.keys(binding).sort()).toEqual(["nativeScope", "provider"]);
  });
});

test("provider semantic fingerprint is stable when observation ids reorder multiple bindings", () => {
  const observationFor = (nativeScope: string) =>
    createProviderScopeObservation({
      provider: "matt-skills/v1",
      binding: { provider: "matt-skills/v1", nativeScope },
      observedAt: "2026-08-09T00:00:00.000Z",
      sourceRevision: `sha256:${nativeScope}`,
      freshness: { assessment: "current", evidence: [] },
      coverage: { assessment: "complete", dimensions: [] },
      completion: "incomplete",
      diagnostics: [],
      state: "available",
      projection: createMattReferenceProjection("github"),
    });
  const left = observationFor("scope:left");
  const right = observationFor("scope:right");
  const selectionFor = (observation: typeof left) => ({
    provider: "matt-skills/v1" as const,
    nativeScope: observation.binding.nativeScope,
    observationId: observation.id,
    effectiveFreshness: "current" as const,
    latestAttempt: null,
  });

  expect(
    fingerprintProviderObservationSelection(
      [left, right],
      [selectionFor(left), selectionFor(right)],
    ),
  ).toBe(
    fingerprintProviderObservationSelection(
      [right, left],
      [selectionFor(right), selectionFor(left)],
    ),
  );
});

describe("Matt reference scenario oracle", () => {
  test("compares capture-level accepted semantics while ignoring provider-native identity", async () => {
    const localProvider = createMattReferenceProvider("local");
    const githubProvider = createMattReferenceProvider("github");
    const local = await localProvider.capture({
      provider: "matt-skills/v1",
      nativeScope: "local:reference",
    });
    const github = await githubProvider.capture({
      provider: "matt-skills/v1",
      nativeScope: "github:reference",
    });

    expect(local).not.toEqual(github);
    expect(local.projection?.map?.ref).not.toBe(github.projection?.map?.ref);
    expect(mattReferenceSemanticView(local, createMattReferenceAliases("local"))).toEqual(
      expectedMattReferenceSemantics,
    );
    expect(mattReferenceSemanticView(github, createMattReferenceAliases("github"))).toEqual(
      expectedMattReferenceSemantics,
    );
    expect(local.projection?.wayfinderTickets.map((ticket) => ticket.subtype)).toEqual([
      "research",
      "prototype",
      "grilling",
      "task",
    ]);
    expect(
      local.projection?.wayfinderTickets.some(
        (ticket) => ticket.answer.availability === "unavailable",
      ),
    ).toBe(true);
  });
});
