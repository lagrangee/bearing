import { spawnSync } from "node:child_process";
import { lstat, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const privateStagingPrefixes = [".bearing/", ".scratch/", "release-candidate/"] as const;
const dogfoodOutputPrefixes = [
  ".bearing-build-",
  "coverage/",
  "playwright-report/",
  "test-results/",
] as const;
const maintainerHome = ["", "Users", "clawd"].join("/");

const matchesPathBoundary = (path: string, prefix: string): boolean =>
  path === prefix.replace(/\/$/u, "") || path.startsWith(prefix);

export const findPublicSourceResidue = async (
  repositoryRoot: string,
  paths: readonly string[],
): Promise<string[]> => {
  const findings: string[] = [];
  for (const path of paths) {
    const normalized = path.replaceAll("\\", "/").replace(/^\.\//u, "");
    if (privateStagingPrefixes.some((prefix) => matchesPathBoundary(normalized, prefix))) {
      findings.push(`${path}: private staging path`);
      continue;
    }
    if (dogfoodOutputPrefixes.some((prefix) => matchesPathBoundary(normalized, prefix))) {
      findings.push(`${path}: dogfood output path`);
      continue;
    }

    let metadata: Awaited<ReturnType<typeof lstat>>;
    try {
      metadata = await lstat(resolve(repositoryRoot, path));
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") continue;
      throw error;
    }
    if (metadata.isSymbolicLink()) {
      findings.push(
        `${path}: tracked symbolic link is outside the readable public-source boundary`,
      );
      continue;
    }
    if (!metadata.isFile()) continue;
    const bytes = await readFile(resolve(repositoryRoot, path));
    if (bytes.includes(0)) continue;
    if (bytes.includes(Buffer.from(maintainerHome))) {
      findings.push(`${path}: maintainer absolute path`);
    }
  }
  return findings;
};

const main = async (): Promise<void> => {
  const tracked = spawnSync("git", ["ls-files", "-z"], { encoding: "buffer" });
  if (tracked.status !== 0) {
    throw new Error(
      `Could not enumerate tracked public source:\n${tracked.stderr.toString("utf8")}`,
    );
  }
  const trackedPaths = tracked.stdout
    .toString("utf8")
    .split("\0")
    .filter((path) => path.length > 0);
  const findings = await findPublicSourceResidue(process.cwd(), trackedPaths);
  if (findings.length > 0) {
    throw new Error(`Public-source residue check failed:\n${findings.join("\n")}`);
  }
  process.stdout.write("Public-source residue check passed.\n");
};

if (import.meta.main) await main();
