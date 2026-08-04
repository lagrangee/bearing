import { spawnSync } from "node:child_process";
import { type ReleaseArchiveEntry, readReleaseTarGz } from "./release-archive";
import { sha256Bytes } from "./release-digest";

const fail = (message: string): never => {
  throw new Error(message);
};

const assertRepositoryPath = (path: string): void => {
  if (
    path.length === 0 ||
    path.startsWith("/") ||
    path.includes("\\") ||
    path.split("/").some((segment) => segment.length === 0 || segment === "." || segment === "..")
  ) {
    fail(`unsafe tracked source path: ${path}`);
  }
};

export const assertCandidateSourcesMatchCommit = async (
  artifactPath: string,
  packagePaths: readonly string[],
  sourceCommit: string,
  repositoryRoot = process.cwd(),
  inspectedEntries?: readonly ReleaseArchiveEntry[],
): Promise<void> => {
  const entries = inspectedEntries ?? (await readReleaseTarGz(artifactPath));
  const archiveFiles = new Map(
    entries.filter((entry) => entry.type === "file").map((entry) => [entry.path, entry.bytes]),
  );
  const trackedSourcePaths = packagePaths.filter((path) => !path.startsWith("dist/"));
  for (const path of [...new Set(trackedSourcePaths)].sort()) {
    assertRepositoryPath(path);
    const committed = spawnSync("git", ["-C", repositoryRoot, "show", `${sourceCommit}:${path}`], {
      encoding: "buffer",
      maxBuffer: 64 * 1024 * 1024,
    });
    if (committed.status !== 0) {
      fail(`candidate input is not tracked at ${sourceCommit}: ${path}`);
    }
    const packed =
      archiveFiles.get(`package/${path}`) ??
      fail(`candidate artifact is missing tracked input: ${path}`);
    if (sha256Bytes(packed) !== sha256Bytes(committed.stdout)) {
      fail(`candidate artifact bytes differ from ${sourceCommit}: ${path}`);
    }
  }
};
