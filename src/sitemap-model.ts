import type {
  BearingRecordType,
  DecodedBearingRecord,
  DecodedBearingRecordGeneration,
} from "./bearing-record-decoder";
import type { PlanningGraphProjection } from "./planning-graph";
import type { MattSkillsV1ScopeCapture } from "./providers/matt-skills-v1/capture";
import {
  mattObjectLocator,
  mattObjectState,
  mattObjects,
} from "./providers/matt-skills-v1/projection";
import { enrichSitemapNodes } from "./sitemap-enrichment";
import type { AdvisoryFreshness, StructuralDiagnostic } from "./types";

export type SitemapLink = Readonly<{ label: string; target: string }>;
export type SitemapNode = {
  type: string;
  reference: string;
  title: string;
  state: string;
  locator: string;
  scope?: string;
  links: SitemapLink[];
  annotations: string[];
};
export type ProjectSitemapModel = Readonly<{
  nodes: readonly SitemapNode[];
  readiness: readonly string[];
  blocking: number;
  openChecks: number;
  pendingReviews: number;
}>;

const SECTION_BY_TYPE: Readonly<Record<BearingRecordType, string | undefined>> = {
  "project-summary": "Project Summaries",
  "roadmap-index": undefined,
  roadmap: "Roadmaps",
  "milestone-gate": "Milestone Gates",
  effort: "Efforts",
  authority: "Authorities",
  "asset-registry": "Assets",
  "alignment-check": "Alignment Checks",
  "planning-review": "Planning Reviews",
  "planning-audit": "Planning Audits",
  "next-work-guidance": "Next Work Guidance",
};

const DEFAULT_TITLE: Readonly<Record<BearingRecordType, string>> = {
  "project-summary": "Invalid Project Summary",
  "roadmap-index": "Invalid Roadmap Index",
  roadmap: "Invalid Roadmap",
  "milestone-gate": "Invalid Milestone Gate",
  effort: "Invalid Effort",
  authority: "Invalid Authority",
  "asset-registry": "Invalid Asset Registry",
  "alignment-check": "Invalid Alignment Check",
  "planning-review": "Invalid Planning Review",
  "planning-audit": "Invalid Planning Audit",
  "next-work-guidance": "Invalid Next Work Guidance",
};

const invalidNode = (
  record: Pick<DecodedBearingRecord, "displayTitle" | "locator" | "type">,
  section: string,
  title = record.displayTitle,
  suffix = "",
): SitemapNode => ({
  type: section,
  reference: `invalid:${record.locator}${suffix}`,
  title,
  state: "invalid",
  locator: record.locator,
  links: [],
  annotations: [],
});

const assetNodes = (record: DecodedBearingRecord): SitemapNode[] | undefined => {
  if (record.trust === "invalid" || record.content.kind !== "asset-registry") return undefined;
  const valid = record.content.assets.map(
    (asset): SitemapNode => ({
      type: "Assets",
      reference: asset.ID,
      title: asset.Title,
      state: asset.Disposition ?? asset["Lifecycle source"],
      locator: record.locator,
      links: [{ label: "owner", target: asset.Owner }],
      annotations: [`location=${asset.Location}`],
    }),
  );
  const invalid = record.content.invalidEntries.map((entry) =>
    invalidNode(record, "Assets", entry.title, `#${entry.key}`),
  );
  return [...valid, ...invalid];
};

const bearingNodes = (
  record: DecodedBearingRecord,
  advisoryFreshness: AdvisoryFreshness,
): SitemapNode[] => {
  if (record.type === "asset-registry")
    return assetNodes(record) ?? [invalidNode(record, "Assets")];
  const section = SECTION_BY_TYPE[record.type];
  if (section === undefined) return [];
  if (record.trust === "invalid" || record.data === undefined) {
    return [invalidNode(record, section)];
  }
  const data = record.data;
  const title =
    "Title" in data && typeof data.Title === "string" ? data.Title : DEFAULT_TITLE[record.type];
  const state = "Status" in data && typeof data.Status === "string" ? data.Status : "current";
  const base = (reference: string): SitemapNode => ({
    type: section,
    reference,
    title,
    state,
    locator: record.locator,
    links: [],
    annotations: [],
  });
  switch (data.Type) {
    case "project-summary":
      return [base(data.ID)];
    case "roadmap": {
      const node = base(data.ID);
      if (data["Focused gate"] !== null)
        node.links.push({ label: "focused-gate", target: data["Focused gate"] });
      for (const gate of data["Gate order"]) node.links.push({ label: "gate", target: gate });
      return [node];
    }
    case "milestone-gate": {
      const node = base(data.ID);
      node.links.push({ label: "roadmap", target: data.Roadmap });
      return [node];
    }
    case "effort": {
      const node = base(data.ID);
      node.state = "unknown";
      node.links.push(
        { label: "roadmap", target: data.Roadmap },
        { label: "target-gate", target: data["Target gate"] },
        ...data.Authorities.map((target) => ({ label: "authority", target })),
      );
      return [node];
    }
    case "authority": {
      const node = base(data.ID);
      for (const asset of data.Baseline) node.links.push({ label: "baseline", target: asset });
      return [node];
    }
    case "alignment-check": {
      const node = base(data.ID);
      node.links.push({ label: "target", target: data.Target });
      return [node];
    }
    case "planning-review": {
      const node = base(data.ID);
      node.annotations.push(`scope=${data.Scope}`);
      return [node];
    }
    case "planning-audit": {
      const node = base(data.ID);
      node.state = advisoryFreshness[data.ID] ?? "unknown";
      return [node];
    }
    case "next-work-guidance": {
      const node = base(data.ID);
      node.state = advisoryFreshness[data.ID] ?? "unknown";
      return [node];
    }
    case "roadmap-index":
    case "asset-registry":
      return [];
  }
};

export const buildProjectSitemapModelFromGeneration = (
  decoded: DecodedBearingRecordGeneration,
  providerCaptures: readonly MattSkillsV1ScopeCapture[],
  diagnostics: readonly StructuralDiagnostic[],
  advisoryFreshness: AdvisoryFreshness,
  planning: PlanningGraphProjection,
): ProjectSitemapModel => {
  const nodes = decoded.records.flatMap((record) => bearingNodes(record, advisoryFreshness));
  const effortByBinding = new Map(
    (planning.efforts.validity === "invalid" ? [] : planning.efforts.items).flatMap((effort) =>
      effort.workBinding === undefined
        ? []
        : [
            [
              `${effort.workBinding.provider}\0${effort.workBinding.nativeScope}`,
              effort.id,
            ] as const,
          ],
    ),
  );
  for (const capture of providerCaptures) {
    const effortId = effortByBinding.get(`${capture.provider}\0${capture.binding.nativeScope}`);
    for (const object of mattObjects(capture)) {
      const links: SitemapLink[] =
        effortId === undefined ? [] : [{ label: "effort", target: effortId }];
      if (capture.state === "available" || capture.state === "partial") {
        for (const relation of capture.projection.graph.blockedBy) {
          if (relation.blocked === object.ref) {
            links.push({ label: "blocked-by", target: relation.blocker });
          }
        }
      }
      nodes.push({
        type: object.kind === "map" ? "Maps" : object.kind === "spec" ? "Specs" : "Tickets",
        reference: object.ref,
        title: object.title,
        state: mattObjectState(object),
        locator: mattObjectLocator(object),
        scope: capture.binding.nativeScope,
        links,
        annotations:
          object.kind === "map"
            ? [`fog-count=${object.fog.length}`, `provider-completion=${capture.completion}`]
            : [`role=${object.kind}`],
      });
    }
  }
  const readiness = enrichSitemapNodes(nodes, decoded, planning);
  nodes.sort((left, right) =>
    Buffer.compare(Buffer.from(left.reference), Buffer.from(right.reference)),
  );
  return {
    nodes,
    readiness,
    blocking: diagnostics.filter((diagnostic) => diagnostic.impact === "blocking").length,
    openChecks: nodes.filter((node) => node.type === "Alignment Checks" && node.state === "open")
      .length,
    pendingReviews: nodes.filter(
      (node) => node.type === "Planning Reviews" && node.state === "pending",
    ).length,
  };
};
