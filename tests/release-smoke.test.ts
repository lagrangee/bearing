import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cp,
  link,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import {
  assertIsolationRoots,
  assertLaneRuntime,
  auditReleaseSmokeSeed,
  buildIsolatedEnvironment,
  checkPackagedDocumentation,
  parseReleaseSmokeArgs,
  RELEASE_SMOKE_SEED,
  validateCandidateReceiptIdentity,
  validateCandidateTarball,
  verifyFrozenSourceInputs,
} from "../scripts/release-smoke.mjs";
import { validateMattSkillsV1Contract } from "../src/providers/matt-skills-v1";
import { createLocalMarkdownMattProvider } from "../src/providers/matt-skills-v1/local-markdown";
import { writeTarGzFixture } from "./release-archive-fixture";

const temporaryDirectories: string[] = [];

test("loads the release smoke entrypoint under the production Node runtime", () => {
  const result = spawnSync("node", ["scripts/release-smoke.mjs", "--help"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toContain("Usage:");
});

const temporaryDirectory = async (): Promise<string> => {
  const directory = await mkdtemp(join(tmpdir(), "bearing-release-smoke-test-"));
  temporaryDirectories.push(directory);
  return directory;
};

const runGit = async (root: string, args: readonly string[]): Promise<string> => {
  const child = Bun.spawn(["/usr/bin/git", ...args], {
    cwd: root,
    env: {
      HOME: root,
      PATH: "/usr/bin:/bin",
      LC_ALL: "C",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  if (exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${stderr || stdout}`);
  return stdout.trim();
};

const createFrozenSourceFixture = async (): Promise<{
  root: string;
  commit: string;
  harness: string;
  seedMap: string;
}> => {
  const root = await temporaryDirectory();
  const harness = join(root, "scripts/release-smoke.mjs");
  const seedRoot = join(root, "tests/fixtures/release-smoke-seed");
  await mkdir(join(root, "scripts"), { recursive: true });
  await writeFile(harness, "export const frozenHarness = true;\n");
  await cp(RELEASE_SMOKE_SEED, seedRoot, { recursive: true });
  await runGit(root, ["init", "--quiet"]);
  await runGit(root, [
    "add",
    "--",
    "scripts/release-smoke.mjs",
    "tests/fixtures/release-smoke-seed",
  ]);
  await runGit(root, [
    "-c",
    "user.name=Release Smoke",
    "-c",
    "user.email=release-smoke@example.invalid",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "--quiet",
    "-m",
    "frozen inputs",
  ]);
  return {
    root,
    commit: await runGit(root, ["rev-parse", "HEAD"]),
    harness,
    seedMap: join(seedRoot, "scratch/release-smoke/map.md"),
  };
};

// Independent raw-header oracle: exercises forbidden mode/path policy without asking
// the production tar-stream stack to generate the adversarial header it must reject.
const rewriteTarEntryHeader = async (
  tarball: string,
  archivePath: string,
  mutate: (header: Buffer) => void,
): Promise<void> => {
  const archive = gunzipSync(await readFile(tarball));
  for (let offset = 0; offset + 512 <= archive.byteLength; ) {
    const header = archive.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const field = (start: number, length: number): string => {
      const end = header.indexOf(0, start);
      return header.toString(
        "utf8",
        start,
        end === -1 || end > start + length ? start + length : end,
      );
    };
    const name = field(0, 100);
    const prefix = field(345, 155);
    const path = prefix.length > 0 ? `${prefix}/${name}` : name;
    const size = Number.parseInt(field(124, 12).trim() || "0", 8);
    if (path === archivePath) {
      mutate(header);
      header.fill(0x20, 148, 156);
      const checksum = header.reduce((sum, byte) => sum + byte, 0);
      header.write(`${checksum.toString(8).padStart(6, "0")}\0 `, 148, 8, "ascii");
      await writeFile(tarball, gzipSync(archive));
      return;
    }
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  throw new Error(`missing tar test entry: ${archivePath}`);
};

const rewriteTarEntryMode = async (
  tarball: string,
  archivePath: string,
  mode: number,
): Promise<void> =>
  rewriteTarEntryHeader(tarball, archivePath, (header) => {
    header.write(`${mode.toString(8).padStart(7, "0")}\0`, 100, 8, "ascii");
  });

const rewriteTarEntryName = async (
  tarball: string,
  archivePath: string,
  replacement: string,
): Promise<void> =>
  rewriteTarEntryHeader(tarball, archivePath, (header) => {
    if (Buffer.byteLength(replacement) > 100) throw new Error("tar test replacement is too long");
    header.fill(0, 0, 100);
    header.write(replacement, 0, 100, "utf8");
  });

const createMachineCandidate = async (
  root: string,
  label: string,
  artifactLabel = label,
  artifactMode = 0o644,
  trailingSlashSymlink = false,
): Promise<{
  receipt: string;
  tarball: string;
  sha256: string;
  repository: string;
  releaseNotes: string;
  sourceCommit: string;
}> => {
  const repository = join(root, "repository");
  await mkdir(repository, { recursive: true });
  const sourcePackage = `${JSON.stringify({
    name: "@lagrangee/bearing",
    version: "0.1.0",
    candidate: label,
  })}\n`;
  await writeFile(join(repository, "package.json"), sourcePackage);
  await runGit(repository, ["init", "--quiet"]);
  await runGit(repository, ["add", "--", "package.json"]);
  await runGit(repository, [
    "-c",
    "user.name=Release Smoke",
    "-c",
    "user.email=release-smoke@example.invalid",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "--quiet",
    "-m",
    `candidate ${label}`,
  ]);
  const sourceCommit = await runGit(repository, ["rev-parse", "HEAD"]);

  const packedPackage = `${JSON.stringify({
    name: "@lagrangee/bearing",
    version: "0.1.0",
    candidate: artifactLabel,
  })}\n`;
  const tarball = join(root, "lagrangee-bearing-0.1.0.tgz");
  await writeTarGzFixture(tarball, [
    {
      path: "package/package.json",
      bytes: packedPackage,
      mode: artifactMode & 0o777,
    },
    ...(trailingSlashSymlink
      ? [
          {
            path: "package/hidden-link",
            type: "symlink" as const,
            linkname: "package.json",
          },
        ]
      : []),
  ]);
  if (artifactMode > 0o777) {
    await rewriteTarEntryMode(tarball, "package/package.json", artifactMode);
  }
  if (trailingSlashSymlink) {
    await rewriteTarEntryName(tarball, "package/hidden-link", "package/hidden-link/");
  }
  const artifact = await readFile(tarball);
  const artifactSha256 = createHash("sha256").update(artifact).digest("hex");
  const manifest = Buffer.from(
    `${JSON.stringify(
      {
        schemaVersion: 2,
        packageName: "@lagrangee/bearing",
        packageVersion: "0.1.0",
        sourceCommit,
        files: [
          {
            path: "package.json",
            size: Buffer.byteLength(packedPackage),
            mode: artifactMode & 0o777,
          },
        ],
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  await writeFile(join(root, "candidate-manifest.json"), manifest);
  const releaseNotes = join(root, "release-notes.md");
  const releaseNotesBytes = Buffer.from("Final release notes.\n", "utf8");
  await writeFile(releaseNotes, releaseNotesBytes);
  const receipt = join(root, "candidate-receipt.json");
  await writeFile(
    receipt,
    `${JSON.stringify(
      {
        schemaVersion: 2,
        packageName: "@lagrangee/bearing",
        packageVersion: "0.1.0",
        sourceCommit,
        candidateId: `@lagrangee/bearing@0.1.0:${sourceCommit}:${artifactSha256}:run-123456789-1`,
        workflow: {
          name: "Prepare candidate artifact",
          runId: "123456789",
          runAttempt: 1,
        },
        toolchain: {
          node: "v24.15.0",
          bun: "1.3.8",
          npm: "11.11.0",
        },
        artifact: {
          file: "lagrangee-bearing-0.1.0.tgz",
          size: artifact.byteLength,
          sha256: artifactSha256,
          npmIntegrity: `sha512-${createHash("sha512").update(artifact).digest("base64")}`,
          npmShasum: createHash("sha1").update(artifact).digest("hex"),
        },
        manifest: {
          file: "candidate-manifest.json",
          sha256: createHash("sha256").update(manifest).digest("hex"),
        },
        releaseNotes: {
          file: "release-notes.md",
          sha256: createHash("sha256").update(releaseNotesBytes).digest("hex"),
        },
      },
      null,
      2,
    )}\n`,
  );
  return {
    receipt,
    tarball,
    sha256: artifactSha256,
    repository,
    releaseNotes,
    sourceCommit,
  };
};

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("release smoke arguments", () => {
  test("requires one explicit lane and exact artifact identity", () => {
    const options = parseReleaseSmokeArgs([
      "--lane",
      "node24",
      "--source-commit",
      "a".repeat(40),
      "--candidate-receipt",
      "/tmp/candidate-receipt.json",
      "--tarball",
      "/tmp/lagrangee-bearing-0.1.0.tgz",
      "--sha256",
      "a".repeat(64),
      "--version",
      "0.1.0",
      "--evidence",
      "/tmp/release-smoke.json",
    ]);

    expect(options).toMatchObject({
      lane: "node24",
      sourceCommit: "a".repeat(40),
      candidateReceipt: "/tmp/candidate-receipt.json",
      tarball: "/tmp/lagrangee-bearing-0.1.0.tgz",
      sha256: "a".repeat(64),
      version: "0.1.0",
      evidence: "/tmp/release-smoke.json",
    });
    expect(() =>
      parseReleaseSmokeArgs([
        "--lane",
        "node20",
        "--source-commit",
        "a".repeat(40),
        "--candidate-receipt",
        "/tmp/candidate-receipt.json",
        "--tarball",
        "/tmp/candidate.tgz",
        "--sha256",
        "a".repeat(64),
        "--version",
        "0.1.0",
      ]),
    ).toThrow("node24 or node26");
    expect(() =>
      parseReleaseSmokeArgs([
        "--lane",
        "node26",
        "--source-commit",
        "a".repeat(40),
        "--candidate-receipt",
        "/tmp/candidate-receipt.json",
        "--tarball",
        "@lagrangee/bearing@latest",
        "--sha256",
        "a".repeat(64),
        "--version",
        "0.1.0",
      ]),
    ).toThrow("absolute path");
    expect(() =>
      parseReleaseSmokeArgs([
        "--lane",
        "node24",
        "--tarball",
        "/tmp/candidate.tgz",
        "--sha256",
        "a".repeat(64),
        "--version",
        "0.1.0",
      ]),
    ).toThrow("--source-commit");
    expect(() =>
      parseReleaseSmokeArgs([
        "--lane",
        "node24",
        "--source-commit",
        "a".repeat(40),
        "--tarball",
        "/tmp/candidate.tgz",
        "--sha256",
        "a".repeat(64),
        "--version",
        "0.1.0",
      ]),
    ).toThrow("--candidate-receipt");
    expect(() =>
      parseReleaseSmokeArgs([
        "--lane",
        "node24",
        "--lane",
        "node26",
        "--source-commit",
        "a".repeat(40),
        "--candidate-receipt",
        "/tmp/candidate-receipt.json",
        "--tarball",
        "/tmp/candidate.tgz",
        "--sha256",
        "a".repeat(64),
        "--version",
        "0.1.0",
      ]),
    ).toThrow("lane");
    expect(() =>
      parseReleaseSmokeArgs([
        "--lane",
        "node24",
        "--source-commit",
        "a".repeat(40),
        "--candidate-receipt",
        "/tmp/candidate-receipt.json",
        "--tarball",
        "/tmp/candidate.tgz",
        "--sha256",
        "a".repeat(64),
        "--version",
        "v0.1.0",
      ]),
    ).toThrow("explicit 0.x package version");
  });

  test("refuses a lane that does not match the selected Node runtime", () => {
    expect(() => assertLaneRuntime("node24", "v24.15.0")).not.toThrow();
    expect(() => assertLaneRuntime("node24", "v24.14.1")).toThrow(
      "node24 requires Node.js 24.15.0 or later",
    );
    expect(() => assertLaneRuntime("node26", "v24.11.0")).toThrow("node26 requires Node.js 26");
  });
});

describe("release smoke frozen source binding", () => {
  test("binds the harness and complete seed byte set to the exact HEAD commit", async () => {
    const fixture = await createFrozenSourceFixture();
    const binding = await verifyFrozenSourceInputs({
      projectRoot: fixture.root,
      sourceCommit: fixture.commit,
    });

    expect(binding.sourceCommit).toBe(fixture.commit);
    expect(binding.harnessSha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(binding.seedDigest).toMatch(/^[0-9a-f]{64}$/u);
    expect(binding.seedManifest.map((file) => file.path)).toEqual([
      "CONTEXT.md",
      "docs/agents/issue-tracker.md",
      "docs/agents/triage-labels.md",
      "scratch/release-smoke/issues/01-orient.md",
      "scratch/release-smoke/map.md",
      "scratch/release-smoke/PRD.md",
    ]);
  }, 60_000);

  test("keeps the frozen Local seed valid through the production G2 provider seam", async () => {
    const repository = await temporaryDirectory();
    await cp(RELEASE_SMOKE_SEED, repository, { recursive: true });
    await rename(join(repository, "scratch"), join(repository, ".scratch"));
    const contract = await readFile(join(repository, "docs/agents/issue-tracker.md"), "utf8");

    expect(validateMattSkillsV1Contract(contract)).toEqual({
      state: "supported",
      driver: "local-markdown",
    });
    const capture = await createLocalMarkdownMattProvider({
      repoRoot: repository,
      contractLocator: "docs/agents/issue-tracker.md",
      clock: () => new Date("2026-07-28T00:00:00Z"),
    }).capture({
      provider: "matt-skills/v1",
      nativeScope: ".scratch/release-smoke",
    });
    expect(capture).toMatchObject({
      state: "available",
      freshness: { assessment: "current" },
      coverage: { assessment: "complete" },
      completion: "incomplete",
      diagnostics: [],
    });
  });

  test("rejects a supplied source commit that is not the exact current HEAD", async () => {
    const fixture = await createFrozenSourceFixture();
    await writeFile(join(fixture.root, "later.txt"), "later commit\n");
    await runGit(fixture.root, ["add", "--", "later.txt"]);
    await runGit(fixture.root, [
      "-c",
      "user.name=Release Smoke",
      "-c",
      "user.email=release-smoke@example.invalid",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "--quiet",
      "-m",
      "later head",
    ]);

    await expect(
      verifyFrozenSourceInputs({ projectRoot: fixture.root, sourceCommit: fixture.commit }),
    ).rejects.toThrow("HEAD mismatch");
  });

  test("rejects post-freeze harness and seed byte drift", async () => {
    const harnessFixture = await createFrozenSourceFixture();
    await writeFile(harnessFixture.harness, "export const driftedHarness = true;\n");
    await expect(
      verifyFrozenSourceInputs({
        projectRoot: harnessFixture.root,
        sourceCommit: harnessFixture.commit,
      }),
    ).rejects.toThrow("scripts/release-smoke.mjs");

    const seedFixture = await createFrozenSourceFixture();
    await writeFile(seedFixture.seedMap, "# Drifted seed\n");
    await expect(
      verifyFrozenSourceInputs({ projectRoot: seedFixture.root, sourceCommit: seedFixture.commit }),
    ).rejects.toThrow("tests/fixtures/release-smoke-seed/scratch/release-smoke/map.md");
  });
});

describe("release smoke candidate and isolation boundaries", () => {
  test("accepts only regular single-link tarballs with matching bytes", async () => {
    const directory = await temporaryDirectory();
    const tarball = join(directory, "candidate.tgz");
    const bytes = Buffer.from("exact candidate bytes");
    const digest = createHash("sha256").update(bytes).digest("hex");
    await writeFile(tarball, bytes);

    await expect(validateCandidateTarball(await realpath(tarball), digest)).resolves.toEqual({
      path: await realpath(tarball),
      digest,
    });
    await expect(validateCandidateTarball(tarball, "0".repeat(64))).rejects.toThrow(
      "digest mismatch",
    );

    const linked = join(directory, "linked.tgz");
    await symlink(tarball, linked);
    await expect(validateCandidateTarball(linked, digest)).rejects.toThrow("not a link");

    const peer = join(directory, "peer.tgz");
    await link(tarball, peer);
    await expect(validateCandidateTarball(tarball, digest)).rejects.toThrow("single-link");
  });

  test("cross-checks one candidate receipt against the supplied source and artifact identity", async () => {
    const root = await temporaryDirectory();
    const machineCandidate = await createMachineCandidate(join(root, "candidate-a"), "A");
    const candidate = await validateCandidateTarball(
      await realpath(machineCandidate.tarball),
      machineCandidate.sha256,
    );

    await expect(
      validateCandidateReceiptIdentity(machineCandidate.receipt, {
        sourceCommit: machineCandidate.sourceCommit,
        packageVersion: "0.1.0",
        candidate,
        repositoryRoot: machineCandidate.repository,
      }),
    ).resolves.toMatchObject({
      sourceCommit: machineCandidate.sourceCommit,
      packageVersion: "0.1.0",
      artifact: {
        file: "lagrangee-bearing-0.1.0.tgz",
        size: (await readFile(machineCandidate.tarball)).byteLength,
        sha256: machineCandidate.sha256,
      },
      manifest: { files: 1 },
    });
  });

  test("requires the complete producer schema v2 receipt identity", async () => {
    const root = await temporaryDirectory();
    const machineCandidate = await createMachineCandidate(join(root, "candidate"), "A");
    const candidate = await validateCandidateTarball(
      await realpath(machineCandidate.tarball),
      machineCandidate.sha256,
    );
    const receipt = JSON.parse(await readFile(machineCandidate.receipt, "utf8")) as Record<
      string,
      unknown
    >;
    await writeFile(
      machineCandidate.receipt,
      `${JSON.stringify({ ...receipt, candidateId: "wrong" }, null, 2)}\n`,
    );
    await expect(
      validateCandidateReceiptIdentity(machineCandidate.receipt, {
        sourceCommit: machineCandidate.sourceCommit,
        packageVersion: "0.1.0",
        candidate,
        repositoryRoot: machineCandidate.repository,
      }),
    ).rejects.toThrow("immutable identity mismatch");

    await writeFile(
      machineCandidate.receipt,
      `${JSON.stringify({ ...receipt, schemaVersion: 1 }, null, 2)}\n`,
    );
    await expect(
      validateCandidateReceiptIdentity(machineCandidate.receipt, {
        sourceCommit: machineCandidate.sourceCommit,
        packageVersion: "0.1.0",
        candidate,
        repositoryRoot: machineCandidate.repository,
      }),
    ).rejects.toThrow("Unsupported candidate receipt schema");

    await writeFile(machineCandidate.receipt, `${JSON.stringify(receipt, null, 2)}\n`);
    await writeFile(machineCandidate.releaseNotes, "changed notes\n");
    await expect(
      validateCandidateReceiptIdentity(machineCandidate.receipt, {
        sourceCommit: machineCandidate.sourceCommit,
        packageVersion: "0.1.0",
        candidate,
        repositoryRoot: machineCandidate.repository,
      }),
    ).rejects.toThrow("release notes digest mismatch");
  });

  test("rejects source A combined with receipt/tarball B or tarball B alone", async () => {
    const root = await temporaryDirectory();
    const candidateA = await createMachineCandidate(join(root, "candidate-a"), "A");
    const candidateB = await createMachineCandidate(join(root, "candidate-b"), "B");
    const tarballB = await validateCandidateTarball(
      await realpath(candidateB.tarball),
      candidateB.sha256,
    );

    await expect(
      validateCandidateReceiptIdentity(candidateB.receipt, {
        sourceCommit: candidateA.sourceCommit,
        packageVersion: "0.1.0",
        candidate: tarballB,
        repositoryRoot: candidateA.repository,
      }),
    ).rejects.toThrow("source commit does not match");
    await expect(
      validateCandidateReceiptIdentity(candidateA.receipt, {
        sourceCommit: candidateA.sourceCommit,
        packageVersion: "0.1.0",
        candidate: tarballB,
        repositoryRoot: candidateA.repository,
      }),
    ).rejects.toThrow("artifact path does not match");
  });

  test("rejects a self-consistent source A receipt and manifest for tarball B", async () => {
    const root = await temporaryDirectory();
    const forged = await createMachineCandidate(join(root, "forged-candidate"), "A", "B");
    const tarball = await validateCandidateTarball(await realpath(forged.tarball), forged.sha256);

    await expect(
      validateCandidateReceiptIdentity(forged.receipt, {
        sourceCommit: forged.sourceCommit,
        packageVersion: "0.1.0",
        candidate: tarball,
        repositoryRoot: forged.repository,
      }),
    ).rejects.toThrow(`artifact bytes differ from ${forged.sourceCommit}: package.json`);
  });

  test("rejects special tar permission bits even when the manifest low mode matches", async () => {
    const root = await temporaryDirectory();
    const candidateWithSetuid = await createMachineCandidate(
      join(root, "setuid-candidate"),
      "A",
      "A",
      0o4755,
    );
    const tarball = await validateCandidateTarball(
      await realpath(candidateWithSetuid.tarball),
      candidateWithSetuid.sha256,
    );

    await expect(
      validateCandidateReceiptIdentity(candidateWithSetuid.receipt, {
        sourceCommit: candidateWithSetuid.sourceCommit,
        packageVersion: "0.1.0",
        candidate: tarball,
        repositoryRoot: candidateWithSetuid.repository,
      }),
    ).rejects.toThrow("forbidden special permission bits");
  });

  test("rejects a self-consistent trailing-slash symlink hidden from the manifest", async () => {
    const root = await temporaryDirectory();
    const candidateWithHiddenLink = await createMachineCandidate(
      join(root, "trailing-slash-symlink"),
      "A",
      "A",
      0o644,
      true,
    );
    const tarball = await validateCandidateTarball(
      await realpath(candidateWithHiddenLink.tarball),
      candidateWithHiddenLink.sha256,
    );

    await expect(
      validateCandidateReceiptIdentity(candidateWithHiddenLink.receipt, {
        sourceCommit: candidateWithHiddenLink.sourceCommit,
        packageVersion: "0.1.0",
        candidate: tarball,
        repositoryRoot: candidateWithHiddenLink.repository,
      }),
    ).rejects.toThrow("archive entry type is not allowed: package/hidden-link/");
  });

  test("keeps every mutable root disposable and strips maintainer environment state", async () => {
    const workRoot = await temporaryDirectory();
    const roots = {
      workRoot,
      home: join(workRoot, "home"),
      cache: join(workRoot, "cache"),
      repository: join(workRoot, "repository"),
      install: join(workRoot, "install"),
    };
    expect(() => assertIsolationRoots(roots)).not.toThrow();
    expect(() => assertIsolationRoots({ ...roots, cache: roots.home })).toThrow("distinct");

    const environment = buildIsolatedEnvironment(roots);
    expect(environment["HOME"]).toBe(roots.home);
    expect(environment["npm_config_cache"]).toBe(roots.cache);
    expect(environment["npm_config_prefix"]).toBe(roots.install);
    expect(environment).not.toHaveProperty("NODE_PATH");
    expect(environment).not.toHaveProperty("BEARING_ORIGIN");
  });
});

describe("release smoke packaged documentation", () => {
  test("requires every packaged README relative link target to exist in the exact package", async () => {
    const packageRoot = await temporaryDirectory();
    await mkdir(join(packageRoot, "docs"));
    await writeFile(
      join(packageRoot, "package.json"),
      `${JSON.stringify({ bugs: { url: "https://github.com/lagrangee/bearing/issues" } })}\n`,
    );
    await writeFile(
      join(packageRoot, "README.md"),
      [
        "Package-manager uninstall and setup are separate recovery operations.",
        "[Guide](docs/guide.md#recovery)",
        "[Anchor](#quickstart)",
        "[External](https://example.invalid/docs)",
        "[Email](mailto:maintainer@example.invalid)",
      ].join("\n"),
    );
    await writeFile(join(packageRoot, "README.zh-CN.md"), "[English](README.md)\n");
    const guide = join(packageRoot, "docs/guide.md");
    await writeFile(guide, "# Recovery\n");

    await expect(checkPackagedDocumentation(packageRoot)).resolves.toBeUndefined();
    await rm(guide);
    await expect(checkPackagedDocumentation(packageRoot)).rejects.toThrow(
      "absent from the exact tarball",
    );
  });
});

describe("release smoke seed", () => {
  test("contains only deterministic native context and no generated Bearing state", async () => {
    const files = await auditReleaseSmokeSeed();
    expect(files).toContain("CONTEXT.md");
    expect(files).toContain("scratch/release-smoke/map.md");
    expect(files.some((path) => path.startsWith(".bearing/"))).toBe(false);
    expect(files.some((path) => path.includes("evidence/"))).toBe(false);

    const context = await readFile(join(RELEASE_SMOKE_SEED, "CONTEXT.md"), "utf8");
    expect(context).toContain("ordinary repository");
    expect(context).not.toMatch(/\/(?:Users|home)\/[^/]+\//u);
  });
});
