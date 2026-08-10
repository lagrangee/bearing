import { expect, test } from "bun:test";
import { markdownSemanticPlainText, parseMarkdownDocument } from "../src/markdown-document";
import {
  createMarkdownEngine,
  renderProviderMarkdownSections,
  sharedMarkdownEngine,
} from "../src/portal/markdown-engine";
import {
  providerSemanticSectionSchema,
  providerSemanticSectionsSchema,
} from "../src/provider-semantic-section";
import {
  mattAuthoredDocumentIdentity,
  projectMattAuthoredBodyDocument,
} from "../src/providers/matt-skills-v1/authored-document";
import { projectMattSpecDocument } from "../src/providers/matt-skills-v1/spec-document";

test("Provider Semantic Sections preserve the observed Markdown slice and additive source order", () => {
  const hardBreak = "  ";
  const authored = `# Reference Spec

## Solution

Use **the shared contract**.

> Keep source syntax.

Keep this hard break.${hardBreak}
Continue after the break.

## Compatibility Notes

- [x] Preserve this additive section.

## Testing

| Seam | Result |
| --- | --- |
| Host | Safe |
`;
  const result = projectMattSpecDocument(parseMarkdownDocument(authored));

  expect(result.document).toEqual([
    {
      version: 1,
      sourceIdentity: "spec.solution",
      semanticRole: "spec.solution",
      title: "Solution",
      sourceOrder: 0,
      availability: "available",
      markdown: `Use **the shared contract**.\n\n> Keep source syntax.\n\nKeep this hard break.${hardBreak}\nContinue after the break.`,
    },
    {
      version: 1,
      sourceIdentity: "spec.source.compatibility-notes",
      title: "Compatibility Notes",
      sourceOrder: 1,
      availability: "available",
      markdown: "- [x] Preserve this additive section.",
    },
    {
      version: 1,
      sourceIdentity: "spec.testing",
      semanticRole: "spec.testing",
      title: "Testing",
      sourceOrder: 2,
      availability: "available",
      markdown: "| Seam | Result |\n| --- | --- |\n| Host | Safe |",
    },
  ]);

  const body = "\n  Keep the provider's **exact body spacing**.  \n";
  expect(
    projectMattAuthoredBodyDocument(
      body,
      mattAuthoredDocumentIdentity("incoming.content", "issue-body"),
    ).document[0]?.markdown,
  ).toBe(body);
});

test("Provider Semantic Section schema rejects incompatible versions and representation drift", () => {
  const section = {
    version: 1,
    sourceIdentity: "spec.problem",
    semanticRole: "spec.problem",
    title: "Problem Statement",
    sourceOrder: 0,
    availability: "available",
    markdown: "Readable source.",
  } as const;
  expect(providerSemanticSectionSchema.parse(section)).toEqual(section);
  expect(providerSemanticSectionSchema.safeParse({ ...section, version: 2 }).success).toBe(false);
  expect(
    providerSemanticSectionSchema.safeParse({ ...section, markdown: "", availability: "available" })
      .success,
  ).toBe(false);
  expect(
    providerSemanticSectionSchema.safeParse({
      ...section,
      availability: "unsupported",
      markdown: "",
    }).success,
  ).toBe(true);
  expect(
    providerSemanticSectionSchema.safeParse({ ...section, availability: "unsupported" }).success,
  ).toBe(false);
  expect(
    renderProviderMarkdownSections([{ ...section, availability: "unsupported", markdown: "" }]),
  ).toEqual([]);
  expect(
    providerSemanticSectionSchema.safeParse({ ...section, blocks: [], html: "<p>drift</p>" })
      .success,
  ).toBe(false);
  expect(
    providerSemanticSectionsSchema.safeParse([
      section,
      { ...section, sourceIdentity: "spec.solution", sourceOrder: 2 },
    ]).success,
  ).toBe(false);
});

test("shared Host engine renders the complete accepted Markdown set", () => {
  const result = sharedMarkdownEngine.renderFragment(`# H1

###### H6

1. Ordered
   - Nested
   - [x] Done

> Quote

\`\`\`ts
const value = 1;
\`\`\`

| A | B |
| --- | --- |
| **strong** | ~~old~~ and *em* and \`code\` |

[Safe](https://example.com/spec)
`);
  expect(result.presentation).toBe("rendered");
  expect(result.html).toContain("<h1>H1</h1>");
  expect(result.html).toContain("<h6>H6</h6>");
  expect(result.html).toContain("<ol>");
  expect(result.html).toContain("<blockquote>");
  expect(result.html).toContain("<pre><code");
  expect(result.html).toContain("<table>");
  expect(result.html).toContain("<strong>strong</strong>");
  expect(result.html).toContain("<s>old</s>");
  expect(result.html).toContain('type="checkbox"');
  expect(result.html).toMatch(/<input[^>]+\bdisabled\b/iu);
  expect(result.html).toContain('aria-label="Done"');
  expect(result.html).not.toMatch(/\bid="task-item-/u);
  expect(result.html).not.toMatch(/\bfor="task-item-/u);
  expect(result.html).toContain('href="https://example.com/spec"');
});

test("shared Host engine loads authored Web images but removes active content", () => {
  const result = sharedMarkdownEngine.renderFragment(`<script>alert(1)</script>

[Relative](../spec) [Unsafe](javascript:alert(1)) [Mail](mailto:reader@example.com)

![HTTP plan](http://images.example/http.png) ![HTTPS plan](https://images.example/https.png)

![Protocol relative](//images.example/protocol.png) ![Local path](/etc/passwd) ![Unsafe image](javascript:alert(1))

<form action="https://attacker.example"><input></form><iframe src="https://attacker.example"></iframe>
`);
  expect(result.html).not.toMatch(/<(?:script|form|iframe)\b/iu);
  expect(result.html).not.toContain("javascript:");
  expect(result.html).not.toContain('href="../spec"');
  expect(result.html).toContain("Relative");
  expect(result.html).toContain('href="mailto:reader@example.com"');
  for (const [alt, source] of [
    ["HTTP plan", "http://images.example/http.png"],
    ["HTTPS plan", "https://images.example/https.png"],
  ]) {
    expect(result.html).toContain(
      `<a class="markdown-linked-image" href="${source}" target="_blank" rel="noopener noreferrer"><img class="markdown-linked-image-thumbnail" src="${source}" alt="${alt}" loading="lazy" /></a>`,
    );
  }
  expect(result.html.match(/<img\b/gu)).toHaveLength(2);
  expect(result.html).not.toContain("//images.example/protocol.png");
  expect(result.html).not.toContain("/etc/passwd");
  expect(result.html).toContain("Protocol relative");
  expect(result.html).toContain("Local path");
  expect(result.html).toContain("Unsafe image");
});

test("shared Host engine returns escaped readable Markdown when rendering or sanitizing fails", () => {
  for (const engine of [
    createMarkdownEngine({
      render: () => {
        throw new Error("render failed");
      },
    }),
    createMarkdownEngine({
      beforeSanitize: () => {
        throw new Error("sanitize failed");
      },
    }),
  ]) {
    const result = engine.renderFragment("# Heading\n\n<script>alert(1)</script>");
    expect(result.presentation).toBe("fallback");
    expect(result.html).toContain("Formatting is unavailable for this section.");
    expect(result.html).toContain("# Heading");
    expect(result.html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(result.html).not.toContain("<script>");
  }
});

test("Project Find plain text derives from source Markdown through mdast", () => {
  expect(markdownSemanticPlainText("## Plan\n\nUse **safe** `code`.\n\n- First\n- Second")).toBe(
    "Plan\nUse safe code.\nFirst\nSecond",
  );
});
