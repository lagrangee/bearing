import { resolve } from "node:path";
import { verifyReleaseCandidate } from "./release-candidate-lib";

const valueAfter = (flag: string): string | undefined => {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
};

const receipt = valueAfter("--receipt");
if (receipt === undefined) {
  throw new Error(
    "usage: bun scripts/verify-release-candidate.ts --receipt <path> [--version <version>] [--source-commit <sha>] [--repo-root <path>]",
  );
}

const version = valueAfter("--version");
const sourceCommit = valueAfter("--source-commit");
const repositoryRoot = valueAfter("--repo-root");
const expected: { version?: string; sourceCommit?: string; repositoryRoot?: string } = {};
if (version !== undefined) expected.version = version;
if (sourceCommit !== undefined) expected.sourceCommit = sourceCommit;
if (repositoryRoot !== undefined) expected.repositoryRoot = resolve(repositoryRoot);
const verified = await verifyReleaseCandidate(resolve(receipt), expected);
process.stdout.write(`${verified.artifact.file}\n`);
