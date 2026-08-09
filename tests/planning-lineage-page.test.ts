import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createElement, createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createProviderScopeObservation } from "../src/native-work-provider";
import type {
  RequestedPlanningLineageFilteredView,
  RequestedPlanningLineageSubject,
} from "../src/planning-lineage-route";
import { PlanningLineagePage } from "../src/portal-ui/planning-lineage-page";
import { ProviderObservationStatus } from "../src/portal-ui/provider-observation-status";
import { ProviderObservationTime } from "../src/portal-ui/provider-observation-time";
import type { ProjectGeneration } from "../src/project-generation/contract";
import { effortSchema } from "../src/project-generation/schema";
import { assetProjectionSchema } from "../src/project-generation/schema-asset";
import { createSourceRecord } from "../src/project-generation/source-records";
import {
  createAttentionWithoutActiveWorkFixture,
  createAvailableLifecycleTimeFixture,
  createConfirmedNoManagedWorkFixture,
  createHistoryOnlyWorkFixture,
} from "./fixtures/effort-work-rollup";
import { createProjectOverviewFixture } from "./fixtures/project-overview";
import { parseRebuiltPlanningLineageFixture } from "./planning-lineage-fixture";

const withLineage = parseRebuiltPlanningLineageFixture;

test("formats Provider Observation Time as local minutes with relative context", () => {
  const markup = renderToStaticMarkup(
    createElement(ProviderObservationTime, {
      value: "2026-07-31T08:09:10.123+08:00",
      now: Date.parse("2026-07-31T00:10:00Z"),
      locale: "en-US",
      timeZone: "UTC",
    }),
  );
  expect(markup).toContain(">Jul 31, 2026 at 12:09 AM<");
  expect(markup).toContain(">1 minute ago<");
  expect(markup).toContain('dateTime="2026-07-31T08:09:10.123+08:00"');
  expect(markup).not.toContain(">2026-07-31T08:09:10.123+08:00<");
});

const render = (
  requested: RequestedPlanningLineageSubject,
  options: Readonly<{
    snapshot?: ProjectGeneration;
    semanticAnchor?: string;
    filteredView?: RequestedPlanningLineageFilteredView;
    observationActionLabel?: "Load source" | "Refresh item";
    observationBusy?: boolean;
    onObserveSource?: () => void;
  }> = {},
): string =>
  renderToStaticMarkup(
    createElement(PlanningLineagePage, {
      entryId: "bearing",
      requested,
      snapshot: options.snapshot ?? createProjectOverviewFixture(),
      onInspect: () => {},
      onNavigate: () => {},
      ...(options.observationActionLabel === undefined
        ? {}
        : { observationActionLabel: options.observationActionLabel }),
      ...(options.observationBusy === undefined
        ? {}
        : { observationBusy: options.observationBusy }),
      ...(options.onObserveSource === undefined
        ? {}
        : { onObserveSource: options.onObserveSource }),
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
  expect(html).toContain('<p class="lineage-header-status">Gate · Passed · Ready for review</p>');
  expect(html).toContain("Contributing Efforts");
  expect(html).not.toContain('id="relation.outcome.contributing-efforts"');
  expect(html).toContain("Evidence: .scratch/evidence/planning-model");
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

test("puts human-readable Roadmap and Gate status under the title and Intent before the spine", () => {
  const roadmap = render({
    validity: "valid",
    value: { kind: "roadmap", id: "roadmap:portal" },
  });
  const roadmapHeader = roadmap.match(/<header class="lineage-header"[\s\S]*?<\/header>/u)?.[0];
  expect(roadmapHeader).toContain('<p class="lineage-header-status">Active roadmap</p>');
  expect(roadmapHeader).not.toContain("active-horizon");
  expect(roadmap).not.toContain("Roadmap Lifecycle");
  expect(roadmap.indexOf('id="roadmap.intent"')).toBeLessThan(
    roadmap.indexOf('class="outcome-spine"'),
  );

  const gate = render({
    validity: "valid",
    value: { kind: "gate", id: "gate:two" },
  });
  const gateHeader = gate.match(/<header class="lineage-header"[\s\S]*?<\/header>/u)?.[0];
  expect(gateHeader).toContain(
    '<p class="lineage-header-status">Current gate · Active · Not ready for passage</p>',
  );
  expect(gateHeader).not.toContain("horizon focused");
  expect(gate).not.toContain("Lifecycle and Readiness");
});

test("uses container-based Roadmap Intent width on Overview and Roadmaps index", async () => {
  const overviewCss = await readFile(
    join(process.cwd(), "src/portal-ui/styles/overview.css"),
    "utf8",
  );
  const planningCss = await readFile(
    join(process.cwd(), "src/portal-ui/styles/planning.css"),
    "utf8",
  );
  expect(overviewCss).toMatch(
    /\.roadmap-landscape-header p \{[\s\S]*?max-width: min\(960px, 100%\);/u,
  );
  expect(planningCss).toMatch(/\.roadmap-index-row > p \{[\s\S]*?max-width: min\(960px, 100%\);/u);
  expect(overviewCss).not.toMatch(/\.roadmap-landscape-header p \{[\s\S]*?max-width: 78ch;/u);
  expect(planningCss).not.toMatch(/\.roadmap-index-row > p \{[\s\S]*?max-width: 72ch;/u);
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
  const baseSnapshot = createProjectOverviewFixture();
  if (baseSnapshot.assets.validity === "invalid") throw new Error("Expected Asset fixture.");
  const snapshot = withLineage(baseSnapshot);
  const html = render(
    {
      validity: "valid",
      value: { kind: "asset", id: "asset:planning-model-evidence" },
    },
    { snapshot },
  );

  expect(html).toContain("Asset Identity");
  expect(html).toContain("Kind: reference");
  expect(html).toContain("Ownership and Purpose");
  const header = html.match(/<header class="lineage-header"[\s\S]*?<\/header>/u)?.[0];
  expect(header).toBeDefined();
  expect(header).not.toContain('class="action action-primary lineage-primary-action"');
  const ownership = html.match(/<section[^>]*id="asset.ownership"[\s\S]*?<\/section>/u)?.[0];
  expect(ownership).toBeDefined();
  expect(ownership).toContain("Owner: project-summary:current");
  expect(ownership).not.toMatch(/<a[^>]*>Owner:/u);
  expect(html).toContain("Planning Citation");
  expect(html).toContain("Current source availability is unavailable");
  expect(html).not.toContain('id="asset.content"');
  expect(html).not.toContain("Read this Asset on its bounded, read-only content surface.");
  expect(html).not.toContain("Read-only · current-checkout content · isolated window");
  expect(html).not.toContain('id="relation.production.owner"');
  expect(html).not.toContain('id="relation.production.produced-for"');
  expect(html).toContain("Locator: .scratch/evidence/planning-model");
  expect(html).not.toContain("asset:planning-model-evidence · reference");
  expect(html).not.toContain("<h2>Provenance</h2>");
  expect(html).not.toContain("generic-agent");

  const unavailableOwner = {
    ...snapshot,
    lineage: {
      ...snapshot.lineage,
      subjects: snapshot.lineage.subjects.map((subject) =>
        subject.identity.kind === "asset" && subject.identity.id === "asset:planning-model-evidence"
          ? {
              ...subject,
              relations: subject.relations.map((relation) =>
                relation.key === "production.owner" && relation.state === "present"
                  ? {
                      ...relation,
                      targets: relation.targets.map((target) => ({
                        ...target,
                        availability: "unavailable" as const,
                        note: "The canonical owner is unavailable in this projection.",
                      })),
                    }
                  : relation,
              ),
            }
          : subject,
      ),
    },
  } satisfies ProjectGeneration;
  const unavailableOwnerHtml = render(
    { validity: "valid", value: { kind: "asset", id: "asset:planning-model-evidence" } },
    { snapshot: unavailableOwner },
  );
  const unavailableOwnership = unavailableOwnerHtml.match(
    /<section[^>]*id="asset.ownership"[\s\S]*?<\/section>/u,
  )?.[0];
  expect(unavailableOwnership).toContain("<li>Owner: project-summary:current</li>");
  expect(unavailableOwnership).not.toContain('href="/projects/bearing/lineage/gate/gate%3Aone"');

  const assets = snapshot.assets;
  if (assets.validity === "invalid") throw new Error("Expected rebuilt Asset fixture.");
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
  expect(eventHistory).not.toContain("Source-owned chronology");
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
  expect(html).not.toContain("Technical time provenance");
  expect(html).toContain(
    "Current means verified at the recorded observation against the confirmed source revision; it does not promise live currency.",
  );
  expect(html).toContain("Secondary source metadata; not a lifecycle event.");

  const scopeHtml = render({
    validity: "valid",
    value: { kind: "native-scope", id: ".scratch/portal" },
  });
  expect(scopeHtml).not.toContain("<dt>Verified at</dt>");
  expect(scopeHtml).not.toContain("Scope Context and Trust");
});

test("renders a quiet human-readable Work History and scopes degraded recovery to the Effort", () => {
  const scopeHtml = render({
    validity: "valid",
    value: { kind: "native-scope", id: ".scratch/portal" },
  });

  const header = scopeHtml.match(/<header class="lineage-header"[\s\S]*?<\/header>/u)?.[0];
  expect(header).toContain('<span class="lineage-object-type">Work History</span>');
  expect(header).toContain("<h1>Contributing Work</h1>");
  expect(header).toContain(
    '<p class="lineage-header-context">For <a href="/projects/bearing/lineage/effort/effort%3Aportal">Web Portal Validation</a></p>',
  );
  expect(header).not.toContain(".scratch/portal");
  expect(scopeHtml).toContain('class="matt-work-region context-bound"');
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
  expect(scopeHtml).not.toContain("Scope Context and Trust");
  expect(scopeHtml).not.toContain("Matt-native work region");
  expect(scopeHtml).not.toContain("Native Work Reading State");
  expect(scopeHtml).not.toContain("Open work remains");
  expect(scopeHtml).not.toContain("Why this state?");
  expect(scopeHtml).not.toContain("Observation details");
  expect(scopeHtml).not.toContain("Refresh details");

  const snapshot = createProjectOverviewFixture();
  const portal = snapshot.providerObservations.find(
    (observation) => observation.binding.nativeScope === ".scratch/portal",
  );
  if (portal === undefined || (portal.state !== "available" && portal.state !== "partial")) {
    throw new Error("Expected the Portal observation.");
  }
  const stale = createProviderScopeObservation({
    ...portal,
    freshness: { ...portal.freshness, assessment: "stale" },
  } as never) as typeof portal;
  const degradedSnapshot = withLineage({
    ...snapshot,
    providerObservations: snapshot.providerObservations.map((observation) =>
      observation.id === portal.id ? stale : observation,
    ),
    providerObservationSelections: snapshot.providerObservationSelections.map((selection) =>
      selection.observationId === portal.id
        ? { ...selection, observationId: stale.id, effectiveFreshness: "stale" as const }
        : selection,
    ),
  });
  const degraded = render(
    { validity: "valid", value: { kind: "native-scope", id: ".scratch/portal" } },
    {
      snapshot: degradedSnapshot,
      observationActionLabel: "Load source",
      onObserveSource: () => {},
    },
  );
  expect(degraded).toContain('class="work-history-attention"');
  expect(degraded).toContain("<strong>Needs attention</strong>");
  expect(degraded).toContain(
    'Return to <a href="/projects/bearing/lineage/effort/effort%3Aportal">Web Portal Validation</a> to load the bound provider source.',
  );
  expect(degraded).not.toContain("Refresh details");

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
  expect(active).toContain(">Gate: Overview proven</a>");
  expect(active).toContain('<dd data-health="healthy">Healthy</dd>');
  expect(active).toContain('<section id="effort.intent"><h2>Intent</h2>');
  expect(active).toContain("Deliver the accepted Portal journey.");
  expect(active).toContain('<section id="native-work-current">');
  expect(active).toContain('Build the Roadmap journey</a><span data-work-status="claimed"');
  expect(active).toContain('Review the Roadmap journey</a><span data-work-status="ready"');
  expect(active).toContain('Pass the integration gate</a><span data-work-status="blocked"');
  expect(active).toContain("Blocked by unresolved prerequisite work.");
  expect(active).toContain('Route a new Portal request</a><span data-work-status="ready"');
  expect(active).toContain("<dt>Current</dt><dd>4</dd>");
  expect(active).toContain("<dt>Resolved</dt><dd>0</dd>");
  expect(active).toContain("<dt>History</dt><dd>0</dd>");
  expect(active).toContain("Full work history · History 0</a>");
  expect(active).not.toContain("<h2>Outcome</h2>");
  expect(active).not.toContain('class="matt-work-region');
  expect(active).not.toContain('aria-label="Native Work Frontier views"');
  expect(active).not.toContain("Last verified");
  expect(active).not.toContain("Refresh work details");
  expect(active).not.toContain("Managed work coverage");
  const activeCurrentWork = active.match(
    /<section id="native-work-current">[\s\S]*?<\/section>/u,
  )?.[0];
  expect(activeCurrentWork).toBeDefined();
  expect(activeCurrentWork).not.toContain("Portal Validation");
  expect(activeCurrentWork).not.toContain("Portal Validation PRD");
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
  expect(concluded).toContain("<h2>Current Work</h2>");
  expect(concluded).toContain("All managed work is in History; no current work remains.");
  expect(concluded).toContain("Full work history · History 2</a>");
  expect(concluded).not.toContain("Resolve the planning model");
});

test("renders an explicit empty Current Work state for an active Effort", () => {
  const html = render(
    { validity: "valid", value: { kind: "effort", id: "effort:portal" } },
    { snapshot: createConfirmedNoManagedWorkFixture() },
  );

  expect(html).toContain("<h2>Current Work</h2>");
  expect(html).toContain("No managed work is established for this scope.");
  expect(html).toContain("Full work history · History 0</a>");
  const currentWork = html.match(/<section id="native-work-current">[\s\S]*?<\/section>/u)?.[0];
  expect(currentWork).toBeDefined();
  expect(currentWork).not.toContain("Portal Validation");
  expect(currentWork).not.toContain("Portal Validation PRD");
});

test("renders history-only managed work without renaming History completed work", () => {
  const html = render(
    { validity: "valid", value: { kind: "effort", id: "effort:model" } },
    { snapshot: createHistoryOnlyWorkFixture() },
  );

  expect(html).toContain("All managed work is in History; no current work remains.");
  expect(html).toContain("<dt>Current</dt><dd>0</dd>");
  expect(html).toContain("<dt>Resolved</dt><dd>1</dd>");
  expect(html).toContain("<dt>History</dt><dd>2</dd>");
  expect(html).toContain("Full work history · History 2</a>");
  expect(html).not.toContain("completed work");
});

test("renders empty active work with remaining Attention and uncertain independent counts", () => {
  const html = render(
    { validity: "valid", value: { kind: "effort", id: "effort:portal" } },
    { snapshot: createAttentionWithoutActiveWorkFixture() },
  );

  expect(html).toContain(
    "No current managed work is established. Attention remains and must be reviewed separately.",
  );
  expect(html).toContain("<dt>Current</dt><dd>At least 0</dd>");
  expect(html).toContain("<dt>Resolved</dt><dd>At least 0</dd>");
  expect(html).toContain("<dt>History</dt><dd>At least 0</dd>");
  expect(html).toContain("Full work history · History At least 0</a>");
});

test("renders an available canonical lifecycle time in its independent Gate column", () => {
  const html = render(
    { validity: "valid", value: { kind: "gate", id: "gate:one" } },
    { snapshot: createAvailableLifecycleTimeFixture() },
  );

  expect(html).toContain('<time dateTime="2026-07-31T10:00:00Z">');
});

test("renders bounded Planning Basis, Outputs, and Governance as Effort-owned regions", async () => {
  const active = render({
    validity: "valid",
    value: { kind: "effort", id: "effort:portal" },
  });
  expect(active).toContain('<section id="effort.planning-basis"><h2>Planning Basis</h2>');
  expect(active).toContain("<span>Map</span>");
  expect(active).toContain(">Portal Validation</a><small>Active</small>");
  expect(active).toContain("<span>PRD / Spec</span>");
  expect(active).toContain(">Portal Validation PRD</a><small>Ready for agent</small>");
  expect(active).not.toContain("Reach the accepted project outcome.");
  expect(active).not.toContain("<dt>Fog</dt>");
  expect(active).not.toContain("<h2>Outputs</h2>");
  expect(active).not.toContain("Governance &amp; References");
  expect(active).not.toContain("Lineage Context");
  expect(active.indexOf("<h2>Current Work</h2>")).toBeLessThan(
    active.indexOf("<h2>Planning Basis</h2>"),
  );

  const snapshot = createProjectOverviewFixture();
  if (snapshot.assets.validity === "invalid") throw new Error("Expected Assets.");
  const withOutput = withLineage({
    ...snapshot,
    assets: {
      ...snapshot.assets,
      items: snapshot.assets.items.map((asset) =>
        asset.id === "asset:planning-model-evidence"
          ? assetProjectionSchema.parse({
              ...asset,
              owner: "effort:model",
              disposition: "archived",
              archivedAt: { availability: "unavailable" },
            })
          : asset,
      ),
    },
  });
  const concluded = render(
    { validity: "valid", value: { kind: "effort", id: "effort:model" } },
    { snapshot: withOutput },
  );
  expect(concluded).toContain('<section id="effort.outputs"><h2>Outputs</h2>');
  expect(concluded).toContain("<span>reference</span>");
  expect(concluded).toContain(">Planning Model Evidence</a><small>Archived</small>");
  expect(concluded).toContain(
    '<section id="effort.governance"><h2>Governance &amp; References</h2>',
  );
  expect(concluded).toContain("<h3>Planning Citations</h3>");
  expect(concluded).not.toContain("<h3>Authorities</h3>");
  expect(concluded).not.toContain('id="relation.production.owned-assets"');
  expect(concluded).not.toContain('id="relation.planning-use.citations"');
  expect(concluded).not.toContain('id="relation.governance.authorities"');

  const css = await readFile(join(process.cwd(), "src/portal-ui/styles/lineage.css"), "utf8");
  expect(css).toMatch(
    /@media \(max-width: 820px\)[\s\S]*\.effort-governance-grid[\s\S]*grid-template-columns: 1fr;/u,
  );
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
              intent: "exact-scope-capture" as const,
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
    {
      snapshot: failed,
      observationActionLabel: "Load source",
      onObserveSource: () => {},
    },
  );

  expect(html).toContain('<dd data-health="needs-attention">Needs attention</dd>');
  expect(html).toContain("<h2>Current Work</h2>");
  expect(html).toContain("Managed work needs attention. Cause:");
  expect(html).toContain("The provider contract is unsupported.");
  expect(html).toContain("The declared Work Binding does not resolve to a provider observation.");
  expect(html).toContain("Load source");
  expect(html).toContain("run exact Targeted Native Reconciliation separately");
  expect(html).not.toContain("No nonterminal managed work is established");
  expect(html).not.toContain('class="matt-work-region');
});

test("renders one degraded Effort indication and a bound-scope work-details recovery", () => {
  const snapshot = createProjectOverviewFixture();
  const portal = snapshot.providerObservations.find(
    (observation) =>
      observation.binding.nativeScope === ".scratch/portal" &&
      (observation.state === "available" || observation.state === "partial"),
  );
  if (portal === undefined || (portal.state !== "available" && portal.state !== "partial")) {
    throw new Error("Expected the Portal observation.");
  }
  const stale = createProviderScopeObservation({
    ...portal,
    freshness: { ...portal.freshness, assessment: "stale" },
  } as never) as typeof portal;
  const candidate = withLineage({
    ...snapshot,
    providerObservations: snapshot.providerObservations.map((observation) =>
      observation.id === portal.id ? stale : observation,
    ),
    providerObservationSelections: snapshot.providerObservationSelections.map((selection) =>
      selection.observationId === portal.id
        ? { ...selection, observationId: stale.id, effectiveFreshness: "stale" as const }
        : selection,
    ),
  });
  const html = render(
    { validity: "valid", value: { kind: "effort", id: "effort:portal" } },
    {
      snapshot: candidate,
      observationActionLabel: "Load source",
      onObserveSource: () => {},
    },
  );

  expect(html).toContain(
    "Managed work details are stale; the last verified projection remains visible.",
  );
  expect(html.match(/Managed work details are stale/gu)).toHaveLength(1);
  expect(html).toContain("<dt>Last verified</dt><dd>2026-07-28T00:00:00.000Z</dd>");
  expect(html).toContain("Load source");
  expect(html).toContain("Build the Roadmap journey");
  expect(html).not.toContain("Source Event Time");
});

test("keeps provider observation feedback truthful for running and failed operations", () => {
  const snapshot = createProjectOverviewFixture();
  const portal = snapshot.providerObservations.find(
    (observation) => observation.binding.nativeScope === ".scratch/portal",
  );
  if (portal === undefined) throw new Error("Expected the Portal observation.");
  const stale = createProviderScopeObservation({
    ...portal,
    freshness: { ...portal.freshness, assessment: "stale" },
  } as never) as typeof portal;
  const candidate = withLineage({
    ...snapshot,
    providerObservations: snapshot.providerObservations.map((observation) =>
      observation.id === portal.id ? stale : observation,
    ),
    providerObservationSelections: snapshot.providerObservationSelections.map((selection) =>
      selection.observationId === portal.id
        ? { ...selection, observationId: stale.id, effectiveFreshness: "stale" as const }
        : selection,
    ),
  });
  const subject = {
    validity: "valid" as const,
    value: { kind: "effort" as const, id: "effort:portal" },
  };

  expect(
    render(subject, {
      snapshot: candidate,
      observationActionLabel: "Load source",
      observationBusy: true,
      onObserveSource: () => {},
    }),
  ).toContain("Observing source");
  const failed = renderToStaticMarkup(
    createElement(ProviderObservationStatus, {
      statusRef: createRef<HTMLDivElement>(),
      application: {
        state: "settled",
        result: {
          version: 1,
          state: "attention",
          action: "source-load",
          condition: "provider-network",
          acquisitionCount: 1,
          observations: [
            {
              scope: ".scratch/portal",
              disposition: "retained-after-failure",
              observedAt: "2026-07-28T00:00:00.000Z",
            },
          ],
          diagnostics: [
            {
              reference: "matt.github.acquisition.network",
              summary: "Provider observation needs Agent Surface attention.",
            },
          ],
          explanation: "The provider network was unavailable for this observation.",
          nextAction: "Open Bearing in the Agent Surface to diagnose provider connectivity.",
        },
      },
    }),
  );
  expect(failed).toContain("Last valid observation:");
  expect(failed).toContain('dateTime="2026-07-28T00:00:00.000Z"');
  expect(failed).not.toContain("Last valid observation: 2026-07-28T00:00:00.000Z");
  expect(failed).toContain("matt.github.acquisition.network");
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
  const degraded: ProjectGeneration = {
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
  expect(summarySection).toContain('<table class="effort-rollup-table">');
  for (const heading of [
    "Effort",
    "Lifecycle",
    "Claimed",
    "Ready",
    "Blocked",
    "Resolved",
    "Lifecycle time",
  ]) {
    expect(summarySection).toContain(`<th scope="col">${heading}</th>`);
  }
  expect(summarySection).toContain(
    'href="/projects/bearing/lineage/effort/effort%3Aportal">Web Portal Validation</a>',
  );
  expect(summarySection).toContain('<td data-label="Lifecycle">Active</td>');
  expect(summarySection).toContain('<td data-label="Claimed">1</td>');
  expect(summarySection).toContain('<td data-label="Ready">1</td>');
  expect(summarySection).toContain('<td data-label="Blocked">1</td>');
  expect(summarySection).toContain('<td data-label="Resolved">0</td>');
  expect(summarySection).toContain('<td data-label="Lifecycle time">Unavailable</td>');
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

  expect(html).toContain("Managed work needs attention");
  expect(html).toContain("Cause: this Effort has no declared Work Binding.");
  expect(html).toContain(
    "Impact: native work cannot contribute trusted evidence or Gate readiness.",
  );
  expect(html).toContain(
    "Recovery: declare exactly one supported Work Binding in the canonical Effort record, then reload this view.",
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
    const source = createSourceRecord(snapshot.basis.basisFingerprint, {
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
