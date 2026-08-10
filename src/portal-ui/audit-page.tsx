import { planningLineageSubjectHref } from "../planning-lineage-route";
import type { PlanningReview } from "../project-generation/contract";
import { AuditFindingRow } from "./audit-finding-row";
import { Icons } from "./icons";
import { buildProjectAuditModel, type ProjectAuditModel } from "./project-audit-model";
import type { AuditModelData } from "./project-data";

type CurrentAudit = ProjectAuditModel["current"];
type ReadableAudit = Extract<CurrentAudit, { state: "available" | "partial" }>;

const titleCase = (value: string): string => `${value[0]?.toUpperCase()}${value.slice(1)}`;

function AuditMetadata({ model }: { readonly model: ReadableAudit }) {
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
          {model.findings.length} {model.findings.length === 1 ? "finding" : "findings"}
        </dd>
      </div>
      <div>
        <dt>Coverage</dt>
        <dd>{titleCase(model.coverage)} coverage</dd>
      </div>
    </dl>
  );
}

function CurrentProjectReview({
  entryId,
  model,
}: {
  readonly entryId: string;
  readonly model: CurrentAudit;
}) {
  return (
    <section aria-labelledby="current-project-review-title" className="audit-findings">
      <div className="section-heading">
        <h2 id="current-project-review-title">Current Project Review</h2>
      </div>
      {model.state === "absent" ? (
        <div className="scoped-state">
          <h3>No current Audit</h3>
          <p>Ask Agent Surface to run an explicit Planning Audit.</p>
        </div>
      ) : model.state === "invalid" ? (
        <div className="scoped-state audit-unavailable">
          <h3>Planning Audit unavailable</h3>
          <p>
            {model.issueCount} projection{" "}
            {model.issueCount === 1 ? "issue prevents" : "issues prevent"} a trustworthy current
            review. Ask Agent Surface to inspect and replace the Audit.
          </p>
        </div>
      ) : (
        <>
          <AuditMetadata model={model} />
          {model.findings.length === 0 ? (
            <div className="audit-zero-findings">
              <Icons.check aria-hidden="true" />
              <div>
                <h3>No findings</h3>
                <p>No material findings were reported in this Audit.</p>
              </div>
            </div>
          ) : (
            <div className="audit-finding-list">
              {model.findings.map((row) => (
                <AuditFindingRow
                  href={
                    row.promotion?.available === true
                      ? planningLineageSubjectHref(entryId, {
                          kind: "planning-review",
                          id: row.promotion.id,
                        })
                      : undefined
                  }
                  key={row.finding.id}
                  row={row}
                />
              ))}
            </div>
          )}
          {model.coverage === "incomplete" || model.state === "partial" ? (
            <div className="audit-scope-detail">
              <h3>{model.state === "partial" ? "Partial projection" : "Incomplete coverage"}</h3>
              {model.state === "partial" ? (
                <p>
                  {model.issueCount} projection {model.issueCount === 1 ? "issue" : "issues"}{" "}
                  limited this view.
                </p>
              ) : null}
              {model.skippedTargets.length > 0 ? (
                <p>Skipped targets: {model.skippedTargets.join(" · ")}</p>
              ) : null}
              <p>
                Ask Agent Surface to inspect the reported sources and run an explicit Planning
                Audit.
              </p>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}

const reviewScope = (review: PlanningReview): string =>
  review.scope.kind === "project" ? "Whole project" : `Target: ${review.scope.target}`;

function ReviewList({
  entryId,
  reviews,
  empty,
}: {
  readonly entryId: string;
  readonly reviews: readonly PlanningReview[];
  readonly empty: string;
}) {
  if (reviews.length === 0) return <p>{empty}</p>;
  return (
    <ul className="audit-review-list">
      {reviews.map((review) => (
        <li key={review.id}>
          <a href={planningLineageSubjectHref(entryId, { kind: "planning-review", id: review.id })}>
            {review.title}
          </a>
          <p>{review.question}</p>
          <p>{reviewScope(review)}</p>
        </li>
      ))}
    </ul>
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
      <CurrentProjectReview entryId={entryId} model={model.current} />
      <section aria-labelledby="decisions-attention-title">
        <div className="section-heading">
          <h2 id="decisions-attention-title">Decisions Awaiting Attention</h2>
        </div>
        <ReviewList
          entryId={entryId}
          reviews={model.pendingReviews}
          empty="No decisions await attention."
        />
        {model.pendingReviews.length > 0 ? (
          <p>
            Continue these decisions in Agent Surface. Portal does not accept, resolve, reopen, or
            refresh Reviews.
          </p>
        ) : null}
      </section>
      <section aria-labelledby="past-decisions-title">
        <div className="section-heading">
          <h2 id="past-decisions-title">Past Accepted Decisions</h2>
        </div>
        <ReviewList
          entryId={entryId}
          reviews={model.completedReviews}
          empty="No accepted Planning Review history is available."
        />
      </section>
    </div>
  );
}
