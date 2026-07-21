import { stat } from "node:fs/promises";
import type { DecodedBearingRecordGeneration } from "./bearing-record-decoder";
import { normalizeLocator } from "./fingerprint";
import { probeContainedInput } from "./input-boundary";
import type { StructuralDiagnostic } from "./types";

type InputFileLister = (
  repoRoot: string,
  directory: string,
  markdownOnly: boolean,
  diagnostics: StructuralDiagnostic[],
) => Promise<string[]>;

export type AssetContentAvailability = "available" | "missing" | "unreadable";
export type AssetContentObservation = Readonly<{
  id: string;
  location: string;
  availability: AssetContentAvailability;
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

const diagnostic = (
  diagnostics: StructuralDiagnostic[],
  referenced: boolean,
  value: StructuralDiagnostic,
): void => {
  if (referenced) diagnostics.push(value);
};

export const resolveAssetInputs = async (
  repoRoot: string,
  decoded: DecodedBearingRecordGeneration,
  diagnostics: StructuralDiagnostic[],
  listFiles: InputFileLister,
): Promise<ResolvedAssetInputs> => {
  const inputs = new Set<string>();
  const observations: AssetContentObservation[] = [];
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
  for (const asset of assets) {
    const isReferenced = referenced.has(asset.ID);
    const observe = (availability: AssetContentAvailability): void => {
      observations.push({ id: asset.ID, location: asset.Location, availability });
    };
    if (/^[a-z][a-z0-9+.-]*:/iu.test(asset.Location)) {
      observe("unreadable");
      diagnostic(diagnostics, isReferenced, {
        code: "external-asset-input",
        impact: "blocking",
        target: asset.ID,
        message: "Referenced Asset is external and cannot enter a repository-local fingerprint.",
      });
      continue;
    }
    let locator: string;
    try {
      locator = normalizeLocator(asset.Location);
    } catch {
      observe("unreadable");
      diagnostic(diagnostics, isReferenced, {
        code: "invalid-asset-location",
        impact: "blocking",
        target: asset.ID,
        message: "Referenced Asset Location is not repository-relative.",
      });
      continue;
    }
    const probe = await probeContainedInput(repoRoot, locator);
    if (probe.status === "missing") {
      observe("missing");
      diagnostic(diagnostics, isReferenced, {
        code: "missing-asset-input",
        impact: "blocking",
        target: asset.ID,
        message: "Referenced Asset Location is unavailable.",
      });
      continue;
    }
    if (probe.status === "blocked") {
      observe("unreadable");
      diagnostic(diagnostics, isReferenced, probe.diagnostic);
      continue;
    }
    const metadata = await stat(probe.path);
    if (metadata.isDirectory()) {
      observe("available");
      if (isReferenced) {
        for (const file of await listFiles(repoRoot, locator, false, diagnostics)) inputs.add(file);
      }
    } else if (metadata.isFile()) {
      observe("available");
      if (isReferenced) inputs.add(locator);
    } else {
      observe("unreadable");
      diagnostic(diagnostics, isReferenced, {
        code: "unsupported-input-shape",
        impact: "blocking",
        target: locator,
        message: "Repository input has an unsupported filesystem shape.",
      });
    }
  }
  return { inputs: [...inputs], observations };
};
