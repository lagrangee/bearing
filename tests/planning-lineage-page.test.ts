import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type {
  RequestedPlanningLineageFilteredView,
  RequestedPlanningLineageSubject,
} from "../src/planning-lineage-route";
import { PlanningLineagePage } from "../src/portal-ui/planning-lineage-page";
import type { ProjectSnapshot } from "../src/project-snapshot/contract";
import { effortSchema } from "../src/project-snapshot/schema";
import { createSourceRecord } from "../src/project-snapshot/source-records";
import { createProjectOverviewFixture } from "./fixtures/project-overview";
import { parseRebuiltPlanningLineageFixture } from "./planning-lineage-fixture";

const withLineage = parseRebuiltPlanningLineageFixture;

const render = (
  requested: RequestedPlanningLineageSubject,
  options: Readonly<{
    snapshot?: ProjectSnapshot;
    semanticAnchor?: string;
    filteredView?: RequestedPlanningLineageFilteredView;
  }> = {},
): string =>
  renderToStaticMarkup(
    createElement(PlanningLineagePage, {
      entryId: "bearing",
      requested,
      snapshot: options.snapshot ?? createProjectOverviewFixture(),
      onInspect: () => {},
      onNavigate: () => {},
      ...(options.semanticAnchor === undefined ? {} : { semanticAnchor: options.semanticAnchor }),
      ...(options.filteredView === undefined ? {} : { filteredView: options.filteredView }),
    }),
  );

test("renders one route-owned Gate dossier and non-duplicated Lineage Context", () => {
  const html = render({
    validity: "valid",
    value: { kind: "gate", id: "gate:one" },
  });

  expect(html).toContain("<h1>Model ready</h1>");
  expect(html).toContain('aria-label="Canonical Parent Path"');
  expect(html).toContain("Portal Project");
  expect(html).toContain("Portal Evolution");
  expect(html).toContain('id="gate.exit-criteria"');
  expect(html).toContain("The planning model is accepted.");
  expect(html).toContain("Accept the planning model as ready.");
  expect(html).toContain("receives contribution from");
  expect(html).toContain("accepted with evidence");
  expect(html).toContain("Confirmed none");
  expect(html).not.toContain("<h3>Roadmap</h3>");
  expect(html).toContain('aria-label="Quick Look Planning Model"');
  expect(html).not.toContain("Resume in Agent Surface");
});

test("keeps missing, invalid, and unavailable-anchor requests scoped to the requested route", () => {
  expect(
    render({
      validity: "valid",
      value: { kind: "gate", id: "gate:missing" },
    }),
  ).toContain("Gate not found");
  expect(render({ validity: "invalid", kind: "gate", requestedId: "not-a-gate" })).toContain(
    "Gate route unavailable",
  );
  expect(
    render(
      {
        validity: "valid",
        value: { kind: "gate", id: "gate:one" },
      },
      { semanticAnchor: "gate.answer" },
    ),
  ).toContain("Requested section unavailable");
});

test("renders a stable filtered relation view as owner-derived list state, not a subject", () => {
  const snapshot = createProjectOverviewFixture();
  if (snapshot.efforts.validity === "invalid" || snapshot.gates.validity === "invalid") {
    throw new Error("Expected Efforts and Gates.");
  }
  const template = snapshot.efforts.items[0];
  if (template === undefined) throw new Error("Expected an Effort.");
  const extras = Array.from({ length: 5 }, (_, index) => {
    const id = `effort:extra-${index + 1}`;
    const source = createSourceRecord(snapshot.basis.sitemapFingerprint, {
      kind: "canonical",
      locator: `.bearing/state/efforts/extra-${index + 1}.md`,
      binding: { role: "effort", identity: id },
    });
    return {
      source,
      effort: effortSchema.parse({
        ...template,
        id,
        title: `Extra Effort ${index + 1}`,
        source: source.reference,
        citations: [],
        workBinding: undefined,
      }),
    };
  });
  const extraEfforts = extras.map(({ effort }) => effort);
  const expanded = withLineage({
    ...snapshot,
    sources: [...snapshot.sources, ...extras.map(({ source }) => source)],
    efforts: {
      validity: "available" as const,
      items: [...snapshot.efforts.items, ...extraEfforts],
    },
  });

  const html = render(
    {
      validity: "valid",
      value: { kind: "gate", id: "gate:one" },
    },
    {
      snapshot: expanded,
      filteredView: {
        validity: "valid",
        relation: "outcome.contributing-efforts",
        filter: "all",
        order: "canonical",
      },
    },
  );
  expect(html).toContain("Filtered relation view");
  expect(html).toContain("Owner · Model ready");
  expect(html).toContain("Showing 6 of 6");
  expect(html).toContain("Extra Effort 5");
  expect(html).not.toContain('aria-label="Canonical Parent Path"');
});
