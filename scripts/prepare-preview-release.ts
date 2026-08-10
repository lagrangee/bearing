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

type ReleaseNotesHeading = "unreleased" | "final-dated";

const fail = (message: string): never => {
  throw new Error(message);
};

const prepareReleaseNotes = async (
  options: PreparePreviewReleaseOptions,
  heading: ReleaseNotesHeading,
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
  const title = markdownCanonicalHeadingTitle(document, section) ?? "";
  if (heading === "unreleased") {
    const expectedHeading = `${options.expectedVersion} - Unreleased`;
    if (title !== expectedHeading) {
      fail(
        `CHANGELOG heading for version ${options.expectedVersion} must be ## ${expectedHeading}`,
      );
    }
  } else {
    const prefix = `${options.expectedVersion} - `;
    const releaseDate = title.startsWith(prefix) ? title.slice(prefix.length) : "";
    const parsedDate = /^\d{4}-\d{2}-\d{2}$/u.test(releaseDate)
      ? new Date(`${releaseDate}T00:00:00.000Z`)
      : undefined;
    if (
      parsedDate === undefined ||
      Number.isNaN(parsedDate.getTime()) ||
      parsedDate.toISOString().slice(0, 10) !== releaseDate
    ) {
      fail(
        `CHANGELOG heading for Candidate version ${options.expectedVersion} must contain one final YYYY-MM-DD date`,
      );
    }
  }
  const releaseNotes = section.markdown.trim();
  if (releaseNotes.length === 0) fail("matching CHANGELOG section must contain release notes");

  await writeFile(options.notesPath, `${releaseNotes}\n`, { flag: "wx" });
  return releaseNotes;
};

export const preparePreviewRelease = async (
  options: PreparePreviewReleaseOptions,
): Promise<string> => prepareReleaseNotes(options, "unreleased");

export const prepareReleaseCandidateNotes = async (
  options: PreparePreviewReleaseOptions,
): Promise<string> => prepareReleaseNotes(options, "final-dated");

const releaseArguments = (): Readonly<{
  packageName: string;
  version: string;
  notes: string;
  final: boolean;
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
      final: { type: "boolean" },
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
  if (
    parsed.tokens.filter((token) => token.kind === "option" && token.name === "final").length > 1
  ) {
    fail("duplicate --final");
  }
  return { packageName, version, notes, final: parsed.values.final === true };
};

if (import.meta.main) {
  const args = releaseArguments();
  const prepare = args.final ? prepareReleaseCandidateNotes : preparePreviewRelease;
  await prepare({
    repositoryRoot: process.cwd(),
    expectedPackage: args.packageName,
    expectedVersion: args.version,
    notesPath: resolve(args.notes),
  });
}
