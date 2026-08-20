import { expect, test } from "bun:test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import packageMetadata from "../package.json";
import {
  createDevelopmentBuildFreshnessRecord,
  developmentBuildInputSha256,
  inspectDevelopmentBuildFreshness,
  publishAtomicDevelopmentBuild,
  sha256File,
} from "../src/development-build";
import { buildPortalAssetManifest, writePortalAssetManifest } from "../src/portal/assets";
import { makeTemporaryDirectory } from "./helpers";

const declaredFiles = [
  "index.html",
  "package-lock.json",
  "package.json",
  "scripts/build.ts",
  "scripts/bundle-dependency-boundary.ts",
  "scripts/dependency-license-overrides.ts",
  "src/cli.ts",
  "src/development-build.ts",
  "tsconfig.json",
  "vite.config.ts",
] as const;

const writeDeclaredInputs = async (root: string): Promise<void> => {
  for (const locator of declaredFiles) {
    const path = join(root, locator);
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, `${locator}\n`);
  }
};

const outputFixture = async () => {
  const root = await makeTemporaryDirectory("bearing-build-freshness-");
  const dist = join(root, "dist");
  const portalRoot = join(dist, "portal");
  await mkdir(portalRoot, { recursive: true });
  await writeFile(join(dist, "cli.js"), "cli output\n");
  await writeFile(join(dist, "bundle-dependencies.json"), "{}\n");
  await writeFile(join(portalRoot, "index.html"), "portal output\n");
  const portal = await buildPortalAssetManifest(portalRoot, packageMetadata.version);
  await writePortalAssetManifest(portalRoot, portal);
  const record = createDevelopmentBuildFreshnessRecord({
    packageVersion: packageMetadata.version,
    declaredInputSha256: `sha256:${"1".repeat(64)}`,
    cliSha256: await sha256File(join(dist, "cli.js")),
    portalBuildId: portal.buildId,
    bundleDependenciesSha256: await sha256File(join(dist, "bundle-dependencies.json")),
  });
  await writeFile(join(dist, "development-build.json"), `${JSON.stringify(record)}\n`);
  return { root, dist, portalRoot, record };
};

test("Build Freshness hashes only the declared build-owned boundary", async () => {
  const root = await makeTemporaryDirectory("bearing-build-inputs-");
  await writeDeclaredInputs(root);
  const initial = await developmentBuildInputSha256(root);

  await mkdir(join(root, ".scratch"), { recursive: true });
  await mkdir(join(root, "tests"), { recursive: true });
  await mkdir(join(root, "skills", "bearing-dev"), { recursive: true });
  await writeFile(join(root, ".scratch", "plan.md"), "native planning\n");
  await writeFile(join(root, "tests", "non-build.test.ts"), "test only\n");
  await writeFile(join(root, "skills", "bearing-dev", "SKILL.md"), "live skill\n");
  expect(await developmentBuildInputSha256(root)).toBe(initial);

  await writeFile(join(root, "src", "cli.ts"), "changed executable input\n");
  expect(await developmentBuildInputSha256(root)).not.toBe(initial);
});

test("Build Freshness validates one declared input identity and all published outputs", async () => {
  const value = await outputFixture();
  await expect(
    inspectDevelopmentBuildFreshness({
      packageRoot: value.root,
      declaredInputSha256: value.record.declaredInputSha256,
    }),
  ).resolves.toMatchObject({ status: "current", record: value.record });

  await expect(
    inspectDevelopmentBuildFreshness({
      packageRoot: value.root,
      declaredInputSha256: `sha256:${"2".repeat(64)}`,
    }),
  ).resolves.toMatchObject({ status: "stale", reason: "declared-input-mismatch" });

  await writeFile(join(value.dist, "cli.js"), "damaged output\n");
  await expect(
    inspectDevelopmentBuildFreshness({
      packageRoot: value.root,
      declaredInputSha256: value.record.declaredInputSha256,
    }),
  ).resolves.toMatchObject({ status: "stale", reason: "output-mismatch" });

  const portalDamaged = await outputFixture();
  await writeFile(join(portalDamaged.portalRoot, "index.html"), "damaged portal\n");
  await expect(
    inspectDevelopmentBuildFreshness({
      packageRoot: portalDamaged.root,
      declaredInputSha256: portalDamaged.record.declaredInputSha256,
    }),
  ).resolves.toMatchObject({ status: "stale", reason: "output-mismatch" });

  const outputMissing = await outputFixture();
  await rm(join(outputMissing.dist, "bundle-dependencies.json"));
  await expect(
    inspectDevelopmentBuildFreshness({
      packageRoot: outputMissing.root,
      declaredInputSha256: outputMissing.record.declaredInputSha256,
    }),
  ).resolves.toMatchObject({ status: "stale", reason: "output-mismatch" });

  const contractChanged = await outputFixture();
  await writeFile(
    join(contractChanged.dist, "development-build.json"),
    `${JSON.stringify({ ...contractChanged.record, buildContractVersion: 2 })}\n`,
  );
  await expect(
    inspectDevelopmentBuildFreshness({
      packageRoot: contractChanged.root,
      declaredInputSha256: contractChanged.record.declaredInputSha256,
    }),
  ).resolves.toMatchObject({ status: "stale", reason: "record-unavailable" });
});

test("atomic build publication preserves the prior build on failure and publishes one success", async () => {
  const root = await makeTemporaryDirectory("bearing-build-publication-");
  const finalDist = join(root, "dist");
  const stagedDist = join(root, "staged-dist");
  const missingDist = join(root, "missing-dist");
  await mkdir(finalDist);
  await writeFile(join(finalDist, "identity.txt"), "previous\n");

  await expect(publishAtomicDevelopmentBuild(missingDist, finalDist)).rejects.toThrow();
  expect(await readFile(join(finalDist, "identity.txt"), "utf8")).toBe("previous\n");

  await mkdir(stagedDist);
  await writeFile(join(stagedDist, "identity.txt"), "next\n");
  await publishAtomicDevelopmentBuild(stagedDist, finalDist);
  expect(await readFile(join(finalDist, "identity.txt"), "utf8")).toBe("next\n");
});

test("one successful Build Freshness publication satisfies one stale input until it changes", async () => {
  const value = await outputFixture();
  const nextInputSha256 = `sha256:${"2".repeat(64)}`;
  await expect(
    inspectDevelopmentBuildFreshness({
      packageRoot: value.root,
      declaredInputSha256: nextInputSha256,
    }),
  ).resolves.toMatchObject({ status: "stale", reason: "declared-input-mismatch" });

  const nextRecord = createDevelopmentBuildFreshnessRecord({
    packageVersion: packageMetadata.version,
    declaredInputSha256: nextInputSha256,
    cliSha256: await sha256File(join(value.dist, "cli.js")),
    portalBuildId: value.record.outputs.portalBuildId,
    bundleDependenciesSha256: await sha256File(join(value.dist, "bundle-dependencies.json")),
  });
  await writeFile(join(value.dist, "development-build.json"), `${JSON.stringify(nextRecord)}\n`);
  for (const _attempt of [1, 2]) {
    await expect(
      inspectDevelopmentBuildFreshness({
        packageRoot: value.root,
        declaredInputSha256: nextInputSha256,
      }),
    ).resolves.toMatchObject({ status: "current", record: nextRecord });
  }
});
