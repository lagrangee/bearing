import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { verifyReleaseCandidate } from "./release-candidate-lib";

const parsed = parseArgs({
  args: process.argv.slice(2),
  strict: true,
  allowPositionals: false,
  tokens: true,
  options: {
    receipt: { type: "string" },
    version: { type: "string" },
    "source-commit": { type: "string" },
    "repo-root": { type: "string" },
    "workflow-name": { type: "string" },
    "workflow-run-id": { type: "string" },
    "workflow-run-attempt": { type: "string" },
  },
});
for (const name of [
  "receipt",
  "version",
  "source-commit",
  "repo-root",
  "workflow-name",
  "workflow-run-id",
  "workflow-run-attempt",
] as const) {
  if (parsed.tokens.filter((token) => token.kind === "option" && token.name === name).length > 1) {
    throw new Error(`--${name} may be provided only once`);
  }
}

const receipt = parsed.values.receipt;
if (receipt === undefined) {
  throw new Error(
    "usage: bun scripts/verify-release-candidate.ts --receipt <path> [--version <version>] [--source-commit <sha>] [--repo-root <path>] [--workflow-name <name> --workflow-run-id <id> --workflow-run-attempt <number>]",
  );
}

const version = parsed.values.version;
const sourceCommit = parsed.values["source-commit"];
const repositoryRoot = parsed.values["repo-root"];
const workflowName = parsed.values["workflow-name"];
const workflowRunId = parsed.values["workflow-run-id"];
const workflowRunAttemptText = parsed.values["workflow-run-attempt"];
const workflowOptions = [workflowName, workflowRunId, workflowRunAttemptText];
if (
  workflowOptions.some((value) => value !== undefined) &&
  workflowOptions.some((value) => value === undefined)
) {
  throw new Error(
    "--workflow-name, --workflow-run-id, and --workflow-run-attempt must be provided together",
  );
}
const expected: {
  version?: string;
  sourceCommit?: string;
  repositoryRoot?: string;
  workflowName?: string;
  workflowRunId?: string;
  workflowRunAttempt?: number;
} = {};
if (version !== undefined) expected.version = version;
if (sourceCommit !== undefined) expected.sourceCommit = sourceCommit;
if (repositoryRoot !== undefined) expected.repositoryRoot = resolve(repositoryRoot);
if (
  workflowName !== undefined &&
  workflowRunId !== undefined &&
  workflowRunAttemptText !== undefined
) {
  if (!/^[1-9][0-9]*$/u.test(workflowRunAttemptText)) {
    throw new Error("--workflow-run-attempt must be a positive integer");
  }
  const workflowRunAttempt = Number(workflowRunAttemptText);
  if (!Number.isSafeInteger(workflowRunAttempt)) {
    throw new Error("--workflow-run-attempt must be a safe positive integer");
  }
  expected.workflowName = workflowName;
  expected.workflowRunId = workflowRunId;
  expected.workflowRunAttempt = workflowRunAttempt;
}
const verified = await verifyReleaseCandidate(resolve(receipt), expected);
process.stdout.write(`${verified.artifact.file}\n`);
