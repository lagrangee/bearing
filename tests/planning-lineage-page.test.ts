import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
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
  expect(html).not.toContain('id="relation.outcome.contributing-efforts"');
  expect(html).toContain("accepted with evidence");
  expect(html).toContain("Confirmed none");
  expect(html).not.toContain("<h3>Roadmap</h3>");
  expect(html).not.toContain('aria-label="Quick Look Planning Model"');
  expect(html).not.toContain("<code>effort:model</code>");
  expect(html).not.toContain("1 total");
  expect(html).toContain('href="/projects/bearing/lineage/effort/effort%3Amodel"');
  expect(html).not.toContain("Resume in Agent Surface");
});

test("uses one shared low-noise identity header for Roadmap, Gate, and Effort details", () => {
  const cases = [
    [{ kind: "roadmap", id: "roadmap:portal" }, "Roadmap", "Portal Evolution"],
    [{ kind: "gate", id: "gate:one" }, "Milestone Gate", "Model ready"],
    [{ kind: "effort", id: "effort:model" }, "Effort", "Planning Model"],
  ] as const;

  for (const [subject, marker, title] of cases) {
    const html = render({ validity: "valid", value: subject });
    expect(html).toContain(`data-object-kind="${subject.kind}"`);
    expect(html).toContain(`<span class="lineage-object-type">${marker}</span>`);
    expect(html).toContain(`<h1>${title}</h1>`);
    expect(html).not.toContain(`<code>${subject.id}</code>`);
  }
});

test("gives lineage identity and mixed-language prose container-owned readable width", async () => {
  const css = await readFile(join(process.cwd(), "src/portal-ui/styles/lineage.css"), "utf8");
  expect(css).toContain(".lineage-identity");
  expect(css).toMatch(/\.lineage-sections > section \{[\s\S]*max-width: 960px;/u);
  expect(css).not.toContain("max-width: 24ch");
  expect(css).not.toContain("max-width: 72ch");
  expect(css).toMatch(
    /@media \(max-width: 820px\)[\s\S]*\.lineage-sections > section[\s\S]*max-width: 100%;/u,
  );
});

test("renders Roadmap Outcome Spine as the sole ordered Gate and nested Effort owner", () => {
  const roadmap = render({
    validity: "valid",
    value: { kind: "roadmap", id: "roadmap:portal" },
  });
  const spine = roadmap.match(/<section[^>]*class="outcome-spine"[\s\S]*?<\/section>/u)?.[0];
  expect(spine).toBeDefined();
  expect(spine).toContain('data-layout="horizontal-eligible"');
  expect(spine).toContain('class="outcome-spine-gate is-focused"');
  expect(spine).toContain('href="/projects/bearing/lineage/gate/gate%3Aone"');
  expect(spine).toContain('href="/projects/bearing/lineage/gate/gate%3Atwo"');
  expect(spine).toContain('href="/projects/bearing/lineage/effort/effort%3Amodel"');
  expect(spine).toContain('href="/projects/bearing/lineage/effort/effort%3Aportal"');
  expect(spine).not.toContain("<button");
  expect(spine).not.toContain("<details");
  expect(roadmap).not.toContain('id="relation.outcome.ordered-gates"');
  expect(roadmap).not.toContain('id="relation.outcome.contributing-efforts"');

  const gate = render({ validity: "valid", value: { kind: "gate", id: "gate:one" } });
  expect(gate).toContain('id="native-work.effort-summaries"');
  expect(gate).not.toContain('id="relation.outcome.contributing-efforts"');
});

test("uses container-owned all-or-nothing Outcome Spine layout without truncation", async () => {
  const css = await readFile(join(process.cwd(), "src/portal-ui/styles/lineage.css"), "utf8");
  expect(css).toContain("container: outcome-spine / inline-size");
  expect(css).toMatch(/@container outcome-spine \(min-width: 760px\)/u);
  expect(css).not.toMatch(/outcome-spine[^}]*text-overflow/u);
  expect(css).not.toMatch(/outcome-spine[^}]*white-space:\s*nowrap/u);
  expect(css).not.toMatch(/outcome-spine[^}]*overflow-x:\s*(auto|scroll)/u);
});

test("keeps Asset semantics on detail and routes content outside Technical Details", () => {
  const snapshot = createProjectOverviewFixture();
  const html = render({
    validity: "valid",
    value: { kind: "asset", id: "asset:planning-model-evidence" },
  });

  expect(html).toContain("Asset Identity");
  expect(html).toContain("Kind: verification-report");
  expect(html).toContain("Ownership and Purpose");
  expect(html).toContain("Owned by Model ready.");
  expect(html).toContain("Planning Citation");
  expect(html).toContain("Passage Evidence");
  expect(html).toContain(">View Content</a>");
  expect(html).not.toContain(".scratch/evidence/planning-model");
  expect(html).not.toContain("asset:planning-model-evidence · verification-report");
  expect(html).not.toContain("<h2>Provenance</h2>");
  expect(html).not.toContain("generic-agent");

  if (snapshot.assets.validity === "invalid") throw new Error("Expected Asset fixture.");
  const assets = snapshot.assets;
  const contentState = (availability: "missing" | "unreadable") =>
    withLineage({
      ...snapshot,
      assets: {
        ...assets,
        items: assets.items.map((asset) =>
          asset.id === "asset:planning-model-evidence"
            ? { ...asset, contentAvailability: availability, contentShape: "unavailable" }
            : asset,
        ),
      },
    });
  const missing = render(
    { validity: "valid", value: { kind: "asset", id: "asset:planning-model-evidence" } },
    { snapshot: contentState("missing") },
  );
  expect(missing).not.toContain("View Content");
  expect(missing).not.toContain("Content unavailable");

  const unreadable = render(
    { validity: "valid", value: { kind: "asset", id: "asset:planning-model-evidence" } },
    { snapshot: contentState("unreadable") },
  );
  expect(unreadable).not.toContain("View Content");
  expect(unreadable).toContain("Content unavailable");
  expect(unreadable).toContain(
    "Impact: content reading is unavailable; other Asset semantics remain available",
  );
  expect(unreadable).toContain("Recovery: open Technical Details");

  const prototype = withLineage({
    ...snapshot,
    assets: {
      ...assets,
      items: assets.items.map((asset) =>
        asset.id === "asset:planning-model-evidence" ? { ...asset, kind: "prototype" } : asset,
      ),
    },
  });
  const prototypeHtml = render(
    { validity: "valid", value: { kind: "asset", id: "asset:planning-model-evidence" } },
    { snapshot: prototype },
  );
  expect(prototypeHtml).not.toContain("View Content");
  expect(prototypeHtml).not.toContain("Content unavailable");

  const directory = withLineage({
    ...snapshot,
    assets: {
      ...assets,
      items: assets.items.map((asset) =>
        asset.id === "asset:planning-model-evidence"
          ? { ...asset, contentShape: "directory" }
          : asset,
      ),
    },
  });
  const directoryDeepLinkHtml = render(
    { validity: "valid", value: { kind: "asset", id: "asset:planning-model-evidence" } },
    { snapshot: directory, semanticAnchor: "asset.content" },
  );
  expect(directoryDeepLinkHtml).not.toContain("View Content");
  expect(directoryDeepLinkHtml).not.toContain('id="asset.content"');
  expect(directoryDeepLinkHtml).toContain("Requested section unavailable");
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

test("keeps the full role-first Matt-Native Work Region on the native scope route", () => {
  const scopeHtml = render({
    validity: "valid",
    value: { kind: "native-scope", id: ".scratch/portal" },
  });

  expect(scopeHtml).toContain('class="matt-work-region context-bound"');
  expect(scopeHtml).toContain('id="matt-work-region-title">Contributing Work</h2>');
  expect(scopeHtml).toContain('aria-label="Native Work Frontier views"');
  expect(scopeHtml).toContain('href="#native-work-current">Current');
  expect(scopeHtml).toContain('href="#native-work-history">History');
  expect(scopeHtml).toContain('href="#native-work-all">All');
  expect(scopeHtml).toContain('id="matt-map-chapter-title"><a');
  expect(scopeHtml).toContain(">Portal Validation</a></h3>");
  expect(scopeHtml).toContain("Reach the accepted project outcome.");
  expect(scopeHtml).toContain("<dt>Fog</dt><dd><strong>2</strong>");
  expect(scopeHtml).toContain("Build the Roadmap journey");
  expect(scopeHtml).toContain("<dt>Claimant</dt><dd><strong>lago</strong>");
  expect(scopeHtml).toContain("Pass the integration gate");
  expect(scopeHtml).toContain("Blocked");
  expect(scopeHtml).toContain("Route a new Portal request");
  expect(scopeHtml).toContain("ready-for-agent");
  expect(scopeHtml).toContain("/lineage/native-subject/");
  expect(scopeHtml).toContain(">Open work remains</h3>");
  expect(scopeHtml).toContain("<summary>Why this state?</summary>");
  expect(scopeHtml).toContain("<summary>Observation details</summary>");
  expect(scopeHtml).toContain("<dt>Projection State</dt><dd>available</dd>");
  expect(scopeHtml).toContain("<dt>Provider Completion</dt><dd>incomplete</dd>");
  expect(scopeHtml).not.toContain("Needs refresh");

  const anchored = render(
    {
      validity: "valid",
      value: { kind: "effort", id: "effort:portal" },
    },
    { semanticAnchor: "native-work-current" },
  );
  expect(anchored).not.toContain("Requested section unavailable");
});

test("renders Effort status, canonical Intent, concluded-only Outcome, and governed Current Work", () => {
  const active = render({
    validity: "valid",
    value: { kind: "effort", id: "effort:portal" },
  });

  expect(active).toContain("<dt>Effort lifecycle</dt><dd>Active</dd>");
  expect(active).toContain("<dt>Contributes to</dt>");
  expect(active).toContain(">Overview proven</a>");
  expect(active).toContain('<dd data-health="healthy">Healthy</dd>');
  expect(active).toContain('<section id="effort.intent"><h2>Intent</h2>');
  expect(active).toContain("Deliver the accepted Portal journey.");
  expect(active).toContain('<section id="native-work-current">');
  expect(active).toContain('Build the Roadmap journey</a><span data-work-status="claimed"');
  expect(active).toContain('Review the Roadmap journey</a><span data-work-status="ready"');
  expect(active).toContain('Pass the integration gate</a><span data-work-status="blocked"');
  expect(active).toContain("Blocked by unresolved prerequisite work.");
  expect(active).toContain('Route a new Portal request</a><span data-work-status="ready"');
  expect(active).toContain("Full work history</a>");
  expect(active).not.toContain("<h2>Outcome</h2>");
  expect(active).not.toContain('class="matt-work-region');
  expect(active).not.toContain('aria-label="Native Work Frontier views"');
  expect(active).not.toContain(">Portal Validation</a></h3>");
  expect(active).not.toContain(">Portal Validation PRD</a>");
  expect(active).not.toContain(".scratch/portal/issues/02-review.md");
  expect(active.indexOf("<h1>Web Portal Validation</h1>")).toBeLessThan(
    active.indexOf("<h2>Intent</h2>"),
  );
  expect(active.indexOf("<h2>Intent</h2>")).toBeLessThan(active.indexOf("<h2>Current Work</h2>"));

  const concluded = render({
    validity: "valid",
    value: { kind: "effort", id: "effort:model" },
  });
  expect(concluded).toContain("<dt>Effort lifecycle</dt><dd>Concluded</dd>");
  expect(concluded).toContain('<section id="effort.outcome"><h2>Outcome</h2>');
  expect(concluded).toContain("<dt>Disposition</dt><dd>Completed</dd>");
  expect(concluded).toContain("The governed contribution was explicitly accepted as complete.");
  expect(concluded).not.toContain("<dt>Concluded</dt>");
  expect(concluded).not.toContain("<h2>Current Work</h2>");
  expect(concluded).not.toContain("Resolve the planning model");
});

test("renders an explicit empty Current Work state for an active Effort", () => {
  const snapshot = createProjectOverviewFixture();
  const portal = snapshot.providerObservations.find(
    (observation) =>
      observation.binding.nativeScope === ".scratch/portal" &&
      (observation.state === "available" || observation.state === "partial"),
  );
  if (portal === undefined || (portal.state !== "available" && portal.state !== "partial")) {
    throw new Error("Expected the Portal observation.");
  }
  const emptyCurrent = createProviderScopeObservation({
    ...portal,
    projection: {
      ...portal.projection,
      wayfinderTickets: [],
      deliveryTickets: [],
      incomingIssues: [],
      structuralOrder: [portal.projection.map?.ref, portal.projection.spec?.ref].filter(
        (reference) => reference !== undefined,
      ),
      graph: { parentChild: [], blockedBy: [] },
    },
  } as never) as typeof portal;
  const candidate = withLineage({
    ...snapshot,
    providerObservations: snapshot.providerObservations.map((observation) =>
      observation.id === portal.id ? emptyCurrent : observation,
    ),
    providerObservationSelections: snapshot.providerObservationSelections.map((selection) =>
      selection.observationId === portal.id
        ? { ...selection, observationId: emptyCurrent.id }
        : selection,
    ),
  });
  const html = render(
    { validity: "valid", value: { kind: "effort", id: "effort:portal" } },
    { snapshot: candidate },
  );

  expect(html).toContain("<h2>Current Work</h2>");
  expect(html).toContain("No nonterminal managed work is established by this observation.");
  expect(html).not.toContain(">Portal Validation</a></h3>");
  expect(html).not.toContain(">Portal Validation PRD</a>");
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

  expect(html).toContain('<dd data-health="needs-attention">Needs attention</dd>');
  expect(html).toContain("<h2>Current Work</h2>");
  expect(html).toContain("Work Binding invalid. Cause:");
  expect(html).toContain("The provider contract is unsupported.");
  expect(html).toContain("The declared Work Binding does not resolve to a provider observation.");
  expect(html).not.toContain("No nonterminal managed work is established");
  expect(html).not.toContain('class="matt-work-region');
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
  expect(html).not.toContain("matt.delivery.answer-conflict");
  expect(html).not.toContain(`${ticket.ref}#answer`);
});

test("keeps Map detail out of Effort Current Work when its optional semantics are unavailable", () => {
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

  expect(html).toContain("<h2>Current Work</h2>");
  expect(html).not.toContain("Destination is unavailable in the selected provider observation.");
  expect(html).not.toContain(">Portal Validation</a></h3>");
  expect(html).not.toContain("<dt>Fog</dt>");
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

test("keeps Roadmap and Gate Effort relations in their single semantic owners", () => {
  const roadmapHtml = render({
    validity: "valid",
    value: { kind: "roadmap", id: "roadmap:portal" },
  });
  const gateHtml = render({
    validity: "valid",
    value: { kind: "gate", id: "gate:two" },
  });

  expect(roadmapHtml).toContain('<h2 id="outcome-spine-title">Outcome Spine</h2>');
  expect(roadmapHtml).toContain(
    'href="/projects/bearing/lineage/effort/effort%3Aportal">Web Portal Validation</a>',
  );
  expect(roadmapHtml).not.toContain('id="native-work.effort-summaries"');
  expect(roadmapHtml).not.toContain('id="relation.outcome.contributing-efforts"');

  expect(gateHtml).toContain("<h2>Contributing Efforts</h2>");
  const sectionStart = gateHtml.indexOf('id="native-work.effort-summaries"');
  const summarySection = gateHtml.slice(sectionStart, gateHtml.indexOf("</section>", sectionStart));
  expect(summarySection).toContain(
    'href="/projects/bearing/lineage/effort/effort%3Aportal">Web Portal Validation</a>',
  );
  expect(summarySection).toContain("Claimed 1 · Ready 1 · Blocked 1 · Resolved 0");
  expect(gateHtml).not.toContain('id="relation.outcome.contributing-efforts"');
  for (const html of [roadmapHtml, gateHtml]) {
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

test("renders invalid Effort binding as cause, impact, and recovery rather than normal absence", () => {
  const snapshot = createProjectOverviewFixture();
  if (snapshot.efforts.validity === "invalid") throw new Error("Expected Efforts.");
  const invalidBinding = withLineage({
    ...snapshot,
    efforts: {
      ...snapshot.efforts,
      items: snapshot.efforts.items.map((effort) =>
        effort.id === "effort:model"
          ? {
              ...effort,
              workBinding: undefined,
              workBindingState: { state: "invalid" as const, reason: "missing" as const },
            }
          : effort,
      ),
    },
  });
  const html = render(
    { validity: "valid", value: { kind: "effort", id: "effort:model" } },
    { snapshot: invalidBinding },
  );

  expect(html).toContain("Work Binding invalid");
  expect(html).toContain("Cause: this Effort has no declared Work Binding.");
  expect(html).toContain(
    "Impact: native work cannot contribute trusted evidence or Gate readiness.",
  );
  expect(html).toContain(
    "Recovery: declare exactly one supported Work Binding in the canonical Effort record, then Sync.",
  );
  expect(html).not.toContain("Not bound");
  expect(html).not.toContain("No Work Binding is declared");
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
        workBindingState: { state: "invalid", reason: "missing" },
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
  expect(detailHtml).toContain("<h2>Contributing Efforts</h2>");
  expect(detailHtml).toContain("Extra Effort 5");
  expect(detailHtml).not.toContain('id="relation.outcome.contributing-efforts"');
  expect(detailHtml).not.toContain("6 total");
  expect(detailHtml).not.toContain("Quick Look");
});
