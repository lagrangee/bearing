import { Icons } from "./icons";
import { decisionKindLabel, type ProjectAuditFindingRow } from "./project-audit-model";

export function AuditFindingRow({
  onSelect,
  row,
}: {
  readonly onSelect: (trigger: HTMLButtonElement) => void;
  readonly row: ProjectAuditFindingRow;
}) {
  const affectedCount = row.finding.affectedReferences.length;
  const pathLabel =
    row.promotion === undefined ? "Advisory finding" : decisionKindLabel(row.promotion.kind);
  const decision =
    row.promotion === undefined
      ? "No promoted decision path"
      : row.promotion.available
        ? `${row.promotion.title} · ${row.promotion.status}`
        : `${row.promotion.id} · unavailable`;
  return (
    <button
      aria-label={`${row.finding.title}, ${pathLabel}, ${affectedCount} affected ${
        affectedCount === 1 ? "reference" : "references"
      }, ${decision}`}
      className="audit-finding-row"
      onClick={(event) => onSelect(event.currentTarget)}
      type="button"
    >
      <span className={`audit-path-mark${row.promotion === undefined ? "" : " is-promoted"}`}>
        {row.promotion === undefined ? (
          <Icons.audit aria-hidden="true" />
        ) : (
          <Icons.arrow aria-hidden="true" />
        )}
      </span>
      <span className="audit-finding-copy">
        <small className="audit-finding-path-label">{pathLabel}</small>
        <strong className="audit-finding-title">{row.finding.title}</strong>
        <span className="audit-finding-summary">{row.finding.summary}</span>
      </span>
      <span className="audit-finding-relations">
        <span className="audit-finding-count">
          {affectedCount} affected {affectedCount === 1 ? "reference" : "references"}
        </span>
        <small className="audit-finding-decision">{decision}</small>
      </span>
      <span className="row-arrow" aria-hidden="true">
        <Icons.arrow />
      </span>
    </button>
  );
}
