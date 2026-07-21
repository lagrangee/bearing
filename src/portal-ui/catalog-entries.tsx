import type { KeyboardEvent, RefObject } from "react";
import { useRef } from "react";
import type { CatalogAvailability } from "../catalog/availability";
import type { PortalCatalogEntry } from "../portal-catalog-wire";
import { assertNever } from "./assert-never";
import { Icons } from "./icons";
import { Action, StatusMark } from "./primitives";
import { Inspector } from "./shell";

function availabilityLabel(availability: CatalogAvailability): string {
  switch (availability) {
    case "available":
      return "Available";
    case "missing":
      return "Repository missing";
    case "unreadable":
      return "Repository unreadable";
    case "manifest-missing":
      return "Bearing manifest missing";
    case "invalid-manifest":
      return "Bearing manifest invalid";
    default:
      return assertNever(availability);
  }
}

export function EntryInspector({
  entry,
  onClose,
  returnFocusRef,
}: {
  readonly entry: PortalCatalogEntry;
  readonly onClose: () => void;
  readonly returnFocusRef: RefObject<HTMLElement | null>;
}) {
  const isAvailable = entry.availability === "available";
  return (
    <Inspector
      eyebrow="Catalog entry"
      onClose={onClose}
      returnFocusRef={returnFocusRef}
      title={entry.displayName}
    >
      <p className="inspector-body">
        {isAvailable
          ? "This registered repository is ready for project orientation."
          : (entry.detail ??
            "The Catalog entry is retained, but this repository cannot be opened right now.")}
      </p>
      <dl className="inspector-list">
        <div>
          <dt>Status</dt>
          <dd>{availabilityLabel(entry.availability)}</dd>
        </div>
        <div>
          <dt>Entry ID</dt>
          <dd>
            <code>{entry.entryId}</code>
          </dd>
        </div>
        <div>
          <dt>Location</dt>
          <dd>
            <code>{entry.repoRoot}</code>
          </dd>
        </div>
      </dl>
      {isAvailable ? (
        <a
          className="action action-primary inspector-enter"
          href={`/projects/${encodeURIComponent(entry.entryId)}`}
        >
          <span>Open project</span>
          <Icons.arrow />
        </a>
      ) : (
        <Action disabled>Open project</Action>
      )}
      <p className="inspector-note">Catalog lifecycle and repair remain in Agent Surface.</p>
    </Inspector>
  );
}

export function CatalogList({
  entries,
  onSelect,
  selectedId,
}: {
  readonly entries: readonly PortalCatalogEntry[];
  readonly onSelect: (entry: PortalCatalogEntry, trigger: HTMLButtonElement) => void;
  readonly selectedId: string | null;
}) {
  const rowRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const moveFocus = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let target = index;
    switch (event.key) {
      case "ArrowDown":
        target = Math.min(entries.length - 1, index + 1);
        break;
      case "ArrowUp":
        target = Math.max(0, index - 1);
        break;
      case "Home":
        target = 0;
        break;
      case "End":
        target = entries.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    rowRefs.current[target]?.focus();
  };

  return (
    <ul className="catalog-list" aria-label="Registered Bearing projects">
      {entries.map((entry, index) => {
        const available = entry.availability === "available";
        return (
          <li key={entry.entryId}>
            <button
              ref={(node) => {
                rowRefs.current[index] = node;
              }}
              className={`catalog-entry${selectedId === entry.entryId ? " is-selected" : ""}`}
              type="button"
              aria-pressed={selectedId === entry.entryId}
              onClick={(event) => onSelect(entry, event.currentTarget)}
              onKeyDown={(event) => moveFocus(event, index)}
            >
              <span className={`entry-orbit${available ? " is-available" : ""}`} aria-hidden="true">
                {available ? <Icons.check /> : <Icons.attention />}
              </span>
              <span className="entry-copy">
                <strong>{entry.displayName}</strong>
                <code>{entry.repoRoot}</code>
              </span>
              <StatusMark
                label={availabilityLabel(entry.availability)}
                tone={available ? "success" : "unavailable"}
              />
              <Icons.arrow className="entry-arrow" aria-hidden="true" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
