import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createProviderScopeObservation } from "../src/native-work-provider";
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
  expect(html).not.toContain('aria-current="page"');
  expect(html).toContain('aria-label="Open Technical Details"');
  expect(html).not.toContain('<code class="lineage-id">gate:one</code>');
  expect(html).not.toContain("<dt>Projection</dt>");
  expect(html).not.toContain("<dt>Source</dt>");
  expect(html).toContain('id="gate.exit-criteria"');
  expect(html).toContain("The planning model is accepted.");
  expect(html).toContain("Accept the planning model as ready.");
  expect(html).not.toContain('id="gate.event-history"');
  expect(html).not.toContain("Event History");
  expect(html).toContain("Lifecycle and Readiness");
  expect(html).toContain("Contributing Efforts");
  expect(html).toContain("receives contribution from");
  expect(html).toContain("accepted with evidence");
  expect(html).toContain("Confirmed none");
  expect(html).not.toContain("<h3>Roadmap</h3>");
  expect(html).not.toContain('aria-label="Quick Look Planning Model"');
  expect(html).not.toContain("<code>effort:model</code>");
  expect(html).not.toContain("1 total");
  expect(html).toContain('href="/projects/bearing/lineage/effort/effort%3Amodel"');
  expect(html).not.toContain("Resume in Agent Surface");
});

test("renders only available named Source Event Times in Event History", () => {
  const snapshot = createProjectOverviewFixture();
  if (snapshot.gates.validity === "invalid") throw new Error("Expected Gates.");
  const partialEventHistory = withLineage({
    ...snapshot,
    gates: {
      ...snapshot.gates,
      items: snapshot.gates.items.map((gate) =>
        gate.id === "gate:one" && gate.passage !== undefined
          ? {
              ...gate,
              passage: {
                ...gate.passage,
                acceptedAt: {
                  availability: "available" as const,
                  value: "2026-08-03T09:15:00Z",
                  precision: "second" as const,
                },
              },
            }
          : gate,
      ),
    },
  });
  const html = render(
    { validity: "valid", value: { kind: "gate", id: "gate:one" } },
    { snapshot: partialEventHistory },
  );

  const eventHistory = html.match(
    /<section class="lineage-event-history"[\s\S]*?<\/section>/u,
  )?.[0];
  expect(eventHistory).toBeDefined();
  expect(eventHistory).toContain('id="gate.event-history"');
  expect(eventHistory).toContain("<dt>Passage accepted</dt>");
  expect(eventHistory).not.toContain("<dt>Planned</dt>");
  expect(eventHistory).not.toContain("<dt>Activated</dt>");
  expect(eventHistory).not.toContain("Time unavailable");
});

test("renders native Source Event Time, Last updated, and Verified at as distinct provenance", () => {
  const html = render({
    validity: "valid",
    value: { kind: "native-subject", id: ".scratch/portal/map.md" },
  });

  expect(html).toContain("Native Provenance");
  expect(html).not.toContain('id="native.event-history"');
  expect(html).not.toContain("<h2>Event History</h2>");
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

  const scopeHtml = render({
    validity: "valid",
    value: { kind: "native-scope", id: ".scratch/portal" },
  });
  expect(scopeHtml).toContain("<dt>Verified at</dt>");
  expect(scopeHtml).toContain(
    "Current means verified at the recorded observation against the confirmed source revision; it does not promise live currency.",
  );
});

test("renders one accessible role-first Matt-Native Work Region from Effort and scope routes", () => {
  const effortHtml = render({
    validity: "valid",
    value: { kind: "effort", id: "effort:portal" },
  });
  const scopeHtml = render({
    validity: "valid",
    value: { kind: "native-scope", id: ".scratch/portal" },
  });

  for (const html of [effortHtml, scopeHtml]) {
    expect(html).toContain('class="matt-work-region context-bound"');
    expect(html).toContain('id="matt-work-region-title">Contributing Work</h2>');
    expect(html).toContain('aria-label="Native Work Frontier views"');
    expect(html).toContain('href="#native-work-current">Current');
    expect(html).toContain('href="#native-work-history">History');
    expect(html).toContain('href="#native-work-all">All');
    expect(html).toContain('id="matt-map-chapter-title"><a');
    expect(html).toContain(">Portal Validation</a></h3>");
    expect(html).toContain("Reach the accepted project outcome.");
    expect(html).toContain("<dt>Fog</dt><dd><strong>2</strong>");
    expect(html).toContain("Build the Roadmap journey");
    expect(html).toContain("<dt>Claimant</dt><dd><strong>lago</strong>");
    expect(html).toContain("Pass the integration gate");
    expect(html).toContain("Blocked");
    expect(html).toContain("Route a new Portal request");
    expect(html).toContain("ready-for-agent");
    expect(html).toContain("/lineage/native-subject/");
    expect(html).toContain("<h3");
    expect(html).toContain(">Open work remains</h3>");
    expect(html).toContain("<summary>Why this state?</summary>");
    expect(html).toContain("<summary>Observation details</summary>");
    expect(html).toContain("<dt>Projection State</dt><dd>available</dd>");
    expect(html).toContain("<dt>Provider Completion</dt><dd>incomplete</dd>");
    expect(html).not.toContain("Needs refresh");
  }

  const anchored = render(
    {
      validity: "valid",
      value: { kind: "effort", id: "effort:portal" },
    },
    { semanticAnchor: "native-work-current" },
  );
  expect(anchored).not.toContain("Requested section unavailable");
});

test("renders first acquisition failure as bound-unresolved with its concrete cause", () => {
  const snapshot = createProjectOverviewFixture();
  const failed = withLineage({
    ...snapshot,
    providerObservations: snapshot.providerObservations.filter(
      (observation) => observation.binding.nativeScope !== ".scratch/portal",
    ),
    providerObservationSelections: snapshot.providerObservationSelections.map((selection) =>
      selection.nativeScope === ".scratch/portal"
        ? {
            ...selection,
            observationId: null,
            effectiveFreshness: "undetermined" as const,
            latestAttempt: {
              intent: "initial-baseline" as const,
              attemptedAt: "2026-07-31T07:00:00Z",
              outcome: "failed" as const,
              diagnostics: [
                {
                  code: "provider.contract.unsupported",
                  impact: "blocking" as const,
                  target: ".scratch/portal",
                  message: "The provider contract is unsupported.",
                },
              ],
            },
          }
        : selection,
    ),
  });
  const html = render(
    { validity: "valid", value: { kind: "effort", id: "effort:portal" } },
    { snapshot: failed },
  );

  expect(html).toContain('class="matt-work-region context-attention"');
  expect(html).toContain(">Binding needs attention</h3>");
  expect(html).toContain("The provider contract is unsupported.");
  expect(html).toContain("The declared Work Binding does not resolve to a provider observation.");
});

test("renders provider subject diagnostics beside the affected native content", () => {
  const snapshot = createProjectOverviewFixture();
  const portal = snapshot.providerObservations.find(
    (observation) =>
      observation.binding.nativeScope === ".scratch/portal" &&
      (observation.state === "available" || observation.state === "partial"),
  );
  const ticket =
    portal?.state === "available" || portal?.state === "partial"
      ? portal.projection.deliveryTickets[0]
      : undefined;
  if (portal === undefined || ticket === undefined) {
    throw new Error("Expected a Portal Delivery ticket.");
  }
  const degraded = createProviderScopeObservation({
    ...portal,
    completion: "undetermined",
    diagnostics: [
      ...portal.diagnostics,
      {
        code: "matt.delivery.answer-conflict",
        class: "mapping",
        impact: "blocking",
        target: `${ticket.ref}#answer`,
        message: "The Delivery Answer sources conflict.",
      },
    ],
  } as never) as typeof portal;
  const candidate = withLineage({
    ...snapshot,
    providerObservations: snapshot.providerObservations.map((observation) =>
      observation.id === portal.id ? degraded : observation,
    ),
    providerObservationSelections: snapshot.providerObservationSelections.map((selection) =>
      selection.observationId === portal.id
        ? { ...selection, observationId: degraded.id }
        : selection,
    ),
  });
  const html = render(
    { validity: "valid", value: { kind: "effort", id: "effort:portal" } },
    { snapshot: candidate },
  );

  expect(html).toContain("Needs attention: The Delivery Answer sources conflict.");
  expect(html).toContain(
    "<summary>Protocol detail</summary><code>matt.delivery.answer-conflict</code>",
  );
});

test("renders scoped Map Destination uncertainty instead of a blank available chapter", () => {
  const snapshot = createProjectOverviewFixture();
  const portal = snapshot.providerObservations.find(
    (observation) =>
      observation.binding.nativeScope === ".scratch/portal" &&
      (observation.state === "available" || observation.state === "partial"),
  );
  if (
    portal === undefined ||
    (portal.state !== "available" && portal.state !== "partial") ||
    portal.projection.map === undefined
  ) {
    throw new Error("Expected the Portal Map observation.");
  }
  const map = portal.projection.map;
  const degraded: ProjectSnapshot = {
    ...snapshot,
    providerObservations: snapshot.providerObservations.map((observation) =>
      observation.id === portal.id
        ? {
            ...portal,
            projection: {
              ...portal.projection,
              map: {
                ...map,
                destination: "",
                semanticSections: map.semanticSections.map((section) =>
                  section.role === "map.destination"
                    ? { ...section, availability: "unavailable" as const }
                    : section,
                ),
              },
            },
          }
        : observation,
    ),
  };
  const html = render(
    {
      validity: "valid",
      value: { kind: "effort", id: "effort:portal" },
    },
    { snapshot: degraded },
  );

  expect(html).toContain('data-semantic-availability="unavailable"');
  expect(html).toContain("Destination is unavailable in the selected provider observation.");
  expect(html).not.toContain('data-semantic-availability="available"></p>');
});

test("omits confirmed-empty role shells while preserving their native history", () => {
  const html = render({
    validity: "valid",
    value: { kind: "native-scope", id: ".scratch/model" },
  });

  expect(html).toContain('class="matt-work-region context-bound"');
  expect(html).toContain("Resolve the planning model");
  expect(html).toContain('id="native-work-history"');
  expect(html).not.toContain("<h4>Spec / PRD</h4>");
  expect(html).not.toContain("<h4>Delivery</h4>");
  expect(html).not.toContain("<h4>Incoming</h4>");
});

test("keeps Roadmap and Gate native work bounded to Effort frontier summaries and links", () => {
  const roadmapHtml = render({
    validity: "valid",
    value: { kind: "roadmap", id: "roadmap:portal" },
  });
  const gateHtml = render({
    validity: "valid",
    value: { kind: "gate", id: "gate:two" },
  });

  for (const html of [roadmapHtml, gateHtml]) {
    expect(html).toContain("<h2>Contributing Efforts</h2>");
    const sectionStart = html.indexOf('id="native-work.effort-summaries"');
    const summarySection = html.slice(sectionStart, html.indexOf("</section>", sectionStart));
    expect(summarySection).toContain(
      'href="/projects/bearing/lineage/effort/effort%3Aportal">Web Portal Validation</a>',
    );
    expect(summarySection).toContain("Claimed 1 · Ready 1 · Blocked 1 · Resolved 0");
    expect(html).not.toContain('class="matt-work-region');
    expect(html).not.toContain("Reach the accepted project outcome.");
  }
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

  const detailHtml = render(
    { validity: "valid", value: { kind: "gate", id: "gate:one" } },
    { snapshot: expanded },
  );
  expect(detailHtml).toMatch(/<h3>Contributing Efforts<\/h3><span>6<\/span>/u);
  expect(detailHtml).not.toContain("6 total");
  expect(detailHtml).not.toContain("Quick Look");
});
