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
  namespace = "spec",
): DocumentPresentation => ({
  version: DOCUMENT_PRESENTATION_VERSION,
  sections: sections.map((section, sourceOrder) => ({
    sourceIdentity: `${namespace}.${section.role}`,
    semanticRole: `${namespace}.${section.role}`,
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

export const plainProviderDocument = (
  semanticRole: string,
  title: string,
  body: string,
): DocumentPresentation => {
  const separator = semanticRole.indexOf(".");
  const namespace = separator === -1 ? "provider" : semanticRole.slice(0, separator);
  const role = separator === -1 ? semanticRole : semanticRole.slice(separator + 1);
  return plainDocumentPresentation([{ role, title, body }], namespace);
};
