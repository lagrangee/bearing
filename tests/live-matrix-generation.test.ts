import { describe, expect, test } from "bun:test";
import {
  createLiveMatrixGenerationBasis,
  LIVE_MATRIX_CONCURRENCY,
  parseLiveMatrixGenerationBasis,
} from "../scripts/live-matrix-generation";

const generationId = "11111111-1111-4111-8111-111111111111";
const digest = (character: string) => character.repeat(64);

const validInput = () => ({
  generationId,
  staticPreflight: "complete",
  package: {
    evidenceClass: "local-rehearsal",
    identitySha256: digest("1"),
  },
  registryDefinitionSha256: digest("2"),
  fixtureDefinitionSha256: digest("3"),
  harnessIdentitySha256: digest("4"),
  startedAt: "2026-08-30T00:00:00.000Z",
  selectedScenarioIds: ["accept-native-enrollment", "github-delivery-writeback"],
  preparedScenarios: [
    {
      generationId,
      scenarioId: "github-delivery-writeback",
      fixtureSha256: digest("5"),
      skillsSha256: digest("6"),
      permissionOutcome: "passed",
      githubBaselineSha256: digest("7"),
    },
    {
      generationId,
      scenarioId: "accept-native-enrollment",
      fixtureSha256: digest("8"),
      skillsSha256: digest("9"),
      permissionOutcome: "passed",
    },
  ],
});

describe("minimal Live Matrix Generation basis", () => {
  test("binds fixed runtime identity and one fresh readback per selected Scenario", () => {
    const basis = createLiveMatrixGenerationBasis(validInput());

    expect(basis).toMatchObject({
      schemaVersion: 1,
      generationId,
      staticPreflight: "complete",
      runtime: {
        model: "gpt-5.6-luna",
        reasoningEffort: "high",
        fastMode: true,
        concurrency: LIVE_MATRIX_CONCURRENCY,
      },
    });
    expect(basis.preparedScenarios.map(({ scenarioId }) => scenarioId)).toEqual([
      "accept-native-enrollment",
      "github-delivery-writeback",
    ]);
    expect(basis.preparedScenarios[0]).not.toHaveProperty("githubBaselineSha256");
    expect(basis.preparedScenarios[1]?.githubBaselineSha256).toBe(digest("7"));
  });

  test("requires completed static preflight and strict fixed runtime fields", () => {
    expect(() =>
      createLiveMatrixGenerationBasis({ ...validInput(), staticPreflight: "blocked" }),
    ).toThrow();

    const basis = createLiveMatrixGenerationBasis(validInput());
    expect(() =>
      parseLiveMatrixGenerationBasis({
        ...basis,
        runtime: { ...basis.runtime, concurrency: 2 },
      }),
    ).toThrow();
    expect(() => parseLiveMatrixGenerationBasis({ ...basis, attempts: [] })).toThrow();
  });

  test("rejects missing, duplicate, unselected, or stale Scenario readbacks", () => {
    const input = validInput();
    expect(() =>
      createLiveMatrixGenerationBasis({
        ...input,
        selectedScenarioIds: ["accept-native-enrollment", "accept-native-enrollment"],
      }),
    ).toThrow("Selected Scenario appears more than once");
    expect(() =>
      createLiveMatrixGenerationBasis({
        ...input,
        preparedScenarios: input.preparedScenarios.slice(0, 1),
      }),
    ).toThrow("Selected Scenario was not prepared");
    expect(() =>
      createLiveMatrixGenerationBasis({
        ...input,
        preparedScenarios: [input.preparedScenarios[0], input.preparedScenarios[0]],
      }),
    ).toThrow("prepared more than once");
    expect(() =>
      createLiveMatrixGenerationBasis({
        ...input,
        preparedScenarios: [
          input.preparedScenarios[0],
          { ...input.preparedScenarios[1], scenarioId: "unselected-scenario" },
        ],
      }),
    ).toThrow("was not selected");
    expect(() =>
      createLiveMatrixGenerationBasis({
        ...input,
        preparedScenarios: [
          input.preparedScenarios[0],
          {
            ...input.preparedScenarios[1],
            generationId: "22222222-2222-4222-8222-222222222222",
          },
        ],
      }),
    ).toThrow("not fresh for this Generation");
  });

  test("accepts only a successful permission readback", () => {
    const input = validInput();
    expect(() =>
      createLiveMatrixGenerationBasis({
        ...input,
        preparedScenarios: [
          input.preparedScenarios[0],
          { ...input.preparedScenarios[1], permissionOutcome: "failed" },
        ],
      }),
    ).toThrow();
  });
});
