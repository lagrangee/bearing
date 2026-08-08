import { planningLineageSubjectHref } from "../planning-lineage-route";
import { AuditFindingRow } from "./audit-finding-row";
import { Icons } from "./icons";
import { buildProjectAuditModel, type ProjectAuditModel } from "./project-audit-model";
import type { AuditModelData } from "./project-data";

type ReadableAudit = Extract<ProjectAuditModel, { state: "available" | "partial" }>;

const titleCase = (value: string): string => `${value[0]?.toUpperCase()}${value.slice(1)}`;

function AbsentAudit() {
  return (
    <section className="audit-empty scoped-state">
      <h2>No current Audit</h2>
      <p>Generate a Planning Audit in Agent Surface to inspect the project.</p>
    </section>
  );
}

function AuditMetadata({ model }: { readonly model: ReadableAudit }) {
  const findingCount = model.findings.length;
  return (
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
        <dt>Findings</dt>
        <dd>
          {findingCount} {findingCount === 1 ? "finding" : "findings"}
        </dd>
      </div>
      <div>
        <dt>Coverage</dt>
        <dd>{titleCase(model.coverage)} coverage</dd>
      </div>
      {model.state === "partial" ? (
        <div>
          <dt>Projection</dt>
          <dd>Partial projection</dd>
        </div>
      ) : null}
    </dl>
  );
}

function AuditFindings({
  entryId,
  model,
}: {
  readonly entryId: string;
  readonly model: ReadableAudit;
}) {
  return (
    <section className="audit-findings" aria-labelledby="audit-findings-title">
      <div className="section-heading">
        <h2 id="audit-findings-title">Findings</h2>
      </div>
      {model.findings.length === 0 ? (
        <div className="audit-zero-findings">
          <Icons.check aria-hidden="true" />
          <div>
            <h3>No findings</h3>
            <p>No findings were reported in this Audit.</p>
          </div>
        </div>
      ) : (
        <div className="audit-finding-list">
          {model.findings.map((row) => {
            const promotion = row.promotion;
            const href =
              promotion?.available === true
                ? planningLineageSubjectHref(
                    entryId,
                    promotion.kind === "alignment-check"
                      ? { kind: "alignment-check", id: promotion.id }
                      : { kind: "planning-review", id: promotion.id },
                  )
                : undefined;
            return <AuditFindingRow href={href} key={row.finding.id} row={row} />;
          })}
        </div>
      )}
    </section>
  );
}

function AuditCoverage({ model }: { readonly model: ReadableAudit }) {
  if (model.coverage === "complete" && model.state !== "partial") return null;
  const partial = model.state === "partial";
  return (
    <section className="audit-scope" aria-labelledby="audit-coverage-title">
      <div className="section-heading">
        <h2 id="audit-coverage-title">{partial ? "Partial projection" : "Incomplete coverage"}</h2>
      </div>
      <div className="audit-scope-detail">
        {model.coverage === "incomplete" ? (
          <section>
            <h3>Skipped scope</h3>
            <ul>
              {model.skippedTargets.map((target) => (
                <li key={target}>
                  <code>{target}</code>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {partial ? (
          <section>
            <h3>Projection issues</h3>
            <p>
              {model.issueCount} projection {model.issueCount === 1 ? "issue" : "issues"} isolated
              from the trustworthy findings above.
            </p>
          </section>
        ) : null}
        <section>
          <h3>Impact</h3>
          <p>
            {partial
              ? "Some Audit material could not be projected; the findings above remain readable but the Audit is not complete."
              : "The declared Audit scope is incomplete; findings do not cover the skipped targets."}
          </p>
        </section>
        <section>
          <h3>Recovery</h3>
          <p>
            {partial
              ? "Correct the reported source and run Planning Audit again in Agent Surface."
              : "Run Planning Audit again when the skipped targets can be inspected."}
          </p>
        </section>
      </div>
    </section>
  );
}

function ReadableAuditPage({
  entryId,
  model,
}: {
  readonly entryId: string;
  readonly model: ReadableAudit;
}) {
  return (
    <>
      <AuditMetadata model={model} />
      <AuditFindings entryId={entryId} model={model} />
      <p className="audit-advisory-boundary">
        Audit is advisory; decisions remain in Alignment Checks and Planning Reviews.
      </p>
      <AuditCoverage model={model} />
    </>
  );
}

function InvalidAudit({ issueCount }: { readonly issueCount: number }) {
  return (
    <section className="scoped-state audit-unavailable">
      <h2>Planning Audit unavailable</h2>
      <dl className="audit-recovery-detail">
        <div>
          <dt>Cause</dt>
          <dd>
            {issueCount} projection {issueCount === 1 ? "issue prevents" : "issues prevent"} a
            trustworthy Audit reading.
          </dd>
        </div>
        <div>
          <dt>Impact</dt>
          <dd>Findings are hidden because the Audit cannot be normalized safely.</dd>
        </div>
        <div>
          <dt>Recovery</dt>
          <dd>Correct the reported source and run Planning Audit again in Agent Surface.</dd>
        </div>
      </dl>
    </section>
  );
}

export function AuditPage({
  entryId,
  snapshot,
}: {
  readonly entryId: string;
  readonly snapshot: AuditModelData;
}) {
  const model = buildProjectAuditModel(snapshot);
  return (
    <div className="page audit-page">
      <header className="document-header audit-document-header">
        <h1>Planning Audit</h1>
      </header>
      {model.state === "absent" ? (
        <AbsentAudit />
      ) : model.state === "invalid" ? (
        <InvalidAudit issueCount={model.issueCount} />
      ) : (
        <ReadableAuditPage entryId={entryId} model={model} />
      )}
    </div>
  );
}
