import {
  markdownCanonicalHeadingTitle,
  markdownPlainText,
  markdownPlainUnorderedList,
  parseMarkdownDocument,
  queryMarkdownSections,
} from "./markdown-document";

export type ExactSectionsResult =
  | Readonly<{ ok: true; sections: Readonly<Record<string, string>> }>
  | Readonly<{ ok: false; reason: "duplicate" }>
  | Readonly<{ ok: false; reason: "missing"; titles: readonly string[] }>;

export const parseExactSections = (
  body: string,
  required: readonly string[],
): ExactSectionsResult => {
  const document = parseMarkdownDocument(body);
  const headings = queryMarkdownSections(document, { depth: 2 }).flatMap((section) => {
    const title = markdownCanonicalHeadingTitle(document, section);
    return title === undefined ? [] : [{ title, section }];
  });
  const sections: Record<string, string> = {};
  const missing = [...new Set(required)].filter(
    (title) => !headings.some((heading) => heading.title === title),
  );
  if (missing.length > 0) return { ok: false, reason: "missing", titles: missing };
  for (const title of new Set(required)) {
    const matches = headings.filter((heading) => heading.title === title);
    if (matches.length !== 1) return { ok: false, reason: "duplicate" };
    const section = matches[0]?.section;
    if (section === undefined) return { ok: false, reason: "missing", titles: [title] };
    sections[title] = section.markdown;
  }
  return { ok: true, sections };
};

export const parsePlainText = (section: string): string | undefined => markdownPlainText(section);

export const parseUnorderedList = (section: string): readonly string[] | undefined => {
  const items = markdownPlainUnorderedList(section);
  return items === undefined || new Set(items).size !== items.length ? undefined : items;
};
