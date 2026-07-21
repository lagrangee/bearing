import type { DecodedBearingRecordGeneration } from "./bearing-record-decoder";
import type { PlanningGraphProjection } from "./planning-graph";
import type { Effort } from "./project-snapshot/contract";
import type { SitemapNode } from "./sitemap-model";

export const enrichSitemapNodes = (
  nodes: SitemapNode[],
  decoded: DecodedBearingRecordGeneration,
  planning: PlanningGraphProjection,
): string[] => {
  if (planning.efforts.validity !== "invalid") {
    const efforts = new Map<string, Effort>(
      planning.efforts.items.map((effort) => [effort.id, effort]),
    );
    for (const node of nodes.filter((candidate) => candidate.type === "Efforts")) {
      const effort = efforts.get(node.reference);
      if (effort !== undefined) node.state = effort.derivedState;
    }
  }
  const citationCounts = new Map<string, number>();
  for (const record of decoded.records) {
    for (const citation of record.analysis.planningCitations)
      citationCounts.set(citation.target, (citationCounts.get(citation.target) ?? 0) + 1);
  }
  for (const asset of nodes.filter((node) => node.type === "Assets"))
    asset.annotations.push(`citation-count=${citationCounts.get(asset.reference) ?? 0}`);

  if (planning.gates.validity === "invalid") return [];
  return planning.gates.items
    .filter((gate) => gate.lifecycle === "planned" || gate.lifecycle === "active")
    .map((gate) => `- Gate readiness: \`${gate.id}\` = ${gate.readiness}`);
};
