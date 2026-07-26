export type MattSkillsV1ContractValidation = Readonly<
  { state: "supported"; driver: "local-markdown" | "github-issues" } | { state: "unsupported" }
>;

const providerMarker = /^Provider contract:\s*`matt-skills\/v1`\s*$/mu;
const localMarkdownContract = /^# Issue tracker:\s*Local Markdown\s*$/mu;
const githubIssuesContract = /^# Issue tracker:\s*GitHub Issues\s*$/mu;

export const validateMattSkillsV1Contract = (contract: string): MattSkillsV1ContractValidation => {
  if (!providerMarker.test(contract)) return { state: "unsupported" };
  if (localMarkdownContract.test(contract)) {
    return { state: "supported", driver: "local-markdown" };
  }
  if (githubIssuesContract.test(contract)) {
    return { state: "supported", driver: "github-issues" };
  }
  return { state: "unsupported" };
};
