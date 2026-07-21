import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

type PreparePreviewReleaseOptions = Readonly<{
  repositoryRoot: string;
  expectedPackage: string;
  expectedVersion: string;
  notesPath: string;
}>;

const fail = (message: string): never => {
  throw new Error(message);
};

export const preparePreviewRelease = async (
  options: PreparePreviewReleaseOptions,
): Promise<string> => {
  if (options.expectedPackage !== "@lagrangee/bearing") {
    fail("Public Preview package must be @lagrangee/bearing");
  }
  if (!/^0\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u.test(options.expectedVersion)) {
    fail("Public Preview version must be a stable 0.x semantic version");
  }

  const packageMetadata = JSON.parse(
    await readFile(resolve(options.repositoryRoot, "package.json"), "utf8"),
  ) as { name?: unknown; version?: unknown };
  if (packageMetadata.name !== options.expectedPackage) {
    fail(`package name did not match ${options.expectedPackage}`);
  }
  if (packageMetadata.version !== options.expectedVersion) {
    fail(`package version did not match ${options.expectedVersion}`);
  }

  const changelog = await readFile(resolve(options.repositoryRoot, "CHANGELOG.md"), "utf8");
  const lines = changelog.split(/\r?\n/u);
  const expectedHeading = `## ${options.expectedVersion} - Unreleased`;
  const escapedVersion = options.expectedVersion.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const versionHeading = new RegExp(`^## ${escapedVersion}(?:\\s|$)`, "u");
  const matchingVersionHeadings = lines.flatMap((line, index) =>
    versionHeading.test(line) ? [index] : [],
  );
  if (matchingVersionHeadings.length !== 1) {
    fail(`CHANGELOG must contain exactly one H2 heading for version ${options.expectedVersion}`);
  }

  const headingIndex = matchingVersionHeadings[0] ?? fail("matching CHANGELOG section disappeared");
  if (lines[headingIndex] !== expectedHeading) {
    fail(`CHANGELOG heading for version ${options.expectedVersion} must be ${expectedHeading}`);
  }
  const nextHeadingOffset = lines.slice(headingIndex + 1).findIndex((line) => /^## /u.test(line));
  const sectionEnd = nextHeadingOffset === -1 ? lines.length : headingIndex + 1 + nextHeadingOffset;
  const releaseNotes = lines
    .slice(headingIndex + 1, sectionEnd)
    .join("\n")
    .trim();
  if (releaseNotes.length === 0) fail("matching CHANGELOG section must contain release notes");

  await writeFile(options.notesPath, `${releaseNotes}\n`, { flag: "wx" });
  return releaseNotes;
};

const argument = (name: string): string => {
  const index = process.argv.indexOf(name);
  const value = process.argv[index + 1];
  if (index === -1 || value === undefined || value.length === 0) {
    return fail(`missing ${name}`);
  }
  return value;
};

if (import.meta.main) {
  await preparePreviewRelease({
    repositoryRoot: process.cwd(),
    expectedPackage: argument("--package"),
    expectedVersion: argument("--version"),
    notesPath: resolve(argument("--notes")),
  });
}
