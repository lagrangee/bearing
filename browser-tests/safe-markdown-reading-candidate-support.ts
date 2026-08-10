import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cp,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { readReleaseTarGz } from "../scripts/release-archive";
import {
  runHarnessCommand,
  stopHarnessProcess,
  waitForHarnessLine,
} from "./real-host-test-support";

export type ReadingCandidate = Readonly<{
  expectation: "fixed" | "historical-failure";
  installedCli: string;
  installedCliSha256: string;
  packagePath: string;
  packageSha256: string;
  screenshotPath: string;
  selfHostRepo: string;
  sourceCommit: string;
}>;

const requiredString = (value: unknown, name: string): string => {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Ticket 27 candidate manifest requires ${name}.`);
  }
  return value;
};

export const readReadingCandidate = async (): Promise<ReadingCandidate> => {
  const locator = process.env["BEARING_READING_CANDIDATE"];
  if (locator === undefined) throw new Error("Ticket 27 candidate manifest is required.");
  const parsed: unknown = JSON.parse(await readFile(locator, "utf8"));
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Ticket 27 candidate manifest must be an object.");
  }
  const record = parsed as Record<string, unknown>;
  const expectation = requiredString(record["expectation"], "expectation");
  if (expectation !== "fixed" && expectation !== "historical-failure") {
    throw new Error("Ticket 27 candidate expectation is invalid.");
  }
  return {
    expectation,
    installedCli: requiredString(record["installedCli"], "installedCli"),
    installedCliSha256: requiredString(record["installedCliSha256"], "installedCliSha256"),
    packagePath: requiredString(record["packagePath"], "packagePath"),
    packageSha256: requiredString(record["packageSha256"], "packageSha256"),
    screenshotPath: requiredString(record["screenshotPath"], "screenshotPath"),
    selfHostRepo: requiredString(record["selfHostRepo"], "selfHostRepo"),
    sourceCommit: requiredString(record["sourceCommit"], "sourceCommit"),
  };
};

const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

export const verifyReadingCandidateIdentity = async (
  candidate: ReadingCandidate,
): Promise<void> => {
  if (sha256(await readFile(candidate.packagePath)) !== candidate.packageSha256) {
    throw new Error("Ticket 27 package digest does not match its manifest.");
  }
  const installedCli = await realpath(candidate.installedCli);
  if (sha256(await readFile(installedCli)) !== candidate.installedCliSha256) {
    throw new Error("Ticket 27 installed CLI digest does not match its manifest.");
  }
  const packedCliEntries = (await readReleaseTarGz(candidate.packagePath)).filter(
    (entry) => entry.path === "package/dist/cli.js" && entry.type === "file",
  );
  if (packedCliEntries.length !== 1) {
    throw new Error("Ticket 27 package must contain exactly one regular CLI entry.");
  }
  if (sha256(packedCliEntries[0]?.bytes ?? new Uint8Array()) !== candidate.installedCliSha256) {
    throw new Error("Ticket 27 package and installed CLI bytes do not match.");
  }
  if (candidate.expectation === "fixed") {
    const head = await runHarnessCommand("git", ["rev-parse", "HEAD"], {
      cwd: candidate.selfHostRepo,
      environment: process.env,
      label: "Ticket 27 source identity",
    });
    if (head.exitCode !== 0 || head.stdout.trim() !== candidate.sourceCommit) {
      throw new Error("Ticket 27 installed candidate is not bound to the fixed source commit.");
    }
  }
};

const controlledProbe = `

## Ticket 27 controlled real self-host reading probe

This paragraph is copied with the real self-host PRD and stays readable as one paragraph.

1. The ordered item stays ordered.
   - The nested item stays nested.

> The real self-host blockquote stays a blockquote.

- [x] The completed task stays disabled.
- [ ] The open task stays disabled.

[Safe source](https://example.com/spec) [Relative source](../CONTEXT.md)

![Remote probe](https://images.example.test/reading.png)

<script>globalThis.__ticket27ActiveContent = true</script>
`;

const copySource = async (
  sourceRoot: string,
  targetRoot: string,
  locator: string,
): Promise<void> => {
  const source = join(sourceRoot, locator);
  const target = join(targetRoot, locator);
  await mkdir(dirname(target), { recursive: true });
  await cp(source, target, { recursive: true });
};

export const prepareSelfHostReadingCopy = async (sourceRoot: string): Promise<string> => {
  const targetRoot = await mkdtemp(join(tmpdir(), "bearing-ticket27-self-host-"));
  for (const locator of [
    ".bearing/manifest.json",
    ".bearing/provider.json",
    ".bearing/state",
    ".scratch/bearing-architecture-contraction",
    "docs/agents/issue-tracker.md",
    "docs/agents/triage-labels.md",
    "AGENTS.md",
    "CONTEXT.md",
    "package.json",
  ]) {
    await copySource(sourceRoot, targetRoot, locator);
  }
  const prd = join(targetRoot, ".scratch/bearing-architecture-contraction/PRD.md");
  await writeFile(prd, `${await readFile(prd, "utf8")}${controlledProbe}`);
  return realpath(targetRoot);
};

export const runInstalledBearing = async (
  candidate: ReadingCandidate,
  args: readonly string[],
): Promise<void> => {
  const result = await runHarnessCommand(candidate.installedCli, args, {
    environment: process.env,
    label: "Ticket 27 installed Bearing",
  });
  if (result.exitCode !== 0) {
    throw new Error(
      `Ticket 27 installed Bearing exited ${result.exitCode}: ${result.stderr}\n${result.stdout}`,
    );
  }
};

export const setInstalledReadModelProjectionVersion = (
  repoRoot: string,
  projectionVersion: number,
): void => {
  const database = new DatabaseSync(join(repoRoot, ".bearing/cache/project-read-model.sqlite"));
  try {
    database
      .prepare("UPDATE read_model_metadata SET projection_version = ?")
      .run(projectionVersion);
  } finally {
    database.close();
  }
};

const reservePort = async (): Promise<number> => {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("No test port available.");
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error === undefined ? resolve() : reject(error))),
  );
  return address.port;
};

export type InstalledPortal = Readonly<{
  child: ChildProcessWithoutNullStreams;
  url: string;
}>;

export const startInstalledPortal = async (
  candidate: ReadingCandidate,
  homeRoot: string,
): Promise<InstalledPortal> => {
  const port = await reservePort();
  const child = spawn(candidate.installedCli, ["portal", "--port", String(port)], {
    cwd: process.cwd(),
    env: { ...process.env, HOME: homeRoot },
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stdin.end();
  try {
    await waitForHarnessLine(child, `Bearing Portal ready: http://127.0.0.1:${port}`, {
      label: "Ticket 27 installed Portal",
      timeoutMs: 15_000,
    });
  } catch (error) {
    await stopHarnessProcess(child, { label: "Ticket 27 failed Portal" });
    throw error;
  }
  return { child, url: `http://127.0.0.1:${port}` };
};

export const stopInstalledPortal = async (portal: InstalledPortal | undefined): Promise<void> => {
  if (portal !== undefined) await stopHarnessProcess(portal.child, { label: "Ticket 27 Portal" });
};

export type ProviderReadMonitor = readonly Readonly<{ path: string; atimeMs: number }>[];

const providerReadRoots = [
  ".bearing/provider.json",
  ".scratch/bearing-architecture-contraction",
  "docs/agents/issue-tracker.md",
  "AGENTS.md",
  "CONTEXT.md",
] as const;

export const armProviderReadMonitor = async (repoRoot: string): Promise<ProviderReadMonitor> => {
  const paths: string[] = [];
  const collect = async (path: string): Promise<void> => {
    const metadata = await stat(path);
    if (metadata.isFile()) {
      paths.push(path);
      return;
    }
    if (!metadata.isDirectory()) return;
    for (const entry of await readdir(path, { withFileTypes: true })) {
      await collect(join(path, entry.name));
    }
  };
  for (const locator of providerReadRoots) await collect(join(repoRoot, locator));

  const sentinel = new Date("2000-01-01T00:00:00.000Z");
  for (const path of paths) {
    const metadata = await stat(path);
    await utimes(path, sentinel, metadata.mtime);
  }
  return Promise.all(paths.map(async (path) => ({ path, atimeMs: (await stat(path)).atimeMs })));
};

export const changedProviderReads = async (
  monitor: ProviderReadMonitor,
): Promise<readonly string[]> => {
  const changed: string[] = [];
  for (const entry of monitor) {
    if ((await stat(entry.path)).atimeMs !== entry.atimeMs) changed.push(entry.path);
  }
  return changed;
};

const digestTree = async (
  digest: ReturnType<typeof createHash>,
  root: string,
  locator: string,
): Promise<void> => {
  const entries = await readdir(join(root, locator), { withFileTypes: true });
  for (const entry of entries.toSorted((left, right) => left.name.localeCompare(right.name))) {
    const child = join(locator, entry.name);
    if (entry.isDirectory()) await digestTree(digest, root, child);
    else if (entry.isFile()) {
      digest.update(child);
      digest.update(await readFile(join(root, child)));
    }
  }
};

export const digestSelfHostAuthority = async (repoRoot: string): Promise<string> => {
  const digest = createHash("sha256");
  await digestTree(digest, repoRoot, ".bearing/state");
  await digestTree(digest, repoRoot, ".scratch/bearing-architecture-contraction");
  return digest.digest("hex");
};

export const digestReadingTruth = async (repoRoot: string, homeRoot: string): Promise<string> => {
  const digest = createHash("sha256");
  await digestTree(digest, repoRoot, ".bearing/state");
  await digestTree(digest, repoRoot, ".bearing/cache");
  await digestTree(digest, repoRoot, ".scratch/bearing-architecture-contraction");
  await digestTree(digest, homeRoot, ".bearing");
  return digest.digest("hex");
};
