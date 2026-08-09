import {
  DOCUMENT_PRESENTATION_VERSION,
  type DocumentPresentation,
} from "../../src/document-presentation";

export const plainDocumentPresentation = (
  sections: readonly Readonly<{
    role: string;
    title: string;
    body: string;
  }>[],
): DocumentPresentation => ({
  version: DOCUMENT_PRESENTATION_VERSION,
  sections: sections.map((section, sourceOrder) => ({
    sourceIdentity: `spec.${section.role}`,
    semanticRole: `spec.${section.role}`,
    title: section.title,
    sourceOrder,
    availability: "available",
    blocks: [
      {
        kind: "paragraph",
        inlines: [{ kind: "text", value: section.body }],
      },
    ],
  })),
});
