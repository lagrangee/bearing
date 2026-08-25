import { spawn } from "node:child_process";
import { lstat, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { z } from "zod";
import {
  comparePackageVersions,
  installedGlobalKitVersion,
  installedOwnedSurfaces,
} from "./installer";

const PACKAGE_NAME = "@lagrangee/bearing";
const REPOSITORY_URL = "git+https://github.com/lagrangee/bearing.git";
const integritySchema = z.string().regex(/^sha512-[A-Za-z0-9+/]{86}==$/u);

const candidateSchema = z.object({
  version: z.string().min(1),
  "dist.integrity": integritySchema,
  "repository.url": z.literal(REPOSITORY_URL),
});

const packedCandidateSchema = z.tuple([
  z.object({
    name: z.literal(PACKAGE_NAME),
    version: z.string().min(1),
    integrity: integritySchema,
    filename: z.string().min(1),
  }),
]);

type CommandResult = Readonly<{ exitCode: number; stdout: string; stderr: string }>;

const runCommand = async (command: string, args: readonly string[]): Promise<CommandResult> =>
  new Promise((resolve, reject) => {
    const child = spawn(command, [...args], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (exitCode) => resolve({ exitCode: exitCode ?? 1, stdout, stderr }));
  });

export type GlobalKitUpdateCheck =
  | Readonly<{ outcome: "up-to-date"; currentVersion: string }>
  | Readonly<{
      outcome: "update-available";
      currentVersion: string;
      targetVersion: string;
      targetIntegrity: string;
    }>
  | Readonly<{ outcome: "older-candidate"; currentVersion: string; targetVersion: string }>;

export const checkGlobalKitUpdate = async (
  homeDirectory: string,
): Promise<GlobalKitUpdateCheck> => {
  const currentVersion = await installedGlobalKitVersion(homeDirectory);
  const inspected = await runCommand("npm", [
    "view",
    `${PACKAGE_NAME}@latest`,
    "version",
    "dist.integrity",
    "repository.url",
    "--json",
  ]);
  if (inspected.exitCode !== 0) {
    throw new Error(
      `Global Kit update check failed: ${inspected.stderr.trim() || "npm registry query failed"}. No bytes were changed.`,
    );
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(inspected.stdout);
  } catch (error) {
    throw new Error("Global Kit update candidate is unverifiable. No bytes were changed.", {
      cause: error,
    });
  }
  const candidate = candidateSchema.safeParse(decoded);
  if (!candidate.success) {
    throw new Error("Global Kit update candidate is unverifiable. No bytes were changed.", {
      cause: candidate.error,
    });
  }
  let comparison: number;
  try {
    comparison = comparePackageVersions(candidate.data.version, currentVersion);
  } catch (error) {
    throw new Error("Global Kit update candidate is unverifiable. No bytes were changed.", {
      cause: error,
    });
  }
  if (comparison === 0) return { outcome: "up-to-date", currentVersion };
  return comparison > 0
    ? {
        outcome: "update-available",
        currentVersion,
        targetVersion: candidate.data.version,
        targetIntegrity: candidate.data["dist.integrity"],
      }
    : {
        outcome: "older-candidate",
        currentVersion,
        targetVersion: candidate.data.version,
      };
};

export type GlobalKitUpdateResult = Readonly<{
  currentVersion: string;
  targetVersion: string;
  installerStdout: string;
  installerStderr: string;
  installerExitCode: number;
}>;

export const applyGlobalKitUpdate = async (
  homeDirectory: string,
  currentVersion: string,
  targetVersion: string,
  targetIntegrity: string,
): Promise<GlobalKitUpdateResult> => {
  const surfaces = await installedOwnedSurfaces(homeDirectory);
  const downloadDirectory = await mkdtemp(join(tmpdir(), "bearing-global-kit-update-"));
  try {
    const downloaded = await runCommand("npm", [
      "pack",
      `${PACKAGE_NAME}@${targetVersion}`,
      "--json",
      "--pack-destination",
      downloadDirectory,
    ]);
    if (downloaded.exitCode !== 0) {
      throw new Error(
        `Verified exact candidate acquisition failed: ${downloaded.stderr.trim() || "npm pack failed"}. No Global Kit bytes were changed.`,
      );
    }
    let decoded: unknown;
    try {
      decoded = JSON.parse(downloaded.stdout);
    } catch (error) {
      throw new Error(
        "Downloaded exact candidate identity is unverifiable. No Global Kit bytes were changed.",
        {
          cause: error,
        },
      );
    }
    const packed = packedCandidateSchema.safeParse(decoded);
    if (!packed.success) {
      throw new Error(
        "Downloaded exact candidate identity is unverifiable. No Global Kit bytes were changed.",
        {
          cause: packed.error,
        },
      );
    }
    const artifact = packed.data[0];
    if (
      artifact.version !== targetVersion ||
      artifact.integrity !== targetIntegrity ||
      basename(artifact.filename) !== artifact.filename
    ) {
      throw new Error(
        "Downloaded exact candidate does not match the verified update candidate. No Global Kit bytes were changed.",
      );
    }
    const artifactPath = join(downloadDirectory, artifact.filename);
    const artifactState = await lstat(artifactPath);
    if (!artifactState.isFile() || artifactState.nlink !== 1) {
      throw new Error(
        "Downloaded exact candidate is not one safe regular artifact. No Global Kit bytes were changed.",
      );
    }
    const installed = await runCommand("npm", [
      "exec",
      "--yes",
      "--no-audit",
      "--no-fund",
      `--package=${artifactPath}`,
      "--",
      "bearing",
      "install",
      ...surfaces.flatMap((surface) => ["--surface", surface]),
    ]);
    const finalVersion = await installedGlobalKitVersion(homeDirectory);
    if (finalVersion !== targetVersion) {
      const installerFailure = installed.stderr.trim();
      throw new Error(
        `Verified exact candidate installer did not produce the expected complete Global Kit ${targetVersion}; current Kit reports ${finalVersion}.${installerFailure.length === 0 ? "" : ` Exact installer: ${installerFailure}`}`,
      );
    }
    return {
      currentVersion,
      targetVersion,
      installerStdout: installed.stdout,
      installerStderr: installed.stderr,
      installerExitCode: installed.exitCode,
    };
  } finally {
    await rm(downloadDirectory, { recursive: true, force: true });
  }
};
