import type { SnapshotSourceInput } from "./projection-input";

export type AssetDirectEvidence = Readonly<{
  citations: readonly Readonly<{
    assetId: string;
    note: string;
    citingReference: string;
    source: string;
  }>[];
  authorityAdoptions: readonly Readonly<{
    assetId: string;
    authorityId: string;
    decisionReference: string;
    source: string;
  }>[];
  passageEvidence: readonly Readonly<{
    assetId: string;
    gateId: string;
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
  const authorityAdoptions: AssetDirectEvidence["authorityAdoptions"][number][] = [];
  const passageEvidence: AssetDirectEvidence["passageEvidence"][number][] = [];
  for (const record of parsedCanonicalRecords(records)) {
    const data = record.data;
    const directCitations = (() => {
      switch (data.Type) {
        case "roadmap":
        case "milestone-gate":
        case "effort":
        case "authority":
        case "alignment-check":
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
      for (const adoption of data.Adoptions ?? []) {
        authorityAdoptions.push({
          assetId: adoption.Asset,
          authorityId: data.ID,
          decisionReference: adoption.Decision,
          source: record.source.reference,
        });
      }
    }
    if (data.Type === "milestone-gate") {
      for (const assetId of data.Passage?.Evidence ?? []) {
        passageEvidence.push({
          assetId,
          gateId: data.ID,
          source: record.source.reference,
        });
      }
    }
  }
  return { citations, authorityAdoptions, passageEvidence };
};
