import { useEffect, useState } from "react";
import type { SourceEventTime } from "../source-event-time";

const absoluteFormatter = (locale?: string, timeZone?: string): Intl.DateTimeFormat =>
  new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    ...(timeZone === undefined ? {} : { timeZone }),
  });

export const formatSourceEventAbsolute = (
  time: SourceEventTime,
  locale?: string,
  timeZone?: string,
): string => {
  if (time.availability === "unavailable") return "";
  if (time.precision === "date") return time.value;
  return absoluteFormatter(locale, timeZone).format(new Date(time.value));
};

const relativeUnit = (
  deltaSeconds: number,
): Readonly<{ amount: number; unit: Intl.RelativeTimeFormatUnit }> => {
  const magnitude = Math.abs(deltaSeconds);
  if (magnitude < 45) return { amount: 0, unit: "second" };
  if (magnitude < 45 * 60) return { amount: Math.round(deltaSeconds / 60), unit: "minute" };
  if (magnitude < 22 * 60 * 60) {
    return { amount: Math.round(deltaSeconds / (60 * 60)), unit: "hour" };
  }
  if (magnitude < 26 * 24 * 60 * 60) {
    return { amount: Math.round(deltaSeconds / (24 * 60 * 60)), unit: "day" };
  }
  if (magnitude < 11 * 30 * 24 * 60 * 60) {
    return { amount: Math.round(deltaSeconds / (30 * 24 * 60 * 60)), unit: "month" };
  }
  return { amount: Math.round(deltaSeconds / (365 * 24 * 60 * 60)), unit: "year" };
};

export const formatSourceEventRelative = (
  time: SourceEventTime,
  now: number,
  locale?: string,
): string => {
  if (time.availability === "unavailable") return "";
  if (time.precision === "date") return time.value;
  const { amount, unit } = relativeUnit((Date.parse(time.value) - now) / 1_000);
  return new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(amount, unit);
};

const useDisplayNow = (provided: number | undefined): number => {
  const [now, setNow] = useState(() => provided ?? Date.now());
  useEffect(() => {
    if (provided !== undefined) return;
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, [provided]);
  return provided ?? now;
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
  const displayNow = useDisplayNow(now);
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
