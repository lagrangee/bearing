import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  formatSourceEventAbsolute,
  formatSourceEventRelative,
  SourceEventTimeValue,
} from "../src/portal-ui/source-event-time";

const instant = {
  availability: "available",
  value: "2026-07-31T08:09:10.123+08:00",
  precision: "fractional-second",
} as const;

test("formats ordinary absolute time to local minutes without visible technical provenance", () => {
  expect(formatSourceEventAbsolute(instant, "en-US", "UTC")).toBe(
    "Jul 31, 2026 at 12:09 AM",
  );
  const markup = renderToStaticMarkup(
    <SourceEventTimeValue
      label="Accepted"
      locale="en-US"
      mode="detail"
      now={Date.parse("2026-07-31T00:10:00Z")}
      time={instant}
      timeZone="UTC"
    />,
  );
  expect(markup).toContain(">Jul 31, 2026 at 12:09 AM<");
  expect(markup).toContain(">1 minute ago<");
  expect(markup).not.toContain(">Jul 31, 2026, 12:09:10");
  expect(markup).toContain('dateTime="2026-07-31T08:09:10.123+08:00"');
  expect(markup).not.toContain("Technical time provenance");
  expect(markup).not.toContain("fractional-second precision");
});

test("keeps date-only source time date-only and never gives it a relative instant", () => {
  const dateOnly = {
    availability: "available",
    value: "2026-07-31",
    precision: "date",
  } as const;
  expect(formatSourceEventAbsolute(dateOnly, "en-US", "America/Los_Angeles")).toBe("2026-07-31");
  expect(formatSourceEventRelative(dateOnly, Date.parse("2026-08-01T00:00:00Z"), "en-US")).toBe(
    "2026-07-31",
  );
});

test("omits unavailable event time from ordinary Portal presentation", () => {
  const unavailable = { availability: "unavailable" } as const;
  expect(formatSourceEventAbsolute(unavailable, "en-US", "UTC")).toBe("");
  expect(
    renderToStaticMarkup(
      <SourceEventTimeValue
        label="Planned"
        locale="en-US"
        mode="compact"
        now={0}
        time={unavailable}
        timeZone="UTC"
      />,
    ),
  ).toBe("");
});

test("uses now rather than exposing source seconds in ordinary relative display", () => {
  expect(
    formatSourceEventRelative(instant, Date.parse("2026-07-31T00:09:30Z"), "en-US"),
  ).toBe("now");
});

test("keeps minute-level absolute disclosure on compact relative time", () => {
  const markup = renderToStaticMarkup(
    <SourceEventTimeValue
      label="Verified at"
      locale="en-US"
      mode="compact"
      now={Date.parse("2026-07-31T01:10:00Z")}
      time={instant}
      timeZone="UTC"
    />,
  );
  expect(markup).toContain('data-absolute="Jul 31, 2026 at 12:09 AM"');
  expect(markup).toContain(">1 hour ago<");
});

test("discloses inferred source metadata on hover and keyboard focus through generic time presentation", () => {
  const inferred = {
    ...instant,
    basis: "inferred-source-metadata",
  } as const;
  const markup = renderToStaticMarkup(
    <SourceEventTimeValue
      label="Created"
      locale="en-US"
      mode="detail"
      now={Date.parse("2026-07-31T00:10:00Z")}
      time={inferred}
      timeZone="UTC"
    />,
  );

  expect(markup).toContain('tabindex="0"');
  expect(markup).toContain('title="Approximate time from current source metadata."');
  expect(markup).toContain('aria-describedby="');
  expect(markup).toContain("Approximate time inferred from current source metadata");
  expect(markup).not.toContain("github");
  expect(markup).not.toContain("local markdown");

  const compactMarkup = renderToStaticMarkup(
    <SourceEventTimeValue
      label="Created"
      locale="en-US"
      mode="compact"
      now={Date.parse("2026-07-31T01:10:00Z")}
      time={inferred}
      timeZone="UTC"
    />,
  );
  expect(compactMarkup).toContain(
    'title="Jul 31, 2026 at 12:09 AM. Approximate time from current source metadata."',
  );
});
