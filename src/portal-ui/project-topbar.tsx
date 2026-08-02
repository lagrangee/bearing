import { type RefObject, useEffect, useState } from "react";
import { Icons } from "./icons";
import { Action } from "./primitives";
import type { ActivationState } from "./project-activation-state";

type OperationStatus = Readonly<{
  busy: boolean;
  label: string;
  tone: "current" | "success" | "error" | "muted";
}>;

const confirmationLabel = (confirmation: "up-to-date" | "updated" | "checked-recently") => {
  switch (confirmation) {
    case "up-to-date":
      return "Up to date";
    case "updated":
      return "Updated";
    case "checked-recently":
      return "Checked recently";
  }
};

const operationStatus = (state: ActivationState): OperationStatus => {
  switch (state.kind) {
    case "loading-cache":
      return { busy: true, label: "Loading cache", tone: "current" };
    case "checking":
      return { busy: true, label: "Checking", tone: "current" };
    case "refreshing":
      return { busy: true, label: "Refreshing view", tone: "current" };
    case "syncing":
      return { busy: true, label: "Syncing", tone: "current" };
    case "settled":
      return { busy: false, label: confirmationLabel(state.confirmation), tone: "success" };
    case "failed":
      return {
        busy: false,
        label: state.operation === "sync" ? "Sync failed" : "Check failed",
        tone: "error",
      };
    case "unavailable":
      return { busy: false, label: "Unavailable", tone: "muted" };
  }
};

function OperationLabel({ operation }: { readonly operation: OperationStatus }) {
  return (
    <span
      className={`project-operation operation-${operation.tone}`}
      role="status"
      aria-live="polite"
    >
      {operation.busy ? <span className="spinner" aria-hidden="true" /> : null}
      {operation.label}
    </span>
  );
}

const CURRENT_OPERATION = {
  busy: false,
  label: "Up to date",
  tone: "success",
} as const satisfies OperationStatus;

function SettledOperationLabel({ operation }: { readonly operation: OperationStatus }) {
  const [displayedOperation, setDisplayedOperation] = useState(operation);
  useEffect(() => {
    if (operation.label === CURRENT_OPERATION.label) return;
    const timer = window.setTimeout(() => setDisplayedOperation(CURRENT_OPERATION), 1_600);
    return () => window.clearTimeout(timer);
  }, [operation.label]);
  return <OperationLabel operation={displayedOperation} />;
}

export function ProjectTopbar({
  attentionCount,
  findDisabled,
  findRef,
  menuRef,
  navOpen,
  onOpenNavigation,
  onOpenFind,
  onSync,
  projectLabel,
  projectTitle,
  state,
  suspended,
}: {
  readonly attentionCount: number | undefined;
  readonly findDisabled: boolean;
  readonly findRef: RefObject<HTMLButtonElement | null>;
  readonly menuRef: RefObject<HTMLButtonElement | null>;
  readonly navOpen: boolean;
  readonly onOpenNavigation: () => void;
  readonly onOpenFind: () => void;
  readonly onSync: () => void;
  readonly projectLabel: string;
  readonly projectTitle: string;
  readonly state: ActivationState;
  readonly suspended: boolean;
}) {
  const operation = operationStatus(state);
  const syncLabel =
    state.kind === "refreshing"
      ? "Refreshing"
      : state.kind === "syncing"
        ? "Syncing"
        : state.kind === "failed"
          ? "Retry"
          : "Sync";
  const syncRunning = state.kind === "refreshing" || state.kind === "syncing";
  const syncDisabled =
    state.kind === "loading-cache" || syncRunning || state.kind === "unavailable";
  return (
    <header className="topbar" inert={suspended} aria-hidden={suspended}>
      <button
        ref={menuRef}
        className="mobile-menu"
        type="button"
        onClick={onOpenNavigation}
        aria-label="Open navigation"
        aria-expanded={navOpen}
        aria-controls="project-navigation"
      >
        {navOpen ? <Icons.close /> : <Icons.menu />}
      </button>
      <a className="brand" href="/" aria-label="Bearing Portal home">
        <span className="brand-mark">C</span>
        <span>Bearing Portal</span>
      </a>
      <a
        className="project-switcher"
        href="/"
        aria-label={`Return to Project Catalog from ${projectLabel}`}
      >
        <code>{projectLabel}</code>
        <strong>{projectTitle}</strong>
        <Icons.chevron aria-hidden="true" />
      </a>
      <div className={`topbar-status${operation.busy ? " is-busy" : ""}`}>
        {attentionCount === undefined ? (
          <span className="attention-compact attention-unavailable">
            <Icons.unavailable aria-hidden="true" />
            <span>
              <small>Attention</small>
              <strong>Unavailable</strong>
            </span>
          </span>
        ) : attentionCount === 0 ? (
          <span className="attention-compact attention-clear">
            <Icons.check aria-hidden="true" />
            <span>
              <small>Attention</small>
              <strong>Clear</strong>
            </span>
          </span>
        ) : (
          <a className="attention-compact attention-present" href="#attention-queue">
            <Icons.attention aria-hidden="true" />
            <span>
              <small>Attention</small>
              <strong>{attentionCount}</strong>
            </span>
          </a>
        )}
        {operation.tone === "success" ? (
          <SettledOperationLabel key={operation.label} operation={operation} />
        ) : (
          <OperationLabel operation={operation} />
        )}
        <Action
          ref={findRef}
          className="topbar-find"
          disabled={findDisabled}
          onClick={onOpenFind}
          aria-label="Find in project"
        >
          <Icons.search />
          <span>Find</span>
        </Action>
        <Action
          className="topbar-sync"
          tone="primary"
          data-project-activation-action="manual"
          disabled={syncDisabled}
          onClick={onSync}
          aria-label={state.kind === "failed" ? "Retry project synchronization" : syncLabel}
        >
          <Icons.refresh className={syncRunning ? "is-spinning" : ""} />
          <span>{syncLabel}</span>
        </Action>
      </div>
    </header>
  );
}
