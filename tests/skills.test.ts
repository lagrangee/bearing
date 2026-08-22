import { describe, expect, test } from "bun:test";
import { readdir, readFile, readlink, realpath } from "node:fs/promises";
import { join, relative } from "node:path";
import {
  type MarkdownDocument,
  type MarkdownTable,
  markdownDocumentBody,
  markdownSemanticPlainText,
  parseMarkdownDocument,
  queryMarkdownDocumentTitle,
  queryMarkdownFrontmatter,
  queryMarkdownInlineCodes,
  queryMarkdownLinks,
  queryMarkdownLists,
  queryMarkdownSections,
  queryMarkdownTable,
} from "../src/markdown-document";

const skillRoot = join(process.cwd(), "skills/bearing");
const developmentSkillRoot = join(process.cwd(), "skills/bearing-dev");

const contractReferences = ["references/contracts/canonical-mutation.md"] as const;
const journeyReferences = [
  "references/journeys/configure.md",
  "references/journeys/configure-fresh.md",
  "references/journeys/configure-active.md",
  "references/journeys/configure-reactivate.md",
  "references/journeys/configure-deactivate.md",
  "references/journeys/configure-unsupported.md",
  "references/journeys/update.md",
  "references/journeys/catalog.md",
  "references/journeys/project-orientation.md",
  "references/journeys/scope-review.md",
  "references/journeys/feature-intake.md",
  "references/journeys/native-work.md",
  "references/journeys/execution.md",
  "references/journeys/next-work.md",
] as const;
const ownerReferences = [
  "references/owners/project-summary.md",
  "references/owners/project-brief.md",
  "references/owners/roadmap.md",
  "references/owners/milestone-gate.md",
  "references/owners/effort.md",
  "references/owners/asset.md",
  "references/owners/authority.md",
  "references/owners/planning-audit.md",
  "references/owners/planning-review.md",
] as const;
const runtimeReferences = [
  ...contractReferences,
  ...journeyReferences,
  ...ownerReferences,
] as const;

const walk = async (directory: string): Promise<string[]> => {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const target = join(directory, entry.name);
      return entry.isDirectory() ? walk(target) : [relative(skillRoot, target)];
    }),
  );
  return files.flat().sort();
};

const readRuntime = (reference: (typeof runtimeReferences)[number]): Promise<string> =>
  readFile(join(skillRoot, reference), "utf8");

const readSkillAt = async (
  root: string,
): Promise<{ document: MarkdownDocument; frontmatter: unknown }> => {
  const source = await readFile(join(root, "SKILL.md"), "utf8");
  const document = parseMarkdownDocument(source);
  const frontmatter = queryMarkdownFrontmatter(document);
  if (frontmatter.state !== "found") throw new Error("Skill has no valid YAML frontmatter.");
  return { document, frontmatter: frontmatter.value };
};

const referencePaths = (document: MarkdownDocument): readonly string[] =>
  [
    ...queryMarkdownInlineCodes(document),
    ...queryMarkdownLinks(document).map((link) => link.target),
  ].filter((value) => value.startsWith("references/"));

const tables = (document: MarkdownDocument): readonly MarkdownTable[] =>
  queryMarkdownSections(document, { depth: 2 }).flatMap((section) => {
    const table = queryMarkdownTable(document, { within: section });
    return table.state === "found" ? [table.value] : [];
  });

const tableWithColumns = (
  document: MarkdownDocument,
  columns: readonly string[],
): MarkdownTable => {
  const matches = tables(document).filter(
    (table) =>
      table.columns.length === columns.length &&
      table.columns.every((column, index) => column === columns[index]),
  );
  if (matches.length !== 1) throw new Error(`Expected one ${columns.join(" / ")} table.`);
  return matches[0] as MarkdownTable;
};

const expectNoUnknownReferencePath = (document: MarkdownDocument): void => {
  const remainder = runtimeReferences.reduce(
    (source, reference) => source.replaceAll(reference, ""),
    markdownSemanticPlainText(markdownDocumentBody(document)),
  );
  expect(remainder).not.toContain("references/");
};

describe("public Bearing Agent surface", () => {
  test("ships the exact one-root, one-hop runtime graph", async () => {
    expect(await walk(skillRoot)).toEqual(["SKILL.md", ...runtimeReferences].sort());

    const topLevel = await readdir(join(process.cwd(), "skills"), { withFileTypes: true });
    expect(
      topLevel
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort(),
    ).toEqual(["bearing", "bearing-dev"]);
  });

  test("keeps valid public and Development entry metadata", async () => {
    const publicEntry = await readSkillAt(skillRoot);
    const developmentEntry = await readSkillAt(developmentSkillRoot);

    expect(publicEntry.frontmatter).toEqual({
      name: "bearing",
      description:
        "Use only for explicit Bearing invocation or when the current repository's Repository Configuration managed pointer nominates Bearing for this request; otherwise use normal Agent behavior.",
    });
    expect(developmentEntry.frontmatter).toEqual({
      name: "bearing-dev",
      description:
        "Use only in the Bearing source repository when its managed pointer selects the Development Runtime, or when explicitly invoked there.",
    });
  });

  test("provides one repository discovery entry for Development", async () => {
    const discoveryEntry = join(process.cwd(), ".agents/skills/bearing-dev");
    expect(await readlink(discoveryEntry)).toBe("../../skills/bearing-dev");
    expect(await realpath(discoveryEntry)).toBe(await realpath(developmentSkillRoot));
  });

  test("routes every runtime reference directly from the public root", async () => {
    const { document } = await readSkillAt(skillRoot);
    const routed = referencePaths(document);

    expect([...new Set(routed)].sort()).toEqual([...runtimeReferences].sort());
    expectNoUnknownReferencePath(document);

    for (const reference of runtimeReferences) {
      const referenceDocument = parseMarkdownDocument(await readRuntime(reference));
      expect(referencePaths(referenceDocument)).toEqual([]);
      expect(markdownSemanticPlainText(markdownDocumentBody(referenceDocument))).not.toContain(
        "references/",
      );
    }
  });

  test("routes Direct Execution through both owner contracts", async () => {
    const { document } = await readSkillAt(skillRoot);
    const routing = tableWithColumns(document, ["Operation", "Load directly"]);
    const directExecution = routing.rows.find(([operation]) => operation === "Direct Execution");
    if (directExecution === undefined) throw new Error("Direct Execution route is absent.");
    const expectedReferences: (typeof runtimeReferences)[number][] = [
      "references/journeys/execution.md",
      "references/journeys/native-work.md",
    ];

    expect(
      runtimeReferences.filter((reference) => directExecution[1]?.includes(reference)).sort(),
    ).toEqual(expectedReferences.sort());
  });

  test("keeps the public root as a compact router with one command table", async () => {
    const { document } = await readSkillAt(skillRoot);
    const commandTable = tableWithColumns(document, ["Meaning", "Command form"]);
    tableWithColumns(document, ["Operation", "Load directly"]);

    expect(commandTable.rows.map((row) => row[1]).sort()).toEqual(
      [
        "bearing configure inspect --repo <repo-root>",
        "bearing configure plan <accepted-arguments>",
        "bearing configure apply <accepted-arguments> --plan-token <token>",
        "bearing inspect project --repo <repo-root>",
        "bearing inspect <stable-planning-reference> --repo <repo-root>",
        "bearing inspect --native <native-reference> --repo <repo-root>",
        "bearing inspect diagnostics --repo <repo-root>",
        "bearing reconcile-native --repo <repo-root> --scope <opaque-native-scope> --ref <native-reference> [--ref <native-reference>]",
      ].sort(),
    );
    expect(queryMarkdownLists(document, { ordered: true })).toEqual([]);
  });

  test("keeps the Development entry as one public-root handoff and one final boundary", async () => {
    const { document } = await readSkillAt(developmentSkillRoot);
    const operationalTokens = queryMarkdownInlineCodes(document);

    expect(operationalTokens).toContain("../bearing/SKILL.md");
    expect(operationalTokens).toContain("node <repo-root>/dist/cli.js");
    expect(operationalTokens).toContain(
      "node <repo-root>/dist/cli.js runtime inspect --repo <repo-root>",
    );
    expect(operationalTokens).not.toContain("$HOME/.bearing/bin/bearing");
    expect(referencePaths(document)).toEqual([]);
    expect(queryMarkdownLists(document, { ordered: true })).toEqual([]);
  });

  test("keeps executable references as plain Markdown documents", async () => {
    for (const reference of runtimeReferences) {
      const document = parseMarkdownDocument(await readRuntime(reference));
      expect(queryMarkdownFrontmatter(document)).toEqual({ state: "absent" });
      expect(queryMarkdownDocumentTitle(document).state).toBe("found");
    }
  });
});
