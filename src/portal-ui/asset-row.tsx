import type { MouseEvent } from "react";
import { Icons } from "./icons";

export function AssetRow({
  evidenceSummary,
  href,
  kind,
  onOpen,
  owner,
  primaryFocusKey,
  title,
}: {
  readonly evidenceSummary: string;
  readonly href: string;
  readonly kind: string;
  readonly onOpen: (event: MouseEvent<HTMLAnchorElement>) => void;
  readonly owner: string;
  readonly primaryFocusKey?: string | undefined;
  readonly title: string;
}) {
  return (
    <div className="asset-row">
      <a
        aria-label={`${title}, ${kind}, owner ${owner}, ${evidenceSummary}`}
        className="asset-row-primary"
        data-bearing-focus-key={primaryFocusKey}
        href={href}
        onClick={onOpen}
      >
        <span className="asset-title">
          <Icons.asset aria-hidden="true" />
          <span>
            <strong>{title}</strong>
            <small>{kind}</small>
          </span>
        </span>
        <span className="asset-owner">{owner}</span>
        <span className="asset-evidence-summary">{evidenceSummary}</span>
        <span className="row-arrow" aria-hidden="true">
          <Icons.arrow />
        </span>
      </a>
    </div>
  );
}
