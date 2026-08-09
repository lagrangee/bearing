import { expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import {
  documentPresentationSchema,
  isExternalDocumentPresentationHref,
} from "../src/document-presentation";
import {
  markdownDocumentPresentationBlocks,
  parseMarkdownDocument,
  queryMarkdownSection,
} from "../src/markdown-document";
import { createLocalMarkdownMattProvider } from "../src/providers/matt-skills-v1/local-markdown";
import { projectMattSpecDocument } from "../src/providers/matt-skills-v1/spec-document";
import {
  mattEquivalenceLocalContractLocator,
  mattEquivalenceLocalScope,
  mattEquivalenceTriageLocator,
  writeMattEquivalenceLocalRepository,
} from "./fixtures/matt-equivalence-scenario";

test("projects supported authored Markdown into provider-neutral typed blocks", () => {
  const document = parseMarkdownDocument(`# Reference Spec

## User Stories

The reader keeps **strong**, *emphasis*, \`inline code\`, and a [safe link](https://example.com/spec).

### Ordered outcomes

3. First outcome
4. Second outcome
   - Supporting detail
     - Nested detail
`);
  const section = queryMarkdownSection(document, { title: "User Stories", depth: 2 });
  if (section.state !== "found") throw new Error("Expected the User Stories section.");

  expect(markdownDocumentPresentationBlocks(document, section.value)).toEqual({
    ok: true,
    blocks: [
      {
        kind: "paragraph",
        inlines: [
          { kind: "text", value: "The reader keeps " },
          { kind: "strong", inlines: [{ kind: "text", value: "strong" }] },
          { kind: "text", value: ", " },
          { kind: "emphasis", inlines: [{ kind: "text", value: "emphasis" }] },
          { kind: "text", value: ", " },
          { kind: "inline-code", value: "inline code" },
          { kind: "text", value: ", and a " },
          {
            kind: "link",
            href: "https://example.com/spec",
            inlines: [{ kind: "text", value: "safe link" }],
          },
          { kind: "text", value: "." },
        ],
      },
      {
        kind: "heading",
        level: 3,
        inlines: [{ kind: "text", value: "Ordered outcomes" }],
      },
      {
        kind: "list",
        style: "ordered",
        start: 3,
        items: [
          { inlines: [{ kind: "text", value: "First outcome" }], children: [] },
          {
            inlines: [{ kind: "text", value: "Second outcome" }],
            children: [
              {
                kind: "list",
                style: "unordered",
                items: [
                  {
                    inlines: [{ kind: "text", value: "Supporting detail" }],
                    children: [
                      {
                        kind: "list",
                        style: "unordered",
                        items: [
                          {
                            inlines: [{ kind: "text", value: "Nested detail" }],
                            children: [],
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  });
});

test("rejects incompatible document versions and unknown block kinds", () => {
  const section = {
    sourceIdentity: "spec.problem",
    title: "Problem Statement",
    sourceOrder: 0,
    semanticRole: "spec.problem",
    availability: "available",
    blocks: [{ kind: "paragraph", inlines: [{ kind: "text", value: "Safe text." }] }],
  };

  expect(() => documentPresentationSchema.parse({ version: 2, sections: [section] })).toThrow();
  expect(() =>
    documentPresentationSchema.parse({
      version: 1,
      sections: [{ ...section, blocks: [{ kind: "html", value: "<script />" }] }],
    }),
  ).toThrow();
});

test("rejects authored heading-level jumps below the Portal-owned H2", () => {
  const section = {
    sourceIdentity: "spec.problem",
    title: "Problem Statement",
    sourceOrder: 0,
    semanticRole: "spec.problem",
    availability: "available",
    blocks: [{ kind: "heading", level: 4, inlines: [{ kind: "text", value: "Skipped H3" }] }],
  };

  expect(() => documentPresentationSchema.parse({ version: 1, sections: [section] })).toThrow(
    "Document headings must not skip a level",
  );
});

test("classifies external links through the shared URL boundary", () => {
  expect(isExternalDocumentPresentationHref("https://example.com/spec")).toBe(true);
  expect(isExternalDocumentPresentationHref("mailto:reader@example.com")).toBe(true);
  expect(isExternalDocumentPresentationHref("../relative/spec")).toBe(false);
});

test("fails closed for raw HTML and unsafe links instead of returning fallback text", () => {
  for (const source of [
    "## Section\n\n<script>alert(1)</script>\n",
    "## Section\n\n[unsafe](javascript:alert(1))\n",
  ]) {
    const document = parseMarkdownDocument(source);
    const section = queryMarkdownSection(document, { title: "Section", depth: 2 });
    if (section.state !== "found") throw new Error("Expected the document section.");
    expect(markdownDocumentPresentationBlocks(document, section.value)).toMatchObject({
      ok: false,
    });
  }
});

test("Matt assigns semantic roles while retaining additive source sections in source order", () => {
  const result = projectMattSpecDocument(
    parseMarkdownDocument(`# Reference Spec

## Solution

Use the shared contract.

## Compatibility Notes

An additive section remains readable.

## Testing

- Validate the source order.
`),
  );

  expect(result.document).toEqual({
    version: 1,
    sections: [
      {
        sourceIdentity: "spec.solution",
        semanticRole: "spec.solution",
        title: "Solution",
        sourceOrder: 0,
        availability: "available",
        blocks: [
          {
            kind: "paragraph",
            inlines: [{ kind: "text", value: "Use the shared contract." }],
          },
        ],
      },
      {
        sourceIdentity: "spec.source.compatibility-notes",
        title: "Compatibility Notes",
        sourceOrder: 1,
        availability: "available",
        blocks: [
          {
            kind: "paragraph",
            inlines: [{ kind: "text", value: "An additive section remains readable." }],
          },
        ],
      },
      {
        sourceIdentity: "spec.testing",
        semanticRole: "spec.testing",
        title: "Testing",
        sourceOrder: 2,
        availability: "available",
        blocks: [
          {
            kind: "list",
            style: "unordered",
            items: [
              {
                inlines: [{ kind: "text", value: "Validate the source order." }],
                children: [],
              },
            ],
          },
        ],
      },
    ],
  });
  expect(result.semanticSections).toContainEqual({
    role: "spec.problem",
    availability: "unavailable",
  });
  expect(result.semanticSections).toContainEqual({
    role: "spec.testing",
    availability: "available",
  });
  expect(result.diagnostics).toEqual([]);
});

test("Local Markdown capture publishes a typed Spec document without raw section bodies", async () => {
  const root = await writeMattEquivalenceLocalRepository();
  try {
    const capture = await createLocalMarkdownMattProvider({
      repoRoot: root,
      contractLocator: mattEquivalenceLocalContractLocator,
      triageLocator: mattEquivalenceTriageLocator,
      clock: () => new Date("2026-08-09T00:00:00Z"),
    }).capture({ provider: "matt-skills/v1", nativeScope: mattEquivalenceLocalScope });
    if (capture.state !== "available" && capture.state !== "partial") {
      throw new Error("Expected a readable Local Markdown capture.");
    }
    const spec = capture.projection.spec;
    if (spec === undefined) throw new Error("Expected a projected Spec.");

    expect(spec.document.version).toBe(1);
    expect(spec.document.sections[0]).toMatchObject({
      sourceIdentity: "spec.problem",
      semanticRole: "spec.problem",
      title: "Problem Statement",
      sourceOrder: 0,
      availability: "available",
    });
    expect(spec).not.toHaveProperty("sections");
    expect(spec.native.rawFacets.map((facet) => facet.key)).not.toContain("markdown");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
