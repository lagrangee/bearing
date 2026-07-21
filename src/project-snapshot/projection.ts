import { buildAdvisoryProjection } from "./advisory";
import { rebuildAssetReverseRelations } from "./asset-reverse-relations";
import { buildAssetProjection } from "./assets";
import type { ProjectSnapshot, SourceRecord } from "./contract";
import { buildDecisionProjection } from "./decisions";
import { buildSnapshotDiagnostics } from "./diagnostic-projection";
import { buildGovernanceProjection } from "./governance";
import { buildRoadmapIndexProjection } from "./governance-index";
import type { ProjectSnapshotBuildInput } from "./projection-input";
import { PROJECT_SNAPSHOT_VERSION, projectSnapshotSchema } from "./schema";
import { createSourceRecord, mergeSourceRecords } from "./source-records";

const isTrackerSource = (locator: string): boolean =>
  /^\.scratch\/[^/]+\/(?:map\.md|issues\/(?:.*\/)?\d+-[^/]+\.md)$/u.test(locator);

const trackerSources = (
  records: ProjectSnapshotBuildInput["nativeRecords"],
  sitemapFingerprint: string,
): readonly SourceRecord[] =>
  records.flatMap((record) =>
    isTrackerSource(record.locator)
      ? [
          createSourceRecord(sitemapFingerprint, {
            kind: "tracker",
            locator: record.locator,
            binding: {
              role: record.locator.endsWith("/map.md") ? "map" : "ticket",
              identity: record.locator,
            },
          }),
        ]
      : [],
  );

export const buildProjectSnapshot = async (
  input: ProjectSnapshotBuildInput,
): Promise<ProjectSnapshot> => {
  const records = input.decoded.records;
  if (input.planningGraph.fingerprint !== input.sitemapFingerprint) {
    throw new Error("Project Snapshot Planning Graph fingerprint does not match its basis.");
  }
  const planning = input.planningGraph.planningProjection();
  const governance = buildGovernanceProjection({
    records,
    sitemapFingerprint: input.sitemapFingerprint,
    diagnostics: input.diagnostics,
  });
  const roadmapIndex = buildRoadmapIndexProjection(
    {
      records,
      sitemapFingerprint: input.sitemapFingerprint,
      diagnostics: input.diagnostics,
    },
    planning.roadmaps,
  );
  const assetProjection = await buildAssetProjection({
    records,
    sitemapFingerprint: input.sitemapFingerprint,
    contentObservations: input.assetContentObservations,
  });
  const decisions = buildDecisionProjection({
    records,
    sitemapFingerprint: input.sitemapFingerprint,
  });
  const advisory = buildAdvisoryProjection({
    records,
    sitemapFingerprint: input.sitemapFingerprint,
    advisoryFreshness: input.advisoryFreshness,
    checks: decisions.checks,
    reviews: decisions.reviews,
  });
  const sources = mergeSourceRecords([
    governance.sources,
    assetProjection.sources,
    decisions.sources,
    advisory.sources,
    trackerSources(input.nativeRecords, input.sitemapFingerprint),
  ]);
  const diagnosticProjection = buildSnapshotDiagnostics({
    sitemapFingerprint: input.sitemapFingerprint,
    diagnostics: input.diagnostics,
    sourceLocators: sources.map((source) => ({
      kind: source.kind,
      locator: source.displayLocator,
      ...(source.fragment === undefined ? {} : { fragment: source.fragment }),
      ...(source.binding === undefined ? {} : { binding: source.binding }),
    })),
  });
  const assets = rebuildAssetReverseRelations(assetProjection.assets, {
    roadmaps: planning.roadmaps,
    gates: planning.gates,
    efforts: planning.efforts,
    authorities: governance.authorities,
    checks: decisions.checks,
    reviews: decisions.reviews,
  });
  return projectSnapshotSchema.parse({
    schemaVersion: PROJECT_SNAPSHOT_VERSION,
    producer: { packageVersion: input.packageVersion },
    basis: { sitemapVersion: 1, sitemapFingerprint: input.sitemapFingerprint },
    summary: governance.summary,
    roadmapIndex,
    roadmaps: planning.roadmaps,
    gates: planning.gates,
    efforts: planning.efforts,
    authorities: governance.authorities,
    assets,
    checks: decisions.checks,
    reviews: decisions.reviews,
    audit: advisory.audit,
    guidance: advisory.guidance,
    maps: planning.maps,
    tickets: planning.tickets,
    diagnostics: diagnosticProjection.diagnostics,
    attention: [...diagnosticProjection.attention, ...decisions.attention],
    sources,
  });
};
