import {
  parseMarkdownDocument,
  queryMarkdownInlineCodes,
  queryMarkdownLinks,
  queryMarkdownSection,
} from "./markdown-document";
import { displaySourceLocatorSchema } from "./reference-schema";

export const pointsToMattContractLocator = (source: string, locator: string): boolean => {
  const document = parseMarkdownDocument(source);
  const agentSkills = queryMarkdownSection(document, {
    title: "Agent skills",
    depth: 2,
  });
  if (agentSkills.state !== "found") return false;

  const issueTracker = queryMarkdownSection(document, {
    title: "Issue tracker",
    depth: 3,
    within: agentSkills.value,
  });
  if (issueTracker.state !== "found") return false;

  const declaredLocators = [
    ...queryMarkdownInlineCodes(document, { within: issueTracker.value }),
    ...queryMarkdownLinks(document, { within: issueTracker.value }).map((link) => link.target),
  ].filter((candidate) => displaySourceLocatorSchema.safeParse(candidate).success);
  return [...new Set(declaredLocators)].includes(locator);
};
