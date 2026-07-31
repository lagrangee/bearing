import type { StructuralDiagnostic } from "./types";

export type BearingNode = Readonly<{ id: string; locator: string }>;
export type RoadmapTopology = Readonly<{
  id: string;
  locator: string;
  lifecycle: "active" | "completed" | "superseded";
  focusedGate: string | null;
  gateOrder: readonly string[];
}>;
export type GateTopology = Readonly<{
  id: string;
  locator: string;
  lifecycle: "planned" | "active" | "passed" | "superseded";
  roadmap: string;
  effortOrder: readonly string[];
}>;
export type EffortTopology = Readonly<{
  id: string;
  locator: string;
  roadmap: string;
  targetGate: string;
}>;
export type CanonicalReference = Readonly<{ source: string; target: string }>;
export type AssetAvailability = Readonly<{ id: string; available: boolean }>;
export type ArtifactAnalysis = Readonly<{
  nodes: readonly BearingNode[];
  references: readonly CanonicalReference[];
  planningCitations: readonly CanonicalReference[];
  authorityBaselines: readonly CanonicalReference[];
  assetAvailability: readonly AssetAvailability[];
  roadmaps: readonly RoadmapTopology[];
  gates: readonly GateTopology[];
  efforts: readonly EffortTopology[];
  diagnostics: readonly StructuralDiagnostic[];
}>;

export const isBearingStableIdReference = (value: string): boolean =>
  /^(?:roadmap|gate|effort|authority|asset|planning-audit|alignment-check|planning-review|next-work-guidance|project-summary):[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(
    value,
  );

export const expectedBearingType = (locator: string): string | undefined => {
  if (locator === ".bearing/state/project-summary.md") return "project-summary";
  if (locator === ".bearing/state/roadmap-index.md") return "roadmap-index";
  if (locator === ".bearing/state/assets.md") return "asset-registry";
  if (/^\.bearing\/state\/efforts\/[^/]+\.md$/u.test(locator)) return "effort";
  if (/^\.scratch\/[^/]+\/effort\.md$/u.test(locator)) return "effort";
  if (locator.startsWith(".bearing/state/roadmaps/")) return "roadmap";
  if (locator.startsWith(".bearing/state/milestone-gates/")) return "milestone-gate";
  if (locator.startsWith(".bearing/state/authorities/")) return "authority";
  if (locator.startsWith(".bearing/state/alignment-checks/")) return "alignment-check";
  if (locator.startsWith(".bearing/state/planning-reviews/")) return "planning-review";
  if (locator === ".bearing/state/planning-audit.md") return "planning-audit";
  if (locator === ".bearing/state/next-work-guidance.md") return "next-work-guidance";
  return undefined;
};

export const isBearingArtifact = (locator: string): boolean =>
  expectedBearingType(locator) !== undefined;
