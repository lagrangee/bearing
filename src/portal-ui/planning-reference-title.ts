import type { ProjectSnapshot } from "../project-snapshot/contract";
import { mattNativeRecords } from "../providers/matt-skills-v1/native-read-model";

const canonicalRecords = (snapshot: ProjectSnapshot) => [
  ...(snapshot.roadmaps.validity === "invalid" ? [] : snapshot.roadmaps.items),
  ...(snapshot.gates.validity === "invalid" ? [] : snapshot.gates.items),
  ...(snapshot.efforts.validity === "invalid" ? [] : snapshot.efforts.items),
  ...(snapshot.authorities.validity === "invalid" ? [] : snapshot.authorities.items),
  ...(snapshot.checks.validity === "invalid" ? [] : snapshot.checks.items),
  ...(snapshot.reviews.validity === "invalid" ? [] : snapshot.reviews.items),
  ...(snapshot.assets.validity === "invalid" ? [] : snapshot.assets.items),
];

export const semanticTitleForPlanningReference = (
  snapshot: ProjectSnapshot,
  reference: string,
): string => {
  const canonical = canonicalRecords(snapshot).find((record) => String(record.id) === reference);
  if (canonical !== undefined) return canonical.title;

  const nativeMatches = mattNativeRecords(snapshot.providerObservations, snapshot.sources).filter(
    (record) => record.recordKind === "native-object" && String(record.object.ref) === reference,
  );
  return nativeMatches.length === 1 ? (nativeMatches[0]?.title ?? reference) : reference;
};
