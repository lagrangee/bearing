import type { NativeScopeInspectionSubject } from "../native-scope-inspection";
import type {
  AlignmentCheck,
  AttentionItem,
  NativeScopeDiscoveryProjection,
  NextWorkGuidance,
  PlanningReview,
  ProjectionIssue,
  ProjectSnapshot,
  ProjectSummary,
  SnapshotDiagnostic,
  SourceRecord,
  SourceReference,
} from "../project-snapshot/contract";
import { mattNativeScopeSubject } from "../providers/matt-skills-v1/native-subject";
import { buildOverviewRoadmaps, type OverviewRoadmaps } from "./project-overview-roadmaps";

type ScopedValue<T> =
  | Readonly<{ state: "available"; value: T; source: SourceRecord | undefined }>
  | Readonly<{
      state: "partial";
      value: T;
      source: SourceRecord | undefined;
      issues: readonly ProjectionIssue[];
    }>
  | Readonly<{ state: "absent"; source: undefined }>
  | Readonly<{ state: "invalid"; source: undefined; issues: readonly ProjectionIssue[] }>;

export type OverviewAttentionItem = Readonly<{
  key: string;
  kind: "diagnostic" | "alignment" | "review";
  state: "available" | "unresolved";
  title: string;
  detail: string | undefined;
  source: SourceRecord | undefined;
  nativeSubject?: NativeScopeInspectionSubject | undefined;
}>;

export type ProjectOverviewModel = Readonly<{
  summary: ScopedValue<ProjectSummary>;
  attention: readonly OverviewAttentionItem[];
  guidance: ScopedValue<NextWorkGuidance>;
  roadmaps: OverviewRoadmaps;
  discoveredWork: NativeScopeDiscoveryProjection;
  sources: ReadonlyMap<string, SourceRecord>;
}>;

const indexBy = <Item>(items: readonly Item[], key: (item: Item) => string): Map<string, Item> => {
  const index = new Map<string, Item>();
  for (const item of items) index.set(key(item), item);
  return index;
};

const projectionItems = <Item>(
  projection:
    | Readonly<{ validity: "available" | "partial"; items: readonly Item[] }>
    | Readonly<{ validity: "invalid" }>,
): readonly Item[] => (projection.validity === "invalid" ? [] : projection.items);

const scopedValue = <Item extends Readonly<{ source: SourceReference }>>(
  projection:
    | Readonly<{ validity: "available"; value: Item }>
    | Readonly<{ validity: "partial"; value: Item; issues: readonly ProjectionIssue[] }>
    | Readonly<{ validity: "absent" }>
    | Readonly<{ validity: "invalid"; issues: readonly ProjectionIssue[] }>,
  sources: ReadonlyMap<string, SourceRecord>,
): ScopedValue<Item> => {
  switch (projection.validity) {
    case "available":
      return {
        state: "available",
        value: projection.value,
        source: sources.get(projection.value.source),
      };
    case "partial":
      return {
        state: "partial",
        value: projection.value,
        source: sources.get(projection.value.source),
        issues: projection.issues,
      };
    case "absent":
      return { state: "absent", source: undefined };
    case "invalid":
      return { state: "invalid", source: undefined, issues: projection.issues };
  }
};

const attentionModel = (
  item: AttentionItem,
  diagnostics: ReadonlyMap<string, SnapshotDiagnostic>,
  checks: ReadonlyMap<string, AlignmentCheck>,
  reviews: ReadonlyMap<string, PlanningReview>,
  sources: ReadonlyMap<string, SourceRecord>,
  discovery: NativeScopeDiscoveryProjection,
  efforts: ProjectSnapshot["efforts"],
): OverviewAttentionItem => {
  switch (item.kind) {
    case "structural-diagnostic": {
      const diagnostic = diagnostics.get(item.diagnosticReference);
      return diagnostic === undefined
        ? {
            key: item.diagnosticReference,
            kind: "diagnostic",
            state: "unresolved",
            title: "Attention source unavailable",
            detail: undefined,
            source: undefined,
          }
        : {
            key: diagnostic.reference,
            kind: "diagnostic",
            state: "available",
            title: diagnostic.message,
            detail: diagnostic.target,
            source: diagnostic.source === undefined ? undefined : sources.get(diagnostic.source),
            ...(() => {
              const discoveredScope =
                discovery.state === "never-run"
                  ? undefined
                  : discovery.scopes.find(
                      (candidate) => candidate.summary.locator === diagnostic.target,
                    );
              const boundScope =
                efforts.validity === "invalid"
                  ? undefined
                  : efforts.items.find(
                      (effort) => effort.workBinding?.nativeScope === diagnostic.target,
                    )?.workBinding;
              const boundSubject =
                boundScope === undefined
                  ? undefined
                  : mattNativeScopeSubject({ binding: boundScope });
              const nativeScopeId = discoveredScope?.summary.identity ?? boundSubject?.id;
              return nativeScopeId === undefined
                ? {}
                : {
                    nativeSubject: {
                      kind: "native-scope" as const,
                      id: nativeScopeId,
                    },
                  };
            })(),
          };
    }
    case "alignment-check": {
      const check = checks.get(item.id);
      return {
        key: item.id,
        kind: "alignment",
        state: check === undefined ? "unresolved" : "available",
        title: item.title,
        detail: check?.target,
        source: sources.get(item.source),
      };
    }
    case "planning-review": {
      const review = reviews.get(item.id);
      return {
        key: item.id,
        kind: "review",
        state: review === undefined ? "unresolved" : "available",
        title: item.title,
        detail: review?.scope,
        source: sources.get(item.source),
      };
    }
  }
};

export const buildProjectOverviewModel = (snapshot: ProjectSnapshot): ProjectOverviewModel => {
  const sources = indexBy(snapshot.sources, (source) => source.reference);
  const diagnostics = indexBy(snapshot.diagnostics, (diagnostic) => diagnostic.reference);
  const checks = indexBy(projectionItems(snapshot.checks), (check) => check.id);
  const reviews = indexBy(projectionItems(snapshot.reviews), (review) => review.id);
  return {
    summary: scopedValue(snapshot.summary, sources),
    attention: snapshot.attention.map((item) =>
      attentionModel(
        item,
        diagnostics,
        checks,
        reviews,
        sources,
        snapshot.nativeScopeDiscovery,
        snapshot.efforts,
      ),
    ),
    guidance: scopedValue(snapshot.guidance, sources),
    roadmaps: buildOverviewRoadmaps(snapshot, sources),
    discoveredWork: snapshot.nativeScopeDiscovery,
    sources,
  };
};
