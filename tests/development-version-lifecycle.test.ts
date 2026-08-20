import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { prerelease, valid as validSemver } from "semver";
import { releaseCandidateId } from "../scripts/release-candidate-lib";

const repositoryRoot = join(import.meta.dirname, "..");

test("the source repository starts the accepted 0.1.2 development line coherently", async () => {
  const [packageMetadata, packageLock, build, runtime, portal] = await Promise.all([
    readFile(join(repositoryRoot, "package.json"), "utf8").then(JSON.parse),
    readFile(join(repositoryRoot, "package-lock.json"), "utf8").then(JSON.parse),
    readFile(join(repositoryRoot, "dist", "development-build.json"), "utf8").then(JSON.parse),
    readFile(join(repositoryRoot, "dist", "development-runtime.json"), "utf8").then(JSON.parse),
    readFile(join(repositoryRoot, "dist", "portal", "asset-manifest.json"), "utf8").then(
      JSON.parse,
    ),
  ]);
  const version = "0.1.2-dev";
  expect(packageMetadata.version).toBe(version);
  expect(packageLock.version).toBe(version);
  expect(packageLock.packages[""]?.version).toBe(version);
  expect(validSemver(version)).toBe(version);
  expect(prerelease(version)).toEqual(["dev"]);
  expect(build.packageVersion).toBe(version);
  expect(runtime.packageVersion).toBe(version);
  expect(portal.packageVersion).toBe(version);

  const cli = spawnSync("node", [join(repositoryRoot, "dist", "cli.js"), "--version"], {
    encoding: "utf8",
  });
  expect(cli.status).toBe(0);
  expect(cli.stdout).toBe(`${version}\n`);
});

test("the explicit lifecycle keeps source finalization, Candidate Freeze, and Publication separate", async () => {
  const [runbook, updateGuide] = await Promise.all([
    readFile(join(repositoryRoot, "docs", "agents", "release-live-journey.md"), "utf8"),
    readFile(
      join(repositoryRoot, "skills", "bearing", "references", "journeys", "update.md"),
      "utf8",
    ),
  ]);
  const lineStart = runbook.indexOf("Development Line Start");
  const localMatrix = runbook.indexOf("## 1. Qualify the Matrix locally");
  const finalization = runbook.indexOf("## 2. Finalize the release source");
  const candidateFreeze = runbook.indexOf("## 4. Coordinate Candidate Freeze");
  const publication = runbook.indexOf("## 8. Dispatch protected Publication");
  expect(lineStart).toBeGreaterThan(-1);
  expect(localMatrix).toBeGreaterThan(lineStart);
  expect(finalization).toBeGreaterThan(localMatrix);
  expect(candidateFreeze).toBeGreaterThan(finalization);
  expect(publication).toBeGreaterThan(candidateFreeze);
  expect(runbook).toMatch(
    /complete Matrix[\s\S]*accepted fix[\s\S]*protected `main`[\s\S]*begin source finalization/iu,
  );
  expect(runbook).toMatch(
    /failed unpublished Candidate[\s\S]*same stable Package Version[\s\S]*new\s+source[\s\S]*artifact[\s\S]*approval[\s\S]*Matrix\s+identit/iu,
  );
  expect(updateGuide).toMatch(
    /0\.1\.1 Active Development Configuration[\s\S]*exact `0\.1\.2-dev` Development Kit[\s\S]*Canonical Bearing State[\s\S]*byte-for-byte unchanged[\s\S]*no\s+provider acquisition/iu,
  );
});

test("an unpublished failed Candidate reuses the version but not immutable proof identity", () => {
  const packageName = "@lagrangee/bearing";
  const packageVersion = "0.1.2";
  const first = releaseCandidateId(
    packageName,
    packageVersion,
    "1".repeat(40),
    `sha256:${"2".repeat(64)}`,
    "100",
    1,
  );
  const replacements = [
    releaseCandidateId(
      packageName,
      packageVersion,
      "3".repeat(40),
      `sha256:${"2".repeat(64)}`,
      "100",
      1,
    ),
    releaseCandidateId(
      packageName,
      packageVersion,
      "1".repeat(40),
      `sha256:${"4".repeat(64)}`,
      "100",
      1,
    ),
    releaseCandidateId(
      packageName,
      packageVersion,
      "1".repeat(40),
      `sha256:${"2".repeat(64)}`,
      "101",
      1,
    ),
  ];
  expect(new Set(replacements)).toHaveLength(replacements.length);
  expect(replacements).not.toContain(first);
});
