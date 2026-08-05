import { createCodexE2EEvidenceRecord } from "./codex-e2e-runtime";
import { surfaceLaunchContract } from "./g1-live-fixture";

export const SETUP_RELIABILITY_PLAN_ID = "bearing-0.1.1-setup-reliability-v1";

export const SETUP_RELIABILITY_CASES = [
  {
    id: "nominate-accept-orientation",
    executorDecision: "nominate",
    continuation: "direct",
    orientationDecision: "accept",
  },
  {
    id: "invalid-then-skip-decline-orientation",
    executorDecision: "invalid-then-skip",
    continuation: "direct",
    orientationDecision: "decline",
  },
  {
    id: "skip-after-assisted-prerequisite",
    executorDecision: "skip",
    continuation: "assisted-prerequisite",
    orientationDecision: "accept",
  },
] as const;

type FreshOrientationOfferInput = Readonly<{
  journey: "fresh" | "active" | "reactivation" | "cutover" | "catalog-recovery";
  outcome: "applied" | "no-op" | "partial" | "blocked" | "cancelled";
  catalogResultReported: boolean;
  portalHandoff: "compatible" | "incompatible" | "absent" | null;
}>;

export const freshOrientationOfferEligible = (input: FreshOrientationOfferInput): boolean =>
  input.journey === "fresh" &&
  input.outcome === "applied" &&
  input.catalogResultReported &&
  input.portalHandoff !== null;

export const setupReliabilityLaunchContract = (input: {
  codexProgram: string;
  repositoryRoot: string;
  isolatedHome: string;
  codexHome: string;
  disabledOperatorSkillPaths: readonly string[];
}) => {
  const launch = surfaceLaunchContract({ surface: "codex", ...input });
  return Object.freeze({
    ...launch,
    initial: Object.freeze({ ...launch.initial, program: input.codexProgram }),
    resume: Object.freeze({ ...launch.resume, program: input.codexProgram }),
  });
};

type CandidateIdentity = Readonly<{
  sourceCommit: string;
  packageFile: string;
  packageSha256: string;
}>;

type CaseEvidence = Readonly<{
  id: (typeof SETUP_RELIABILITY_CASES)[number]["id"];
  candidate: CandidateIdentity;
  terminalBoundary: string;
}>;

const sameCandidate = (left: CandidateIdentity, right: CandidateIdentity): boolean =>
  left.sourceCommit === right.sourceCommit &&
  left.packageFile === right.packageFile &&
  left.packageSha256 === right.packageSha256;

export const createSetupReliabilityEvidence = (
  input: Readonly<{
    codexCliVersion: string;
    candidate: CandidateIdentity;
    cases: readonly CaseEvidence[];
  }>,
) => {
  if (
    input.cases.length !== SETUP_RELIABILITY_CASES.length ||
    input.cases.some((entry) => !sameCandidate(input.candidate, entry.candidate))
  ) {
    throw new Error("Every Setup Reliability journey must use the same exact candidate.");
  }
  const caseIds = new Set(input.cases.map((entry) => entry.id));
  if (
    caseIds.size !== SETUP_RELIABILITY_CASES.length ||
    SETUP_RELIABILITY_CASES.some(({ id }) => !caseIds.has(id))
  ) {
    throw new Error("Setup Reliability evidence requires each required matrix case exactly once.");
  }

  const records = input.cases.map((entry) =>
    createCodexE2EEvidenceRecord({
      sourceCommit: entry.candidate.sourceCommit,
      packageFile: entry.candidate.packageFile,
      packageSha256: entry.candidate.packageSha256,
      codexCliVersion: input.codexCliVersion,
      invocationStarted: true,
      terminalBoundary: entry.terminalBoundary,
    }),
  );
  const first = records[0];
  if (first === undefined) throw new Error("Setup Reliability evidence requires matrix cases.");

  return Object.freeze({
    schemaVersion: 1,
    planId: SETUP_RELIABILITY_PLAN_ID,
    candidate: Object.freeze({
      sourceCommit: input.candidate.sourceCommit,
      package: Object.freeze({
        file: input.candidate.packageFile,
        sha256: input.candidate.packageSha256,
      }),
    }),
    codex: Object.freeze({
      cliVersion: first.codex.cliVersion,
      requestedModel: first.codex.requestedModel,
      requestedReasoningEffort: first.codex.requestedReasoningEffort,
    }),
    cases: Object.freeze(
      input.cases.map((entry) =>
        Object.freeze({ id: entry.id, terminalBoundary: entry.terminalBoundary }),
      ),
    ),
  });
};
