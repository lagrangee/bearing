import { expect, test } from "bun:test";
import { access, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { makeTemporaryDirectory } from "./helpers";

const runActivationCheck = async (
  repoRoot: string,
  origin: "explicit" | "model-invoked",
): Promise<Readonly<{ stdout: string; stderr: string; exitCode: number }>> => {
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
    { stdout: "pipe", stderr: "pipe" },
  );
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { stdout, stderr, exitCode };
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

  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe("");
  expect(JSON.parse(result.stdout)).toEqual({
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

  expect(fresh.exitCode).toBe(0);
  expect(JSON.parse(fresh.stdout)).toMatchObject({
    lifecycle: { kind: "fresh" },
    modelInvokedEligible: false,
    disposition: "continue-without-bearing",
  });
  await expect(access(join(freshRoot, ".bearing"))).rejects.toThrow();

  const deactivatedRoot = await makeTemporaryDirectory("bearing-activation-deactivated-");
  const manifest = await writeManifest(deactivatedRoot, { status: "deactivated" });
  const deactivated = await runActivationCheck(deactivatedRoot, "model-invoked");

  expect(deactivated.exitCode).toBe(0);
  expect(JSON.parse(deactivated.stdout)).toMatchObject({
    lifecycle: { kind: "deactivated" },
    modelInvokedEligible: false,
    disposition: "continue-without-bearing",
  });
  expect(await readFile(join(deactivatedRoot, ".bearing/manifest.json"), "utf8")).toBe(manifest);
});

test("model-invoked activation requires explicit recovery for invalid or unsupported repositories", async () => {
  for (const [name, manifest] of [
    ["corrupt", "not json\n"],
    [
      "invalid",
      `${JSON.stringify({ schemaVersion: 1, packageVersion: "0.1.0", status: "active" })}\n`,
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
    ],
  ] as const) {
    const repoRoot = await makeTemporaryDirectory(`bearing-activation-${name}-`);
    await mkdir(join(repoRoot, ".bearing"));
    await writeFile(join(repoRoot, ".bearing/manifest.json"), manifest);

    const result = await runActivationCheck(repoRoot, "model-invoked");

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      lifecycle: { kind: "invalid-or-unsupported" },
      modelInvokedEligible: false,
      disposition: "stop-for-explicit-entry",
    });
    expect(await readFile(join(repoRoot, ".bearing/manifest.json"), "utf8")).toBe(manifest);
  }
});

test("explicit entry routes every repository lifecycle without granting model eligibility", async () => {
  const cases = [
    ["fresh", undefined, "enter-setup"],
    ["active", "active", "continue-bearing"],
    ["deactivated", "deactivated", "enter-reactivation"],
    ["invalid", "invalid", "enter-recovery"],
  ] as const;

  for (const [name, status, disposition] of cases) {
    const repoRoot = await makeTemporaryDirectory(`bearing-explicit-${name}-`);
    if (status === "invalid") {
      await mkdir(join(repoRoot, ".bearing"));
      await writeFile(join(repoRoot, ".bearing/manifest.json"), "not json\n");
    } else if (status !== undefined) {
      await writeManifest(repoRoot, { status });
    }

    const result = await runActivationCheck(repoRoot, "explicit");

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      origin: "explicit",
      lifecycle: { kind: name === "invalid" ? "invalid-or-unsupported" : name },
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

  expect(result.exitCode).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({
    lifecycle: { kind: "invalid-or-unsupported" },
    disposition: "stop-for-explicit-entry",
  });
  expect(await readFile(outsideManifest, "utf8")).toBe(outsideBytes);
});

test("activation check reports an unavailable repository as an operational failure", async () => {
  const parent = await makeTemporaryDirectory("bearing-activation-missing-");
  const result = await runActivationCheck(join(parent, "missing"), "model-invoked");

  expect(result.exitCode).not.toBe(0);
  expect(result.stdout).toBe("");
  expect(result.stderr).toContain("Repository root is unavailable or not a directory");
});
