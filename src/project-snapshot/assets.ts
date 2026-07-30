import type { AssetContentObservation } from "../asset-inputs";
import {
  projectExpectedSourceEventTime,
  projectOptionalSourceEventTime,
} from "../source-event-time";
import type {
  AssetProjection,
  CollectionProjection,
  ProjectionIssue,
  SourceRecord,
} from "./contract";
import { isolateDuplicateIdentities } from "./projection-identity";
import type { SnapshotSourceInput } from "./projection-input";
import { assetProjectionSchema } from "./schema";
import { createSourceRecord } from "./source-records";

type Input = Readonly<{
  records: readonly SnapshotSourceInput[];
  sitemapFingerprint: string;
  contentObservations: readonly AssetContentObservation[];
}>;
type Result = Readonly<{ item?: AssetProjection; issue?: ProjectionIssue; source: SourceRecord }>;

const compareUtf8 = (left: string, right: string): number =>
  Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
const contentAvailability = (
  observations: readonly AssetContentObservation[],
  id: string,
  location: string,
): "available" | "missing" | "unreadable" =>
  observations.find((observation) => observation.id === id && observation.location === location)
    ?.availability ?? "unreadable";
const projection = (results: readonly Result[]): CollectionProjection<AssetProjection> => {
  const items = results.flatMap((result) => (result.item === undefined ? [] : [result.item]));
  const issues = results.flatMap((result) => (result.issue === undefined ? [] : [result.issue]));
  if (issues.length === 0) return { validity: "available", items };
  return items.length === 0
    ? { validity: "invalid", issues }
    : { validity: "partial", items, issues };
};

export const buildAssetProjection = async (
  input: Input,
): Promise<
  Readonly<{ assets: CollectionProjection<AssetProjection>; sources: readonly SourceRecord[] }>
> => {
  const record = input.records.find((candidate) => candidate.type === "asset-registry");
  if (record === undefined) return { assets: { validity: "available", items: [] }, sources: [] };
  if (record.trust === "invalid" || record.content.kind !== "asset-registry") {
    return {
      assets: {
        validity: "invalid",
        issues: [
          {
            code:
              record.diagnostics.find((diagnostic) => diagnostic.impact === "blocking")?.code ??
              "invalid-asset-registry",
            target: record.locator,
            message: "Asset Registry is unavailable to the normalized projection.",
            source: record.source.reference,
          },
        ],
      },
      sources: [record.source],
    };
  }
  const results: Result[] = [];
  for (const asset of record.content.assets) {
    const source = createSourceRecord(input.sitemapFingerprint, {
      kind: "asset",
      locator: record.locator,
      fragment: asset.ID,
      binding: { role: "asset", identity: asset.ID },
    });
    const projected = assetProjectionSchema.safeParse({
      id: asset.ID,
      title: asset.Title,
      source: source.reference,
      citations: [],
      kind: asset.Kind,
      owner: asset.Owner,
      producer: {
        kind: asset.Producer.Kind,
        name: asset.Producer.Name,
        ...(asset.Producer.Reference === undefined ? {} : { reference: asset.Producer.Reference }),
      },
      lifecycleSource: asset["Lifecycle source"],
      registeredAt: projectExpectedSourceEventTime(asset["Registered at"]),
      ...(() => {
        const producedAt = projectOptionalSourceEventTime(asset["Produced at"]);
        return producedAt === undefined ? {} : { producedAt };
      })(),
      ...(asset.Disposition === undefined ? {} : { disposition: asset.Disposition }),
      ...(asset["Superseded by"] === undefined ? {} : { supersededBy: asset["Superseded by"] }),
      ...(asset["Lifecycle source"] === "registry" && asset.Disposition === "superseded"
        ? { supersededAt: projectExpectedSourceEventTime(asset["Superseded at"]) }
        : {}),
      ...(asset["Lifecycle source"] === "registry" && asset.Disposition === "archived"
        ? { archivedAt: projectExpectedSourceEventTime(asset["Archived at"]) }
        : {}),
      ...(asset["Produced for"] === undefined ? {} : { producedFor: asset["Produced for"] }),
      displayLocation: asset.Location,
      contentAvailability: contentAvailability(input.contentObservations, asset.ID, asset.Location),
      adoptedByAuthorityIds: [],
      gatePassageEvidenceFor: [],
      citationCount: 0,
    });
    results.push(
      projected.success
        ? { source, item: projected.data }
        : {
            source,
            issue: {
              code: "invalid-asset",
              target: `${record.locator}#${asset.ID}`,
              message: "Asset entry cannot be normalized.",
              source: source.reference,
            },
          },
    );
  }
  for (const entry of record.content.invalidEntries) {
    const source = createSourceRecord(input.sitemapFingerprint, {
      kind: "asset",
      locator: record.locator,
      fragment: entry.key,
      binding: { role: "asset", identity: entry.key },
    });
    results.push({
      source,
      issue: {
        code: "invalid-asset-schema",
        target: `${record.locator}#${entry.key}`,
        message: "Asset entry does not match its package-owned schema.",
        source: source.reference,
      },
    });
  }
  results.sort((left, right) => compareUtf8(left.item?.id ?? "", right.item?.id ?? ""));
  const isolated = isolateDuplicateIdentities(results, (asset) => asset.id);
  return { assets: projection(isolated), sources: isolated.map((result) => result.source) };
};
