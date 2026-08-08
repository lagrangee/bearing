import type { NativeScopeInspectionSubject } from "../native-scope-inspection";
import type {
  AttentionItem,
  PlanningReview,
  ProjectBrief,
  ProjectionIssue,
  ProjectSummary,
  SnapshotDiagnostic,
  SourceRecord,
  SourceReference,
} from "../project-snapshot/contract";
import { targetWithinNativeScope } from "../project-snapshot/managed-attention";
import { mattNativeScopeSubject } from "../providers/matt-skills-v1/native-subject";
import type { OverviewModelData } from "./project-data";
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
  kind: "diagnostic" | "review";
  state: "available" | "unresolved";
  title: string;
  detail: string | undefined;
  nativeSubject?: NativeScopeInspectionSubject | undefined;
}>;

export type ProjectOverviewModel = Readonly<{
  brief: ScopedValue<ProjectBrief>;
  summary: ScopedValue<ProjectSummary>;
  attention: readonly OverviewAttentionItem[];
  roadmaps: OverviewRoadmaps;
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
  reviews: ReadonlyMap<string, PlanningReview>,
  sources: ReadonlyMap<string, SourceRecord>,
  efforts: OverviewModelData["efforts"],
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
          }
        : {
            key: diagnostic.reference,
            kind: "diagnostic",
            state: "available",
            title: diagnostic.message,
            detail: undefined,
            ...(() => {
              const source =
                diagnostic.source === undefined ? undefined : sources.get(diagnostic.source);
              const sourceSubject =
                source?.binding === undefined
                  ? undefined
                  : source.binding.role === "native-scope"
                    ? ({ kind: "native-scope", id: source.binding.identity } as const)
                    : source.kind === "tracker"
                      ? ({ kind: "native-subject", id: source.binding.identity } as const)
                      : undefined;
              const boundScope =
                efforts.validity === "invalid"
                  ? undefined
                  : efforts.items.find(
                      (effort) =>
                        effort.workBindingState.state === "bound" &&
                        effort.workBinding !== undefined &&
                        targetWithinNativeScope(diagnostic.target, effort.workBinding.nativeScope),
                    )?.workBinding;
              const boundSubject =
                boundScope === undefined
                  ? undefined
                  : mattNativeScopeSubject({ binding: boundScope });
              const nativeSubject =
                sourceSubject ??
                (boundSubject === undefined
                  ? undefined
                  : ({ kind: "native-scope", id: boundSubject.id } as const));
              return nativeSubject === undefined
                ? {}
                : {
                    nativeSubject,
                  };
            })(),
          };
    }
    case "planning-review": {
      const review = reviews.get(item.id);
      return {
        key: item.id,
        kind: "review",
        state: review === undefined ? "unresolved" : "available",
        title: item.title,
        detail:
          review?.scope.kind === "project" ? "Whole project" : `Target: ${review?.scope.target}`,
      };
    }
  }
};

export const buildProjectOverviewModel = (snapshot: OverviewModelData): ProjectOverviewModel => {
  const sources = indexBy(snapshot.sources, (source) => source.reference);
  const diagnostics = indexBy(snapshot.diagnostics, (diagnostic) => diagnostic.reference);
  const reviews = indexBy(projectionItems(snapshot.reviews), (review) => review.id);
  return {
    brief: scopedValue(snapshot.brief, sources),
    summary: scopedValue(snapshot.summary, sources),
    attention: snapshot.attention.map((item) =>
      attentionModel(item, diagnostics, reviews, sources, snapshot.efforts),
    ),
    roadmaps: buildOverviewRoadmaps(snapshot, sources),
    sources,
  };
};
