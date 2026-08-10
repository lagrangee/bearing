import {
  parseMarkdownDocument,
  queryMarkdownDocumentTitle,
  queryMarkdownField,
  queryMarkdownSection,
} from "../markdown-document";

export type MattSkillsV1ContractValidation = Readonly<
  { state: "supported"; driver: "local-markdown" | "github-issues" } | { state: "unsupported" }
>;

const requiredSections = [
  "Conventions",
  'When a skill says "publish to the issue tracker"',
  'When a skill says "fetch the relevant ticket"',
  "Wayfinding operations",
] as const;

const hasRequiredSections = (document: ReturnType<typeof parseMarkdownDocument>): boolean =>
  requiredSections.every((title) => queryMarkdownSection(document, { title }).state === "found");

export const validateMattSkillsV1Contract = (contract: string): MattSkillsV1ContractValidation => {
  const document = parseMarkdownDocument(contract);
  const title = queryMarkdownDocumentTitle(document);
  if (title.state !== "found" || !hasRequiredSections(document)) {
    return { state: "unsupported" };
  }
  if (title.value.title === "Issue tracker: Local Markdown") {
    return { state: "supported", driver: "local-markdown" };
  }
  if (title.value.title === "Issue tracker: GitHub") {
    const pullRequests = queryMarkdownSection(document, {
      title: "Pull requests as a triage surface",
    });
    if (pullRequests.state !== "found") return { state: "unsupported" };
    const requestSurface = queryMarkdownField(document, {
      label: "PRs as a request surface",
      within: pullRequests.value,
    });
    if (
      requestSurface.state !== "found" ||
      !["yes.", "no."].includes(requestSurface.value.value.toLowerCase())
    ) {
      return { state: "unsupported" };
    }
    return { state: "supported", driver: "github-issues" };
  }
  return { state: "unsupported" };
};
