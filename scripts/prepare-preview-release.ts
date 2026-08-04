import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { valid as validSemver } from "semver";
import {
  markdownCanonicalHeadingTitle,
  parseMarkdownDocument,
  queryMarkdownSections,
} from "../src/markdown-document";

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
  const parsedVersion = validSemver(options.expectedVersion);
  if (
    parsedVersion !== options.expectedVersion ||
    !options.expectedVersion.startsWith("0.") ||
    options.expectedVersion.includes("-") ||
    options.expectedVersion.includes("+")
  ) {
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
  const expectedHeading = `## ${options.expectedVersion} - Unreleased`;
  const document = parseMarkdownDocument(changelog);
  const matchingVersionSections = queryMarkdownSections(document, { depth: 2 }).filter(
    (section) => {
      const title = markdownCanonicalHeadingTitle(document, section);
      return title === options.expectedVersion || title?.startsWith(`${options.expectedVersion} `);
    },
  );
  if (matchingVersionSections.length !== 1) {
    fail(`CHANGELOG must contain exactly one H2 heading for version ${options.expectedVersion}`);
  }
  const section = matchingVersionSections[0] ?? fail("matching CHANGELOG section disappeared");
  if (`## ${markdownCanonicalHeadingTitle(document, section) ?? ""}` !== expectedHeading) {
    fail(`CHANGELOG heading for version ${options.expectedVersion} must be ${expectedHeading}`);
  }
  const releaseNotes = section.markdown.trim();
  if (releaseNotes.length === 0) fail("matching CHANGELOG section must contain release notes");

  await writeFile(options.notesPath, `${releaseNotes}\n`, { flag: "wx" });
  return releaseNotes;
};

const releaseArguments = (): Readonly<{
  packageName: string;
  version: string;
  notes: string;
}> => {
  const parsed = parseArgs({
    args: process.argv.slice(2),
    strict: true,
    allowPositionals: false,
    tokens: true,
    options: {
      package: { type: "string" },
      version: { type: "string" },
      notes: { type: "string" },
    },
  });
  for (const name of ["package", "version", "notes"] as const) {
    if (
      parsed.tokens.filter((token) => token.kind === "option" && token.name === name).length > 1
    ) {
      fail(`duplicate --${name}`);
    }
  }
  const packageName = parsed.values.package ?? fail("missing --package");
  const version = parsed.values.version ?? fail("missing --version");
  const notes = parsed.values.notes ?? fail("missing --notes");
  return { packageName, version, notes };
};

if (import.meta.main) {
  const args = releaseArguments();
  await preparePreviewRelease({
    repositoryRoot: process.cwd(),
    expectedPackage: args.packageName,
    expectedVersion: args.version,
    notesPath: resolve(args.notes),
  });
}
