import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AuditPage } from "../src/portal-ui/audit-page";
import type { ProjectSnapshot } from "../src/project-snapshot/contract";
import {
  createInvalidProjectAuditFixture,
  createPartialProjectAuditFixture,
  createProjectAuditFixture,
  createUnavailableAuditPromotionFixture,
  createZeroProjectAuditFixture,
} from "./fixtures/project-audit";
import { createProjectOverviewFixture } from "./fixtures/project-overview";

const render = (snapshot: ProjectSnapshot): string =>
  renderToStaticMarkup(
    createElement(AuditPage, { entryId: "audit", snapshot, onInspect: () => {} }),
  );

test("renders the accepted explanatory state when no Planning Audit exists", () => {
  const snapshot = createProjectOverviewFixture();
  const html = render({ ...snapshot, audit: { validity: "absent" } });

  expect(html).toContain("Whole-project semantic review");
  expect(html).toContain("<h1>Planning Audit</h1>");
  expect(html).toContain("No current Audit");
  expect(html).toContain("Generate the first whole-project review in Agent Surface");
  expect(html).toContain("Resume Audit in Agent Surface");
  expect(html).toContain("Coverage");
  expect(html).toContain("Findings");
  expect(html).toContain("Decision paths");
  expect(html).not.toContain("href=");
  expect(html).not.toMatch(/severity|priority|risk/iu);
});

test("renders Audit metadata, unavailable scope, findings, and decision truth in order", () => {
  const snapshot = createProjectAuditFixture();
  const html = render(snapshot);

  const orderedCopy = [
    "2026-07-14T09:30:00+08:00",
    "Stale",
    "Incomplete",
    "authority:architecture",
    "Portal direction needs a decision path",
    "Alignment Check",
    "Decision truth",
  ];
  let cursor = -1;
  for (const copy of orderedCopy) {
    const next = html.indexOf(copy, cursor + 1);
    expect(next).toBeGreaterThan(cursor);
    cursor = next;
  }
  expect(html).toContain("1 finding");
  expect(html).toContain("2 affected references");
  expect(html).toContain("Confirm the Portal revision");
  expect(html).not.toMatch(/severity|priority|risk/iu);
});

test("keeps zero findings, partial findings, and invalid Audit states distinct", () => {
  const zeroHtml = render(createZeroProjectAuditFixture());
  expect(zeroHtml).toContain("No material findings");
  expect(zeroHtml).toContain("does not prove that project intent is complete");

  const partialHtml = render(createPartialProjectAuditFixture());
  expect(partialHtml).toContain("Audit orientation is partial");
  expect(partialHtml).toContain(
    "1 projection issue is reported separately from trustworthy findings",
  );
  expect(partialHtml).toContain("Portal direction needs a decision path");

  const invalidHtml = render(createInvalidProjectAuditFixture());
  expect(invalidHtml).toContain("Planning Audit unavailable");
  expect(invalidHtml).not.toContain("Portal direction needs a decision path");
});

test("presents current, stale, and unknown semantic freshness as independent Audit metadata", () => {
  const snapshot = createProjectAuditFixture();
  if (snapshot.audit.validity !== "available") throw new Error("Expected available Audit.");
  for (const [freshness, label] of [
    ["current", "Current"],
    ["stale", "Stale"],
    ["unknown", "Unknown"],
  ] as const) {
    const html = render({
      ...snapshot,
      audit: {
        validity: "available",
        value: { ...snapshot.audit.value, semanticFreshness: freshness },
      },
    });
    expect(html).toContain(`<dt>Semantic freshness</dt><dd>${label}</dd>`);
    expect(html).not.toContain("Blocking");
  }
});

test("distinguishes a resolved decision path from an unavailable promotion declaration", () => {
  const availableHtml = render(createProjectAuditFixture());
  expect(availableHtml).toContain("1 finding resolves to a canonical decision path");

  const unavailableHtml = render(createUnavailableAuditPromotionFixture());
  expect(unavailableHtml).toContain("0 findings resolve to canonical decision paths");
  expect(unavailableHtml).toContain("1 declared promotion is unavailable in the current Snapshot");
  expect(unavailableHtml).not.toContain("1 finding traces to a canonical decision path");
});
