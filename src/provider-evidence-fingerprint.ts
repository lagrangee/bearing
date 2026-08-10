import stableStringify from "safe-stable-stringify";
import type { ProviderObservationSelection } from "./provider-evidence-contract";
import type { MattSkillsV1ProviderObservation } from "./providers/matt-skills-v1/capture";
import { mattNativeScopeKey } from "./providers/matt-skills-v1/native-subject";

export const fingerprintProviderObservationSelection = (
  observations: readonly MattSkillsV1ProviderObservation[],
  selections: readonly ProviderObservationSelection[],
): string =>
  stableStringify({
    observations: [...observations]
      .sort((left, right) =>
        mattNativeScopeKey(left.binding).localeCompare(mattNativeScopeKey(right.binding), "en"),
      )
      .map(({ id: _id, ...observation }) => withoutInferredDisplayTime(observation)),
    selections: [...selections]
      .sort((left, right) =>
        mattNativeScopeKey(left).localeCompare(mattNativeScopeKey(right), "en"),
      )
      .map(({ latestAttempt: _latestAttempt, ...selection }) => ({
        ...selection,
        observationId: selection.observationId === null ? null : "selected",
      })),
  }) ?? "";

const withoutInferredDisplayTime = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(withoutInferredDisplayTime);
  if (value === null || typeof value !== "object") return value;
  const record = value as Readonly<Record<string, unknown>>;
  if (record["availability"] === "available" && record["basis"] === "inferred-source-metadata") {
    return { availability: "available", basis: "inferred-source-metadata" };
  }
  return Object.fromEntries(
    Object.entries(record).map(([key, item]) => [key, withoutInferredDisplayTime(item)]),
  );
};
