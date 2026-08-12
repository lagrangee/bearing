import { afterEach, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFile, cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { parse as parseYaml } from "yaml";
import {
  type BundleDependencyMetadata,
  bundlePackageLocatorFromModule,
  findBundleNoticeMismatches,
  normalizeBundleModuleId,
} from "../scripts/bundle-dependency-boundary";
import { findPublicSourceResidue } from "../scripts/check-public-source-residue";
import {
  preparePreviewRelease,
  prepareReleaseCandidateNotes,
} from "../scripts/prepare-preview-release";
import { assertAllowedPackagePaths, requiredPackagePaths } from "../scripts/release-boundary";
import {
  type CandidateManifest,
  type CandidateReceipt,
  releaseCandidateId,
  serializeCandidateJson,
  sha256Bytes,
  verifyReleaseCandidate,
} from "../scripts/release-candidate-lib";
import { assertCandidateSourcesMatchCommit } from "../scripts/release-source-boundary";
import { type TarFixtureEntry, writeTarGzFixture } from "./release-archive-fixture";

const temporaryRoots: string[] = [];

const reviewedActionPins = {
  "actions/checkout": "11d5960a326750d5838078e36cf38b85af677262",
  "actions/setup-go": "4a3601121dd01d1626a1e23e37211e3254c1c06c",
  "actions/setup-node": "49933ea5288caeca8642d1e84afbd3f7d6820020",
  "actions/download-artifact": "d3f86a106a0bac45b974a628896c90dbdf5c8093",
  "actions/upload-artifact": "ea165f8d65b6e75b540449e92b4886f43607fa02",
  "oven-sh/setup-bun": "0c5077e51419868618aeaa5fe8019c62421857d6",
} as const;

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

const makeCandidate = async (
  extraFiles: Readonly<Record<string, string>> = { "dist/extra.js": "extra\n" },
  version = "0.1.0",
): Promise<{
  root: string;
  artifactPath: string;
  manifestPath: string;
  notesPath: string;
  receiptPath: string;
  packageRoot: string;
  receipt: CandidateReceipt;
}> => {
  const root = await mkdtemp(join(tmpdir(), "bearing-candidate-test-"));
  temporaryRoots.push(root);
  const packageRoot = join(root, "staging/package");
  const packageJson = `${JSON.stringify({ name: "@lagrangee/bearing", version })}\n`;
  const packageFiles: Record<string, string> = Object.fromEntries(
    requiredPackagePaths.map((path) => [path, `fixture for ${path}\n`]),
  );
  packageFiles["package.json"] = packageJson;
  Object.assign(packageFiles, extraFiles);
  for (const [path, bytes] of Object.entries(packageFiles)) {
    const target = join(packageRoot, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes);
  }

  const artifactPath = join(root, `lagrangee-bearing-${version}.tgz`);
  await writeTarGzFixture(
    artifactPath,
    Object.entries(packageFiles).map(([path, bytes]) => ({
      path: `package/${path}`,
      bytes,
      mode: 0o644,
    })),
  );

  const manifest: CandidateManifest = {
    schemaVersion: 2,
    packageName: "@lagrangee/bearing",
    packageVersion: version,
    sourceCommit: "a".repeat(40),
    files: Object.entries(packageFiles)
      .map(([path, bytes]) => ({ path, size: Buffer.byteLength(bytes), mode: 420 }))
      .sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0)),
  };
  const manifestPath = join(root, "candidate-manifest.json");
  await writeFile(manifestPath, serializeCandidateJson(manifest));
  const notesPath = join(root, "release-notes.md");
  const releaseNotes = "Release notes.\n";
  await writeFile(notesPath, releaseNotes);
  const artifact = await readFile(artifactPath);
  const receipt: CandidateReceipt = {
    schemaVersion: 2,
    packageName: "@lagrangee/bearing",
    packageVersion: version,
    sourceCommit: "a".repeat(40),
    candidateId: releaseCandidateId(
      "@lagrangee/bearing",
      version,
      "a".repeat(40),
      sha256Bytes(artifact),
      "123456789",
      1,
    ),
    workflow: {
      name: "Candidate Freeze",
      runId: "123456789",
      runAttempt: 1,
    },
    toolchain: {
      node: "v24.15.0",
      bun: "1.3.8",
      npm: "11.11.0",
    },
    artifact: {
      file: `lagrangee-bearing-${version}.tgz`,
      size: artifact.byteLength,
      sha256: sha256Bytes(artifact),
      npmIntegrity: `sha512-${createHash("sha512").update(artifact).digest("base64")}`,
      npmShasum: createHash("sha1").update(artifact).digest("hex"),
    },
    manifest: {
      file: "candidate-manifest.json",
      sha256: sha256Bytes(Buffer.from(serializeCandidateJson(manifest))),
    },
    releaseNotes: {
      file: "release-notes.md",
      sha256: sha256Bytes(Buffer.from(releaseNotes)),
    },
  };
  const receiptPath = join(root, "candidate-receipt.json");
  await writeFile(receiptPath, serializeCandidateJson(receipt));
  return { root, artifactPath, manifestPath, notesPath, receiptPath, packageRoot, receipt };
};

const rewriteCandidateIdentity = async (
  candidate: Awaited<ReturnType<typeof makeCandidate>>,
  manifest: CandidateManifest,
): Promise<void> => {
  await writeFile(candidate.manifestPath, serializeCandidateJson(manifest));
  const artifact = await readFile(candidate.artifactPath);
  const artifactSha256 = sha256Bytes(artifact);
  await writeFile(
    candidate.receiptPath,
    serializeCandidateJson({
      ...candidate.receipt,
      candidateId: releaseCandidateId(
        candidate.receipt.packageName,
        candidate.receipt.packageVersion,
        candidate.receipt.sourceCommit,
        artifactSha256,
        candidate.receipt.workflow.runId,
        candidate.receipt.workflow.runAttempt,
      ),
      artifact: {
        ...candidate.receipt.artifact,
        size: artifact.byteLength,
        sha256: artifactSha256,
        npmIntegrity: `sha512-${createHash("sha512").update(artifact).digest("base64")}`,
        npmShasum: createHash("sha1").update(artifact).digest("hex"),
      },
      manifest: {
        ...candidate.receipt.manifest,
        sha256: sha256Bytes(Buffer.from(serializeCandidateJson(manifest))),
      },
    }),
  );
};

const repackCandidate = async (
  candidate: Awaited<ReturnType<typeof makeCandidate>>,
  special: TarFixtureEntry,
): Promise<void> => {
  const manifest = JSON.parse(await readFile(candidate.manifestPath, "utf8")) as CandidateManifest;
  const entries = await Promise.all(
    manifest.files.map(
      async (file): Promise<TarFixtureEntry> =>
        file.path === special.path
          ? { ...special, path: `package/${special.path}` }
          : {
              path: `package/${file.path}`,
              bytes: await readFile(join(candidate.packageRoot, file.path)),
              mode: file.mode,
            },
    ),
  );
  await writeTarGzFixture(candidate.artifactPath, entries);
};

// Independent raw-header oracle: exercises forbidden mode/path policy without asking
// the production tar-stream stack to generate the adversarial header it must reject.
const rewriteTarEntryMode = async (
  artifactPath: string,
  entryPath: string,
  mode: number,
): Promise<void> => {
  const archive = gunzipSync(await readFile(artifactPath));
  let found = false;
  for (let offset = 0; offset + 512 <= archive.byteLength; ) {
    const header = archive.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const name = header.subarray(0, 100).toString("utf8").replace(/\0.*$/u, "");
    const prefix = header.subarray(345, 500).toString("utf8").replace(/\0.*$/u, "");
    const path = prefix.length === 0 ? name : `${prefix}/${name}`;
    const sizeField = header.subarray(124, 136).toString("ascii").replace(/\0.*$/u, "").trim();
    const size = Number.parseInt(sizeField || "0", 8);
    if (path === entryPath) {
      header.fill(0, 100, 108);
      header.write(mode.toString(8).padStart(7, "0"), 100, "ascii");
      header.fill(0x20, 148, 156);
      const checksum = header.reduce((sum, byte) => sum + byte, 0);
      header.write(checksum.toString(8).padStart(6, "0"), 148, "ascii");
      header[154] = 0;
      header[155] = 0x20;
      found = true;
      break;
    }
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  if (!found) throw new Error(`Tar fixture entry was not found: ${entryPath}`);
  await writeFile(artifactPath, gzipSync(archive));
};

const appendSlashToTarEntryPath = async (
  artifactPath: string,
  entryPath: string,
): Promise<void> => {
  const archive = gunzipSync(await readFile(artifactPath));
  let found = false;
  for (let offset = 0; offset + 512 <= archive.byteLength; ) {
    const header = archive.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const name = header.subarray(0, 100).toString("utf8").replace(/\0.*$/u, "");
    const prefix = header.subarray(345, 500).toString("utf8").replace(/\0.*$/u, "");
    const path = prefix.length === 0 ? name : `${prefix}/${name}`;
    const sizeField = header.subarray(124, 136).toString("ascii").replace(/\0.*$/u, "").trim();
    const size = Number.parseInt(sizeField || "0", 8);
    if (path === entryPath) {
      if (name.length >= 100) throw new Error(`Tar fixture entry name is too long: ${entryPath}`);
      header[name.length] = 0x2f;
      header[name.length + 1] = 0;
      header.fill(0x20, 148, 156);
      const checksum = header.reduce((sum, byte) => sum + byte, 0);
      header.write(checksum.toString(8).padStart(6, "0"), 148, "ascii");
      header[154] = 0;
      header[155] = 0x20;
      found = true;
      break;
    }
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  if (!found) throw new Error(`Tar fixture entry was not found: ${entryPath}`);
  await writeFile(artifactPath, gzipSync(archive));
};

test("verifies one exact candidate artifact, manifest, and receipt", async () => {
  const candidate = await makeCandidate();
  const receipt = await verifyReleaseCandidate(candidate.receiptPath, {
    version: "0.1.0",
    sourceCommit: "a".repeat(40),
  });
  expect(receipt.artifact.sha256).toBe(candidate.receipt.artifact.sha256);
});

test("binds immutable Candidate identity, workflow run, toolchain, and frozen release notes", async () => {
  const candidate = await makeCandidate();
  await expect(
    verifyReleaseCandidate(candidate.receiptPath, {
      workflowName: "Candidate Freeze",
      workflowRunId: "123456789",
      workflowRunAttempt: 1,
    }),
  ).resolves.toMatchObject({ workflow: candidate.receipt.workflow });
  for (const expected of [
    { workflowName: "Different workflow" },
    { workflowRunId: "123456790" },
    { workflowRunAttempt: 2 },
  ]) {
    await expect(verifyReleaseCandidate(candidate.receiptPath, expected)).rejects.toThrow(
      "candidate workflow identity did not match",
    );
  }
  await appendFile(candidate.notesPath, "tampered");
  await expect(verifyReleaseCandidate(candidate.receiptPath)).rejects.toThrow(
    "candidate release notes digest mismatch",
  );
});

test("accepts reusable stable 0.x identity and rejects incomplete workflow identity", async () => {
  const candidate = await makeCandidate({ "dist/extra.js": "extra\n" }, "0.2.0");
  await expect(
    verifyReleaseCandidate(candidate.receiptPath, { version: "0.2.0" }),
  ).resolves.toMatchObject({ packageVersion: "0.2.0" });

  await writeFile(
    candidate.receiptPath,
    serializeCandidateJson({
      ...candidate.receipt,
      workflow: { ...candidate.receipt.workflow, runId: "latest" },
    }),
  );
  await expect(verifyReleaseCandidate(candidate.receiptPath)).rejects.toThrow(
    "candidate workflow identity is invalid",
  );
});

test("changes immutable Candidate identity when workflow run provenance changes", async () => {
  const candidate = await makeCandidate();
  await writeFile(
    candidate.receiptPath,
    serializeCandidateJson({
      ...candidate.receipt,
      workflow: { ...candidate.receipt.workflow, runId: "123456790" },
    }),
  );
  await expect(verifyReleaseCandidate(candidate.receiptPath)).rejects.toThrow(
    "candidate immutable identity mismatch",
  );
});

test("prepares deterministic real Candidate archive bytes and rejects output reuse", async () => {
  const root = await mkdtemp(join(tmpdir(), "bearing-candidate-preparation-"));
  temporaryRoots.push(root);
  const repository = join(root, "repository");
  const cloned = spawnSync(
    "git",
    ["clone", "--local", "--no-hardlinks", process.cwd(), repository],
    { encoding: "utf8" },
  );
  expect(cloned.status, cloned.stderr).toBe(0);

  const metadataPath = join(repository, "package.json");
  const metadata = JSON.parse(await readFile(metadataPath, "utf8")) as Record<string, unknown>;
  await writeFile(metadataPath, `${JSON.stringify({ ...metadata, version: "0.2.0" }, null, 2)}\n`);
  const changelogPath = join(repository, "CHANGELOG.md");
  await writeFile(
    changelogPath,
    "# Changelog\n\n## 0.2.0 - 2026-08-11\n\nControlled Candidate fixture notes.\n",
  );
  await cp(
    resolve("scripts/prepare-release-candidate.ts"),
    join(repository, "scripts/prepare-release-candidate.ts"),
  );
  await symlink(resolve("node_modules"), join(repository, "node_modules"), "dir");
  await appendFile(join(repository, ".git/info/exclude"), "\nnode_modules\n");
  for (const args of [
    ["config", "user.email", "candidate@example.invalid"],
    ["config", "user.name", "Candidate Fixture"],
    ["add", "package.json", "CHANGELOG.md", "scripts/prepare-release-candidate.ts"],
    ["commit", "-qm", "fixture: controlled 0.2.0 candidate"],
  ]) {
    const result = spawnSync("git", ["-C", repository, ...args], { encoding: "utf8" });
    expect(result.status, result.stderr).toBe(0);
  }
  const sourceCommit = spawnSync("git", ["-C", repository, "rev-parse", "HEAD"], {
    encoding: "utf8",
  }).stdout.trim();
  const prepare = (output: string) =>
    spawnSync(
      "bun",
      [
        "scripts/prepare-release-candidate.ts",
        "--out",
        output,
        "--version",
        "0.2.0",
        "--source-commit",
        sourceCommit,
      ],
      {
        cwd: repository,
        encoding: "utf8",
        env: {
          ...process.env,
          GITHUB_WORKFLOW: "Candidate Freeze",
          GITHUB_RUN_ID: "7001",
          GITHUB_RUN_ATTEMPT: "1",
          npm_config_cache: join(root, "npm-cache"),
        },
      },
    );
  const first = join(root, "candidate-a");
  const second = join(root, "candidate-b");
  for (const output of [first, second]) {
    const prepared = prepare(output);
    expect(prepared.status, prepared.stderr).toBe(0);
  }
  const installedNodeVersion = spawnSync("node", ["--version"], {
    cwd: repository,
    encoding: "utf8",
  }).stdout.trim();
  const preparedReceipt = JSON.parse(
    await readFile(join(first, "candidate-receipt.json"), "utf8"),
  ) as CandidateReceipt;
  expect(preparedReceipt.toolchain.node).toBe(installedNodeVersion);
  for (const file of [
    "lagrangee-bearing-0.2.0.tgz",
    "candidate-manifest.json",
    "candidate-receipt.json",
    "release-notes.md",
  ]) {
    expect(await readFile(join(first, file))).toEqual(await readFile(join(second, file)));
  }
  const collision = prepare(first);
  expect(collision.status).not.toBe(0);
  expect(collision.stderr).toContain("candidate output directory must be empty");
}, 30_000);

test("rejects receipt identity mismatch", async () => {
  const candidate = await makeCandidate();
  await expect(
    verifyReleaseCandidate(candidate.receiptPath, { sourceCommit: "b".repeat(40) }),
  ).rejects.toThrow("candidate source commit");
});

test("rejects the wrong package version and unsafe artifact names", async () => {
  const candidate = await makeCandidate();
  await writeFile(
    candidate.receiptPath,
    serializeCandidateJson({ ...candidate.receipt, packageVersion: "1.0.0" }),
  );
  await expect(verifyReleaseCandidate(candidate.receiptPath)).rejects.toThrow(
    "candidate package version must be a stable 0.x semantic version",
  );

  await writeFile(
    candidate.receiptPath,
    serializeCandidateJson({
      ...candidate.receipt,
      artifact: { ...candidate.receipt.artifact, file: "../candidate.tgz" },
    }),
  );
  await expect(verifyReleaseCandidate(candidate.receiptPath)).rejects.toThrow(
    "candidate artifact must be a file name",
  );
});

test("rejects manifest byte mismatch", async () => {
  const candidate = await makeCandidate();
  await appendFile(candidate.manifestPath, " ");
  await expect(verifyReleaseCandidate(candidate.receiptPath)).rejects.toThrow(
    "candidate manifest digest mismatch",
  );
});

test("rejects artifact byte mismatch", async () => {
  const candidate = await makeCandidate();
  await appendFile(candidate.artifactPath, "tampered");
  await expect(verifyReleaseCandidate(candidate.receiptPath)).rejects.toThrow(
    "candidate artifact size mismatch",
  );
});

test("recomputes npm shasum and integrity from artifact bytes", async () => {
  const candidate = await makeCandidate();
  await writeFile(
    candidate.receiptPath,
    serializeCandidateJson({
      ...candidate.receipt,
      artifact: { ...candidate.receipt.artifact, npmShasum: "0".repeat(40) },
    }),
  );
  await expect(verifyReleaseCandidate(candidate.receiptPath)).rejects.toThrow(
    "candidate npm shasum mismatch",
  );

  await writeFile(
    candidate.receiptPath,
    serializeCandidateJson({
      ...candidate.receipt,
      artifact: { ...candidate.receipt.artifact, npmIntegrity: "sha512-invalid" },
    }),
  );
  await expect(verifyReleaseCandidate(candidate.receiptPath)).rejects.toThrow(
    "candidate npm integrity mismatch",
  );
});

test("rejects a self-consistent manifest that does not describe the tarball", async () => {
  const candidate = await makeCandidate();
  const manifest = JSON.parse(await readFile(candidate.manifestPath, "utf8")) as CandidateManifest;
  const incomplete = {
    ...manifest,
    files: manifest.files.filter((file) => file.path !== "dist/extra.js"),
  };
  await writeFile(candidate.manifestPath, serializeCandidateJson(incomplete));
  await writeFile(
    candidate.receiptPath,
    serializeCandidateJson({
      ...candidate.receipt,
      manifest: {
        ...candidate.receipt.manifest,
        sha256: sha256Bytes(Buffer.from(serializeCandidateJson(incomplete))),
      },
    }),
  );
  await expect(verifyReleaseCandidate(candidate.receiptPath)).rejects.toThrow(
    "candidate manifest file set does not match artifact contents",
  );
});

test("rejects a self-consistent manifest with a false tar header mode", async () => {
  const candidate = await makeCandidate();
  const manifest = JSON.parse(await readFile(candidate.manifestPath, "utf8")) as CandidateManifest;
  const falseMode = {
    ...manifest,
    files: manifest.files.map((file) =>
      file.path === "README.md" ? { ...file, mode: 0o755 } : file,
    ),
  };
  await writeFile(candidate.manifestPath, serializeCandidateJson(falseMode));
  await writeFile(
    candidate.receiptPath,
    serializeCandidateJson({
      ...candidate.receipt,
      manifest: {
        ...candidate.receipt.manifest,
        sha256: sha256Bytes(Buffer.from(serializeCandidateJson(falseMode))),
      },
    }),
  );
  await expect(verifyReleaseCandidate(candidate.receiptPath)).rejects.toThrow(
    "candidate file mode mismatch: README.md",
  );
});

test("rejects real tar symlink and FIFO entries even with self-consistent identity", async () => {
  for (const type of ["symlink", "fifo"] as const) {
    const candidate = await makeCandidate();
    await repackCandidate(candidate, {
      path: "README.md",
      type,
      ...(type === "symlink" ? { linkname: "README.zh-CN.md" } : {}),
    });
    const manifest = JSON.parse(
      await readFile(candidate.manifestPath, "utf8"),
    ) as CandidateManifest;
    const specialManifest = {
      ...manifest,
      files: manifest.files.map((file) =>
        file.path === "README.md" ? { ...file, size: 0 } : file,
      ),
    };
    await rewriteCandidateIdentity(candidate, specialManifest);
    await expect(verifyReleaseCandidate(candidate.receiptPath)).rejects.toThrow(
      "candidate file type is not regular: README.md",
    );
  }
});

test("rejects a real trailing-slash symlink omitted from a self-consistent manifest", async () => {
  const candidate = await makeCandidate();
  await repackCandidate(candidate, {
    path: "dist/extra.js",
    type: "symlink",
    linkname: "../README.md",
  });
  await appendSlashToTarEntryPath(candidate.artifactPath, "package/dist/extra.js");
  const manifest = JSON.parse(await readFile(candidate.manifestPath, "utf8")) as CandidateManifest;
  const omitted = {
    ...manifest,
    files: manifest.files.filter((file) => file.path !== "dist/extra.js"),
  };
  await rewriteCandidateIdentity(candidate, omitted);
  await expect(verifyReleaseCandidate(candidate.receiptPath)).rejects.toThrow(
    "candidate file type is not regular: dist/extra.js/",
  );
});

test("rejects a real tar regular file carrying setuid permission bits", async () => {
  const candidate = await makeCandidate();
  await rewriteTarEntryMode(candidate.artifactPath, "package/README.md", 0o4755);
  const manifest = JSON.parse(await readFile(candidate.manifestPath, "utf8")) as CandidateManifest;
  const setuidManifest = {
    ...manifest,
    files: manifest.files.map((file) =>
      file.path === "README.md" ? { ...file, mode: 0o755 } : file,
    ),
  };
  await rewriteCandidateIdentity(candidate, setuidManifest);
  await expect(verifyReleaseCandidate(candidate.receiptPath)).rejects.toThrow(
    "candidate file mode contains special permission bits: README.md",
  );
});

test("rejects a README relative target absent from the exact tarball", async () => {
  const candidate = await makeCandidate({
    "README.md": "[Missing security guidance](docs/missing-security.md)\n",
  });
  await expect(verifyReleaseCandidate(candidate.receiptPath)).rejects.toThrow(
    "missing packaged README target: docs/missing-security.md",
  );
});

test("source-binds tracked package inputs while frozen artifact identity binds generated dist", async () => {
  const candidate = await makeCandidate();
  const repository = join(candidate.root, "repository");
  await cp(candidate.packageRoot, repository, { recursive: true });
  for (const args of [
    ["init", "-q"],
    ["config", "user.email", "test@example.com"],
    ["config", "user.name", "Bearing Test"],
    ["add", "."],
    ["commit", "-qm", "candidate source"],
  ]) {
    const result = spawnSync("git", ["-C", repository, ...args], { encoding: "utf8" });
    expect(result.status, result.stderr).toBe(0);
  }
  const sourceCommit = spawnSync("git", ["-C", repository, "rev-parse", "HEAD"], {
    encoding: "utf8",
  }).stdout.trim();
  const manifest = JSON.parse(await readFile(candidate.manifestPath, "utf8")) as CandidateManifest;
  const boundManifest = { ...manifest, sourceCommit };
  await writeFile(candidate.manifestPath, serializeCandidateJson(boundManifest));
  const boundReceipt = {
    ...candidate.receipt,
    sourceCommit,
    candidateId: releaseCandidateId(
      candidate.receipt.packageName,
      candidate.receipt.packageVersion,
      sourceCommit,
      candidate.receipt.artifact.sha256,
      candidate.receipt.workflow.runId,
      candidate.receipt.workflow.runAttempt,
    ),
    manifest: {
      ...candidate.receipt.manifest,
      sha256: sha256Bytes(Buffer.from(serializeCandidateJson(boundManifest))),
    },
  };
  await writeFile(candidate.receiptPath, serializeCandidateJson(boundReceipt));
  await expect(
    verifyReleaseCandidate(candidate.receiptPath, { sourceCommit, repositoryRoot: repository }),
  ).resolves.toMatchObject({ sourceCommit });

  await writeFile(join(repository, "dist/extra.js"), "different committed dist bytes\n");
  const committed = spawnSync("git", ["-C", repository, "add", "dist/extra.js"], {
    encoding: "utf8",
  });
  expect(committed.status, committed.stderr).toBe(0);
  const nextCommit = spawnSync("git", ["-C", repository, "commit", "-qm", "change dist"], {
    encoding: "utf8",
  });
  expect(nextCommit.status, nextCommit.stderr).toBe(0);
  const changedCommit = spawnSync("git", ["-C", repository, "rev-parse", "HEAD"], {
    encoding: "utf8",
  }).stdout.trim();
  const changedManifest = { ...boundManifest, sourceCommit: changedCommit };
  await writeFile(candidate.manifestPath, serializeCandidateJson(changedManifest));
  await writeFile(
    candidate.receiptPath,
    serializeCandidateJson({
      ...boundReceipt,
      sourceCommit: changedCommit,
      candidateId: releaseCandidateId(
        boundReceipt.packageName,
        boundReceipt.packageVersion,
        changedCommit,
        boundReceipt.artifact.sha256,
        boundReceipt.workflow.runId,
        boundReceipt.workflow.runAttempt,
      ),
      manifest: {
        ...boundReceipt.manifest,
        sha256: sha256Bytes(Buffer.from(serializeCandidateJson(changedManifest))),
      },
    }),
  );
  await expect(
    verifyReleaseCandidate(candidate.receiptPath, {
      sourceCommit: changedCommit,
      repositoryRoot: repository,
    }),
  ).resolves.toMatchObject({ sourceCommit: changedCommit });

  await writeFile(join(repository, "README.md"), "different committed README bytes\n");
  const trackedChange = spawnSync("git", ["-C", repository, "add", "README.md"], {
    encoding: "utf8",
  });
  expect(trackedChange.status, trackedChange.stderr).toBe(0);
  const trackedCommit = spawnSync(
    "git",
    ["-C", repository, "commit", "-qm", "change tracked package input"],
    { encoding: "utf8" },
  );
  expect(trackedCommit.status, trackedCommit.stderr).toBe(0);
  const trackedSourceCommit = spawnSync("git", ["-C", repository, "rev-parse", "HEAD"], {
    encoding: "utf8",
  }).stdout.trim();
  const trackedManifest = { ...boundManifest, sourceCommit: trackedSourceCommit };
  await writeFile(candidate.manifestPath, serializeCandidateJson(trackedManifest));
  await writeFile(
    candidate.receiptPath,
    serializeCandidateJson({
      ...boundReceipt,
      sourceCommit: trackedSourceCommit,
      candidateId: releaseCandidateId(
        boundReceipt.packageName,
        boundReceipt.packageVersion,
        trackedSourceCommit,
        boundReceipt.artifact.sha256,
        boundReceipt.workflow.runId,
        boundReceipt.workflow.runAttempt,
      ),
      manifest: {
        ...boundReceipt.manifest,
        sha256: sha256Bytes(Buffer.from(serializeCandidateJson(trackedManifest))),
      },
    }),
  );
  await expect(
    verifyReleaseCandidate(candidate.receiptPath, {
      sourceCommit: trackedSourceCommit,
      repositoryRoot: repository,
    }),
  ).rejects.toThrow(`candidate artifact bytes differ from ${trackedSourceCommit}: README.md`);
});

test("rejects a self-consistent tarball containing forbidden package content", async () => {
  const candidate = await makeCandidate({ ".scratch/private.md": "private planning\n" });
  await expect(verifyReleaseCandidate(candidate.receiptPath)).rejects.toThrow(
    "forbidden package path: .scratch/private.md",
  );
});

test("rejects public package paths outside the allowlist boundary", () => {
  expect(() => assertAllowedPackagePaths(["dist/cli.js", ".scratch/private.md"])).toThrow(
    "forbidden package path",
  );
});

test("detects only Bearing-owned private staging and dogfood residue", async () => {
  const root = await mkdtemp(join(tmpdir(), "bearing-public-source-test-"));
  temporaryRoots.push(root);
  await mkdir(join(root, ".scratch"), { recursive: true });
  await mkdir(join(root, "test-results"), { recursive: true });
  await mkdir(join(root, "docs"), { recursive: true });
  await writeFile(join(root, ".scratch/private.md"), "private planning\n");
  await writeFile(join(root, "test-results/failure.txt"), "dogfood output\n");
  const maintainerPath = ["", "Users", "clawd", "Projects", "bearing"].join("/");
  await writeFile(join(root, "docs/local.md"), `root=${maintainerPath}\n`);
  await writeFile(join(root, "docs/public.md"), "portable public source\n");
  expect(
    await findPublicSourceResidue(root, [
      ".scratch/private.md",
      "test-results/failure.txt",
      "docs/local.md",
      "docs/public.md",
    ]),
  ).toEqual([
    ".scratch/private.md: private staging path",
    "test-results/failure.txt: dogfood output path",
    "docs/local.md: maintainer absolute path",
  ]);
});

test("does not report its own public-source policy implementation as residue", async () => {
  expect(
    await findPublicSourceResidue(resolve("."), ["scripts/check-public-source-residue.ts"]),
  ).toEqual([]);
});

test("rejects an untracked file selected from an allowlisted package subtree", async () => {
  const root = await mkdtemp(join(tmpdir(), "bearing-source-test-"));
  temporaryRoots.push(root);
  const trackedPath = "skills/bearing/SKILL.md";
  await mkdir(join(root, "skills/bearing"), { recursive: true });
  await writeFile(join(root, trackedPath), "tracked\n");
  for (const args of [
    ["init", "-q"],
    ["config", "user.email", "test@example.com"],
    ["config", "user.name", "Bearing Test"],
    ["add", trackedPath],
    ["commit", "-qm", "fixture"],
  ]) {
    const result = spawnSync("git", ["-C", root, ...args], { encoding: "utf8" });
    expect(result.status, result.stderr).toBe(0);
  }
  const sourceCommit = spawnSync("git", ["-C", root, "rev-parse", "HEAD"], {
    encoding: "utf8",
  }).stdout.trim();
  const untrackedPath = "skills/untracked/SKILL.md";
  await mkdir(join(root, "skills/untracked"), { recursive: true });
  await writeFile(join(root, untrackedPath), "untracked\n");
  const staging = join(root, "staging/package");
  for (const path of [trackedPath, untrackedPath]) {
    const target = join(staging, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, await readFile(join(root, path)));
  }
  const artifact = join(root, "candidate.tgz");
  await writeTarGzFixture(
    artifact,
    await Promise.all(
      [trackedPath, untrackedPath].map(async (path) => ({
        path: `package/${path}`,
        bytes: await readFile(join(root, path)),
      })),
    ),
  );
  await expect(
    assertCandidateSourcesMatchCommit(artifact, [trackedPath, untrackedPath], sourceCommit, root),
  ).rejects.toThrow(`candidate input is not tracked at ${sourceCommit}: ${untrackedPath}`);
});

test("detects a bundled dependency omitted from the notice inventory", async () => {
  const metadata = JSON.parse(
    await readFile("dist/bundle-dependencies.json", "utf8"),
  ) as BundleDependencyMetadata;
  const notices = await readFile("THIRD_PARTY_NOTICES", "utf8");
  const omitted = metadata.packages[0];
  if (omitted === undefined) throw new Error("Expected a built dependency fixture.");
  const identity = `${omitted.name}@${omitted.version} — ${omitted.license}`;
  expect(findBundleNoticeMismatches(metadata, notices.replace(`- ${identity}\n`, ""))).toContain(
    `THIRD_PARTY_NOTICES is missing ${identity}`,
  );
});

test("classifies the actual Rolldown virtual runtime into package and notice inventory", async () => {
  expect(normalizeBundleModuleId("\0rolldown/runtime.js", process.cwd())).toBe(
    "node_modules/rolldown/runtime.js",
  );
  expect(() => normalizeBundleModuleId("\0unknown/runtime.js", process.cwd())).toThrow(
    "Unclassified virtual bundle module",
  );
  const metadata = JSON.parse(
    await readFile("dist/bundle-dependencies.json", "utf8"),
  ) as BundleDependencyMetadata;
  expect(metadata.bundles.portal.packages).toContain("rolldown@1.1.5");
  expect(metadata.packages).toContainEqual({
    name: "rolldown",
    version: "1.1.5",
    license: "MIT",
    bundles: ["portal"],
    locators: ["node_modules/rolldown"],
  });
  expect(await readFile("THIRD_PARTY_NOTICES", "utf8")).toContain("rolldown@1.1.5 — MIT");
});

test("preserves nested lockfile locators and every bundled package version", async () => {
  const nestedModule = join(
    process.cwd(),
    "node_modules/sanitize-html/node_modules/htmlparser2/dist/commonjs/index.js",
  );
  const normalized = normalizeBundleModuleId(nestedModule, process.cwd());
  expect(normalized).toBe(
    "node_modules/sanitize-html/node_modules/htmlparser2/dist/commonjs/index.js",
  );
  expect(bundlePackageLocatorFromModule(normalized ?? "")).toBe(
    "node_modules/sanitize-html/node_modules/htmlparser2",
  );

  const metadata = JSON.parse(
    await readFile("dist/bundle-dependencies.json", "utf8"),
  ) as BundleDependencyMetadata;
  expect(metadata.bundles.cli.packages).toContain("entities@4.5.0");
  expect(metadata.bundles.cli.packages).toContain("entities@8.0.0");
  expect(metadata.packages).toContainEqual({
    name: "htmlparser2",
    version: "12.0.0",
    license: "MIT",
    bundles: ["cli"],
    locators: ["node_modules/sanitize-html/node_modules/htmlparser2"],
  });
});

test("package workflow binds one uploaded candidate to its exact source commit", async () => {
  const workflow = await readFile(".github/workflows/package.yml", "utf8");
  const parsed = parseYaml(workflow) as {
    jobs?: {
      candidate?: {
        steps?: readonly {
          uses?: string;
          name?: string;
          run?: string;
          with?: Readonly<Record<string, string | boolean>>;
        }[];
      };
    };
  };
  const steps = parsed.jobs?.candidate?.steps ?? [];
  const checkoutIndex = steps.findIndex(
    (step) => step.uses === `actions/checkout@${reviewedActionPins["actions/checkout"]}`,
  );
  const prepareIndex = steps.findIndex((step) => step.name === "Prepare frozen Candidate bundle");
  const uploadIndex = steps.findIndex(
    (step) =>
      step.uses === `actions/upload-artifact@${reviewedActionPins["actions/upload-artifact"]}`,
  );
  const scanIndex = steps.findIndex((step) => step.name === "Scan exact candidate tarball");
  const setupGoIndex = steps.findIndex(
    (step) => step.uses === `actions/setup-go@${reviewedActionPins["actions/setup-go"]}`,
  );
  expect(prepareIndex).toBeGreaterThanOrEqual(0);
  expect(checkoutIndex).toBeGreaterThanOrEqual(0);
  const sourceCommitExpression = ["$", "{{ inputs.source_commit }}"].join("");
  expect(steps[checkoutIndex]?.with).toMatchObject({ ref: sourceCommitExpression });
  expect(setupGoIndex).toBeGreaterThanOrEqual(0);
  expect(steps[setupGoIndex]?.with).toEqual({ "go-version": "1.26.5", cache: false });
  expect(scanIndex).toBeGreaterThan(prepareIndex);
  expect(uploadIndex).toBeGreaterThan(prepareIndex);
  expect(uploadIndex).toBeGreaterThan(scanIndex);
  const candidateScan = steps[scanIndex]?.run ?? "";
  expect(candidateScan).toContain("github.com/zricethezav/gitleaks/v8@v8.30.1");
  expect(candidateScan).toContain("candidate-receipt.json");
  expect(candidateScan).toContain("--config .gitleaks.toml");
  expect(candidateScan).toContain("--redact");
  expect(candidateScan).toContain("--max-archive-depth=1");
  expect(candidateScan).toContain('"release-candidate/$CANDIDATE_ARTIFACT"');
  expect(steps[uploadIndex]?.with).toMatchObject({
    name: `bearing-candidate-${sourceCommitExpression}`,
    path: "release-candidate/",
    "if-no-files-found": "error",
  });
});

test("CI and release workflows pin every third-party action to a reviewed commit", async () => {
  const workflowJobs = [
    [
      ".github/workflows/ci.yml",
      [
        "source-quality",
        "safety",
        "runtime-node-24",
        "runtime-node-26",
        "browser-behavior",
        "package-proof",
      ],
    ],
    [".github/workflows/package.yml", ["candidate"]],
    [".github/workflows/publish.yml", ["publish"]],
  ] as const;
  for (const [path, jobNames] of workflowJobs) {
    const workflow = await readFile(path, "utf8");
    const parsed = parseYaml(workflow) as {
      jobs?: Readonly<Record<string, { steps?: readonly { uses?: string }[] }>>;
    };
    for (const jobName of jobNames) {
      const uses = (parsed.jobs?.[jobName]?.steps ?? []).flatMap((step) =>
        step.uses === undefined ? [] : [step.uses],
      );
      expect(uses.length).toBeGreaterThan(0);
      for (const action of uses) {
        const separator = action.lastIndexOf("@");
        const actionName = action.slice(0, separator) as keyof typeof reviewedActionPins;
        expect(action).toBe(`${actionName}@${reviewedActionPins[actionName]}`);
      }
    }
    expect(workflow).not.toMatch(/uses:\s+[^\s]+@v\d+/u);
    for (const [action, sha] of Object.entries(reviewedActionPins)) {
      if (workflow.includes(`${action}@${sha}`)) {
        expect(workflow).toMatch(new RegExp(`${action}@${sha} # v\\d+`, "u"));
      }
    }
  }
});

test("pins direct Gitleaks revision, PR-range, and exact-candidate lanes", async () => {
  const metadata = JSON.parse(await readFile("package.json", "utf8")) as {
    scripts?: Readonly<Record<string, string>>;
  };
  expect(metadata.scripts?.["secret:scan"]).toBeUndefined();
  expect(metadata.scripts?.["public-source:check"]).toBe(
    "bun scripts/check-public-source-residue.ts",
  );
  expect(metadata.scripts?.["gitleaks:revision"]).toBe(
    'go run github.com/zricethezav/gitleaks/v8@v8.30.1 git --redact --config .gitleaks.toml --no-banner --log-opts="-1 HEAD" .',
  );

  const ci = await readFile(".github/workflows/ci.yml", "utf8");
  const parsed = parseYaml(ci) as {
    jobs?: {
      safety?: {
        steps?: readonly {
          name?: string;
          uses?: string;
          run?: string;
          if?: string;
          env?: Readonly<Record<string, string>>;
          with?: Readonly<Record<string, string | boolean>>;
        }[];
      };
    };
  };
  const steps = parsed.jobs?.safety?.steps ?? [];
  const setupGo = steps.find(
    (step) => step.uses === `actions/setup-go@${reviewedActionPins["actions/setup-go"]}`,
  );
  expect(setupGo?.with).toEqual({ "go-version": "1.26.5", cache: false });
  expect(steps.some((step) => step.run === "bun run gitleaks:revision")).toBe(true);
  const pullRequestScan = steps.find((step) => step.name === "Scan pull request range");
  expect(pullRequestScan?.if).toBe("github.event_name == 'pull_request'");
  expect(pullRequestScan?.env).toEqual({
    BASE_SHA: ["$", "{{ github.event.pull_request.base.sha }}"].join(""),
    HEAD_SHA: ["$", "{{ github.event.pull_request.head.sha }}"].join(""),
  });
  expect(pullRequestScan?.run).toContain("github.com/zricethezav/gitleaks/v8@v8.30.1");
  expect(pullRequestScan?.run).toContain('--log-opts="$BASE_SHA..$HEAD_SHA"');
  expect(pullRequestScan?.run).toContain("--config .gitleaks.toml");
  expect(pullRequestScan?.run).toContain("--redact");
});

test("prepares release notes from one matching changelog section", async () => {
  const root = await mkdtemp(join(tmpdir(), "bearing-preview-release-"));
  temporaryRoots.push(root);
  await writeFile(
    join(root, "package.json"),
    `${JSON.stringify({ name: "@lagrangee/bearing", version: "0.2.0" })}\n`,
  );
  await writeFile(
    join(root, "CHANGELOG.md"),
    "# Changelog\n\n## 0.2.0 - Unreleased\n\nPreview notes.\n\n### Added\n\n- One thing.\n\n## 0.1.0 - 2026-01-01\n\nOld notes.\n",
  );
  const notesPath = join(root, "release-notes.md");
  const helperPath = resolve(process.cwd(), "scripts/prepare-preview-release.ts");
  const prepared = spawnSync(
    "bun",
    [helperPath, "--package", "@lagrangee/bearing", "--version", "0.2.0", "--notes", notesPath],
    { cwd: root, encoding: "utf8" },
  );
  expect(prepared.status, prepared.stderr).toBe(0);
  expect(await readFile(notesPath, "utf8")).toBe("Preview notes.\n\n### Added\n\n- One thing.\n");
});

test("prepares Candidate release notes only from one final dated changelog section", async () => {
  const root = await mkdtemp(join(tmpdir(), "bearing-candidate-release-notes-"));
  temporaryRoots.push(root);
  await writeFile(
    join(root, "package.json"),
    `${JSON.stringify({ name: "@lagrangee/bearing", version: "0.2.0" })}\n`,
  );
  const changelogPath = join(root, "CHANGELOG.md");
  await writeFile(
    changelogPath,
    "# Changelog\n\n## 0.2.0 - Unreleased\n\nNot final.\n\n## 0.1.0 - 2026-01-01\n\nOld notes.\n",
  );
  await expect(
    prepareReleaseCandidateNotes({
      repositoryRoot: root,
      expectedPackage: "@lagrangee/bearing",
      expectedVersion: "0.2.0",
      notesPath: join(root, "unreleased.md"),
    }),
  ).rejects.toThrow("final YYYY-MM-DD date");

  await writeFile(
    changelogPath,
    "# Changelog\n\n## 0.2.0 - 2026-08-11\n\nFinal notes.\n\n### Added\n\n- One thing.\n",
  );
  const notesPath = join(root, "final.md");
  await expect(
    prepareReleaseCandidateNotes({
      repositoryRoot: root,
      expectedPackage: "@lagrangee/bearing",
      expectedVersion: "0.2.0",
      notesPath,
    }),
  ).resolves.toBe("Final notes.\n\n### Added\n\n- One thing.");
  expect(await readFile(notesPath, "utf8")).toBe("Final notes.\n\n### Added\n\n- One thing.\n");
});

test("rejects mismatched release identity and duplicate changelog sections", async () => {
  const root = await mkdtemp(join(tmpdir(), "bearing-preview-release-invalid-"));
  temporaryRoots.push(root);
  await writeFile(
    join(root, "package.json"),
    `${JSON.stringify({ name: "@lagrangee/bearing", version: "0.2.0" })}\n`,
  );
  await writeFile(
    join(root, "CHANGELOG.md"),
    "## 0.2.0 - Unreleased\n\nFirst.\n\n## 0.2.0 - 2026-01-01\n\nSecond.\n",
  );
  await expect(
    preparePreviewRelease({
      repositoryRoot: root,
      expectedPackage: "@lagrangee/bearing",
      expectedVersion: "0.1.0",
      notesPath: join(root, "wrong-version.md"),
    }),
  ).rejects.toThrow("package version did not match 0.1.0");
  await expect(
    preparePreviewRelease({
      repositoryRoot: root,
      expectedPackage: "@lagrangee/bearing",
      expectedVersion: "0.2.0",
      notesPath: join(root, "duplicate.md"),
    }),
  ).rejects.toThrow("CHANGELOG must contain exactly one H2 heading for version 0.2.0");
});

test("release entrypoints reject duplicate scalar options without exporting parser wrappers", () => {
  const entrypoints = [
    {
      path: "scripts/prepare-preview-release.ts",
      args: [
        "--package",
        "@lagrangee/bearing",
        "--package",
        "@lagrangee/bearing",
        "--version",
        "0.1.0",
        "--notes",
        "/tmp/notes.md",
      ],
      message: "duplicate --package",
    },
    {
      path: "scripts/prepare-release-candidate.ts",
      args: ["--out", "/tmp/candidate-a", "--out", "/tmp/candidate-b"],
      message: "--out may be provided only once",
    },
    {
      path: "scripts/verify-release-candidate.ts",
      args: ["--receipt", "/tmp/a.json", "--receipt", "/tmp/b.json"],
      message: "--receipt may be provided only once",
    },
    {
      path: "scripts/publish-release-candidate.ts",
      args: ["--receipt", "/tmp/a.json", "--receipt", "/tmp/b.json"],
      message: "--receipt may be provided only once",
    },
  ] as const;
  for (const entrypoint of entrypoints) {
    const result = spawnSync("bun", [entrypoint.path, ...entrypoint.args], { encoding: "utf8" });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(entrypoint.message);
  }
});

test("production portal excludes the Vite modulepreload polyfill runtime", async () => {
  const manifest = JSON.parse(await readFile("dist/portal/asset-manifest.json", "utf8")) as {
    assets: readonly { path: string }[];
  };
  for (const asset of manifest.assets.filter((entry) => entry.path.endsWith(".js"))) {
    const source = await readFile(join("dist/portal", asset.path), "utf8");
    expect(source).not.toContain("relList");
  }
});

test("verify builds ignored dist before any test can consume bundle metadata", async () => {
  const metadata = JSON.parse(await readFile("package.json", "utf8")) as {
    scripts?: Readonly<Record<string, string>>;
  };
  const verify = metadata.scripts?.["verify"] ?? "";
  const buildIndex = verify.indexOf("bun run build");
  const testIndex = verify.indexOf("bun test");
  expect(buildIndex).toBeGreaterThanOrEqual(0);
  expect(testIndex).toBeGreaterThan(buildIndex);
});
