import type { MouseEvent } from "react";
import { assertNever } from "./assert-never";
import { Icons } from "./icons";
import type { PlanningLineageEvent } from "./planning-lineage-events";
import { SourceEventTimeValue } from "./source-event-time";

export type GateState = "passed" | "focused" | "planned" | "superseded" | "unknown";

export type Gate = {
  readonly href: string;
  readonly id: string;
  readonly label: string;
  readonly state: GateState;
  readonly title: string;
  readonly event?: PlanningLineageEvent | undefined;
};

function gateNote(state: GateState): string {
  switch (state) {
    case "passed":
      return "Passed";
    case "focused":
      return "Current";
    case "planned":
      return "Planned";
    case "superseded":
      return "Superseded";
    case "unknown":
      return "State unavailable";
    default:
      return assertNever(state);
  }
}

const gateDateFormatter = new Intl.DateTimeFormat("en", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

const availableEvent = (
  event: PlanningLineageEvent | undefined,
): PlanningLineageEvent | undefined =>
  event?.time.availability === "available" ? event : undefined;

const gateEventDate = (event: PlanningLineageEvent | undefined): string | undefined => {
  const time = event?.time;
  return time?.availability === "available"
    ? gateDateFormatter.format(new Date(time.value))
    : undefined;
};

const eventNote = (event: PlanningLineageEvent | undefined): string => {
  const date = gateEventDate(event);
  return date === undefined ? "" : `, ${date}`;
};

function GateMarker({ state }: { readonly state: GateState }) {
  switch (state) {
    case "passed":
      return (
        <span className="gate-marker" aria-hidden="true">
          <Icons.check />
        </span>
      );
    case "focused":
    case "planned":
    case "superseded":
    case "unknown":
      return <span className="gate-marker" aria-hidden="true" />;
    default:
      return assertNever(state);
  }
}

function GateNode({
  gate,
  onOpen,
}: {
  readonly gate: Gate;
  readonly onOpen?: (gate: Gate, event: MouseEvent<HTMLAnchorElement>) => void;
}) {
  const date = gateEventDate(gate.event);
  const content = (
    <>
      <GateMarker state={gate.state} />
      <span className="gate-copy">
        <strong>
          {gate.label} · {gate.title}
        </strong>
        <small>
          {gateNote(gate.state)}
          {date === undefined || gate.event?.time.availability !== "available" ? null : (
            <>
              {" · "}
              <time dateTime={gate.event.time.value}>{date}</time>
            </>
          )}
        </small>
      </span>
    </>
  );
  const accessibleName = `${gate.label}, ${gate.title}, ${gateNote(gate.state)}${eventNote(gate.event)}`;
  return (
    <a
      className={`gate-node gate-${gate.state}`}
      href={gate.href}
      aria-label={accessibleName}
      onClick={(event) => onOpen?.(gate, event)}
    >
      {content}
    </a>
  );
}

export function RoadmapHorizon({
  gates,
  label,
  onOpen,
}: {
  readonly gates: readonly Gate[];
  readonly label: string;
  readonly onOpen?: (gate: Gate, event: MouseEvent<HTMLAnchorElement>) => void;
}) {
  return (
    <fieldset className="horizon">
      <legend className="sr-only">{label}</legend>
      {gates.map((gate, index) => (
        <div className="gate-segment" key={gate.id}>
          <GateNode gate={gate} {...(onOpen === undefined ? {} : { onOpen })} />
          {index < gates.length - 1 ? <span className="horizon-line" aria-hidden="true" /> : null}
        </div>
      ))}
    </fieldset>
  );
}

export function RoadmapIndexRow({
  gates,
  href,
  intent,
  horizon,
  lifecycle,
  event,
  onOpen,
  onOpenGate,
  title,
}: {
  readonly gates: readonly Gate[];
  readonly href: string;
  readonly horizon: "active-horizon" | "exhausted" | "unknown";
  readonly intent: string;
  readonly lifecycle?: string;
  readonly event?: PlanningLineageEvent | undefined;
  readonly onOpen?: ((event: MouseEvent<HTMLAnchorElement>) => void) | undefined;
  readonly onOpenGate?: ((gate: Gate, event: MouseEvent<HTMLAnchorElement>) => void) | undefined;
  readonly title: string;
}) {
  const visibleEvent = availableEvent(event);
  return (
    <article className="roadmap-index-row">
      {lifecycle === undefined ? null : <span className="roadmap-lifecycle">{lifecycle}</span>}
      <a href={href} onClick={onOpen}>
        {title}
      </a>
      {visibleEvent === undefined ? null : (
        <small className="roadmap-event">
          {visibleEvent.label}{" "}
          <SourceEventTimeValue
            label={`${title} ${visibleEvent.label}`}
            mode="compact"
            time={visibleEvent.time}
          />
        </small>
      )}
      <p>{intent}</p>
      {gates.length === 0 ? (
        <p className="horizon-empty" role="status">
          {horizon === "exhausted"
            ? "Declared Gate horizon exhausted; Roadmap completion remains explicit."
            : horizon === "unknown"
              ? "Gate horizon state is unavailable."
              : "No declared Gates are available in this active horizon."}
        </p>
      ) : (
        <RoadmapHorizon
          gates={gates}
          label={`${title} horizon`}
          {...(onOpenGate === undefined ? {} : { onOpen: onOpenGate })}
        />
      )}
    </article>
  );
}
