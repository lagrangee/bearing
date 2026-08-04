import {
  type MarkdownSection,
  markdownCanonicalHeadingTitle,
  markdownInlineCodeUnorderedList,
  markdownPlainText,
  markdownSectionLead,
  parseMarkdownDocument,
  queryMarkdownSections,
} from "./markdown-document";
import { planningReferenceSchema } from "./reference-schema";

export type GuidanceBodyItem = Readonly<{
  title: string;
  rationale: string;
  supportingReferences: readonly string[];
}>;

export type NextWorkGuidanceBody = Readonly<{
  primary: GuidanceBodyItem;
  alternatives: readonly GuidanceBodyItem[];
}>;

export type GuidanceBodyResult =
  | Readonly<{ ok: true; value: NextWorkGuidanceBody }>
  | Readonly<{ ok: false; reason: "alternatives-count" | "invalid-structure" }>;

const canonicalSections = (
  document: ReturnType<typeof parseMarkdownDocument>,
  depth: 1 | 2 | 3 | 4 | 5 | 6,
  within?: MarkdownSection,
): readonly Readonly<{ title: string; section: MarkdownSection }>[] =>
  queryMarkdownSections(document, { depth, ...(within === undefined ? {} : { within }) }).flatMap(
    (section) => {
      const title = markdownCanonicalHeadingTitle(document, section);
      return title === undefined ? [] : [{ title, section }];
    },
  );

const parseItem = (
  document: ReturnType<typeof parseMarkdownDocument>,
  title: string,
  section: MarkdownSection,
): GuidanceBodyItem | undefined => {
  const rationale = markdownPlainText(markdownSectionLead(document, section));
  const supporting = canonicalSections(document, 4, section);
  if (
    rationale === undefined ||
    rationale.includes("\n\n") ||
    supporting.length !== 1 ||
    supporting[0]?.title !== "Supporting References"
  ) {
    return undefined;
  }
  const references = markdownInlineCodeUnorderedList(supporting[0].section.markdown);
  const parsed = planningReferenceSchema.array().min(1).safeParse(references);
  if (!parsed.success || new Set(parsed.data).size !== parsed.data.length) return undefined;
  return { title, rationale, supportingReferences: parsed.data };
};

const parseItems = (
  document: ReturnType<typeof parseMarkdownDocument>,
  section: MarkdownSection,
): readonly GuidanceBodyItem[] | undefined => {
  if (markdownSectionLead(document, section).length > 0) return undefined;
  const headings = canonicalSections(document, 3, section);
  if (headings.length === 0) return undefined;
  const items = headings.map(({ title, section: item }) => parseItem(document, title, item));
  return items.some((item) => item === undefined) ? undefined : (items as GuidanceBodyItem[]);
};

export const parseNextWorkGuidanceBody = (body: string): GuidanceBodyResult => {
  const document = parseMarkdownDocument(body);
  const titles = canonicalSections(document, 1);
  const sections = canonicalSections(document, 2);
  if (
    titles.length !== 1 ||
    titles[0]?.title !== "Next Work Guidance" ||
    markdownSectionLead(document, titles[0].section).length > 0 ||
    sections.length !== 2 ||
    sections[0]?.title !== "Primary Recommendation" ||
    sections[1]?.title !== "Alternatives"
  ) {
    return { ok: false, reason: "invalid-structure" };
  }
  const primary = parseItems(document, sections[0].section);
  const alternativesLead = markdownSectionLead(document, sections[1].section);
  const alternatives =
    alternativesLead.length === 0 &&
    queryMarkdownSections(document, { depth: 3, within: sections[1].section }).length === 0
      ? []
      : parseItems(document, sections[1].section);
  if (alternatives !== undefined && alternatives.length > 2) {
    return { ok: false, reason: "alternatives-count" };
  }
  if (primary?.length !== 1 || alternatives === undefined) {
    return { ok: false, reason: "invalid-structure" };
  }
  return { ok: true, value: { primary: primary[0] as GuidanceBodyItem, alternatives } };
};
