import type { SnapshotSourceInput } from "./projection-input";

export type AssetDirectEvidence = Readonly<{
  citations: readonly Readonly<{
    assetId: string;
    note: string;
    citingReference: string;
    source: string;
  }>[];
  authorityBaselines: readonly Readonly<{
    assetId: string;
    authorityId: string;
    source: string;
  }>[];
}>;

type ParsedRecord = SnapshotSourceInput &
  Readonly<{ data: NonNullable<SnapshotSourceInput["data"]> }>;

const parsedCanonicalRecords = (
  records: readonly SnapshotSourceInput[],
): readonly ParsedRecord[] => {
  const candidates = records.filter((record): record is ParsedRecord => record.data !== undefined);
  const counts = new Map<string, number>();
  for (const record of candidates) {
    if (!("ID" in record.data)) continue;
    const key = `${record.type}\0${record.data.ID}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return candidates.filter(
    (record) => !("ID" in record.data) || counts.get(`${record.type}\0${record.data.ID}`) === 1,
  );
};

export const collectAssetDirectEvidence = (
  records: readonly SnapshotSourceInput[],
): AssetDirectEvidence => {
  const citations: AssetDirectEvidence["citations"][number][] = [];
  const authorityBaselines: AssetDirectEvidence["authorityBaselines"][number][] = [];
  for (const record of parsedCanonicalRecords(records)) {
    const data = record.data;
    const directCitations = (() => {
      switch (data.Type) {
        case "roadmap":
        case "milestone-gate":
        case "effort":
        case "authority":
        case "planning-review":
          return data.Citations ?? [];
        default:
          return [];
      }
    })();
    if (directCitations.length > 0 && typeof data.ID !== "string") {
      throw new Error("A citation-bearing canonical record requires a Stable ID.");
    }
    for (const citation of directCitations) {
      citations.push({
        assetId: citation.Asset,
        note: citation.Note,
        citingReference: String(data.ID),
        source: record.source.reference,
      });
    }
    if (data.Type === "authority") {
      for (const assetId of data.Baseline) {
        authorityBaselines.push({
          assetId,
          authorityId: data.ID,
          source: record.source.reference,
        });
      }
    }
  }
  return { citations, authorityBaselines };
};
