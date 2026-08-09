import { describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { parseDocument } from "yaml";
import { BEARING_POINTER } from "../src/agent-surface-entry";

const skillRoot = join(process.cwd(), "skills/bearing");

const contractReferences = ["references/contracts/canonical-mutation.md"] as const;
const journeyReferences = [
  "references/journeys/configure.md",
  "references/journeys/configure-fresh.md",
  "references/journeys/configure-active.md",
  "references/journeys/configure-reactivate.md",
  "references/journeys/configure-deactivate.md",
  "references/journeys/configure-unsupported.md",
  "references/journeys/catalog.md",
  "references/journeys/project-orientation.md",
  "references/journeys/scope-review.md",
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

const readSkill = async (): Promise<{ frontmatter: unknown; body: string }> => {
  const source = await readFile(join(skillRoot, "SKILL.md"), "utf8");
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/u.exec(source);
  if (!match?.[1] || match[2] === undefined) throw new Error("bearing has no YAML frontmatter");
  const document = parseDocument(match[1]);
  if (document.errors.length > 0) throw new Error("bearing has invalid YAML frontmatter");
  return { frontmatter: document.toJS(), body: match[2] };
};

describe("public Bearing Agent surface", () => {
  test("ships exactly one root router and the accepted one-hop runtime graph", async () => {
    expect(await walk(skillRoot)).toEqual(["SKILL.md", ...runtimeReferences].sort());

    const topLevel = await readdir(join(process.cwd(), "skills"), { withFileTypes: true });
    expect(
      topLevel
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort(),
    ).toEqual(["bearing"]);
  });

  test("keeps the global description narrow and delegates contextual nomination to the pointer", async () => {
    const { frontmatter, body } = await readSkill();
    expect(frontmatter).toEqual({
      name: "bearing",
      description: expect.stringMatching(/explicit Bearing invocation[\s\S]*managed pointer/iu),
    });
    expect((frontmatter as { description: string }).description).not.toMatch(
      /repository-dependent request|working directory|ambiguous/iu,
    );
    expect(body).toMatch(/managed pointer[\s\S]*single source of truth/iu);
    expect(body).toMatch(/do not reconstruct or broaden[\s\S]*conditions/iu);
    expect(body).toMatch(/explicit Bearing[\s\S]*fallback/iu);
    expect(body).not.toMatch(/activation check|activation-policy/iu);

    expect(BEARING_POINTER).toMatch(
      /explicit Bearing concepts[\s\S]*reliable direct continuation[\s\S]*material planning\/governance/iu,
    );
    expect(BEARING_POINTER).toMatch(
      /Working directory[\s\S]*generic roadmap words[\s\S]*ordinary non-governance code/iu,
    );
    expect(BEARING_POINTER).toMatch(/contextual guidance[\s\S]*not an executable hook/iu);
    expect(BEARING_POINTER).toMatch(/functional operation validates[\s\S]*lifecycle/iu);
    expect(BEARING_POINTER).not.toContain("bearing configure inspect");
  });

  test("root carries the execution spine, authority boundaries, and truthful completion", async () => {
    const { body } = await readSkill();
    for (const heading of [
      "## Execution spine",
      "## Authority boundaries",
      "## Completeness-sensitive reads",
      "## Reference map",
      "## Truthful outcomes",
      "## Completion criterion",
    ]) {
      expect(body).toContain(heading);
    }
    expect(body).toMatch(
      /one initiating[\s\S]*owner[\s\S]*every additional owner[\s\S]*actually\s+change/iu,
    );
    expect(body).toMatch(
      /visible context[\s\S]*no persisted\s+session mode[\s\S]*operation object/iu,
    );
    for (const evidence of ["Tests", "diagnostics", "resolved native work"]) {
      expect(body).toContain(evidence);
    }
    expect(body).toMatch(/never conclude an Effort[\s\S]*pass a Gate/iu);
    expect(body).toMatch(/failure[\s\S]*partial[\s\S]*unfulfilled[\s\S]*without translation/iu);
    expect(body).toMatch(/current user's language/iu);
    expect(body).toMatch(
      /first functional operation[\s\S]*independently validates[\s\S]*required[\s\S]*Lifecycle/iu,
    );
    expect(body).toMatch(
      /stale pointer[\s\S]*requested operation[\s\S]*no separate entry preflight/iu,
    );
  });

  test("reuses accepted authority for bounded follow-up judgment", async () => {
    const { body } = await readSkill();
    expect(body).toMatch(
      /accepted outcome[\s\S]*authority boundary[\s\S]*not[\s\S]*deterministic command[\s\S]*tool call[\s\S]*internal stage/iu,
    );
    expect(body).toMatch(
      /authority[\s\S]*scope[\s\S]*cost[\s\S]*risk[\s\S]*reversibility[\s\S]*collateral effects[\s\S]*ambiguity/iu,
    );
    expect(body).toMatch(
      /necessary[\s\S]*proportionate[\s\S]*follow-up operation[\s\S]*product seam[\s\S]*repeat/iu,
    );
    expect(body).toMatch(/materially new boundary[\s\S]*user decision/iu);
    expect(body).toMatch(
      /fail closed[\s\S]*typed outcomes[\s\S]*expand\s+scope[\s\S]*semantic recovery[\s\S]*failure[\s\S]*success/iu,
    );
    expect(body).not.toMatch(/decision table|automatic retry loop/iu);

    const native = await readRuntime("references/journeys/native-work.md");
    const execution = await readRuntime("references/journeys/execution.md");
    expect(native).toMatch(
      /accepted native outcome[\s\S]*exact\s+reconciliation[\s\S]*product seam[\s\S]*confirmation/iu,
    );
    expect(execution).toMatch(
      /accepted Ticket outcome[\s\S]*writeback[\s\S]*exact\s+reconciliation[\s\S]*confirmation/iu,
    );
  });

  test("root names every selectable runtime reference directly and no reference routes onward", async () => {
    const { body } = await readSkill();
    for (const reference of runtimeReferences) {
      expect(body).toContain(`$HOME/.bearing/kit/current/skills/bearing/${reference}`);
      const source = await readRuntime(reference);
      expect(source).not.toContain("$HOME/.bearing/kit/current/skills/bearing/references/");
      expect(source).not.toMatch(/read (?:the )?(?:journey|owner|contract)/iu);
      expect(source).not.toMatch(/\bco-load(?:s|ed|ing)?\b/iu);
    }
    expect(body).not.toMatch(/branch-manifest|references\/branches|references\/shared/iu);
  });

  test("every executable reference is English, scoped, and locally completable", async () => {
    for (const reference of runtimeReferences) {
      const source = await readRuntime(reference);
      expect(source.startsWith("---\n")).toBe(false);
      expect(source).toMatch(/^# /u);
      expect(source).toContain("## Applicability");
      expect(source).toContain("## Authority");
      expect(source).toContain("## Operation");
      expect(source).toContain("## Completion criterion");
      expect(source).not.toMatch(/[\u3400-\u9fff]/u);
    }
  });

  test("canonical mutation keeps semantic authorship with the Agent and mechanics with Modules", async () => {
    const contract = await readRuntime("references/contracts/canonical-mutation.md");
    expect(contract).toMatch(/inspect[\s\S]*complete current target/iu);
    expect(contract).toMatch(/Agent-authored[\s\S]*candidate/iu);
    expect(contract).toMatch(/clear direct instruction[\s\S]*acceptance/iu);
    expect(contract).toMatch(
      /ambiguity[\s\S]*material conflict[\s\S]*unentailed collateral effect/iu,
    );
    expect(contract).toMatch(/re-read[\s\S]*precondition[\s\S]*immediately before/iu);
    expect(contract).toMatch(/direct edit[\s\S]*schema and references[\s\S]*publish/iu);
    expect(contract).toMatch(/affected[\s\S]*bearing inspect/iu);
    expect(contract).toMatch(/partial write[\s\S]*repair[\s\S]*own attempted write set/iu);
    expect(contract).toMatch(
      /Materiality means[\s\S]*Summary[\s\S]*accepted new project meaning[\s\S]*Brief[\s\S]*accepted truth/iu,
    );
    expect(contract).not.toMatch(
      /bearing (?:sync|asset register)|receipt file|global follow-up engine/iu,
    );
  });

  test("completeness rules use the typed package surface without hidden fallback", async () => {
    const { body } = await readSkill();
    expect(body).toContain("$HOME/.bearing/bin/bearing inspect project --repo <repo-root>");
    expect(body).toContain(
      "$HOME/.bearing/bin/bearing inspect <stable-planning-reference> --repo <repo-root>",
    );
    expect(body).toContain(
      "$HOME/.bearing/bin/bearing inspect --native <native-reference> --repo <repo-root>",
    );
    expect(body).toMatch(/complete[\s\S]*coverage only[\s\S]*never[\s\S]*authority/iu);
    expect(body).toMatch(/partial|unfulfilled|recovery-required|need-update/iu);
    expect(body).toMatch(/no title match[\s\S]*repository scan[\s\S]*provider fallback/iu);
  });

  test("Configure keeps one dialogue and exactly one ownership-level final review", async () => {
    const common = await readRuntime("references/journeys/configure.md");
    expect(common).toMatch(/bearing configure inspect/iu);
    expect(common).toMatch(/one material choice at a time/iu);
    expect(common).toMatch(/preserve[\s\S]*accepted choices[\s\S]*prerequisite/iu);
    expect(common).toMatch(/executor[\s\S]*unresolved[\s\S]*Ask\s+exactly\s+once/iu);
    expect(common).toMatch(/Explain[\s\S]*invalid[\s\S]*once[\s\S]*materially new evidence/iu);
    expect(common).toMatch(/bearing configure plan[\s\S]*one[\s\S]*owner-separated final review/iu);
    expect(common).toMatch(/bearing configure apply[\s\S]*same sealed plan/iu);
    expect(common).toMatch(/Catalog[\s\S]*independent[\s\S]*Portal handoff/iu);
    expect(common).not.toMatch(/second router|select another reference/iu);

    const variants = await Promise.all(
      journeyReferences
        .filter((reference) => reference.startsWith("references/journeys/configure-"))
        .map(readRuntime),
    );
    expect(variants).toHaveLength(5);
    expect(variants[0]).toMatch(
      /Fresh[\s\S]*no\s+substantive planning[\s\S]*no provider acquisition/iu,
    );
    expect(variants[0]).toMatch(/optional[\s\S]*Project Orientation[\s\S]*after/iu);
    expect(variants[1]).toMatch(/Active[\s\S]*executor addition[\s\S]*removal[\s\S]*repair/iu);
    expect(variants[2]).toMatch(/Deactivated[\s\S]*reactivat/iu);
    expect(variants[3]).toMatch(/deactivat[\s\S]*preserve[\s\S]*canonical[\s\S]*native work/iu);
    expect(variants[4]).toMatch(/Unsupported[\s\S]*explicit[\s\S]*reviewed[\s\S]*removal/iu);
  });

  test("Orientation and Scope Review are one bounded read-only operation", async () => {
    const orientation = await readRuntime("references/journeys/project-orientation.md");
    const review = await readRuntime("references/journeys/scope-review.md");
    expect(orientation).toMatch(
      /Project Context[\s\S]*repository evidence[\s\S]*canonical planning/iu,
    );
    expect(orientation).toMatch(/repository facts[\s\S]*native-work facts[\s\S]*Agent inference/iu);
    expect(orientation).toMatch(/Project Summary draft[\s\S]*Roadmap[\s\S]*Gate candidates/iu);
    expect(orientation).toMatch(/read-only[\s\S]*writes nothing/iu);
    expect(review).toMatch(
      /summaries first[\s\S]*active\s+and\s+open[\s\S]*baseline-relevant completed/iu,
    );
    expect(review).toMatch(/same visible operation[\s\S]*no separate outcome/iu);
    expect(review).toMatch(/discard[\s\S]*inventory[\s\S]*no persist/iu);
    expect(review).toMatch(/Offer[\s\S]*high-cost/iu);
  });

  test("native work and execution preserve owners and exact reconciliation", async () => {
    const native = await readRuntime("references/journeys/native-work.md");
    const execution = await readRuntime("references/journeys/execution.md");
    expect(native).toMatch(
      /Work Management[\s\S]*status[\s\S]*checklist[\s\S]*Answer[\s\S]*resolution/iu,
    );
    expect(native).toMatch(/successful[\s\S]*exact[\s\S]*reconcile-native/iu);
    expect(native).toMatch(/failed[\s\S]*no[\s\S]*full-scope[\s\S]*fallback/iu);
    expect(native).toMatch(
      /unbound[\s\S]*material planning[\s\S]*recommendation[\s\S]*enrollment is not a prerequisite/iu,
    );
    expect(execution).toMatch(/same visible operation[\s\S]*original executor command/iu);
    expect(execution).toMatch(/planned Effort[\s\S]*directly entails[\s\S]*activation/iu);
    expect(execution).toMatch(/refus[\s\S]*no\s+Effort[\s\S]*executor[\s\S]*native mutation/iu);
    expect(execution).toMatch(/concluded Effort[\s\S]*never[\s\S]*reopen/iu);
    expect(execution).toMatch(/lifecycle mismatch[\s\S]*facts only/iu);
  });

  test("semantic owners retain direct authority and domain-local follow-up", async () => {
    const summary = await readRuntime("references/owners/project-summary.md");
    const brief = await readRuntime("references/owners/project-brief.md");
    const roadmap = await readRuntime("references/owners/roadmap.md");
    const gate = await readRuntime("references/owners/milestone-gate.md");
    const effort = await readRuntime("references/owners/effort.md");
    const asset = await readRuntime("references/owners/asset.md");
    const authority = await readRuntime("references/owners/authority.md");

    expect(summary).toMatch(
      /accepted long-horizon project meaning[\s\S]*shared materiality test/iu,
    );
    expect(brief).toMatch(/compress accepted truth[\s\S]*shared materiality test/iu);
    expect(roadmap).toMatch(/Complete Roadmap[\s\S]*Extend Horizon[\s\S]*Leave Active for Now/iu);
    expect(gate).toMatch(/human[\s\S]*Passage[\s\S]*readiness[\s\S]*never/iu);
    expect(effort).toMatch(/Work Binding[\s\S]*Effort owner/iu);
    expect(effort).toMatch(
      /\*\*Required:\*\*[\s\S]*new or changed[\s\S]*exact-scope[\s\S]*baseline acquisition/iu,
    );
    expect(asset).toMatch(
      /Citation[\s\S]*does not[\s\S]*Asset metadata|Asset metadata[\s\S]*not[\s\S]*Citation/iu,
    );
    expect(authority).toMatch(/Scope[\s\S]*Baseline Asset[\s\S]*current-baseline explanation/iu);
    expect(authority).toMatch(/membership[\s\S]*no adoption event[\s\S]*timestamp/iu);

    for (const source of [summary, brief, roadmap, gate, effort, asset, authority]) {
      expect(source).toContain("## After this operation");
      expect(source).toMatch(/Required|Consider|Do not infer/u);
    }
  });

  test("Next Work, Audit, and Review preserve the explicit decision lifecycle", async () => {
    const nextWork = await readRuntime("references/journeys/next-work.md");
    const audit = await readRuntime("references/owners/planning-audit.md");
    const review = await readRuntime("references/owners/planning-review.md");

    expect(nextWork).toMatch(/transient Agent judgment[\s\S]*conversation only/iu);
    expect(nextWork).toMatch(/no artifact[\s\S]*queue[\s\S]*selection is persisted/iu);
    expect(audit).toMatch(/explicit Planning Audit request[\s\S]*Replace only the current Audit/iu);
    expect(audit).toMatch(/create or refresh[\s\S]*Question, Scope[\s\S]*exact `Target`/iu);
    expect(audit).toMatch(/reuse[\s\S]*instead of creating a duplicate/iu);
    expect(review).toMatch(/clear direct instruction[\s\S]*accepts one candidate/iu);
    expect(review).toMatch(/completed Review history[\s\S]*later question gets a new identity/iu);
    expect(review).toMatch(
      /Audit, Project Read Model operations, Portal use, or evidence completion[\s\S]*changes\s+Review\s+status/iu,
    );
  });

  test("fresh-Agent contract cases expose exact one-hop selection and observable effects", async () => {
    const { body } = await readSkill();
    const cases = [
      {
        prompt: "Explicit Fresh Bearing configuration",
        refs: ["configure.md", "configure-fresh.md"],
        effects: ["bearing configure inspect", "bearing configure plan", "bearing configure apply"],
      },
      {
        prompt: "Accepted complete Project Orientation",
        refs: ["project-orientation.md", "scope-review.md"],
        effects: ["bearing inspect project"],
      },
      {
        prompt: "Edit a bound native Ticket",
        refs: ["native-work.md"],
        effects: ["bearing inspect --native", "bearing reconcile-native"],
      },
      {
        prompt: "Execute a planned bound Effort",
        refs: ["execution.md", "canonical-mutation.md", "effort.md"],
        effects: ["bearing inspect --native", "bearing inspect <stable-planning-reference>"],
      },
      {
        prompt: "Accept a Summary and Roadmap candidate",
        refs: ["canonical-mutation.md", "project-summary.md", "roadmap.md"],
        effects: ["bearing inspect project", "bearing inspect <stable-planning-reference>"],
      },
    ] as const;

    for (const scenario of cases) {
      for (const reference of scenario.refs) expect(body, scenario.prompt).toContain(reference);
      for (const effect of scenario.effects) expect(body, scenario.prompt).toContain(effect);
    }
    expect(BEARING_POINTER).toMatch(/Do not load[\s\S]*ordinary non-governance code/iu);
    expect(body).toMatch(/explicit[\s\S]*fallback/iu);
    expect(body).toMatch(/no\s+hidden loop[\s\S]*fallback/iu);
  });

  test("retired routing and operation vocabulary is absent from the shipped Skill graph", async () => {
    const sources = await Promise.all([
      readFile(join(skillRoot, "SKILL.md"), "utf8"),
      ...runtimeReferences.map(readRuntime),
    ]);
    const joined = sources.join("\n");
    for (const retired of [
      "branch-manifest.yaml",
      "references/branches",
      "references/shared",
      "Typed Inspection",
      "Public Entry Lifecycle Validation",
      "Artifact Registration",
      "Executor Continuation",
      "Governance Disposition",
      "Project Brief Refresh",
      "Alignment Check",
      "bearing asset register",
      "produced-output manifest",
    ]) {
      expect(joined).not.toContain(retired);
    }
  });
});
