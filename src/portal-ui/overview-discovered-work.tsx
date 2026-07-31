import { useState } from "react";
import type { NativeScopeDiscoveryProjection } from "../project-snapshot/contract";
import { Icons } from "./icons";
import { Action } from "./primitives";

type DiscoveryOperationState = Readonly<{ state: "idle" | "running" | "failed" }>;

const countLabel = (
  discovery: Exclude<NativeScopeDiscoveryProjection, Readonly<{ state: "never-run" }>>,
): string => {
  switch (discovery.count.kind) {
    case "exact":
      return `${discovery.count.value} scope${discovery.count.value === 1 ? "" : "s"}`;
    case "at-least":
      return `At least ${discovery.count.value} scope${discovery.count.value === 1 ? "" : "s"}`;
    case "unavailable":
      return "Count unavailable";
  }
};

const statusCopy = (
  discovery: NativeScopeDiscoveryProjection,
  operation: DiscoveryOperationState,
): string => {
  if (operation.state === "running") {
    return "Refreshing discovery. The prior observation remains visible.";
  }
  if (operation.state === "failed") {
    return "The refresh request failed. Prior trustworthy discovery remains visible.";
  }
  if (discovery.state === "never-run") {
    return "Discovery has not run. Ordinary Sync and page activation do not discover native work.";
  }
  if (discovery.latestAttempt !== null) {
    if (discovery.latestAttempt.observationId === discovery.observationId) {
      if (discovery.state === "unsupported") {
        return "The confirmed provider contract does not expose a supported discovery capability.";
      }
      if (discovery.state === "unavailable" || discovery.state === "invalid") {
        return "The latest discovery attempt could not establish a trustworthy collection. This is not an empty result.";
      }
      return `The latest partial observation is visible. Its trustworthy summaries have ${discovery.freshness} freshness; omissions are unknown.`;
    }
    return `The latest ${discovery.latestAttempt.state} attempt is visible. Prior trustworthy summaries remain ${discovery.freshness}; omissions are unknown.`;
  }
  if (discovery.state === "unsupported") {
    return "The confirmed provider contract does not expose a supported discovery capability.";
  }
  if (discovery.state === "unavailable" || discovery.state === "invalid") {
    return "Discovery could not establish a current collection. This is not an empty result.";
  }
  if (discovery.state === "partial") {
    return "Discovery retained a trustworthy subset; additional scopes may be missing.";
  }
  if (discovery.confirmedUnboundEmpty) {
    return "The latest complete current observation found no native scope that is unlinked from an Effort.";
  }
  return "Discovery summaries provide orientation only; they do not establish completion or readiness.";
};

export function OverviewDiscoveredWork({
  discovery,
  onRefresh,
  operation,
}: {
  readonly discovery: NativeScopeDiscoveryProjection;
  readonly onRefresh: () => void;
  readonly operation: DiscoveryOperationState;
}) {
  const [copied, setCopied] = useState(false);
  const unbound =
    discovery.state === "never-run"
      ? []
      : discovery.scopes.filter((scope) => scope.bindingContext.state === "unbound");
  const uncertain =
    discovery.state === "never-run" ||
    discovery.state !== "available" ||
    discovery.freshness !== "current" ||
    discovery.coverage !== "complete" ||
    discovery.latestAttempt !== null ||
    discovery.count.kind !== "exact" ||
    operation.state !== "idle";
  const showCollection = unbound.length > 0 || uncertain;
  const refreshLabel =
    discovery.state === "never-run" ? "Discover native work" : "Refresh discovered work";
  const copyPrompt = async () => {
    const identities = unbound.map((scope) => scope.summary.binding.nativeScope).join(", ");
    await navigator.clipboard.writeText(
      identities.length === 0
        ? "Review the current Native Scope Discovery uncertainty and suggest next steps. Do not create or change canonical planning."
        : `Discuss these discovered native scopes and suggest planning options without creating canonical planning: ${identities}`,
    );
    setCopied(true);
  };
  return (
    <section
      className={`overview-section discovered-work${showCollection ? "" : " observed-empty"}`}
      aria-labelledby="discovered-work-heading"
    >
      <div className="section-heading">
        <div>
          <p className="eyebrow">
            {showCollection ? "Discovered unbound native work" : "Native work observed"}
          </p>
          <h2 id="discovered-work-heading">
            {showCollection ? "Discovered Work" : "No unlinked native work observed"}
          </h2>
        </div>
        <Action
          data-project-activation-action="manual"
          disabled={operation.state === "running"}
          onClick={onRefresh}
        >
          <Icons.refresh className={operation.state === "running" ? "is-spinning" : ""} />
          {operation.state === "running" ? "Refreshing" : refreshLabel}
        </Action>
      </div>
      <p className="section-intro" role="status" aria-live="polite">
        {statusCopy(discovery, operation)}
      </p>
      {discovery.state === "never-run" ? null : (
        <>
          <div className="discovery-observation">
            <span>{countLabel(discovery)}</span>
            <span>{discovery.coverage} coverage</span>
            <span>{discovery.freshness} freshness</span>
            <time dateTime={discovery.observedAt}>
              Observed {new Date(discovery.observedAt).toLocaleString()}
            </time>
          </div>
          {discovery.latestAttempt === null ? null : (
            <aside className="discovery-attempt" aria-label="Latest discovery attempt">
              <p>
                Latest attempt: <strong>{discovery.latestAttempt.state}</strong>{" "}
                <time dateTime={discovery.latestAttempt.observedAt}>
                  {new Date(discovery.latestAttempt.observedAt).toLocaleString()}
                </time>
              </p>
              {discovery.latestAttempt.diagnostics.length === 0 ? null : (
                <ul>
                  {discovery.latestAttempt.diagnostics.map((diagnostic) => (
                    <li key={`${diagnostic.code}:${diagnostic.target}:${diagnostic.message}`}>
                      <code>{diagnostic.code}</code> — {diagnostic.message}
                    </li>
                  ))}
                </ul>
              )}
            </aside>
          )}
        </>
      )}
      {unbound.length === 0 ? null : (
        <div className="discovered-work-grid">
          {unbound.map((scope) => (
            <article className="discovered-work-card" key={scope.summary.identity}>
              <div className="native-card-heading">
                <span className="native-kind">{scope.summary.driver}</span>
                <span className="trust-chip">Summary only</span>
              </div>
              <h3>{scope.summary.title}</h3>
              <code>{scope.summary.locator}</code>
              <dl>
                <div>
                  <dt>Root role</dt>
                  <dd>{scope.summary.rootRole}</dd>
                </div>
                <div>
                  <dt>Classification</dt>
                  <dd>{scope.summary.classification}</dd>
                </div>
                <div>
                  <dt>Lifecycle</dt>
                  <dd>{scope.summary.lifecycle}</dd>
                </div>
                <div>
                  <dt>Subjects</dt>
                  <dd>{scope.summary.subjects.length}</dd>
                </div>
                <div>
                  <dt>Effort</dt>
                  <dd>Not linked</dd>
                </div>
              </dl>
            </article>
          ))}
        </div>
      )}
      {!showCollection ? null : (
        <Action className="agent-handoff" onClick={() => void copyPrompt()}>
          {copied ? <Icons.check /> : <Icons.copy />}
          {copied ? "Agent prompt copied" : "Copy Agent discussion prompt"}
        </Action>
      )}
    </section>
  );
}
