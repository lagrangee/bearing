import { type RefObject, useEffect, useRef, useState } from "react";
import { Icons } from "./icons";
import { Action } from "./primitives";

export function ProjectTopbar({
  attentionCount,
  findDisabled,
  findRef,
  menuRef,
  navOpen,
  onOpenNavigation,
  onOpenFind,
  onRefreshAllSources,
  providerBusy,
  providerRefreshAvailable,
  projectLabel,
  projectTitle,
  suspended,
}: {
  readonly attentionCount: number | undefined;
  readonly findDisabled: boolean;
  readonly findRef: RefObject<HTMLButtonElement | null>;
  readonly menuRef: RefObject<HTMLButtonElement | null>;
  readonly navOpen: boolean;
  readonly onOpenNavigation: () => void;
  readonly onOpenFind: () => void;
  readonly onRefreshAllSources: (returnFocus: HTMLButtonElement | null) => void;
  readonly providerBusy: boolean;
  readonly providerRefreshAvailable: boolean;
  readonly projectLabel: string;
  readonly projectTitle: string;
  readonly suspended: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const refreshTriggerRef = useRef<HTMLButtonElement>(null);
  const refreshDialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (!confirming) return;
    const dialog = refreshDialogRef.current;
    if (dialog !== null && !dialog.open) dialog.showModal();
    return () => {
      if (dialog?.open === true) dialog.close();
      refreshTriggerRef.current?.focus();
    };
  }, [confirming]);
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
      <div className={`topbar-status${providerBusy ? " is-busy" : ""}`}>
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
        {providerRefreshAvailable ? (
          <div className="refresh-control">
            <Action
              ref={refreshTriggerRef}
              className="topbar-refresh"
              data-project-activation-action="manual"
              tone="primary"
              disabled={providerBusy}
              onClick={() => setConfirming(true)}
            >
              <Icons.refresh className={providerBusy ? "is-spinning" : ""} />
              <span>Refresh all sources</span>
            </Action>
          </div>
        ) : null}
      </div>
      {!confirming ? null : (
        <dialog
          ref={refreshDialogRef}
          aria-labelledby="refresh-all-sources-title"
          className="provider-refresh-dialog"
          onCancel={(event) => {
            event.preventDefault();
            setConfirming(false);
          }}
        >
          <h2 id="refresh-all-sources-title">Refresh all sources</h2>
          <p>
            This reads every current Work Binding. It can be slow and can use provider rate limits.
          </p>
          <div>
            <Action autoFocus tone="quiet" onClick={() => setConfirming(false)}>
              Cancel
            </Action>
            <Action
              data-project-activation-action="manual"
              tone="primary"
              onClick={() => {
                setConfirming(false);
                onRefreshAllSources(refreshTriggerRef.current);
              }}
            >
              Confirm refresh all sources
            </Action>
          </div>
        </dialog>
      )}
    </header>
  );
}
