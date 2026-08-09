import { type KeyboardEvent, useRef, useState } from "react";
import type { ProjectOverviewModel } from "./project-overview-model";

type OrientationTab = "brief" | "summary";

const orientationTimeFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

const OrientationTime = ({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string | undefined;
}) =>
  value === undefined ? null : (
    <p className="orientation-time">
      <span>{label}</span>
      <time dateTime={value}>{orientationTimeFormatter.format(new Date(value))}</time>
    </p>
  );

function BriefCanvas({ brief }: { readonly brief: ProjectOverviewModel["brief"] }) {
  if (brief.state === "absent") {
    return (
      <div className="orientation-state">
        <h2>Project Brief</h2>
        <p>Project Brief has not been generated yet.</p>
        <p>The complete Project Summary remains available in the Summary tab.</p>
      </div>
    );
  }
  if (brief.state === "invalid") {
    const cause = brief.issues[0]?.message ?? "The current Brief source is invalid.";
    return (
      <div className="orientation-state">
        <h2>Project Brief unavailable</h2>
        <p>{cause}</p>
        <p>The current Brief cannot be trusted; Project Summary remains independently readable.</p>
        <p>Correct the Project Brief source in Agent Surface, then reload this view.</p>
      </div>
    );
  }
  return (
    <div className="orientation-prose brief-prose">
      <div className="orientation-heading">
        <h2>Project Brief</h2>
        <OrientationTime label="Generated" value={brief.value.generatedAt} />
      </div>
      {brief.state === "partial" ? (
        <p className="projection-note" role="status">
          Some Brief content may be incomplete:{" "}
          {brief.issues[0]?.message ?? "source data is partial"}. Use it only for bounded
          orientation; correct the source in Agent Surface, then reload this view.
        </p>
      ) : null}
      <section>
        <h3>At a Glance</h3>
        <p lang={brief.value.languages?.atAGlance}>{brief.value.atAGlance}</p>
      </section>
      <section>
        <h3>Current Position</h3>
        <p lang={brief.value.languages?.currentPosition}>{brief.value.currentPosition}</p>
      </section>
      <SummaryList
        items={brief.value.establishedBaseline}
        language={brief.value.languages?.establishedBaseline}
        title="Established Baseline"
      />
    </div>
  );
}

function SummaryList({
  items,
  language,
  title,
}: {
  readonly items: readonly string[];
  readonly language?: string | undefined;
  readonly title: string;
}) {
  if (items.length === 0) return null;
  const occurrence = new Map<string, number>();
  const entries = items.map((item) => {
    const count = occurrence.get(item) ?? 0;
    occurrence.set(item, count + 1);
    return { item, key: `${item}\u0000${count}` };
  });
  return (
    <section>
      <h3>{title}</h3>
      <ul lang={language}>
        {entries.map(({ item, key }) => (
          <li key={key}>{item}</li>
        ))}
      </ul>
    </section>
  );
}

function SummaryCanvas({ summary }: { readonly summary: ProjectOverviewModel["summary"] }) {
  if (summary.state === "absent") {
    return (
      <div className="orientation-state">
        <h2>Project Summary unavailable</h2>
        <p>No Project Summary is available in the current Project Read Model generation.</p>
      </div>
    );
  }
  if (summary.state === "invalid") {
    const cause = summary.issues[0]?.message ?? "The current Summary source is invalid.";
    return (
      <div className="orientation-state">
        <h2>Project Summary unavailable</h2>
        <p>{cause}</p>
        <p>The complete Summary cannot be trusted; Project Brief remains independently readable.</p>
        <p>Correct the Project Summary source in Agent Surface, then reload this view.</p>
      </div>
    );
  }
  return (
    <div className="orientation-prose summary-prose">
      <div className="orientation-heading">
        <h2>Project Summary</h2>
        <OrientationTime label="Updated" value={summary.value.updatedAt} />
      </div>
      {summary.state === "partial" ? (
        <p className="projection-note" role="status">
          Some Summary content may be incomplete:{" "}
          {summary.issues[0]?.message ?? "source data is partial"}. Use only the visible sections;
          correct the source in Agent Surface, then reload this view.
        </p>
      ) : null}
      <section>
        <h3>Purpose</h3>
        <p lang={summary.value.languages?.purpose}>{summary.value.purpose}</p>
      </section>
      <section>
        <h3>Current Design</h3>
        <p lang={summary.value.languages?.currentDesign}>{summary.value.currentDesign}</p>
      </section>
      <SummaryList items={summary.value.boundaries} title="Boundaries" />
      <SummaryList items={summary.value.futureCandidates} title="Future Candidates" />
      <SummaryList items={summary.value.materialRevisions} title="Material Revisions" />
    </div>
  );
}

export function OverviewBrief({
  brief,
  summary,
}: {
  readonly brief: ProjectOverviewModel["brief"];
  readonly summary: ProjectOverviewModel["summary"];
}) {
  const [tab, setTab] = useState<OrientationTab>("brief");
  const briefTab = useRef<HTMLButtonElement>(null);
  const summaryTab = useRef<HTMLButtonElement>(null);
  const selectTab = (next: OrientationTab, focus = false) => {
    setTab(next);
    if (focus) (next === "brief" ? briefTab : summaryTab).current?.focus();
  };
  const navigateTabs = (event: KeyboardEvent<HTMLButtonElement>) => {
    const next =
      event.key === "ArrowLeft" || event.key === "ArrowUp" || event.key === "Home"
        ? "brief"
        : event.key === "ArrowRight" || event.key === "ArrowDown" || event.key === "End"
          ? "summary"
          : undefined;
    if (next === undefined) return;
    event.preventDefault();
    selectTab(next, true);
  };
  const projectTitle =
    summary.state === "available" || summary.state === "partial"
      ? summary.value.title
      : "Project overview";
  return (
    <header className="project-intro">
      <h1>{projectTitle}</h1>
      <div className="orientation-tabs" role="tablist" aria-label="Project orientation">
        <button
          aria-controls="project-orientation-panel"
          aria-selected={tab === "brief"}
          id="project-brief-tab"
          onClick={() => selectTab("brief")}
          onKeyDown={navigateTabs}
          ref={briefTab}
          role="tab"
          tabIndex={tab === "brief" ? 0 : -1}
          type="button"
        >
          Brief
        </button>
        <button
          aria-controls="project-orientation-panel"
          aria-selected={tab === "summary"}
          id="project-summary-tab"
          onClick={() => selectTab("summary")}
          onKeyDown={navigateTabs}
          ref={summaryTab}
          role="tab"
          tabIndex={tab === "summary" ? 0 : -1}
          type="button"
        >
          Project Summary
        </button>
      </div>
      <section
        aria-labelledby={tab === "brief" ? "project-brief-tab" : "project-summary-tab"}
        className="orientation-canvas"
        id="project-orientation-panel"
        role="tabpanel"
      >
        {tab === "brief" ? <BriefCanvas brief={brief} /> : <SummaryCanvas summary={summary} />}
      </section>
    </header>
  );
}
