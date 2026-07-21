import type { ButtonHTMLAttributes, PropsWithChildren, ReactNode } from "react";
import { forwardRef } from "react";
import { assertNever } from "./assert-never";
import { Icons } from "./icons";

type ActionProps = PropsWithChildren<
  ButtonHTMLAttributes<HTMLButtonElement> & { readonly tone?: "primary" | "quiet" }
>;

export const Action = forwardRef<HTMLButtonElement, ActionProps>(function Action(
  { children, className = "", tone = "quiet", ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      className={`action action-${tone} ${className}`.trim()}
      type="button"
      {...props}
    >
      {children}
    </button>
  );
});

type StatusTone = "success" | "current" | "attention" | "unavailable" | "information";

function StatusIcon({ tone }: { readonly tone: StatusTone }) {
  switch (tone) {
    case "success":
      return <Icons.check />;
    case "current":
    case "unavailable":
      return null;
    case "attention":
      return <Icons.attention />;
    case "information":
      return <Icons.information />;
    default:
      return assertNever(tone);
  }
}

export function StatusMark({ label, tone }: { readonly label: string; readonly tone: StatusTone }) {
  return (
    <span className={`status-mark status-${tone}`}>
      <span className="status-symbol" aria-hidden="true">
        <StatusIcon tone={tone} />
      </span>
      <span>{label}</span>
    </span>
  );
}

export function EmptyState({
  action,
  detail,
  title,
}: {
  readonly action?: ReactNode;
  readonly detail: string;
  readonly title: string;
}) {
  return (
    <section className="empty-state">
      <span className="empty-orbit" aria-hidden="true">
        <Icons.overview />
      </span>
      <h2>{title}</h2>
      <p>{detail}</p>
      {action}
    </section>
  );
}

export function LoadingState() {
  return (
    <div className="catalog-loading" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      <span>Checking registered projects</span>
    </div>
  );
}
