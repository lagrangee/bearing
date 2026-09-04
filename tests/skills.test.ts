import { describe, expect, test } from "bun:test";
import { readdir, readFile, readlink, realpath } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
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
  "references/journeys/project-read-model.md",
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

const semanticTokens = (cell: string | undefined): string[] =>
  cell
    ?.split(";")
    .map((token) => token.trim())
    .sort() ?? [];

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

    for (const [entry, name] of [
      [publicEntry, "bearing"],
      [developmentEntry, "bearing-dev"],
    ] as const) {
      expect(entry.frontmatter).toMatchObject({ name });
      expect(typeof (entry.frontmatter as { description?: unknown }).description).toBe("string");
      expect(Object.keys(entry.frontmatter as object).sort()).toEqual(["description", "name"]);
    }
    expect(publicEntry.frontmatter).toMatchObject({
      description:
        "Coordinate Bearing planning, repository integration, and provider-native work when explicitly requested or nominated by the active repository's managed Bearing pointer.",
    });
    expect(developmentEntry.frontmatter).toMatchObject({
      description:
        "Use the repository-local Bearing Development Runtime when explicitly requested in the Bearing source repository or selected by its managed pointer.",
    });
  });

  test("provides one repository discovery entry for Development", async () => {
    const discoveryEntry = join(process.cwd(), ".agents/skills/bearing-dev");
    expect(await readlink(discoveryEntry)).toBe("../../skills/bearing-dev");
    expect(await realpath(discoveryEntry)).toBe(await realpath(developmentSkillRoot));
  });

  test("resolves the public root from canonical and managed Development entry locators", async () => {
    const entryLocators = [developmentSkillRoot, join(process.cwd(), ".agents/skills/bearing-dev")];
    const expectedPublicRoot = await realpath(join(skillRoot, "SKILL.md"));

    for (const entryLocator of entryLocators) {
      const { document } = await readSkillAt(entryLocator);
      const references = queryMarkdownInlineCodes(document).filter((value) =>
        value.endsWith("bearing/SKILL.md"),
      );
      expect(references).toHaveLength(1);
      const reference = references[0] as string;
      const repositoryPrefix = "<repo-root>/";
      const publicRootLocator = reference.startsWith(repositoryPrefix)
        ? join(process.cwd(), reference.slice(repositoryPrefix.length))
        : resolve(entryLocator, reference);

      expect(await realpath(publicRootLocator)).toBe(expectedPublicRoot);
    }
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

  test("routes Direct Execution through execution, exact start, and conditional basis contracts", async () => {
    const { document } = await readSkillAt(skillRoot);
    const routing = tableWithColumns(document, ["Operation", "Load directly"]);
    const directExecution = routing.rows.find(([operation]) => operation === "Direct Execution");
    if (directExecution === undefined) throw new Error("Direct Execution route is absent.");
    const expectedReferences: (typeof runtimeReferences)[number][] = [
      "references/contracts/canonical-mutation.md",
      "references/journeys/execution.md",
      "references/journeys/native-work.md",
      "references/journeys/project-read-model.md",
      "references/owners/effort.md",
    ];

    expect(
      runtimeReferences.filter((reference) => directExecution[1]?.includes(reference)).sort(),
    ).toEqual(expectedReferences.sort());
  });

  test("routes cross-Skill native work through one executable journey", async () => {
    const { document } = await readSkillAt(skillRoot);
    const routing = tableWithColumns(document, ["Operation", "Load directly"]);
    const nativeWork = routing.rows.find(
      ([operation]) => operation === "Native work, including through another Skill",
    );
    if (nativeWork === undefined) throw new Error("Cross-Skill Native Work route is absent.");
    const expectedReferences: (typeof runtimeReferences)[number][] = [
      "references/journeys/native-work.md",
      "references/journeys/project-read-model.md",
    ];
    expect(
      runtimeReferences.filter((reference) => nativeWork[1]?.includes(reference)).sort(),
    ).toEqual(expectedReferences.sort());

    const nativeDocument = parseMarkdownDocument(
      await readRuntime("references/journeys/native-work.md"),
    );
    const boundaries = tableWithColumns(nativeDocument, ["Owner state", "Provider follow-up"]);
    expect(boundaries.rows.map(([state]) => state)).toEqual([
      "human-handoff",
      "workflow-complete; existing-binding; pending-native-write-set-present",
      "workflow-complete; accepted-new-binding",
      "workflow-complete; unbound-native-work",
      "workflow-complete; no-pending-native-write-set",
      "workflow-failed",
    ]);
  });

  test("preserves invoked native owners and their sole pre-admission claim exception", async () => {
    const nativeWork = parseMarkdownDocument(
      await readRuntime("references/journeys/native-work.md"),
    );
    const claims = tableWithColumns(nativeWork, ["Owner mode", "Claim authority"]);
    expect(new Map(claims.rows.map(([mode, authority]) => [mode, authority] as const))).toEqual(
      new Map([
        ["invoked-owner-workflow-with-required-claim", "exact-owner-defined-claim-only"],
        ["ordinary-owner-work", "none"],
        ["owner-workflow-without-claim", "none"],
      ]),
    );
  });

  test("routes exact Effort start directly to its four Bearing owners", async () => {
    const { document } = await readSkillAt(skillRoot);
    const routing = tableWithColumns(document, ["Operation", "Load directly"]);
    const effortStart = routing.rows.find(
      ([operation]) => operation === "Start or enroll an Effort through Matt work",
    );
    if (effortStart === undefined) throw new Error("Exact Effort start route is absent.");
    const expectedReferences: (typeof runtimeReferences)[number][] = [
      "references/contracts/canonical-mutation.md",
      "references/owners/effort.md",
      "references/journeys/native-work.md",
      "references/journeys/project-read-model.md",
    ];

    expect(
      runtimeReferences.filter((reference) => effortStart[1]?.includes(reference)).sort(),
    ).toEqual(expectedReferences.sort());
  });

  test("keeps bare Matt work standalone before one evidence-backed enrollment choice", async () => {
    const document = parseMarkdownDocument(await readRuntime("references/journeys/native-work.md"));
    const boundary = tableWithColumns(document, [
      "Evidence",
      "Native disposition",
      "Bearing continuation",
    ]);
    const rows = new Map(
      boundary.rows.map(([evidence, native, bearing]) => [
        evidence,
        { native, bearing: semanticTokens(bearing) },
      ]),
    );

    expect(rows.get("no-direct-high-confidence-relationship")).toEqual({
      native: "standalone",
      bearing: ["no-suggestion-or-enrollment"],
    });
    for (const evidence of [
      "direct-high-confidence-existing-planned-effort",
      "direct-high-confidence-useful-new-effort",
    ]) {
      expect(rows.get(evidence)).toEqual({
        native: "standalone",
        bearing: ["at-most-one-advisory-suggestion", "no-enrollment-without-acceptance"],
      });
    }
    for (const evidence of [
      "semantic-similarity-only",
      "artifact-existence-only",
      "provider-lifecycle-only",
      "provider-completion-only",
      "tests-only",
      "capture-only",
      "reconciliation-only",
      "portal-observation-only",
    ]) {
      expect(rows.get(evidence)).toEqual({
        native: "standalone",
        bearing: ["no-enrollment-or-activation"],
      });
    }
  });

  test("contracts consent outcomes without a persisted enrollment workflow", async () => {
    const document = parseMarkdownDocument(await readRuntime("references/owners/effort.md"));
    const outcomes = tableWithColumns(document, [
      "Decision",
      "Target condition",
      "Canonical outcome",
      "Provider follow-up",
    ]);

    const rows = new Map(
      outcomes.rows.map(([decision, target, canonical, provider]) => [
        decision,
        {
          target: semanticTokens(target),
          canonical: semanticTokens(canonical),
          provider: semanticTokens(provider),
        },
      ]),
    );

    expect(rows.get("refuse")).toEqual({
      target: ["existing-planned-effort", "standalone-scope"],
      canonical: [
        "no-binding",
        "no-hidden-recommendation-state",
        "no-lifecycle-event",
        "planned-not-created",
      ],
      provider: ["none"],
    });
    expect(rows.get("accept-existing")).toEqual({
      target: ["no-binding", "planned", "standalone-scope"],
      canonical: ["activation-event-time", "active", "binding"],
      provider: ["exact-scope-capture"],
    });
    expect(rows.get("accept-new")).toEqual({
      target: ["standalone-scope", "useful-new-effort"],
      canonical: ["activation-event-time", "active", "binding", "complete-commitment"],
      provider: ["exact-scope-capture"],
    });
    expect(rows.get("accept-existing-bound")).toEqual({
      target: ["binding-exists"],
      canonical: ["no-duplicate-effort", "no-rebind", "no-winning-scope", "reject"],
      provider: ["none"],
    });
  });

  test("routes accepted Feature Intake dispositions to their semantic owners", async () => {
    const document = parseMarkdownDocument(
      await readRuntime("references/journeys/feature-intake.md"),
    );
    const continuations = tableWithColumns(document, [
      "Accepted disposition",
      "Condition",
      "Continuation",
    ]);
    const rows = new Map(
      continuations.rows.map(([disposition, condition, continuation]) => [
        disposition,
        {
          condition: semanticTokens(condition),
          continuation: semanticTokens(continuation),
        },
      ]),
    );

    expect(rows).toEqual(
      new Map([
        [
          "existing-bound-native-detail",
          {
            condition: ["canonical-effort-unchanged"],
            continuation: [
              "native-work",
              "ordinary-owner-work-or-user-invoked-owner-skill",
              "no-canonical-effort-mutation",
            ].sort(),
          },
        ],
        [
          "canonical-effort-change",
          {
            condition: ["effort-meaning-changed"],
            continuation: ["canonical-mutation", "effort-owner"],
          },
        ],
        [
          "standalone-native-work",
          {
            condition: ["no-accepted-bearing-scope"],
            continuation: [
              "ordinary-owner-work-or-user-invoked-owner-skill",
              "no-bearing-enrollment",
            ].sort(),
          },
        ],
      ]),
    );
  });

  test("gives GitHub native admission an executable canonical URL step", async () => {
    const document = parseMarkdownDocument(await readRuntime("references/journeys/native-work.md"));
    const operation = queryMarkdownSections(document, { depth: 2 }).find(
      ({ heading }) => heading.title === "Operation",
    );
    if (operation === undefined) throw new Error("Native Work operation section is absent.");
    const commands = queryMarkdownInlineCodes(document, { within: operation });
    const resolveIndex = commands.indexOf("gh issue view <number> --json url --jq .url");
    const inspectIndex = commands.indexOf(
      "bearing inspect --native <native-reference> --repo <repo-root>",
    );

    expect(resolveIndex).toBeGreaterThanOrEqual(0);
    expect(inspectIndex).toBeGreaterThan(resolveIndex);
  });

  test("keeps the public root as a compact router with one command table", async () => {
    const { document } = await readSkillAt(skillRoot);
    const commandTable = tableWithColumns(document, ["Meaning", "Command form"]);
    tableWithColumns(document, ["Operation", "Load directly"]);

    expect(commandTable.rows.map((row) => row[1]).sort()).toEqual(
      [
        "bearing configure inspect --repo <repo-root>",
        "bearing update",
        "bearing configure plan <accepted-arguments>",
        "bearing configure apply <accepted-arguments> --plan-token <token>",
        "bearing inspect project --repo <repo-root>",
        "bearing inspect <stable-planning-reference> --repo <repo-root>",
        "bearing inspect --native <native-reference> --repo <repo-root>",
        "bearing inspect diagnostics --repo <repo-root>",
        "bearing reconcile-native --repo <repo-root> --scope <opaque-native-scope> --ref <native-reference> [--ref <native-reference>]",
        "bearing provider capture --scope <opaque-native-scope> [--scope <opaque-native-scope>] --repo <repo-root>",
        "bearing provider verify --all --repo <repo-root>",
        "bearing cache rebuild --repo <repo-root>",
        "bearing catalog <catalog-operation> <accepted-arguments>",
        "bearing portal [--port <1-65535>]",
      ].sort(),
    );
    expect(queryMarkdownLists(document, { ordered: true })).toEqual([]);
  });

  test("keeps the Development entry as one public-root handoff and one final boundary", async () => {
    const { document } = await readSkillAt(developmentSkillRoot);
    const operationalTokens = queryMarkdownInlineCodes(document);

    expect(operationalTokens).toContain("<repo-root>/skills/bearing/SKILL.md");
    expect(operationalTokens).toContain("node <repo-root>/dist/cli.js");
    expect(operationalTokens).toContain(
      "node <repo-root>/dist/cli.js runtime inspect --repo <repo-root>",
    );
    expect(operationalTokens).toContain(
      "node <repo-root>/dist/cli.js runtime bootstrap --repo <repo-root>",
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
