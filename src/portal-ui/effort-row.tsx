import type { MouseEvent } from "react";
import { Icons } from "./icons";
import type { PlanningLineageEvent } from "./planning-lineage-events";
import { formatSourceEventAbsolute, SourceEventTimeValue } from "./source-event-time";

export function EffortRow({
  fog,
  event,
  frontier,
  gate,
  href,
  lifecycle,
  onOpen,
  onSelect,
  title,
}: {
  readonly fog?: string;
  readonly event?: PlanningLineageEvent | undefined;
  readonly frontier: string;
  readonly gate: string;
  readonly href?: string;
  readonly lifecycle: string;
  readonly onOpen?: (event: MouseEvent<HTMLAnchorElement>) => void;
  readonly onSelect?: ((trigger: HTMLButtonElement) => void) | undefined;
  readonly title: string;
}) {
  const eventLabel =
    event === undefined ? "" : `, ${event.label} ${formatSourceEventAbsolute(event.time)}`;
  return (
    <div className={`effort-row effort-${lifecycle}`}>
      {href === undefined ? (
        <button
          className="effort-row-primary"
          type="button"
          aria-label={`${title}, ${lifecycle}${eventLabel}, Target Gate ${gate}, ${frontier}${fog === undefined ? "" : `, Fog ${fog}`}`}
          onClick={(event) => onSelect?.(event.currentTarget)}
        >
          <EffortRowContent
            {...(event === undefined ? {} : { event })}
            {...(fog === undefined ? {} : { fog })}
            frontier={frontier}
            gate={gate}
            lifecycle={lifecycle}
            title={title}
          />
        </button>
      ) : (
        <a
          className="effort-row-primary"
          href={href}
          aria-label={`${title}, ${lifecycle}${eventLabel}, Target Gate ${gate}, ${frontier}${fog === undefined ? "" : `, Fog ${fog}`}`}
          onClick={onOpen}
        >
          <EffortRowContent
            {...(event === undefined ? {} : { event })}
            {...(fog === undefined ? {} : { fog })}
            frontier={frontier}
            gate={gate}
            lifecycle={lifecycle}
            title={title}
          />
        </a>
      )}
      {href === undefined || onSelect === undefined ? null : (
        <button
          className="row-quick-look"
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

function EffortRowContent({
  event,
  fog,
  frontier,
  gate,
  lifecycle,
  title,
}: {
  readonly fog?: string;
  readonly event?: PlanningLineageEvent | undefined;
  readonly frontier: string;
  readonly gate: string;
  readonly lifecycle: string;
  readonly title: string;
}) {
  return (
    <>
      <span className="effort-title">
        <i aria-hidden="true" />
        <span>
          <strong>{title}</strong>
          <small>{lifecycle}</small>
          {event === undefined ? null : (
            <small>
              {event.label}{" "}
              <SourceEventTimeValue
                label={`${title} ${event.label}`}
                mode="compact"
                time={event.time}
              />
            </small>
          )}
        </span>
      </span>
      <span>
        <small>Target Gate</small>
        <strong>{gate}</strong>
      </span>
      <span className="effort-frontier">
        <small>Frontier</small>
        <strong>{frontier}</strong>
      </span>
      {fog === undefined ? null : (
        <span className="effort-fog">
          <small>Fog</small>
          <strong>{fog}</strong>
        </span>
      )}
      <Icons.arrow aria-hidden="true" />
    </>
  );
}
