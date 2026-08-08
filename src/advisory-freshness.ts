import type { DecodedBearingRecordGeneration } from "./bearing-record-decoder";
import { fingerprintInputRecords, orderedInputLocators } from "./fingerprint";
import type { SyncInputRecord } from "./sync-input-generation";
import type { AdvisoryFreshness, AdvisoryId, SemanticFreshness } from "./types";

type CapturedInputRecord = SyncInputRecord;

const advisories = (decoded: DecodedBearingRecordGeneration) =>
  decoded.records.filter((record) => record.data?.Type === "planning-audit");

export const advisoryBasisInputsFromGeneration = (
  decoded: DecodedBearingRecordGeneration,
): readonly string[] => [
  ...new Set(
    advisories(decoded).flatMap((record) =>
      record.data?.Type === "planning-audit" ? record.data.Inputs : [],
    ),
  ),
];

const capturedFreshnessFor = (
  records: readonly CapturedInputRecord[],
  inputs: readonly string[],
  fingerprint: string,
): SemanticFreshness => {
  try {
    const index = new Map(records.map((record) => [record.locator, record]));
    const selected = orderedInputLocators(inputs).map((locator) => index.get(locator));
    if (selected.some((record) => record === undefined)) return "unknown";
    const current = fingerprintInputRecords(selected as readonly CapturedInputRecord[]);
    return current.fingerprint === fingerprint ? "current" : "stale";
  } catch {
    return "unknown";
  }
};

export const deriveAdvisoryFreshnessFromGeneration = (
  decoded: DecodedBearingRecordGeneration,
  records: readonly CapturedInputRecord[],
): AdvisoryFreshness =>
  Object.fromEntries(
    advisories(decoded).flatMap((record): readonly [AdvisoryId, SemanticFreshness][] => {
      const data = record.data;
      if (data?.Type !== "planning-audit") {
        return [];
      }
      return [
        [
          "planning-audit:current",
          capturedFreshnessFor(records, data.Inputs, data["Input fingerprint"]),
        ],
      ];
    }),
  );
