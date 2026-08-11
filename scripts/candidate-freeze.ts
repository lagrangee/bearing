import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { assertExactReleaseCommit } from "./release-identity";

export const requiredCandidateContexts = Object.freeze([
  "Source Quality",
  "Safety",
  "Runtime Compatibility (Node 24)",
  "Runtime Compatibility (Node 26)",
  "Browser Behavior",
  "Package Proof",
] as const);
export const requiredCandidateCheckAppId = 15368;

type CandidateCheckRuns = Readonly<{
  check_runs?: unknown;
}>;

type CandidateEligibilityOptions = Readonly<{
  repositoryRoot: string;
  sourceCommit: string;
  mainCommit: string;
  checks: CandidateCheckRuns;
}>;

const fail = (message: string): never => {
  throw new Error(message);
};

const gitSucceeds = (repositoryRoot: string, args: readonly string[]): boolean =>
  spawnSync("git", ["-C", repositoryRoot, ...args], { stdio: "ignore" }).status === 0;

export const assertCandidateEligibility = (
  options: CandidateEligibilityOptions,
): Readonly<{
  sourceCommit: string;
  mainCommit: string;
  contexts: typeof requiredCandidateContexts;
}> => {
  assertExactReleaseCommit(options.sourceCommit, "source commit");
  assertExactReleaseCommit(options.mainCommit, "main commit");
  if (
    !gitSucceeds(options.repositoryRoot, ["cat-file", "-e", `${options.sourceCommit}^{commit}`])
  ) {
    fail("candidate source commit is not available in the repository");
  }
  if (!gitSucceeds(options.repositoryRoot, ["cat-file", "-e", `${options.mainCommit}^{commit}`])) {
    fail("main commit is not available in the repository");
  }
  if (
    !gitSucceeds(options.repositoryRoot, [
      "merge-base",
      "--is-ancestor",
      options.sourceCommit,
      options.mainCommit,
    ])
  ) {
    fail("candidate source commit is not contained in main");
  }

  const checkRuns: unknown[] = Array.isArray(options.checks.check_runs)
    ? options.checks.check_runs
    : fail("Candidate check response must contain check_runs");
  for (const context of requiredCandidateContexts) {
    const matches = checkRuns.filter((check): check is Readonly<Record<string, unknown>> => {
      if (typeof check !== "object" || check === null) return false;
      const record = check as Readonly<Record<string, unknown>>;
      const app = record["app"];
      return (
        record["name"] === context &&
        typeof app === "object" &&
        app !== null &&
        (app as Readonly<Record<string, unknown>>)["id"] === requiredCandidateCheckAppId
      );
    });
    if (
      matches.length !== 1 ||
      matches[0]?.["status"] !== "completed" ||
      matches[0]?.["conclusion"] !== "success"
    ) {
      fail(`required Candidate context is not successful: ${context}`);
    }
  }

  return Object.freeze({
    sourceCommit: options.sourceCommit,
    mainCommit: options.mainCommit,
    contexts: requiredCandidateContexts,
  });
};

if (import.meta.main) {
  const parsed = parseArgs({
    args: process.argv.slice(2),
    strict: true,
    allowPositionals: false,
    options: {
      "repo-root": { type: "string" },
      "source-commit": { type: "string" },
      "main-commit": { type: "string" },
      checks: { type: "string" },
    },
  });
  const repositoryRoot = parsed.values["repo-root"] ?? fail("missing --repo-root");
  const sourceCommit = parsed.values["source-commit"] ?? fail("missing --source-commit");
  const mainCommit = parsed.values["main-commit"] ?? fail("missing --main-commit");
  const checksPath = parsed.values.checks ?? fail("missing --checks");
  const checks = JSON.parse(await readFile(resolve(checksPath), "utf8")) as CandidateCheckRuns;
  const eligible = assertCandidateEligibility({
    repositoryRoot: resolve(repositoryRoot),
    sourceCommit,
    mainCommit,
    checks,
  });
  process.stdout.write(`${JSON.stringify(eligible)}\n`);
}
