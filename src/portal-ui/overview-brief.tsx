import { Icons } from "./icons";
import type { ProjectInspectorSelection } from "./project-inspector";
import type { ProjectOverviewModel } from "./project-overview-model";

type Inspect = (selection: ProjectInspectorSelection, trigger: HTMLButtonElement) => void;

export function OverviewBrief({
  onInspect,
  summary,
}: {
  readonly onInspect: Inspect;
  readonly summary: ProjectOverviewModel["summary"];
}) {
  if (summary.state === "absent") {
    return (
      <header className="project-intro">
        <p className="eyebrow">Project overview</p>
        <h1>Project overview</h1>
        <section className="project-brief scoped-state" aria-labelledby="project-brief-title">
          <h2 id="project-brief-title">Project brief</h2>
          <p>No Project Summary is available in the current Snapshot.</p>
        </section>
      </header>
    );
  }
  if (summary.state === "invalid") {
    return (
      <header className="project-intro">
        <p className="eyebrow">Project overview</p>
        <h1>Project overview</h1>
        <section className="project-brief scoped-state" aria-labelledby="project-brief-title">
          <h2 id="project-brief-title">Project brief unavailable</h2>
          <p>
            The Project Summary could not be projected ({summary.issues.length} source issue
            {summary.issues.length === 1 ? "" : "s"}).
          </p>
        </section>
      </header>
    );
  }

  return (
    <header className="project-intro">
      <p className="eyebrow">Project overview</p>
      <h1>{summary.value.title}</h1>
      <section className="project-brief" aria-labelledby="project-brief-title">
        <div className="brief-heading">
          <h2 id="project-brief-title">Project brief</h2>
          <button
            className="source-action"
            type="button"
            onClick={(event) =>
              onInspect(
                {
                  eyebrow: "Project source",
                  title: "Project Summary",
                  detail: summary.value.title,
                  source: summary.source,
                },
                event.currentTarget,
              )
            }
          >
            <Icons.source aria-hidden="true" />
            <span>View Project Summary</span>
          </button>
        </div>
        {summary.state === "partial" ? (
          <p className="projection-note" role="status">
            Project Brief is partial; {summary.issues.length} source issue
            {summary.issues.length === 1 ? " is" : "s are"} isolated.
          </p>
        ) : null}
        <p lang={summary.value.languages?.purpose}>{summary.value.purpose}</p>
        <p lang={summary.value.languages?.currentDesign}>{summary.value.currentDesign}</p>
      </section>
    </header>
  );
}
