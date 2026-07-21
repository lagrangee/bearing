import { Icons } from "./icons";

export function AssetRow({
  citations,
  contentAvailability,
  kind,
  lifecycleSource,
  location,
  onSelect,
  owner,
  title,
}: {
  readonly citations: number;
  readonly contentAvailability?: "available" | "missing" | "unreadable";
  readonly kind: string;
  readonly lifecycleSource?: "native" | "registry";
  readonly location: string;
  readonly onSelect?: ((trigger: HTMLButtonElement) => void) | undefined;
  readonly owner?: string;
  readonly title: string;
}) {
  const citationLabel = `${citations} ${citations === 1 ? "citation" : "citations"}`;
  const lifecycleLabel = lifecycleSource === undefined ? "lifecycle unavailable" : lifecycleSource;
  const availabilityLabel =
    contentAvailability === undefined ? "content availability unavailable" : contentAvailability;
  return (
    <button
      aria-label={`${title}, ${kind}, ${lifecycleLabel}, ${availabilityLabel}, ${owner ?? "owner unavailable"}, ${citationLabel}, ${location}`}
      className="asset-row"
      onClick={(event) => onSelect?.(event.currentTarget)}
      type="button"
    >
      <span className="asset-title">
        <Icons.asset aria-hidden="true" />
        <span>
          <strong>{title}</strong>
          <small>
            {kind}
            {lifecycleSource === undefined ? null : <> · {lifecycleSource}</>}
            {contentAvailability === undefined ? null : <> · {contentAvailability}</>}
          </small>
          <code className="asset-mobile-location">{location}</code>
        </span>
      </span>
      <span className="asset-owner">{owner ?? "Unavailable"}</span>
      <span className="citation-count">
        <strong>{citations}</strong>
        <small>{citations === 1 ? " citation" : " citations"}</small>
      </span>
      <code className="asset-location">{location}</code>
      <span className="row-arrow" aria-hidden="true">
        <Icons.arrow />
      </span>
    </button>
  );
}
