import { isPlainText } from "./plain-text";
import { displaySourceLocatorSchema, planningReferenceSchema } from "./reference-schema";

export type AuditFindingPromotion =
  | Readonly<{ kind: "alignment-check"; target: string }>
  | Readonly<{ kind: "planning-review"; target: string }>;

export type AuditBodyFinding = Readonly<{
  ordinal: number;
  fragment: `finding-${number}`;
  title: string;
  summary: string;
  affectedReferences: readonly string[];
  evidenceSources: readonly string[];
  consequence: string;
  confidenceBoundary: string;
  promotion?: AuditFindingPromotion;
}>;

export type InvalidAuditFinding = Readonly<{
  ordinal: number;
  fragment: `finding-${number}`;
}>;

export type PlanningAuditBodyResult =
  | Readonly<{
      ok: true;
      value: Readonly<{
        findings: readonly AuditBodyFinding[];
        invalidFindings: readonly InvalidAuditFinding[];
      }>;
    }>
  | Readonly<{
      ok: false;
      reason: "invalid-structure" | "all-findings-invalid";
      invalidFindings: readonly InvalidAuditFinding[];
    }>;

const trimBlankLines = (lines: readonly string[]): readonly string[] => {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start]?.trim().length === 0) start += 1;
  while (end > start && lines[end - 1]?.trim().length === 0) end -= 1;
  return lines.slice(start, end);
};

const parseProse = (lines: readonly string[]): string | undefined => {
  const trimmed = trimBlankLines(lines);
  if (
    trimmed.length === 0 ||
    trimmed.some((line) => /^(?:severity|priority|risk):(?:\s|$)/iu.test(line.trim())) ||
    !isPlainText(trimmed.join("\n"))
  ) {
    return undefined;
  }
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
  return normalized.length > 0 && isPlainText(normalized) ? normalized : undefined;
};

const parseList = (
  lines: readonly string[],
  schema: typeof planningReferenceSchema | typeof displaySourceLocatorSchema,
): readonly string[] | undefined => {
  const entries = trimBlankLines(lines)
    .filter((line) => line.trim().length > 0)
    .map((line) => /^- `([^`]+)`$/u.exec(line)?.[1]);
  if (entries.some((entry) => entry === undefined)) return undefined;
  const parsed = schema.array().min(1).safeParse(entries);
  if (!parsed.success || new Set(parsed.data).size !== parsed.data.length) return undefined;
  return parsed.data;
};

const parsePromotion = (lines: readonly string[]): AuditFindingPromotion | undefined => {
  const content = trimBlankLines(lines);
  if (content.length !== 1) return undefined;
  const line = content[0] ?? "";
  const check = /^Alignment Check: `(alignment-check:[a-z0-9]+(?:-[a-z0-9]+)*)`$/u.exec(line)?.[1];
  if (check !== undefined) return { kind: "alignment-check", target: check };
  const review = /^Planning Review: `(planning-review:[a-z0-9]+(?:-[a-z0-9]+)*)`$/u.exec(line)?.[1];
  return review === undefined ? undefined : { kind: "planning-review", target: review };
};

const parseFinding = (lines: readonly string[], ordinal: number): AuditBodyFinding | undefined => {
  const fragmentLines = trimBlankLines(lines);
  const title = /^### ([^#\s].*)$/u.exec(fragmentLines[0] ?? "")?.[1];
  if (title === undefined || !isPlainText(title)) return undefined;
  const headings = fragmentLines.flatMap((line, index) =>
    /^####(?:\s|$)/u.test(line) ? [{ title: line, index }] : [],
  );
  const expected = [
    "#### Affected References",
    "#### Evidence Sources",
    "#### Consequence",
    "#### Confidence Boundary",
  ];
  const hasPromotion = headings.length === expected.length + 1;
  if (headings.length !== expected.length && !hasPromotion) return undefined;
  if (
    headings.slice(0, expected.length).some((heading, index) => heading.title !== expected[index])
  ) {
    return undefined;
  }
  if (hasPromotion && headings[4]?.title !== "#### Promotion") return undefined;
  const at = (index: number): readonly string[] => {
    const start = headings[index]?.index;
    if (start === undefined) return [];
    return fragmentLines.slice(start + 1, headings[index + 1]?.index ?? fragmentLines.length);
  };
  const summary = parseProse(fragmentLines.slice(1, headings[0]?.index));
  const affectedReferences = parseList(at(0), planningReferenceSchema);
  const evidenceSources = parseList(at(1), displaySourceLocatorSchema);
  const consequence = parseProse(at(2));
  const confidenceBoundary = parseProse(at(3));
  const promotion = hasPromotion ? parsePromotion(at(4)) : undefined;
  if (
    summary === undefined ||
    affectedReferences === undefined ||
    evidenceSources === undefined ||
    consequence === undefined ||
    confidenceBoundary === undefined ||
    (hasPromotion && promotion === undefined)
  ) {
    return undefined;
  }
  return {
    ordinal,
    fragment: `finding-${ordinal}`,
    title,
    summary,
    affectedReferences,
    evidenceSources,
    consequence,
    confidenceBoundary,
    ...(promotion === undefined ? {} : { promotion }),
  };
};

export const parsePlanningAuditBody = (body: string): PlanningAuditBodyResult => {
  const lines = trimBlankLines(body.replaceAll("\r\n", "\n").replaceAll("\r", "\n").split("\n"));
  const topHeadings = lines.flatMap((line, index) =>
    /^#{1,2}(?:\s|$)/u.test(line) ? [{ title: line, index }] : [],
  );
  if (
    topHeadings.length !== 2 ||
    topHeadings[0]?.title !== "# Planning Audit" ||
    topHeadings[0].index !== 0 ||
    topHeadings[1]?.title !== "## Findings" ||
    trimBlankLines(lines.slice(1, topHeadings[1].index)).length !== 0
  ) {
    return { ok: false, reason: "invalid-structure", invalidFindings: [] };
  }
  const content = trimBlankLines(lines.slice(topHeadings[1].index + 1));
  if (content.length === 1 && content[0] === "No material findings.") {
    return { ok: true, value: { findings: [], invalidFindings: [] } };
  }
  const starts = content.flatMap((line, index) => (/^###(?:\s|$)/u.test(line) ? [index] : []));
  if (starts.length === 0 || starts[0] !== 0 || content.includes("No material findings.")) {
    return { ok: false, reason: "invalid-structure", invalidFindings: [] };
  }
  const findings: AuditBodyFinding[] = [];
  const invalidFindings: InvalidAuditFinding[] = [];
  for (const [index, start] of starts.entries()) {
    const fragmentLines = content.slice(start, starts[index + 1] ?? content.length);
    const finding = parseFinding(fragmentLines, index + 1);
    if (finding === undefined) {
      invalidFindings.push({
        ordinal: index + 1,
        fragment: `finding-${index + 1}`,
      });
    } else findings.push(finding);
  }
  if (findings.length === 0) {
    return { ok: false, reason: "all-findings-invalid", invalidFindings };
  }
  return { ok: true, value: { findings, invalidFindings } };
};
