import type { GuidanceItem, NextWorkGuidance, SourceRecord } from "../project-snapshot/contract";
import { Icons } from "./icons";
import type { ProjectInspectorSelection } from "./project-inspector";
import type { ProjectOverviewModel } from "./project-overview-model";

type Inspect = (selection: ProjectInspectorSelection, trigger: HTMLButtonElement) => void;

const truthLabel = (guidance: NextWorkGuidance): string | undefined => {
  const coverage = guidance.semanticCoverage === "partial" ? "Partial project coverage" : undefined;
  let freshness: string | undefined;
  switch (guidance.semanticFreshness) {
    case "current":
      freshness = undefined;
      break;
    case "stale":
      freshness = "Guidance may be stale";
      break;
    case "unknown":
      freshness = "Freshness unknown";
      break;
  }
  if (coverage === undefined) return freshness;
  return freshness === undefined ? coverage : `${coverage} · ${freshness}`;
};

const handoffSelection = (
  item: GuidanceItem,
  source: ProjectInspectorSelection["source"],
): ProjectInspectorSelection => ({
  eyebrow: "Planning entry",
  title: item.title,
  detail: item.rationale,
  handoff: true,
  source,
});

export function OverviewGuidance({
  guidance,
  onInspect,
  sources,
}: {
  readonly guidance: ProjectOverviewModel["guidance"];
  readonly onInspect: Inspect;
  readonly sources: ReadonlyMap<string, SourceRecord>;
}) {
  if (guidance.state === "absent") {
    return (
      <section className="guidance-section scoped-state" aria-labelledby="next-work-title">
        <div className="section-heading">
          <h2 id="next-work-title">Next work</h2>
        </div>
        <p>No project-wide Next Work Guidance is available.</p>
      </section>
    );
  }
  if (guidance.state === "invalid") {
    return (
      <section className="guidance-section scoped-state" aria-labelledby="next-work-title">
        <div className="section-heading">
          <h2 id="next-work-title">Next work unavailable</h2>
        </div>
        <p>
          Guidance could not be projected ({guidance.issues.length} source issue
          {guidance.issues.length === 1 ? "" : "s"}).
        </p>
      </section>
    );
  }

  const truth = truthLabel(guidance.value);
  return (
    <section className="guidance-section" aria-labelledby="next-work-title">
      <div className="section-heading">
        <h2 id="next-work-title">Next work</h2>
        {truth === undefined ? null : <span className="truth-note">{truth}</span>}
      </div>
      {guidance.state === "partial" ? (
        <p className="projection-note" role="status">
          Guidance remains readable; {guidance.issues.length} projection issue
          {guidance.issues.length === 1 ? " is" : "s are"} isolated.
        </p>
      ) : null}
      <button
        className="primary-guidance"
        type="button"
        onClick={(event) =>
          onInspect(
            handoffSelection(guidance.value.primary, sources.get(guidance.value.primary.source)),
            event.currentTarget,
          )
        }
      >
        <span className="guidance-arrow" aria-hidden="true">
          <Icons.arrow />
        </span>
        <span>
          <strong>{guidance.value.primary.title}</strong>
          <small>{guidance.value.primary.rationale}</small>
        </span>
        <span className="resume-label">Resume in Agent Surface</span>
      </button>
      <div className="alternatives">
        <span>Alternatives</span>
        {guidance.value.alternatives.map((item) => (
          <button
            key={item.title}
            type="button"
            onClick={(event) =>
              onInspect(handoffSelection(item, sources.get(item.source)), event.currentTarget)
            }
          >
            <span>{item.title}</span>
            <Icons.arrow aria-hidden="true" />
          </button>
        ))}
      </div>
    </section>
  );
}
