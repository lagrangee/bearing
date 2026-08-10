import { useId } from "react";
import {
  formatAbsoluteInstant,
  formatRelativeInstant,
  useTimeDisplayNow,
} from "./time-presentation";

export function ProviderObservationTime({
  label,
  locale,
  now,
  timeZone,
  value,
}: {
  readonly label?: string | undefined;
  readonly locale?: string | undefined;
  readonly now?: number | undefined;
  readonly timeZone?: string | undefined;
  readonly value: string;
}) {
  const displayNow = useTimeDisplayNow(now);
  const absolute = formatAbsoluteInstant(value, locale, timeZone);
  const relative = formatRelativeInstant(value, displayNow, locale);
  const descriptionId = useId();
  return (
    <button
      aria-describedby={descriptionId}
      className="provider-observation-time"
      data-absolute={absolute}
      title={absolute}
      type="button"
    >
      {label === undefined ? null : `${label}: `}
      <time dateTime={value}>{relative}</time>
      <span className="sr-only" id={descriptionId}>
        {absolute}
      </span>
    </button>
  );
}
