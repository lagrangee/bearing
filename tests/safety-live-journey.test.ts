import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertSafetyVerdictObservables,
  captureSafetyRepositoryState,
  createSafetyJourneyEvaluation,
  createSafetyJourneyObservation,
  initializeActiveSafetyRepository,
  type SafetyRepositoryState,
  verifySafetyJourneyObservation,
} from "../scripts/safety-live-journey";
import { installPackedProduct } from "./product-seams/installed-product";

const digest = (character: string): string => character.repeat(64);

const activeState: SafetyRepositoryState = {
  lifecycle: "active",
  repositoryStatusSha256: digest("a"),
  repositoryWithoutManagedSurfaceSha256: digest("a"),
  bearingDirectorySha256: digest("a"),
  manifestSha256: digest("b"),
  providerConfigurationSha256: digest("c"),
  canonicalStateSha256: digest("d"),
  cacheSha256: digest("e"),
  managedSurfaceSha256: digest("f"),
  nativeWorkSha256: digest("1"),
};

const observation = (
  turn: number,
  before: SafetyRepositoryState = activeState,
  after: SafetyRepositoryState = activeState,
) =>
  createSafetyJourneyObservation({
    turn,
    codexCliVersion: "codex-cli 0.147.0",
    exitCode: 0,
    stdout: [
      JSON.stringify({ type: "thread.started", thread_id: "private-session" }),
      JSON.stringify({ type: "turn.completed" }),
    ].join("\n"),
    stderr: "",
    before: { repository: digest("2"), agentHome: digest("3") },
    after: {
      repository: JSON.stringify(before) === JSON.stringify(after) ? digest("2") : digest("4"),
      agentHome: digest("3"),
    },
    transcriptPointer: `safety/transcripts/turn-${String(turn).padStart(2, "0")}.jsonl`,
    stderrPointer: `safety/transcripts/turn-${String(turn).padStart(2, "0")}.stderr.log`,
    safetyBefore: before,
    safetyAfter: after,
  });

describe("Safety and Lifecycle live Journey", () => {
  test("exposes the Safety support commands through the shared runner", () => {
    const result = Bun.spawnSync([process.execPath, "scripts/run-live-journey.ts", "--help"], {
      cwd: process.cwd(),
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain("prepare-safety");
    expect(result.stdout.toString()).toContain("introduce-safety-drift");
    expect(result.stdout.toString()).toContain("introduce-safety-unsupported");
    expect(result.stdout.toString()).toContain("run-safety-turn");
    expect(result.stdout.toString()).toContain("evaluate-safety");
  });

  test("keeps Agent-visible fixture content black-box and retired workflows absent", async () => {
    const fixtureRoot = "validation/live-journey/fixtures/safety-lifecycle";
    const visibleFiles = [
      "AGENTS.md",
      "CONTEXT.md",
      "README.md",
      "package.json",
      ".scratch/label-delivery/PRD.md",
      ".scratch/label-delivery/map.md",
      ".scratch/label-delivery/issues/01-update-output.md",
      ".scratch/label-delivery/issues/02-update-output.md",
      ".scratch/label-delivery/issues/03-run-failing-delivery.md",
      ".scratch/label-delivery/issues/04-complete-secondary-format.md",
    ];
    const visible = (
      await Promise.all(visibleFiles.map((file) => readFile(join(fixtureRoot, file), "utf8")))
    ).join("\n");
    expect(visible).not.toMatch(/Safety Journey|Matrix Case|pass criteria|expected commands?/iu);

    const instruction = await readFile(
      "validation/live-journey/journeys/safety-and-lifecycle.md",
      "utf8",
    );
    expect(instruction).not.toMatch(/cutover|recovery bundle|cancel-purge|generic Sync/iu);
  });

  test("prepares one real Active disposable repository with retained state", async () => {
    const product = await installPackedProduct();
    const repository = join(product.root, "safety-repository");
    try {
      await initializeActiveSafetyRepository({
        sourceRoot: process.cwd(),
        repositoryRoot: repository,
        productProgram: product.cliPath,
        productHome: product.homeDir,
      });

      const state = await captureSafetyRepositoryState({
        repositoryRoot: repository,
        productProgram: product.cliPath,
        productHome: product.homeDir,
      });
      expect(state.lifecycle).toBe("active");
      expect(state.canonicalStateSha256).toMatch(/^[0-9a-f]{64}$/u);
      expect(state.providerConfigurationSha256).toMatch(/^[0-9a-f]{64}$/u);
      expect(state.nativeWorkSha256).toMatch(/^[0-9a-f]{64}$/u);
      expect(await readFile(join(repository, ".bearing/state/retained.md"), "utf8")).toContain(
        "Retained project context",
      );
      await writeFile(
        join(repository, "AGENTS.md"),
        `${await readFile(join(repository, "AGENTS.md"), "utf8")}\n# reviewed repair\n`,
      );
      const managedSurfaceOnly = await captureSafetyRepositoryState({
        repositoryRoot: repository,
        productProgram: product.cliPath,
        productHome: product.homeDir,
      });
      expect(managedSurfaceOnly.managedSurfaceSha256).not.toBe(state.managedSurfaceSha256);
      expect(managedSurfaceOnly.repositoryWithoutManagedSurfaceSha256).toBe(
        state.repositoryWithoutManagedSurfaceSha256,
      );
      await writeFile(join(repository, "README.md"), "# unrelated change\n");
      const unrelated = await captureSafetyRepositoryState({
        repositoryRoot: repository,
        productProgram: product.cliPath,
        productHome: product.homeDir,
      });
      expect(unrelated.repositoryWithoutManagedSurfaceSha256).not.toBe(
        state.repositoryWithoutManagedSurfaceSha256,
      );
    } finally {
      await product.dispose();
    }
  }, 60_000);

  test("records lifecycle and write-boundary state as bounded observation evidence", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "bearing-safety-observation-"));
    await Promise.all([
      mkdir(join(workspace, "safety/observations"), { recursive: true }),
      mkdir(join(workspace, "safety/transcripts"), { recursive: true }),
    ]);
    const created = observation(1);
    const stdout = [
      JSON.stringify({ type: "thread.started", thread_id: "private-session" }),
      JSON.stringify({ type: "turn.completed" }),
    ].join("\n");
    await Promise.all([
      writeFile(join(workspace, "safety/transcripts/turn-01.jsonl"), stdout),
      writeFile(join(workspace, "safety/transcripts/turn-01.stderr.log"), ""),
      writeFile(join(workspace, "safety/observations/turn-01.json"), JSON.stringify(created)),
    ]);

    await expect(
      verifySafetyJourneyObservation({
        workspaceRoot: workspace,
        pointer: "safety/observations/turn-01.json",
        expectedCodexCliVersion: "codex-cli 0.147.0",
      }),
    ).resolves.toMatchObject({ safety: { before: activeState, after: activeState } });
    expect(JSON.stringify(created)).not.toContain("private-session");
  });

  test("rejects passing refusal, lifecycle, and stop verdicts that contradict hard state", () => {
    const unchanged = observation(1);
    const prerequisiteAccepted = observation(2, activeState, {
      ...activeState,
      canonicalStateSha256: digest("5"),
    });
    const repairAccepted = observation(3, activeState, {
      ...activeState,
      managedSurfaceSha256: digest("6"),
    });
    const deactivated = observation(4, activeState, {
      ...activeState,
      lifecycle: "deactivated",
      manifestSha256: digest("7"),
      cacheSha256: null,
      managedSurfaceSha256: digest("8"),
    });
    const reactivated = observation(5, deactivated.safety.after, {
      ...activeState,
      manifestSha256: digest("9"),
      cacheSha256: digest("0"),
    });
    const unsupportedState = { ...activeState, lifecycle: "unsupported" as const };
    const unsupported = observation(6, unsupportedState, unsupportedState);
    const unrelatedRepair = observation(7, activeState, {
      ...activeState,
      repositoryWithoutManagedSurfaceSha256: digest("7"),
      managedSurfaceSha256: digest("8"),
    });
    const observations = new Map([
      ["safety/observations/turn-01.json", unchanged],
      ["safety/observations/turn-02.json", prerequisiteAccepted],
      ["safety/observations/turn-03.json", repairAccepted],
      ["safety/observations/turn-04.json", deactivated],
      ["safety/observations/turn-05.json", reactivated],
      ["safety/observations/turn-06.json", unsupported],
      ["safety/observations/turn-07.json", unrelatedRepair],
    ]);
    const pointers = {
      unchanged: ["safety/observations/turn-01.json"],
      refusalAndAcceptance: [
        "safety/observations/turn-01.json",
        "safety/observations/turn-02.json",
      ],
      repair: ["safety/observations/turn-01.json", "safety/observations/turn-03.json"],
      lifecycle: ["safety/observations/turn-04.json", "safety/observations/turn-05.json"],
      unsupported: ["safety/observations/turn-06.json"],
    };
    const verdicts = [
      ["SAFETY-01", pointers.unchanged],
      ["SAFETY-02", pointers.unchanged],
      ["SAFETY-03", pointers.refusalAndAcceptance],
      ["SAFETY-04", pointers.repair],
      ["SAFETY-05", pointers.lifecycle],
      ["SAFETY-06", pointers.unchanged],
      ["SAFETY-07", pointers.unchanged],
      ["SAFETY-08", pointers.unchanged],
      ["SAFETY-09", pointers.unsupported],
    ].map(([caseId, observationPointers]) => ({
      caseId,
      outcome: "pass",
      judgmentBasis: `Observed ${caseId} with the required owner and lifecycle boundary.`,
      observationPointers,
    }));

    expect(() => assertSafetyVerdictObservables(verdicts, observations)).not.toThrow();
    expect(() =>
      assertSafetyVerdictObservables(
        verdicts.map((verdict) =>
          verdict.caseId === "SAFETY-03"
            ? { ...verdict, observationPointers: pointers.unchanged }
            : verdict,
        ),
        observations,
      ),
    ).toThrow("refusal and later accepted change");
    expect(() =>
      assertSafetyVerdictObservables(
        verdicts.map((verdict) =>
          verdict.caseId === "SAFETY-04"
            ? {
                ...verdict,
                observationPointers: [
                  "safety/observations/turn-01.json",
                  "safety/observations/turn-07.json",
                ],
              }
            : verdict,
        ),
        observations,
      ),
    ).toThrow("only the reviewed managed surface");
  });

  test("emits one bounded Coordinator-owned Safety result", () => {
    const verdicts = Array.from({ length: 9 }, (_, index) => ({
      caseId: `SAFETY-${String(index + 1).padStart(2, "0")}`,
      outcome: "pass",
      judgmentBasis: `Observed the safety boundary in turn ${index + 1}.`,
      observationPointers: [`safety/observations/turn-${String(index + 1).padStart(2, "0")}.json`],
    }));
    const result = createSafetyJourneyEvaluation({
      generationId: "00000000-0000-4000-8000-000000000012",
      candidate: {
        packageName: "@lagrangee/bearing",
        packageVersion: "0.1.1",
        sourceCommit: "a".repeat(40),
        workflow: { name: "Prepare candidate artifact", runId: "123456", runAttempt: 1 },
        artifact: {
          path: "/private/generated/candidate.tgz",
          file: "candidate.tgz",
          sha256: digest("b"),
        },
        matrixDefinitionSha256: digest("c"),
      },
      codexCliVersion: "codex-cli 0.147.0",
      coordinatorIdentity: "Codex coordinating agent",
      fixtureSha256: digest("d"),
      durationMs: 1234,
      verdicts,
    });

    expect(result.outcome).toBe("pass");
    expect(result.cases).toHaveLength(9);
    expect(JSON.stringify(result)).not.toContain("/private/generated");
  });
});
