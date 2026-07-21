import { isPlainText } from "./plain-text";
import { planningReferenceSchema } from "./reference-schema";

export type GuidanceBodyItem = Readonly<{
  title: string;
  rationale: string;
  supportingReferences: readonly string[];
}>;

export type NextWorkGuidanceBody = Readonly<{
  primary: GuidanceBodyItem;
  alternatives: readonly [GuidanceBodyItem, GuidanceBodyItem];
}>;

export type GuidanceBodyResult =
  | Readonly<{ ok: true; value: NextWorkGuidanceBody }>
  | Readonly<{ ok: false; reason: "alternatives-count" | "invalid-structure" }>;

type Heading = Readonly<{ title: string; line: number }>;

const headingsAt = (lines: readonly string[], level: number): Heading[] => {
  const marker = "#".repeat(level);
  const pattern = new RegExp(`^${marker} ([^#\\s].*)$`, "u");
  return lines.flatMap((line, index) => {
    const match = pattern.exec(line);
    const title = match?.[1]?.trim();
    return title === undefined || title.length === 0 ? [] : [{ title, line: index }];
  });
};

const trimBlankLines = (lines: readonly string[]): readonly string[] => {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start]?.trim().length === 0) start += 1;
  while (end > start && lines[end - 1]?.trim().length === 0) end -= 1;
  return lines.slice(start, end);
};

const prose = (lines: readonly string[]): string | undefined => {
  const trimmed = trimBlankLines(lines);
  if (trimmed.length === 0 || !isPlainText(trimmed.join("\n"))) return undefined;
  const paragraphs: string[] = [];
  let current: string[] = [];
  const flush = (): void => {
    if (current.length === 0) return;
    paragraphs.push(current.map((line) => line.trim()).join(" "));
    current = [];
  };
  for (const line of trimmed) {
    if (line.trim().length === 0) flush();
    else current.push(line);
  }
  flush();
  const normalized = paragraphs.join("\n\n");
  return normalized.length === 0 || !isPlainText(normalized) ? undefined : normalized;
};

const parseItem = (title: string, lines: readonly string[]): GuidanceBodyItem | undefined => {
  if (!isPlainText(title)) return undefined;
  const supporting = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => line === "#### Supporting References");
  if (supporting.length !== 1) return undefined;
  const supportingIndex = supporting[0]?.index;
  if (supportingIndex === undefined) return undefined;
  const rationale = prose(lines.slice(0, supportingIndex));
  if (rationale === undefined) return undefined;
  const referenceLines = trimBlankLines(lines.slice(supportingIndex + 1)).filter(
    (line) => line.trim().length > 0,
  );
  const references = referenceLines.map((line) => /^- `([^`]+)`$/u.exec(line)?.[1]);
  const parsedReferences = planningReferenceSchema.array().min(1).safeParse(references);
  if (!parsedReferences.success || new Set(references).size !== references.length) {
    return undefined;
  }
  return {
    title,
    rationale,
    supportingReferences: parsedReferences.data,
  };
};

const parseItems = (
  lines: readonly string[],
  sectionStart: number,
  sectionEnd: number,
): readonly GuidanceBodyItem[] | undefined => {
  const section = lines.slice(sectionStart, sectionEnd);
  const headings = headingsAt(section, 3);
  if (headings.length === 0) return undefined;
  const items: GuidanceBodyItem[] = [];
  for (const [index, heading] of headings.entries()) {
    const end = headings[index + 1]?.line ?? section.length;
    const item = parseItem(heading.title, section.slice(heading.line + 1, end));
    if (item === undefined) return undefined;
    items.push(item);
  }
  return items;
};

export const parseNextWorkGuidanceBody = (body: string): GuidanceBodyResult => {
  const lines = body.replaceAll("\r\n", "\n").replaceAll("\r", "\n").split("\n");
  const sections = headingsAt(lines, 2);
  if (
    sections.length !== 2 ||
    sections[0]?.title !== "Primary Recommendation" ||
    sections[1]?.title !== "Alternatives"
  ) {
    return { ok: false, reason: "invalid-structure" };
  }
  const primarySection = sections[0];
  const alternativesSection = sections[1];
  if (primarySection === undefined || alternativesSection === undefined) {
    return { ok: false, reason: "invalid-structure" };
  }
  const primary = parseItems(lines, primarySection.line + 1, alternativesSection.line);
  const alternatives = parseItems(lines, alternativesSection.line + 1, lines.length);
  if (alternatives !== undefined && alternatives.length !== 2) {
    return { ok: false, reason: "alternatives-count" };
  }
  if (primary?.length !== 1 || alternatives?.length !== 2) {
    return { ok: false, reason: "invalid-structure" };
  }
  const first = alternatives[0];
  const second = alternatives[1];
  if (first === undefined || second === undefined) {
    return { ok: false, reason: "invalid-structure" };
  }
  return {
    ok: true,
    value: { primary: primary[0] as GuidanceBodyItem, alternatives: [first, second] },
  };
};
