import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertJourneyRerunEligibility,
  createLiveJourneyGenerationResult,
  liveJourneyCaseIds,
} from "../scripts/live-journey-generation";

const generationId = "00000000-0000-4000-8000-000000000013";
const sha256 = (value: string) => value.repeat(64);
const candidate = {
  packageName: "@lagrangee/bearing" as const,
  packageVersion: "0.1.1",
  sourceCommit: "a".repeat(40),
  workflow: { name: "Prepare candidate artifact", runId: "123456", runAttempt: 1 },
  artifact: { file: "candidate.tgz", sha256: sha256("b") },
  matrixDefinitionSha256: sha256("c"),
};
const codex = {
  cliVersion: "codex-cli 0.147.0",
  requestedModel: "gpt-5.6-luna" as const,
  requestedReasoningEffort: "high" as const,
};
const journeyResult = (
  journey: string,
  outcomes: Readonly<Record<string, "pass" | "fail" | "blocked" | "not-run">> = {},
) => {
  const required = liveJourneyCaseIds[journey];
  if (required === undefined) throw new Error(`Unknown test Journey: ${journey}.`);
  const cases = required.map((caseId, index) => {
    const outcome = outcomes[caseId] ?? ("pass" as const);
    return {
      caseId,
      outcome,
      judgmentBasis: `Observed the required boundary in turn ${index + 1}.`,
      observationPointers: [
        `${journey}/observations/turn-${String(index + 1).padStart(2, "0")}.json`,
      ],
      ...(outcome === "fail"
        ? { failurePointer: `${journey}/failures/${caseId.toLowerCase()}.json` }
        : {}),
      ...(outcome === "blocked"
        ? { block: { reason: "network" as const, testedBehaviorStarted: false as const } }
        : {}),
    };
  });
  return {
    schemaVersion: 1 as const,
    generationId,
    journey,
    candidate,
    codex,
    coordinatorIdentity: "Codex coordinating agent",
    fixtureSha256: sha256(String(Object.keys(liveJourneyCaseIds).indexOf(journey))),
    durationMs: 1000,
    outcome: cases.every(({ outcome }) => outcome === "pass")
      ? ("pass" as const)
      : ("not-pass" as const),
    cases,
  };
};

const reference = (result: ReturnType<typeof journeyResult>, index: number) => ({
  result,
  pointer: `journey-results/${result.journey}.json`,
  sha256: String(index).repeat(64),
});

const completeInput = () => ({
  journeyResults: (
    [
      journeyResult("clean-installation-and-local-loop"),
      journeyResult("github-and-active-reconciliation"),
      journeyResult("safety-and-lifecycle"),
    ] as const
  ).map(reference),
});

const requiredAt = <Value>(values: readonly Value[], index: number): Value => {
  const value = values.at(index);
  if (value === undefined) throw new Error(`Required test value is unavailable at ${index}.`);
  return value;
};

describe("one coherent Live Journey Matrix generation", () => {
  test("binds all three Journeys and 18 Coordinator verdicts into one result", () => {
    const result = createLiveJourneyGenerationResult(completeInput());

    expect(result.generationId).toBe(generationId);
    expect(result.candidate).toEqual(candidate);
    expect(result.matrixDefinitionSha256).toBe(candidate.matrixDefinitionSha256);
    expect(result.codex).toEqual(codex);
    expect(result.coordinatorIdentity).toBe("Codex coordinating agent");
    expect(result.semanticEvaluationAuthority).toBe("coordinating-agent");
    expect(result.journeys).toHaveLength(3);
    expect(result.cases).toHaveLength(18);
    expect(result.durationMs).toBe(3000);
    expect(result.terminalOutcome).toBe("pass");
    expect(result.releasePrerequisiteSatisfied).toBe(true);
    expect(result.cases.find(({ caseId }) => caseId === "CLEAN-01")).toMatchObject({
      journey: "clean-installation-and-local-loop",
      outcome: "pass",
    });
  });

  test("writes the only Matrix result through the shared support runner", async () => {
    const root = await mkdtemp(join(tmpdir(), "bearing-live-generation-result-"));
    const paths = {
      clean: join(root, "clean.json"),
      github: join(root, "github.json"),
      safety: join(root, "safety.json"),
      output: join(root, "matrix-result.json"),
      gitleaks: join(root, "gitleaks"),
    };
    await writeFile(
      paths.gitleaks,
      '#!/bin/sh\nif [ "$1" = "version" ]; then echo 8.30.1; exit 0; fi\ninput=$(cat)\ncase "$input" in *ghp_secret_value*) exit 1;; *) exit 0;; esac\n',
    );
    await chmod(paths.gitleaks, 0o700);
    await Promise.all([
      writeFile(paths.clean, JSON.stringify(journeyResult("clean-installation-and-local-loop"))),
      writeFile(paths.github, JSON.stringify(journeyResult("github-and-active-reconciliation"))),
      writeFile(paths.safety, JSON.stringify(journeyResult("safety-and-lifecycle"))),
    ]);

    const run = Bun.spawnSync(
      [
        process.execPath,
        "scripts/run-live-journey.ts",
        "complete-matrix",
        "--clean-result",
        paths.clean,
        "--github-result",
        paths.github,
        "--safety-result",
        paths.safety,
        "--output",
        paths.output,
      ],
      {
        cwd: process.cwd(),
        env: { ...process.env, PATH: `${root}:${process.env["PATH"] ?? ""}` },
        stdout: "pipe",
        stderr: "pipe",
      },
    );

    expect(run.exitCode).toBe(0);
    expect(JSON.parse(run.stdout.toString())).toMatchObject({ outcome: "pass", cases: 18 });
    expect(JSON.parse(await readFile(paths.output, "utf8"))).toMatchObject({
      generationId,
      terminalOutcome: "pass",
      releasePrerequisiteSatisfied: true,
    });

    const unsafeClean = journeyResult("clean-installation-and-local-loop");
    requiredAt(unsafeClean.cases, 0).judgmentBasis = "Observed token=ghp_secret_value.";
    await writeFile(paths.clean, JSON.stringify(unsafeClean));
    const unsafeOutput = join(root, "unsafe-matrix-result.json");
    const rejected = Bun.spawnSync(
      [
        process.execPath,
        "scripts/run-live-journey.ts",
        "complete-matrix",
        "--clean-result",
        paths.clean,
        "--github-result",
        paths.github,
        "--safety-result",
        paths.safety,
        "--output",
        unsafeOutput,
      ],
      {
        cwd: process.cwd(),
        env: { ...process.env, PATH: `${root}:${process.env["PATH"] ?? ""}` },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    expect(rejected.exitCode).toBe(1);
    await expect(readFile(unsafeOutput, "utf8")).rejects.toThrow();
  });

  test("requires all 18 Cases to pass and preserves fail and not-run judgments", () => {
    const input = completeInput();
    input.journeyResults[0] = reference(
      journeyResult("clean-installation-and-local-loop", {
        "CLEAN-03": "fail",
        "CLEAN-04": "not-run",
        "CLEAN-05": "not-run",
      }),
      1,
    );
    const result = createLiveJourneyGenerationResult(input);

    expect(result.terminalOutcome).toBe("not-pass");
    expect(result.releasePrerequisiteSatisfied).toBe(false);
    expect(result.cases.find(({ caseId }) => caseId === "CLEAN-03")).toMatchObject({
      outcome: "fail",
      failurePointer: "clean-installation-and-local-loop/failures/clean-03.json",
    });
    expect(result.cases.find(({ caseId }) => caseId === "CLEAN-04")?.outcome).toBe("not-run");
  });

  test("rejects cross-generation stitching and inconsistent Candidate or evaluation identity", () => {
    const changedGeneration = completeInput();
    const changedGenerationReference = requiredAt(changedGeneration.journeyResults, 1);
    changedGenerationReference.result = {
      ...changedGenerationReference.result,
      generationId: "00000000-0000-4000-8000-000000000099",
    };
    expect(() => createLiveJourneyGenerationResult(changedGeneration)).toThrow(
      "same Matrix generation",
    );

    const changedCandidate = completeInput();
    const changedCandidateReference = requiredAt(changedCandidate.journeyResults, 2);
    changedCandidateReference.result = {
      ...changedCandidateReference.result,
      candidate: { ...candidate, sourceCommit: "d".repeat(40) },
    };
    expect(() => createLiveJourneyGenerationResult(changedCandidate)).toThrow(
      "same Candidate identity",
    );

    const changedCoordinator = completeInput();
    const changedCoordinatorReference = requiredAt(changedCoordinator.journeyResults, 0);
    changedCoordinatorReference.result = {
      ...changedCoordinatorReference.result,
      coordinatorIdentity: "independent judge agent",
    };
    expect(() => createLiveJourneyGenerationResult(changedCoordinator)).toThrow(
      "same Coordinator identity",
    );
  });

  test("rejects incomplete, duplicate, self-contradictory, or sensitive durable results", () => {
    expect(() =>
      createLiveJourneyGenerationResult({
        journeyResults: completeInput().journeyResults.slice(0, 2),
      }),
    ).toThrow("each Journey exactly once");

    const contradictory = completeInput();
    const contradictoryReference = requiredAt(contradictory.journeyResults, 0);
    contradictoryReference.result = {
      ...contradictoryReference.result,
      outcome: "not-pass",
    };
    expect(() => createLiveJourneyGenerationResult(contradictory)).toThrow(
      "Journey outcome contradicts",
    );

    const privatePath = completeInput();
    const privatePathReference = requiredAt(privatePath.journeyResults, 0);
    const privatePathCase = requiredAt(privatePathReference.result.cases, 0);
    privatePathReference.result.cases[0] = {
      ...privatePathCase,
      judgmentBasis: "Observed /Users/example/private-repository/config.json.",
    };
    expect(() => createLiveJourneyGenerationResult(privatePath)).toThrow();

    const credentialField = completeInput();
    const credentialReference = requiredAt(credentialField.journeyResults, 0);
    const credentialCase = requiredAt(credentialReference.result.cases, 0);
    credentialReference.result.cases[0] = {
      ...credentialCase,
      credential: "secret-value",
    } as (typeof credentialField.journeyResults)[0]["result"]["cases"][number];
    expect(() => createLiveJourneyGenerationResult(credentialField)).toThrow();

    const absoluteFailure = completeInput();
    const absoluteFailureReference = requiredAt(absoluteFailure.journeyResults, 0);
    const absoluteFailureCase = requiredAt(absoluteFailureReference.result.cases, 0);
    absoluteFailureReference.result.cases[0] = {
      ...absoluteFailureCase,
      outcome: "fail",
      failurePointer: "/private/failure.json",
    };
    absoluteFailureReference.result.outcome = "not-pass";
    expect(() => createLiveJourneyGenerationResult(absoluteFailure)).toThrow();

    for (const pointer of [
      "private/codex-session.json",
      "private/Transcripts/full.jsonl",
      "private/operator-config/settings.json",
    ]) {
      const forbiddenEvidence = completeInput();
      const forbiddenReference = requiredAt(forbiddenEvidence.journeyResults, 0);
      const forbiddenCase = requiredAt(forbiddenReference.result.cases, 0);
      forbiddenReference.result.cases[0] = {
        ...forbiddenCase,
        observationPointers: [pointer],
      };
      expect(() => createLiveJourneyGenerationResult(forbiddenEvidence)).toThrow();
    }
  });

  test("allows only a pre-behavior infrastructure block to rerun on a fresh fixture", () => {
    const input = completeInput();
    input.journeyResults[2] = reference(
      journeyResult("safety-and-lifecycle", {
        "SAFETY-01": "blocked",
        "SAFETY-02": "not-run",
        "SAFETY-03": "not-run",
        "SAFETY-04": "not-run",
        "SAFETY-05": "not-run",
        "SAFETY-06": "not-run",
        "SAFETY-07": "not-run",
        "SAFETY-08": "not-run",
        "SAFETY-09": "not-run",
      }),
      3,
    );
    const generation = createLiveJourneyGenerationResult(input);
    const rerun = {
      generation,
      journey: "safety-and-lifecycle" as const,
      freshFixtureSha256: sha256("e"),
      candidate,
      matrixDefinitionSha256: candidate.matrixDefinitionSha256,
    };

    expect(assertJourneyRerunEligibility(rerun)).toEqual({
      generationId,
      journey: "safety-and-lifecycle",
      reason: "network",
      freshFixtureSha256: sha256("e"),
    });
    expect(() =>
      assertJourneyRerunEligibility({
        ...rerun,
        freshFixtureSha256: requiredAt(generation.journeys, 2).fixtureSha256,
      }),
    ).toThrow("fresh fixture");
    expect(() =>
      assertJourneyRerunEligibility({
        ...rerun,
        candidate: { ...candidate, sourceCommit: "f".repeat(40) },
      }),
    ).toThrow("same Candidate");

    const semanticFailure = completeInput();
    semanticFailure.journeyResults[2] = reference(
      journeyResult("safety-and-lifecycle", { "SAFETY-06": "fail" }),
      3,
    );
    expect(() =>
      assertJourneyRerunEligibility({
        ...rerun,
        generation: createLiveJourneyGenerationResult(semanticFailure),
      }),
    ).toThrow("semantic outcomes");
  });

  test("keeps the generation runner separate from historical wrappers and public package bytes", async () => {
    const [runner, packageMetadata] = await Promise.all([
      readFile("scripts/run-live-journey.ts", "utf8"),
      readFile("package.json", "utf8").then((value) => JSON.parse(value)),
    ]);
    expect(runner).not.toContain("g1-live-fixture");
    expect(runner).not.toContain("setup-reliability-matrix");
    expect(runner).not.toContain("architecture-contraction-candidate");
    expect(packageMetadata.files).not.toContain("scripts");
    expect(packageMetadata.files).not.toContain("validation");
  });

  test("keeps the current Matrix as the only live release harness", () => {
    const retiredImplementation = [
      "scripts/g1-live-fixture.ts",
      "scripts/setup-reliability-matrix.ts",
      "tests/g1-live-fixture.test.ts",
      "tests/setup-reliability-matrix.test.ts",
    ];
    expect(retiredImplementation.filter(existsSync)).toEqual([]);

    const consumers = Bun.spawnSync(
      [
        "git",
        "grep",
        "--no-index",
        "--fixed-strings",
        "--line-number",
        "-e",
        "g1-live-fixture",
        "-e",
        "setup-reliability-matrix",
        "--",
        "package.json",
        ".github",
        "scripts",
        "browser-tests",
        "validation",
      ],
      { cwd: process.cwd(), stdout: "pipe", stderr: "pipe" },
    );
    expect(consumers.stdout.toString()).toBe("");
    expect(consumers.exitCode).toBe(1);
  });
});
