import { type MouseEvent, useEffect } from "react";
import type {
  RequestedPlanningLineageFilteredView,
  RequestedPlanningLineageSubject,
} from "../planning-lineage-route";
import { planningLineageSubjectHref } from "../planning-lineage-route";
import type { ProjectSnapshot } from "../project-snapshot/contract";
import type { MattNativeEventTime } from "../providers/matt-skills-v1/model";
import type { MattNativeWorkReadingState } from "../providers/matt-skills-v1/reading-state";
import type {
  MattNativeWorkRegionCount,
  MattNativeWorkRegionItem,
  MattNativeWorkRegionMapChapter,
  MattNativeWorkRegionModel,
  MattNativeWorkRegionRoleGroup,
} from "../providers/matt-skills-v1/work-region";
import { Icons } from "./icons";
import type {
  PlanningLineageRelation,
  PlanningLineageRelationItem,
  PlanningLineageTimeFact,
} from "./planning-lineage-model";
import {
  buildPlanningLineageSubjectModel,
  planningLineageRelationFor,
} from "./planning-lineage-model";
import { projectCanvasFocusKey } from "./project-canvas-history";
import type { ProjectInspectorSelection } from "./project-inspector";
import { SourceEventTimeValue } from "./source-event-time";

type Inspect = (selection: ProjectInspectorSelection, trigger: HTMLButtonElement) => void;
type Navigate = (href: string, focusKey?: string) => void;

const subjectLabel = (kind: string): string =>
  kind
    .split("-")
    .map((word) => `${word[0]?.toUpperCase()}${word.slice(1)}`)
    .join(" ");

const follow = (href: string, event: MouseEvent<HTMLAnchorElement>, onNavigate: Navigate) => {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
    return;
  event.preventDefault();
  onNavigate(href, projectCanvasFocusKey(event.currentTarget));
};

function PlanningLineageTimeValue({
  label,
  mode,
  time,
}: {
  readonly label: string;
  readonly mode: "compact" | "detail";
  readonly time: MattNativeEventTime;
}) {
  return time.availability === "unsupported" ? (
    <span className="source-event-time unsupported">Time unsupported</span>
  ) : (
    <SourceEventTimeValue label={label} mode={mode} time={time} />
  );
}

function TimeFacts({ facts }: { readonly facts: readonly PlanningLineageTimeFact[] }) {
  return (
    <dl className="lineage-time-facts">
      {facts.map((fact) => (
        <div key={fact.key}>
          <dt>{fact.label}</dt>
          <dd>
            {fact.mode === "compact" ? (
              <details className="lineage-time-disclosure">
                <summary>
                  <PlanningLineageTimeValue label={fact.label} mode="compact" time={fact.time} />
                </summary>
                <PlanningLineageTimeValue label={fact.label} mode="detail" time={fact.time} />
              </details>
            ) : (
              <PlanningLineageTimeValue label={fact.label} mode="detail" time={fact.time} />
            )}
            {fact.detail === undefined ? null : <small>{fact.detail}</small>}
          </dd>
        </div>
      ))}
    </dl>
  );
}

const relationStateLabel = (relation: PlanningLineageRelation): string => {
  switch (relation.state) {
    case "present":
      return relation.total.coverage === "complete"
        ? `${relation.total.count} total`
        : `At least ${relation.total.count}`;
    case "confirmed-none":
      return "Confirmed none";
    case "unknown":
      return "Unknown";
    case "unavailable":
      return "Unavailable";
  }
};

function RelationItem({
  focusKeyPrefix,
  item,
  onInspect,
  onNavigate,
}: {
  readonly focusKeyPrefix: string;
  readonly item: PlanningLineageRelationItem;
  readonly onInspect: Inspect;
  readonly onNavigate: Navigate;
}) {
  const title =
    item.availability === "available" ? item.label : `${item.label} · target unavailable`;
  return (
    <li className="lineage-relation-item">
      <span>
        {item.href === undefined ? (
          <strong>{title}</strong>
        ) : (
          <a
            data-bearing-focus-key={`${focusKeyPrefix}:primary`}
            href={item.href}
            onClick={(event) => follow(item.href ?? "", event, onNavigate)}
          >
            {title}
          </a>
        )}
        <code>{item.reference}</code>
        {item.event === undefined ? null : (
          <small className="lineage-relation-event">
            {item.event.label}{" "}
            <PlanningLineageTimeValue
              label={`${item.label} ${item.event.label}`}
              mode="compact"
              time={item.event.time}
            />
          </small>
        )}
        {item.note === undefined ? null : <small>{item.note}</small>}
      </span>
      {item.href === undefined ? null : (
        <button
          aria-label={`Quick Look ${item.label}`}
          className="lineage-quick-look"
          data-bearing-focus-key={`${focusKeyPrefix}:quick-look`}
          type="button"
          onClick={(event) =>
            onInspect(
              {
                eyebrow: "Quick Look",
                title: item.label,
                detail: "A direct typed relation from the current subject.",
                facts: [
                  { label: "Reference", value: item.reference, code: true },
                  { label: "Availability", value: item.availability },
                ],
                fullDetailHref: item.href,
              },
              event.currentTarget,
            )
          }
        >
          Quick Look
        </button>
      )}
    </li>
  );
}

function RelationCollection({
  relation,
  onInspect,
  onNavigate,
}: {
  readonly relation: PlanningLineageRelation;
  readonly onInspect: Inspect;
  readonly onNavigate: Navigate;
}) {
  return (
    <section
      className={`lineage-relation relation-${relation.state}`}
      id={`relation.${relation.key}`}
    >
      <div className="lineage-relation-heading">
        <div>
          <h3>{relation.label}</h3>
          <p>{relation.direction}</p>
        </div>
        <span>{relationStateLabel(relation)}</span>
      </div>
      {relation.state === "present" ? (
        <>
          <ul>
            {relation.items.map((item) => (
              <RelationItem
                focusKeyPrefix={`lineage:${relation.key}:${item.reference}`}
                item={item}
                key={`${relation.key}:${item.reference}`}
                onInspect={onInspect}
                onNavigate={onNavigate}
              />
            ))}
          </ul>
          {relation.filteredViewHref === undefined ? null : (
            <a
              className="lineage-filtered-view-link"
              href={relation.filteredViewHref}
              onClick={(event) => follow(relation.filteredViewHref ?? "", event, onNavigate)}
            >
              View all {relation.total.count} in canonical order <Icons.arrow />
            </a>
          )}
        </>
      ) : (
        <p>{relation.reason}</p>
      )}
    </section>
  );
}

const workRegionCountLabel = (count: MattNativeWorkRegionCount): string => {
  if (count.mode === "unavailable") return "Count unavailable";
  return count.mode === "exact" ? String(count.value) : `At least ${count.value}`;
};

const workRegionSubjectHref = (entryId: string, reference: string, anchor?: string): string =>
  planningLineageSubjectHref(entryId, { kind: "native-subject", id: reference }, anchor);

const humanizeWorkState = (state: string): string => {
  const words = state.replaceAll("-", " ");
  return `${words[0]?.toUpperCase() ?? ""}${words.slice(1)}`;
};

const WORK_REGION_VIEW_ANCHORS = new Set([
  "native-work-current",
  "native-work-history",
  "native-work-all",
]);

function WorkRegionItem({
  entryId,
  item,
  onNavigate,
}: {
  readonly entryId: string;
  readonly item: MattNativeWorkRegionItem;
  readonly onNavigate: Navigate;
}) {
  const href = workRegionSubjectHref(entryId, item.reference);
  const state =
    item.frontier ??
    (item.role === "incoming" ? item.routingState : undefined) ??
    item.nativeLifecycle;
  return (
    <li className="matt-work-item">
      <div className="matt-work-item-heading">
        <div className="matt-work-item-title">
          <small>{item.role}</small>
          <a href={href} onClick={(event) => follow(href, event, onNavigate)}>
            {item.title}
          </a>
        </div>
        <span>{humanizeWorkState(state)}</span>
      </div>
      <dl>
        <div>
          <dt>Native lifecycle</dt>
          <dd>{item.nativeLifecycle}</dd>
        </div>
        {item.claimant === undefined ? null : (
          <div>
            <dt>Claimant</dt>
            <dd>
              <strong>{item.claimant}</strong>
              {item.claimantAmbiguous === true ? " · ambiguous" : ""}
            </dd>
          </div>
        )}
        {item.answerAvailability === undefined ? null : (
          <div>
            <dt>Answer</dt>
            <dd>{item.answerAvailability}</dd>
          </div>
        )}
        {item.decisionEvidence === undefined ? null : (
          <div>
            <dt>Decision evidence</dt>
            <dd>
              {item.decisionEvidence.kind}
              {item.decisionEvidence.target === undefined
                ? ""
                : ` · ${item.decisionEvidence.target}`}
            </dd>
          </div>
        )}
        {item.trackerClosure === undefined ? null : (
          <div>
            <dt>Tracker closure</dt>
            <dd>{item.trackerClosure}</dd>
          </div>
        )}
        {item.category === undefined ? null : (
          <div>
            <dt>Category</dt>
            <dd>{item.category}</dd>
          </div>
        )}
        {item.routingState === undefined ? null : (
          <div>
            <dt>Routing state</dt>
            <dd>{item.routingState}</dd>
          </div>
        )}
        {item.nativeDisposition === undefined ? null : (
          <div>
            <dt>Native disposition</dt>
            <dd>{item.nativeDisposition}</dd>
          </div>
        )}
      </dl>
      {item.blockers === undefined || item.blockers.length === 0 ? null : (
        <p className="matt-work-blockers">
          Blockers:{" "}
          {item.blockers.map((blocker) => (
            <code className="matt-work-blocker" key={`${item.reference}:${blocker}`}>
              {blocker}
            </code>
          ))}
        </p>
      )}
      {item.completionEvidence === undefined ? null : (
        <ul className="matt-work-evidence">
          {item.completionEvidence.map((evidence) => (
            <li key={`${item.reference}:${evidence}`}>{evidence}</li>
          ))}
        </ul>
      )}
      {item.diagnosticMessages === undefined ? null : (
        <div className="matt-work-diagnostic" role="status">
          <p>Needs attention: {item.diagnosticMessages.join(" ")}</p>
          <details>
            <summary>Protocol detail</summary>
            <code>{item.diagnosticCodes?.join(", ")}</code>
          </details>
        </div>
      )}
    </li>
  );
}

function WorkRegionItems({
  entryId,
  items,
  onNavigate,
}: {
  readonly entryId: string;
  readonly items: readonly MattNativeWorkRegionItem[];
  readonly onNavigate: Navigate;
}) {
  return (
    <ul className="matt-work-items">
      {items.map((item) => (
        <WorkRegionItem
          entryId={entryId}
          item={item}
          key={item.reference}
          onNavigate={onNavigate}
        />
      ))}
    </ul>
  );
}

function MapChapter({
  chapter,
  entryId,
  onNavigate,
}: {
  readonly chapter: MattNativeWorkRegionMapChapter;
  readonly entryId: string;
  readonly onNavigate: Navigate;
}) {
  if (chapter.availability !== "available") {
    return (
      <section className="matt-work-role role-unavailable">
        <h3>Map</h3>
        <p>Map role {chapter.availability} in the selected provider observation.</p>
      </section>
    );
  }
  const mapHref = workRegionSubjectHref(entryId, chapter.reference);
  const previewGroups = [
    ["Fog", chapter.previews.fog],
    ["Decisions", chapter.previews.decisions],
    ["Out of scope", chapter.previews.outOfScope],
  ] as const;
  const destination =
    chapter.destination.availability === "available"
      ? chapter.destination.value
      : chapter.destination.availability === "confirmed-empty"
        ? "Destination is confirmed empty in the selected provider observation."
        : chapter.destination.availability === "unsupported"
          ? "Destination is unsupported by this provider version."
          : "Destination is unavailable in the selected provider observation.";
  return (
    <section className="matt-map-chapter" aria-labelledby="matt-map-chapter-title">
      <p className="eyebrow">Map chapter</p>
      <h3 id="matt-map-chapter-title">
        <a href={mapHref} onClick={(event) => follow(mapHref, event, onNavigate)}>
          {chapter.title}
        </a>
      </h3>
      <p data-semantic-availability={chapter.destination.availability}>{destination}</p>
      <dl>
        <div>
          <dt>Lifecycle</dt>
          <dd>{chapter.lifecycle}</dd>
        </div>
        <div>
          <dt>Fog</dt>
          <dd>
            <strong>{workRegionCountLabel(chapter.totals.fog)}</strong>
          </dd>
        </div>
        <div>
          <dt>Decisions</dt>
          <dd>
            <strong>{workRegionCountLabel(chapter.totals.decisions)}</strong>
          </dd>
        </div>
        <div>
          <dt>Out of scope</dt>
          <dd>
            <strong>{workRegionCountLabel(chapter.totals.outOfScope)}</strong>
          </dd>
        </div>
      </dl>
      <div className="matt-map-previews">
        {previewGroups.map(([label, previews]) =>
          previews.length === 0 ? null : (
            <section key={label}>
              <h4>{label}</h4>
              <ul>
                {previews.map((preview) => {
                  const href = workRegionSubjectHref(
                    entryId,
                    chapter.reference,
                    preview.semanticAnchor,
                  );
                  return (
                    <li key={`${label}:${preview.semanticAnchor}:${preview.label}`}>
                      <a href={href} onClick={(event) => follow(href, event, onNavigate)}>
                        {preview.label}
                      </a>
                    </li>
                  );
                })}
              </ul>
            </section>
          ),
        )}
      </div>
    </section>
  );
}

function WorkRegionRole({
  entryId,
  group,
  onNavigate,
}: {
  readonly entryId: string;
  readonly group: MattNativeWorkRegionRoleGroup;
  readonly onNavigate: Navigate;
}) {
  if (group.availability === "confirmed-empty") return null;
  return (
    <section className={`matt-work-role role-${group.availability}`}>
      <div className="matt-work-role-heading">
        <h4>{group.label}</h4>
        <span>{workRegionCountLabel(group.count)}</span>
      </div>
      {group.availability === "available" ? (
        <WorkRegionItems entryId={entryId} items={group.items} onNavigate={onNavigate} />
      ) : (
        <p>
          This role is {group.availability}; the selected observation cannot establish an empty
          collection.
        </p>
      )}
    </section>
  );
}

function NativeWorkReadingState({ reading }: { readonly reading: MattNativeWorkReadingState }) {
  const whyFacts = [
    ["Freshness", reading.why.freshness],
    ["Coverage", reading.why.coverage],
    ["Projection State", reading.why.projectionState],
    ["Provider Completion", reading.why.completion],
    ["Blocking diagnostics", String(reading.why.blockingDiagnosticCount)],
  ] as const;
  return (
    <section
      className={`matt-reading-state state-${reading.conclusion.toLowerCase().replaceAll(" ", "-").replaceAll("'", "")}`}
      aria-labelledby="matt-reading-state-title"
    >
      <p className="eyebrow">Native Work Reading State</p>
      <h3 id="matt-reading-state-title">{reading.conclusion}</h3>
      <p>{reading.impact}</p>
      <p>
        <strong>Available action:</strong> {reading.action}
      </p>
      <details>
        <summary>Why this state?</summary>
        <dl>
          {whyFacts.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
        {reading.why.causes.length === 0 ? (
          <p>All current trust requirements for this conclusion are satisfied.</p>
        ) : (
          <ul>
            {reading.why.causes.map((cause) => (
              <li key={cause}>{cause}</li>
            ))}
          </ul>
        )}
      </details>
      <details>
        <summary>Observation details</summary>
        <dl>
          <div>
            <dt>Source revision</dt>
            <dd>
              {reading.observation.sourceRevision.availability === "available"
                ? reading.observation.sourceRevision.value
                : "Unavailable"}
            </dd>
          </div>
          <div>
            <dt>Provider Observation Time</dt>
            <dd>
              {reading.observation.observedAt.availability === "available"
                ? reading.observation.observedAt.value
                : "Unavailable"}
            </dd>
          </div>
          <div>
            <dt>Source observed at</dt>
            <dd>
              {reading.observation.sourceObservedAt.availability === "available"
                ? reading.observation.sourceObservedAt.value
                : "Unavailable"}
            </dd>
          </div>
        </dl>
        <h4>Coverage dimensions</h4>
        {reading.observation.coverageDimensions.length === 0 ? (
          <p>No coverage dimensions are available.</p>
        ) : (
          <ul>
            {reading.observation.coverageDimensions.map((dimension) => (
              <li key={dimension.key}>
                <strong>{dimension.key}</strong>: {dimension.state}
                {dimension.detail === undefined ? "" : ` · ${dimension.detail}`}
              </li>
            ))}
          </ul>
        )}
        <h4>Validators and provenance</h4>
        <ul>
          {reading.observation.validators.map((validator) => (
            <li key={`validator:${validator.kind}:${validator.value}`}>
              Validator {validator.kind}: {validator.value}
            </li>
          ))}
          {reading.observation.provenance.map((item) => (
            <li key={`provenance:${item.kind}:${item.value}`}>
              {item.kind}: {item.value}
            </li>
          ))}
        </ul>
        <h4>Diagnostics</h4>
        {reading.observation.diagnostics.length === 0 ? (
          <p>No diagnostics are recorded for this observation.</p>
        ) : (
          <ul>
            {reading.observation.diagnostics.map((diagnostic) => (
              <li key={`${diagnostic.origin}:${diagnostic.code}:${diagnostic.target}`}>
                <strong>{diagnostic.message}</strong>
                <span>
                  {diagnostic.origin} · {diagnostic.code} · {diagnostic.impact}
                </span>
              </li>
            ))}
          </ul>
        )}
      </details>
    </section>
  );
}

function MattNativeWorkRegion({
  entryId,
  onNavigate,
  region,
}: {
  readonly entryId: string;
  readonly onNavigate: Navigate;
  readonly region: MattNativeWorkRegionModel;
}) {
  const current = region.views[0];
  const history = region.views[1];
  const all = region.views[2];
  return (
    <section
      className={`matt-work-region context-${region.context.state}`}
      aria-labelledby="matt-work-region-title"
    >
      <header>
        <p className="eyebrow">Matt-native work region</p>
        <h2 id="matt-work-region-title">{region.context.label}</h2>
        {"detail" in region.context ? <p>{region.context.detail}</p> : null}
        <NativeWorkReadingState reading={region.readingState} />
        <p>{workRegionCountLabel(region.total)} observed native subjects.</p>
      </header>
      <nav aria-label="Native Work Frontier views">
        <a href="#native-work-current">Current · {workRegionCountLabel(current.count)}</a>
        <a href="#native-work-history">History · {workRegionCountLabel(history.count)}</a>
        <a href="#native-work-all">All · {workRegionCountLabel(all.count)}</a>
      </nav>
      {region.mapChapter === undefined ? null : (
        <MapChapter chapter={region.mapChapter} entryId={entryId} onNavigate={onNavigate} />
      )}
      <section id="native-work-current" className="matt-work-view">
        <h3>Current</h3>
        {current.items.length === 0 ? (
          <p>No current subjects are established by this observation.</p>
        ) : (
          <WorkRegionItems entryId={entryId} items={current.items} onNavigate={onNavigate} />
        )}
      </section>
      <section id="native-work-history" className="matt-work-view">
        <h3>History</h3>
        {history.items.length === 0 ? (
          <p>No historical subjects are established by this observation.</p>
        ) : (
          <WorkRegionItems entryId={entryId} items={history.items} onNavigate={onNavigate} />
        )}
      </section>
      <section id="native-work-all" className="matt-work-view">
        <h3>All</h3>
        <div className="matt-work-role-groups">
          {all.groups.map((group) => (
            <WorkRegionRole
              entryId={entryId}
              group={group}
              key={group.role}
              onNavigate={onNavigate}
            />
          ))}
        </div>
      </section>
      {region.diagnostics.length === 0 ? null : (
        <section className="matt-work-diagnostics" aria-labelledby="matt-work-diagnostics-title">
          <h3 id="matt-work-diagnostics-title">Native work attention</h3>
          <ul>
            {region.diagnostics.map((diagnostic) => (
              <li key={`${diagnostic.code}:${diagnostic.target}`}>
                <strong>{diagnostic.code}</strong>
                <span>{diagnostic.message}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </section>
  );
}

function ScopedUnavailable({
  entryId,
  kind,
  reason,
  title,
}: {
  readonly entryId: string;
  readonly kind: string;
  readonly reason: string;
  readonly title: string;
}) {
  return (
    <div className="page lineage-page scoped-state">
      <p className="eyebrow">{subjectLabel(kind)} detail</p>
      <h1>{title}</h1>
      <p>{reason}</p>
      <a className="action action-quiet" href={`/projects/${encodeURIComponent(entryId)}`}>
        Return to project Overview
      </a>
    </div>
  );
}

function FilteredRelationView({
  filter,
  onInspect,
  onNavigate,
  ownerHref,
  ownerTitle,
  relation,
}: {
  readonly filter: "all" | "available" | "unavailable";
  readonly onInspect: Inspect;
  readonly onNavigate: Navigate;
  readonly ownerHref: string;
  readonly ownerTitle: string;
  readonly relation: PlanningLineageRelation;
}) {
  if (relation.state !== "present") {
    return (
      <div className="page lineage-page scoped-state">
        <p className="eyebrow">Filtered relation view</p>
        <h1>{relation.label} unavailable</h1>
        <p>{relation.state === "confirmed-none" ? relation.reason : relation.reason}</p>
        <a href={ownerHref} onClick={(event) => follow(ownerHref, event, onNavigate)}>
          Return to {ownerTitle}
        </a>
      </div>
    );
  }
  const items = relation.allItems.filter(
    (item) => filter === "all" || item.availability === filter,
  );
  return (
    <div className="page lineage-page lineage-filtered-view">
      <a
        className="back-link"
        href={ownerHref}
        onClick={(event) => follow(ownerHref, event, onNavigate)}
      >
        <Icons.back /> {ownerTitle}
      </a>
      <header className="lineage-header">
        <p className="eyebrow">Filtered relation view</p>
        <h1>{relation.label}</h1>
        <p>Owner · {ownerTitle}</p>
        <p>
          Showing {items.length} of {relation.total.count} · filter {filter} · canonical order
        </p>
      </header>
      <ul className="lineage-filtered-list">
        {items.map((item) => (
          <RelationItem
            focusKeyPrefix={`lineage-filtered:${relation.key}:${item.reference}`}
            item={item}
            key={`${relation.key}:${item.reference}`}
            onInspect={onInspect}
            onNavigate={onNavigate}
          />
        ))}
      </ul>
    </div>
  );
}

export function PlanningLineagePage({
  entryId,
  filteredView,
  onInspect,
  onNavigate,
  requested,
  semanticAnchor,
  snapshot,
}: {
  readonly entryId: string;
  readonly filteredView?: RequestedPlanningLineageFilteredView | undefined;
  readonly onInspect: Inspect;
  readonly onNavigate: Navigate;
  readonly requested: RequestedPlanningLineageSubject;
  readonly semanticAnchor?: string | undefined;
  readonly snapshot: ProjectSnapshot;
}) {
  const anchorProjectionState =
    semanticAnchor === undefined
      ? "not-requested"
      : requested.validity === "invalid"
        ? "invalid-subject"
        : WORK_REGION_VIEW_ANCHORS.has(semanticAnchor) &&
            (requested.value.kind === "effort" || requested.value.kind === "native-scope")
          ? "available"
          : (() => {
              const projection = snapshot.lineage.subjects.find(
                (candidate) =>
                  candidate.identity.kind === requested.value.kind &&
                  candidate.identity.id === requested.value.id,
              );
              if (projection === undefined) return "unavailable-subject";
              const section = projection.semanticSections.find(
                (candidate) => candidate.role === semanticAnchor,
              );
              if (section !== undefined) return section.availability;
              return projection.relations.some(
                (relation) => `relation.${relation.key}` === semanticAnchor,
              )
                ? "available"
                : "unavailable";
            })();
  useEffect(() => {
    if (semanticAnchor === undefined) return;
    const frame = requestAnimationFrame(() => {
      if (
        anchorProjectionState === "invalid-subject" ||
        anchorProjectionState === "unavailable-subject" ||
        anchorProjectionState === "unavailable"
      ) {
        window.scrollTo({ top: 0 });
        return;
      }
      const target = document.getElementById(semanticAnchor);
      if (
        target !== null &&
        target.dataset["semanticAvailability"] !== "unavailable" &&
        target.dataset["semanticAvailability"] !== "unsupported"
      ) {
        target.scrollIntoView({ block: "start" });
        return;
      }
      window.scrollTo({ top: 0 });
    });
    return () => cancelAnimationFrame(frame);
  }, [anchorProjectionState, semanticAnchor]);

  if (requested.validity === "invalid") {
    return (
      <ScopedUnavailable
        entryId={entryId}
        kind={requested.kind}
        reason={`The requested persistent identity (${requested.requestedId}) is invalid.`}
        title={`${subjectLabel(requested.kind)} route unavailable`}
      />
    );
  }
  const model = buildPlanningLineageSubjectModel(snapshot, requested.value, entryId);
  if (model.state === "missing") {
    return (
      <ScopedUnavailable
        entryId={entryId}
        kind={model.requested.kind}
        reason={model.reason}
        title={`${subjectLabel(model.requested.kind)} not found`}
      />
    );
  }
  if (model.state === "unavailable") {
    return (
      <ScopedUnavailable
        entryId={entryId}
        kind={model.requested.kind}
        reason={`${model.reason} ${model.issueCount} source issue${
          model.issueCount === 1 ? "" : "s"
        } are scoped to this projection.`}
        title={`${subjectLabel(model.requested.kind)} unavailable`}
      />
    );
  }
  const ownerHref = planningLineageSubjectHref(entryId, requested.value);
  if (filteredView !== undefined) {
    if (filteredView.validity === "invalid") {
      return (
        <ScopedUnavailable
          entryId={entryId}
          kind={requested.value.kind}
          reason={filteredView.reason}
          title="Filtered view unavailable"
        />
      );
    }
    const relation = planningLineageRelationFor(model, filteredView.relation);
    if (relation === undefined) {
      return (
        <ScopedUnavailable
          entryId={entryId}
          kind={requested.value.kind}
          reason="This relation is not owned by the requested subject."
          title="Filtered view unavailable"
        />
      );
    }
    return (
      <FilteredRelationView
        filter={filteredView.filter}
        onInspect={onInspect}
        onNavigate={onNavigate}
        ownerHref={ownerHref}
        ownerTitle={model.subject.title}
        relation={relation}
      />
    );
  }
  const contextRelations = model.relations.filter((relation) => !relation.inParentPath);
  const eventHistoryAnchor =
    model.subject.kind === "alignment-check" || model.subject.kind === "planning-review"
      ? `${model.subject.kind}.event-time`
      : model.subject.kind === "native-subject"
        ? "native.event-history"
        : `${model.subject.kind}.event-history`;
  const anchorAvailable =
    semanticAnchor === undefined ||
    (model.workRegion !== undefined && WORK_REGION_VIEW_ANCHORS.has(semanticAnchor)) ||
    (model.semanticAvailability.has(semanticAnchor) &&
      model.semanticAvailability.get(semanticAnchor) !== "unavailable" &&
      model.semanticAvailability.get(semanticAnchor) !== "unsupported") ||
    contextRelations.some((relation) => `relation.${relation.key}` === semanticAnchor);
  return (
    <div className="page lineage-page">
      <nav aria-label="Canonical Parent Path" className="lineage-breadcrumb">
        <ol>
          {model.parentPath.map((crumb, index) => (
            <li key={crumb.href ?? `current:${crumb.label}`}>
              {crumb.href === undefined ? (
                <span aria-current={index === model.parentPath.length - 1 ? "page" : undefined}>
                  {crumb.label}
                </span>
              ) : (
                <a
                  href={crumb.href}
                  onClick={(event) => follow(crumb.href ?? "", event, onNavigate)}
                >
                  {crumb.label}
                </a>
              )}
            </li>
          ))}
        </ol>
      </nav>
      {model.parentNotice === undefined ? null : (
        <p className="projection-note" role="status">
          {model.parentNotice}
        </p>
      )}
      {!anchorAvailable ? (
        <p className="projection-note" role="status">
          Requested section unavailable. The subject route remains open at the top.
        </p>
      ) : null}
      <header className="lineage-header">
        <div>
          <p className="eyebrow">{subjectLabel(model.subject.kind)}</p>
          <h1>{model.subject.title}</h1>
          <code className="lineage-id">{model.subject.id}</code>
        </div>
        <dl>
          <div>
            <dt>Projection</dt>
            <dd>{model.state}</dd>
          </div>
          <div>
            <dt>Source</dt>
            <dd>
              {model.subject.sourceHref === undefined ? (
                <code>{model.subject.source?.displayLocator ?? "Unavailable"}</code>
              ) : (
                <a href={model.subject.sourceHref} rel="noreferrer" target="_blank">
                  {model.subject.source?.displayLocator ?? model.subject.sourceHref}
                </a>
              )}
            </dd>
          </div>
        </dl>
      </header>
      {model.events.length === 0 ? null : (
        <section
          className="lineage-event-history"
          data-semantic-availability={
            model.semanticAvailability.get(eventHistoryAnchor) ?? "available"
          }
          id={eventHistoryAnchor}
        >
          <p className="eyebrow">Source-owned chronology</p>
          <h2>Event History</h2>
          <dl>
            {model.events.map((event, index) => (
              <div key={`${event.role}:${event.decisionReference ?? index}`}>
                <dt>{event.label}</dt>
                <dd>
                  <PlanningLineageTimeValue label={event.label} mode="detail" time={event.time} />
                  {event.decisionReference === undefined ? null : (
                    <code>{event.decisionReference}</code>
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      )}
      <div className="lineage-sections">
        {model.sections.map((section) => (
          <section
            data-semantic-availability={model.semanticAvailability.get(section.anchor)}
            id={section.anchor}
            key={section.anchor}
          >
            <h2>{section.title}</h2>
            {section.body === undefined ? null : <p>{section.body}</p>}
            {section.items === undefined ? null : (
              <ul>
                {section.items.map((item) => (
                  <li key={`${section.anchor}:${item}`}>{item}</li>
                ))}
              </ul>
            )}
            {section.links === undefined ? null : (
              <ul className="lineage-section-links">
                {section.links.map((item) => (
                  <li key={`${section.anchor}:${item.href}`}>
                    <a href={item.href} onClick={(event) => follow(item.href, event, onNavigate)}>
                      {item.label}
                    </a>
                    <span> · {item.detail}</span>
                  </li>
                ))}
              </ul>
            )}
            {section.times === undefined || section.times.length === 0 ? null : (
              <TimeFacts facts={section.times} />
            )}
          </section>
        ))}
      </div>
      {model.workRegion === undefined ? null : (
        <MattNativeWorkRegion entryId={entryId} onNavigate={onNavigate} region={model.workRegion} />
      )}
      <section className="lineage-context" aria-labelledby="lineage-context-title">
        <header>
          <p className="eyebrow">Direct typed relations</p>
          <h2 id="lineage-context-title">Lineage Context</h2>
          <p>Relations already used as breadcrumb ancestors are not duplicated here.</p>
        </header>
        <div className="lineage-relation-grid">
          {contextRelations.map((relation) => (
            <RelationCollection
              key={relation.key}
              relation={relation}
              onInspect={onInspect}
              onNavigate={onNavigate}
            />
          ))}
        </div>
      </section>
    </div>
  );
}
