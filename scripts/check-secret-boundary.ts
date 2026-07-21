import { spawnSync } from "node:child_process";
import { lstat, readFile } from "node:fs/promises";

const patterns = [
  ["GitHub token", /gh[pousr]_[A-Za-z0-9_]{20,}/u],
  ["npm token", /npm_[A-Za-z0-9]{20,}/u],
  ["OpenAI-style API key", /sk-[A-Za-z0-9_-]{20,}/u],
  ["private key block", /-----BEGIN (?:RSA |OPENSSH |EC |DSA )?PRIVATE KEY-----/u],
  ["maintainer absolute path", /\/Users\/clawd/u],
] as const;

export const scanTrackedFiles = async (paths: readonly string[]): Promise<string[]> => {
  const findings: string[] = [];
  for (const path of paths) {
    let metadata: Awaited<ReturnType<typeof lstat>>;
    try {
      metadata = await lstat(path);
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
    const bytes = await readFile(path);
    if (bytes.includes(0)) continue;
    const text = bytes.toString("utf8");
    for (const [label, pattern] of patterns) {
      if (pattern.test(text)) findings.push(`${path}: ${label}`);
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
  const findings = await scanTrackedFiles(trackedPaths);
  if (findings.length > 0) {
    throw new Error(`Secret boundary check failed:\n${findings.join("\n")}`);
  }
  process.stdout.write("Secret boundary check passed.\n");
};

if (import.meta.main) await main();
