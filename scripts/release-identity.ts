const exactReleaseCommit = /^[0-9a-f]{40}$/u;

export const assertExactReleaseCommit = (value: string, label: string): void => {
  if (!exactReleaseCommit.test(value)) {
    throw new Error(`${label} must be an exact 40-character lowercase commit`);
  }
};

export const releaseCandidateId = (
  packageName: string,
  packageVersion: string,
  sourceCommit: string,
  artifactSha256: string,
  workflowRunId: string,
  workflowRunAttempt: number,
): string =>
  `${packageName}@${packageVersion}:${sourceCommit}:${artifactSha256}:run-${workflowRunId}-${workflowRunAttempt}`;
