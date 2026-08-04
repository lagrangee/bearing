import { afterEach, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFile, chmod, cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { parse as parseYaml } from "yaml";
import {
  type BundleDependencyMetadata,
  findBundleNoticeMismatches,
  normalizeBundleModuleId,
} from "../scripts/bundle-dependency-boundary";
import { findPublicSourceResidue } from "../scripts/check-public-source-residue";
import { preparePreviewRelease } from "../scripts/prepare-preview-release";
import { assertAllowedPackagePaths, requiredPackagePaths } from "../scripts/release-boundary";
import {
  type CandidateManifest,
  type CandidateReceipt,
  serializeCandidateJson,
  sha256Bytes,
  verifyReleaseCandidate,
} from "../scripts/release-candidate-lib";
import { assertCandidateSourcesMatchCommit } from "../scripts/release-source-boundary";
import { type TarFixtureEntry, writeTarGzFixture } from "./release-archive-fixture";

const temporaryRoots: string[] = [];

const reviewedActionPins = {
  "actions/checkout": "11d5960a326750d5838078e36cf38b85af677262",
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
): Promise<{
  root: string;
  artifactPath: string;
  manifestPath: string;
  receiptPath: string;
  packageRoot: string;
  receipt: CandidateReceipt;
}> => {
  const root = await mkdtemp(join(tmpdir(), "bearing-candidate-test-"));
  temporaryRoots.push(root);
  const packageRoot = join(root, "staging/package");
  const packageJson = `${JSON.stringify({ name: "@lagrangee/bearing", version: "0.1.0" })}\n`;
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

  const artifactPath = join(root, "lagrangee-bearing-0.1.0.tgz");
  await writeTarGzFixture(
    artifactPath,
    Object.entries(packageFiles).map(([path, bytes]) => ({
      path: `package/${path}`,
      bytes,
      mode: 0o644,
    })),
  );

  const manifest: CandidateManifest = {
    schemaVersion: 1,
    packageName: "@lagrangee/bearing",
    packageVersion: "0.1.0",
    sourceCommit: "a".repeat(40),
    files: Object.entries(packageFiles)
      .map(([path, bytes]) => ({ path, size: Buffer.byteLength(bytes), mode: 420 }))
      .sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0)),
  };
  const manifestPath = join(root, "candidate-manifest.json");
  await writeFile(manifestPath, serializeCandidateJson(manifest));
  const artifact = await readFile(artifactPath);
  const receipt: CandidateReceipt = {
    schemaVersion: 1,
    packageName: "@lagrangee/bearing",
    packageVersion: "0.1.0",
    sourceCommit: "a".repeat(40),
    artifact: {
      file: "lagrangee-bearing-0.1.0.tgz",
      size: artifact.byteLength,
      sha256: sha256Bytes(artifact),
      npmIntegrity: `sha512-${createHash("sha512").update(artifact).digest("base64")}`,
      npmShasum: createHash("sha1").update(artifact).digest("hex"),
    },
    manifest: {
      file: "candidate-manifest.json",
      sha256: sha256Bytes(Buffer.from(serializeCandidateJson(manifest))),
    },
  };
  const receiptPath = join(root, "candidate-receipt.json");
  await writeFile(receiptPath, serializeCandidateJson(receipt));
  return { root, artifactPath, manifestPath, receiptPath, packageRoot, receipt };
};

const rewriteCandidateIdentity = async (
  candidate: Awaited<ReturnType<typeof makeCandidate>>,
  manifest: CandidateManifest,
): Promise<void> => {
  await writeFile(candidate.manifestPath, serializeCandidateJson(manifest));
  const artifact = await readFile(candidate.artifactPath);
  await writeFile(
    candidate.receiptPath,
    serializeCandidateJson({
      ...candidate.receipt,
      artifact: {
        ...candidate.receipt.artifact,
        size: artifact.byteLength,
        sha256: sha256Bytes(artifact),
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
    serializeCandidateJson({ ...candidate.receipt, packageVersion: "0.2.0" }),
  );
  await expect(verifyReleaseCandidate(candidate.receiptPath)).rejects.toThrow(
    "candidate package version must be 0.1.0",
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
  });
  expect(await readFile("THIRD_PARTY_NOTICES", "utf8")).toContain("rolldown@1.1.5 — MIT");
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
          with?: Readonly<Record<string, string>>;
        }[];
      };
    };
  };
  const steps = parsed.jobs?.candidate?.steps ?? [];
  const prepareIndex = steps.findIndex(
    (step) => step.run === "bun scripts/prepare-release-candidate.ts --out release-candidate",
  );
  const uploadIndex = steps.findIndex(
    (step) =>
      step.uses === `actions/upload-artifact@${reviewedActionPins["actions/upload-artifact"]}`,
  );
  const scanIndex = steps.findIndex((step) => step.name === "Scan exact candidate tarball");
  expect(prepareIndex).toBeGreaterThanOrEqual(0);
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
    name: ["bearing-candidate-$", "{{ github.sha }}"].join(""),
    path: "release-candidate/",
    "if-no-files-found": "error",
  });
  for (const path of ["SECURITY.md", "CONTRIBUTING.md", "CODE_OF_CONDUCT.md", "docs/cli.md"]) {
    expect(workflow).toContain(`- ${path}`);
  }
});

test("publish workflow has parseable exact-artifact wiring", async () => {
  const workflow = await readFile(".github/workflows/publish-preview.yml", "utf8");
  const parsed = parseYaml(workflow) as {
    permissions?: Readonly<Record<string, string>>;
    jobs?: { publish?: { steps?: readonly { uses?: string; name?: string; run?: string }[] } };
  };
  const steps = parsed.jobs?.publish?.steps ?? [];
  const runProofIndex = steps.findIndex(
    (step) => step.name === "Verify exact successful candidate workflow run",
  );
  const checkoutIndex = steps.findIndex((step) => step.uses?.startsWith("actions/checkout@"));
  const sourceIdentityIndex = steps.findIndex(
    (step) => step.name === "Validate requested package, version, and changelog identity",
  );
  const recoveryIndex = steps.findIndex(
    (step) => step.name === "Recover or publish exact preview state",
  );
  expect(runProofIndex).toBe(0);
  expect(checkoutIndex).toBeGreaterThan(runProofIndex);
  expect(parsed.permissions).toEqual({ actions: "read", contents: "write", "id-token": "write" });
  const runProof = steps[runProofIndex]?.run ?? "";
  expect(runProof).toContain("gh api");
  expect(runProof).toContain("--jq");
  expect(runProof).toContain(".github/workflows/package.yml");
  expect(runProof).not.toContain("scripts/");
  expect(runProof).not.toContain("node ");
  expect(runProof).not.toContain("bun ");
  const dispatchBranchCheck = 'test "$GITHUB_REF_NAME" = "main"';
  const dispatchCommitCheck = 'test "$GITHUB_SHA" = "$EXPECTED_COMMIT"';
  expect(runProof).toContain(dispatchBranchCheck);
  expect(runProof).toContain(dispatchCommitCheck);
  expect(runProof.indexOf(dispatchBranchCheck)).toBeLessThan(runProof.indexOf("gh api"));
  expect(runProof.indexOf(dispatchCommitCheck)).toBeLessThan(runProof.indexOf("gh api"));
  const fakeRoot = await mkdtemp(join(tmpdir(), "bearing-workflow-proof-"));
  temporaryRoots.push(fakeRoot);
  const fakeBin = join(fakeRoot, "bin");
  await mkdir(fakeBin);
  const fakeGh = join(fakeBin, "gh");
  await writeFile(
    fakeGh,
    `#!/bin/sh
test "$1" = "api"
test "$2" = "repos/$GITHUB_REPOSITORY/actions/runs/$EXPECTED_RUN_ID"
test "$3" = "--jq"
printf '%s\\n' "$FAKE_RUN_FACTS"
`,
  );
  await chmod(fakeGh, 0o755);
  const sourceCommit = "a".repeat(40);
  const executeRunProof = (facts: string, dispatchCommit = sourceCommit, dispatchBranch = "main") =>
    spawnSync("/bin/bash", ["--noprofile", "--norc", "-e", "-o", "pipefail", "-c", runProof], {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${fakeBin}:${process.env["PATH"] ?? ""}`,
        EXPECTED_RUN_ID: "123",
        EXPECTED_COMMIT: sourceCommit,
        GITHUB_REPOSITORY: "lagrangee/bearing",
        GH_TOKEN: "test-token",
        GITHUB_REF_NAME: dispatchBranch,
        GITHUB_SHA: dispatchCommit,
        FAKE_RUN_FACTS: facts,
      },
    });
  const successfulFacts = [
    "123",
    ".github/workflows/package.yml",
    "Prepare candidate artifact",
    "workflow_dispatch",
    "completed",
    "success",
    sourceCommit,
  ];
  const successful = executeRunProof(successfulFacts.join("\t"));
  expect(successful.status, successful.stderr).toBe(0);
  const wrongDispatchCommit = executeRunProof(successfulFacts.join("\t"), "b".repeat(40));
  expect(wrongDispatchCommit.status).not.toBe(0);
  const wrongDispatchBranch = executeRunProof(successfulFacts.join("\t"), sourceCommit, "0.1.1");
  expect(wrongDispatchBranch.status).not.toBe(0);
  for (const [index, mismatch] of [
    [0, "999"],
    [1, ".github/workflows/ci.yml"],
    [2, "Different workflow"],
    [3, "pull_request"],
    [4, "in_progress"],
    [5, "failure"],
    [6, "b".repeat(40)],
  ] as const) {
    const rejected = executeRunProof(successfulFacts.with(index, mismatch).join("\t"));
    expect(rejected.status).not.toBe(0);
  }
  const identityIndex = steps.findIndex((step) => step.name === "Verify exact candidate identity");
  expect(identityIndex).toBeGreaterThan(checkoutIndex);
  expect(sourceIdentityIndex).toBeGreaterThan(checkoutIndex);
  expect(identityIndex).toBeGreaterThan(sourceIdentityIndex);
  expect(recoveryIndex).toBeGreaterThan(identityIndex);
  expect(
    steps
      .filter((step) => step.uses !== undefined)
      .every((step) => /@[0-9a-f]{40}$/u.test(step.uses ?? "")),
  ).toBe(true);
  const identity = steps.find((step) => step.name === "Verify exact candidate identity")?.run ?? "";
  expect(identity).toContain('--repo-root "$GITHUB_WORKSPACE"');
  expect(identity).toContain("EXPECTED_FROZEN_SHA256");
  const recovery = steps[recoveryIndex]?.run ?? "";
  expect(recovery).toContain("absent:absent:absent:absent|present:absent:absent:absent");
  expect(recovery).toContain("present:exact:exact:absent|present:exact:exact:exact");
  expect(recovery).toContain("for ATTEMPT in 1 2 3 4 5 6");
  expect(recovery).toContain("--connect-timeout 5 --max-time 15 --retry 0");
  expect(recovery).toContain('packument["dist-tags"]?.latest');
  expect(recovery).toContain("https://slsa.dev/provenance/v1");
  expect(recovery).toContain(`BOOTSTRAP_TOKEN="\${NPM_BOOTSTRAP_TOKEN:-}"`);
  expect(recovery).toContain("unset NPM_BOOTSTRAP_TOKEN NODE_AUTH_TOKEN");
  expect(recovery).toContain('test -n "$BOOTSTRAP_TOKEN"');
  expect(recovery).toContain('NODE_AUTH_TOKEN="$BOOTSTRAP_TOKEN" npm publish');
  expect(recovery).toContain("env -u NODE_AUTH_TOKEN npm publish");
  expect(recovery).toContain("unset BOOTSTRAP_TOKEN");
  expect(recovery).toContain("npm audit signatures --registry=https://registry.npmjs.org");
  expect(recovery.match(/test "\$\(registry_state\)" = exact/gu)?.length).toBeGreaterThanOrEqual(2);
  expect(recovery.match(/test "\$\(tag_state\)" = exact/gu)?.length).toBeGreaterThanOrEqual(2);
  expect(recovery).toContain('test "$(release_state)" = exact');
});

type PublishedSurfaceState =
  | "absent"
  | "exact"
  | "conflict"
  | "conflict-attestation-missing"
  | "conflict-attestation-url"
  | "conflict-integrity"
  | "conflict-latest"
  | "conflict-predicate"
  | "conflict-release-tag"
  | "conflict-title"
  | "conflict-notes"
  | "conflict-prerelease"
  | "unverifiable";

const executePublishRecovery = async (
  initial: {
    registry: PublishedSurfaceState;
    tag: PublishedSurfaceState;
    release: PublishedSurfaceState;
  },
  options: {
    auditFails?: boolean;
    packageExists?: boolean;
    bootstrapToken?: string;
  } = {},
) => {
  const workflow = parseYaml(await readFile(".github/workflows/publish-preview.yml", "utf8")) as {
    jobs?: { publish?: { steps?: readonly { name?: string; run?: string }[] } };
  };
  const recovery = workflow.jobs?.publish?.steps?.find(
    (step) => step.name === "Recover or publish exact preview state",
  )?.run;
  if (recovery === undefined) throw new Error("publish recovery shell was not found");

  const root = await mkdtemp(join(tmpdir(), "bearing-publish-recovery-"));
  temporaryRoots.push(root);
  const stateRoot = join(root, "fake-state");
  const fakeBin = join(root, "bin");
  const candidateRoot = join(root, "release-candidate");
  await Promise.all([mkdir(stateRoot), mkdir(fakeBin), mkdir(candidateRoot)]);

  const expectedCommit = "c".repeat(40);
  const receipt = {
    artifact: {
      file: "lagrangee-bearing-0.1.0.tgz",
      npmShasum: "a".repeat(40),
      npmIntegrity: "sha512-exact-frozen-integrity",
    },
  };
  const notes = "Preview notes.\n\n### Fixed\n\n- Recovery is exact.\n";
  const exactRegistry = {
    name: "@lagrangee/bearing",
    version: "0.1.0",
    dist: {
      shasum: receipt.artifact.npmShasum,
      integrity: receipt.artifact.npmIntegrity,
      attestations: {
        url: "https://registry.npmjs.org/-/npm/v1/attestations/@lagrangee%2fbearing@0.1.0",
        provenance: { predicateType: "https://slsa.dev/provenance/v1" },
      },
    },
  };
  const exactPackument = { "dist-tags": { latest: "0.1.0" } };
  const exactTag = {
    ref: "refs/tags/v0.1.0",
    object: { type: "commit", sha: expectedCommit },
  };
  const exactRelease = {
    tag_name: "v0.1.0",
    name: "@lagrangee/bearing 0.1.0",
    body: notes,
    draft: false,
    prerelease: false,
  };
  await Promise.all([
    writeFile(join(candidateRoot, "candidate-receipt.json"), JSON.stringify(receipt)),
    writeFile(join(candidateRoot, receipt.artifact.file), "frozen artifact fixture\n"),
    writeFile(join(root, "release-notes.md"), notes),
    writeFile(join(stateRoot, "registry-exact.json"), JSON.stringify(exactRegistry)),
    writeFile(join(stateRoot, "packument-exact.json"), JSON.stringify(exactPackument)),
    writeFile(
      join(stateRoot, "packument-conflict-latest.json"),
      JSON.stringify({ "dist-tags": { latest: "0.0.9" } }),
    ),
    writeFile(join(stateRoot, "tag-exact.json"), JSON.stringify(exactTag)),
    writeFile(join(stateRoot, "release-exact.json"), JSON.stringify(exactRelease)),
    writeFile(
      join(stateRoot, "registry-conflict.json"),
      JSON.stringify({ ...exactRegistry, dist: { ...exactRegistry.dist, shasum: "b".repeat(40) } }),
    ),
    writeFile(
      join(stateRoot, "registry-conflict-integrity.json"),
      JSON.stringify({
        ...exactRegistry,
        dist: { ...exactRegistry.dist, integrity: "sha512-conflicting-integrity" },
      }),
    ),
    writeFile(
      join(stateRoot, "registry-conflict-attestation-missing.json"),
      JSON.stringify({
        ...exactRegistry,
        dist: {
          shasum: exactRegistry.dist.shasum,
          integrity: exactRegistry.dist.integrity,
        },
      }),
    ),
    writeFile(
      join(stateRoot, "registry-conflict-attestation-url.json"),
      JSON.stringify({
        ...exactRegistry,
        dist: {
          ...exactRegistry.dist,
          attestations: {
            ...exactRegistry.dist.attestations,
            url: "https://example.test/-/npm/v1/attestations/@lagrangee%2fbearing@0.1.0",
          },
        },
      }),
    ),
    writeFile(
      join(stateRoot, "registry-conflict-predicate.json"),
      JSON.stringify({
        ...exactRegistry,
        dist: {
          ...exactRegistry.dist,
          attestations: {
            ...exactRegistry.dist.attestations,
            provenance: { predicateType: "https://slsa.dev/provenance/v0.2" },
          },
        },
      }),
    ),
    writeFile(
      join(stateRoot, "tag-conflict.json"),
      JSON.stringify({ ...exactTag, object: { type: "commit", sha: "d".repeat(40) } }),
    ),
    writeFile(
      join(stateRoot, "release-conflict.json"),
      JSON.stringify({ ...exactRelease, draft: true }),
    ),
    writeFile(
      join(stateRoot, "release-conflict-release-tag.json"),
      JSON.stringify({ ...exactRelease, tag_name: "v0.2.0" }),
    ),
    writeFile(
      join(stateRoot, "release-conflict-title.json"),
      JSON.stringify({ ...exactRelease, name: "Wrong title" }),
    ),
    writeFile(
      join(stateRoot, "release-conflict-notes.json"),
      JSON.stringify({ ...exactRelease, body: "Wrong notes.\n" }),
    ),
    writeFile(
      join(stateRoot, "release-conflict-prerelease.json"),
      JSON.stringify({ ...exactRelease, prerelease: true }),
    ),
    writeFile(
      join(stateRoot, "installed-package.json"),
      JSON.stringify({ name: "@lagrangee/bearing", version: "0.1.0" }),
    ),
    writeFile(join(stateRoot, "bearing"), "#!/bin/sh\nprintf '%s\\n' '0.1.0'\n"),
  ]);
  await chmod(join(stateRoot, "bearing"), 0o755);

  const seed = async (surface: "registry" | "tag" | "release", state: PublishedSurfaceState) => {
    const status = state === "absent" ? "404" : state === "unverifiable" ? "500" : "200";
    await writeFile(join(stateRoot, `${surface}-status`), `${status}\n`);
    const fixture =
      state.startsWith("conflict") && state !== "conflict-latest"
        ? `${surface}-${state}.json`
        : `${surface}-exact.json`;
    await cp(join(stateRoot, fixture), join(stateRoot, `${surface}.json`));
  };
  await Promise.all([
    seed("registry", initial.registry),
    seed("tag", initial.tag),
    seed("release", initial.release),
    writeFile(
      join(stateRoot, "packument-status"),
      `${initial.registry === "absent" && options.packageExists !== true ? "404" : "200"}\n`,
    ),
    cp(
      join(
        stateRoot,
        initial.registry === "conflict-latest"
          ? "packument-conflict-latest.json"
          : "packument-exact.json",
      ),
      join(stateRoot, "packument.json"),
    ),
  ]);

  const fakeCurl = join(fakeBin, "curl");
  await writeFile(
    fakeCurl,
    `#!/bin/bash
set -euo pipefail
test -z "\${NPM_BOOTSTRAP_TOKEN:-}"
test -z "\${NODE_AUTH_TOKEN:-}"
OUTPUT=
URL=
while test "$#" -gt 0; do
  case "$1" in
    --output) OUTPUT="$2"; shift 2 ;;
    --write-out|--header|--connect-timeout|--max-time|--retry) shift 2 ;;
    --silent|--show-error) shift ;;
    *) URL="$1"; shift ;;
  esac
done
case "$URL" in
  https://registry.npmjs.org/@lagrangee%2fbearing/0.1.0) SURFACE=registry ;;
  https://registry.npmjs.org/@lagrangee%2fbearing) SURFACE=packument ;;
  */git/ref/tags/*) SURFACE=tag ;;
  */releases/tags/*) SURFACE=release ;;
  *) exit 9 ;;
esac
cp "$FAKE_STATE_ROOT/$SURFACE.json" "$OUTPUT"
tr -d '\\n' < "$FAKE_STATE_ROOT/$SURFACE-status"
`,
  );
  await chmod(fakeCurl, 0o755);

  const fakeNpm = join(fakeBin, "npm");
  await writeFile(
    fakeNpm,
    `#!/bin/bash
set -euo pipefail
test -z "\${NPM_BOOTSTRAP_TOKEN:-}"
printf 'npm %s\\n' "$1" >> "$FAKE_STATE_ROOT/calls.log"
case "$1" in
  publish)
    test -z "\${NPM_BOOTSTRAP_TOKEN:-}"
    test "$2" = "$GITHUB_WORKSPACE/release-candidate/lagrangee-bearing-0.1.0.tgz"
    test "$3 $4 $5 $6 $7" = "--access public --provenance --tag latest"
    if test "$(tr -d '\\n' < "$FAKE_STATE_ROOT/initial-package-status")" = 404; then
      test "\${NODE_AUTH_TOKEN:-}" = "$EXPECTED_BOOTSTRAP_TOKEN"
      printf 'npm publish bootstrap\n' >> "$FAKE_STATE_ROOT/calls.log"
    else
      test -z "\${NODE_AUTH_TOKEN:-}"
      printf 'npm publish oidc\n' >> "$FAKE_STATE_ROOT/calls.log"
    fi
    printf '200\\n' > "$FAKE_STATE_ROOT/registry-status"
    cp "$FAKE_STATE_ROOT/registry-exact.json" "$FAKE_STATE_ROOT/registry.json"
    printf '200\\n' > "$FAKE_STATE_ROOT/packument-status"
    cp "$FAKE_STATE_ROOT/packument-exact.json" "$FAKE_STATE_ROOT/packument.json"
    ;;
  init) ;;
  install)
    test "\${!#}" = "@lagrangee/bearing@0.1.0"
    mkdir -p node_modules/@lagrangee/bearing node_modules/.bin
    cp "$FAKE_STATE_ROOT/installed-package.json" node_modules/@lagrangee/bearing/package.json
    cp "$FAKE_STATE_ROOT/bearing" node_modules/.bin/bearing
    ;;
  audit)
    test "$2 $3" = "signatures --registry=https://registry.npmjs.org"
    test "$FAKE_AUDIT_FAIL" != 1
    ;;
  *) exit 8 ;;
esac
`,
  );
  await chmod(fakeNpm, 0o755);

  await cp(join(stateRoot, "packument-status"), join(stateRoot, "initial-package-status"));

  const fakeGh = join(fakeBin, "gh");
  await writeFile(
    fakeGh,
    `#!/bin/bash
set -euo pipefail
test -z "\${NPM_BOOTSTRAP_TOKEN:-}"
test -z "\${NODE_AUTH_TOKEN:-}"
printf 'gh %s\\n' "$1" >> "$FAKE_STATE_ROOT/calls.log"
case "$1" in
  api)
    test "$2 $3" = "--method POST"
    test "$4" = "repos/lagrangee/bearing/git/refs"
    test "$5 $6" = "--field ref=refs/tags/v0.1.0"
    test "$7 $8" = "--field sha=$EXPECTED_COMMIT"
    printf '200\\n' > "$FAKE_STATE_ROOT/tag-status"
    cp "$FAKE_STATE_ROOT/tag-exact.json" "$FAKE_STATE_ROOT/tag.json"
    ;;
  release)
    test "$2 $3" = "create v0.1.0"
    test "$4 $5" = "--repo lagrangee/bearing"
    test "$6" = "--verify-tag"
    test "$7 $8" = "--title @lagrangee/bearing 0.1.0"
    test "$9 \${10}" = "--notes-file $RELEASE_NOTES_PATH"
    printf '200\\n' > "$FAKE_STATE_ROOT/release-status"
    cp "$FAKE_STATE_ROOT/release-exact.json" "$FAKE_STATE_ROOT/release.json"
    ;;
  *) exit 7 ;;
esac
`,
  );
  await chmod(fakeGh, 0o755);

  const result = spawnSync(
    "/bin/bash",
    ["--noprofile", "--norc", "-e", "-o", "pipefail", "-c", recovery],
    {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${fakeBin}:${process.env["PATH"] ?? ""}`,
        FAKE_STATE_ROOT: stateRoot,
        GH_TOKEN: "test-token",
        GITHUB_API_URL: "https://api.github.test",
        GITHUB_REPOSITORY: "lagrangee/bearing",
        GITHUB_WORKSPACE: root,
        EXPECTED_PACKAGE: "@lagrangee/bearing",
        EXPECTED_VERSION: "0.1.0",
        EXPECTED_COMMIT: expectedCommit,
        RELEASE_NOTES_PATH: join(root, "release-notes.md"),
        FAKE_AUDIT_FAIL: options.auditFails === true ? "1" : "0",
        NPM_BOOTSTRAP_TOKEN: options.bootstrapToken ?? "bootstrap-token-fixture",
        EXPECTED_BOOTSTRAP_TOKEN: options.bootstrapToken ?? "bootstrap-token-fixture",
        NODE_AUTH_TOKEN: "must-not-leak-to-oidc",
      },
    },
  );
  const calls = await readFile(join(stateRoot, "calls.log"), "utf8").catch(() => "");
  return { result, calls };
};

test("publish recovery completes each monotonic exact-state prefix without repeating mutations", async () => {
  const scenarios: readonly {
    name: string;
    state: Readonly<{
      registry: PublishedSurfaceState;
      tag: PublishedSurfaceState;
      release: PublishedSurfaceState;
    }>;
    expectedCalls: readonly string[];
  }[] = [
    {
      name: "absent",
      state: { registry: "absent", tag: "absent", release: "absent" } as const,
      expectedCalls: ["npm publish", "gh api", "gh release"],
    },
    {
      name: "npm-only",
      state: { registry: "exact", tag: "absent", release: "absent" } as const,
      expectedCalls: ["gh api", "gh release"],
    },
    {
      name: "npm-and-tag",
      state: { registry: "exact", tag: "exact", release: "absent" } as const,
      expectedCalls: ["gh release"],
    },
    {
      name: "fully-complete",
      state: { registry: "exact", tag: "exact", release: "exact" } as const,
      expectedCalls: [],
    },
  ];
  for (const scenario of scenarios) {
    const { result, calls } = await executePublishRecovery(scenario.state);
    expect(result.status, `${scenario.name}: ${result.stderr}`).toBe(0);
    expect(calls).toContain("npm init");
    expect(calls).toContain("npm install");
    expect(calls).toContain("npm audit");
    for (const mutation of ["npm publish", "gh api", "gh release"]) {
      expect(calls.includes(mutation), `${scenario.name}: ${mutation}`).toBe(
        scenario.expectedCalls.includes(mutation),
      );
    }
  }
}, 30_000);

test("publish recovery scopes bootstrap authentication to an entirely absent package", async () => {
  const bootstrap = await executePublishRecovery(
    { registry: "absent", tag: "absent", release: "absent" },
    { bootstrapToken: "one-time-bootstrap-fixture" },
  );
  expect(bootstrap.result.status, bootstrap.result.stderr).toBe(0);
  expect(bootstrap.calls).toContain("npm publish bootstrap");
  expect(bootstrap.calls).not.toContain("npm publish oidc");

  const oidc = await executePublishRecovery(
    { registry: "absent", tag: "absent", release: "absent" },
    { packageExists: true, bootstrapToken: "must-not-be-forwarded" },
  );
  expect(oidc.result.status, oidc.result.stderr).toBe(0);
  expect(oidc.calls).toContain("npm publish oidc");
  expect(oidc.calls).not.toContain("npm publish bootstrap");

  const missingBootstrap = await executePublishRecovery(
    { registry: "absent", tag: "absent", release: "absent" },
    { bootstrapToken: "" },
  );
  expect(missingBootstrap.result.status).not.toBe(0);
  expect(missingBootstrap.calls).not.toContain("npm publish");
  expect(missingBootstrap.calls).not.toContain("gh api");
  expect(missingBootstrap.calls).not.toContain("gh release");
}, 30_000);

test("publish recovery fails closed on conflicting, out-of-order, or unverifiable state", async () => {
  for (const scenario of [
    { registry: "conflict", tag: "absent", release: "absent" },
    { registry: "conflict-integrity", tag: "absent", release: "absent" },
    { registry: "conflict-latest", tag: "absent", release: "absent" },
    { registry: "conflict-attestation-missing", tag: "absent", release: "absent" },
    { registry: "conflict-attestation-url", tag: "absent", release: "absent" },
    { registry: "conflict-predicate", tag: "absent", release: "absent" },
    { registry: "exact", tag: "conflict", release: "absent" },
    { registry: "exact", tag: "exact", release: "conflict" },
    { registry: "exact", tag: "exact", release: "conflict-release-tag" },
    { registry: "exact", tag: "exact", release: "conflict-title" },
    { registry: "exact", tag: "exact", release: "conflict-notes" },
    { registry: "exact", tag: "exact", release: "conflict-prerelease" },
    { registry: "absent", tag: "exact", release: "absent" },
    { registry: "exact", tag: "unverifiable", release: "absent" },
  ] as const) {
    const { result, calls } = await executePublishRecovery(scenario);
    expect(result.status).not.toBe(0);
    expect(calls).not.toContain("npm publish");
    expect(calls).not.toContain("gh api");
    expect(calls).not.toContain("gh release");
  }
}, 30_000);

test("publish recovery stops before tag creation when npm signature audit fails", async () => {
  const { result, calls } = await executePublishRecovery(
    { registry: "exact", tag: "absent", release: "absent" },
    { auditFails: true },
  );
  expect(result.status).not.toBe(0);
  expect(calls).toContain("npm install");
  expect(calls).toContain("npm audit");
  expect(calls).not.toContain("npm publish");
  expect(calls).not.toContain("gh api");
  expect(calls).not.toContain("gh release");
});

test("CI and release workflows pin every third-party action to a reviewed commit", async () => {
  const workflowJobs = [
    [".github/workflows/ci.yml", ["secrets", "verify", "browser"]],
    [".github/workflows/package.yml", ["candidate"]],
    [".github/workflows/publish-preview.yml", ["publish"]],
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
      secrets?: {
        steps?: readonly {
          name?: string;
          run?: string;
          if?: string;
          env?: Readonly<Record<string, string>>;
        }[];
      };
    };
  };
  const steps = parsed.jobs?.secrets?.steps ?? [];
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

test("CI matrix executes the built CLI with each selected Node runtime", async () => {
  const workflow = await readFile(".github/workflows/ci.yml", "utf8");
  const parsed = parseYaml(workflow) as {
    jobs?: {
      verify?: {
        strategy?: { matrix?: { "node-version"?: readonly (number | string)[] } };
        steps?: readonly { name?: string; run?: string }[];
      };
      browser?: {
        steps?: readonly { uses?: string; with?: { "node-version"?: number | string } }[];
      };
    };
  };
  const steps = parsed.jobs?.verify?.steps ?? [];
  expect(parsed.jobs?.verify?.strategy?.matrix?.["node-version"]).toEqual(["24.15.0", 26]);
  expect(
    steps.some(
      (step) =>
        step.name === "Execute built CLI with Node $" + "{{ matrix.node-version }}" &&
        step.run === "node dist/cli.js --version",
    ),
  ).toBe(true);
  const browserNode = (parsed.jobs?.browser?.steps ?? []).find((step) =>
    step.uses?.startsWith("actions/setup-node@"),
  );
  expect(browserNode?.with?.["node-version"]).toBe("24.15.0");
});

test("CI can run manually on the exact dispatched clean-root ref", async () => {
  const workflow = await readFile(".github/workflows/ci.yml", "utf8");
  const parsed = parseYaml(workflow) as { on?: Readonly<Record<string, unknown>> };
  expect(Object.hasOwn(parsed.on ?? {}, "workflow_dispatch")).toBe(true);
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
