import { type MouseEvent, type RefObject, useEffect, useId } from "react";
import type {
  RequestedPlanningLineageFilteredView,
  RequestedPlanningLineageSubject,
} from "../planning-lineage-route";
import { planningLineageSubjectHref } from "../planning-lineage-route";
import type { MattSemanticSectionAvailability } from "../providers/matt-skills-v1/model";
import type {
  MattNativeWorkRegionCount,
  MattNativeWorkRegionItem,
  MattNativeWorkRegionMapChapter,
  MattNativeWorkRegionModel,
  MattNativeWorkRegionRoleGroup,
} from "../providers/matt-skills-v1/work-region";
import { assertNever } from "./assert-never";
import { AssetLocationCopy } from "./asset-location-copy";
import { Icons } from "./icons";
import type { PlanningLineageEventTime } from "./planning-lineage-events";
import type {
  PlanningLineageEffortLens,
  PlanningLineageEffortRollupRow,
  PlanningLineageOutcomeSpine,
  PlanningLineageRelation,
  PlanningLineageRelationItem,
  PlanningLineageSection,
  PlanningLineageSectionContent,
  PlanningLineageStatusTag,
  PlanningLineageTimeFact,
} from "./planning-lineage-model";
import {
  buildPlanningLineageSubjectModel,
  planningLineageRelationFor,
} from "./planning-lineage-model";
import { Action } from "./primitives";
import { projectCanvasFocusKey } from "./project-canvas-history";
import type { LineageModelData } from "./project-data";
import {
  type ProviderObservationApplication,
  ProviderObservationStatus,
} from "./provider-observation-status";
import { ProviderObservationTime } from "./provider-observation-time";
import { ReadDisclosure } from "./read-disclosure";
import { SanitizedMarkdownContent } from "./sanitized-markdown";
import { SourceEventTimeValue } from "./source-event-time";
import type { TechnicalDetailsSelection } from "./technical-details";

type Inspect = (selection: TechnicalDetailsSelection, trigger: HTMLButtonElement) => void;
type Navigate = (href: string, focusKey?: string) => void;

function HeaderStatusTag({ status }: { readonly status: PlanningLineageStatusTag }) {
  const descriptionId = useId();
  return (
    <>
      <button
        aria-describedby={descriptionId}
        className="lineage-status-tag"
        data-status-token={status.token}
        data-status-tone={status.tone}
        data-tooltip={status.tooltip}
        {...(status.diagnostic === undefined
          ? {}
          : { "data-diagnostic-code": status.diagnostic.code })}
        type="button"
      >
        <span className="lineage-status-pill">{status.label}</span>
      </button>
      <span className="sr-only" id={descriptionId}>
        {status.tooltip}
      </span>
    </>
  );
}

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
    case "native-scope":
      return "Native Scope";
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
  snapshot: LineageModelData,
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
  const workHistoryReading =
    model.subject.kind === "native-scope" ? model.workRegion?.readingState : undefined;
  const observationProvenance =
    workHistoryReading === undefined
      ? []
      : [
          `Source revision: ${
            workHistoryReading.observation.sourceRevision.availability === "available"
              ? workHistoryReading.observation.sourceRevision.value
              : "Unavailable"
          }`,
          `Provider Observation Time: ${
            workHistoryReading.observation.observedAt.availability === "available"
              ? workHistoryReading.observation.observedAt.value
              : "Unavailable"
          }`,
          `Source observed at: ${
            workHistoryReading.observation.sourceObservedAt.availability === "available"
              ? workHistoryReading.observation.sourceObservedAt.value
              : "Unavailable"
          }`,
          ...workHistoryReading.observation.coverageDimensions.map(
            (dimension) =>
              `Coverage ${dimension.key}: ${dimension.state}${
                dimension.detail === undefined ? "" : ` · ${dimension.detail}`
              }`,
          ),
          ...workHistoryReading.observation.validators.map(
            (validator) => `Validator ${validator.kind}: ${validator.value}`,
          ),
          ...workHistoryReading.observation.provenance.map((item) => `${item.kind}: ${item.value}`),
        ];
  const sourceEventTimeProvenance = model.events.flatMap((event) =>
    event.time.availability !== "available"
      ? []
      : [
          `${event.label}: ${event.time.value} · Basis ${
            "basis" in event.time ? event.time.basis : "source-event"
          } · Precision ${event.time.precision} · Role ${event.role}${
            event.decisionReference === undefined ? "" : ` · Decision ${event.decisionReference}`
          }`,
        ],
  );
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
      ...(workHistoryReading === undefined
        ? []
        : [
            { label: "Provider", value: "matt-skills/v1" },
            { label: "Native scope", value: model.subject.id, code: true },
            { label: "Provider projection", value: workHistoryReading.why.projectionState },
            { label: "Freshness", value: workHistoryReading.why.freshness },
            { label: "Coverage", value: workHistoryReading.why.coverage },
            {
              label: "Evidence trust",
              value: workHistoryReading.why.causes.length === 0 ? "Trustworthy" : "Withheld",
            },
            { label: "Provider completion", value: workHistoryReading.why.completion },
          ]),
      ...(asset === undefined
        ? []
        : [
            { label: "Source", value: asset.sourceLocator, code: true },
            { label: "Disposition", value: asset.disposition },
            ...(asset.origin === undefined
              ? []
              : [{ label: "Origin", value: asset.origin, code: true }]),
          ]),
    ],
    source,
    sourceHref: model.subject.sourceHref,
    sections: [
      ...(sourceEventTimeProvenance.length === 0
        ? []
        : [{ title: "Time provenance", items: sourceEventTimeProvenance }]),
      ...(observationProvenance.length === 0
        ? []
        : [{ title: "Observation provenance", items: observationProvenance }]),
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
  readonly time: PlanningLineageEventTime;
}) {
  return time.availability === "unsupported" ? (
    <span className="source-event-time unsupported">Time unsupported</span>
  ) : (
    <SourceEventTimeValue label={label} mode={mode} time={time} />
  );
}

function TimeFacts({ facts }: { readonly facts: readonly PlanningLineageTimeFact[] }) {
  return (
    <dl className="lineage-compact-facts lineage-time-facts">
      {facts.map((fact) => (
        <div key={fact.key}>
          <dt>{fact.label}</dt>
          <dd>
            <PlanningLineageTimeValue
              label={fact.label}
              mode={fact.mode ?? "detail"}
              time={fact.time}
            />
            {fact.mode === "compact" || fact.detail === undefined ? null : (
              <small>{fact.detail}</small>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function EffortRollupTable({
  onNavigate,
  rows,
}: {
  readonly onNavigate: Navigate;
  readonly rows: readonly PlanningLineageEffortRollupRow[];
}) {
  return (
    <table className="effort-rollup-table">
      <caption className="sr-only">Contributing Effort lifecycle and native work counts</caption>
      <thead>
        <tr>
          <th scope="col">Effort</th>
          <th scope="col">Lifecycle</th>
          <th scope="col">Claimed</th>
          <th scope="col">Ready</th>
          <th scope="col">Blocked</th>
          <th scope="col">Resolved</th>
          <th scope="col">Lifecycle time</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id}>
            <th data-label="Effort" scope="row">
              {row.href === undefined ? (
                row.title
              ) : (
                <a href={row.href} onClick={(event) => follow(row.href ?? "", event, onNavigate)}>
                  {row.title}
                </a>
              )}
            </th>
            <td data-label="Lifecycle">
              {row.lifecycle === undefined ? "Unavailable" : humanizeWorkState(row.lifecycle)}
            </td>
            <td data-label="Claimed">{workRegionTableCountLabel(row.counts.claimed)}</td>
            <td data-label="Ready">{workRegionTableCountLabel(row.counts.ready)}</td>
            <td data-label="Blocked">{workRegionTableCountLabel(row.counts.blocked)}</td>
            <td data-label="Resolved">{workRegionTableCountLabel(row.counts.resolved)}</td>
            <td data-label="Lifecycle time">
              {row.lifecycleTime?.time.availability === "available" ? (
                <PlanningLineageTimeValue
                  label={row.lifecycleTime.label}
                  mode="compact"
                  time={row.lifecycleTime.time}
                />
              ) : (
                "Unavailable"
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function LineageSectionContent({
  anchor,
  content,
  onNavigate,
  sectionTitle,
}: {
  readonly anchor: string;
  readonly content: PlanningLineageSectionContent;
  readonly onNavigate: Navigate;
  readonly sectionTitle: string;
}) {
  switch (content.kind) {
    case "plain-prose":
      return (
        <ReadDisclosure label={sectionTitle}>
          <p>{content.value}</p>
        </ReadDisclosure>
      );
    case "provider-document": {
      const { document } = content;
      return (
        <article className="lineage-provider-document">
          {document.sections.map((section) => (
            <div
              data-provider-semantic-section-version={section.version}
              key={`${document.key}:${section.sourceIdentity}`}
            >
              {document.showSectionTitles ? <h3>{section.title}</h3> : null}
              {section.availability === "available" ? (
                "html" in section ? (
                  <SanitizedMarkdownContent
                    html={section.html}
                    label={section.title}
                    presentation={section.presentation}
                  />
                ) : (
                  <ReadDisclosure label={section.title}>
                    <div className="markdown-formatting-fallback">
                      <p>Formatting is unavailable for this section.</p>
                      <pre>{section.markdown}</pre>
                    </div>
                  </ReadDisclosure>
                )
              ) : section.availability === "confirmed-empty" ? (
                <p>No {section.title.toLocaleLowerCase()} content is recorded.</p>
              ) : section.availability === "unsupported" ? (
                <p>This provider document section is unsupported.</p>
              ) : (
                <p>This provider document section is unavailable.</p>
              )}
            </div>
          ))}
          {document.provenance.facts.length === 0 ? null : (
            <dl className="lineage-compact-facts lineage-section-facts">
              {document.provenance.facts.map((fact) => (
                <div key={`${document.key}:${fact.key}`}>
                  <dt>{fact.label}</dt>
                  <dd>{fact.value}</dd>
                </div>
              ))}
            </dl>
          )}
          {document.provenance.times.length === 0 ? null : (
            <TimeFacts facts={document.provenance.times} />
          )}
        </article>
      );
    }
    case "fact-list":
      return content.style === "definitions" ? (
        <dl className="lineage-compact-facts lineage-section-facts">
          {content.facts.map((fact) => (
            <div key={`${anchor}:${fact.key}`}>
              <dt>{fact.label}</dt>
              <dd>{fact.value}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <ReadDisclosure label={sectionTitle}>
          <ul>
            {content.values.map((value) => (
              <li key={`${anchor}:${value}`}>{value}</li>
            ))}
          </ul>
        </ReadDisclosure>
      );
    case "relation-list":
      return (
        <ul className="lineage-section-links">
          {content.relations.map((relation) => (
            <li
              data-availability={relation.availability ?? "available"}
              key={`${anchor}:${relation.href ?? relation.label}`}
            >
              {relation.prefix}
              {relation.href === undefined ? (
                <span>{relation.label}</span>
              ) : relation.external ? (
                <a href={relation.href} rel="noopener noreferrer" target="_blank">
                  {relation.label}
                </a>
              ) : (
                <a
                  href={relation.href}
                  onClick={(event) => follow(relation.href ?? "", event, onNavigate)}
                >
                  {relation.label}
                </a>
              )}
              {relation.detail === undefined ? null : <span> · {relation.detail}</span>}
            </li>
          ))}
        </ul>
      );
    case "time-facts":
      return <TimeFacts facts={content.facts} />;
    case "actions":
      return content.actions.map((action) => (
        <AssetLocationCopy
          key={`${anchor}:${action.label}`}
          label={action.label}
          value={action.value}
        />
      ));
    case "effort-rollup":
      return <EffortRollupTable onNavigate={onNavigate} rows={content.rows} />;
    default:
      return assertNever(content);
  }
}

const lineageSectionContentKey = (content: PlanningLineageSectionContent): string => {
  if (content.kind === "provider-document") return `${content.kind}:${content.document.key}`;
  if (content.kind === "fact-list") return `${content.kind}:${content.style}`;
  return content.kind;
};

function LineageSections({
  beforeSpine = false,
  onNavigate,
  sections,
  semanticAvailability,
}: {
  readonly beforeSpine?: boolean;
  readonly onNavigate: Navigate;
  readonly sections: readonly PlanningLineageSection[];
  readonly semanticAvailability: ReadonlyMap<string, MattSemanticSectionAvailability>;
}) {
  return (
    <div className={`lineage-sections${beforeSpine ? " lineage-sections-before-spine" : ""}`}>
      {sections.map((section) => (
        <section
          data-semantic-availability={semanticAvailability.get(section.anchor)}
          id={section.anchor}
          key={section.anchor}
        >
          <h2>{section.title}</h2>
          {section.content.map((content) => (
            <LineageSectionContent
              anchor={section.anchor}
              content={content}
              key={`${section.anchor}:${lineageSectionContentKey(content)}`}
              onNavigate={onNavigate}
              sectionTitle={section.title}
            />
          ))}
        </section>
      ))}
    </div>
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
    <dl aria-label="Effort governance status" className="effort-status-group">
      <div>
        <dt>Effort lifecycle</dt>
        <dd>{humanizeWorkState(lens.lifecycle)}</dd>
      </div>
      <div>
        <dt>Contributes to</dt>
        <dd>
          {lens.targetGate.href === undefined ? (
            <>Gate: {lens.targetGate.title}</>
          ) : (
            <a
              href={lens.targetGate.href}
              onClick={(event) => follow(lens.targetGate.href ?? "", event, onNavigate)}
            >
              Gate: {lens.targetGate.title}
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
  const emptyWorkMessage =
    currentWork?.state !== "available" || currentWork.emptyState === undefined
      ? undefined
      : currentWork.emptyState === "confirmed-no-managed-work"
        ? "No managed work is established for this scope."
        : currentWork.emptyState === "resolved-only"
          ? "All managed Work is resolved; no current Work remains."
          : "No current managed work is established. Attention remains and must be reviewed separately.";
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
          <h2>
            Work
            {currentWork.state === "available"
              ? ` (${workRegionCountLabel(currentWork.counts.total)})`
              : ""}
          </h2>
          {currentWork.state === "unavailable" ? (
            <p className="effort-current-work-unavailable">
              Managed work needs attention. Cause: {currentWork.cause} Impact: {currentWork.impact}{" "}
              Recovery: {currentWork.recovery}
            </p>
          ) : (
            <>
              <dl className="effort-work-counts lineage-compact-facts" aria-label="Work counts">
                <div>
                  <dt>Current</dt>
                  <dd>
                    <a
                      href={currentWork.currentHref}
                      onClick={(event) => follow(currentWork.currentHref, event, onNavigate)}
                    >
                      {workRegionCountLabel(currentWork.counts.current)}
                    </a>
                  </dd>
                </div>
                <div>
                  <dt>Resolved</dt>
                  <dd>
                    <a
                      href={currentWork.resolvedHref}
                      onClick={(event) => follow(currentWork.resolvedHref, event, onNavigate)}
                    >
                      {workRegionCountLabel(currentWork.counts.resolved)}
                    </a>
                  </dd>
                </div>
              </dl>
              {currentWork.consistencyWarning === undefined ? null : (
                <p className="effort-consistency-warning" role="status">
                  {currentWork.consistencyWarning}
                </p>
              )}
              {currentWork.items.length === 0 ? (
                <p>{emptyWorkMessage ?? "Current managed work cannot be confirmed."}</p>
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

const workRegionTableCountLabel = (count: MattNativeWorkRegionCount): string =>
  count.mode === "unavailable" ? "Unavailable" : workRegionCountLabel(count);

const workRegionSubjectHref = (entryId: string, reference: string, anchor?: string): string =>
  planningLineageSubjectHref(entryId, { kind: "native-subject", id: reference }, anchor);

const humanizeWorkState = (state: string): string => {
  const words = state.replaceAll("-", " ");
  return `${words[0]?.toUpperCase() ?? ""}${words.slice(1)}`;
};

const WORK_REGION_VIEW_ANCHORS = new Set([
  "native-planning-basis",
  "native-work-current",
  "native-work-resolved",
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
      <dl className="lineage-compact-facts">
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
  renderedMarkdown,
}: {
  readonly chapter: MattNativeWorkRegionMapChapter;
  readonly entryId: string;
  readonly onNavigate: Navigate;
  readonly renderedMarkdown: NonNullable<LineageModelData["renderedMarkdown"]>;
}) {
  if (chapter.availability !== "available") {
    return (
      <section className="matt-work-role role-unavailable">
        <h3>Map</h3>
        <p>Map role {chapter.availability} in the current source data.</p>
      </section>
    );
  }
  const mapHref = workRegionSubjectHref(entryId, chapter.reference);
  const previewGroups = [
    ["Fog", chapter.previews.fog],
    ["Decisions", chapter.previews.decisions],
    ["Out of scope", chapter.previews.outOfScope],
  ] as const;
  const destinationFallback =
    chapter.destination.availability === "confirmed-empty"
      ? "Destination is confirmed empty in the current source data."
      : chapter.destination.availability === "unsupported"
        ? "Destination is unsupported by this provider version."
        : "Destination is unavailable in the current source data.";
  const destination = chapter.destination;
  const renderedDestination =
    destination.availability === "available"
      ? renderedMarkdown.find((entry) => entry.markdown === destination.markdown)
      : undefined;
  return (
    <section className="matt-map-chapter" aria-labelledby="matt-map-chapter-title">
      <p className="eyebrow">Map chapter</p>
      <h3 id="matt-map-chapter-title">
        <a href={mapHref} onClick={(event) => follow(mapHref, event, onNavigate)}>
          {chapter.title}
        </a>
      </h3>
      <div data-semantic-availability={destination.availability}>
        {destination.availability === "available" ? (
          renderedDestination === undefined ? (
            <ReadDisclosure label="Destination">
              <div className="markdown-formatting-fallback">
                <p>Formatting is unavailable for this section.</p>
                <pre>{destination.markdown}</pre>
              </div>
            </ReadDisclosure>
          ) : (
            <SanitizedMarkdownContent
              html={renderedDestination.html}
              label="Destination"
              presentation={renderedDestination.presentation}
            />
          )
        ) : (
          <p>{destinationFallback}</p>
        )}
      </div>
      <dl className="lineage-compact-facts">
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
  headingLevel = 3,
  onNavigate,
}: {
  readonly entryId: string;
  readonly group: MattNativeWorkRegionRoleGroup;
  readonly headingLevel?: 3 | 4 | undefined;
  readonly onNavigate: Navigate;
}) {
  if (group.availability === "confirmed-empty") return null;
  const Heading = headingLevel === 3 ? "h3" : "h4";
  return (
    <section className={`matt-work-role role-${group.availability}`}>
      <div className="matt-work-role-heading">
        <Heading>{group.label}</Heading>
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

function MattNativeWorkRegion({
  entryId,
  onNavigate,
  owner,
  region,
  renderedMarkdown,
}: {
  readonly entryId: string;
  readonly onNavigate: Navigate;
  readonly owner?: Readonly<{ title: string; href: string }> | undefined;
  readonly region: MattNativeWorkRegionModel;
  readonly renderedMarkdown: NonNullable<LineageModelData["renderedMarkdown"]>;
}) {
  const current = region.views[0];
  const resolved = region.views[1];
  const planningBasisGroups = region.roles.filter(
    (group) => (group.role === "map" && region.mapChapter === undefined) || group.role === "spec",
  );
  const reading = region.readingState;
  const healthy =
    region.context.state === "bound" &&
    reading.why.projectionState === "available" &&
    reading.why.freshness === "current" &&
    reading.why.coverage === "complete" &&
    reading.why.blockingDiagnosticCount === 0;
  return (
    <section
      className={`matt-work-region context-${region.context.state}`}
      aria-label="Contributing Work"
    >
      {healthy ? null : (
        <div className="work-history-attention" role="status">
          <strong>Needs attention</strong>
          <p>{reading.impact}</p>
          {owner === undefined ? null : (
            <p>
              Return to <a href={owner.href}>{owner.title}</a> to load the bound provider source.
            </p>
          )}
        </div>
      )}
      <nav aria-label="Planning Basis and Work views">
        <a href="#native-planning-basis">Planning Basis</a>
        <a href="#native-work-current">Current · {workRegionCountLabel(current.count)}</a>
        <a href="#native-work-resolved">Resolved · {workRegionCountLabel(resolved.count)}</a>
      </nav>
      <section id="native-planning-basis" className="matt-work-view">
        <h2>Planning Basis</h2>
        {region.mapChapter === undefined ? null : (
          <MapChapter
            chapter={region.mapChapter}
            entryId={entryId}
            onNavigate={onNavigate}
            renderedMarkdown={renderedMarkdown}
          />
        )}
        <div className="matt-work-role-groups">
          {planningBasisGroups.map((group) => (
            <WorkRegionRole
              entryId={entryId}
              group={group}
              key={group.role}
              onNavigate={onNavigate}
            />
          ))}
        </div>
      </section>
      <section className="matt-work-collection" aria-labelledby="native-work-title">
        <h2 id="native-work-title">Work ({workRegionCountLabel(region.total)})</h2>
        <section id="native-work-current" className="matt-work-view">
          <h3>Current</h3>
          {current.items.length === 0 ? (
            <p>No current Work is established by this observation.</p>
          ) : (
            <div className="matt-work-role-groups">
              {current.groups.map((group) => (
                <WorkRegionRole
                  entryId={entryId}
                  group={group}
                  headingLevel={4}
                  key={group.role}
                  onNavigate={onNavigate}
                />
              ))}
            </div>
          )}
        </section>
        <section id="native-work-resolved" className="matt-work-view">
          <h3>Resolved</h3>
          {resolved.items.length === 0 ? (
            <p>No resolved Work is established by this observation.</p>
          ) : (
            <div className="matt-work-role-groups">
              {resolved.groups.map((group) => (
                <WorkRegionRole
                  entryId={entryId}
                  group={group}
                  headingLevel={4}
                  key={group.role}
                  onNavigate={onNavigate}
                />
              ))}
            </div>
          )}
        </section>
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
  observationActionLabel,
  observationApplication,
  observationBusy,
  observationObservedAt,
  observationStatusRef,
  onObserveSource,
  requested,
  semanticAnchor,
  snapshot,
}: {
  readonly entryId: string;
  readonly filteredView?: RequestedPlanningLineageFilteredView | undefined;
  readonly onInspect: Inspect;
  readonly onNavigate: Navigate;
  readonly observationActionLabel?: "Refresh source" | undefined;
  readonly observationApplication?: ProviderObservationApplication | undefined;
  readonly observationBusy?: boolean | undefined;
  readonly observationObservedAt?: string | undefined;
  readonly observationStatusRef?: RefObject<HTMLDivElement | null> | undefined;
  readonly onObserveSource?: (() => void) | undefined;
  readonly requested: RequestedPlanningLineageSubject;
  readonly semanticAnchor?: string | undefined;
  readonly snapshot: LineageModelData;
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
  const effortObservation = model.effortLens?.managedWorkObservation;
  const sourceAttention =
    observationApplication?.state === "settled" &&
    observationApplication.result.state === "attention" &&
    observationApplication.result.action !== "all-sources-refresh";
  const observedAt = (() => {
    if (observationObservedAt !== undefined) return observationObservedAt;
    const workObservation = model.workRegion?.readingState.observation.observedAt;
    if (workObservation?.availability === "available") return workObservation.value;
    return effortObservation?.lastVerified;
  })();
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
          : model.subject.kind === "asset"
            ? new Set(["production.owner"])
            : model.subject.kind === "native-scope"
              ? new Set(["native-work.members"])
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
    model.subject.kind === "planning-review"
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
          {model.workHistoryOwner === undefined ? null : (
            <p className="lineage-header-context">
              For <a href={model.workHistoryOwner.href}>{model.workHistoryOwner.title}</a>
            </p>
          )}
          {model.headerStatuses === undefined ? null : (
            <div className="lineage-header-status">
              {model.headerStatuses.map((status) => (
                <HeaderStatusTag key={status.token} status={status} />
              ))}
            </div>
          )}
          {model.effortLens === undefined ? null : (
            <EffortStatusGroup lens={model.effortLens} onNavigate={onNavigate} />
          )}
        </div>
        <div className="lineage-header-actions">
          {model.primaryAction === undefined ? null : (
            <a
              className="action action-primary lineage-primary-action"
              href={model.primaryAction.href}
              {...(model.primaryAction.external
                ? { rel: "noopener noreferrer", target: "_blank" }
                : {})}
            >
              {model.primaryAction.label}
            </a>
          )}
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
        </div>
      </header>
      {(onObserveSource === undefined || observationActionLabel === undefined) &&
      !sourceAttention ? null : (
        <div className="source-observation-action">
          <div>
            <strong>Source status</strong>
            <dl className="lineage-compact-facts">
              <div>
                <dt>Checked</dt>
                <dd>
                  {observedAt === undefined ? (
                    "Not checked"
                  ) : (
                    <ProviderObservationTime value={observedAt} />
                  )}
                </dd>
              </div>
            </dl>
          </div>
          {onObserveSource === undefined || observationActionLabel === undefined ? null : (
            <Action
              data-project-activation-action="manual"
              disabled={observationBusy}
              onClick={onObserveSource}
              tone={
                sourceAttention || model.effortLens?.managedWorkHealth === "Needs attention"
                  ? "attention"
                  : "quiet"
              }
            >
              <Icons.refresh className={observationBusy ? "is-spinning" : ""} />
              {observationBusy ? "Refreshing source" : observationActionLabel}
            </Action>
          )}
          {observationApplication === undefined || observationStatusRef === undefined ? null : (
            <ProviderObservationStatus
              application={observationApplication}
              placement="source"
              statusRef={observationStatusRef}
            />
          )}
        </div>
      )}
      {effortObservation === undefined ? null : (
        <div className="effort-observation-recovery" role="status">
          <div>
            <p>{effortObservation.indication}</p>
            {effortObservation.latestRefreshFailed === true ? (
              <p>Latest refresh failed; retained verified work remains visible.</p>
            ) : null}
            {effortObservation.latestRefreshSucceeded === true ? (
              <p>
                Work details refreshed for the bound scope; canonical Managed Work authority remains
                degraded.
              </p>
            ) : null}
            {effortObservation.lastVerified === undefined ? null : (
              <dl className="lineage-compact-facts">
                <div>
                  <dt>Last verified</dt>
                  <dd>{effortObservation.lastVerified}</dd>
                </div>
              </dl>
            )}
          </div>
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
          <h2>Event History</h2>
          <dl className="lineage-compact-facts">
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
      {model.subject.kind !== "roadmap" ? null : (
        <LineageSections
          beforeSpine
          key={`${model.subject.kind}:${model.subject.id}`}
          onNavigate={onNavigate}
          sections={model.sections}
          semanticAvailability={model.semanticAvailability}
        />
      )}
      {model.outcomeSpine === undefined ? null : (
        <OutcomeSpine onNavigate={onNavigate} spine={model.outcomeSpine} />
      )}
      {model.effortLens === undefined ? null : (
        <EffortGovernanceLens lens={model.effortLens} onNavigate={onNavigate} />
      )}
      {model.subject.kind === "roadmap" ? null : (
        <LineageSections
          key={`${model.subject.kind}:${model.subject.id}`}
          onNavigate={onNavigate}
          sections={model.sections}
          semanticAvailability={model.semanticAvailability}
        />
      )}
      {model.workRegion === undefined || model.subject.kind === "effort" ? null : (
        <MattNativeWorkRegion
          entryId={entryId}
          key={`${model.subject.kind}:${model.subject.id}`}
          onNavigate={onNavigate}
          owner={model.workHistoryOwner}
          region={model.workRegion}
          renderedMarkdown={model.renderedMarkdown}
        />
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
