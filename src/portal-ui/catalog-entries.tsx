import type { CatalogAvailability } from "../catalog/availability";
import type { PortalCatalogEntry } from "../portal-catalog-wire";
import { assertNever } from "./assert-never";
import { Icons } from "./icons";
import { StatusMark } from "./primitives";

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

export function CatalogList({ entries }: { readonly entries: readonly PortalCatalogEntry[] }) {
  return (
    <ul className="catalog-list" aria-label="Registered Bearing projects">
      {entries.map((entry) => {
        const available = entry.availability === "available";
        const content = (
          <>
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
            {available ? <Icons.arrow className="entry-arrow" aria-hidden="true" /> : null}
          </>
        );
        return (
          <li key={entry.entryId}>
            {available ? (
              <a className="catalog-entry" href={`/projects/${encodeURIComponent(entry.entryId)}`}>
                {content}
              </a>
            ) : (
              <div className="catalog-entry catalog-entry-unavailable">{content}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
