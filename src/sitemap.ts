import { stringify } from "yaml";
import type { DecodedBearingRecordGeneration } from "./bearing-record-decoder";
import type { PlanningGraph } from "./planning-graph";
import type { MattSkillsV1ProviderObservation } from "./providers/matt-skills-v1/capture";
import type { SitemapNode } from "./sitemap-model";
import { buildProjectSitemapModelFromGeneration, type ProjectSitemapModel } from "./sitemap-model";
import type { AdvisoryFreshness, StructuralDiagnostic } from "./types";

const SECTION_ORDER = [
  "Project Summaries",
  "Project Briefs",
  "Roadmaps",
  "Milestone Gates",
  "Efforts",
  "Authorities",
  "Assets",
  "Alignment Checks",
  "Planning Reviews",
  "Planning Audits",
  "Next Work Guidance",
  "Maps",
  "Specs",
  "Tickets",
] as const;

const clean = (value: string): string => value.replace(/\s+/gu, " ").replaceAll("|", "\\|").trim();

const nodeLine = (node: SitemapNode): string => {
  const relations = node.links.map((link) => `${link.label}: \`${clean(link.target)}\``);
  relations.push(...node.annotations.map(clean));
  return `- \`${clean(node.reference)}\` | ${clean(node.title)} | ${clean(node.state)} | ${relations.length === 0 ? "relations: none" : relations.join("; ")} | source: \`${clean(node.locator)}\``;
};

const serializeProjectSitemap = (
  model: ProjectSitemapModel,
  inputs: readonly string[],
  fingerprint: string,
  advisoryFreshness: AdvisoryFreshness,
): Buffer => {
  const frontmatter = stringify(
    {
      Type: "project-sitemap",
      Version: 1,
      Inputs: [...inputs],
      "Input fingerprint": fingerprint,
      "Advisory freshness": advisoryFreshness,
    },
    { lineWidth: 0 },
  ).trimEnd();
  const sections = SECTION_ORDER.map((section) => {
    const lines = model.nodes.filter((node) => node.type === section).map(nodeLine);
    return `## ${section}\n\n${lines.length === 0 ? "- None." : lines.join("\n")}`;
  });
  const derived = [
    "## Derived Signals",
    "",
    `- Attention: ${model.blocking} blocking diagnostic(s), ${model.openChecks} open alignment check(s), ${model.pendingReviews} pending planning review(s).`,
    ...model.readiness,
  ].join("\n");
  return Buffer.from(
    `---\n${frontmatter}\n---\n\n# Bearing Project Sitemap\n\n${sections.join("\n\n")}\n\n${derived}\n`,
    "utf8",
  );
};

export const buildProjectSitemapFromGeneration = (
  decoded: DecodedBearingRecordGeneration,
  providerObservations: readonly MattSkillsV1ProviderObservation[],
  inputs: readonly string[],
  fingerprint: string,
  diagnostics: readonly StructuralDiagnostic[],
  advisoryFreshness: AdvisoryFreshness,
  planningGraph: PlanningGraph,
): Buffer =>
  serializeProjectSitemap(
    buildProjectSitemapModelFromGeneration(
      decoded,
      providerObservations,
      diagnostics,
      advisoryFreshness,
      planningGraph.planningProjection(),
    ),
    inputs,
    fingerprint,
    advisoryFreshness,
  );
