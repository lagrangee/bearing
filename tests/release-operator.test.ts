import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
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
    releaseNotes: { file: "release-notes.md", sha256: sha256Bytes(Buffer.from(releaseNotes)) },
  };
  const receiptPath = join(root, "candidate-receipt.json");
  await Promise.all([
    writeFile(join(root, receipt.manifest.file), manifestText),
    writeFile(join(root, receipt.releaseNotes.file), releaseNotes),
    writeFile(receiptPath, serializeCandidateJson(receipt)),
  ]);
  return { receipt, receiptPath };
};

const readyInput = async (): Promise<ReleaseOperatorInput> => {
  const fixture = await makeCandidate();
  const identity = {
    packageVersion: fixture.receipt.packageVersion,
    sourceCommit: fixture.receipt.sourceCommit,
    workflow: fixture.receipt.workflow,
    frozenSha256: fixture.receipt.artifact.sha256,
  };
  return {
    candidateReceiptPath: fixture.receiptPath,
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
  readonly continuations: Array<{
    continuation: PublicationContinuation;
    request: PublicationDispatch;
  }> = [];

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
      publicPrefix: "npm+tag+release",
      resumptionPoint: null,
    },
  ) {}

  async run(input: Parameters<PublicSmokeCapability["run"]>[0]) {
    this.calls.push(input);
    return this.result;
  }
}

test("dispatches publication from exact candidate evidence without deriving authority from Matrix", async () => {
  const input = await readyInput();
  const publication = new FakePublication();
  const publicSmoke = new FakePublicSmoke();
  const result = await runReleaseOperator(input, { publication, publicSmoke });

  expect(publication.dispatches).toHaveLength(1);
  expect(publicSmoke.calls).toHaveLength(1);
  expect(result).toMatchObject({
    outcome: "ready-for-gate-review",
    handoff: {
      candidateProof: { state: "verified" },
      humanCompatibility: { state: "pass" },
      publication: { state: "succeeded" },
    },
    authority: { effortConclusion: false, gatePassage: false },
  });
  if (!("handoff" in result)) throw new Error("ready result has no handoff");
  expect(result.handoff).not.toHaveProperty("matrix");
});

test("contains no Matrix release prerequisite or result-path input", async () => {
  const source = await readFile(resolve(import.meta.dir, "../scripts/release-operator.ts"), "utf8");
  expect(source).not.toContain("matrixResultPath");
  expect(source).not.toContain("verifyLiveMatrixResult");
  expect(source).not.toContain("releasePrerequisiteSatisfied");
});

test("blocks invalid candidate proof before publication", async () => {
  const input = await readyInput();
  await writeFile(input.candidateReceiptPath, "{}\n");
  const publication = new FakePublication();
  const publicSmoke = new FakePublicSmoke();
  const result = await runReleaseOperator(input, { publication, publicSmoke });
  expect(result).toMatchObject({
    outcome: "blocked",
    blocker: { stage: "candidate-proof", resumptionPoint: "verify-candidate-receipt" },
  });
  expect(publication.dispatches).toEqual([]);
});

test("blocks stale component and missing human evidence independently of Matrix", async () => {
  const input = await readyInput();
  const stale = {
    ...input,
    componentEfforts: input.componentEfforts.map((effort, index) =>
      index === 0 ? { ...effort, nativeCompletion: "stale" as const } : effort,
    ),
  };
  const publication = new FakePublication();
  const publicSmoke = new FakePublicSmoke();
  const result = await runReleaseOperator(stale, { publication, publicSmoke });
  expect(result).toMatchObject({ outcome: "blocked", blocker: { stage: "component-readiness" } });
  expect(publication.dispatches).toEqual([]);
});

test("preserves exact Human compatibility and known-exception stop boundaries", async () => {
  const baseline = await readyInput();
  const passed = baseline.humanCompatibility.claudeCode;
  if (passed.outcome !== "pass") throw new Error("Expected a passing Human fixture.");
  const anotherCandidate = { ...passed.candidate, frozenSha256: "f".repeat(64) };
  const cases = [
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
            candidate: passed.candidate,
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
          workBuddy: { outcome: "pass" as const, candidate: anotherCandidate },
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
              candidate: passed.candidate,
              evidenceReference: "known-exception:installation-route",
            },
          ],
        },
      },
      stage: "known-exceptions",
      resumptionPoint: "resolve-contradicting-known-exception",
    },
  ] as const;

  for (const scenario of cases) {
    const publication = new FakePublication();
    const publicSmoke = new FakePublicSmoke();
    const result = await runReleaseOperator(scenario.input, { publication, publicSmoke });
    expect(result).toMatchObject({
      outcome: "blocked",
      blocker: { stage: scenario.stage, resumptionPoint: scenario.resumptionPoint },
      humanGo: "not-requested",
      unchanged: { publication: "not-dispatched", publicSmoke: "not-run" },
    });
    expect(publication.dispatches).toEqual([]);
    expect(publicSmoke.calls).toEqual([]);
  }
});

test("preserves waiting, partial, and failed Publication outcomes without public readback", async () => {
  const input = await readyInput();
  const cases = [
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

  for (const scenario of cases) {
    const publication = new FakePublication(scenario.publication);
    const publicSmoke = new FakePublicSmoke();
    const result = await runReleaseOperator(input, { publication, publicSmoke });
    expect(result).toMatchObject({
      outcome: scenario.outcome,
      blocker: { stage: "publication", resumptionPoint: scenario.resumptionPoint },
      handoff: { publication: { state: scenario.publication.state }, publicSmoke: null },
      authority: { effortConclusion: false, gatePassage: false },
    });
    expect(publicSmoke.calls).toEqual([]);
  }
});

test("reports incomplete public readback separately from successful Publication", async () => {
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
  });
  expect(publication.dispatches).toHaveLength(1);
  expect(publicSmoke.calls).toHaveLength(1);
});

test("continues only the same Publication authorization boundary", async () => {
  const input = await readyInput();
  const waiting = {
    state: "waiting-for-environment-approval" as const,
    workflowRunId: "654321",
    monotonicPrefix: "none" as const,
    environmentApproval: "pending" as const,
  };
  const initial = await runReleaseOperator(input, {
    publication: new FakePublication(waiting),
    publicSmoke: new FakePublicSmoke(),
  });
  if (!("continuation" in initial) || initial.continuation === null) {
    throw new Error("Expected a Publication continuation.");
  }

  const retained = new FakePublication(waiting);
  const continued = await runReleaseOperator(
    { ...input, continuation: initial.continuation },
    { publication: retained, publicSmoke: new FakePublicSmoke() },
  );
  expect(retained.dispatches).toEqual([]);
  expect(retained.continuations).toHaveLength(1);
  expect(continued).toMatchObject({
    authorization: { mode: "retained", duplicateApprovalRequested: false },
  });

  const drifted: PublicationContinuation = {
    ...initial.continuation,
    request: {
      ...initial.continuation.request,
      inputs: { ...initial.continuation.request.inputs, candidate_run_id: "999999" },
    },
  };
  const fresh = new FakePublication(waiting);
  const restarted = await runReleaseOperator(
    { ...input, continuation: drifted },
    { publication: fresh, publicSmoke: new FakePublicSmoke() },
  );
  expect(fresh.continuations).toEqual([]);
  expect(fresh.dispatches).toHaveLength(1);
  expect(restarted).toMatchObject({ authorization: { mode: "fresh" } });

  const mismatchedRun = await runReleaseOperator(
    { ...input, continuation: initial.continuation },
    {
      publication: new FakePublication({ ...waiting, workflowRunId: "999999" }),
      publicSmoke: new FakePublicSmoke(),
    },
  );
  expect(mismatchedRun).toMatchObject({
    outcome: "blocked",
    blocker: {
      stage: "publication",
      resumptionPoint: "observe-publication-run:654321",
    },
    unchanged: { publication: "existing-run-unverified", publicSmoke: "not-run" },
  });
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
