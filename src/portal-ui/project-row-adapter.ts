import type { PortalProjectRows } from "../portal-project-read-wire";
import type { CollectionProjection, SingletonProjection } from "../project-snapshot/contract";
import type { ProjectData } from "./project-data";

const projectionState = (rows: PortalProjectRows, name: string) => {
  const states = rows.objects.filter(
    (object) => object.kind === "portal-projection-state" && object.value.projection === name,
  );
  if (states.length !== 1 || states[0]?.kind !== "portal-projection-state") {
    throw new Error("Project data projection state is inconsistent.");
  }
  return states[0];
};

const collection = <Value>(
  rows: PortalProjectRows,
  name: string,
  items: readonly Value[],
): CollectionProjection<Value> => {
  const state = projectionState(rows, name);
  if (state.value.validity === "invalid") {
    if (items.length > 0) throw new Error("Project data collection state is inconsistent.");
    return { validity: "invalid", issues: state.value.issues ?? [] };
  }
  if (state.value.validity === "absent") {
    throw new Error("Project data collection state is inconsistent.");
  }
  return state.value.validity === "partial"
    ? { validity: "partial", items, issues: state.value.issues ?? [] }
    : { validity: "available", items };
};

const singleton = <Value>(
  rows: PortalProjectRows,
  name: string,
  value: Value | undefined,
): SingletonProjection<Value> => {
  const state = projectionState(rows, name);
  if (state.value.validity === "invalid") {
    if (value !== undefined) throw new Error("Project data singleton state is inconsistent.");
    return { validity: "invalid", issues: state.value.issues ?? [] };
  }
  if (state.value.validity === "absent") {
    if (value !== undefined) throw new Error("Project data singleton state is inconsistent.");
    return { validity: "absent" };
  }
  if (value === undefined) throw new Error("Project data singleton state is inconsistent.");
  return state.value.validity === "partial"
    ? { validity: "partial", value, issues: state.value.issues ?? [] }
    : { validity: "available", value };
};

export const portalRowsToProjectData = (rows: PortalProjectRows): ProjectData => {
  const requiredPortalObject = <Kind extends "portal-roadmap-index" | "portal-audit">(
    kind: Kind,
  ): Extract<PortalProjectRows["objects"][number], { kind: Kind }> => {
    const matches = rows.objects.filter(
      (object): object is Extract<PortalProjectRows["objects"][number], { kind: Kind }> =>
        object.kind === kind,
    );
    if (matches.length !== 1 || matches[0] === undefined) {
      throw new Error("Project data singleton Portal object is inconsistent.");
    }
    return matches[0];
  };
  const evidence = rows.objects.flatMap((object) =>
    object.kind === "portal-native-evidence" ? [object.value] : [],
  );
  const boundEvidence = evidence.filter((item) => item.role === "bound");
  const detailEvidence = evidence.filter((item) => item.role === "detail");
  const context = {
    summary: singleton(
      rows,
      "summary",
      rows.objects.find((object) => object.kind === "project-summary")?.value,
    ),
    attentionCount: rows.attentionCount,
  };
  const roadmaps = () =>
    collection(
      rows,
      "roadmaps",
      rows.objects.flatMap((object) => (object.kind === "roadmap" ? [object.value] : [])),
    );
  const gates = () =>
    collection(
      rows,
      "gates",
      rows.objects.flatMap((object) => (object.kind === "gate" ? [object.value] : [])),
    );
  const efforts = () =>
    collection(
      rows,
      "efforts",
      rows.objects.flatMap((object) => (object.kind === "effort" ? [object.value] : [])),
    );
  const authorities = () =>
    collection(
      rows,
      "authorities",
      rows.objects.flatMap((object) => (object.kind === "authority" ? [object.value] : [])),
    );
  const assets = () =>
    collection(
      rows,
      "assets",
      rows.objects.flatMap((object) => (object.kind === "asset" ? [object.value] : [])),
    );
  const checks = () =>
    collection(
      rows,
      "checks",
      rows.objects.flatMap((object) => (object.kind === "alignment-check" ? [object.value] : [])),
    );
  const reviews = () =>
    collection(
      rows,
      "reviews",
      rows.objects.flatMap((object) => (object.kind === "planning-review" ? [object.value] : [])),
    );
  switch (rows.section) {
    case "overview": {
      const overviewRoadmapIndex = requiredPortalObject("portal-roadmap-index");
      return {
        ...context,
        section: "overview",
        attention: rows.attention,
        brief: singleton(
          rows,
          "brief",
          rows.objects.find((object) => object.kind === "project-brief")?.value,
        ),
        roadmapIndex: overviewRoadmapIndex.value.projection,
        roadmaps: roadmaps(),
        gates: gates(),
        efforts: efforts(),
        checks: checks(),
        reviews: reviews(),
        diagnostics: rows.diagnostics,
        sources: rows.sources,
      };
    }
    case "roadmaps": {
      const roadmapsRoadmapIndex = requiredPortalObject("portal-roadmap-index");
      return {
        ...context,
        section: "roadmaps",
        roadmapIndex: roadmapsRoadmapIndex.value.projection,
        roadmaps: roadmaps(),
        gates: gates(),
        sources: rows.sources,
      };
    }
    case "assets":
      return {
        ...context,
        section: "assets",
        roadmaps: roadmaps(),
        gates: gates(),
        efforts: efforts(),
        authorities: authorities(),
        assets: assets(),
        checks: checks(),
        reviews: reviews(),
        referenceTitles: rows.objects.flatMap((object) =>
          object.kind === "portal-reference-title"
            ? [{ reference: object.value.reference, title: object.value.title }]
            : [],
        ),
        sources: rows.sources,
      };
    case "audit": {
      const audit = requiredPortalObject("portal-audit");
      return {
        ...context,
        section: "audit",
        audit: audit.value.projection,
        checks: checks(),
        reviews: reviews(),
      };
    }
    case "lineage":
      return {
        ...context,
        section: "lineage",
        ...(rows.target === undefined ? {} : { target: rows.target }),
        ...(rows.nativeTargetState === undefined
          ? {}
          : { nativeTargetState: rows.nativeTargetState }),
        roadmaps: roadmaps(),
        gates: gates(),
        efforts: efforts(),
        authorities: authorities(),
        assets: assets(),
        checks: checks(),
        reviews: reviews(),
        lineage: { subjects: rows.lineage },
        providerObservations: boundEvidence.flatMap((evidence) =>
          evidence.observation === undefined ? [] : [evidence.observation],
        ),
        providerObservationSelections: boundEvidence.map((evidence) => evidence.selection),
        nativeScopeInspections: {
          observations: detailEvidence.flatMap((evidence) =>
            evidence.observation === undefined ? [] : [evidence.observation],
          ),
          selections: detailEvidence.map((evidence) => evidence.selection),
        },
        referenceTitles: rows.objects.flatMap((object) =>
          object.kind === "portal-reference-title"
            ? [{ reference: object.value.reference, title: object.value.title }]
            : [],
        ),
        diagnostics: rows.diagnostics,
        sources: rows.sources,
      };
  }
};
