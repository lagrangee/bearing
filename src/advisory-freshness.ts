import type { DecodedBearingRecordGeneration } from "./bearing-record-decoder";
import { fingerprintInputRecords, orderedInputLocators } from "./fingerprint";
import type { NativeSourceRecord } from "./native-work";
import type { AdvisoryFreshness, AdvisoryId, SemanticFreshness } from "./types";

type CapturedInputRecord = NativeSourceRecord & Readonly<{ bytes: Buffer }>;

const advisoryIdentity = (type: "planning-audit" | "next-work-guidance"): AdvisoryId =>
  type === "planning-audit" ? "planning-audit:current" : "next-work-guidance:current";

const advisories = (decoded: DecodedBearingRecordGeneration) =>
  decoded.records.filter(
    (record) =>
      record.data !== undefined &&
      (record.data.Type === "planning-audit" || record.data.Type === "next-work-guidance"),
  );

export const advisoryBasisInputsFromGeneration = (
  decoded: DecodedBearingRecordGeneration,
): readonly string[] => [
  ...new Set(
    advisories(decoded).flatMap((record) =>
      record.data !== undefined &&
      (record.data.Type === "planning-audit" || record.data.Type === "next-work-guidance")
        ? record.data.Inputs
        : [],
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
      if (
        data === undefined ||
        (data.Type !== "planning-audit" && data.Type !== "next-work-guidance")
      ) {
        return [];
      }
      return [
        [
          advisoryIdentity(data.Type),
          capturedFreshnessFor(records, data.Inputs, data["Input fingerprint"]),
        ],
      ];
    }),
  );
