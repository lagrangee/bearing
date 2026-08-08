import type { LineageModelData } from "./project-data";

type PlanningReferenceData = Pick<
  LineageModelData,
  "roadmaps" | "gates" | "efforts" | "authorities" | "checks" | "reviews" | "assets" | "sources"
> &
  Readonly<{
    referenceTitles?: readonly Readonly<{ reference: string; title: string }>[] | undefined;
  }>;

const canonicalRecords = (snapshot: PlanningReferenceData) => [
  ...(snapshot.roadmaps.validity === "invalid" ? [] : snapshot.roadmaps.items),
  ...(snapshot.gates.validity === "invalid" ? [] : snapshot.gates.items),
  ...(snapshot.efforts.validity === "invalid" ? [] : snapshot.efforts.items),
  ...(snapshot.authorities.validity === "invalid" ? [] : snapshot.authorities.items),
  ...(snapshot.checks.validity === "invalid" ? [] : snapshot.checks.items),
  ...(snapshot.reviews.validity === "invalid" ? [] : snapshot.reviews.items),
  ...(snapshot.assets.validity === "invalid" ? [] : snapshot.assets.items),
];

export const semanticTitleForPlanningReference = (
  snapshot: PlanningReferenceData,
  reference: string,
): string => {
  const canonical = canonicalRecords(snapshot).find((record) => String(record.id) === reference);
  if (canonical !== undefined) return canonical.title;

  return (
    snapshot.referenceTitles?.find((record) => record.reference === reference)?.title ?? reference
  );
};
