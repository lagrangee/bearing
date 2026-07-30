import { planningLineageSubjectHref } from "../planning-lineage-route";
import type { ProjectSnapshot } from "../project-snapshot/contract";
import { AuditFindingRow } from "./audit-finding-row";
import { Icons } from "./icons";
import { Action } from "./primitives";
import {
  buildProjectAuditModel,
  findingInspection,
  type ProjectAuditModel,
} from "./project-audit-model";
import type { ProjectInspectorSelection } from "./project-inspector";

type Inspect = (selection: ProjectInspectorSelection, trigger: HTMLButtonElement) => void;
type ReadableAudit = Extract<ProjectAuditModel, { state: "available" | "partial" }>;

const titleCase = (value: string): string => `${value[0]?.toUpperCase()}${value.slice(1)}`;
const coverageCopy = (model: ReadableAudit): string =>
  model.coverage === "complete"
    ? "The Audit reports complete semantic coverage for its declared input set."
    : "The Audit reports incomplete semantic coverage; declared skipped scope remains explicit below.";

const resumeSelection: ProjectInspectorSelection = {
  eyebrow: "Planning entry",
  title: "Planning Audit in Agent Surface",
  detail:
    "Planning Audit is produced through its Agent Surface capability. The Portal only explains that boundary and does not generate or revise an Audit.",
  handoff: true,
};

function AuditExplainer() {
  return (
    <section className="audit-explainer" aria-label="What a Planning Audit provides">
      <div>
        <span className="audit-explainer-number">01</span>
        <h3>Coverage</h3>
        <p>What was inspected and what was intentionally skipped or unavailable.</p>
      </div>
      <div>
        <span className="audit-explainer-number">02</span>
        <h3>Findings</h3>
        <p>Whole-picture observations grounded in explicit source evidence.</p>
      </div>
      <div>
        <span className="audit-explainer-number">03</span>
        <h3>Decision paths</h3>
        <p>Alignment Checks and Planning Reviews remain distinct canonical outcomes.</p>
      </div>
    </section>
  );
}

function AbsentAudit({ onInspect }: { readonly onInspect: Inspect }) {
  return (
    <>
      <section className="audit-empty">
        <span className="empty-orbit" aria-hidden="true">
          <Icons.audit />
        </span>
        <p className="eyebrow">No current Audit</p>
        <h2>Generate the first whole-project review in Agent Surface</h2>
        <p>
          The Portal will show coverage, skipped targets, findings, and promoted decision points
          after an agent produces a Planning Audit.
        </p>
        <Action tone="primary" onClick={(event) => onInspect(resumeSelection, event.currentTarget)}>
          Resume Audit in Agent Surface <Icons.arrow />
        </Action>
      </section>
      <AuditExplainer />
    </>
  );
}

function AuditScope({ model }: { readonly model: ReadableAudit }) {
  const issueCount = model.state === "partial" ? model.issueCount : 0;
  return (
    <section className="audit-scope" aria-labelledby="audit-coverage-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Declared semantic scope</p>
          <h2 id="audit-coverage-title">Coverage</h2>
        </div>
        <span className="audit-coverage-label">{titleCase(model.coverage)}</span>
      </div>
      <p>{coverageCopy(model)}</p>
      <div className="audit-scope-detail">
        <section>
          <h3>Skipped scope</h3>
          {model.skippedTargets.length === 0 ? (
            <p>No skipped targets are declared.</p>
          ) : (
            <ul>
              {model.skippedTargets.map((target) => (
                <li key={target}>
                  <code>{target}</code>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section>
          <h3>Isolated projection issues</h3>
          <p>
            {issueCount === 0
              ? "No isolated projection issues are reported."
              : `${issueCount} projection ${issueCount === 1 ? "issue is" : "issues are"} reported separately from trustworthy findings.`}
          </p>
        </section>
      </div>
    </section>
  );
}

function ReadableAuditPage({
  entryId,
  model,
  onInspect,
}: {
  readonly entryId: string;
  readonly model: ReadableAudit;
  readonly onInspect: Inspect;
}) {
  const resolvedPromotions = model.findings.filter(
    (row) => row.promotion?.available === true,
  ).length;
  const unavailablePromotions = model.findings.filter(
    (row) => row.promotion?.available === false,
  ).length;
  return (
    <>
      {model.state === "partial" ? (
        <p className="projection-note" role="status">
          Audit orientation is partial. {model.issueCount} projection issue
          {model.issueCount === 1 ? "" : "s"} {model.issueCount === 1 ? "is" : "are"} isolated.
        </p>
      ) : null}
      <section className="audit-truth-boundary">
        <strong>Advisory snapshot</strong>
        <p>
          Findings can inform a decision, but they do not accept, dismiss, revise, or generate
          project intent.
        </p>
      </section>
      <dl className="audit-metadata" aria-label="Planning Audit metadata">
        <div>
          <dt>Generated</dt>
          <dd>
            <time dateTime={model.generatedAt}>{model.generatedAt}</time>
          </dd>
        </div>
        <div>
          <dt>Semantic freshness</dt>
          <dd>{titleCase(model.semanticFreshness)}</dd>
        </div>
        <div>
          <dt>Coverage</dt>
          <dd>{titleCase(model.coverage)}</dd>
        </div>
        <div>
          <dt>Findings</dt>
          <dd>{model.findings.length}</dd>
        </div>
      </dl>
      <AuditScope model={model} />
      <section className="audit-findings" aria-labelledby="audit-findings-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Snapshot order preserved</p>
            <h2 id="audit-findings-title">Findings</h2>
          </div>
          <span className="truth-note">
            {model.findings.length} {model.findings.length === 1 ? "finding" : "findings"}
          </span>
        </div>
        {model.findings.length === 0 ? (
          <div className="audit-zero-findings">
            <Icons.check aria-hidden="true" />
            <div>
              <h3>No material findings</h3>
              <p>
                This Audit reports no findings; it does not prove that project intent is complete.
              </p>
            </div>
          </div>
        ) : (
          <div className="audit-finding-list">
            {model.findings.map((row) => {
              const promotion = row.promotion;
              const fullDetailHref =
                promotion?.available === true
                  ? planningLineageSubjectHref(
                      entryId,
                      promotion.kind === "alignment-check"
                        ? { kind: "alignment-check", id: promotion.id }
                        : { kind: "planning-review", id: promotion.id },
                    )
                  : undefined;
              return (
                <AuditFindingRow
                  key={row.finding.id}
                  row={row}
                  onSelect={(trigger) =>
                    onInspect(
                      {
                        ...findingInspection(row),
                        ...(fullDetailHref === undefined ? {} : { fullDetailHref }),
                      },
                      trigger,
                    )
                  }
                />
              );
            })}
          </div>
        )}
      </section>
      <section className="audit-decision-truth" aria-labelledby="audit-decision-title">
        <p className="eyebrow">Canonical outcomes remain separate</p>
        <h2 id="audit-decision-title">Decision truth</h2>
        <p>
          {resolvedPromotions} {resolvedPromotions === 1 ? "finding resolves" : "findings resolve"}
          {resolvedPromotions === 1
            ? " to a canonical decision path."
            : " to canonical decision paths."}
          {unavailablePromotions > 0
            ? ` ${unavailablePromotions} declared promotion${unavailablePromotions === 1 ? " is" : "s are"} unavailable in the current Snapshot.`
            : ""}{" "}
          Actual titles and statuses come from Alignment Checks or Planning Reviews; only their
          unresolved canonical objects can enter Attention.
        </p>
      </section>
    </>
  );
}

export function AuditPage({
  entryId,
  onInspect,
  snapshot,
}: {
  readonly entryId: string;
  readonly onInspect: Inspect;
  readonly snapshot: ProjectSnapshot;
}) {
  const model = buildProjectAuditModel(snapshot);
  return (
    <div className="page audit-page">
      <header className="document-header audit-document-header">
        <p className="eyebrow">Whole-project semantic review</p>
        <h1>Planning Audit</h1>
        <p>
          A deliberate review across the project’s planning objects. It is advisory and does not
          replace Alignment Checks or Planning Reviews.
        </p>
      </header>
      {model.state === "absent" ? (
        <AbsentAudit onInspect={onInspect} />
      ) : model.state === "invalid" ? (
        <section className="scoped-state audit-unavailable">
          <h2>Planning Audit unavailable</h2>
          <p>
            The Audit projection cannot be trusted ({model.issueCount} projection issue
            {model.issueCount === 1 ? "" : "s"}). Other project destinations remain available.
          </p>
        </section>
      ) : (
        <ReadableAuditPage entryId={entryId} model={model} onInspect={onInspect} />
      )}
    </div>
  );
}
