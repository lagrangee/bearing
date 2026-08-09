import { useId } from "react";
import type { ProjectedNativeTime, SourceEventTime } from "../source-event-time";
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
  readonly time: SourceEventTime | Exclude<ProjectedNativeTime, { availability: "unsupported" }>;
  readonly timeZone?: string | undefined;
}) {
  const displayNow = useTimeDisplayNow(now);
  const absolute = formatSourceEventAbsolute(time, locale, timeZone);
  const relative = formatSourceEventRelative(time, displayNow, locale);
  const descriptionId = useId();
  if (time.availability === "unavailable") {
    return null;
  }
  const inferred = "basis" in time && time.basis === "inferred-source-metadata";
  const disclosure = inferred
    ? {
        "aria-describedby": descriptionId,
        tabIndex: 0,
        title: "Approximate time from current source metadata.",
      }
    : {};
  const inferredDescription = inferred ? (
    <span className="sr-only" id={descriptionId}>
      Approximate time inferred from current source metadata; not an audit-grade source event.
    </span>
  ) : null;
  if (mode === "compact") {
    return (
      <span
        className="source-event-time compact"
        data-absolute={absolute}
        {...disclosure}
        title={inferred ? `${absolute}. ${disclosure.title}` : absolute}
      >
        <time dateTime={time.value}>{relative}</time>
        <span className="sr-only">
          {label}: {absolute}
        </span>
        {inferredDescription}
      </span>
    );
  }
  return (
    <span className="source-event-time detail" {...disclosure}>
      <span>
        <time dateTime={time.value}>{absolute}</time>
        {relative === absolute ? null : <small>{relative}</small>}
      </span>
      {inferredDescription}
    </span>
  );
}
