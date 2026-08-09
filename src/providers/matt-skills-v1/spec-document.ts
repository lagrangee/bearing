import { createHash } from "node:crypto";
import {
  DOCUMENT_PRESENTATION_VERSION,
  type DocumentPresentation,
  type DocumentPresentationSection,
} from "../../document-presentation";
import {
  type MarkdownDocument,
  markdownCanonicalHeadingTitle,
  markdownDocumentPresentationBlocks,
  queryMarkdownSections,
} from "../../markdown-document";
import type { MattSemanticSection } from "./model";
import { MATT_SPEC_SECTION_DEFINITIONS, semanticSection } from "./semantic-sections";

export type MattSpecDocumentDiagnostic = Readonly<{
  code: "matt.spec.document-section-ambiguous" | "matt.spec.document-section-unsupported";
  title: string;
  message: string;
}>;

const semanticRoleForTitle = (title: string): string | undefined => {
  const definition = MATT_SPEC_SECTION_DEFINITIONS.find((candidate) =>
    [candidate.title, ...candidate.aliases].some((candidateTitle) => candidateTitle === title),
  );
  return definition === undefined ? undefined : `spec.${definition.role}`;
};

const unknownSourceIdentity = (title: string, occurrence: number): string => {
  const slug = title
    .normalize("NFKD")
    .toLocaleLowerCase("en")
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "");
  const stableName =
    slug.length > 0
      ? slug
      : `section-${createHash("sha256").update(title, "utf8").digest("hex").slice(0, 12)}`;
  return `spec.source.${stableName}${occurrence === 1 ? "" : `.${occurrence}`}`;
};

export const projectMattSpecDocument = (
  source: MarkdownDocument,
): Readonly<{
  document: DocumentPresentation;
  semanticSections: readonly MattSemanticSection[];
  diagnostics: readonly MattSpecDocumentDiagnostic[];
}> => {
  const sourceSections = queryMarkdownSections(source, { depth: 2 });
  const titles = sourceSections.map(
    (section, index) =>
      markdownCanonicalHeadingTitle(source, section) ?? `Unavailable source section ${index + 1}`,
  );
  const semanticRoles = titles.map(semanticRoleForTitle);
  const semanticRoleCounts = new Map<string, number>();
  for (const role of semanticRoles) {
    if (role !== undefined) semanticRoleCounts.set(role, (semanticRoleCounts.get(role) ?? 0) + 1);
  }
  const unknownOccurrences = new Map<string, number>();
  const diagnostics: MattSpecDocumentDiagnostic[] = [];
  const sections: DocumentPresentationSection[] = sourceSections.map((section, sourceOrder) => {
    const title = titles[sourceOrder] as string;
    const candidateRole = semanticRoles[sourceOrder];
    const semanticRole =
      candidateRole !== undefined && semanticRoleCounts.get(candidateRole) === 1
        ? candidateRole
        : undefined;
    if (candidateRole !== undefined && semanticRole === undefined) {
      diagnostics.push({
        code: "matt.spec.document-section-ambiguous",
        title,
        message: `Spec semantic role ${candidateRole} is declared more than once.`,
      });
    }
    const occurrence = (unknownOccurrences.get(title) ?? 0) + 1;
    unknownOccurrences.set(title, occurrence);
    const sourceIdentity = semanticRole ?? unknownSourceIdentity(title, occurrence);
    const projected = markdownDocumentPresentationBlocks(source, section);
    if (!projected.ok) {
      diagnostics.push({
        code: "matt.spec.document-section-unsupported",
        title,
        message: `Spec section contains unsupported ${projected.reason} content (${projected.nodeKind}).`,
      });
      return {
        sourceIdentity,
        ...(semanticRole === undefined ? {} : { semanticRole }),
        title,
        sourceOrder,
        availability: "unavailable" as const,
        blocks: [],
      };
    }
    return {
      sourceIdentity,
      ...(semanticRole === undefined ? {} : { semanticRole }),
      title,
      sourceOrder,
      availability: projected.blocks.length === 0 ? "confirmed-empty" : "available",
      blocks: projected.blocks,
    };
  });
  const semanticSections = MATT_SPEC_SECTION_DEFINITIONS.map((definition) => {
    const role = `spec.${definition.role}`;
    const section = sections.find((candidate) => candidate.semanticRole === role);
    return semanticSection(role, section?.availability ?? "unavailable");
  });
  return {
    document: { version: DOCUMENT_PRESENTATION_VERSION, sections },
    semanticSections,
    diagnostics,
  };
};
