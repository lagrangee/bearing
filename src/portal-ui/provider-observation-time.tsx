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
  return (
    <span className="provider-observation-time">
      {label === undefined ? null : `${label}: `}
      <time dateTime={value}>{absolute}</time>
      <small>{relative}</small>
    </span>
  );
}
