import type { MouseEvent } from "react";
import { assertNever } from "./assert-never";
import { Icons } from "./icons";

export type GateState = "passed" | "focused" | "planned" | "superseded" | "unknown";

export type Gate = {
  readonly id: string;
  readonly label: string;
  readonly state: GateState;
  readonly title: string;
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

export function RoadmapHorizon({
  gates,
  label,
  onSelect,
}: {
  readonly gates: readonly Gate[];
  readonly label: string;
  readonly onSelect?: (gate: Gate, trigger: HTMLButtonElement) => void;
}) {
  return (
    <fieldset className="horizon">
      <legend className="sr-only">{label}</legend>
      {gates.map((gate, index) => (
        <div className="gate-segment" key={gate.id}>
          <button
            className={`gate-node gate-${gate.state}`}
            type="button"
            aria-label={`${gate.label}, ${gate.title}, ${gateNote(gate.state)}`}
            onClick={(event) => onSelect?.(gate, event.currentTarget)}
          >
            <GateMarker state={gate.state} />
            <span className="gate-copy">
              <strong>
                {gate.label} · {gate.title}
              </strong>
              <small>{gateNote(gate.state)}</small>
            </span>
          </button>
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
  onOpen,
  onSelectGate,
  title,
}: {
  readonly gates: readonly Gate[];
  readonly href: string;
  readonly horizon: "active-horizon" | "exhausted" | "unknown";
  readonly intent: string;
  readonly lifecycle?: string;
  readonly onOpen?: ((event: MouseEvent<HTMLAnchorElement>) => void) | undefined;
  readonly onSelectGate?: ((gate: Gate, trigger: HTMLButtonElement) => void) | undefined;
  readonly title: string;
}) {
  return (
    <article className="roadmap-index-row">
      {lifecycle === undefined ? null : <span className="roadmap-lifecycle">{lifecycle}</span>}
      <a href={href} onClick={onOpen}>
        {title}
      </a>
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
          {...(onSelectGate === undefined ? {} : { onSelect: onSelectGate })}
        />
      )}
    </article>
  );
}
