import { realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { sha256Bytes, sha256File } from "./release-digest";

const fail = (message: string): never => {
  throw new Error(message);
};

const git = (root: string, args: readonly string[]): string => {
  const result = Bun.spawnSync(["git", ...args], { cwd: root, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) {
    fail(result.stderr.toString().trim() || `git ${args.join(" ")} failed.`);
  }
  return result.stdout.toString().trim();
};

const localRehearsalHarnessPathspecs = Object.freeze([
  ":(exclude)README.local.md",
  ":(exclude)tests",
  ":(exclude)node-tests",
  ":(exclude)browser-tests",
  ":(exclude)docs/agents/codex-e2e.md",
  ":(exclude)docs/agents/release-live-journey.md",
  ":(exclude)scripts/codex-e2e-runtime.ts",
  ":(exclude)scripts/github-live-journey.ts",
  ":(exclude,glob)scripts/live-*.ts",
  ":(exclude)scripts/local-rehearsal-identity.ts",
  ":(exclude)scripts/run-live-journey.ts",
  ":(exclude)validation/live-journey/generation.md",
  ":(exclude)validation/live-journey/journeys",
]);

const localRehearsalProductPathspecs = [".", ...localRehearsalHarnessPathspecs] as const;

export const localRehearsalWorktreeDigest = async (sourceRoot: string): Promise<string> => {
  const root = await realpath(resolve(sourceRoot));
  const head = git(root, ["rev-parse", "HEAD"]);
  const diff = git(root, ["diff", "--binary", "HEAD", "--", ...localRehearsalProductPathspecs]);
  const untracked = git(root, [
    "ls-files",
    "--others",
    "--exclude-standard",
    "--",
    ...localRehearsalProductPathspecs,
  ])
    .split("\n")
    .filter((locator) => locator.length > 0)
    .sort((left, right) => left.localeCompare(right, "en"));
  const untrackedFrames: string[] = [];
  for (const locator of untracked) {
    untrackedFrames.push(`${locator}\0${await sha256File(join(root, locator))}\n`);
  }
  return sha256Bytes(
    Buffer.from(`${head}\0${sha256Bytes(Buffer.from(diff))}\0${untrackedFrames.join("")}`),
  );
};
