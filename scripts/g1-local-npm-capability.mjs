#!/usr/bin/env node

import { createHash } from "node:crypto";
import { copyFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const fail = (message) => {
  process.stderr.write(`${message}\n`);
  process.exit(64);
};

const run = (program, args, options = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(program, args, {
      env: options.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (exitCode) => resolve({ exitCode: exitCode ?? 1, stdout, stderr }));
  });

const configPath = fileURLToPath(new URL("config.json", import.meta.url));
const args = process.argv.slice(2);
const config = JSON.parse(await readFile(configPath, "utf8"));
const targetBytes = await readFile(config.targetArtifact);
const targetSha256 = createHash("sha256").update(targetBytes).digest("hex");
const targetIntegrity = `sha512-${createHash("sha512").update(targetBytes).digest("base64")}`;
if (targetSha256 !== config.targetSha256 || targetIntegrity !== config.targetIntegrity) {
  fail("Bounded npm capability target identity changed.");
}

const viewArgs = [
  "view",
  "@lagrangee/bearing@latest",
  "version",
  "dist.integrity",
  "repository.url",
  "--json",
];
if (JSON.stringify(args) === JSON.stringify(viewArgs)) {
  process.stdout.write(
    `${JSON.stringify({
      version: config.targetVersion,
      "dist.integrity": config.targetIntegrity,
      "repository.url": "git+https://github.com/lagrangee/bearing.git",
    })}\n`,
  );
  process.exit(0);
}

if (
  args[0] === "pack" &&
  args[1] === `@lagrangee/bearing@${config.targetVersion}` &&
  args[2] === "--json" &&
  args[3] === "--pack-destination" &&
  typeof args[4] === "string" &&
  args.length === 5
) {
  const destination = join(args[4], config.targetFile);
  await copyFile(config.targetArtifact, destination);
  process.stdout.write(
    `${JSON.stringify([
      {
        name: "@lagrangee/bearing",
        version: config.targetVersion,
        integrity: config.targetIntegrity,
        filename: config.targetFile,
      },
    ])}\n`,
  );
  process.exit(0);
}

const packageArgument = args[4];
const separator = args[5];
const bearing = args[6];
const install = args[7];
const surfaceArgs = args.slice(8);
if (
  args[0] !== "exec" ||
  JSON.stringify(args.slice(1, 4)) !== JSON.stringify(["--yes", "--no-audit", "--no-fund"]) ||
  typeof packageArgument !== "string" ||
  !packageArgument.startsWith("--package=") ||
  separator !== "--" ||
  bearing !== "bearing" ||
  install !== "install" ||
  surfaceArgs.length % 2 !== 0 ||
  surfaceArgs.some((value, index) =>
    index % 2 === 0
      ? value !== "--surface"
      : !["agent-skills", "claude", "workbuddy"].includes(value),
  )
) {
  fail("Bounded npm capability rejected an out-of-scope command.");
}
const downloadedArtifact = packageArgument.slice("--package=".length);
const downloadedBytes = await readFile(downloadedArtifact);
if (
  basename(downloadedArtifact) !== config.targetFile ||
  createHash("sha256").update(downloadedBytes).digest("hex") !== config.targetSha256
) {
  fail("Bounded npm capability rejected a different exact package.");
}

const installRoot = await mkdtemp(join(tmpdir(), "bearing-g1-exact-package-"));
try {
  const installed = await run(
    config.realNpm,
    [
      "install",
      "--offline",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--prefix",
      installRoot,
      downloadedArtifact,
    ],
    {
      env: {
        ...process.env,
        npm_config_cache: join(installRoot, "npm-cache"),
        npm_config_update_notifier: "false",
      },
    },
  );
  if (installed.exitCode !== 0) {
    process.stderr.write(installed.stderr);
    process.exit(installed.exitCode);
  }
  const applied = await run(
    join(installRoot, "node_modules/.bin/bearing"),
    ["install", ...surfaceArgs],
  );
  process.stdout.write(applied.stdout);
  process.stderr.write(applied.stderr);
  process.exitCode = applied.exitCode;
} finally {
  await rm(installRoot, { recursive: true, force: true });
}
