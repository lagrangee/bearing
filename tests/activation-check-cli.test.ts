import { expect, test } from "bun:test";
import type { Dirent } from "node:fs";
import { mkdir, readdir, readFile, readlink, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ActivationCheck } from "../src/activation-policy";
import { makeTemporaryDirectory } from "./helpers";

const snapshotDirectory = async (root: string): Promise<readonly string[]> => {
  const snapshot: string[] = [];
  const visit = async (relativeDirectory: string): Promise<void> => {
    let entries: Dirent<string>[];
    try {
      entries = await readdir(join(root, relativeDirectory), { withFileTypes: true });
    } catch (error) {
      if (
        relativeDirectory === "" &&
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        snapshot.push("<missing>");
        return;
      }
      throw error;
    }
    for (const entry of [...entries].sort((left, right) => left.name.localeCompare(right.name))) {
      const relative = join(relativeDirectory, entry.name);
      if (entry.isSymbolicLink()) {
        snapshot.push(`link:${relative}->${await readlink(join(root, relative))}`);
      } else if (entry.isDirectory()) {
        snapshot.push(`directory:${relative}`);
        await visit(relative);
      } else if (entry.isFile()) {
        snapshot.push(
          `file:${relative}:${(await readFile(join(root, relative))).toString("base64")}`,
        );
      } else {
        snapshot.push(`other:${relative}`);
      }
    }
  };
  await visit("");
  return snapshot;
};

const runActivationCheck = async (
  repoRoot: string,
  origin: "explicit" | "model-invoked",
): Promise<Readonly<{ stdout: string; stderr: string; exitCode: number }>> => {
  const homeDir = await makeTemporaryDirectory("bearing-activation-home-");
  await mkdir(join(homeDir, ".bearing"));
  await writeFile(join(homeDir, ".bearing/catalog.json"), "{ invalid catalog sentinel\n");
  const repositoryBefore = await snapshotDirectory(repoRoot);
  const homeBefore = await snapshotDirectory(homeDir);
  const child = Bun.spawn(
    [
      "node",
      join(process.cwd(), "dist/cli.js"),
      "activation",
      "check",
      "--origin",
      origin,
      "--repo",
      repoRoot,
    ],
    { env: { ...process.env, HOME: homeDir }, stdout: "pipe", stderr: "pipe" },
  );
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  expect(await snapshotDirectory(repoRoot)).toEqual(repositoryBefore);
  expect(await snapshotDirectory(homeDir)).toEqual(homeBefore);
  return { stdout, stderr, exitCode };
};

const expectSuccessfulCheck = (
  result: Readonly<{ stdout: string; stderr: string; exitCode: number }>,
  expected: ActivationCheck,
): void => {
  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe("");
  expect(result.stdout).toBe(`${JSON.stringify(expected, null, 2)}\n`);
};

const writeManifest = async (
  repoRoot: string,
  overrides: Readonly<Record<string, unknown>> = {},
): Promise<string> => {
  await mkdir(join(repoRoot, ".bearing"), { recursive: true });
  const source = `${JSON.stringify({
    schemaVersion: 1,
    packageVersion: "0.1.0",
    status: "active",
    surfaces: ["agent-skills"],
    executorProfiles: [],
    ...overrides,
  })}\n`;
  await writeFile(join(repoRoot, ".bearing/manifest.json"), source);
  return source;
};

test("an Active repository authorizes model-invoked Bearing activation", async () => {
  const repoRoot = await makeTemporaryDirectory("bearing-activation-active-");
  await writeManifest(repoRoot);

  const result = await runActivationCheck(repoRoot, "model-invoked");

  expectSuccessfulCheck(result, {
    schemaVersion: 1,
    origin: "model-invoked",
    lifecycle: {
      kind: "active",
      reason: "The repository has an explicit active integration lifecycle.",
    },
    modelInvokedEligible: true,
    disposition: "invoke-bearing",
  });
});

test("model-invoked activation continues without Bearing for Fresh and Deactivated repositories", async () => {
  const freshRoot = await makeTemporaryDirectory("bearing-activation-fresh-");
  const fresh = await runActivationCheck(freshRoot, "model-invoked");

  expectSuccessfulCheck(fresh, {
    schemaVersion: 1,
    origin: "model-invoked",
    lifecycle: {
      kind: "fresh",
      reason: "No Bearing manifest or retained Bearing State is present.",
    },
    modelInvokedEligible: false,
    disposition: "continue-without-bearing",
  });

  const deactivatedRoot = await makeTemporaryDirectory("bearing-activation-deactivated-");
  const manifest = await writeManifest(deactivatedRoot, { status: "deactivated" });
  const deactivated = await runActivationCheck(deactivatedRoot, "model-invoked");

  expectSuccessfulCheck(deactivated, {
    schemaVersion: 1,
    origin: "model-invoked",
    lifecycle: {
      kind: "deactivated",
      reason: "The repository has an explicit deactivated integration lifecycle.",
    },
    modelInvokedEligible: false,
    disposition: "continue-without-bearing",
  });
  expect(await readFile(join(deactivatedRoot, ".bearing/manifest.json"), "utf8")).toBe(manifest);
});

test("model-invoked activation requires explicit recovery for invalid or unsupported repositories", async () => {
  for (const [name, manifest, reason] of [
    ["corrupt", "not json\n", "The repository manifest is not valid JSON."],
    [
      "invalid",
      `${JSON.stringify({ schemaVersion: 1, packageVersion: "0.1.0", status: "active" })}\n`,
      "The repository manifest schema is invalid or unsupported.",
    ],
    [
      "newer",
      `${JSON.stringify({
        schemaVersion: 2,
        packageVersion: "0.2.0",
        status: "active",
        surfaces: ["agent-skills"],
        executorProfiles: [],
      })}\n`,
      "Repository uses newer Bearing schema 2; this runtime reads schema 1 only.",
    ],
  ] as const) {
    const repoRoot = await makeTemporaryDirectory(`bearing-activation-${name}-`);
    await mkdir(join(repoRoot, ".bearing"));
    await writeFile(join(repoRoot, ".bearing/manifest.json"), manifest);

    const result = await runActivationCheck(repoRoot, "model-invoked");

    expectSuccessfulCheck(result, {
      schemaVersion: 1,
      origin: "model-invoked",
      lifecycle: { kind: "invalid-or-unsupported", reason },
      modelInvokedEligible: false,
      disposition: "stop-for-explicit-entry",
    });
    expect(await readFile(join(repoRoot, ".bearing/manifest.json"), "utf8")).toBe(manifest);
  }
});

test("explicit entry routes every repository lifecycle without granting model eligibility", async () => {
  const cases = [
    [
      "fresh",
      undefined,
      "enter-setup",
      "No Bearing manifest or retained Bearing State is present.",
    ],
    [
      "active",
      "active",
      "continue-bearing",
      "The repository has an explicit active integration lifecycle.",
    ],
    [
      "deactivated",
      "deactivated",
      "enter-reactivation",
      "The repository has an explicit deactivated integration lifecycle.",
    ],
    ["invalid", "invalid", "enter-recovery", "The repository manifest is not valid JSON."],
  ] as const;

  for (const [name, status, disposition, reason] of cases) {
    const repoRoot = await makeTemporaryDirectory(`bearing-explicit-${name}-`);
    if (status === "invalid") {
      await mkdir(join(repoRoot, ".bearing"));
      await writeFile(join(repoRoot, ".bearing/manifest.json"), "not json\n");
    } else if (status !== undefined) {
      await writeManifest(repoRoot, { status });
    }

    const result = await runActivationCheck(repoRoot, "explicit");

    expectSuccessfulCheck(result, {
      schemaVersion: 1,
      origin: "explicit",
      lifecycle: { kind: name === "invalid" ? "invalid-or-unsupported" : name, reason },
      modelInvokedEligible: name === "active",
      disposition,
    });
  }
});

test("activation check rejects an unsafe manifest shape without following it", async () => {
  const repoRoot = await makeTemporaryDirectory("bearing-activation-linked-");
  const outsideRoot = await makeTemporaryDirectory("bearing-activation-outside-");
  const outsideManifest = join(outsideRoot, "manifest.json");
  const outsideBytes = `${JSON.stringify({ status: "external" })}\n`;
  await writeFile(outsideManifest, outsideBytes);
  await mkdir(join(repoRoot, ".bearing"));
  await symlink(outsideManifest, join(repoRoot, ".bearing/manifest.json"));

  const result = await runActivationCheck(repoRoot, "model-invoked");

  expectSuccessfulCheck(result, {
    schemaVersion: 1,
    origin: "model-invoked",
    lifecycle: {
      kind: "invalid-or-unsupported",
      reason: "The repository manifest must be one safe single-link regular file.",
    },
    modelInvokedEligible: false,
    disposition: "stop-for-explicit-entry",
  });
  expect(await readFile(outsideManifest, "utf8")).toBe(outsideBytes);
});

test("activation check bounds manifest reads and fails closed", async () => {
  const repoRoot = await makeTemporaryDirectory("bearing-activation-oversize-");
  await mkdir(join(repoRoot, ".bearing"));
  await writeFile(join(repoRoot, ".bearing/manifest.json"), " ".repeat(64 * 1024 + 1));

  const result = await runActivationCheck(repoRoot, "model-invoked");

  expectSuccessfulCheck(result, {
    schemaVersion: 1,
    origin: "model-invoked",
    lifecycle: {
      kind: "invalid-or-unsupported",
      reason: "The repository manifest could not be read safely within its bounded inspection.",
    },
    modelInvokedEligible: false,
    disposition: "stop-for-explicit-entry",
  });
});

test("activation check reports an unavailable repository as an operational failure", async () => {
  const parent = await makeTemporaryDirectory("bearing-activation-missing-");
  const result = await runActivationCheck(join(parent, "missing"), "model-invoked");

  expect(result.exitCode).not.toBe(0);
  expect(result.stdout).toBe("");
  expect(result.stderr).toContain("Repository root is unavailable or not a directory");
});
