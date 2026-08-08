import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readdir, readFile, readlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, relative } from "node:path";

export type InstalledProductCommandResult = Readonly<{
  exitClass: "success" | "product-outcome" | "usage-error" | "process-error";
  exitCode: number;
  stdout: string;
  stderr: string;
  effects: Readonly<{
    created: readonly string[];
    changed: readonly string[];
    removed: readonly string[];
  }>;
}>;

export type InstalledProduct = Readonly<{
  root: string;
  homeDir: string;
  cliPath: string;
  candidate: Readonly<{
    identity: string;
    headCommit: string;
    sourceState: "clean" | "dirty";
    packageFile: string;
    packageSha256: string;
  }>;
  run: (
    args: readonly string[],
    options?: Readonly<{
      cwd?: string;
      observeRoots?: readonly string[];
      environment?: NodeJS.ProcessEnv;
    }>,
  ) => Promise<InstalledProductCommandResult>;
  runTerminal: (
    args: readonly string[],
    input: string,
    options?: Readonly<{
      cwd?: string;
      observeRoots?: readonly string[];
      environment?: NodeJS.ProcessEnv;
    }>,
  ) => Promise<InstalledProductCommandResult>;
  dispose: () => Promise<void>;
}>;

type CommandResult = Readonly<{ exitCode: number; stdout: string; stderr: string }>;

const runCommand = async (
  command: readonly string[],
  options: Readonly<{ cwd: string; environment: NodeJS.ProcessEnv; input?: string }>,
): Promise<CommandResult> => {
  const child = Bun.spawn([...command], {
    cwd: options.cwd,
    env: options.environment,
    stdin: options.input === undefined ? "ignore" : "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  if (options.input !== undefined) {
    if (child.stdin === undefined) throw new Error("Interactive command stdin is unavailable.");
    child.stdin.write(options.input);
    child.stdin.end();
  }
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { exitCode, stdout, stderr };
};

const terminalCommand = (command: readonly string[]): readonly string[] => [
  "python3",
  "-c",
  [
    "import os, pty, sys",
    "pid, master = pty.fork()",
    "if pid == 0: os.execv(sys.argv[1], sys.argv[1:])",
    "os.write(master, sys.stdin.buffer.read())",
    "while True:",
    "  try: data = os.read(master, 4096)",
    "  except OSError: break",
    "  if not data: break",
    "  sys.stdout.buffer.write(data); sys.stdout.buffer.flush()",
    "_, status = os.waitpid(pid, 0)",
    "sys.exit(os.waitstatus_to_exitcode(status))",
  ].join("\n"),
  ...command,
];

const hash = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

const snapshotRoot = async (root: string, index: number): Promise<Map<string, string>> => {
  const snapshot = new Map<string, string>();
  const visit = async (path: string): Promise<void> => {
    const metadata = await lstat(path);
    const locator = `root-${index}/${relative(root, path) || "."}`;
    if (metadata.isSymbolicLink()) {
      snapshot.set(locator, `symlink:${await readlink(path)}`);
      return;
    }
    if (metadata.isDirectory()) {
      snapshot.set(locator, "directory");
      const entries = await readdir(path);
      for (const entry of entries.sort()) await visit(join(path, entry));
      return;
    }
    snapshot.set(locator, `file:${metadata.mode}:${metadata.size}:${hash(await readFile(path))}`);
  };
  await visit(root);
  return snapshot;
};

const snapshotRoots = async (roots: readonly string[]): Promise<Map<string, string>> => {
  const snapshots = await Promise.all(roots.map((root, index) => snapshotRoot(root, index)));
  return new Map(snapshots.flatMap((snapshot) => [...snapshot]));
};

const compareSnapshots = (before: Map<string, string>, after: Map<string, string>) => ({
  created: [...after.keys()].filter((locator) => !before.has(locator)).sort(),
  changed: [...after.keys()]
    .filter((locator) => before.has(locator) && before.get(locator) !== after.get(locator))
    .sort(),
  removed: [...before.keys()].filter((locator) => !after.has(locator)).sort(),
});

const exitClass = (result: CommandResult): InstalledProductCommandResult["exitClass"] => {
  if (result.exitCode === 0) return "success";
  if (result.exitCode === 1) return "product-outcome";
  if (result.exitCode === 2) return "usage-error";
  return "process-error";
};

export const installPackedProduct = async (): Promise<InstalledProduct> => {
  const projectRoot = process.cwd();
  const root = await mkdtemp(join(tmpdir(), "bearing-installed-product-seam-"));
  const packRoot = join(root, "pack");
  const installRoot = join(root, "install");
  const homeDir = join(root, "home");
  const npmCache = join(root, "npm-cache");
  await Promise.all([mkdir(packRoot), mkdir(homeDir)]);
  const environment = {
    ...process.env,
    HOME: homeDir,
    npm_config_cache: npmCache,
    npm_config_loglevel: "error",
    npm_config_update_notifier: "false",
  };
  try {
    const packed = await runCommand(["npm", "pack", "--pack-destination", packRoot], {
      cwd: projectRoot,
      environment,
    });
    if (packed.exitCode !== 0) throw new Error(packed.stderr || "npm pack failed.");
    const packageFile = packed.stdout.trim().split("\n").at(-1);
    if (packageFile === undefined || packageFile.length === 0) {
      throw new Error("npm pack returned no package filename.");
    }
    const packagePath = join(packRoot, packageFile);
    const installed = await runCommand(
      [
        "npm",
        "install",
        "--offline",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        "--prefix",
        installRoot,
        packagePath,
      ],
      { cwd: projectRoot, environment },
    );
    if (installed.exitCode !== 0) {
      throw new Error(installed.stderr || "Offline package installation failed.");
    }
    const revision = await runCommand(["git", "rev-parse", "HEAD"], {
      cwd: projectRoot,
      environment,
    });
    if (revision.exitCode !== 0) throw new Error(revision.stderr || "Cannot identify candidate.");
    const status = await runCommand(["git", "status", "--porcelain=v1", "--untracked-files=all"], {
      cwd: projectRoot,
      environment,
    });
    if (status.exitCode !== 0) throw new Error(status.stderr || "Cannot identify source state.");
    const packageSha256 = hash(await readFile(packagePath));
    const sourceState = status.stdout.length === 0 ? "clean" : "dirty";
    const headCommit = revision.stdout.trim();
    const cliPath = join(installRoot, "node_modules/.bin/bearing");
    return {
      root,
      homeDir,
      cliPath,
      candidate: {
        identity: sourceState === "clean" ? `git:${headCommit}` : `sha256:${packageSha256}`,
        headCommit,
        sourceState,
        packageFile: basename(packagePath),
        packageSha256,
      },
      run: async (args, options = {}) => {
        const observeRoots = options.observeRoots ?? [];
        const before = await snapshotRoots(observeRoots);
        const result = await runCommand([cliPath, ...args], {
          cwd: options.cwd ?? projectRoot,
          environment: { ...environment, ...options.environment },
        });
        const after = await snapshotRoots(observeRoots);
        return {
          exitClass: exitClass(result),
          ...result,
          effects: compareSnapshots(before, after),
        };
      },
      runTerminal: async (args, input, options = {}) => {
        const observeRoots = options.observeRoots ?? [];
        const before = await snapshotRoots(observeRoots);
        const result = await runCommand(terminalCommand([cliPath, ...args]), {
          cwd: options.cwd ?? projectRoot,
          environment: { ...environment, ...options.environment },
          input,
        });
        const after = await snapshotRoots(observeRoots);
        return {
          exitClass: exitClass(result),
          ...result,
          effects: compareSnapshots(before, after),
        };
      },
      dispose: () => rm(root, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
};
