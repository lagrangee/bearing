import {
  DOCUMENT_PRESENTATION_VERSION,
  type DocumentPresentation,
  type DocumentPresentationSection,
} from "../../document-presentation";
import {
  type MarkdownDocument,
  type MarkdownDocumentPresentationResult,
  type MarkdownSection,
  markdownDocumentPresentationBlocks,
  markdownDocumentPresentationBodyBlocks,
  parseMarkdownDocument,
  queryMarkdownSections,
} from "../../markdown-document";

export type MattAuthoredDocumentDiagnostic = Readonly<{
  code: "matt.document-section-unsupported";
  message: string;
}>;

type DocumentIdentity = Readonly<{
  sourceIdentity: string;
  title: string;
  semanticRole: string;
}>;

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

const documentFromProjection = (
  identity: DocumentIdentity,
  projected: MarkdownDocumentPresentationResult,
): Readonly<{
  document: DocumentPresentation;
  diagnostic?: MattAuthoredDocumentDiagnostic | undefined;
}> => {
  const section: DocumentPresentationSection = {
    ...identity,
    sourceOrder: 0,
    availability: projected.ok
      ? projected.blocks.length === 0
        ? "confirmed-empty"
        : "available"
      : "unavailable",
    blocks: projected.ok ? projected.blocks : [],
  };
  return {
    document: { version: DOCUMENT_PRESENTATION_VERSION, sections: [section] },
    ...(projected.ok
      ? {}
      : {
          diagnostic: {
            code: "matt.document-section-unsupported" as const,
            message: `Authored document contains unsupported ${projected.reason} content (${projected.nodeKind}).`,
          },
        }),
  };
};

export const projectMattAuthoredSectionDocument = (
  source: MarkdownDocument,
  section: MarkdownSection,
  identity: DocumentIdentity,
  additiveSections: readonly MarkdownSection[] = [],
) => {
  if (additiveSections.length === 0) {
    return documentFromProjection(identity, markdownDocumentPresentationBlocks(source, section));
  }
  const selectedTitles = new Set([
    section.heading.title,
    ...additiveSections.map((candidate) => candidate.heading.title),
  ]);
  const sections = queryMarkdownSections(source, { depth: section.heading.depth }).filter(
    (candidate) => selectedTitles.has(candidate.heading.title),
  );
  const diagnostics: MattAuthoredDocumentDiagnostic[] = [];
  const documentSections = sections.map((candidate, sourceOrder) => {
    const primary = candidate.heading.title === section.heading.title;
    const projected = markdownDocumentPresentationBlocks(source, candidate);
    if (!projected.ok) {
      diagnostics.push({
        code: "matt.document-section-unsupported",
        message: `Authored document contains unsupported ${projected.reason} content (${projected.nodeKind}).`,
      });
    }
    return {
      sourceIdentity: primary
        ? identity.sourceIdentity
        : `${identity.sourceIdentity}.additional.${sourceOrder}`,
      title: primary ? identity.title : candidate.heading.title,
      sourceOrder,
      ...(primary ? { semanticRole: identity.semanticRole } : {}),
      availability: projected.ok
        ? projected.blocks.length === 0
          ? ("confirmed-empty" as const)
          : ("available" as const)
        : ("unavailable" as const),
      blocks: projected.ok ? projected.blocks : [],
    };
  });
  return {
    document: { version: DOCUMENT_PRESENTATION_VERSION, sections: documentSections },
    ...(diagnostics[0] === undefined ? {} : { diagnostic: diagnostics[0] }),
  };
};

export const projectMattAuthoredBodyDocument = (source: string, identity: DocumentIdentity) =>
  documentFromProjection(
    identity,
    markdownDocumentPresentationBodyBlocks(parseMarkdownDocument(source)),
  );

export const mattDocumentSectionAvailability = (
  document: DocumentPresentation,
  semanticRole: string,
): DocumentPresentationSection["availability"] =>
  document.sections.find((section) => section.semanticRole === semanticRole)?.availability ??
  "unavailable";
