import type { SourceEventTime } from "../source-event-time";
import {
  formatAbsoluteInstant,
  formatRelativeInstant,
  useTimeDisplayNow,
} from "./time-presentation";

export const formatSourceEventAbsolute = (
  time: SourceEventTime,
  locale?: string,
  timeZone?: string,
): string => {
  if (time.availability === "unavailable") return "";
  if (time.precision === "date") return time.value;
  return formatAbsoluteInstant(time.value, locale, timeZone);
};

export const formatSourceEventRelative = (
  time: SourceEventTime,
  now: number,
  locale?: string,
): string => {
  if (time.availability === "unavailable") return "";
  if (time.precision === "date") return time.value;
  return formatRelativeInstant(time.value, now, locale);
};

export function SourceEventTimeValue({
  label,
  locale,
  mode,
  now,
  time,
  timeZone,
}: {
  readonly label: string;
  readonly locale?: string | undefined;
  readonly mode: "compact" | "detail";
  readonly now?: number | undefined;
  readonly time: SourceEventTime;
  readonly timeZone?: string | undefined;
}) {
  const displayNow = useTimeDisplayNow(now);
  const absolute = formatSourceEventAbsolute(time, locale, timeZone);
  const relative = formatSourceEventRelative(time, displayNow, locale);
  if (time.availability === "unavailable") {
    return null;
  }
  if (mode === "compact") {
    return (
      <span className="source-event-time compact" data-absolute={absolute} title={absolute}>
        <time dateTime={time.value}>{relative}</time>
        <span className="sr-only">
          {label}: {absolute}
        </span>
      </span>
    );
  }
  return (
    <span className="source-event-time detail">
      <span>
        <time dateTime={time.value}>{absolute}</time>
        {relative === absolute ? null : <small>{relative}</small>}
      </span>
    </span>
  );
}
