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
  },
});
for (const name of ["receipt", "version", "source-commit", "repo-root"] as const) {
  if (parsed.tokens.filter((token) => token.kind === "option" && token.name === name).length > 1) {
    throw new Error(`--${name} may be provided only once`);
  }
}

const receipt = parsed.values.receipt;
if (receipt === undefined) {
  throw new Error(
    "usage: bun scripts/verify-release-candidate.ts --receipt <path> [--version <version>] [--source-commit <sha>] [--repo-root <path>]",
  );
}

const version = parsed.values.version;
const sourceCommit = parsed.values["source-commit"];
const repositoryRoot = parsed.values["repo-root"];
const expected: { version?: string; sourceCommit?: string; repositoryRoot?: string } = {};
if (version !== undefined) expected.version = version;
if (sourceCommit !== undefined) expected.sourceCommit = sourceCommit;
if (repositoryRoot !== undefined) expected.repositoryRoot = resolve(repositoryRoot);
const verified = await verifyReleaseCandidate(resolve(receipt), expected);
process.stdout.write(`${verified.artifact.file}\n`);
