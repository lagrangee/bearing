import {
  type MarkdownDocument,
  type MarkdownSection,
  markdownCanonicalHeadingTitle,
  markdownInlineCodeUnorderedList,
  markdownPlainText,
  markdownSectionLead,
  parseMarkdownDocument,
  queryMarkdownSections,
} from "./markdown-document";
import { displaySourceLocatorSchema, planningReferenceSchema } from "./reference-schema";

export type AuditFindingPromotion = Readonly<{ kind: "planning-review"; target: string }>;

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

const canonicalSections = (
  document: MarkdownDocument,
  depth: 1 | 2 | 3 | 4 | 5 | 6,
  within?: MarkdownSection,
): readonly Readonly<{ title: string; section: MarkdownSection }>[] =>
  queryMarkdownSections(document, { depth, ...(within === undefined ? {} : { within }) }).flatMap(
    (section) => {
      const title = markdownCanonicalHeadingTitle(document, section);
      return title === undefined ? [] : [{ title, section }];
    },
  );

const parseList = (
  source: string,
  schema: typeof planningReferenceSchema | typeof displaySourceLocatorSchema,
): readonly string[] | undefined => {
  const entries = markdownInlineCodeUnorderedList(source);
  const parsed = schema.array().min(1).safeParse(entries);
  if (!parsed.success || new Set(parsed.data).size !== parsed.data.length) return undefined;
  return parsed.data;
};

const parsePromotion = (source: string): AuditFindingPromotion | undefined => {
  const content = source.trim();
  if (content.length === 0 || content.includes("\n")) return undefined;
  const review = /^Planning Review: `(planning-review:[a-z0-9]+(?:-[a-z0-9]+)*)`$/u.exec(
    content,
  )?.[1];
  return review === undefined ? undefined : { kind: "planning-review", target: review };
};

const parsePlainParagraph = (source: string): string | undefined => {
  const value = markdownPlainText(source);
  return value === undefined || value.includes("\n\n") ? undefined : value;
};

const parseFinding = (
  document: MarkdownDocument,
  section: MarkdownSection,
  title: string,
  ordinal: number,
): AuditBodyFinding | undefined => {
  const headings = canonicalSections(document, 4, section);
  const expected = [
    "Affected References",
    "Evidence Sources",
    "Consequence",
    "Confidence Boundary",
  ];
  const hasPromotion = headings.length === expected.length + 1;
  if (
    (headings.length !== expected.length && !hasPromotion) ||
    headings
      .slice(0, expected.length)
      .some((heading, index) => heading.title !== expected[index]) ||
    (hasPromotion && headings[4]?.title !== "Promotion")
  ) {
    return undefined;
  }
  const summary = parsePlainParagraph(markdownSectionLead(document, section));
  const affectedReferences = parseList(
    headings[0]?.section.markdown ?? "",
    planningReferenceSchema,
  );
  const evidenceSources = parseList(
    headings[1]?.section.markdown ?? "",
    displaySourceLocatorSchema,
  );
  const consequence = markdownPlainText(headings[2]?.section.markdown ?? "");
  const confidenceBoundary = markdownPlainText(headings[3]?.section.markdown ?? "");
  const promotion = hasPromotion ? parsePromotion(headings[4]?.section.markdown ?? "") : undefined;
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
  const document = parseMarkdownDocument(body);
  const titles = canonicalSections(document, 1);
  const topSections = canonicalSections(document, 2);
  if (
    titles.length !== 1 ||
    titles[0]?.title !== "Planning Audit" ||
    markdownSectionLead(document, titles[0].section).length > 0 ||
    topSections.length !== 1 ||
    topSections[0]?.title !== "Findings"
  ) {
    return { ok: false, reason: "invalid-structure", invalidFindings: [] };
  }
  const findingsSection = topSections[0].section;
  const findingHeadings = canonicalSections(document, 3, findingsSection);
  const lead = markdownPlainText(markdownSectionLead(document, findingsSection));
  if (findingHeadings.length === 0) {
    return lead === "No material findings."
      ? { ok: true, value: { findings: [], invalidFindings: [] } }
      : { ok: false, reason: "invalid-structure", invalidFindings: [] };
  }
  if (markdownSectionLead(document, findingsSection).length > 0) {
    return { ok: false, reason: "invalid-structure", invalidFindings: [] };
  }
  const findings: AuditBodyFinding[] = [];
  const invalidFindings: InvalidAuditFinding[] = [];
  for (const [index, heading] of findingHeadings.entries()) {
    const ordinal = index + 1;
    const finding = parseFinding(document, heading.section, heading.title, ordinal);
    if (finding === undefined) invalidFindings.push({ ordinal, fragment: `finding-${ordinal}` });
    else findings.push(finding);
  }
  if (findings.length === 0) {
    return { ok: false, reason: "all-findings-invalid", invalidFindings };
  }
  return { ok: true, value: { findings, invalidFindings } };
};
