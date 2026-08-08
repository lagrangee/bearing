import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import {
  type ArchitectureContractionCandidateIdentity,
  assertArchitectureContractionCandidateEvidence,
} from "./architecture-contraction-candidate-contract";

type Arguments = Readonly<{
  sourceCommit: string;
  packagePath: string;
  outputPath: string;
  laneEvidencePaths: readonly string[];
}>;

const valueAfter = (values: string[], option: string): string => {
  const value = values.shift();
  if (value === undefined || value.length === 0) throw new Error(`${option} requires a value.`);
  return value;
};

const parseArguments = (argv: readonly string[]): Arguments => {
  const values = [...argv];
  let sourceCommit: string | undefined;
  let packagePath: string | undefined;
  let outputPath: string | undefined;
  const laneEvidencePaths: string[] = [];
  while (values.length > 0) {
    const option = values.shift();
    if (option === "--source-commit") sourceCommit = valueAfter(values, option);
    else if (option === "--package") packagePath = resolve(valueAfter(values, option));
    else if (option === "--out") outputPath = resolve(valueAfter(values, option));
    else if (option === "--lane-evidence") {
      laneEvidencePaths.push(resolve(valueAfter(values, option)));
    } else throw new Error(`Unknown option: ${option ?? ""}.`);
  }
  if (sourceCommit === undefined || packagePath === undefined || outputPath === undefined) {
    throw new Error("--source-commit, --package, and --out are required.");
  }
  if (laneEvidencePaths.length !== 3) {
    throw new Error("Exactly three --lane-evidence receipts are required.");
  }
  return { sourceCommit, packagePath, outputPath, laneEvidencePaths };
};

const run = async (
  command: readonly string[],
  options: Readonly<{ cwd?: string; env?: Readonly<Record<string, string | undefined>> }> = {},
): Promise<string> => {
  const child = Bun.spawn([...command], {
    cwd: options.cwd ?? process.cwd(),
    ...(options.env === undefined ? {} : { env: options.env }),
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  if (exitCode !== 0) {
    throw new Error(stderr.trim() || stdout.trim() || `${command[0]} exited ${exitCode}.`);
  }
  return stdout;
};

const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

const sameCandidate = (
  left: ArchitectureContractionCandidateIdentity,
  right: ArchitectureContractionCandidateIdentity,
): boolean =>
  left.sourceCommit === right.sourceCommit &&
  left.packageFile === right.packageFile &&
  left.packageSha256 === right.packageSha256;

const main = async (): Promise<void> => {
  const args = parseArguments(process.argv.slice(2));
  const head = (await run(["git", "rev-parse", "HEAD"])).trim();
  if (head !== args.sourceCommit || !/^[0-9a-f]{40}$/u.test(head)) {
    throw new Error("Candidate source commit does not match the current fixed HEAD.");
  }
  if ((await run(["git", "status", "--porcelain=v1", "--untracked-files=all"])) !== "") {
    throw new Error("Candidate source must be clean before exact evidence is measured.");
  }
  const packageBytes = await readFile(args.packagePath);
  const candidate = {
    sourceCommit: head,
    packageFile: basename(args.packagePath),
    packageSha256: sha256(packageBytes),
  } as const;

  const laneEvidence = await Promise.all(
    args.laneEvidencePaths.map(async (path) => JSON.parse(await readFile(path, "utf8")) as unknown),
  );
  const lanes = laneEvidence.map((unknownLane) => {
    if (typeof unknownLane !== "object" || unknownLane === null) {
      throw new Error("Lane evidence must be one JSON object.");
    }
    const lane = unknownLane as {
      name?: unknown;
      candidate?: ArchitectureContractionCandidateIdentity;
      outcome?: unknown;
    };
    if (
      !["packed-journey", "fresh-agent", "foreground-portal"].includes(String(lane.name)) ||
      lane.outcome !== "passed" ||
      lane.candidate === undefined ||
      !sameCandidate(candidate, lane.candidate)
    ) {
      throw new Error("Lane receipt did not prove the same exact candidate.");
    }
    return lane as Readonly<{
      name: "packed-journey" | "fresh-agent" | "foreground-portal";
      candidate: ArchitectureContractionCandidateIdentity;
      outcome: "passed";
    }>;
  });

  const temporaryRoot = await mkdtemp(join(tmpdir(), "bearing-contraction-candidate-"));
  try {
    const repackRoot = join(temporaryRoot, "repack");
    const installRoot = join(temporaryRoot, "install");
    const offlineHome = join(temporaryRoot, "home");
    const npmCache = join(temporaryRoot, "npm-cache");
    await Promise.all([mkdir(repackRoot), mkdir(offlineHome)]);
    const repackedFile = (await run(["npm", "pack", "--pack-destination", repackRoot]))
      .trim()
      .split("\n")
      .at(-1);
    if (repackedFile === undefined || repackedFile.length === 0) {
      throw new Error("Exact source repack returned no package filename.");
    }
    const regeneratedPackageSha256 = sha256(await readFile(join(repackRoot, repackedFile)));
    if (regeneratedPackageSha256 !== candidate.packageSha256) {
      throw new Error("Supplied package was not reproduced from the exact clean source commit.");
    }
    await run(
      [
        "npm",
        "install",
        "--offline",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        "--prefix",
        installRoot,
        args.packagePath,
      ],
      {
        env: {
          ...process.env,
          HOME: offlineHome,
          npm_config_cache: npmCache,
          npm_config_loglevel: "error",
          npm_config_update_notifier: "false",
        },
      },
    );
    await access(join(installRoot, "node_modules/.bin/bearing"));
    const packageAttestation = {
      regeneratedPackageSha256,
      exactSourcePackageMatch: true,
      installedPackageSha256: candidate.packageSha256,
      installMode: "offline" as const,
      installedCliObserved: true,
    };

    const built = await Bun.build({
      entrypoints: [
        join(
          process.cwd(),
          "node-tests/product-seams/architecture-contraction-candidate-worker.ts",
        ),
      ],
      outdir: temporaryRoot,
      target: "node",
      format: "esm",
      minify: false,
      sourcemap: "none",
      external: ["node:*"],
    });
    if (!built.success || built.outputs.length !== 1) {
      throw new AggregateError(built.logs, "Candidate measurement worker build failed.");
    }
    const measurement = JSON.parse(
      await run([
        "node",
        built.outputs[0]?.path ?? "",
        candidate.sourceCommit,
        candidate.packageFile,
        candidate.packageSha256,
      ]),
    ) as {
      schemaVersion: 1;
      fixture: Parameters<typeof assertArchitectureContractionCandidateEvidence>[0]["fixture"];
      methodology: Parameters<
        typeof assertArchitectureContractionCandidateEvidence
      >[0]["methodology"];
      measurements: Parameters<
        typeof assertArchitectureContractionCandidateEvidence
      >[0]["measurements"];
      measuredAt: string;
      machine: unknown;
    };
    const evidence = assertArchitectureContractionCandidateEvidence({
      schemaVersion: 1,
      evidenceKind: "architecture-contraction-candidate",
      candidate,
      packageAttestation,
      fixture: measurement.fixture,
      methodology: measurement.methodology,
      measurements: measurement.measurements,
      lanes: [{ name: "sqlite-performance", candidate, outcome: "passed" }, ...lanes],
      authority: {
        concludesEffort: false,
        changesGateReadiness: false,
        passesGate: false,
        claimsReleaseProof: false,
      },
    });
    await writeFile(
      args.outputPath,
      `${JSON.stringify({ ...evidence, measuredAt: measurement.measuredAt, machine: measurement.machine }, null, 2)}\n`,
      { flag: "wx" },
    );
    process.stdout.write(`${JSON.stringify(evidence.measurements)}\n`);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
};

await main();
