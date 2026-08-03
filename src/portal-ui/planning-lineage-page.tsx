import { type MouseEvent, useEffect, useRef } from "react";
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
import { AssetLocationCopy } from "./asset-location-copy";
import { Icons } from "./icons";
import type {
  PlanningLineageEffortLens,
  PlanningLineageOutcomeSpine,
  PlanningLineageRelation,
  PlanningLineageRelationItem,
  PlanningLineageTimeFact,
} from "./planning-lineage-model";
import {
  buildPlanningLineageSubjectModel,
  planningLineageRelationFor,
} from "./planning-lineage-model";
import { Action } from "./primitives";
import { projectCanvasFocusKey } from "./project-canvas-history";
import { SourceEventTimeValue } from "./source-event-time";
import type { TechnicalDetailsSelection } from "./technical-details";

type Inspect = (selection: TechnicalDetailsSelection, trigger: HTMLButtonElement) => void;
type Navigate = (href: string, focusKey?: string) => void;

const subjectLabel = (kind: string): string =>
  kind
    .split("-")
    .map((word) => `${word[0]?.toUpperCase()}${word.slice(1)}`)
    .join(" ");

const detailObjectType = (kind: string): string | undefined => {
  switch (kind) {
    case "roadmap":
      return "Roadmap";
    case "gate":
      return "Milestone Gate";
    case "effort":
      return "Effort";
    default:
      return undefined;
  }
};

const follow = (href: string, event: MouseEvent<HTMLAnchorElement>, onNavigate: Navigate) => {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
    return;
  event.preventDefault();
  onNavigate(href, projectCanvasFocusKey(event.currentTarget));
};

const technicalDetailsSelection = (
  model: Extract<
    ReturnType<typeof buildPlanningLineageSubjectModel>,
    { state: "available" | "partial" }
  >,
  snapshot: ProjectSnapshot,
): TechnicalDetailsSelection => {
  const source = model.subject.source;
  const diagnostics = snapshot.diagnostics.filter(
    (diagnostic) =>
      diagnostic.target === model.subject.id ||
      diagnostic.target === source?.displayLocator ||
      diagnostic.source === source?.reference,
  );
  const asset =
    model.subject.kind === "asset" && snapshot.assets.validity !== "invalid"
      ? snapshot.assets.items.find((candidate) => candidate.id === model.subject.id)
      : undefined;
  const provenance = [
    `Source kind: ${source?.kind ?? "unavailable"}`,
    ...(source?.binding === undefined
      ? []
      : [`Binding: ${source.binding.role} · ${source.binding.identity}`]),
    ...(source?.fragment === undefined ? [] : [`Fragment: ${source.fragment}`]),
  ];
  return {
    title: model.subject.title,
    facts: [
      { label: "Stable ID", value: model.subject.id, code: true },
      { label: "Projection", value: model.state },
      ...(asset === undefined
        ? []
        : [
            { label: "Location", value: asset.displayLocation, code: true },
            ...(asset.kind === "prototype"
              ? [{ label: "Preview", value: "Not offered for prototype Assets" }]
              : asset.contentShape === "directory"
                ? [{ label: "Preview", value: "Not offered for directory Assets" }]
                : []),
            {
              label: "Producer",
              value: `${asset.producer.kind} / ${asset.producer.name}`,
            },
            ...(asset.producer.reference === undefined
              ? []
              : [{ label: "Producer reference", value: asset.producer.reference, code: true }]),
          ]),
    ],
    source,
    sourceHref: model.subject.sourceHref,
    sections: [
      { title: "Provenance", items: provenance },
      {
        title: "Diagnostics",
        items:
          diagnostics.length === 0
            ? ["No diagnostics are recorded for this subject."]
            : diagnostics.map(
                (diagnostic) => `${diagnostic.impact} · ${diagnostic.code} · ${diagnostic.message}`,
              ),
      },
    ],
  };
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

const relationStateLabel = (relation: PlanningLineageRelation): string | undefined => {
  switch (relation.state) {
    case "present":
      if (relation.total.count < 4) return undefined;
      return relation.total.coverage === "complete"
        ? String(relation.total.count)
        : `${relation.total.count}+`;
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
  onNavigate,
  role,
}: {
  readonly focusKeyPrefix: string;
  readonly item: PlanningLineageRelationItem;
  readonly onNavigate: Navigate;
  readonly role: string;
}) {
  const title = item.availability === "available" ? item.label : "Related object unavailable";
  const state = item.availability === "available" ? item.event?.label : undefined;
  const content = (
    <>
      <strong>{title}</strong>
      <small>
        {role}
        {state === undefined ? null : ` · ${state}`}
        {item.availability === "available" ? null : " · Target unavailable"}
      </small>
    </>
  );
  return (
    <li className="lineage-relation-item">
      {item.href === undefined ? (
        <span className="lineage-relation-unavailable">{content}</span>
      ) : (
        <a
          className="lineage-relation-link"
          data-bearing-focus-key={`${focusKeyPrefix}:primary`}
          href={item.href}
          onClick={(event) => follow(item.href ?? "", event, onNavigate)}
        >
          {content}
        </a>
      )}
    </li>
  );
}

function RelationCollection({
  relation,
  onNavigate,
}: {
  readonly relation: PlanningLineageRelation;
  readonly onNavigate: Navigate;
}) {
  const stateLabel = relationStateLabel(relation);
  return (
    <section
      className={`lineage-relation relation-${relation.state}`}
      id={`relation.${relation.key}`}
    >
      <div className="lineage-relation-heading">
        <h3>{relation.label}</h3>
        {stateLabel === undefined ? null : <span>{stateLabel}</span>}
      </div>
      {relation.state === "present" ? (
        <>
          <ul>
            {relation.items.map((item) => (
              <RelationItem
                focusKeyPrefix={`lineage:${relation.key}:${item.reference}`}
                item={item}
                key={`${relation.key}:${item.reference}`}
                onNavigate={onNavigate}
                role={relation.direction}
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
      ) : relation.state === "confirmed-none" ? null : (
        <p>{relation.reason}</p>
      )}
    </section>
  );
}

function OutcomeSpine({
  onNavigate,
  spine,
}: {
  readonly onNavigate: Navigate;
  readonly spine: PlanningLineageOutcomeSpine;
}) {
  return (
    <section
      aria-labelledby="outcome-spine-title"
      className="outcome-spine"
      data-gate-count={spine.gates.length}
      data-layout={spine.layout}
      id="roadmap.gates"
    >
      <header>
        <h2 id="outcome-spine-title">Outcome Spine</h2>
        <p>Ordered Gates and their complete governed Efforts.</p>
      </header>
      <ol className="outcome-spine-list">
        {spine.gates.map((gate) => (
          <li className={`outcome-spine-gate${gate.focused ? " is-focused" : ""}`} key={gate.id}>
            <div className="outcome-spine-gate-heading">
              <span>G{gate.ordinal}</span>
              {gate.href === undefined ? (
                <strong>{gate.title}</strong>
              ) : (
                <a href={gate.href} onClick={(event) => follow(gate.href ?? "", event, onNavigate)}>
                  {gate.title}
                </a>
              )}
              <small>{gate.focused ? "Current" : (gate.lifecycle ?? "Unavailable")}</small>
            </div>
            {gate.efforts.length === 0 ? (
              <p>No governed Efforts.</p>
            ) : (
              <ul>
                {gate.efforts.map((effort) => (
                  <li key={effort.id}>
                    {effort.href === undefined ? (
                      <span>{effort.title}</span>
                    ) : (
                      <a
                        href={effort.href}
                        onClick={(event) => follow(effort.href ?? "", event, onNavigate)}
                      >
                        {effort.title}
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

function EffortStatusGroup({
  lens,
  onNavigate,
}: {
  readonly lens: PlanningLineageEffortLens;
  readonly onNavigate: Navigate;
}) {
  return (
    <dl className="effort-status-group">
      <div>
        <dt>Effort lifecycle</dt>
        <dd>{humanizeWorkState(lens.lifecycle)}</dd>
      </div>
      <div>
        <dt>Contributes to</dt>
        <dd>
          {lens.targetGate.href === undefined ? (
            lens.targetGate.title
          ) : (
            <a
              href={lens.targetGate.href}
              onClick={(event) => follow(lens.targetGate.href ?? "", event, onNavigate)}
            >
              {lens.targetGate.title}
            </a>
          )}
        </dd>
      </div>
      <div>
        <dt>Managed Work</dt>
        <dd data-health={lens.managedWorkHealth.toLowerCase().replaceAll(" ", "-")}>
          {lens.managedWorkHealth}
        </dd>
      </div>
    </dl>
  );
}

function EffortGovernanceLens({
  lens,
  onNavigate,
}: {
  readonly lens: PlanningLineageEffortLens;
  readonly onNavigate: Navigate;
}) {
  const currentWork = lens.currentWork;
  return (
    <div className="effort-governance-lens">
      <section id="effort.intent">
        <h2>Intent</h2>
        <p>{lens.intent}</p>
      </section>
      {lens.outcome === undefined ? null : (
        <section id="effort.outcome">
          <h2>Outcome</h2>
          <dl className="effort-outcome-facts">
            <div>
              <dt>Disposition</dt>
              <dd>{humanizeWorkState(lens.outcome.disposition)}</dd>
            </div>
            {lens.outcome.concludedAt.availability !== "available" ? null : (
              <div>
                <dt>Concluded</dt>
                <dd>
                  <PlanningLineageTimeValue
                    label="Concluded"
                    mode="detail"
                    time={lens.outcome.concludedAt}
                  />
                </dd>
              </div>
            )}
          </dl>
          <p>{lens.outcome.rationale}</p>
          {lens.outcome.replacementEffort === undefined ? null : (
            <p>
              Replacement Effort:{" "}
              {lens.outcome.replacementEffort.href === undefined ? (
                lens.outcome.replacementEffort.title
              ) : (
                <a
                  href={lens.outcome.replacementEffort.href}
                  onClick={(event) =>
                    follow(lens.outcome?.replacementEffort?.href ?? "", event, onNavigate)
                  }
                >
                  {lens.outcome.replacementEffort.title}
                </a>
              )}
            </p>
          )}
        </section>
      )}
      {currentWork === undefined ? null : (
        <section id="native-work-current">
          <div className="effort-current-work-heading">
            <h2>Current Work</h2>
            {currentWork.state === "available" ? (
              <a
                className="action-quiet"
                href={currentWork.historyHref}
                onClick={(event) => follow(currentWork.historyHref, event, onNavigate)}
              >
                Full work history
              </a>
            ) : null}
          </div>
          {currentWork.state === "unavailable" ? (
            <p className="effort-current-work-unavailable">
              Managed work needs attention. Cause: {currentWork.cause} Impact: {currentWork.impact}{" "}
              Recovery: {currentWork.recovery}
            </p>
          ) : (
            <>
              {currentWork.consistencyWarning === undefined ? null : (
                <p className="effort-consistency-warning" role="status">
                  {currentWork.consistencyWarning}
                </p>
              )}
              {currentWork.items.length === 0 ? (
                <p>No nonterminal managed work is established by this observation.</p>
              ) : (
                <ul className="effort-current-work-list">
                  {currentWork.items.map((item) => (
                    <li key={item.reference}>
                      <div>
                        <a
                          href={item.href}
                          onClick={(event) => follow(item.href, event, onNavigate)}
                        >
                          {item.title}
                        </a>
                        <span data-work-status={item.status.toLowerCase().replaceAll(" ", "-")}>
                          {item.status}
                        </span>
                      </div>
                      {item.blockerImpact === undefined ? null : <p>{item.blockerImpact}</p>}
                      {item.attention === undefined ? null : (
                        <p className="effort-work-attention">Needs attention: {item.attention}</p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </section>
      )}
      {lens.planningBasis === undefined ? null : (
        <section id="effort.planning-basis">
          <h2>Planning Basis</h2>
          {lens.planningBasis.state === "attention" ? (
            <p className="effort-basis-attention" role="status">
              {lens.planningBasis.diagnostic.message}
            </p>
          ) : (
            <ul className="effort-basis-list">
              {lens.planningBasis.items.map((item) => (
                <li key={item.role}>
                  <span>{item.role}</span>
                  <a href={item.href} onClick={(event) => follow(item.href, event, onNavigate)}>
                    {item.title}
                  </a>
                  <small>{humanizeWorkState(item.lifecycle)}</small>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      {lens.outputs === undefined ? null : (
        <section id="effort.outputs">
          <h2>Outputs</h2>
          {lens.outputs.state === "unavailable" ? (
            <p>{lens.outputs.reason}</p>
          ) : (
            <ul className="effort-output-list">
              {lens.outputs.items.map((item) => (
                <li data-superseded={item.superseded || undefined} key={item.id}>
                  <div>
                    <span>{item.kind}</span>
                    <a href={item.href} onClick={(event) => follow(item.href, event, onNavigate)}>
                      {item.title}
                    </a>
                    <small>{humanizeWorkState(item.lifecycle)}</small>
                  </div>
                  {item.times.length === 0 ? null : <TimeFacts facts={item.times} />}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      {lens.governance === undefined ? null : (
        <section id="effort.governance">
          <h2>Governance &amp; References</h2>
          <div className="effort-governance-grid">
            {lens.governance.authorities.length === 0 ? null : (
              <section>
                <h3>Authorities</h3>
                <ul>
                  {lens.governance.authorities.map((authority) => (
                    <li key={authority.title}>
                      {authority.href === undefined ? (
                        authority.title
                      ) : (
                        <a
                          href={authority.href}
                          onClick={(event) => follow(authority.href ?? "", event, onNavigate)}
                        >
                          {authority.title}
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {lens.governance.citations.length === 0 ? null : (
              <section>
                <h3>Planning Citations</h3>
                <ul>
                  {lens.governance.citations.map((citation) => (
                    <li key={`${citation.title}:${citation.note}`}>
                      {citation.href === undefined ? (
                        citation.title
                      ) : (
                        <a
                          href={citation.href}
                          onClick={(event) => follow(citation.href ?? "", event, onNavigate)}
                        >
                          {citation.title}
                        </a>
                      )}
                      <p>{citation.note}</p>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        </section>
      )}
    </div>
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
  onNavigate,
  ownerHref,
  ownerTitle,
  relation,
}: {
  readonly filter: "all" | "available" | "unavailable";
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
            onNavigate={onNavigate}
            role={relation.direction}
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
  onRefreshDetails,
  requested,
  semanticAnchor,
  snapshot,
  inspectionOperation,
}: {
  readonly entryId: string;
  readonly filteredView?: RequestedPlanningLineageFilteredView | undefined;
  readonly onInspect: Inspect;
  readonly onNavigate: Navigate;
  readonly onRefreshDetails?: (
    subject: Readonly<{ kind: "native-scope" | "native-subject"; id: string }>,
  ) => void;
  readonly requested: RequestedPlanningLineageSubject;
  readonly semanticAnchor?: string | undefined;
  readonly snapshot: ProjectSnapshot;
  readonly inspectionOperation?: Readonly<{
    state: "idle" | "running" | "failed";
    subjectKey?: string | undefined;
  }>;
}) {
  const refreshWorkDetailsRef = useRef<HTMLButtonElement>(null);
  const priorInspectionStateRef = useRef(inspectionOperation?.state);
  useEffect(() => {
    if (priorInspectionStateRef.current === "running" && inspectionOperation?.state !== "running") {
      refreshWorkDetailsRef.current?.focus();
    }
    priorInspectionStateRef.current = inspectionOperation?.state;
  }, [inspectionOperation?.state]);
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
  const effortObservation = model.effortLens?.managedWorkObservation;
  const refreshEffortWorkDetails = () => {
    if (effortObservation?.refreshTarget !== undefined) {
      onRefreshDetails?.(effortObservation.refreshTarget);
    }
  };
  const requestedNativeSubject =
    requested.value.kind === "native-scope" || requested.value.kind === "native-subject"
      ? requested.value
      : undefined;
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
        onNavigate={onNavigate}
        ownerHref={ownerHref}
        ownerTitle={model.subject.title}
        relation={relation}
      />
    );
  }
  const contentOwnedRelationKeys =
    model.subject.kind === "roadmap"
      ? new Set(["outcome.ordered-gates", "outcome.contributing-efforts"])
      : model.subject.kind === "gate"
        ? new Set(["outcome.contributing-efforts"])
        : model.subject.kind === "effort"
          ? new Set([
              "native-work.binding",
              "governance.authorities",
              "planning-use.citations",
              "production.owned-assets",
            ])
          : new Set<string>();
  const contextRelations = model.relations.filter(
    (relation) =>
      !relation.inParentPath &&
      !contentOwnedRelationKeys.has(relation.key) &&
      !(model.subject.kind === "roadmap" && relation.state === "confirmed-none"),
  );
  const availableEvents =
    model.subject.kind === "effort"
      ? []
      : model.events.filter((event) => event.time.availability === "available");
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
  const objectType = detailObjectType(model.subject.kind);
  return (
    <div className="page lineage-page">
      <nav aria-label="Canonical Parent Path" className="lineage-breadcrumb">
        <ol>
          {model.parentPath.map((crumb) => (
            <li key={crumb.href}>
              <a href={crumb.href} onClick={(event) => follow(crumb.href, event, onNavigate)}>
                {crumb.label}
              </a>
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
      <header
        className="lineage-header"
        {...(objectType === undefined ? {} : { "data-object-kind": model.subject.kind })}
      >
        <div className="lineage-identity">
          {objectType === undefined ? null : (
            <span className="lineage-object-type">{objectType}</span>
          )}
          <h1>{model.subject.title}</h1>
          {model.effortLens === undefined ? null : (
            <EffortStatusGroup lens={model.effortLens} onNavigate={onNavigate} />
          )}
        </div>
        <button
          aria-label="Open Technical Details"
          className="technical-details-trigger"
          type="button"
          onClick={(event) =>
            onInspect(technicalDetailsSelection(model, snapshot), event.currentTarget)
          }
        >
          Technical Details
        </button>
      </header>
      {effortObservation === undefined ? null : (
        <div className="effort-observation-recovery" role="status">
          <div>
            <p>{effortObservation.indication}</p>
            {inspectionOperation?.state === "failed" ||
            effortObservation.latestRefreshFailed === true ? (
              <p>Latest refresh failed; retained verified work remains visible.</p>
            ) : null}
            {inspectionOperation?.state !== "failed" &&
            effortObservation.latestRefreshSucceeded === true ? (
              <p>
                Work details refreshed for the bound scope; canonical Managed Work authority remains
                degraded.
              </p>
            ) : null}
            {effortObservation.lastVerified === undefined ? null : (
              <dl>
                <div>
                  <dt>Last verified</dt>
                  <dd>{effortObservation.lastVerified}</dd>
                </div>
              </dl>
            )}
          </div>
          {onRefreshDetails === undefined ||
          effortObservation.refreshTarget === undefined ? null : (
            <Action
              ref={refreshWorkDetailsRef}
              disabled={inspectionOperation?.state === "running"}
              onClick={refreshEffortWorkDetails}
            >
              <Icons.refresh
                className={inspectionOperation?.state === "running" ? "is-spinning" : ""}
              />
              {inspectionOperation?.state === "running"
                ? "Refreshing work details"
                : "Refresh work details"}
            </Action>
          )}
        </div>
      )}
      {model.nativeInspection === undefined ||
      onRefreshDetails === undefined ||
      requestedNativeSubject === undefined ? null : (
        <div className="native-inspection-actions">
          <p>
            Inspected detail · {model.nativeInspection.freshness}
            {model.nativeInspection.latestAttempt?.outcome === "failed"
              ? " · latest refresh failed"
              : ""}
          </p>
          <Action
            disabled={inspectionOperation?.state === "running"}
            onClick={() => onRefreshDetails(requestedNativeSubject)}
          >
            <Icons.refresh
              className={inspectionOperation?.state === "running" ? "is-spinning" : ""}
            />
            {inspectionOperation?.state === "running" ? "Refreshing details" : "Refresh details"}
          </Action>
        </div>
      )}
      {availableEvents.length === 0 ? null : (
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
            {availableEvents.map((event, index) => (
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
      {model.outcomeSpine === undefined ? null : (
        <OutcomeSpine onNavigate={onNavigate} spine={model.outcomeSpine} />
      )}
      {model.effortLens === undefined ? null : (
        <EffortGovernanceLens lens={model.effortLens} onNavigate={onNavigate} />
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
            {section.copy === undefined ? null : (
              <AssetLocationCopy label={section.copy.label} value={section.copy.value} />
            )}
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
                    {item.external ? (
                      <a href={item.href} rel="noopener noreferrer" target="_blank">
                        {item.label}
                      </a>
                    ) : (
                      <a href={item.href} onClick={(event) => follow(item.href, event, onNavigate)}>
                        {item.label}
                      </a>
                    )}
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
      {model.workRegion === undefined || model.subject.kind === "effort" ? null : (
        <MattNativeWorkRegion entryId={entryId} onNavigate={onNavigate} region={model.workRegion} />
      )}
      {contextRelations.length === 0 ? null : (
        <section className="lineage-context" aria-labelledby="lineage-context-title">
          <header>
            <h2 id="lineage-context-title">Lineage Context</h2>
          </header>
          <div className="lineage-relation-grid">
            {contextRelations.map((relation) => (
              <RelationCollection key={relation.key} relation={relation} onNavigate={onNavigate} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
