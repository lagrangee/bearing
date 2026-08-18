import { verifyLiveScenarioMatrixResult } from "./live-scenario-generation";
import { liveScenarioDefinitionDigest } from "./live-scenario-runner";
import type { PublicReleaseSmokeOptions } from "./public-release-smoke";
import { verifyReleaseCandidate } from "./release-candidate-lib";

export const requiredReleaseComponentEffortIds = Object.freeze([
  "effort:bearing-0-1-1-project-catalog-architecture",
  "effort:bearing-0-1-1-commodity-boundary-cleanup",
  "effort:bearing-0-1-1-setup-journey-reliability",
  "effort:bearing-0-1-1-architecture-contraction",
  "effort:bearing-0-1-1-ci-validation-quality",
] as const);

export type CandidateIdentity = Readonly<{
  packageVersion: string;
  sourceCommit: string;
  workflow: Readonly<{ name: string; runId: string; runAttempt: number }>;
  frozenSha256: string;
}>;

type ComponentEffort = Readonly<{
  id: (typeof requiredReleaseComponentEffortIds)[number];
  lifecycle: "concluded" | "active" | "planned" | "unavailable";
  nativeCompletion: "current" | "missing" | "partial" | "stale" | "failed";
  candidate: CandidateIdentity;
  evidenceReference: string;
}>;

type CandidateBoundEvidence<State extends string> = Readonly<{
  state: State;
  candidate: CandidateIdentity;
  evidenceReference: string;
}>;

type CompatibilityResult =
  | Readonly<{ outcome: "missing" }>
  | Readonly<{
      outcome: "pass" | "fail" | "anomaly";
      candidate: CandidateIdentity;
      detail?: string;
    }>;

type KnownException = Readonly<{
  summary: string;
  disposition: "compatible" | "contradicts-prerequisite";
  candidate: CandidateIdentity;
  evidenceReference: string;
}>;

export type ReleaseOperatorInput = Readonly<{
  candidateReceiptPath: string;
  matrixResultPath: string;
  componentEfforts: readonly ComponentEffort[];
  releaseContent: CandidateBoundEvidence<"current" | "missing" | "partial" | "stale" | "failed">;
  boundedCiCleanup: CandidateBoundEvidence<"current" | "missing" | "partial" | "stale" | "failed">;
  humanCompatibility: Readonly<{
    claudeCode: CompatibilityResult;
    workBuddy: CompatibilityResult;
  }>;
  knownExceptions: CandidateBoundEvidence<"current" | "missing" | "partial" | "stale" | "failed"> &
    Readonly<{ items: readonly KnownException[] }>;
  continuation?: PublicationContinuation;
}>;

export type PublicationDispatch = Readonly<{
  workflow: ".github/workflows/publish.yml";
  ref: "main";
  scope: "@lagrangee/bearing";
  target: "npm+github-release";
  semantics: "frozen-publication-v1";
  inputs: Readonly<{
    version: string;
    source_commit: string;
    candidate_workflow_name: string;
    candidate_run_id: string;
    candidate_run_attempt: string;
    frozen_sha256: string;
  }>;
}>;

export type PublicationContinuation = Readonly<{
  request: PublicationDispatch;
  workflowRunId: string;
  environmentApproval: "pending" | "approved";
}>;

export type PublicationOutcome =
  | Readonly<{
      state: "waiting-for-environment-approval";
      workflowRunId: string;
      monotonicPrefix: "none";
      environmentApproval: "pending";
    }>
  | Readonly<{
      state: "succeeded";
      workflowRunId: string;
      monotonicPrefix: "npm+installed-package-smoke+tag+release";
      environmentApproval: "approved";
    }>
  | Readonly<{
      state: "partial" | "failed";
      workflowRunId: string;
      monotonicPrefix: string;
      resumptionPoint: string;
      detail: string;
      environmentApproval: "approved" | "not-approved";
    }>;

export interface ProtectedPublicationCapability {
  dispatch(request: PublicationDispatch): Promise<PublicationOutcome>;
  continue(
    continuation: PublicationContinuation,
    request: PublicationDispatch,
  ): Promise<PublicationOutcome>;
}

type PublicSmokeResult = Readonly<{
  outcome: "passed" | "incomplete";
  publicPrefix: string;
  resumptionPoint: string | null;
}>;

export interface PublicSmokeCapability {
  run(input: PublicReleaseSmokeOptions): Promise<PublicSmokeResult>;
}

const dispatchFromReceipt = (identity: CandidateIdentity): PublicationDispatch =>
  Object.freeze({
    workflow: ".github/workflows/publish.yml",
    ref: "main",
    scope: "@lagrangee/bearing",
    target: "npm+github-release",
    semantics: "frozen-publication-v1",
    inputs: Object.freeze({
      version: identity.packageVersion,
      source_commit: identity.sourceCommit,
      candidate_workflow_name: identity.workflow.name,
      candidate_run_id: identity.workflow.runId,
      candidate_run_attempt: String(identity.workflow.runAttempt),
      frozen_sha256: identity.frozenSha256,
    }),
  });

const sameDispatch = (left: PublicationDispatch, right: PublicationDispatch): boolean =>
  left.workflow === right.workflow &&
  left.ref === right.ref &&
  left.scope === right.scope &&
  left.target === right.target &&
  left.semantics === right.semantics &&
  left.inputs.version === right.inputs.version &&
  left.inputs.source_commit === right.inputs.source_commit &&
  left.inputs.candidate_workflow_name === right.inputs.candidate_workflow_name &&
  left.inputs.candidate_run_id === right.inputs.candidate_run_id &&
  left.inputs.candidate_run_attempt === right.inputs.candidate_run_attempt &&
  left.inputs.frozen_sha256 === right.inputs.frozen_sha256;

const sameCandidateIdentity = (left: CandidateIdentity, right: CandidateIdentity): boolean =>
  left.packageVersion === right.packageVersion &&
  left.sourceCommit === right.sourceCommit &&
  left.workflow.name === right.workflow.name &&
  left.workflow.runId === right.workflow.runId &&
  left.workflow.runAttempt === right.workflow.runAttempt &&
  left.frozenSha256 === right.frozenSha256;

type RetainedEvidence = Readonly<{
  candidateProof?: Readonly<{ state: "verified" | "invalid"; identity?: CandidateIdentity }>;
  componentReadiness?: Readonly<{ state: "ready" | "blocked" }>;
  matrix?: Readonly<{ state: "pass" | "not-pass" | "invalid"; generationId?: string }>;
  humanCompatibility?: Readonly<{ state: "pass" | "blocked" }>;
}>;

const blocked = (input: {
  stage: string;
  reason: string;
  owner: string;
  resumptionPoint: string;
  retainedEvidence?: RetainedEvidence;
  unchanged?: Readonly<{ publication: string; publicSmoke: string }>;
}) =>
  Object.freeze({
    outcome: "blocked" as const,
    blocker: Object.freeze({
      stage: input.stage,
      reason: input.reason,
      owner: input.owner,
      resumptionPoint: input.resumptionPoint,
    }),
    humanGo: "not-requested" as const,
    retainedEvidence: Object.freeze(input.retainedEvidence ?? {}),
    unchanged: Object.freeze(
      input.unchanged ?? {
        publication: "not-dispatched" as const,
        publicSmoke: "not-run" as const,
      },
    ),
    authority: Object.freeze({ effortConclusion: false as const, gatePassage: false as const }),
  });

const componentBlocker = (
  componentEfforts: readonly ComponentEffort[],
  identity: CandidateIdentity,
  candidateProof: NonNullable<RetainedEvidence["candidateProof"]>,
) => {
  for (const id of requiredReleaseComponentEffortIds) {
    const matches = componentEfforts.filter((effort) => effort.id === id);
    if (matches.length !== 1) {
      return blocked({
        stage: "component-readiness",
        reason: `Required component Effort inspection is not uniquely available: ${id}.`,
        owner: id,
        resumptionPoint: `inspect:${id}`,
        retainedEvidence: { candidateProof, componentReadiness: { state: "blocked" } },
      });
    }
    const effort = matches[0];
    if (effort?.lifecycle !== "concluded") {
      return blocked({
        stage: "component-readiness",
        reason: `Canonical Effort lifecycle is ${effort?.lifecycle ?? "unavailable"}: ${id}.`,
        owner: id,
        resumptionPoint: `conclude:${id}`,
        retainedEvidence: { candidateProof, componentReadiness: { state: "blocked" } },
      });
    }
    if (effort.nativeCompletion !== "current") {
      return blocked({
        stage: "component-readiness",
        reason: `Native completion evidence is ${effort.nativeCompletion}: ${id}.`,
        owner: id,
        resumptionPoint: `refresh-native-completion:${id}`,
        retainedEvidence: { candidateProof, componentReadiness: { state: "blocked" } },
      });
    }
    if (
      !sameCandidateIdentity(effort.candidate, identity) ||
      effort.evidenceReference.trim().length === 0
    ) {
      return blocked({
        stage: "candidate-identity",
        reason: `Component readiness evidence does not bind the exact Candidate: ${id}.`,
        owner: id,
        resumptionPoint: `refresh-exact-candidate-evidence:${id}`,
        retainedEvidence: { candidateProof, componentReadiness: { state: "blocked" } },
      });
    }
  }
  if (componentEfforts.length !== requiredReleaseComponentEffortIds.length) {
    return blocked({
      stage: "component-readiness",
      reason: "Component Effort inspection contains an unexpected entry.",
      owner: "live-journey-coordinating-agent",
      resumptionPoint: "inspect-required-component-efforts",
      retainedEvidence: { candidateProof, componentReadiness: { state: "blocked" } },
    });
  }
  return null;
};

export const runReleaseOperator = async (
  input: ReleaseOperatorInput,
  capabilities: Readonly<{
    publication: ProtectedPublicationCapability;
    publicSmoke: PublicSmokeCapability;
  }>,
) => {
  const receiptResult = await verifyReleaseCandidate(input.candidateReceiptPath).then(
    (value) => ({ value }) as const,
    (error: unknown) => ({ error }) as const,
  );
  if ("error" in receiptResult) {
    return blocked({
      stage: "candidate-proof",
      reason: `Candidate Receipt verification failed: ${receiptResult.error instanceof Error ? receiptResult.error.message : String(receiptResult.error)}`,
      owner: "ci-and-release-automation",
      resumptionPoint: "verify-candidate-receipt",
      retainedEvidence: { candidateProof: { state: "invalid" } },
    });
  }
  const receipt = receiptResult.value;
  const identity = Object.freeze({
    packageVersion: receipt.packageVersion,
    sourceCommit: receipt.sourceCommit,
    workflow: Object.freeze(receipt.workflow),
    frozenSha256: receipt.artifact.sha256,
  });
  const candidateProof = Object.freeze({ state: "verified" as const, identity });
  const componentFailure = componentBlocker(input.componentEfforts, identity, candidateProof);
  if (componentFailure !== null) return componentFailure;
  const componentReadiness = Object.freeze({ state: "ready" as const });
  if (
    input.releaseContent.state !== "current" ||
    !sameCandidateIdentity(input.releaseContent.candidate, identity) ||
    input.releaseContent.evidenceReference.trim().length === 0
  ) {
    return blocked({
      stage: input.releaseContent.state === "current" ? "candidate-identity" : "release-content",
      reason: `Release-facing content evidence is ${input.releaseContent.state} or does not bind the exact Candidate.`,
      owner: "release-content-owner",
      resumptionPoint: "finalize-release-facing-content",
      retainedEvidence: { candidateProof, componentReadiness },
    });
  }
  if (
    input.boundedCiCleanup.state !== "current" ||
    !sameCandidateIdentity(input.boundedCiCleanup.candidate, identity) ||
    input.boundedCiCleanup.evidenceReference.trim().length === 0
  ) {
    return blocked({
      stage:
        input.boundedCiCleanup.state === "current" ? "candidate-identity" : "bounded-ci-cleanup",
      reason: `Six-context CI cleanup evidence is ${input.boundedCiCleanup.state} or does not bind the exact Candidate.`,
      owner: "ci-and-release-automation",
      resumptionPoint: "refresh-six-context-ci-evidence",
      retainedEvidence: { candidateProof, componentReadiness },
    });
  }
  const matrixResult = await verifyLiveScenarioMatrixResult(input.matrixResultPath).then(
    (value) => ({ value }) as const,
    (error: unknown) => ({ error }) as const,
  );
  if ("error" in matrixResult) {
    return blocked({
      stage: "matrix",
      reason: `Matrix result validation failed: ${matrixResult.error instanceof Error ? matrixResult.error.message : String(matrixResult.error)}`,
      owner: "live-journey-coordinating-agent",
      resumptionPoint: "regenerate-complete-matrix-result",
      retainedEvidence: { candidateProof, componentReadiness, matrix: { state: "invalid" } },
    });
  }
  const matrix = matrixResult.value;
  const currentMatrixDefinitionSha256 = await liveScenarioDefinitionDigest({
    sourceRoot: process.cwd(),
    registryPath: "validation/live-journey/registry.json",
  });
  if (
    matrix.evidenceClass !== "release-candidate" ||
    matrix.package.evidenceClass !== "release-candidate" ||
    matrix.terminalOutcome !== "pass" ||
    matrix.releasePrerequisiteSatisfied !== true ||
    matrix.scenarios.some((scenario) => scenario.outcome !== "pass") ||
    matrix.matrixDefinitionSha256 !== currentMatrixDefinitionSha256
  ) {
    return blocked({
      stage: "matrix",
      reason: "The complete Scenario Matrix is not one all-pass release prerequisite.",
      owner: "live-journey-coordinating-agent",
      resumptionPoint: "complete-one-passing-matrix-generation",
      retainedEvidence: {
        candidateProof,
        componentReadiness,
        matrix: { state: "not-pass", generationId: matrix.generationId },
      },
    });
  }
  const matrixIdentity: CandidateIdentity = {
    packageVersion: matrix.package.packageVersion,
    sourceCommit: matrix.package.sourceCommit,
    workflow: matrix.package.workflow,
    frozenSha256: matrix.package.artifact.sha256,
  };
  if (!sameCandidateIdentity(matrixIdentity, identity)) {
    return blocked({
      stage: "candidate-identity",
      reason: "Matrix result identity does not match the verified Candidate Receipt.",
      owner: "live-journey-coordinating-agent",
      resumptionPoint: "restart-candidate-freeze-and-full-matrix",
      retainedEvidence: {
        candidateProof,
        componentReadiness,
        matrix: { state: "invalid", generationId: matrix.generationId },
      },
    });
  }
  const matrixEvidence = Object.freeze({
    state: "pass" as const,
    generationId: matrix.generationId,
  });
  const lanes = [
    ["claude-code", input.humanCompatibility.claudeCode],
    ["workbuddy", input.humanCompatibility.workBuddy],
  ] as const;
  for (const [name, lane] of lanes) {
    if (lane.outcome === "missing") {
      return blocked({
        stage: "human-compatibility",
        reason: `Human result is missing: ${name}.`,
        owner: "human",
        resumptionPoint: `collect:${name}`,
        retainedEvidence: {
          candidateProof,
          componentReadiness,
          matrix: matrixEvidence,
          humanCompatibility: { state: "blocked" },
        },
      });
    }
    if (!sameCandidateIdentity(lane.candidate, identity)) {
      return blocked({
        stage: "candidate-identity",
        reason: `Human compatibility result uses another Candidate: ${name}.`,
        owner: "human",
        resumptionPoint: `rerun:${name}-with-exact-candidate`,
        retainedEvidence: {
          candidateProof,
          componentReadiness,
          matrix: matrixEvidence,
          humanCompatibility: { state: "blocked" },
        },
      });
    }
    if (lane.outcome !== "pass") {
      return blocked({
        stage: "human-compatibility",
        reason: `Human compatibility result is ${lane.outcome}: ${name}.`,
        owner: "human",
        resumptionPoint: `resolve:${name}`,
        retainedEvidence: {
          candidateProof,
          componentReadiness,
          matrix: matrixEvidence,
          humanCompatibility: { state: "blocked" },
        },
      });
    }
  }
  const humanCompatibilityEvidence = Object.freeze({ state: "pass" as const });
  if (
    input.knownExceptions.state !== "current" ||
    !sameCandidateIdentity(input.knownExceptions.candidate, identity) ||
    input.knownExceptions.evidenceReference.trim().length === 0
  ) {
    return blocked({
      stage: input.knownExceptions.state === "current" ? "candidate-identity" : "known-exceptions",
      reason: `Known Exceptions evidence is ${input.knownExceptions.state} or does not bind the exact Candidate.`,
      owner: "known-exception-owner",
      resumptionPoint: "refresh-known-exceptions-for-exact-candidate",
      retainedEvidence: {
        candidateProof,
        componentReadiness,
        matrix: matrixEvidence,
        humanCompatibility: humanCompatibilityEvidence,
      },
    });
  }
  const mismatchedException = input.knownExceptions.items.find(
    (exception) =>
      !sameCandidateIdentity(exception.candidate, identity) ||
      exception.evidenceReference.trim().length === 0,
  );
  if (mismatchedException !== undefined) {
    return blocked({
      stage: "candidate-identity",
      reason: `Known Exception does not bind the exact Candidate: ${mismatchedException.summary}`,
      owner: "known-exception-owner",
      resumptionPoint: "refresh-known-exceptions-for-exact-candidate",
      retainedEvidence: {
        candidateProof,
        componentReadiness,
        matrix: matrixEvidence,
        humanCompatibility: humanCompatibilityEvidence,
      },
    });
  }
  const contradictingException = input.knownExceptions.items.find(
    ({ disposition }) => disposition === "contradicts-prerequisite",
  );
  if (contradictingException !== undefined) {
    return blocked({
      stage: "known-exceptions",
      reason: `Known Exception contradicts a release prerequisite: ${contradictingException.summary}`,
      owner: "known-exception-owner",
      resumptionPoint: "resolve-contradicting-known-exception",
      retainedEvidence: {
        candidateProof,
        componentReadiness,
        matrix: matrixEvidence,
        humanCompatibility: humanCompatibilityEvidence,
      },
    });
  }
  const dispatch = dispatchFromReceipt(identity);
  const reusableContinuation =
    input.continuation !== undefined &&
    /^[1-9][0-9]*$/u.test(input.continuation.workflowRunId) &&
    sameDispatch(input.continuation.request, dispatch);
  const publication = reusableContinuation
    ? await capabilities.publication.continue(input.continuation, dispatch)
    : await capabilities.publication.dispatch(dispatch);
  if (reusableContinuation && publication.workflowRunId !== input.continuation?.workflowRunId) {
    return blocked({
      stage: "publication",
      reason: "Publication continuation did not observe the authorized workflow run.",
      owner: "ci-and-release-automation",
      resumptionPoint: `observe-publication-run:${input.continuation?.workflowRunId ?? "unknown"}`,
      retainedEvidence: {
        candidateProof,
        componentReadiness,
        matrix: matrixEvidence,
        humanCompatibility: humanCompatibilityEvidence,
      },
      unchanged: {
        publication: "existing-run-unverified",
        publicSmoke: "not-run",
      },
    });
  }
  const publicSmoke =
    publication.state === "succeeded"
      ? await capabilities.publicSmoke.run({
          candidateReceipt: input.candidateReceiptPath,
          version: receipt.packageVersion,
          sourceCommit: receipt.sourceCommit,
          workflowName: receipt.workflow.name,
          workflowRunId: receipt.workflow.runId,
          workflowRunAttempt: receipt.workflow.runAttempt,
          frozenSha256: receipt.artifact.sha256,
        })
      : null;
  const outcome =
    publication.state === "waiting-for-environment-approval"
      ? ("awaiting-human-go" as const)
      : publication.state === "partial" || publication.state === "failed"
        ? ("publication-incomplete" as const)
        : publicSmoke?.outcome === "passed"
          ? ("ready-for-gate-review" as const)
          : ("public-readback-incomplete" as const);
  const publicationBlocker =
    publication.state === "waiting-for-environment-approval"
      ? Object.freeze({
          stage: "publication",
          reason: "The protected Publication workflow is waiting for its environment approval.",
          owner: "human",
          resumptionPoint: "protected-environment-approval",
          unchanged: Object.freeze({
            publication: `waiting:${publication.workflowRunId}`,
            publicSmoke: "not-run",
          }),
        })
      : publication.state === "partial" || publication.state === "failed"
        ? Object.freeze({
            stage: "publication",
            reason: publication.detail,
            owner: "ci-and-release-automation",
            resumptionPoint: publication.resumptionPoint,
            unchanged: Object.freeze({
              publication: publication.monotonicPrefix,
              publicSmoke: "not-run",
            }),
          })
        : publicSmoke?.outcome === "incomplete"
          ? Object.freeze({
              stage: "public-readback",
              reason: `Public readback stopped after ${publicSmoke.publicPrefix}.`,
              owner: "live-journey-coordinating-agent",
              resumptionPoint: publicSmoke.resumptionPoint ?? "public-readback",
              unchanged: Object.freeze({
                publication: publication.monotonicPrefix,
                publicSmoke: publicSmoke.publicPrefix,
              }),
            })
          : null;
  const continuation =
    publication.environmentApproval === "not-approved"
      ? null
      : Object.freeze({
          request: dispatch,
          workflowRunId: publication.workflowRunId,
          environmentApproval: publication.environmentApproval,
        });
  return Object.freeze({
    outcome,
    ...(publicationBlocker === null ? {} : { blocker: publicationBlocker }),
    humanGo: "protected-environment-only" as const,
    continuation,
    authorization: Object.freeze({
      mode: reusableContinuation ? ("retained" as const) : ("fresh" as const),
      environmentApproval: publication.environmentApproval,
      duplicateApprovalRequested: false as const,
    }),
    handoff: Object.freeze({
      componentReadiness: Object.freeze({
        state: "ready" as const,
        efforts: input.componentEfforts,
        releaseContent: input.releaseContent,
        boundedCiCleanup: input.boundedCiCleanup,
      }),
      candidateProof,
      matrix: matrixEvidence,
      humanCompatibility: Object.freeze({
        ...humanCompatibilityEvidence,
        ...input.humanCompatibility,
      }),
      publication,
      publicSmoke,
      knownExceptions: input.knownExceptions,
    }),
    authority: Object.freeze({ effortConclusion: false as const, gatePassage: false as const }),
  });
};
