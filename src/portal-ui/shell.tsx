import type { PropsWithChildren, KeyboardEvent as ReactKeyboardEvent, RefObject } from "react";
import { useCallback, useEffect, useRef } from "react";
import { Icons } from "./icons";
import { Action } from "./primitives";
import { useNarrowViewport } from "./use-narrow";

type ShellProps = PropsWithChildren<{
  readonly onRefresh?: () => void;
  readonly refreshing?: boolean;
  readonly title: string;
}>;

export function CatalogShell({ children, onRefresh, refreshing = false, title }: ShellProps) {
  return (
    <div className="catalog-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Bearing Portal home">
          <span className="brand-mark">C</span>
          <span>Bearing Portal</span>
        </a>
        <div className="catalog-context">
          <span className="catalog-context-label">Catalog</span>
          <h1>{title}</h1>
        </div>
        {onRefresh ? (
          <Action
            className="refresh-action"
            disabled={refreshing}
            onClick={onRefresh}
            aria-label={refreshing ? "Checking registered projects" : "Refresh registered projects"}
          >
            <Icons.refresh className={refreshing ? "is-spinning" : ""} />
            <span>{refreshing ? "Checking" : "Refresh"}</span>
          </Action>
        ) : null}
      </header>
      <main id="main-content" className="catalog-main">
        {children}
      </main>
    </div>
  );
}

type InspectorProps = PropsWithChildren<{
  readonly accessibleLabel?: string | undefined;
  readonly closeLabel?: string | undefined;
  readonly eyebrow: string;
  readonly onClose: () => void;
  readonly returnFocusRef?: RefObject<HTMLElement | null>;
  readonly title: string;
  readonly variant?: "technical-details" | undefined;
}>;

export function Inspector({
  accessibleLabel = "Selected context",
  children,
  closeLabel = "Close selected context",
  eyebrow,
  onClose,
  returnFocusRef,
  title,
  variant,
}: InspectorProps) {
  const narrow = useNarrowViewport();
  const dialogRef = useRef<HTMLDivElement>(null);
  const complementaryRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
  }, []);
  const close = useCallback(() => {
    const returnTarget = returnFocusRef?.current;
    onClose();
    window.requestAnimationFrame(() => {
      const active = document.activeElement;
      if (active === null || active === document.body || !active.isConnected) {
        returnTarget?.focus();
      }
    });
  }, [onClose, returnFocusRef]);
  useEffect(() => {
    const handleEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      close();
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [close]);
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key !== "Tab" || (!narrow && variant !== "technical-details")) return;
    const panel = dialogRef.current ?? complementaryRef.current;
    const focusable = Array.from(
      panel?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) ?? [],
    );
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  };
  const panelContent = (
    <>
      <button
        ref={closeRef}
        className="inspector-close"
        type="button"
        onClick={close}
        aria-label={closeLabel}
      >
        <Icons.close />
      </button>
      <p className="eyebrow">{eyebrow}</p>
      <h2>{title}</h2>
      {children}
    </>
  );
  return (
    <>
      {narrow ? (
        <div
          ref={dialogRef}
          className={`inspector${variant === undefined ? "" : ` inspector-${variant}`}`}
          aria-label={accessibleLabel}
          role="dialog"
          aria-modal="true"
          onKeyDown={handleKeyDown}
        >
          {panelContent}
        </div>
      ) : (
        <aside
          ref={complementaryRef}
          className={`inspector${variant === undefined ? "" : ` inspector-${variant}`}`}
          aria-label={accessibleLabel}
          onKeyDown={handleKeyDown}
        >
          {panelContent}
        </aside>
      )}
      <button className="inspector-scrim" type="button" onClick={close} aria-label={closeLabel} />
    </>
  );
}
