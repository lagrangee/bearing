import {
  type ArtifactAnalysis,
  type CanonicalReference,
  isBearingStableIdReference,
} from "./artifact-model";
import type { AssetRegistryParse } from "./asset-records";
import type { StructuralDiagnostic } from "./types";

const stableReference = (source: string, target: string): CanonicalReference[] =>
  isBearingStableIdReference(target) ? [{ source, target }] : [];

const supersessionCycleDiagnostics = (
  replacements: ReadonlyMap<string, string>,
): StructuralDiagnostic[] => {
  const visited = new Set<string>();
  const diagnostics: StructuralDiagnostic[] = [];
  for (const start of [...replacements.keys()].sort()) {
    if (visited.has(start)) continue;
    const path: string[] = [];
    const positions = new Map<string, number>();
    let current = start;
    while (!visited.has(current) && !positions.has(current)) {
      const next = replacements.get(current);
      if (next === undefined) break;
      positions.set(current, path.length);
      path.push(current);
      current = next;
    }
    const cycleStart = positions.get(current);
    const cycle = cycleStart === undefined ? [] : path.slice(cycleStart);
    if (cycle.length > 1) {
      const target = [...cycle].sort().at(0);
      if (target === undefined) continue;
      diagnostics.push({
        code: "asset-supersession-cycle",
        impact: "blocking",
        target,
        message: "Asset supersession cannot form a cycle.",
      });
    }
    for (const assetId of path) visited.add(assetId);
  }
  return diagnostics;
};

export const analyzeParsedAssetRegistry = (
  locator: string,
  registry: AssetRegistryParse,
): ArtifactAnalysis => {
  if (!registry.ok) {
    return {
      nodes: [],
      references: [],
      planningCitations: [],
      authorityBaselines: [],
      assetAvailability: [],
      roadmaps: [],
      gates: [],
      efforts: [],
      diagnostics: [
        {
          code: "invalid-bearing-schema",
          impact: "blocking",
          target: locator,
          message: "Bearing frontmatter does not match its minimum schema.",
        },
      ],
    };
  }
  const nodes: { id: string; locator: string }[] = [];
  const references: CanonicalReference[] = [];
  const assetAvailability: { id: string; available: boolean }[] = [];
  const diagnostics: StructuralDiagnostic[] = [];
  const replacements = new Map<string, string>();
  for (const entry of registry.entries) {
    const asset = entry.data;
    if (asset === undefined) {
      diagnostics.push({
        code: "invalid-asset-schema",
        impact: "blocking",
        target: `${locator}#${entry.key}`,
        message: "Asset entry does not match its package-owned schema.",
      });
      continue;
    }
    nodes.push({ id: asset.ID, locator });
    assetAvailability.push({
      id: asset.ID,
      available: asset["Lifecycle source"] === "native" || asset.Disposition === "available",
    });
    references.push(...stableReference(locator, asset.Owner));
    if (asset["Produced for"] !== undefined) {
      references.push(...stableReference(asset.ID, asset["Produced for"]));
    }
    if (asset["Lifecycle source"] === "registry" && asset.Disposition === undefined) {
      diagnostics.push({
        code: "registry-asset-missing-disposition",
        impact: "blocking",
        target: asset.ID,
        message: "Registry-managed Asset requires Disposition.",
      });
    }
    if (asset["Lifecycle source"] === "native" && asset.Disposition !== undefined) {
      diagnostics.push({
        code: "native-asset-has-registry-disposition",
        impact: "blocking",
        target: asset.ID,
        message: "Native Asset lifecycle cannot be overridden by registry Disposition.",
      });
    }
    if (asset.Disposition === "superseded" && asset["Superseded by"] === undefined) {
      diagnostics.push({
        code: "superseded-asset-missing-replacement",
        impact: "blocking",
        target: asset.ID,
        message: "Superseded Asset requires Superseded by.",
      });
    }
    if (asset.Disposition !== "superseded" && asset["Superseded by"] !== undefined) {
      diagnostics.push({
        code: "asset-replacement-without-superseded-disposition",
        impact: "blocking",
        target: asset.ID,
        message: "Only a superseded Asset can name a replacement.",
      });
    }
    if (asset["Superseded by"] === asset.ID) {
      diagnostics.push({
        code: "self-superseding-asset",
        impact: "blocking",
        target: asset.ID,
        message: "An Asset cannot supersede itself.",
      });
    }
    if (asset["Superseded by"] !== undefined) {
      references.push({ source: asset.ID, target: asset["Superseded by"] });
      replacements.set(asset.ID, asset["Superseded by"]);
    }
  }
  diagnostics.push(...supersessionCycleDiagnostics(replacements));
  return {
    nodes,
    references,
    planningCitations: [],
    authorityBaselines: [],
    assetAvailability,
    roadmaps: [],
    gates: [],
    efforts: [],
    diagnostics,
  };
};
