import { expect, test } from "bun:test";
import { planningActivityInterval } from "../src/planning-activity";

test("converts one local calendar date to an exact UTC half-open interval", () => {
  expect(planningActivityInterval("2026-01-15", "America/New_York")).toEqual({
    date: "2026-01-15",
    timeZone: "America/New_York",
    startInclusive: "2026-01-15T05:00:00Z",
    endExclusive: "2026-01-16T05:00:00Z",
  });
  expect(planningActivityInterval("2026-03-08", "America/New_York")).toEqual({
    date: "2026-03-08",
    timeZone: "America/New_York",
    startInclusive: "2026-03-08T05:00:00Z",
    endExclusive: "2026-03-09T04:00:00Z",
  });
  expect(planningActivityInterval("2026-11-01", "America/New_York")).toEqual({
    date: "2026-11-01",
    timeZone: "America/New_York",
    startInclusive: "2026-11-01T04:00:00Z",
    endExclusive: "2026-11-02T05:00:00Z",
  });
});

test("rejects invalid dates and IANA time zones", () => {
  expect(() => planningActivityInterval("2026-02-30", "UTC")).toThrow();
  expect(() => planningActivityInterval("2026-03-08", "Not/A_Zone")).toThrow();
  expect(() => planningActivityInterval("2026-03-08", "+08:00")).toThrow();
});
