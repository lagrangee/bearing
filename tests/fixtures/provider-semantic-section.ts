import {
  PROVIDER_SEMANTIC_SECTION_VERSION,
  type ProviderSemanticSection,
} from "../../src/provider-semantic-section";

export const architectureContractionPrdReadingFixture = `# Architecture Contraction

Status: ready-for-agent

## Problem Statement

Provider-authored Markdown must remain readable without changing governance truth.

## Solution

Publish source Markdown through one safe Host rendering path.

## User Stories

### Provider-neutral document reading and Project Brief refinement

126. As a Portal reader, I want authored structure to remain readable.
127. As a Portal reader, I want one behavior across every semantic section.
128. As a Portal reader, I want ordered lists to remain ordered.
129. As a Portal reader, I want nested and task lists to retain their meaning.

## Implementation Decisions

### Provider-neutral document reading

- **AC-DR-01** — Use one versioned Provider Semantic Section envelope.
- **AC-DR-02** — Preserve the observed Markdown instead of serializing mdast.

## Testing Decisions

Exercise the committed PRD corpus through capture, SQLite, Host rendering and Portal markup.

## Out of Scope

Do not infer Gate Passage or lifecycle changes.

## Further Notes

The product path stays read-only.
`;

export const plainProviderSemanticSections = (
  sections: readonly Readonly<{ role: string; title: string; body: string }>[],
  namespace = "spec",
): readonly ProviderSemanticSection[] =>
  sections.map((section, sourceOrder) => ({
    version: PROVIDER_SEMANTIC_SECTION_VERSION,
    sourceIdentity: `${namespace}.${section.role}`,
    semanticRole: `${namespace}.${section.role}`,
    title: section.title,
    sourceOrder,
    availability: section.body.length === 0 ? "confirmed-empty" : "available",
    markdown: section.body,
  }));

export const plainProviderSection = (
  semanticRole: string,
  title: string,
  body: string,
): readonly ProviderSemanticSection[] => {
  const separator = semanticRole.indexOf(".");
  const namespace = separator === -1 ? "provider" : semanticRole.slice(0, separator);
  const role = separator === -1 ? semanticRole : semanticRole.slice(separator + 1);
  return plainProviderSemanticSections([{ role, title, body }], namespace);
};
