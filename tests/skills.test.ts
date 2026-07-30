import { describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseDocument } from "yaml";

const skillNames = ["bearing"] as const;

const branchEntries = [
  "setup",
  "summary",
  "roadmap",
  "milestone-gate",
  "effort-lifecycle",
  "asset-lifecycle",
  "alignment-check",
  "planning-audit",
  "planning-review",
  "next-work",
] as const;

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

const readSharedContract = async (name: string): Promise<string> =>
  readFile(join(process.cwd(), "skills/bearing/references/shared", `${name}.md`), "utf8");

describe("package-owned planning skills", () => {
  for (const name of skillNames) {
    test(`${name} ships the standard package-owned contract shape`, async () => {
      const skill = await readSkill(name);

      expect(skill.frontmatter).toEqual({ name, description: expect.any(String) });
      expect(skill.body).toContain(
        "$HOME/.bearing/kit/current/skills/bearing/references/branch-manifest.yaml",
      );
      expect(skill.body).toMatch(/^## Process$/mu);
      expect(skill.body).toContain("## Read Set");
      expect(skill.body).toContain("## Write Set");
      expect(skill.body).toContain("## Outcomes");
      expect(skill.body).toContain("## Recovery");
      expect(skill.body).toContain("## Completion Criterion");
    });
  }

  test("ships exactly one public skill and one explicit contract-phase branch manifest", async () => {
    const topLevel = await readdir(join(process.cwd(), "skills"), { withFileTypes: true });
    expect(
      topLevel
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort(),
    ).toEqual(["bearing"]);
    const source = await readFile(
      join(process.cwd(), "skills/bearing/references/branch-manifest.yaml"),
      "utf8",
    );
    const document = parseDocument(source);
    expect(document.errors).toEqual([]);
    expect(document.toJS()).toEqual({
      schemaVersion: 1,
      phase: "contract",
      publicEntry: "skills/bearing/SKILL.md",
      progressiveLoading: {
        rule: "Load at most one selected branch after public routing; direct executor continuation loads zero branches.",
        internalBranchesReenterPublicRouter: false,
      },
      sharedContracts: [
        {
          key: "typed-inspection",
          reference: "skills/bearing/references/shared/typed-inspection.md",
          loading: "on-completeness-demand",
        },
        {
          key: "planning-transaction",
          reference: "skills/bearing/references/shared/planning-transaction.md",
          loading: "branch-declared",
        },
        {
          key: "artifact-registration",
          reference: "skills/bearing/references/shared/artifact-registration.md",
          loading: "on-durable-output",
        },
        {
          key: "executor-continuation",
          reference: "skills/bearing/references/shared/executor-continuation.md",
          loading: "on-direct-executor",
        },
      ],
      publicSharedContracts: ["typed-inspection", "artifact-registration", "executor-continuation"],
      branches: branchEntries.map((key) => ({
        key,
        reference: `skills/bearing/references/branches/${key}.md`,
        sharedContracts: ["planning-transaction"],
      })),
    });
  });

  test("keeps each branch contract in one English normative owner", async () => {
    for (const key of branchEntries) {
      const reference = `skills/bearing/references/branches/${key}.md`;
      const branch = await readFile(join(process.cwd(), reference), "utf8");

      expect(branch.startsWith("---\n")).toBe(false);
      expect(branch).toMatch(/^# Bearing /u);
      expect(branch).toContain("## Process");
      expect(branch).toContain("## Read Set");
      expect(branch).toContain("## Write Set");
      expect(branch).toContain("## Outcomes");
      expect(branch).toContain("## Recovery");
      expect(branch).toContain("## Completion Criterion");
      expect(branch).not.toMatch(/[\u3400-\u9fff]/u);
      expect(branch).toMatch(/Established public orientation[\s\S]*do not (?:reload|re-enter)/iu);
      expect(branch).toContain(
        "$HOME/.bearing/kit/current/skills/bearing/references/shared/planning-transaction.md",
      );
    }
  });

  test("public bearing encodes activation, continuation, routing and truthful reconciliation", async () => {
    const { body } = await readSkill("bearing");

    for (const activationRule of [
      "correct answer or action may depend on",
      "Explicit Bearing invocation",
      "ambiguous repository relevance",
      "working directory alone",
      "clear repository-independent conversation",
    ]) {
      expect(body).toContain(activationRule);
    }
    expect(body).toMatch(/direct continuation[\s\S]*visibly reliable orientation/iu);
    expect(body).toMatch(
      /repository, target, or request[\s\S]*context loss[\s\S]*freshness doubt/iu,
    );
    expect(body).toContain("Project Summary");
    expect(body).toContain("Project Sitemap");
    expect(body).toMatch(/exactly one selected internal branch/iu);
    expect(body).toContain("Do not re-enter the public router");
    expect(body).toContain("produced-output manifest");
    for (const disposition of ["transient", "durable-registered", "durable-unregistered"]) {
      expect(body).toContain(disposition);
    }
    expect(body).toMatch(/durable-unregistered[\s\S]*incomplete/iu);
    expect(body).toContain("bearing asset register");
    expect(body).toMatch(/current user's language/iu);
  });

  test("keeps Next Work cardinality explicit in its single branch owner", async () => {
    const branch = await readBranch("next-work");

    expect(branch).toMatch(/zero to two meaningful alternatives/iu);
    expect(branch).not.toMatch(/exactly two alternatives|two distinct alternatives/iu);
  });

  test("keeps Effort lifecycle transitions explicit, atomic, and independent", async () => {
    const branch = await readBranch("effort-lifecycle");

    expect(branch).toMatch(/planned[\s\S]*active[\s\S]*concluded/iu);
    expect(branch).toMatch(/completed[\s\S]*withdrawn[\s\S]*superseded/iu);
    expect(branch).toMatch(/Planned at[\s\S]*Activated at[\s\S]*Concluded at/iu);
    expect(branch).toMatch(/UTC[\s\S]*same atomic canonical mutation/iu);
    expect(branch).toMatch(/historical migration authority[\s\S]*Time unavailable/iu);
    expect(branch).toMatch(
      /Provider Completion[\s\S]*Map lifecycle[\s\S]*Gate Readiness[\s\S]*Gate Passage[\s\S]*never transition/iu,
    );
    expect(branch).toMatch(/explicit user acceptance/iu);
  });

  test("keeps every Bearing-owned Source Event Time with its mutation owner", async () => {
    const transaction = await readSharedContract("planning-transaction");
    const roadmap = await readBranch("roadmap");
    const gate = await readBranch("milestone-gate");
    const assetLifecycle = await readBranch("asset-lifecycle");
    const check = await readBranch("alignment-check");
    const review = await readBranch("planning-review");
    const registration = await readSharedContract("artifact-registration");

    expect(transaction).toMatch(
      /current UTC Source Event Time[\s\S]*same successful canonical mutation/iu,
    );
    expect(transaction).toMatch(
      /file metadata[\s\S]*Provider Observation Time[\s\S]*Sync completion[\s\S]*no event time/iu,
    );
    expect(roadmap).toMatch(/Started at[\s\S]*Completed at[\s\S]*Superseded at/iu);
    expect(gate).toMatch(/Planned at[\s\S]*Activated at[\s\S]*Accepted at[\s\S]*Superseded at/iu);
    expect(check).toMatch(/Accepted at[\s\S]*Authority Adoption[\s\S]*never copies or invents/iu);
    expect(review).toMatch(/Accepted at[\s\S]*Authority Adoption[\s\S]*never copies or invents/iu);
    expect(registration).toMatch(/Produced At[\s\S]*Date-only[\s\S]*Registered at/iu);
    expect(registration).toMatch(/asset-lifecycle[\s\S]*Superseded at[\s\S]*Archived at/iu);
    expect(assetLifecycle).toMatch(/available[\s\S]*superseded[\s\S]*replacement[\s\S]*archived/iu);
    expect(assetLifecycle).toMatch(
      /explicit user acceptance[\s\S]*current UTC Source Event Time[\s\S]*same atomic canonical mutation/iu,
    );
    expect(assetLifecycle).toMatch(/\.bearing\/state\/assets\.md/iu);
    expect(assetLifecycle).toMatch(/Filesystem absence[\s\S]*never authorizes/iu);
    expect(assetLifecycle).toMatch(/provider state never authorizes/iu);
    expect(assetLifecycle).toMatch(/Sync completion[\s\S]*never backfills/iu);
  });

  test("direct executor continuation preserves owner and terminal truth", async () => {
    const router = await readSkill("bearing");
    const contract = await readSharedContract("executor-continuation");

    expect(router.body).toContain("executor-continuation");
    expect(router.body).toMatch(
      /At most one selected internal branch[\s\S]*none for direct executor continuation/iu,
    );
    expect(contract).toMatch(/fresh direct invocation[\s\S]*before execution/iu);
    expect(contract).toMatch(/Bearing-aware continuation[\s\S]*same user command/iu);
    expect(contract).toMatch(
      /explicit Matt Delivery Ticket[\s\S]*Effort and Work Binding context[\s\S]*explicit fact that it is unbound/iu,
    );
    expect(contract).toMatch(
      /ambiguous Ticket identity[\s\S]*Spec-only[\s\S]*does not enter execution/iu,
    );
    expect(contract).toMatch(
      /executor[\s\S]*implementation[\s\S]*tests[\s\S]*review[\s\S]*commit/iu,
    );
    expect(contract).toMatch(/Bearing[\s\S]*factual registration[\s\S]*Sync/iu);
    expect(contract).toMatch(/Work Management provider[\s\S]*terminal resolution/iu);
    expect(contract).toMatch(/Produced For[\s\S]*native evidence[\s\S]*independent/iu);
    expect(contract).toMatch(
      /provider completion contract[\s\S]*unavailable[\s\S]*deterministic Sync[\s\S]*truthful stop/iu,
    );
    expect(contract).toMatch(
      /Generic[\s\S]*evidence reconciliation only[\s\S]*no native Ticket lifecycle authority/iu,
    );
    expect(contract).toMatch(
      /zero diagnostics[\s\S]*does not authorize[\s\S]*native Ticket lifecycle/iu,
    );
    expect(contract).toMatch(/failure[\s\S]*incomplete[\s\S]*ambiguous[\s\S]*spec-only/iu);
    expect(contract).toMatch(
      /actual executor contract[\s\S]*Execution Profile[\s\S]*never defines or translates the executor outcome taxonomy[\s\S]*`completed` remains `completed`/iu,
    );
    for (const hook of [
      "direct-executor:fresh",
      "direct-executor:aware",
      "direct-executor:reconciled",
      "direct-executor:nonterminal",
    ]) {
      expect(contract).toContain(hook);
    }
    expect(contract).toMatch(
      /direct-executor:nonterminal[\s\S]*Sync fingerprint and diagnostics/iu,
    );
  });

  test("Fresh Setup keeps one-decision conversation and owner-separated outcomes", async () => {
    const setup = await readBranch("setup");

    expect(setup).toMatch(/report detected facts[\s\S]*one material decision at a time/iu);
    expect(setup).toMatch(/one final[\s\S]*owner-separated Apply review/iu);
    expect(setup).toMatch(/running Agent Surface[\s\S]*primary fact/iu);
    expect(setup).toMatch(/matching instruction file[\s\S]*no redundant question/iu);
    expect(setup).toMatch(/neither[\s\S]*AGENTS\.md[\s\S]*CLAUDE\.md[\s\S]*both/iu);
    expect(setup).toMatch(
      /Matt prerequisite[\s\S]*owning capability[\s\S]*resume[\s\S]*refusal[\s\S]*no Bearing repository writes/iu,
    );
    expect(setup).toMatch(
      /matt-skills\/v1[\s\S]*Provider Configuration[\s\S]*never stores or asks for a tracker driver/iu,
    );
    expect(setup).toMatch(/native scopes[\s\S]*never binds/iu);
    expect(setup).toMatch(/zero nominations[\s\S]*complete/iu);
    expect(setup).toMatch(/Generic[\s\S]*hidden during Setup/iu);
    expect(setup).toMatch(
      /Never scan, rank, recommend, install, whitelist-match, prefer, or select a default executor/iu,
    );
    expect(setup).toMatch(
      /end-to-end execution[\s\S]*final outcome or writeback[\s\S]*planning, testing, TDD, debugging, and review helpers/iu,
    );
    expect(setup).toMatch(
      /explicit semantic assessment[\s\S]*Do not infer eligibility from keywords[\s\S]*exact directly required local reference locators[\s\S]*exact source excerpts[\s\S]*--executor-assessment/iu,
    );
    expect(setup).toMatch(
      /unavailable, malformed, ambiguous, or insufficient nomination[\s\S]*retried or skipped[\s\S]*never blocks/iu,
    );
    expect(setup).toMatch(
      /surface-scoped[\s\S]*portable surface-qualified capability locator[\s\S]*Multiple registrations[\s\S]*without cross-surface deduplication, priority, preference, or default/iu,
    );
    expect(setup).toMatch(
      /Generic evidence-reconciliation fallback[\s\S]*only when[\s\S]*no specialized registration/iu,
    );
    expect(setup).toMatch(/Catalog[\s\S]*independent outcome/iu);
    expect(setup).toMatch(
      /Catalog failure[\s\S]*return `partial` with separate `Repository` and `Catalog` outcomes/iu,
    );
    expect(setup).not.toMatch(/Catalog failure[\s\S]{0,160}return `blocked`/iu);
    expect(setup).toMatch(
      /created no Roadmap, Milestone Gate, Effort, Work Binding, or Matt-owned mutation/iu,
    );
    expect(setup).toMatch(
      /configured loopback origin[\s\S]*BEARING_PORT[\s\S]*127\.0\.0\.1:4178[\s\S]*never scan/iu,
    );
    expect(setup).toMatch(
      /\/healthz[\s\S]*compatible Bearing package and read-model[\s\S]*current Catalog Entry[\s\S]*\/projects\/<catalog-entry-id>/iu,
    );
    expect(setup).toMatch(
      /incompatible[\s\S]*current kit[\s\S]*no Host[\s\S]*bearing portal[\s\S]*separate terminal/iu,
    );
    expect(setup).toMatch(
      /Portal[\s\S]*never changes Setup success[\s\S]*Fresh[\s\S]*routine Active no-op/iu,
    );
    expect(setup).toMatch(
      /Initial Bearing Analysis[\s\S]*only after complete Fresh success[\s\S]*non-mutating/iu,
    );
    expect(setup).toMatch(/current user's language/iu);
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
    const skill = await readSharedContract("typed-inspection");

    expect(skill).toContain(
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
      expect(skill).toContain(trigger);
    }
    expect(skill).toMatch(/automatically invoke/iu);
    expect(skill).toMatch(/do not ask the user to run/iu);
    expect(skill).toMatch(/package-owned CLI/iu);
  });

  test("bearing preserves Sitemap orientation while inspect state bounds completeness claims", async () => {
    const skill = await readSharedContract("typed-inspection");

    expect(skill).toMatch(
      /Sitemap remains limited to whole-project orientation, target discovery, source routing, and top-level Attention/iu,
    );
    expect(skill).toMatch(/`complete`[\s\S]*source retrieval[\s\S]*semantic judgment/iu);
    expect(skill).toMatch(/`partial`[\s\S]*bounded orientation/iu);
    expect(skill).toMatch(/`partial`[\s\S]*Do not[\s\S]*scope-complete planning mutation/iu);
    for (const forbiddenClaim of [
      "all contributors are known",
      "definitive readiness",
      "Gate passage",
      "scope-complete planning mutation",
    ]) {
      expect(skill).toContain(forbiddenClaim);
    }
    expect(skill).toMatch(
      /`invalid`[\s\S]*unknown target[\s\S]*truthful `incomplete` or `blocked`/iu,
    );
  });

  test("bearing permits bounded owned repair without treating partial as complete", async () => {
    const skill = await readSharedContract("typed-inspection");

    expect(skill).toContain("user-authorized issue-scoped repair");
    expect(skill).toContain("unrelated bounded mutation");
    expect(skill).toMatch(/route[\s\S]*owning branch/iu);
    expect(skill).toMatch(/must not treat `partial` as `complete`/iu);
    expect(skill).toMatch(/scope-complete mutation[\s\S]*requires[\s\S]*`complete`/iu);
  });

  test("bearing forbids compatibility retrieval and runtime fallbacks", async () => {
    const skill = await readSharedContract("typed-inspection");

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
      expect(skill).toContain(forbiddenFallback);
    }
    expect(skill).toMatch(/never use[\s\S]*fallback/iu);
    expect(skill).toContain("$HOME/.bearing/bin/bearing");
  });

  test("bearing keeps unmanaged composition and mutation ownership contracts intact", async () => {
    const skill = await readSkill("bearing");

    expect(skill.body).toContain("Continue ordinary unmanaged work");
    expect(skill.body).toContain("Never mutate canonical planning state");
    expect(skill.body).toContain("Read their canonical source locators");
    expect(skill.body).toMatch(
      /leave native status, blocker, dependency, claim, and resolution writes/iu,
    );
  });
});
