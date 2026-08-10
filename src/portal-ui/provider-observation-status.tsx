import type { RefObject } from "react";
import type { PortalProviderApplicationResponse } from "../portal-provider-application-wire";
import { ProviderObservationTime } from "./provider-observation-time";

const checkedLabel = (count: number): string => `${count} source${count === 1 ? "" : "s"} checked.`;

export type ProviderObservationApplication =
  | Readonly<{ state: "idle" }>
  | Readonly<{ state: "running"; action: string }>
  | Readonly<{ state: "settled"; result: PortalProviderApplicationResponse }>;

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
  placement,
  statusRef,
}: {
  readonly application: ProviderObservationApplication;
  readonly placement: "project" | "source";
  readonly statusRef: RefObject<HTMLDivElement | null>;
}) {
  if (application.state === "idle") return null;
  if (application.state === "running") {
    if (placement === "source") return null;
    return (
      <span className="sr-only" role="status">
        Refreshing sources.
      </span>
    );
  }
  const result = application.result;
  if (result.state === "completed") {
    if (placement === "source") return null;
    return (
      <span className="sr-only" role="status">
        {checkedLabel(result.acquisitionCount)}
      </span>
    );
  }
  const allSources = result.action === "all-sources-refresh";
  if ((placement === "project") !== allSources) return null;
  return (
    <div
      ref={statusRef}
      className={
        placement === "project"
          ? "provider-observation-status provider-observation-attention"
          : "source-observation-feedback"
      }
      role="status"
      tabIndex={-1}
    >
      <strong>
        {allSources ? "Refresh all sources needs attention." : "Source refresh needs attention."}
      </strong>
      <span>{result.explanation}</span>
      {result.observations.map((observation) =>
        observation.observedAt === undefined ? null : (
          <ProviderObservationTime
            key={observation.scope}
            label="Last checked"
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
