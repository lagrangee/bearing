import { isPlainText } from "./plain-text";

export type ExactSectionsResult =
  | Readonly<{ ok: true; sections: Readonly<Record<string, string>> }>
  | Readonly<{ ok: false; reason: "duplicate" }>
  | Readonly<{ ok: false; reason: "missing"; titles: readonly string[] }>;

type SectionHeading = Readonly<{ title: string; line: number }>;

const trimBlankLines = (lines: readonly string[]): readonly string[] => {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start]?.trim().length === 0) start += 1;
  while (end > start && lines[end - 1]?.trim().length === 0) end -= 1;
  return lines.slice(start, end);
};

const h2Headings = (lines: readonly string[]): readonly SectionHeading[] =>
  lines.flatMap((line, index) => {
    const title = /^## ([^#\s].*)$/u.exec(line)?.[1]?.trim();
    return title === undefined || title.length === 0 ? [] : [{ title, line: index }];
  });

export const parseExactSections = (
  body: string,
  required: readonly string[],
): ExactSectionsResult => {
  const lines = body.replaceAll("\r\n", "\n").replaceAll("\r", "\n").split("\n");
  const headings = h2Headings(lines);
  const sections: Record<string, string> = {};
  const missing = [...new Set(required)].filter(
    (title) => !headings.some((heading) => heading.title === title),
  );
  if (missing.length > 0) return { ok: false, reason: "missing", titles: missing };
  for (const title of new Set(required)) {
    const matches = headings.filter((heading) => heading.title === title);
    if (matches.length !== 1) return { ok: false, reason: "duplicate" };
    const heading = matches[0];
    if (heading === undefined) return { ok: false, reason: "missing", titles: [title] };
    const next = headings.find((candidate) => candidate.line > heading.line);
    sections[title] = trimBlankLines(
      lines.slice(heading.line + 1, next?.line ?? lines.length),
    ).join("\n");
  }
  return { ok: true, sections };
};

export const parsePlainText = (section: string): string | undefined => {
  const lines = trimBlankLines(section.replaceAll("\r\n", "\n").replaceAll("\r", "\n").split("\n"));
  if (lines.length === 0 || !isPlainText(lines.join("\n"))) {
    return undefined;
  }
  const paragraphs: string[] = [];
  let paragraph: string[] = [];
  const flush = (): void => {
    if (paragraph.length === 0) return;
    paragraphs.push(paragraph.map((line) => line.trim()).join(" "));
    paragraph = [];
  };
  for (const line of lines) {
    if (line.trim().length === 0) flush();
    else paragraph.push(line);
  }
  flush();
  const normalized = paragraphs.join("\n\n");
  return normalized.length === 0 || !isPlainText(normalized) ? undefined : normalized;
};

export const parseUnorderedList = (section: string): readonly string[] | undefined => {
  const lines = trimBlankLines(
    section.replaceAll("\r\n", "\n").replaceAll("\r", "\n").split("\n"),
  ).filter((line) => line.trim().length > 0);
  if (lines.length === 0) return [];
  const items = lines.map((line) => /^- (\S(?:.*\S)?)$/u.exec(line)?.[1]);
  if (
    items.some((item) => item === undefined || !isPlainText(item)) ||
    new Set(items).size !== items.length
  ) {
    return undefined;
  }
  return items as string[];
};
