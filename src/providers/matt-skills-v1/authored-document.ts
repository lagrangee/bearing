import {
  type MarkdownDocument,
  type MarkdownSection,
  queryMarkdownSections,
} from "../../markdown-document";
import {
  PROVIDER_SEMANTIC_SECTION_VERSION,
  type ProviderSemanticSection,
} from "../../provider-semantic-section";

type DocumentIdentity = Readonly<{
  sourceIdentity: string;
  title: string;
  semanticRole: string;
}>;

export const mattAuthoredDocumentIdentity = (
  semanticRole: string,
  role: "answer" | "ordinary-comment" | "agent-brief" | "triage-note" | "issue-body",
): DocumentIdentity => ({
  sourceIdentity: `${semanticRole}.${role}`,
  semanticRole,
  title:
    role === "answer"
      ? "Answer"
      : role === "agent-brief"
        ? "Agent Brief"
        : role === "triage-note"
          ? "Triage Note"
          : role === "issue-body"
            ? "Issue Body"
            : "Comment",
});

export const MATT_MAP_DOCUMENT_OWNED_SECTION_TITLES = [
  "Destination",
  "Notes",
  "Work",
  "Decisions so far",
  "Not yet specified",
  "Fog",
  "Out of scope",
  "Resolution Evidence",
] as const;

export const MATT_WAYFINDER_DOCUMENT_OWNED_SECTION_TITLES = [
  "Question",
  "Answer",
  "Comments",
  "Agent Brief",
  "Triage Notes",
] as const;

export const mattAdditiveDocumentSections = (
  source: MarkdownDocument,
  depth: MarkdownSection["heading"]["depth"],
  ownedTitles: readonly string[],
): readonly MarkdownSection[] => {
  const normalizedOwnedTitles = new Set(
    ownedTitles.map((title) => title.trim().toLocaleLowerCase("en")),
  );
  return queryMarkdownSections(source, { depth }).filter(
    (section) => !normalizedOwnedTitles.has(section.heading.title.trim().toLocaleLowerCase("en")),
  );
};

const sectionEnvelope = (
  section: MarkdownSection,
  identity: DocumentIdentity,
  sourceOrder: number,
  semanticRole = false,
): ProviderSemanticSection => ({
  version: PROVIDER_SEMANTIC_SECTION_VERSION,
  sourceIdentity: identity.sourceIdentity,
  title: identity.title,
  sourceOrder,
  ...(semanticRole ? { semanticRole: identity.semanticRole } : {}),
  availability: section.markdown.length === 0 ? "confirmed-empty" : "available",
  markdown: section.markdown,
});

export const projectMattAuthoredSectionDocument = (
  source: MarkdownDocument,
  section: MarkdownSection,
  identity: DocumentIdentity,
  additiveSections: readonly MarkdownSection[] = [],
): Readonly<{ document: readonly ProviderSemanticSection[] }> => {
  const selectedTitles = new Set([
    section.heading.title,
    ...additiveSections.map((candidate) => candidate.heading.title),
  ]);
  const sections = queryMarkdownSections(source, { depth: section.heading.depth }).filter(
    (candidate) => selectedTitles.has(candidate.heading.title),
  );
  return {
    document: sections.map((candidate, sourceOrder) => {
      const primary = candidate.heading.title === section.heading.title;
      return sectionEnvelope(
        candidate,
        primary
          ? identity
          : {
              sourceIdentity: `${identity.sourceIdentity}.additional.${sourceOrder}`,
              title: candidate.heading.title,
              semanticRole: identity.semanticRole,
            },
        sourceOrder,
        primary,
      );
    }),
  };
};

export const projectMattAuthoredBodyDocument = (
  source: string,
  identity: DocumentIdentity,
): Readonly<{ document: readonly ProviderSemanticSection[] }> => {
  return {
    document: [
      {
        version: PROVIDER_SEMANTIC_SECTION_VERSION,
        ...identity,
        sourceOrder: 0,
        availability: source.trim().length === 0 ? "confirmed-empty" : "available",
        markdown: source,
      },
    ],
  };
};

export const projectMattUnsupportedAuthoredDocument = (
  semanticRole: string,
  title: string,
): readonly ProviderSemanticSection[] => [
  {
    version: PROVIDER_SEMANTIC_SECTION_VERSION,
    sourceIdentity: `${semanticRole}.unsupported`,
    semanticRole,
    title,
    sourceOrder: 0,
    availability: "unsupported",
    markdown: "",
  },
];

export const mattDocumentSectionAvailability = (
  document: readonly ProviderSemanticSection[],
  semanticRole: string,
): ProviderSemanticSection["availability"] =>
  document.find((section) => section.semanticRole === semanticRole)?.availability ?? "unavailable";

export const mattAuthoredDocumentCollectionAvailability = (
  documents: readonly Readonly<{ document: readonly ProviderSemanticSection[] }>[],
  semanticRole: string,
): ProviderSemanticSection["availability"] | undefined => {
  if (documents.length === 0) return undefined;
  const availabilities = documents.map((document) =>
    mattDocumentSectionAvailability(document.document, semanticRole),
  );
  const first = availabilities[0] ?? "unavailable";
  return availabilities.every((availability) => availability === first) ? first : "unavailable";
};
