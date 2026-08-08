import type { RefObject } from "react";
import type { PortalProviderApplicationResponse } from "../portal-provider-application-wire";
import { ProviderObservationTime } from "./provider-observation-time";

const observedLabel = (count: number): string =>
  `${count} provider source${count === 1 ? "" : "s"} observed.`;

export function CopyDiagnosticReference({ reference }: { readonly reference: string }) {
  const copy = (): void => {
    if (navigator.clipboard === undefined) return;
    void navigator.clipboard.writeText(reference).catch(() => undefined);
  };
  return (
    <span className="provider-diagnostic">
      <code>{reference}</code>
      <button type="button" onClick={copy}>
        Copy diagnostic reference
      </button>
    </span>
  );
}

export function ProviderObservationStatus({
  application,
  statusRef,
}: {
  readonly application:
    | Readonly<{ state: "idle" }>
    | Readonly<{ state: "running"; action: string }>
    | Readonly<{ state: "settled"; result: PortalProviderApplicationResponse }>;
  readonly statusRef: RefObject<HTMLDivElement | null>;
}) {
  if (application.state === "idle") return null;
  if (application.state === "running") {
    return (
      <div ref={statusRef} className="provider-observation-status" role="status" tabIndex={-1}>
        Observing provider source…
      </div>
    );
  }
  const result = application.result;
  if (result.state === "completed") {
    return (
      <div ref={statusRef} className="provider-observation-status" role="status" tabIndex={-1}>
        <strong>{observedLabel(result.acquisitionCount)}</strong>
        {result.observations.map((observation) =>
          observation.observedAt === undefined ? null : (
            <ProviderObservationTime
              key={observation.scope}
              label="Observed"
              value={observation.observedAt}
            />
          ),
        )}
      </div>
    );
  }
  return (
    <div
      ref={statusRef}
      className="provider-observation-status provider-observation-attention"
      role="status"
      tabIndex={-1}
    >
      <strong>{result.explanation}</strong>
      {result.observations.map((observation) =>
        observation.observedAt === undefined ? null : (
          <ProviderObservationTime
            key={observation.scope}
            label="Last valid observation"
            value={observation.observedAt}
          />
        ),
      )}
      <span>{result.nextAction}</span>
      {result.diagnostics.map((diagnostic) => (
        <CopyDiagnosticReference key={diagnostic.reference} reference={diagnostic.reference} />
      ))}
    </div>
  );
}
