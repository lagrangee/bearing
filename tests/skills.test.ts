import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseDocument } from "yaml";

const skillNames = [
  "bearing",
  "bearing-setup",
  "bearing-summary",
  "bearing-roadmap",
  "bearing-milestone-gate",
  "bearing-alignment-check",
  "bearing-planning-audit",
  "bearing-planning-review",
  "bearing-next-work",
] as const;

const branchEntries = [
  ["setup", "bearing-setup"],
  ["summary", "bearing-summary"],
  ["roadmap", "bearing-roadmap"],
  ["milestone-gate", "bearing-milestone-gate"],
  ["alignment-check", "bearing-alignment-check"],
  ["planning-audit", "bearing-planning-audit"],
  ["planning-review", "bearing-planning-review"],
  ["next-work", "bearing-next-work"],
] as const;

const profiles = [
  "generic-agent",
  "matt-implement",
  "omo-start-work",
  "superpowers-executing-plans",
  "superpowers-subagent-driven-development",
];

const readSkill = async (name: string): Promise<{ frontmatter: unknown; body: string }> => {
  const source = await readFile(join(process.cwd(), "skills", name, "SKILL.md"), "utf8");
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/u.exec(source);
  if (!match?.[1] || match[2] === undefined) {
    throw new Error(`${name} has no YAML frontmatter`);
  }
  const document = parseDocument(match[1]);
  if (document.errors.length > 0) {
    throw new Error(`${name} has invalid YAML frontmatter`);
  }
  return { frontmatter: document.toJS(), body: match[2] };
};

const readBranch = async (name: string): Promise<string> =>
  readFile(join(process.cwd(), "skills/bearing/references/branches", `${name}.md`), "utf8");

describe("package-owned planning skills", () => {
  for (const name of skillNames) {
    test(`${name} ships the standard package-owned contract shape`, async () => {
      const skill = await readSkill(name);

      expect(skill.frontmatter).toEqual({ name, description: expect.any(String) });
      if (name === "bearing") {
        expect(skill.body).toContain("$HOME/.bearing/kit/current/docs/agents/bearing/protocol.md");
        expect(skill.body).toMatch(/^## Process$/mu);
        expect(skill.body).toContain("## Read Set");
        expect(skill.body).toContain("## Write Set");
        expect(skill.body).toContain("## Outcomes");
        expect(skill.body).toContain("## Recovery");
        expect(skill.body).toContain("## Completion Criterion");
      } else {
        expect(skill.body).toContain("Expand-stage compatibility entry.");
      }
    });
  }

  test("ships one explicit expand-phase branch manifest", async () => {
    const source = await readFile(
      join(process.cwd(), "skills/bearing/references/branch-manifest.yaml"),
      "utf8",
    );
    const document = parseDocument(source);
    expect(document.errors).toEqual([]);
    expect(document.toJS()).toEqual({
      schemaVersion: 1,
      phase: "expand",
      publicEntry: "skills/bearing/SKILL.md",
      progressiveLoading: {
        rule: "Load exactly one selected branch after public routing.",
        internalBranchesReenterPublicRouter: false,
        legacyEntriesRemainInstalled: true,
      },
      sharedContracts: [
        {
          key: "bearing-protocol",
          reference: "docs/agents/bearing/protocol.md",
          loading: "branch-declared",
        },
      ],
      branches: branchEntries.map(([key, legacyName]) => ({
        key,
        reference: `skills/bearing/references/branches/${key}.md`,
        legacyEntry: `skills/${legacyName}/SKILL.md`,
        sharedContracts: ["bearing-protocol"],
      })),
    });
  });

  test("keeps each branch contract in one English normative owner", async () => {
    for (const [key, legacyName] of branchEntries) {
      const reference = `skills/bearing/references/branches/${key}.md`;
      const branch = await readFile(join(process.cwd(), reference), "utf8");
      const legacy = await readSkill(legacyName);

      expect(branch.startsWith("---\n")).toBe(false);
      expect(branch).toMatch(/^# Bearing /u);
      expect(branch).toContain("## Process");
      expect(branch).toContain("## Read Set");
      expect(branch).toContain("## Write Set");
      expect(branch).toContain("## Outcomes");
      expect(branch).toContain("## Recovery");
      expect(branch).toContain("## Completion Criterion");
      expect(branch).not.toMatch(/[\u3400-\u9fff]/u);
      expect(legacy.body).toContain("Expand-stage compatibility entry.");
      expect(legacy.body).toContain(`$HOME/.bearing/kit/current/${reference}`);
      expect(legacy.body).toContain("Do not re-enter the public router.");
      expect(legacy.body).not.toContain("## Process");
      expect(legacy.body).not.toContain(
        "$HOME/.bearing/kit/current/docs/agents/bearing/protocol.md",
      );
    }
  });

  test("ships each agreed executor profile template", async () => {
    for (const profile of profiles) {
      const source = await readFile(
        join(process.cwd(), "templates/executor-profiles", `${profile}.md`),
        "utf8",
      );
      expect(source).toContain(`Profile key: ${profile}`);
      expect(source).toContain("## Native Artifacts");
      expect(source).toContain("## Durable Evidence");
      expect(source).toContain("## Fallback Receipt");
      expect(source).toContain("## Producer Provenance");
    }
  });

  test("bearing-summary declares the per-part Project Summary language contract", async () => {
    // Given: the package-owned Summary authoring skill.
    const skill = await readBranch("summary");

    // When: an agent looks for the language metadata rule.
    const languageContract = skill.match(/Languages:[\s\S]*?BCP-47[\s\S]*?inherit/iu);

    // Then: the rule is explicit and forbids an inferred fallback.
    expect(languageContract).not.toBeNull();
    expect(skill).toMatch(/never infer/iu);
  });

  test("bearing clean-cuts completeness-sensitive retrieval to typed package CLI inspection", async () => {
    const skill = await readSkill("bearing");

    expect(skill.body).toContain(
      "$HOME/.bearing/bin/bearing inspect <roadmap|gate|effort> <stable-id> --repo <repo-root>",
    );
    for (const trigger of [
      "Roadmap horizon",
      "canonical Gate order",
      "focused Gate",
      "Gate readiness",
      "Gate passage",
      "Effort scope",
      "declared Authorities",
      "tracker-native Tickets",
      "relevant Alignment Checks",
      "registered evidence",
      "scope-complete planning mutation",
    ]) {
      expect(skill.body).toContain(trigger);
    }
    expect(skill.body).toMatch(/automatically invoke/iu);
    expect(skill.body).toMatch(/do not ask the user to run/iu);
    expect(skill.body).toMatch(/package-owned CLI/iu);
  });

  test("bearing preserves Sitemap orientation while inspect state bounds completeness claims", async () => {
    const skill = await readSkill("bearing");

    expect(skill.body).toMatch(
      /Sitemap remains limited to whole-project orientation, target discovery, source routing, and top-level Attention/iu,
    );
    expect(skill.body).toMatch(/`complete`[\s\S]*source retrieval[\s\S]*semantic judgment/iu);
    expect(skill.body).toMatch(/`partial`[\s\S]*bounded orientation/iu);
    expect(skill.body).toMatch(/`partial`[\s\S]*Do not[\s\S]*scope-complete planning mutation/iu);
    for (const forbiddenClaim of [
      "all contributors are known",
      "definitive readiness",
      "Gate passage",
      "scope-complete planning mutation",
    ]) {
      expect(skill.body).toContain(forbiddenClaim);
    }
    expect(skill.body).toMatch(
      /`invalid`[\s\S]*unknown target[\s\S]*truthful `incomplete` or `blocked`/iu,
    );
  });

  test("bearing permits bounded owned repair without treating partial as complete", async () => {
    const skill = await readSkill("bearing");

    expect(skill.body).toContain("user-authorized issue-scoped repair");
    expect(skill.body).toContain("unrelated bounded mutation");
    expect(skill.body).toMatch(/route[\s\S]*owning `bearing-\*` capability/iu);
    expect(skill.body).toMatch(/must not treat `partial` as `complete`/iu);
    expect(skill.body).toMatch(/scope-complete mutation[\s\S]*requires[\s\S]*`complete`/iu);
  });

  test("bearing forbids compatibility retrieval and runtime fallbacks", async () => {
    const skill = await readSkill("bearing");

    for (const forbiddenFallback of [
      "title match",
      "keyword search",
      "`rg`",
      "prose similarity",
      "manual Sitemap join",
      "shell `PATH`",
      "Portal startup",
      "network service",
      "daemon",
      "skills-only runtime",
    ]) {
      expect(skill.body).toContain(forbiddenFallback);
    }
    expect(skill.body).toMatch(/never use[\s\S]*fallback/iu);
    expect(skill.body).toContain("$HOME/.bearing/bin/bearing");
  });

  test("bearing keeps unmanaged composition and mutation ownership contracts intact", async () => {
    const skill = await readSkill("bearing");

    expect(skill.body).toContain("Continue ordinary unmanaged work");
    expect(skill.body).toContain("Never mutate canonical planning state");
    expect(skill.body).toContain("Read their canonical source locators");
    expect(skill.body).toContain(
      "leave native status, blocker, dependency, claim, and resolution writes",
    );
  });
});
