import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLiveMatrixGenerationBasis } from "../scripts/live-matrix-generation";
import {
  createLiveMatrixResult,
  createLiveMatrixScenarioTerminalResult,
  LIVE_MATRIX_COORDINATOR_AUTHORITY,
  LIVE_MATRIX_SLOW_OBSERVATION_MS,
  parseLiveMatrixResultForScenarioIds,
  parseLiveMatrixScenarioTerminalResult,
  verifyLiveMatrixResult,
} from "../scripts/live-matrix-results";

const generationId = "11111111-1111-4111-8111-111111111111";
const digest = (digit: string) => digit.repeat(64);
const reference = (name: string, digit: string) => ({
  pointer: `results/${name}.json`,
  sha256: digest(digit),
});

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

const sha256 = (bytes: Uint8Array | string): string =>
  createHash("sha256").update(bytes).digest("hex");

const createBasis = (
  scenarioIds: readonly string[],
  evidenceClass: "local-rehearsal" | "release-candidate" = "local-rehearsal",
) =>
  createLiveMatrixGenerationBasis({
    generationId,
    staticPreflight: "complete",
    package: {
      evidenceClass,
      identitySha256: digest("1"),
    },
    registryDefinitionSha256: digest("2"),
    fixtureDefinitionSha256: digest("3"),
    harnessIdentitySha256: digest("4"),
    startedAt: "2026-08-30T00:00:00.000Z",
    selectedScenarioIds: [...scenarioIds],
    preparedScenarios: scenarioIds.map((scenarioId, index) => ({
      generationId,
      scenarioId,
      fixtureSha256: digest(String((index % 9) + 1)),
      skillsSha256: digest(String(((index + 1) % 9) + 1)),
      permissionOutcome: "passed" as const,
    })),
  });

const createScenario = (input: {
  scenarioId: string;
  outcome: "pass" | "fail" | "blocked";
  startedAt?: string;
  endedAt?: string;
  evidence?: readonly { evidenceClass: "observation"; pointer: string; sha256: string }[];
}) => {
  const startedAt = input.startedAt ?? "2026-08-30T00:00:01.000Z";
  const endedAt = input.endedAt ?? "2026-08-30T00:00:02.000Z";
  return createLiveMatrixScenarioTerminalResult({
    generationId,
    scenarioId: input.scenarioId,
    outcome: input.outcome,
    rationale: `${input.scenarioId} received a truthful ${input.outcome} verdict.`,
    evidence: input.evidence ?? [
      {
        evidenceClass: "observation",
        pointer: `observations/${input.scenarioId.toLowerCase()}.json`,
        sha256: digest("8"),
      },
    ],
    turns: [{ turnNumber: 1, startedAt, endedAt }],
    startedAt,
    endedAt,
  });
};

const writeVerifiableMatrix = async () => {
  const root = await mkdtemp(join(tmpdir(), "bearing-live-matrix-result-"));
  temporaryRoots.push(root);
  const scenarioIds = ["ENTRY-03"];
  const basis = createBasis(scenarioIds);
  const generationPointer = "generation-basis.json";
  const generationBytes = `${JSON.stringify(basis, null, 2)}\n`;
  await writeFile(join(root, generationPointer), generationBytes);

  const observationPointer = "generation/scenarios/ENTRY-03/observations/turn-01.json";
  const observationBytes = `${JSON.stringify({ schemaVersion: 1, turn: 1 })}\n`;
  await mkdir(join(root, "generation/scenarios/ENTRY-03/observations"), { recursive: true });
  await writeFile(join(root, observationPointer), observationBytes);
  const result = createScenario({
    scenarioId: "ENTRY-03",
    outcome: "pass",
    evidence: [
      {
        evidenceClass: "observation",
        pointer: observationPointer,
        sha256: sha256(observationBytes),
      },
    ],
  });
  const resultPointer = "scenario-results/ENTRY-03.json";
  const resultBytes = `${JSON.stringify(result, null, 2)}\n`;
  await mkdir(join(root, "scenario-results"));
  await writeFile(join(root, resultPointer), resultBytes);
  const matrix = createLiveMatrixResult({
    generationBasis: basis,
    generationBasisReference: {
      pointer: generationPointer,
      sha256: sha256(generationBytes),
    },
    registeredScenarioIds: scenarioIds,
    scenarioResults: [
      {
        result,
        reference: { pointer: resultPointer, sha256: sha256(resultBytes) },
      },
    ],
    peakConcurrency: 1,
    endedAt: "2026-08-30T00:01:00.000Z",
  });
  const matrixPath = join(root, "matrix-result.json");
  await writeFile(matrixPath, `${JSON.stringify(matrix, null, 2)}\n`);
  return {
    root,
    scenarioIds,
    basis,
    matrix,
    matrixPath,
    generationPointer,
    resultPointer,
    observationPointer,
  };
};

describe("minimal Live Matrix results", () => {
  test("computes a terminal Scenario duration and rejects unsafe or unbounded evidence", () => {
    const result = createLiveMatrixScenarioTerminalResult({
      generationId,
      scenarioId: "NATIVE-02",
      outcome: "fail",
      rationale: "The required native writeback was absent.",
      evidence: [
        {
          evidenceClass: "observation",
          pointer: "observations/native-02.json",
          sha256: digest("1"),
        },
      ],
      turns: [
        {
          turnNumber: 1,
          startedAt: "2026-08-30T00:00:01.250Z",
          endedAt: "2026-08-30T00:00:03.250Z",
        },
      ],
      startedAt: "2026-08-30T00:00:01.000Z",
      endedAt: "2026-08-30T00:00:03.500Z",
    });

    expect(result).toMatchObject({
      outcome: "fail",
      durationMs: 2_500,
      turns: [
        {
          turnNumber: 1,
          durationMs: 2_000,
        },
      ],
      semanticEvaluationAuthority: LIVE_MATRIX_COORDINATOR_AUTHORITY,
    });
    expect(() =>
      parseLiveMatrixScenarioTerminalResult({
        ...result,
        evidence: [
          {
            evidenceClass: "before-state",
            pointer: "states/native-02-before.json",
            sha256: digest("2"),
          },
        ],
      }),
    ).toThrow();
    expect(() =>
      createLiveMatrixScenarioTerminalResult({
        ...result,
        evidence: [
          {
            evidenceClass: "observation",
            pointer: "/private/tmp/raw-transcript.json",
            sha256: digest("3"),
          },
        ],
      }),
    ).toThrow("normalized relative paths");
    expect(() =>
      createLiveMatrixScenarioTerminalResult({
        ...result,
        evidence: [
          {
            evidenceClass: "observation",
            pointer: "observations/raw-transcript.json",
            sha256: digest("3"),
          },
        ],
      }),
    ).toThrow("cannot point to credential, raw transcript, or session data");
    expect(() =>
      createLiveMatrixScenarioTerminalResult({
        ...result,
        evidence: Array.from({ length: 9 }, (_, index) => ({
          evidenceClass: "observation" as const,
          pointer: `observations/${index}.json`,
          sha256: digest("4"),
        })),
      }),
    ).toThrow();
    expect(() => parseLiveMatrixScenarioTerminalResult({ ...result, attempt: 2 })).toThrow();
  });

  test("requires contiguous in-window Turn timings for behavior outcomes", () => {
    const result = createScenario({ scenarioId: "NATIVE-02", outcome: "pass" });
    const turn = result.turns[0];
    if (turn === undefined) throw new Error("Expected one Turn timing row.");

    expect(() => parseLiveMatrixScenarioTerminalResult({ ...result, turns: [] })).toThrow(
      "requires at least one Turn",
    );
    expect(() =>
      parseLiveMatrixScenarioTerminalResult({ ...result, outcome: "invalid" }),
    ).toThrow();
    expect(() =>
      parseLiveMatrixScenarioTerminalResult({
        ...result,
        turns: [{ ...turn, turnNumber: 2 }],
      }),
    ).toThrow("contiguous and start at one");
    expect(() =>
      parseLiveMatrixScenarioTerminalResult({
        ...result,
        turns: [{ ...turn, durationMs: 999 }],
      }),
    ).toThrow("duration must equal");
    expect(() =>
      parseLiveMatrixScenarioTerminalResult({
        ...result,
        turns: [
          {
            ...turn,
            startedAt: "2026-08-29T23:59:59.999Z",
            durationMs: 2_001,
          },
        ],
      }),
    ).toThrow("within the Scenario window");

    expect(createScenario({ scenarioId: "STOP-02", outcome: "blocked" }).turns).toHaveLength(1);
  });

  test("aggregates the full registry after non-pass results and only reports slow work", () => {
    const scenarioIds = ["ENTRY-03", "NATIVE-02", "STOP-02"];
    const basis = createBasis(scenarioIds);
    const pass = createScenario({ scenarioId: "ENTRY-03", outcome: "pass" });
    const fail = createScenario({
      scenarioId: "NATIVE-02",
      outcome: "fail",
      startedAt: "2026-08-30T00:00:01.000Z",
      endedAt: "2026-08-30T00:10:01.001Z",
    });
    const blocked = createScenario({ scenarioId: "STOP-02", outcome: "blocked" });

    const matrix = createLiveMatrixResult({
      generationBasis: basis,
      generationBasisReference: reference("generation", "a"),
      registeredScenarioIds: scenarioIds,
      scenarioResults: [
        { result: pass, reference: reference("entry-03", "1") },
        { result: blocked, reference: reference("stop-02", "3") },
        { result: fail, reference: reference("native-02", "2") },
      ],
      peakConcurrency: 3,
      endedAt: "2026-08-30T00:11:00.000Z",
    });

    expect(matrix.scenarios.map(({ scenarioId }) => scenarioId)).toEqual(scenarioIds);
    expect(matrix.scenarios.map(({ outcome }) => outcome)).toEqual(["pass", "fail", "blocked"]);
    expect(matrix).toMatchObject({
      terminalOutcome: "not-pass",
      releasePrerequisiteSatisfied: false,
      report: {
        scenarioCount: 3,
        passCount: 1,
        nonPassCount: 2,
        failures: ["NATIVE-02"],
        blocked: ["STOP-02"],
        peakConcurrency: 3,
        slowObservations: [
          {
            scope: "scenario",
            scenarioId: "NATIVE-02",
            durationMs: LIVE_MATRIX_SLOW_OBSERVATION_MS + 1,
            thresholdMs: LIVE_MATRIX_SLOW_OBSERVATION_MS,
          },
          {
            scope: "turn",
            scenarioId: "NATIVE-02",
            turnNumber: 1,
            durationMs: LIVE_MATRIX_SLOW_OBSERVATION_MS + 1,
            thresholdMs: LIVE_MATRIX_SLOW_OBSERVATION_MS,
          },
        ],
      },
    });
    expect(matrix.scenarios[1]).toMatchObject({
      outcome: "fail",
      slowObservation: true,
      turns: [
        {
          turnNumber: 1,
          durationMs: LIVE_MATRIX_SLOW_OBSERVATION_MS + 1,
          slowObservation: true,
        },
      ],
    });
    expect(() =>
      parseLiveMatrixResultForScenarioIds(
        { ...matrix, report: { ...matrix.report, slowObservations: [] } },
        scenarioIds,
      ),
    ).toThrow("terminal summary contradicts");
  });

  test("does not report a Scenario or Turn that lasts exactly ten minutes as slow", () => {
    const scenarioIds = ["ENTRY-03"];
    const basis = createBasis(scenarioIds);
    const result = createScenario({
      scenarioId: "ENTRY-03",
      outcome: "pass",
      startedAt: "2026-08-30T00:00:01.000Z",
      endedAt: "2026-08-30T00:10:01.000Z",
    });
    const matrix = createLiveMatrixResult({
      generationBasis: basis,
      generationBasisReference: reference("generation", "a"),
      registeredScenarioIds: scenarioIds,
      scenarioResults: [{ result, reference: reference("entry-03", "1") }],
      peakConcurrency: 1,
      endedAt: "2026-08-30T00:10:02.000Z",
    });

    expect(matrix.scenarios[0]?.slowObservation).toBe(false);
    expect(matrix.scenarios[0]?.turns[0]?.slowObservation).toBe(false);
    expect(matrix.report.slowObservations).toEqual([]);
  });

  test("rejects zero peak because every valid result follows completed behavior", () => {
    const scenarioIds = ["STOP-02"];
    const basis = createBasis(scenarioIds);
    const blocked = createScenario({ scenarioId: "STOP-02", outcome: "blocked" });
    expect(() =>
      createLiveMatrixResult({
        generationBasis: basis,
        generationBasisReference: reference("generation", "a"),
        registeredScenarioIds: scenarioIds,
        scenarioResults: [{ result: blocked, reference: reference("stop-02", "1") }],
        peakConcurrency: 0,
        endedAt: "2026-08-30T00:01:00.000Z",
      }),
    ).toThrow();

    const passIds = ["ENTRY-03"];
    const passBasis = createBasis(passIds);
    const pass = createScenario({ scenarioId: "ENTRY-03", outcome: "pass" });
    expect(() =>
      createLiveMatrixResult({
        generationBasis: passBasis,
        generationBasisReference: reference("pass-generation", "b"),
        registeredScenarioIds: passIds,
        scenarioResults: [{ result: pass, reference: reference("entry-03", "3") }],
        peakConcurrency: 0,
        endedAt: "2026-08-30T00:01:00.000Z",
      }),
    ).toThrow();
    expect(() =>
      createLiveMatrixResult({
        generationBasis: passBasis,
        generationBasisReference: reference("pass-generation", "b"),
        registeredScenarioIds: passIds,
        scenarioResults: [{ result: pass, reference: reference("entry-03", "3") }],
        peakConcurrency: 2,
        endedAt: "2026-08-30T00:01:00.000Z",
      }),
    ).toThrow("peak concurrency contradicts");
  });

  test("requires exactly one result and one durable pointer for every registered Scenario", () => {
    const scenarioIds = ["ENTRY-03", "STOP-02"];
    const basis = createBasis(scenarioIds);
    const entry = createScenario({ scenarioId: "ENTRY-03", outcome: "pass" });

    expect(() =>
      createLiveMatrixResult({
        generationBasis: basis,
        generationBasisReference: reference("generation", "a"),
        registeredScenarioIds: scenarioIds,
        scenarioResults: [{ result: entry, reference: reference("entry-03", "1") }],
        peakConcurrency: 1,
        endedAt: "2026-08-30T00:01:00.000Z",
      }),
    ).toThrow("each registered Scenario exactly once");

    const stop = createScenario({ scenarioId: "STOP-02", outcome: "pass" });
    expect(() =>
      createLiveMatrixResult({
        generationBasis: basis,
        generationBasisReference: reference("generation", "a"),
        registeredScenarioIds: scenarioIds,
        scenarioResults: [
          { result: entry, reference: reference("same", "1") },
          { result: stop, reference: reference("same", "2") },
        ],
        peakConcurrency: 2,
        endedAt: "2026-08-30T00:01:00.000Z",
      }),
    ).toThrow("result pointers must be unique");

    const sharedEvidence = [
      {
        evidenceClass: "observation" as const,
        pointer: "generation/scenarios/shared/observations/turn-01.json",
        sha256: digest("8"),
      },
    ];
    expect(() =>
      createLiveMatrixResult({
        generationBasis: basis,
        generationBasisReference: reference("generation", "a"),
        registeredScenarioIds: scenarioIds,
        scenarioResults: [
          {
            result: createScenario({
              scenarioId: "ENTRY-03",
              outcome: "pass",
              evidence: sharedEvidence,
            }),
            reference: reference("entry-03", "1"),
          },
          {
            result: createScenario({
              scenarioId: "STOP-02",
              outcome: "pass",
              evidence: sharedEvidence,
            }),
            reference: reference("stop-02", "2"),
          },
        ],
        peakConcurrency: 2,
        endedAt: "2026-08-30T00:01:00.000Z",
      }),
    ).toThrow("observation pointers must be globally unique");
  });

  test("only an all-pass release Candidate satisfies the release prerequisite", () => {
    const scenarioIds = ["ENTRY-03"];
    const basis = createBasis(scenarioIds, "release-candidate");
    const result = createScenario({ scenarioId: "ENTRY-03", outcome: "pass" });
    const matrix = createLiveMatrixResult({
      generationBasis: basis,
      generationBasisReference: reference("generation", "a"),
      registeredScenarioIds: scenarioIds,
      scenarioResults: [{ result, reference: reference("entry-03", "1") }],
      peakConcurrency: 1,
      endedAt: "2026-08-30T00:01:00.000Z",
    });

    expect(matrix).toMatchObject({
      terminalOutcome: "pass",
      releasePrerequisiteSatisfied: true,
    });
    expect(() =>
      parseLiveMatrixResultForScenarioIds(
        { ...matrix, releasePrerequisiteSatisfied: false },
        scenarioIds,
      ),
    ).toThrow("terminal summary contradicts");
  });

  test("verifies and exactly rebuilds a Matrix from its bounded durable references", async () => {
    const fixture = await writeVerifiableMatrix();

    const verified = await verifyLiveMatrixResult(fixture.matrixPath, fixture.scenarioIds);

    expect(verified.matrix).toEqual(fixture.matrix);
    expect(verified.generationBasis).toEqual(fixture.basis);
  });

  test("rejects cited result tampering and a Generation symlink that escapes the evidence root", async () => {
    const tampered = await writeVerifiableMatrix();
    await writeFile(join(tampered.root, tampered.resultPointer), "{}\n");
    await expect(verifyLiveMatrixResult(tampered.matrixPath, tampered.scenarioIds)).rejects.toThrow(
      "digest mismatch",
    );

    const escaped = await writeVerifiableMatrix();
    const outsideRoot = await mkdtemp(join(tmpdir(), "bearing-live-matrix-outside-"));
    temporaryRoots.push(outsideRoot);
    const generationBytes = await readFile(join(escaped.root, escaped.generationPointer));
    const outsideGeneration = join(outsideRoot, "generation-basis.json");
    await writeFile(outsideGeneration, generationBytes);
    await rm(join(escaped.root, escaped.generationPointer));
    await symlink(outsideGeneration, join(escaped.root, escaped.generationPointer));

    await expect(verifyLiveMatrixResult(escaped.matrixPath, escaped.scenarioIds)).rejects.toThrow(
      "escapes its Matrix evidence root",
    );
  });

  test("rejects a missing or tampered Scenario observation", async () => {
    const missing = await writeVerifiableMatrix();
    await rm(join(missing.root, missing.observationPointer));
    await expect(verifyLiveMatrixResult(missing.matrixPath, missing.scenarioIds)).rejects.toThrow();

    const tampered = await writeVerifiableMatrix();
    await writeFile(join(tampered.root, tampered.observationPointer), "{}\n");
    await expect(verifyLiveMatrixResult(tampered.matrixPath, tampered.scenarioIds)).rejects.toThrow(
      "digest mismatch",
    );
  });
});
