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
  expect(html).toContain('id="gate.event-history"');
  expect(html).toContain("Event History");
  expect(html).toContain("Time unavailable");
  expect(html).toContain("receives contribution from");
  expect(html).toContain("accepted with evidence");
  expect(html).toContain("Confirmed none");
  expect(html).not.toContain("<h3>Roadmap</h3>");
  expect(html).toContain('aria-label="Quick Look Planning Model"');
  expect(html).not.toContain("Resume in Agent Surface");
});

test("renders native Source Event Time, Last updated, and Verified at as distinct provenance", () => {
  const html = render({
    validity: "valid",
    value: { kind: "native-subject", id: ".scratch/portal/map.md" },
  });

  expect(html).toContain("Native Provenance");
  expect(html).toContain('id="native.event-history"');
  expect(html).toContain('data-semantic-availability="unsupported"');
  expect(html).toContain("<h2>Event History</h2>");
  expect(html).toContain("<dt>Created</dt>");
  expect(html).toContain("<dt>Last updated</dt>");
  expect(html).toContain("Time unsupported");
  expect(html).toContain("<dt>Verified at</dt>");
  expect(html).toContain('<details class="lineage-time-disclosure">');
  expect(html).toContain('class="source-event-time compact"');
  expect(html).toContain("data-absolute=");
  expect(html).toContain("<summary>");
  expect(html).toContain("Technical time provenance");
  expect(html).toContain(
    "Current means verified at the recorded observation against the confirmed source revision; it does not promise live currency.",
  );
  expect(html).toContain("Secondary source metadata; not a lifecycle event.");
  expect(html.match(/<h2>Event History<\/h2>/g)).toHaveLength(1);

  const scopeHtml = render({
    validity: "valid",
    value: { kind: "native-scope", id: ".scratch/portal" },
  });
  expect(scopeHtml).toContain("<dt>Verified at</dt>");
  expect(scopeHtml).toContain(
    "Current means verified at the recorded observation against the confirmed source revision; it does not promise live currency.",
  );
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
  if (
    snapshot.roadmaps.validity === "invalid" ||
    snapshot.efforts.validity === "invalid" ||
    snapshot.gates.validity === "invalid"
  ) {
    throw new Error("Expected Roadmaps, Efforts, and Gates.");
  }
  const template = snapshot.efforts.items[0];
  if (template === undefined) throw new Error("Expected an Effort.");
  const modelEffort = snapshot.efforts.items.find((effort) => effort.id === "effort:model");
  const portalEffort = snapshot.efforts.items.find((effort) => effort.id === "effort:portal");
  if (modelEffort === undefined || portalEffort === undefined) {
    throw new Error("Expected the ordered fixture Efforts.");
  }
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
  const gateOneEffortIds = [modelEffort.id, ...extraEfforts.map((effort) => effort.id)];
  const expanded = withLineage({
    ...snapshot,
    sources: [...snapshot.sources, ...extras.map(({ source }) => source)],
    roadmaps: {
      ...snapshot.roadmaps,
      items: snapshot.roadmaps.items.map((roadmap) =>
        roadmap.id === "roadmap:portal"
          ? { ...roadmap, effortIds: [...gateOneEffortIds, portalEffort.id] }
          : roadmap,
      ),
    },
    gates: {
      ...snapshot.gates,
      items: snapshot.gates.items.map((gate) =>
        gate.id === "gate:one" ? { ...gate, effortIds: gateOneEffortIds } : gate,
      ),
    },
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
