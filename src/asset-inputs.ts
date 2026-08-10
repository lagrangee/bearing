import type { DecodedBearingRecordGeneration } from "./bearing-record-decoder";
import type { StructuralDiagnostic } from "./types";

type InputFileLister = (
  repoRoot: string,
  directory: string,
  markdownOnly: boolean,
  diagnostics: StructuralDiagnostic[],
) => Promise<string[]>;

export type AssetContentAvailability = "available" | "missing" | "unreadable";
export type AssetContentShape = "file" | "directory" | "unavailable";
export type AssetContentObservation = Readonly<{
  id: string;
  location: string;
  availability: AssetContentAvailability;
  shape: AssetContentShape;
}>;
export type ResolvedAssetInputs = Readonly<{
  inputs: readonly string[];
  observations: readonly AssetContentObservation[];
}>;

const assetRecords = (decoded: DecodedBearingRecordGeneration) => {
  const registry = decoded.records.find((record) => record.type === "asset-registry");
  return registry?.trust !== "invalid" && registry?.content.kind === "asset-registry"
    ? registry.content.assets
    : [];
};

const referencedAssets = (decoded: DecodedBearingRecordGeneration): ReadonlySet<string> =>
  new Set(
    decoded.records.flatMap((record) =>
      record.analysis.references
        .map((reference) => reference.target)
        .filter((target) => target.startsWith("asset:")),
    ),
  );

export const resolveAssetInputs = async (
  _repoRoot: string,
  decoded: DecodedBearingRecordGeneration,
  diagnostics: StructuralDiagnostic[],
  _listFiles: InputFileLister,
): Promise<ResolvedAssetInputs> => {
  const referenced = referencedAssets(decoded);
  const assets = assetRecords(decoded);
  const registered = new Set(assets.map((asset) => asset.ID));
  for (const assetId of referenced) {
    if (registered.has(assetId)) continue;
    diagnostics.push({
      code: "missing-referenced-asset",
      impact: "blocking",
      target: assetId,
      message: "Referenced Asset is absent from the Asset Registry.",
    });
  }
  return { inputs: [], observations: [] };
};
