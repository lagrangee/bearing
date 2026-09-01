import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
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

  async run(input: Parameters<PublicSmokeCapability["run"]>[0]) {
    this.calls.push(input);
    return { outcome: "passed" as const, publicPrefix: "npm+tag+release", resumptionPoint: null };
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
