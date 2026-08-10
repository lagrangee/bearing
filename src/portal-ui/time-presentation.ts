import { useEffect, useState } from "react";

export const formatAbsoluteInstant = (value: string, locale?: string, timeZone?: string): string =>
  new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    ...(timeZone === undefined ? {} : { timeZone }),
  }).format(new Date(value));

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

export const formatRelativeInstant = (value: string, now: number, locale?: string): string => {
  const { amount, unit } = relativeUnit((Date.parse(value) - now) / 1_000);
  return new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(amount, unit);
};

export const useTimeDisplayNow = (provided: number | undefined): number => {
  const [now, setNow] = useState(() => provided ?? Date.now());
  useEffect(() => {
    if (provided !== undefined) return;
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, [provided]);
  return provided ?? now;
};
