import { describe, expect, test } from "bun:test";
import {
  markdownDocumentBody,
  parseMarkdownDocument,
  parseMarkdownEnvelope,
  queryMarkdownDocumentTitle,
  queryMarkdownField,
  queryMarkdownFrontmatter,
  queryMarkdownHeading,
  queryMarkdownInlineCodes,
  queryMarkdownLinks,
  queryMarkdownList,
  queryMarkdownLists,
  queryMarkdownPreamble,
  queryMarkdownSection,
  queryMarkdownTable,
  serializeMarkdownDocument,
} from "../src/markdown-document";

describe("shared Markdown document boundary", () => {
  test("decodes YAML frontmatter and GFM through Bearing-owned structural queries", () => {
    const document = parseMarkdownDocument(`---
status: ready
owner:
  name: Lago
---
# Contract

Extra prose before the requested section is allowed.

### Work

**Status:** ready for [agent](https://example.com/agent).

- [x] Parse ~~legacy~~ GFM
- Preserve <https://example.com/docs>

| Role | State |
| --- | --- |
| Delivery | ready |

\`\`\`md
### Fake heading
Status: fake
[fake](https://example.com/fake)
\`\`\`
`);

    expect(queryMarkdownFrontmatter(document)).toEqual({
      state: "found",
      value: { status: "ready", owner: { name: "Lago" } },
    });
    expect(queryMarkdownHeading(document, { title: "Work" })).toEqual({
      state: "found",
      value: { depth: 3, title: "Work" },
    });

    const section = queryMarkdownSection(document, { title: "Work" });
    expect(section.state).toBe("found");
    if (section.state !== "found") throw new Error("Expected Work section.");
    expect(section.value.markdown).toContain("| Delivery | ready |");
    expect(queryMarkdownField(document, { label: "Status", within: section.value })).toEqual({
      state: "found",
      value: { label: "Status", value: "ready for agent." },
    });
    expect(queryMarkdownList(document, { within: section.value })).toEqual({
      state: "found",
      value: {
        ordered: false,
        items: [
          { text: "Parse legacy GFM", checked: true },
          {
            text: "Preserve https://example.com/docs",
            links: [
              {
                label: "https://example.com/docs",
                target: "https://example.com/docs",
              },
            ],
          },
        ],
      },
    });
    expect(queryMarkdownLinks(document, { within: section.value })).toEqual([
      { label: "agent", target: "https://example.com/agent" },
      {
        label: "https://example.com/docs",
        target: "https://example.com/docs",
      },
    ]);
    expect(queryMarkdownInlineCodes(document, { within: section.value })).toEqual([]);
  });

  test("extracts inline code locators within one structural section", () => {
    const document = parseMarkdownDocument(`# Agent instructions

Outside \`docs/agents/decoy.md\`.

## Agent skills

### Issue tracker

Issues live in GitHub. See \`docs/agents/issue-tracker.md\`.

\`\`\`md
\`docs/agents/code-fence-decoy.md\`
\`\`\`

### Triage labels

See \`docs/agents/triage-labels.md\`.
`);
    const issueTracker = queryMarkdownSection(document, { title: "Issue tracker" });
    expect(issueTracker.state).toBe("found");
    if (issueTracker.state !== "found") throw new Error("Expected Issue tracker section.");

    expect(queryMarkdownInlineCodes(document, { within: issueTracker.value })).toEqual([
      "docs/agents/issue-tracker.md",
    ]);

    const agentSkills = queryMarkdownSection(document, {
      title: "Agent skills",
      depth: 2,
    });
    expect(agentSkills.state).toBe("found");
    if (agentSkills.state !== "found") throw new Error("Expected Agent skills section.");
    expect(
      queryMarkdownSection(document, {
        title: "Issue tracker",
        depth: 3,
        within: agentSkills.value,
      }),
    ).toEqual(issueTracker);
    expect(
      queryMarkdownSection(document, {
        title: "Triage labels",
        depth: 3,
        within: issueTracker.value,
      }),
    ).toEqual({ state: "absent" });
  });

  test("accepts plain field labels and heading-depth variation without line parsing", () => {
    const document = parseMarkdownDocument(`# Ticket

#### Acceptance criteria

Status: claimed

Additional native prose.
`);
    const section = queryMarkdownSection(document, { title: "Acceptance criteria" });
    expect(section.state).toBe("found");
    if (section.state !== "found") throw new Error("Expected acceptance section.");
    expect(section.value.heading.depth).toBe(4);
    expect(queryMarkdownField(document, { label: "Status", within: section.value })).toEqual({
      state: "found",
      value: { label: "Status", value: "claimed" },
    });
  });

  test("supports whole-emphasis fields, space-separated relations and all-list queries", () => {
    const document = parseMarkdownDocument(`**PRs as a request surface: yes.**

Part of #7

**Related to** #8

**Parent #9**

- [ ] [First child](https://github.com/example/repo/issues/8)

1. Ordered evidence
`);

    expect(queryMarkdownField(document, { label: "PRs as a request surface" })).toEqual({
      state: "found",
      value: { label: "PRs as a request surface", value: "yes." },
    });
    expect(queryMarkdownField(document, { label: "Part of", separator: "space" })).toEqual({
      state: "found",
      value: { label: "Part of", value: "#7" },
    });
    expect(queryMarkdownField(document, { label: "Related to", separator: "space" })).toEqual({
      state: "found",
      value: { label: "Related to", value: "#8" },
    });
    expect(queryMarkdownField(document, { label: "Parent", separator: "space" })).toEqual({
      state: "found",
      value: { label: "Parent", value: "#9" },
    });
    expect(queryMarkdownLists(document).map((list) => list.ordered)).toEqual([false, true]);
  });

  test("returns typed absence and ambiguity for required semantic queries", () => {
    const document = parseMarkdownDocument(`# Ticket

## Work

Status: ready

## Work

**Status:** claimed
`);

    expect(queryMarkdownHeading(document, { title: "Missing" })).toEqual({
      state: "absent",
    });
    expect(queryMarkdownSection(document, { title: "Work" })).toEqual({
      state: "ambiguous",
      reason: "duplicate",
      matches: 2,
    });
    expect(queryMarkdownField(document, { label: "Owner" })).toEqual({
      state: "absent",
    });
    expect(queryMarkdownField(document, { label: "Status" })).toEqual({
      state: "ambiguous",
      reason: "conflict",
      matches: 2,
    });

    for (const source of [
      "Status:",
      "**Status:**",
      "**Status**",
      "Status:: broken",
      "**Status:**: broken",
      "**Status**:: broken",
    ]) {
      expect(
        queryMarkdownField(parseMarkdownDocument(source), { label: "Status" }),
        source,
      ).toEqual({
        state: "ambiguous",
        reason: "malformed",
        matches: 1,
      });
    }
  });

  test("reports malformed or conflicting frontmatter without a regex fallback", () => {
    const malformed = parseMarkdownDocument(`---
owner: [
---
# Ticket
`);
    expect(queryMarkdownFrontmatter(malformed)).toEqual({
      state: "ambiguous",
      reason: "malformed",
      matches: 1,
    });

    const conflicting = parseMarkdownDocument(`---
owner: Lago
owner: Blue
---
# Ticket
`);
    expect(queryMarkdownFrontmatter(conflicting)).toEqual({
      state: "ambiguous",
      reason: "conflict",
      matches: 1,
    });

    expect(queryMarkdownFrontmatter(parseMarkdownDocument("# No envelope\n"))).toEqual({
      state: "absent",
    });
  });

  test("uses the same production document path for Local and GitHub Markdown bodies", () => {
    for (const sourceRole of ["local-file", "github-issue", "github-pr", "github-comment"]) {
      const document = parseMarkdownDocument(`## Evidence

**Source role:** ${sourceRole}
`);
      const section = queryMarkdownSection(document, { title: "Evidence" });
      expect(section.state, sourceRole).toBe("found");
      if (section.state !== "found")
        throw new Error(`Expected Evidence section for ${sourceRole}.`);
      expect(queryMarkdownField(document, { label: "Source role", within: section.value })).toEqual(
        {
          state: "found",
          value: { label: "Source role", value: sourceRole },
        },
      );
    }
  });

  test("exposes document titles and GFM tables without leaking mdast", () => {
    const document = parseMarkdownDocument(`# Triage Labels

| Semantic role | Label in our tracker | Meaning |
| --- | --- | --- |
| \`ready-for-agent\` | **custom-ready** | Ready |
| \`enhancement\` | \`custom-enhancement\` | Feature |
`);

    expect(queryMarkdownDocumentTitle(document)).toEqual({
      state: "found",
      value: { depth: 1, title: "Triage Labels" },
    });
    expect(queryMarkdownTable(document)).toEqual({
      state: "found",
      value: {
        columns: ["Semantic role", "Label in our tracker", "Meaning"],
        rows: [
          ["ready-for-agent", "custom-ready", "Ready"],
          ["enhancement", "custom-enhancement", "Feature"],
        ],
      },
    });
  });

  test("fails closed on duplicate document titles and tables", () => {
    const document = parseMarkdownDocument(`# First

# Second

| A |
| - |
| 1 |

| B |
| - |
| 2 |
`);

    expect(queryMarkdownDocumentTitle(document)).toEqual({
      state: "ambiguous",
      reason: "conflict",
      matches: 2,
    });
    expect(queryMarkdownTable(document)).toEqual({
      state: "ambiguous",
      reason: "duplicate",
      matches: 2,
    });
  });

  test("isolates the document preamble from later Answer lists and fields", () => {
    const document = parseMarkdownDocument(`# Delivery

Status: resolved

- [x] Acceptance one
- [x] Acceptance two

## Answer

Status: evidence-only

- Verification one
- Verification two
`);
    const preamble = queryMarkdownPreamble(document);
    expect(preamble.state).toBe("found");
    if (preamble.state !== "found") throw new Error("Expected document preamble.");
    expect(queryMarkdownField(document, { label: "Status", within: preamble.value })).toEqual({
      state: "found",
      value: { label: "Status", value: "resolved" },
    });
    expect(queryMarkdownList(document, { within: preamble.value })).toEqual({
      state: "found",
      value: {
        ordered: false,
        items: [
          { text: "Acceptance one", checked: true },
          { text: "Acceptance two", checked: true },
        ],
      },
    });
  });

  test("writes the frontmatter envelope through the shared structural stack", () => {
    const source = serializeMarkdownDocument({
      frontmatter: { status: "ready", nested: { enabled: true } },
      body: "# Ticket\n\nBody with [evidence](https://example.com/evidence).\n",
    });
    expect(source).toStartWith("---\nstatus: ready\nnested:\n  enabled: true\n---\n");
    const document = parseMarkdownDocument(source);
    expect(queryMarkdownFrontmatter(document)).toEqual({
      state: "found",
      value: { status: "ready", nested: { enabled: true } },
    });
    expect(queryMarkdownLinks(document)).toEqual([
      { label: "evidence", target: "https://example.com/evidence" },
    ]);
  });

  test("preserves an existing Markdown body byte-for-byte while replacing its envelope", () => {
    for (const body of ["", "plain\n", "\r\n# Registry\r\n\r\n- item\r\n\r\n1) ordered\r\n"]) {
      const source = serializeMarkdownDocument({ frontmatter: { status: "ready" }, body });
      const parsed = parseMarkdownEnvelope(source);

      expect(parsed.ok).toBe(true);
      if (!parsed.ok) throw new Error("Expected serialized Markdown envelope.");
      expect(parsed.body).toBe(body);
    }
  });

  test("exposes the body without reparsing the frontmatter envelope", () => {
    const document = parseMarkdownDocument(`---
status: ready
---

# Ticket

Body.
`);
    expect(markdownDocumentBody(document)).toBe("\n# Ticket\n\nBody.\n");
    expect(markdownDocumentBody(parseMarkdownDocument("# Plain body\n"))).toBe("# Plain body\n");
  });
});
