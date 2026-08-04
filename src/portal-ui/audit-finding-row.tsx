import { Icons } from "./icons";
import { decisionKindLabel, type ProjectAuditFindingRow } from "./project-audit-model";

const rowContent = (row: ProjectAuditFindingRow) => {
  const affectedCount = row.finding.affectedReferences.length;
  const promotion = row.promotion;
  const targetLabel =
    promotion === undefined
      ? "No decision target"
      : promotion.available
        ? `${promotion.title} · ${promotion.status}`
        : `${decisionKindLabel(promotion.kind)} unavailable · ${promotion.id}`;
  return (
    <>
      <span className="audit-finding-copy">
        <strong className="audit-finding-title">{row.finding.title}</strong>
        <span className="audit-finding-summary">{row.finding.summary}</span>
      </span>
      <dl className="audit-finding-facts">
        <div>
          <dt>Scope</dt>
          <dd>
            <strong>
              {affectedCount} affected {affectedCount === 1 ? "reference" : "references"}
            </strong>
            <span>{row.finding.affectedReferences.join(" · ")}</span>
          </dd>
        </div>
        <div>
          <dt>Impact</dt>
          <dd>{row.finding.consequence}</dd>
        </div>
        <div>
          <dt>Target</dt>
          <dd>{targetLabel}</dd>
        </div>
      </dl>
    </>
  );
};

export function AuditFindingRow({
  href,
  row,
}: {
  readonly href: string | undefined;
  readonly row: ProjectAuditFindingRow;
}) {
  const affectedCount = row.finding.affectedReferences.length;
  const label = `${row.finding.title}, ${affectedCount} affected ${
    affectedCount === 1 ? "reference" : "references"
  }`;
  return href === undefined ? (
    <article aria-label={label} className="audit-finding-row">
      {rowContent(row)}
    </article>
  ) : (
    <a aria-label={label} className="audit-finding-row is-linked" href={href}>
      {rowContent(row)}
      <span className="row-arrow" aria-hidden="true">
        <Icons.arrow />
      </span>
    </a>
  );
}
