import {
  type MarkdownDocument,
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

export const mattGitHubRequestSurface = (document: MarkdownDocument): "yes" | "no" | undefined => {
  const section = queryMarkdownSection(document, { title: "Pull requests as a triage surface" });
  if (section.state !== "found") return undefined;
  // The upstream setup seed appends this exact explanatory note to its bold field.
  const annotation =
    " _(Set to `yes` if this repo treats external PRs as feature requests; `/triage` reads this flag.)_";
  let source = section.value.markdown;
  for (const value of ["yes", "no"]) {
    const field = `**PRs as a request surface: ${value}.**`;
    source = source.replaceAll(`${field}${annotation}`, field);
  }
  const field = queryMarkdownField(parseMarkdownDocument(source), {
    label: "PRs as a request surface",
  });
  if (field.state !== "found") return undefined;
  const value = field.value.value.toLowerCase();
  return value === "yes." ? "yes" : value === "no." ? "no" : undefined;
};

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
    if (mattGitHubRequestSurface(document) === undefined) {
      return { state: "unsupported" };
    }
    return { state: "supported", driver: "github-issues" };
  }
  return { state: "unsupported" };
};
