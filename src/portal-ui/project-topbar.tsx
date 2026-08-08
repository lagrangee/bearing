import { type RefObject, useEffect, useState } from "react";
import { Icons } from "./icons";
import { Action } from "./primitives";
import type { ActivationState, ProjectConfirmation } from "./project-activation-state";

function SettledReadLabel({ confirmation }: { readonly confirmation: ProjectConfirmation }) {
  const [visible, setVisible] = useState(confirmation === "updated");
  useEffect(() => {
    if (!visible) return undefined;
    const timer = window.setTimeout(() => setVisible(false), 1_600);
    return () => window.clearTimeout(timer);
  }, [visible]);
  return visible ? "Updated" : "Refresh";
}

const syncPresentation = (state: ActivationState) => {
  switch (state.kind) {
    case "loading-cache":
      return { busy: true, disabled: true, label: "Loading" } as const;
    case "checking":
      return { busy: true, disabled: false, label: "Checking" } as const;
    case "refreshing":
      return { busy: true, disabled: true, label: "Refreshing" } as const;
    case "syncing":
      return { busy: true, disabled: true, label: "Syncing" } as const;
    case "failed":
      return { busy: false, disabled: false, label: "Retry" } as const;
    case "unavailable":
      return { busy: false, disabled: true, label: "Unavailable" } as const;
    case "settled":
      return { busy: false, disabled: false, label: undefined } as const;
  }
};

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
  const sync = syncPresentation(state);
  const syncLabel =
    state.kind === "settled" ? (
      <SettledReadLabel key={state.confirmation} confirmation={state.confirmation} />
    ) : (
      sync.label
    );
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
      <strong className="project-title-narrow">{projectTitle}</strong>
      <div className={`topbar-status${sync.busy ? " is-busy" : ""}`}>
        {attentionCount !== undefined && attentionCount > 0 ? (
          <a
            className="attention-compact attention-present"
            href="#attention-queue"
            aria-label={`${attentionCount} items need attention`}
          >
            <Icons.attention aria-hidden="true" />
            <strong>{attentionCount}</strong>
          </a>
        ) : null}
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
        <div className="sync-control">
          <Action
            className="topbar-sync"
            tone={state.kind === "failed" ? "quiet" : "primary"}
            data-project-activation-action="manual"
            disabled={sync.disabled}
            onClick={onSync}
            aria-describedby={state.kind === "failed" ? "sync-failure-detail" : undefined}
          >
            <Icons.refresh className={sync.busy ? "is-spinning" : ""} />
            <span aria-live="polite">{syncLabel}</span>
          </Action>
          {state.kind === "failed" ? (
            <span id="sync-failure-detail" className="sync-failure-detail" role="alert">
              {state.error.message}
              {state.view === undefined ? null : " Cached project content remains visible."}
            </span>
          ) : null}
        </div>
      </div>
    </header>
  );
}
