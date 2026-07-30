import type { MouseEvent } from "react";
import { Icons } from "./icons";

export function AssetRow({
  citations,
  contentAvailability,
  href,
  kind,
  lifecycleSource,
  location,
  onOpen,
  onSelect,
  owner,
  primaryFocusKey,
  quickLookFocusKey,
  title,
}: {
  readonly citations: number;
  readonly contentAvailability?: "available" | "missing" | "unreadable";
  readonly href?: string;
  readonly kind: string;
  readonly lifecycleSource?: "native" | "registry";
  readonly location: string;
  readonly onOpen?: (event: MouseEvent<HTMLAnchorElement>) => void;
  readonly onSelect?: ((trigger: HTMLButtonElement) => void) | undefined;
  readonly owner?: string;
  readonly primaryFocusKey?: string | undefined;
  readonly quickLookFocusKey?: string | undefined;
  readonly title: string;
}) {
  const citationLabel = `${citations} ${citations === 1 ? "citation" : "citations"}`;
  const lifecycleLabel = lifecycleSource === undefined ? "lifecycle unavailable" : lifecycleSource;
  const availabilityLabel =
    contentAvailability === undefined ? "content availability unavailable" : contentAvailability;
  return (
    <div className="asset-row">
      {href === undefined ? (
        <button
          aria-label={`${title}, ${kind}, ${lifecycleLabel}, ${availabilityLabel}, ${owner ?? "owner unavailable"}, ${citationLabel}, ${location}`}
          className="asset-row-primary"
          data-bearing-focus-key={primaryFocusKey}
          onClick={(event) => onSelect?.(event.currentTarget)}
          type="button"
        >
          <AssetRowContent
            citations={citations}
            {...(contentAvailability === undefined ? {} : { contentAvailability })}
            kind={kind}
            {...(lifecycleSource === undefined ? {} : { lifecycleSource })}
            location={location}
            {...(owner === undefined ? {} : { owner })}
            title={title}
          />
        </button>
      ) : (
        <a
          aria-label={`${title}, ${kind}, ${lifecycleLabel}, ${availabilityLabel}, ${owner ?? "owner unavailable"}, ${citationLabel}, ${location}`}
          className="asset-row-primary"
          data-bearing-focus-key={primaryFocusKey}
          href={href}
          onClick={onOpen}
        >
          <AssetRowContent
            citations={citations}
            {...(contentAvailability === undefined ? {} : { contentAvailability })}
            kind={kind}
            {...(lifecycleSource === undefined ? {} : { lifecycleSource })}
            location={location}
            {...(owner === undefined ? {} : { owner })}
            title={title}
          />
        </a>
      )}
      {href === undefined || onSelect === undefined ? null : (
        <button
          className="row-quick-look"
          data-bearing-focus-key={quickLookFocusKey}
          type="button"
          aria-label={`Quick Look ${title}`}
          onClick={(event) => onSelect(event.currentTarget)}
        >
          Quick Look
        </button>
      )}
    </div>
  );
}

function AssetRowContent({
  citations,
  contentAvailability,
  kind,
  lifecycleSource,
  location,
  owner,
  title,
}: {
  readonly citations: number;
  readonly contentAvailability?: "available" | "missing" | "unreadable";
  readonly kind: string;
  readonly lifecycleSource?: "native" | "registry";
  readonly location: string;
  readonly owner?: string;
  readonly title: string;
}) {
  return (
    <>
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
    </>
  );
}
