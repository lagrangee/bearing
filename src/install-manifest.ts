import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { InstallOptions, InstallSurface } from "./types";

export type FileTargetPlan = Readonly<{
  kind?: "file";
  target: string;
  bytes: Buffer;
  executable: boolean;
  mode?: number;
}>;

export type SymlinkTargetPlan = Readonly<{
  kind: "symlink";
  target: string;
  source: string;
}>;

export type DeleteTargetPlan = Readonly<{
  kind: "delete";
  target: string;
}>;

export type TargetPlan = FileTargetPlan | SymlinkTargetPlan | DeleteTargetPlan;

const skillNames = ["bearing"];

export const knownInstallSurfaces = ["agent-skills", "claude", "workbuddy"] as const;

export const installSurfaceDirectory = (homeDir: string, surface: InstallSurface): string => {
  if (surface === "agent-skills") return join(homeDir, ".agents/skills");
  if (surface === "claude") return join(homeDir, ".claude/skills");
  return join(homeDir, ".workbuddy/skills");
};

const listFiles = async (root: string, directory: string): Promise<string[]> => {
  const absolute = join(root, directory);
  const entries = await readdir(absolute, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const locator = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await listFiles(root, locator)));
    else if (entry.isFile()) files.push(locator);
  }
  return files.sort((left, right) => left.localeCompare(right, "en"));
};

const sourceLocators = async (packageRoot: string): Promise<readonly string[]> => {
  const files = ["package.json"];
  files.push(...(await listFiles(packageRoot, "dist")));
  files.push(...(await listFiles(packageRoot, "skills")));
  return files;
};

export const buildBundlePlans = async (
  packageRoot: string,
  bundleRoot: string,
): Promise<readonly FileTargetPlan[]> =>
  Promise.all(
    (await sourceLocators(packageRoot)).map(async (locator) => ({
      kind: "file" as const,
      target: join(bundleRoot, locator),
      bytes: await readFile(join(packageRoot, locator)),
      executable: locator === "dist/cli.js",
    })),
  );

export const buildInstallPlans = async (
  options: InstallOptions,
): Promise<readonly TargetPlan[]> => {
  if (options.surfaces.length === 0) throw new Error("Select at least one Agent Surface.");
  const plans: TargetPlan[] = [];
  for (const locator of await sourceLocators(options.packageRoot)) {
    plans.push({
      kind: "file",
      target: join(options.homeDir, ".bearing/kit/current", locator),
      bytes: await readFile(join(options.packageRoot, locator)),
      executable: locator === "dist/cli.js",
    });
  }
  const cliBytes = await readFile(join(options.packageRoot, "dist/cli.js"));
  plans.push({
    kind: "file",
    target: join(options.homeDir, ".bearing/bin/bearing"),
    bytes: cliBytes,
    executable: true,
  });

  for (const surface of [...new Set(options.surfaces)].sort()) {
    const root = installSurfaceDirectory(options.homeDir, surface);
    for (const skillName of skillNames) {
      plans.push({
        kind: "symlink",
        target: join(root, skillName),
        source: join(options.homeDir, ".bearing/kit/current/skills", skillName),
      });
    }
  }
  return plans.sort((left, right) => left.target.localeCompare(right.target, "en"));
};
