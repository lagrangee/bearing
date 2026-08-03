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
  renderToStaticMarkup(createElement(AuditPage, { entryId: "audit", snapshot }));

test("keeps an absent Planning Audit short and truthful without a fake handoff", () => {
  const snapshot = createProjectOverviewFixture();
  const html = render({ ...snapshot, audit: { validity: "absent" } });

  expect(html).toContain("<h1>Planning Audit</h1>");
  expect(html).toContain("No current Audit");
  expect(html).toContain("Generate a Planning Audit in Agent Surface");
  expect(html).not.toContain("What a Planning Audit provides");
  expect(html).not.toContain("Resume Audit in Agent Surface");
  expect(html).not.toContain("href=");
});

test("puts Audit metadata and Findings before degraded coverage detail", () => {
  const html = render(createProjectAuditFixture());

  const orderedCopy = [
    "Planning Audit",
    "2026-07-14T09:30:00+08:00",
    "Stale",
    "1 finding",
    "Findings",
    "Portal direction needs a decision path",
    "Incomplete coverage",
    "authority:architecture",
  ];
  let cursor = -1;
  for (const copy of orderedCopy) {
    const next = html.indexOf(copy, cursor + 1);
    expect(next).toBeGreaterThan(cursor);
    cursor = next;
  }
  expect(html).not.toContain("<dt>Severity</dt>");
  expect(html).toContain("<dt>Scope</dt>");
  expect(html).toContain("2 affected references");
  expect(html).toContain("<dt>Impact</dt>");
  expect(html).toContain("The question should remain visible until the Check is resolved.");
  expect(html).toContain('href="/projects/audit/lineage/alignment-check/alignment-check%3Aportal"');
  expect(html).toContain("Confirm the Portal revision");
  expect(html).not.toContain("Advisory snapshot");
  expect(html).not.toContain("Decision truth");
});

test("keeps exactly one advisory decision boundary", () => {
  const html = render(createProjectAuditFixture());
  const boundary = "Audit is advisory; decisions remain in Alignment Checks and Planning Reviews.";

  expect(
    html.match(new RegExp(boundary.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "gu")),
  ).toHaveLength(1);
  expect(html).not.toMatch(/human acceptance|Gate Passage|Diagnostics 0|receipt|ready/iu);
});

test("keeps complete coverage compact and zero findings healthy but brief", () => {
  const html = render(createZeroProjectAuditFixture());

  expect(html).toContain("Complete coverage");
  expect(html).toContain("No findings");
  expect(html).toContain("No findings were reported in this Audit.");
  expect(html).not.toContain("Skipped scope");
  expect(html).not.toContain("Projection issues");
  expect(html).not.toContain("No skipped targets are declared");
  expect(html).not.toContain("does not prove that project intent is complete");
});

test("expands projection impact and recovery only for partial or invalid Audit states", () => {
  const partialHtml = render(createPartialProjectAuditFixture());
  expect(partialHtml).toContain("Partial projection");
  expect(partialHtml).toContain("Projection issues");
  expect(partialHtml).toContain("Some Audit material could not be projected");
  expect(partialHtml).toContain("Correct the reported source and run Planning Audit again");
  expect(partialHtml).toContain("Portal direction needs a decision path");

  const invalidHtml = render(createInvalidProjectAuditFixture());
  expect(invalidHtml).toContain("Planning Audit unavailable");
  expect(invalidHtml).toContain("Impact");
  expect(invalidHtml).toContain("Recovery");
  expect(invalidHtml).not.toContain("Generated time unavailable");
  expect(invalidHtml).not.toContain("Portal direction needs a decision path");
});

test("presents current, stale, and unknown semantic freshness without readiness claims", () => {
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
    expect(html).not.toContain("Ready");
  }
});

test("keeps an unavailable decision target scoped without inventing navigation", () => {
  const html = render(createUnavailableAuditPromotionFixture());

  expect(html).toContain("Alignment Check unavailable");
  expect(html).toContain("alignment-check:portal");
  expect(html).not.toContain(
    'href="/projects/audit/lineage/alignment-check/alignment-check%3Aportal"',
  );
});
