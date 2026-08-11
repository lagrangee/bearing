import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { liveJourneyCaseIds } from "../scripts/live-journey-generation";
import { requiredPackagePaths } from "../scripts/release-boundary";
import {
  type CandidateManifest,
  type CandidateReceipt,
  releaseCandidateId,
  serializeCandidateJson,
  sha256Bytes,
} from "../scripts/release-candidate-lib";
import {
  type ProtectedPublicationCapability,
  type PublicationContinuation,
  type PublicationDispatch,
  type PublicSmokeCapability,
  type ReleaseOperatorInput,
  requiredReleaseComponentEffortIds,
  runReleaseOperator,
} from "../scripts/release-operator";
import { writeTarGzFixture } from "./release-archive-fixture";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

const makeCandidate = async () => {
  const root = await mkdtemp(join(tmpdir(), "bearing-release-operator-"));
  temporaryRoots.push(root);
  const packageName = "@lagrangee/bearing";
  const packageVersion = "0.1.1";
  const sourceCommit = "a".repeat(40);
  const workflow = { name: "Prepare candidate artifact", runId: "123456", runAttempt: 2 };
  const packageFiles: Record<string, string> = Object.fromEntries(
    requiredPackagePaths.map((path) => [path, `fixture for ${path}\n`]),
  );
  packageFiles["package.json"] =
    `${JSON.stringify({ name: packageName, version: packageVersion })}\n`;
  packageFiles["dist/extra.js"] = "export {};\n";
  const artifactPath = join(root, `lagrangee-bearing-${packageVersion}.tgz`);
  await writeTarGzFixture(
    artifactPath,
    Object.entries(packageFiles).map(([path, bytes]) => ({
      path: `package/${path}`,
      bytes,
      mode: 0o644,
    })),
  );
  const manifest: CandidateManifest = {
    schemaVersion: 2,
    packageName,
    packageVersion,
    sourceCommit,
    files: Object.entries(packageFiles)
      .map(([path, bytes]) => ({ path, size: Buffer.byteLength(bytes), mode: 0o644 }))
      .sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0)),
  };
  const manifestText = serializeCandidateJson(manifest);
  const releaseNotes = "Frozen release notes.\n";
  const artifact = await readFile(artifactPath);
  const artifactSha256 = sha256Bytes(artifact);
  const receipt: CandidateReceipt = {
    schemaVersion: 2,
    packageName,
    packageVersion,
    sourceCommit,
    candidateId: releaseCandidateId(
      packageName,
      packageVersion,
      sourceCommit,
      artifactSha256,
      workflow.runId,
      workflow.runAttempt,
    ),
    workflow,
    toolchain: { node: "v24.15.0", bun: "1.3.8", npm: "11.11.0" },
    artifact: {
      file: `lagrangee-bearing-${packageVersion}.tgz`,
      size: artifact.byteLength,
      sha256: artifactSha256,
      npmIntegrity: `sha512-${createHash("sha512").update(artifact).digest("base64")}`,
      npmShasum: createHash("sha1").update(artifact).digest("hex"),
    },
    manifest: { file: "candidate-manifest.json", sha256: sha256Bytes(Buffer.from(manifestText)) },
    releaseNotes: {
      file: "release-notes.md",
      sha256: sha256Bytes(Buffer.from(releaseNotes)),
    },
  };
  const receiptPath = join(root, "candidate-receipt.json");
  await Promise.all([
    writeFile(join(root, receipt.manifest.file), manifestText),
    writeFile(join(root, receipt.releaseNotes.file), releaseNotes),
    writeFile(receiptPath, serializeCandidateJson(receipt)),
  ]);
  return { root, receipt, receiptPath };
};

const matrixResult = (receipt: CandidateReceipt) => {
  const candidate = {
    packageName: receipt.packageName,
    packageVersion: receipt.packageVersion,
    sourceCommit: receipt.sourceCommit,
    workflow: receipt.workflow,
    artifact: { file: receipt.artifact.file, sha256: receipt.artifact.sha256 },
    matrixDefinitionSha256: "b".repeat(64),
  } as const;
  const journeys = Object.entries(liveJourneyCaseIds).map(([journey, caseIds], journeyIndex) => ({
    journey,
    outcome: "pass" as const,
    durationMs: 1000,
    fixtureSha256: String(journeyIndex).repeat(64),
    result: { pointer: `journey-results/${journey}.json`, sha256: "c".repeat(64) },
    caseIds,
  }));
  return {
    schemaVersion: 1 as const,
    generationId: "00000000-0000-4000-8000-000000000016",
    candidate,
    matrixDefinitionSha256: candidate.matrixDefinitionSha256,
    codex: {
      cliVersion: "codex-cli 0.147.0",
      requestedModel: "gpt-5.6-luna" as const,
      requestedReasoningEffort: "high" as const,
    },
    coordinatorIdentity: "Codex coordinating agent",
    semanticEvaluationAuthority: "coordinating-agent" as const,
    durationMs: 3000,
    terminalOutcome: "pass" as const,
    releasePrerequisiteSatisfied: true,
    journeys: journeys.map(({ caseIds: _caseIds, ...journey }) => journey),
    cases: journeys.flatMap(({ journey, caseIds }) =>
      caseIds.map((caseId) => ({
        caseId,
        journey,
        outcome: "pass" as const,
        judgmentBasis: `Observed ${caseId}.`,
        evidencePointers: [`${journey}/observations/${caseId.toLowerCase()}.json`],
      })),
    ),
  };
};

const readyInput = async (): Promise<ReleaseOperatorInput> => {
  const fixture = await makeCandidate();
  const matrixResultPath = join(fixture.root, "matrix-result.json");
  await writeFile(matrixResultPath, serializeCandidateJson(matrixResult(fixture.receipt)));
  const identity = {
    packageVersion: fixture.receipt.packageVersion,
    sourceCommit: fixture.receipt.sourceCommit,
    workflow: fixture.receipt.workflow,
    frozenSha256: fixture.receipt.artifact.sha256,
  };
  return {
    candidateReceiptPath: fixture.receiptPath,
    matrixResultPath,
    componentEfforts: requiredReleaseComponentEffortIds.map((id) => ({
      id,
      lifecycle: "concluded",
      nativeCompletion: "current",
      candidate: identity,
      evidenceReference: `typed-inspect:${id}`,
    })),
    releaseContent: {
      state: "current",
      candidate: identity,
      evidenceReference: "source-review:release-facing-content",
    },
    boundedCiCleanup: {
      state: "current",
      candidate: identity,
      evidenceReference: "ci:six-context-cleanup",
    },
    humanCompatibility: {
      claudeCode: { outcome: "pass", candidate: identity },
      workBuddy: { outcome: "pass", candidate: identity },
    },
    knownExceptions: {
      state: "current",
      candidate: identity,
      evidenceReference: "known-exceptions:confirmed-empty",
      items: [],
    },
  };
};

class FakePublication implements ProtectedPublicationCapability {
  readonly dispatches: PublicationDispatch[] = [];
  readonly continuations: {
    continuation: PublicationContinuation;
    request: PublicationDispatch;
  }[] = [];

  constructor(
    private readonly outcome: Awaited<ReturnType<ProtectedPublicationCapability["dispatch"]>> = {
      state: "succeeded",
      workflowRunId: "654321",
      monotonicPrefix: "npm+installed-package-smoke+tag+release",
      environmentApproval: "approved",
    },
  ) {}

  async dispatch(request: PublicationDispatch) {
    this.dispatches.push(request);
    return this.outcome;
  }

  async continue(continuation: PublicationContinuation, request: PublicationDispatch) {
    this.continuations.push({ continuation, request });
    return this.outcome;
  }
}

class FakePublicSmoke implements PublicSmokeCapability {
  readonly calls: Parameters<PublicSmokeCapability["run"]>[0][] = [];

  constructor(
    private readonly result: Awaited<ReturnType<PublicSmokeCapability["run"]>> = {
      outcome: "passed",
      publicPrefix: "npm+tag+release+pages+user-entry",
      resumptionPoint: null,
    },
  ) {}

  async run(input: Parameters<PublicSmokeCapability["run"]>[0]) {
    this.calls.push(input);
    return this.result;
  }
}

test("dispatches the protected main Publication from exact receipt identity and enters public smoke", async () => {
  const input = await readyInput();
  const publication = new FakePublication();
  const publicSmoke = new FakePublicSmoke();

  const result = await runReleaseOperator(input, { publication, publicSmoke });

  expect(publication.dispatches).toEqual([
    {
      workflow: ".github/workflows/publish.yml",
      ref: "main",
      scope: "@lagrangee/bearing",
      target: "npm+github-release",
      semantics: "frozen-publication-v1",
      inputs: {
        version: "0.1.1",
        source_commit: "a".repeat(40),
        candidate_workflow_name: "Prepare candidate artifact",
        candidate_run_id: "123456",
        candidate_run_attempt: "2",
        frozen_sha256: expect.stringMatching(/^[0-9a-f]{64}$/u),
      },
    },
  ]);
  expect(publication.dispatches[0]?.inputs).not.toHaveProperty("confirm");
  expect(publicSmoke.calls).toEqual([
    {
      candidateReceipt: input.candidateReceiptPath,
      version: "0.1.1",
      sourceCommit: "a".repeat(40),
      workflowName: "Prepare candidate artifact",
      workflowRunId: "123456",
      workflowRunAttempt: 2,
      frozenSha256: expect.stringMatching(/^[0-9a-f]{64}$/u),
    },
  ]);
  expect(result).toMatchObject({
    outcome: "ready-for-gate-review",
    humanGo: "protected-environment-only",
    handoff: {
      componentReadiness: { state: "ready" },
      candidateProof: { state: "verified" },
      matrix: { state: "pass" },
      humanCompatibility: { state: "pass" },
      publication: { state: "succeeded" },
      publicSmoke: { outcome: "passed" },
      knownExceptions: { state: "current", items: [] },
    },
    authority: { effortConclusion: false, gatePassage: false },
  });
});

test("stops on non-canonical, incomplete, or non-current release prerequisites", async () => {
  const baseline = await readyInput();
  const firstEffort = requiredReleaseComponentEffortIds[0];
  const scenarios: readonly Readonly<{
    input: ReleaseOperatorInput;
    stage: string;
    resumptionPoint: string;
  }>[] = [
    {
      input: {
        ...baseline,
        componentEfforts: baseline.componentEfforts.map((effort) =>
          effort.id === firstEffort ? { ...effort, lifecycle: "active" as const } : effort,
        ),
      },
      stage: "component-readiness",
      resumptionPoint: `conclude:${firstEffort}`,
    },
    {
      input: {
        ...baseline,
        componentEfforts: baseline.componentEfforts.map((effort) =>
          effort.id === firstEffort ? { ...effort, nativeCompletion: "stale" as const } : effort,
        ),
      },
      stage: "component-readiness",
      resumptionPoint: `refresh-native-completion:${firstEffort}`,
    },
    {
      input: { ...baseline, componentEfforts: baseline.componentEfforts.slice(1) },
      stage: "component-readiness",
      resumptionPoint: `inspect:${firstEffort}`,
    },
    {
      input: { ...baseline, releaseContent: { ...baseline.releaseContent, state: "partial" } },
      stage: "release-content",
      resumptionPoint: "finalize-release-facing-content",
    },
    {
      input: { ...baseline, boundedCiCleanup: { ...baseline.boundedCiCleanup, state: "stale" } },
      stage: "bounded-ci-cleanup",
      resumptionPoint: "refresh-six-context-ci-evidence",
    },
    {
      input: {
        ...baseline,
        componentEfforts: baseline.componentEfforts.map((effort, index) =>
          index === 0
            ? {
                ...effort,
                candidate: { ...effort.candidate, frozenSha256: "f".repeat(64) },
              }
            : effort,
        ),
      },
      stage: "candidate-identity",
      resumptionPoint: `refresh-exact-candidate-evidence:${firstEffort}`,
    },
  ];

  for (const scenario of scenarios) {
    const publication = new FakePublication();
    const publicSmoke = new FakePublicSmoke();

    const result = await runReleaseOperator(scenario.input, { publication, publicSmoke });

    expect(result).toMatchObject({
      outcome: "blocked",
      blocker: { stage: scenario.stage, resumptionPoint: scenario.resumptionPoint },
      humanGo: "not-requested",
      authority: { effortConclusion: false, gatePassage: false },
    });
    expect(publication.dispatches).toEqual([]);
    expect(publicSmoke.calls).toEqual([]);
  }
});

test("rejects a non-passing or identity-mismatched Matrix before Publication dispatch", async () => {
  const baseline = await readyInput();
  const originalMatrix = JSON.parse(await readFile(baseline.matrixResultPath, "utf8")) as Record<
    string,
    unknown
  >;
  const duplicateCases = structuredClone(originalMatrix["cases"] as unknown[]);
  duplicateCases[duplicateCases.length - 1] = duplicateCases[0];
  const nonPassingCases = structuredClone(originalMatrix["cases"] as Record<string, unknown>[]);
  const failedCase = nonPassingCases[0];
  if (failedCase === undefined) throw new Error("Matrix fixture has no Cases");
  failedCase["outcome"] = "fail";
  const nonPassingJourneys = structuredClone(
    originalMatrix["journeys"] as Record<string, unknown>[],
  );
  const failedJourney = nonPassingJourneys.find(({ journey }) => journey === failedCase["journey"]);
  if (failedJourney === undefined) throw new Error("Matrix fixture has no matching Journey");
  failedJourney["outcome"] = "not-pass";
  const scenarios = [
    {
      matrix: {
        ...originalMatrix,
        journeys: nonPassingJourneys,
        cases: nonPassingCases,
        terminalOutcome: "not-pass",
        releasePrerequisiteSatisfied: false,
      },
      stage: "matrix",
      resumptionPoint: "complete-one-passing-matrix-generation",
    },
    {
      matrix: {
        ...originalMatrix,
        candidate: {
          ...(originalMatrix["candidate"] as Record<string, unknown>),
          sourceCommit: "d".repeat(40),
        },
      },
      stage: "candidate-identity",
      resumptionPoint: "restart-candidate-freeze-and-full-matrix",
    },
    {
      matrix: { ...originalMatrix, cases: duplicateCases },
      stage: "matrix",
      resumptionPoint: "regenerate-complete-matrix-result",
    },
  ] as const;

  for (const [index, scenario] of scenarios.entries()) {
    const path = join(temporaryRoots[0] ?? tmpdir(), `matrix-scenario-${index}.json`);
    await writeFile(path, serializeCandidateJson(scenario.matrix));
    const publication = new FakePublication();
    const publicSmoke = new FakePublicSmoke();

    const result = await runReleaseOperator(
      { ...baseline, matrixResultPath: path },
      { publication, publicSmoke },
    );

    expect(result).toMatchObject({
      outcome: "blocked",
      blocker: { stage: scenario.stage, resumptionPoint: scenario.resumptionPoint },
    });
    expect(publication.dispatches).toEqual([]);
    expect(publicSmoke.calls).toEqual([]);
  }
});

test("requires both Human compatibility passes for the same Candidate and compatible exceptions", async () => {
  const baseline = await readyInput();
  const passedClaude = baseline.humanCompatibility.claudeCode;
  if (passedClaude.outcome !== "pass") throw new Error("ready fixture is not a Claude Code pass");
  const mismatchedCandidate = { ...passedClaude.candidate, frozenSha256: "f".repeat(64) };
  const scenarios = [
    {
      input: {
        ...baseline,
        humanCompatibility: {
          ...baseline.humanCompatibility,
          claudeCode: { outcome: "missing" as const },
        },
      },
      stage: "human-compatibility",
      resumptionPoint: "collect:claude-code",
    },
    {
      input: {
        ...baseline,
        humanCompatibility: {
          ...baseline.humanCompatibility,
          workBuddy: {
            outcome: "anomaly" as const,
            candidate: passedClaude.candidate,
            detail: "Desktop stopped before readback.",
          },
        },
      },
      stage: "human-compatibility",
      resumptionPoint: "resolve:workbuddy",
    },
    {
      input: {
        ...baseline,
        humanCompatibility: {
          ...baseline.humanCompatibility,
          workBuddy: { outcome: "pass" as const, candidate: mismatchedCandidate },
        },
      },
      stage: "candidate-identity",
      resumptionPoint: "rerun:workbuddy-with-exact-candidate",
    },
    {
      input: {
        ...baseline,
        knownExceptions: {
          ...baseline.knownExceptions,
          items: [
            {
              summary: "Required installation route is unavailable.",
              disposition: "contradicts-prerequisite" as const,
              candidate: passedClaude.candidate,
              evidenceReference: "known-exception:installation-route",
            },
          ],
        },
      },
      stage: "known-exceptions",
      resumptionPoint: "resolve-contradicting-known-exception",
    },
    {
      input: {
        ...baseline,
        knownExceptions: { ...baseline.knownExceptions, state: "stale" as const },
      },
      stage: "known-exceptions",
      resumptionPoint: "refresh-known-exceptions-for-exact-candidate",
    },
    {
      input: {
        ...baseline,
        knownExceptions: {
          ...baseline.knownExceptions,
          candidate: mismatchedCandidate,
        },
      },
      stage: "candidate-identity",
      resumptionPoint: "refresh-known-exceptions-for-exact-candidate",
    },
  ] as const;

  for (const scenario of scenarios) {
    const publication = new FakePublication();
    const publicSmoke = new FakePublicSmoke();
    const result = await runReleaseOperator(scenario.input, { publication, publicSmoke });

    expect(result).toMatchObject({
      outcome: "blocked",
      blocker: { stage: scenario.stage, resumptionPoint: scenario.resumptionPoint },
      humanGo: "not-requested",
      unchanged: { publication: "not-dispatched", publicSmoke: "not-run" },
      retainedEvidence: {
        candidateProof: { state: "verified" },
        componentReadiness: { state: "ready" },
        matrix: { state: "pass" },
      },
    });
    expect(publication.dispatches).toEqual([]);
    expect(publicSmoke.calls).toEqual([]);
  }
});

test("turns invalid Candidate proof or Matrix evidence into exact blockers", async () => {
  const candidateInput = await readyInput();
  await writeFile(candidateInput.candidateReceiptPath, "{}\n");
  const invalidMatrixInput = await readyInput();
  await writeFile(invalidMatrixInput.matrixResultPath, "{}\n");
  const scenarios = [
    {
      input: candidateInput,
      stage: "candidate-proof",
      resumptionPoint: "verify-candidate-receipt",
    },
    {
      input: invalidMatrixInput,
      stage: "matrix",
      resumptionPoint: "regenerate-complete-matrix-result",
    },
  ] as const;

  for (const scenario of scenarios) {
    const publication = new FakePublication();
    const publicSmoke = new FakePublicSmoke();
    const result = await runReleaseOperator(scenario.input, { publication, publicSmoke });

    expect(result).toMatchObject({
      outcome: "blocked",
      blocker: { stage: scenario.stage, resumptionPoint: scenario.resumptionPoint },
    });
    expect(publication.dispatches).toEqual([]);
    expect(publicSmoke.calls).toEqual([]);
  }
});

test("preserves waiting, partial, and failed Publication outcomes without public readback", async () => {
  const input = await readyInput();
  const scenarios = [
    {
      publication: {
        state: "waiting-for-environment-approval" as const,
        workflowRunId: "654321",
        monotonicPrefix: "none" as const,
        environmentApproval: "pending" as const,
      },
      outcome: "awaiting-human-go",
      resumptionPoint: "protected-environment-approval",
    },
    {
      publication: {
        state: "partial" as const,
        workflowRunId: "654322",
        monotonicPrefix: "npm+installed-package-smoke",
        resumptionPoint: "immutable-tag",
        detail: "Tag creation was unavailable.",
        environmentApproval: "approved" as const,
      },
      outcome: "publication-incomplete",
      resumptionPoint: "immutable-tag",
    },
    {
      publication: {
        state: "failed" as const,
        workflowRunId: "654323",
        monotonicPrefix: "none",
        resumptionPoint: "npm",
        detail: "Registry state was unverifiable.",
        environmentApproval: "approved" as const,
      },
      outcome: "publication-incomplete",
      resumptionPoint: "npm",
    },
  ] as const;

  for (const scenario of scenarios) {
    const publication = new FakePublication(scenario.publication);
    const publicSmoke = new FakePublicSmoke();

    const result = await runReleaseOperator(input, { publication, publicSmoke });

    expect(result).toMatchObject({
      outcome: scenario.outcome,
      blocker: { stage: "publication", resumptionPoint: scenario.resumptionPoint },
      handoff: {
        publication: {
          state: scenario.publication.state,
          monotonicPrefix: scenario.publication.monotonicPrefix,
        },
        publicSmoke: null,
      },
      authority: { effortConclusion: false, gatePassage: false },
    });
    expect(publicSmoke.calls).toEqual([]);
  }
});

test("reports a successful Publication and incomplete public smoke as separate outcomes", async () => {
  const input = await readyInput();
  const publication = new FakePublication();
  const publicSmoke = new FakePublicSmoke({
    outcome: "incomplete",
    publicPrefix: "npm+tag+release",
    resumptionPoint: "pages",
  });

  const result = await runReleaseOperator(input, { publication, publicSmoke });

  expect(result).toMatchObject({
    outcome: "public-readback-incomplete",
    blocker: { stage: "public-readback", resumptionPoint: "pages" },
    handoff: {
      publication: { state: "succeeded" },
      publicSmoke: { outcome: "incomplete", publicPrefix: "npm+tag+release" },
    },
    authority: { effortConclusion: false, gatePassage: false },
  });
  expect(publication.dispatches).toHaveLength(1);
  expect(publicSmoke.calls).toHaveLength(1);
});

test("continues only the same authorization boundary and requires fresh approval after material drift", async () => {
  const baseline = await readyInput();
  const waiting = {
    state: "waiting-for-environment-approval" as const,
    workflowRunId: "654321",
    monotonicPrefix: "none" as const,
    environmentApproval: "pending" as const,
  };
  const initial = await runReleaseOperator(baseline, {
    publication: new FakePublication(waiting),
    publicSmoke: new FakePublicSmoke(),
  });
  if (!("continuation" in initial) || initial.continuation === null) {
    throw new Error("ready fixture did not produce a Publication continuation");
  }

  const continuation = new FakePublication(waiting);
  const continued = await runReleaseOperator(
    { ...baseline, continuation: initial.continuation },
    { publication: continuation, publicSmoke: new FakePublicSmoke() },
  );
  expect(continuation.dispatches).toEqual([]);
  expect(continuation.continuations).toHaveLength(1);
  expect(continued).toMatchObject({
    authorization: {
      mode: "retained",
      environmentApproval: "pending",
      duplicateApprovalRequested: false,
    },
  });

  const driftedContinuation: PublicationContinuation = {
    ...initial.continuation,
    request: {
      ...initial.continuation.request,
      inputs: { ...initial.continuation.request.inputs, candidate_run_id: "999999" },
    },
  };
  const fresh = new FakePublication(waiting);
  const restarted = await runReleaseOperator(
    { ...baseline, continuation: driftedContinuation },
    { publication: fresh, publicSmoke: new FakePublicSmoke() },
  );
  expect(fresh.continuations).toEqual([]);
  expect(fresh.dispatches).toHaveLength(1);
  expect(restarted).toMatchObject({
    authorization: {
      mode: "fresh",
      environmentApproval: "pending",
      duplicateApprovalRequested: false,
    },
  });
});

test("blocks when continuation observes a different Publication workflow run", async () => {
  const baseline = await readyInput();
  const waiting = {
    state: "waiting-for-environment-approval" as const,
    workflowRunId: "654321",
    monotonicPrefix: "none" as const,
    environmentApproval: "pending" as const,
  };
  const initial = await runReleaseOperator(baseline, {
    publication: new FakePublication(waiting),
    publicSmoke: new FakePublicSmoke(),
  });
  if (!("continuation" in initial) || initial.continuation === null) {
    throw new Error("ready fixture did not produce a Publication continuation");
  }
  const publicSmoke = new FakePublicSmoke();
  const result = await runReleaseOperator(
    { ...baseline, continuation: initial.continuation },
    {
      publication: new FakePublication({ ...waiting, workflowRunId: "999999" }),
      publicSmoke,
    },
  );

  expect(result).toMatchObject({
    outcome: "blocked",
    blocker: {
      stage: "publication",
      owner: "ci-and-release-automation",
      resumptionPoint: "observe-publication-run:654321",
    },
    unchanged: { publication: "existing-run-unverified", publicSmoke: "not-run" },
    retainedEvidence: {
      candidateProof: { state: "verified" },
      componentReadiness: { state: "ready" },
      matrix: { state: "pass" },
      humanCompatibility: { state: "pass" },
    },
  });
  expect(publicSmoke.calls).toEqual([]);
});

test("targets one protected main Publication workflow with no duplicate approval input", async () => {
  const workflow = parseYaml(await readFile(".github/workflows/publish.yml", "utf8")) as {
    on: { workflow_dispatch: { inputs: Record<string, unknown> } };
    jobs: { publish: { environment: string; if?: string } };
  };

  expect(Object.keys(workflow.on.workflow_dispatch.inputs)).toEqual([
    "version",
    "source_commit",
    "candidate_workflow_name",
    "candidate_run_id",
    "candidate_run_attempt",
    "frozen_sha256",
  ]);
  expect(workflow.jobs.publish.environment).toBe("npm-publish");
  expect(workflow.jobs.publish.if).toBeUndefined();
  await expect(readFile(".github/workflows/publish-preview.yml", "utf8")).rejects.toThrow();
});
