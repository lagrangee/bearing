import assert from "node:assert/strict";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PlanningLineagePage } from "../src/portal-ui/planning-lineage-page";
import { portalRowsToProjectData } from "../src/portal-ui/project-row-adapter";
import { queryPortalProjectRows } from "../src/project-read-model/portal";
import { captureProjectProviderScopes } from "../src/project-read-model/provider-operations";
import { projectReadModelPath } from "../src/project-read-model/store";
import {
  createGitHubMattRepository,
  createReferenceGitHubFixtures,
  FixtureGitHubTransport,
  githubComment,
  githubFixtureResponse,
  githubIssue,
  githubMattProviderFactoryFor,
  writeStandardGitHubMattProductRepository,
} from "../tests/fixtures/github-matt-api";
import { createValidBearingRepo, writeFixture } from "../tests/helpers";

test("Spec document structure survives capture, SQLite publication, typed query, and Portal markup", async () => {
  const root = await createValidBearingRepo();
  try {
    await writeFixture(
      root,
      ".scratch/work/PRD.md",
      `# Reference Spec

Status: ready-for-agent

## Problem Statement

The current path loses document structure.

## Solution

Publish one **provider-neutral** document contract.

## User Stories

### Reading order

7. Preserve the first outcome.
8. Preserve the second outcome with *supporting detail* and \`inline code\`.
   - Keep one nested bullet.
     - Keep the deeper bullet and a [safe link](https://example.com/spec).

## Compatibility Notes

This additive section needs no Portal-specific renderer.

## Implementation Decisions

The provider owns source-schema adaptation.

## Testing Decisions

Test the highest stable product seam.

## Out of Scope

Do not parse raw Markdown in Portal.

## Further Notes

Gate Passage remains human-owned.
`,
    );

    const captured = await captureProjectProviderScopes(root, [".scratch/work"], {
      now: () => "2026-08-09T00:00:00.000Z",
    });
    assert.equal(captured.outcome, "complete");

    const target = { kind: "native-subject" as const, id: ".scratch/work/PRD.md" };
    const rows = await queryPortalProjectRows(root, "lineage", target);
    const snapshot = portalRowsToProjectData(rows);
    if (snapshot.section !== "lineage") throw new Error("Expected typed Portal lineage rows.");
    const observation = snapshot.providerObservations.find(
      (candidate) => candidate.binding.nativeScope === ".scratch/work",
    );
    if (
      observation === undefined ||
      (observation.state !== "available" && observation.state !== "partial") ||
      observation.projection.spec === undefined
    ) {
      throw new Error("Expected the typed Spec provider observation.");
    }
    const spec = observation.projection.spec;
    assert.equal(spec.document.version, 1);
    assert.equal("sections" in spec, false);
    assert.equal(
      spec.native.rawFacets.some((facet) => facet.key === "markdown"),
      false,
    );

    const html = renderToStaticMarkup(
      createElement(PlanningLineagePage, {
        entryId: "bearing",
        requested: {
          validity: "valid",
          value: target,
        },
        snapshot,
        onInspect: () => {},
        onNavigate: () => {},
      }),
    );
    assert.match(html, /<h1>Reference Spec<\/h1>/u);
    assert.match(html, /<h2>User Stories<\/h2>/u);
    assert.match(html, /<h3>Reading order<\/h3>/u);
    assert.match(html, /<ol start="7">/u);
    assert.match(html, /<ul><li>Keep one nested bullet\.<ul>/u);
    assert.match(html, /<strong>provider-neutral<\/strong>/u);
    assert.match(html, /<em>supporting detail<\/em>/u);
    assert.match(html, /<code>inline code<\/code>/u);
    assert.match(
      html,
      /<a href="https:\/\/example\.com\/spec" rel="noopener noreferrer" target="_blank">safe link<\/a>/u,
    );
    assert.match(html, /<h2>Compatibility Notes<\/h2>/u);
    assert.doesNotMatch(html, /<h[12]>Reading order<\/h[12]>/u);
    assert.doesNotMatch(html, /\*\*provider-neutral\*\*/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Map and Wayfinder authored documents retain structure without absorbing typed facts or provenance", async () => {
  const root = await createValidBearingRepo();
  try {
    await writeFixture(
      root,
      ".scratch/work/map.md",
      `# Wayfinder Map: Structured reading

Status: resolved

## Destination

Give the reader one **structured** destination with a [safe link](https://example.com/map).

### Outcome sequence

1. Preserve the first outcome.
2. Preserve the second outcome.
   - Keep its nested detail.

## Supporting Context

This additive section keeps its *provider title* and source order.

## Notes

- Notes remain typed.

## Decisions so far

- [Resolve the question](issues/01-finish.md) — The route is complete.

## Fog

- Fog remains typed.

## Out of scope

- Rewriting native lifecycle remains out of scope.
`,
    );
    await writeFixture(
      root,
      ".scratch/work/issues/01-finish.md",
      `# Resolve the question

Type: task

Status: resolved

## Question

Should the reader preserve **question structure**?

### Decision factors

- Keep the question independent from the Answer.

## Reader Context

This additive section renders without a role-specific Portal component.

## Answer

Yes. Preserve \`inline code\` and the ordered result.

1. Keep the Answer independent.
2. Keep provenance outside authored blocks.

## Comments

The first comment has *emphasis*.

- It also has list structure.

## Agent Brief

The second authored comment stays independent.
`,
    );

    const captured = await captureProjectProviderScopes(root, [".scratch/work"], {
      now: () => "2026-08-09T00:00:00.000Z",
    });
    assert.equal(captured.outcome, "complete");

    const target = {
      kind: "native-subject" as const,
      id: ".scratch/work/issues/01-finish.md",
    };
    const rows = await queryPortalProjectRows(root, "lineage", target);
    const snapshot = portalRowsToProjectData(rows);
    if (snapshot.section !== "lineage") throw new Error("Expected typed Portal lineage rows.");
    const observation = snapshot.providerObservations.find(
      (candidate) => candidate.binding.nativeScope === ".scratch/work",
    );
    if (
      observation === undefined ||
      (observation.state !== "available" && observation.state !== "partial") ||
      observation.projection.map === undefined ||
      observation.projection.wayfinderTickets[0] === undefined
    ) {
      throw new Error("Expected Map and Wayfinder provider documents.");
    }
    const map = observation.projection.map;
    const ticket = observation.projection.wayfinderTickets[0];
    assert.equal(map.destination.version, 1);
    assert.deepEqual(
      map.destination.sections.map((section) => section.title),
      ["Destination", "Supporting Context"],
    );
    assert.deepEqual(map.notes, ["Notes remain typed."]);
    assert.deepEqual(map.fog, ["Fog remains typed."]);
    assert.equal(map.decisions[0]?.gist, "The route is complete.");
    assert.equal(map.lifecycle.state, "resolved");
    assert.equal(ticket.question.version, 1);
    assert.deepEqual(
      ticket.question.sections.map((section) => section.title),
      ["Question", "Reader Context"],
    );
    assert.equal(ticket.answer.availability, "available");
    if (ticket.answer.availability !== "available") throw new Error("Expected an Answer.");
    assert.equal(ticket.answer.content.document.version, 1);
    assert.equal("body" in ticket.answer.content, false);
    assert.deepEqual(
      ticket.comments.map((comment) => comment.role),
      ["ordinary-comment", "agent-brief"],
    );
    assert.equal(
      ticket.comments.every((comment) => comment.document.version === 1),
      true,
    );
    assert.equal(
      ticket.comments.every((comment) => !("body" in comment)),
      true,
    );
    assert.equal(ticket.claim.state, "unclaimed");
    assert.equal(ticket.trackerClosure.state, "closed");

    const html = renderToStaticMarkup(
      createElement(PlanningLineagePage, {
        entryId: "bearing",
        requested: { validity: "valid", value: target },
        snapshot,
        onInspect: () => {},
        onNavigate: () => {},
      }),
    );
    assert.match(html, /<h2>Question<\/h2>/u);
    assert.match(html, /<h3>Decision factors<\/h3>/u);
    assert.match(html, /<strong>question structure<\/strong>/u);
    assert.match(html, /<h2>Answer<\/h2>/u);
    assert.match(html, /<ol>/u);
    assert.match(html, /<code>inline code<\/code>/u);
    assert.match(html, /<dt>Role<\/dt><dd>ordinary-comment<\/dd>/u);
    assert.match(html, /<dt>Role<\/dt><dd>agent-brief<\/dd>/u);
    assert.match(html, /<em>emphasis<\/em>/u);
    assert.doesNotMatch(html, /ordinary-comment: The first comment/u);
    assert.doesNotMatch(html, /source: .*The first comment/u);
    assert.match(html, /<h2>Reader Context<\/h2>/u);
    assert.match(html, /Native content position 1/u);
    assert.match(html, /Native content position 2/u);

    const mapTarget = {
      kind: "native-subject" as const,
      id: ".scratch/work/map.md",
    };
    const mapRows = await queryPortalProjectRows(root, "lineage", mapTarget);
    const mapSnapshot = portalRowsToProjectData(mapRows);
    if (mapSnapshot.section !== "lineage") throw new Error("Expected typed Map lineage rows.");
    const mapHtml = renderToStaticMarkup(
      createElement(PlanningLineagePage, {
        entryId: "bearing",
        requested: { validity: "valid", value: mapTarget },
        snapshot: mapSnapshot,
        onInspect: () => {},
        onNavigate: () => {},
      }),
    );
    assert.match(mapHtml, /<h2>Destination<\/h2>/u);
    assert.match(mapHtml, /<strong>structured<\/strong>/u);
    assert.match(mapHtml, /<h3>Outcome sequence<\/h3>/u);
    assert.match(mapHtml, /<ol>/u);
    assert.match(mapHtml, /Keep its nested detail/u);
    assert.match(mapHtml, /<h2>Supporting Context<\/h2>/u);
    assert.match(mapHtml, /<em>provider title<\/em>/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Delivery and Incoming authored documents retain structure without absorbing typed domain facts", async () => {
  const root = await createValidBearingRepo();
  try {
    await writeFixture(
      root,
      ".scratch/work/PRD.md",
      `# Delivery and Incoming reading

Status: ready-for-agent

## Problem Statement

Keep authored native documents readable without flattening typed facts.
`,
    );
    await writeFixture(
      root,
      ".scratch/work/issues/20-delivery.md",
      `# Deliver structured comments

**What to build:** Keep this **typed scalar** unchanged.

Blocked by: None — can start immediately

Status: resolved

- [x] Keep acceptance identity typed.
- [x] Keep completion evidence typed.

## Answer

The delivery is complete through the typed product seam.

## Comments

The Delivery comment keeps **authored emphasis**.

### Review sequence

1. Read the comment as a document.
2. Keep provenance outside its blocks.
`,
    );
    await writeFixture(
      root,
      ".scratch/work/issues/21-incoming.md",
      `# Investigate structured incoming content

Category: bug

Status: needs-triage

The Incoming body keeps a [safe source](https://example.com/incoming).

1. Preserve body order.
2. Preserve typed classification.

## Triage Notes

The triage note stays **independent** from the body.

### Triage context

- Keep this authored list.
`,
    );

    const captured = await captureProjectProviderScopes(root, [".scratch/work"], {
      now: () => "2026-08-09T00:00:00.000Z",
    });
    assert.equal(captured.outcome, "complete");
    const deliveryTarget = {
      kind: "native-subject" as const,
      id: ".scratch/work/issues/20-delivery.md",
    };
    const typedRows = await queryPortalProjectRows(root, "lineage", deliveryTarget);
    const typedSnapshot = portalRowsToProjectData(typedRows);
    if (typedSnapshot.section !== "lineage") {
      throw new Error("Expected typed Portal lineage rows.");
    }
    const observation = typedSnapshot.providerObservations.find(
      (candidate) => candidate.binding.nativeScope === ".scratch/work",
    );
    if (
      observation === undefined ||
      (observation.state !== "available" && observation.state !== "partial")
    ) {
      throw new Error("Expected typed Delivery and Incoming provider documents.");
    }
    const delivery = observation.projection.deliveryTickets[0];
    const incoming = observation.projection.incomingIssues[0];
    if (delivery === undefined || incoming === undefined) {
      throw new Error("Expected Delivery and Incoming fixtures.");
    }
    assert.equal(delivery.whatToBuild, "Keep this typed scalar unchanged.");
    assert.deepEqual(delivery.acceptanceCriteria, [
      "Keep acceptance identity typed.",
      "Keep completion evidence typed.",
    ]);
    assert.deepEqual(delivery.lifecycle, {
      state: "completed",
      evidence: [".scratch/work/issues/20-delivery.md#answer"],
    });
    assert.equal(delivery.trackerClosure.state, "closed");
    assert.equal("claim" in delivery, false);
    assert.equal(delivery.comments.length, 1);
    const deliveryComment = delivery.comments[0];
    if (deliveryComment === undefined) throw new Error("Expected one Delivery comment.");
    assert.equal("body" in deliveryComment, false);
    assert.equal("document" in deliveryComment, true);
    assert.deepEqual(incoming.classification, {
      category: "bug",
      state: "needs-triage",
      nativeCategory: "bug",
      nativeState: "needs-triage",
    });
    assert.equal(incoming.lifecycle.state, "open");
    assert.equal(incoming.native.kind, "local");
    if (incoming.native.kind !== "local") throw new Error("Expected Local Incoming evidence.");
    assert.equal(incoming.native.identity.locator, ".scratch/work/issues/21-incoming.md");
    assert.deepEqual(incoming.native.sourceAnchors, [
      { kind: "external", target: "https://example.com/incoming" },
    ]);
    assert.deepEqual(
      incoming.native.rawFacets.filter(
        (facet) => facet.key === "category" || facet.key === "status",
      ),
      [
        { key: "category", values: ["bug"] },
        { key: "status", values: ["needs-triage"] },
      ],
    );
    assert.deepEqual(
      incoming.content.map((content) => content.role),
      ["issue-body", "triage-note"],
    );
    assert.equal(
      incoming.content.every((content) => !("body" in content)),
      true,
    );
    assert.equal(
      incoming.content.every((content) => "document" in content),
      true,
    );

    for (const [target, expected] of [
      [
        { kind: "native-subject" as const, id: ".scratch/work/issues/20-delivery.md" },
        {
          headings: ["Comments", "Review sequence"],
          fragments: [
            "<strong>authored emphasis</strong>",
            "<ol>",
            "<dt>Role</dt><dd>ordinary-comment</dd>",
            "<h2>Completion Evidence</h2>",
            ".scratch/work/issues/20-delivery.md#answer",
          ],
        },
      ],
      [
        { kind: "native-subject" as const, id: ".scratch/work/issues/21-incoming.md" },
        {
          headings: ["Issue Content and Triage Notes", "Triage context"],
          fragments: [
            '<a href="https://example.com/incoming" rel="noopener noreferrer" target="_blank">safe source</a>',
            "<strong>independent</strong>",
            "<dt>Role</dt><dd>issue-body</dd>",
            "<dt>Role</dt><dd>triage-note</dd>",
            "<h2>Routing</h2><p>needs-triage</p>",
            "<dt>Source anchor</dt><dd>source: .scratch/work/issues/21-incoming.md</dd>",
          ],
        },
      ],
    ] as const) {
      const rows = await queryPortalProjectRows(root, "lineage", target);
      const snapshot = portalRowsToProjectData(rows);
      if (snapshot.section !== "lineage") throw new Error("Expected typed Portal lineage rows.");
      const html = renderToStaticMarkup(
        createElement(PlanningLineagePage, {
          entryId: "bearing",
          requested: { validity: "valid", value: target },
          snapshot,
          onInspect: () => {},
          onNavigate: () => {},
        }),
      );
      for (const heading of expected.headings) {
        assert.match(html, new RegExp(`<h[23]>${heading}</h[23]>`, "u"));
      }
      for (const fragment of expected.fragments) assert.ok(html.includes(fragment));
      assert.doesNotMatch(html, /ordinary-comment:|issue-body:|triage-note:/u);
    }

    const githubRoot = await createGitHubMattRepository();
    try {
      const repository = await writeStandardGitHubMattProductRepository(githubRoot, {
        title: "GitHub authored document parity",
        intent: "Prove Delivery and Incoming authored documents through the product seam.",
        work: "Capture one exact GitHub scope and read it from Portal rows.",
      });
      const githubDelivery = githubIssue({
        number: 4,
        title: "Deliver structured comments",
        labels: ["custom-ready"],
        state: "closed",
        stateReason: "completed",
        body: `## What to build

Keep this typed scalar unchanged.

## Acceptance criteria

- [x] Keep acceptance identity typed.
- [x] Keep completion evidence typed.
`,
      });
      const githubIncoming = githubIssue({
        number: 5,
        title: "Investigate structured incoming content",
        labels: ["custom-bug", "custom-ready", "same-project"],
        state: "closed",
        stateReason: "completed",
        body: `The Incoming body keeps a [safe source](https://example.com/incoming).

1. Preserve body order.
2. Preserve typed classification.
`,
      });
      const fixtures = createReferenceGitHubFixtures();
      fixtures["repos/example/reference/issues/4"] = {
        first: githubFixtureResponse(githubDelivery, '"issue-4-product-v1"'),
      };
      fixtures["repos/example/reference/issues/4/comments?per_page=100&page=1"] = {
        first: githubFixtureResponse(
          [
            githubComment({
              id: 401,
              issue: 4,
              author: "delivery-author",
              body: `The Delivery comment keeps **authored emphasis**.

### Review sequence

1. Read the comment as a document.
2. Keep provenance outside its blocks.`,
            }),
          ],
          '"comments-4-product-v1"',
        ),
      };
      fixtures["repos/example/reference/issues/5"] = {
        first: githubFixtureResponse(githubIncoming, '"issue-5-product-v1"'),
      };
      fixtures["repos/example/reference/issues/5/comments?per_page=100&page=1"] = {
        first: githubFixtureResponse(
          [
            githubComment({
              id: 501,
              issue: 5,
              author: "triage-author",
              body: `## Triage Notes

The triage note stays **independent** from the body.

### Triage context

- Keep this authored list.`,
            }),
          ],
          '"comments-5-product-v1"',
        ),
      };
      const transport = new FixtureGitHubTransport(fixtures);
      const githubCapture = await captureProjectProviderScopes(
        githubRoot,
        [repository.nativeScope],
        { providerFactory: githubMattProviderFactoryFor(transport) },
      );
      assert.equal(githubCapture.outcome, "complete");
      const acquisitionRequestCount = transport.requests.length;

      const githubRows = await queryPortalProjectRows(githubRoot, "lineage", {
        kind: "native-subject",
        id: "github:R_reference:I_reference_4",
      });
      const githubSnapshot = portalRowsToProjectData(githubRows);
      if (githubSnapshot.section !== "lineage") {
        throw new Error("Expected typed GitHub Portal lineage rows.");
      }
      const githubObservation = githubSnapshot.providerObservations.find(
        (candidate) => candidate.binding.nativeScope === repository.nativeScope,
      );
      if (
        githubObservation === undefined ||
        (githubObservation.state !== "available" && githubObservation.state !== "partial")
      ) {
        throw new Error("Expected typed GitHub Delivery and Incoming documents.");
      }
      const githubDeliveryProjection = githubObservation.projection.deliveryTickets[0];
      const githubIncomingProjection = githubObservation.projection.incomingIssues[0];
      if (githubDeliveryProjection === undefined || githubIncomingProjection === undefined) {
        throw new Error("Expected GitHub Delivery and Incoming projections.");
      }
      const documentReadingView = (
        documents: readonly Readonly<{
          role: string;
          document: Readonly<{ sections: readonly unknown[] }>;
        }>[],
      ) =>
        documents.map((document) => ({
          role: document.role,
          sections: document.document.sections,
        }));
      assert.deepEqual(
        documentReadingView(githubDeliveryProjection.comments),
        documentReadingView(delivery.comments),
      );
      assert.deepEqual(
        documentReadingView(githubIncomingProjection.content),
        documentReadingView(incoming.content),
      );
      assert.deepEqual(githubDeliveryProjection.trackerClosure, {
        state: "closed",
        disposition: "completed",
        closedAt: {
          availability: "available",
          value: "2026-07-20T00:00:00Z",
          precision: "second",
          basis: "source-event",
        },
        actor: "closer",
      });
      assert.deepEqual(githubIncomingProjection.classification, {
        category: "bug",
        state: "ready-for-agent",
        nativeCategory: "custom-bug",
        nativeState: "custom-ready",
      });
      assert.equal(githubIncomingProjection.lifecycle.state, "closed");
      assert.equal(githubIncomingProjection.native.kind, "github");
      if (githubIncomingProjection.native.kind !== "github") {
        throw new Error("Expected GitHub Incoming native evidence.");
      }
      assert.equal(githubIncomingProjection.native.trackerClosure.state, "closed");
      assert.equal(
        githubIncomingProjection.native.sourceAnchors.some(
          (anchor) => anchor.target === githubIncoming.html_url,
        ),
        true,
      );

      const githubHtml = renderToStaticMarkup(
        createElement(PlanningLineagePage, {
          entryId: "bearing",
          requested: {
            validity: "valid",
            value: { kind: "native-subject", id: "github:R_reference:I_reference_4" },
          },
          snapshot: githubSnapshot,
          onInspect: () => {},
          onNavigate: () => {},
        }),
      );
      for (const fragment of [
        "<strong>authored emphasis</strong>",
        "<dt>Actor</dt><dd>delivery-author</dd>",
        `<dt>Source anchor</dt><dd>source: https://github.com/example/reference/issues/4#issuecomment-401</dd>`,
        "<dt>Native identity</dt><dd>IC_401</dd>",
        "<dt>Comment authored by delivery-author</dt>",
      ]) {
        assert.ok(githubHtml.includes(fragment));
      }

      const githubIncomingRows = await queryPortalProjectRows(githubRoot, "lineage", {
        kind: "native-subject",
        id: "github:R_reference:I_reference_5",
      });
      const githubIncomingSnapshot = portalRowsToProjectData(githubIncomingRows);
      if (githubIncomingSnapshot.section !== "lineage") {
        throw new Error("Expected typed GitHub Incoming Portal rows.");
      }
      const githubIncomingHtml = renderToStaticMarkup(
        createElement(PlanningLineagePage, {
          entryId: "bearing",
          requested: {
            validity: "valid",
            value: { kind: "native-subject", id: "github:R_reference:I_reference_5" },
          },
          snapshot: githubIncomingSnapshot,
          onInspect: () => {},
          onNavigate: () => {},
        }),
      );
      for (const fragment of [
        "<h2>Routing</h2><p>ready-for-agent</p>",
        "<h2>Native Lifecycle</h2><p>closed · completed</p>",
        "<dt>Actor</dt><dd>reporter</dd>",
        "<dt>Actor</dt><dd>triage-author</dd>",
        "<dt>Issue body authored by reporter</dt>",
        "<dt>Triage note authored by triage-author</dt>",
      ]) {
        assert.ok(githubIncomingHtml.includes(fragment));
      }
      assert.equal(
        transport.requests.length,
        acquisitionRequestCount,
        "ordinary Portal queries and rendering must not call the provider transport",
      );
    } finally {
      await rm(githubRoot, { recursive: true, force: true });
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("unsafe Delivery and Incoming authored documents fail closed before publication", async () => {
  for (const scenario of ["delivery-comment", "incoming-body"] as const) {
    const root = await createValidBearingRepo();
    try {
      if (scenario === "delivery-comment") {
        await writeFixture(
          root,
          ".scratch/work/PRD.md",
          "# Unsafe Delivery\n\nStatus: ready-for-agent\n\n## Problem Statement\n\nFail closed.\n",
        );
        await writeFixture(
          root,
          ".scratch/work/issues/20-delivery.md",
          `# Unsafe Delivery comment

**What to build:** Keep typed facts separate.

Blocked by: None — can start immediately

Status: ready-for-agent

- [ ] Reject unsafe authored comments.

## Comments

[unsafe](javascript:alert(1))
`,
        );
      } else {
        await writeFixture(
          root,
          ".scratch/work/issues/21-incoming.md",
          `# Unsafe Incoming body

Category: bug

Status: needs-triage

<script>alert("unsafe")</script>
`,
        );
      }
      const captured = await captureProjectProviderScopes(root, [".scratch/work"], {
        now: () => "2026-08-09T00:00:00.000Z",
      });
      assert.equal(captured.outcome, "unfulfilled");
      const id =
        scenario === "delivery-comment"
          ? ".scratch/work/issues/20-delivery.md"
          : ".scratch/work/issues/21-incoming.md";
      const rows = await queryPortalProjectRows(root, "lineage", {
        kind: "native-subject",
        id,
      });
      assert.equal(
        rows.objects.some(
          (object) =>
            object.kind === "portal-native-evidence" &&
            object.value.observation?.binding.nativeScope === ".scratch/work",
        ),
        false,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test("unsafe Map and Wayfinder authored documents fail closed before publication", async () => {
  const root = await createValidBearingRepo();
  try {
    await writeFixture(
      root,
      ".scratch/work/map.md",
      `# Wayfinder Map: Unsafe Destination

Status: active

## Destination

<script>alert("unsafe")</script>

## Decisions so far

## Fog
`,
    );
    const unsafeMap = await captureProjectProviderScopes(root, [".scratch/work"], {
      now: () => "2026-08-09T00:00:00.000Z",
    });
    assert.equal(unsafeMap.outcome, "unfulfilled");

    await writeFixture(
      root,
      ".scratch/work/map.md",
      `# Wayfinder Map: Unsafe Answer

Status: resolved

## Destination

Preserve safe authored structure.

## Decisions so far

- [Resolve the question](issues/01-finish.md) — The route is complete.

## Fog
`,
    );
    await writeFixture(
      root,
      ".scratch/work/issues/01-finish.md",
      `# Resolve the question

Type: task

Status: resolved

## Question

Can unsafe authored content publish?

## Answer

[unsafe link](javascript:alert(1))
`,
    );
    const unsafeAnswer = await captureProjectProviderScopes(root, [".scratch/work"], {
      now: () => "2026-08-09T00:01:00.000Z",
    });
    assert.equal(unsafeAnswer.outcome, "unfulfilled");

    const rows = await queryPortalProjectRows(root, "lineage", {
      kind: "native-subject",
      id: ".scratch/work/issues/01-finish.md",
    });
    assert.equal(
      rows.objects.some(
        (object) =>
          object.kind === "portal-native-evidence" &&
          object.value.observation?.binding.nativeScope === ".scratch/work",
      ),
      false,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the self-host Architecture Contraction PRD retains its authored reading structure", async () => {
  const root = await createValidBearingRepo();
  try {
    const source = await readFile(
      join(process.cwd(), ".scratch/bearing-architecture-contraction/PRD.md"),
      "utf8",
    );
    await writeFixture(root, ".scratch/work/PRD.md", source);
    const captured = await captureProjectProviderScopes(root, [".scratch/work"], {
      now: () => "2026-08-09T00:00:00.000Z",
    });
    assert.equal(captured.outcome, "complete");

    const target = { kind: "native-subject" as const, id: ".scratch/work/PRD.md" };
    const rows = await queryPortalProjectRows(root, "lineage", target);
    const snapshot = portalRowsToProjectData(rows);
    if (snapshot.section !== "lineage") throw new Error("Expected typed Portal lineage rows.");
    const observation = snapshot.providerObservations.find(
      (candidate) => candidate.binding.nativeScope === ".scratch/work",
    );
    if (
      observation === undefined ||
      (observation.state !== "available" && observation.state !== "partial") ||
      observation.projection.spec === undefined
    ) {
      throw new Error("Expected the self-host Spec provider observation.");
    }
    const userStories = observation.projection.spec.document.sections.find(
      (section) => section.semanticRole === "spec.user-stories",
    );
    assert.equal(userStories?.availability, "available");
    assert.equal(
      userStories?.blocks.some(
        (block) => block.kind === "list" && block.style === "ordered" && block.items.length >= 125,
      ),
      true,
    );

    const html = renderToStaticMarkup(
      createElement(PlanningLineagePage, {
        entryId: "bearing",
        requested: { validity: "valid", value: target },
        snapshot,
        onInspect: () => {},
        onNavigate: () => {},
      }),
    );
    assert.match(html, /<h2>User Stories<\/h2>/u);
    assert.match(html, /<h3>Provider-neutral document reading and Project Brief refinement<\/h3>/u);
    assert.match(html, /<li>As a Portal reader, I want ordered lists to remain ordered/u);
    assert.match(html, /<code>effortIds<\/code>/u);
    assert.match(html, /<strong>AC-DR-01<\/strong>/u);
    assert.doesNotMatch(html, /## Provider-neutral document reading/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("unsafe authored content and incompatible stored documents fail closed before Portal query", async () => {
  const root = await createValidBearingRepo();
  try {
    await writeFixture(
      root,
      ".scratch/work/PRD.md",
      `# Unsafe Spec

Status: ready-for-agent

## Problem Statement

Safe context remains available.

## Solution

<script>alert("unsafe")</script>

## User Stories

[unsafe link](javascript:alert(1))
`,
    );
    const captured = await captureProjectProviderScopes(root, [".scratch/work"], {
      now: () => "2026-08-09T00:00:00.000Z",
    });
    assert.equal(captured.outcome, "unfulfilled");

    const target = { kind: "native-subject" as const, id: ".scratch/work/PRD.md" };
    const unsafeRows = await queryPortalProjectRows(root, "lineage", target);
    const unsafeSnapshot = portalRowsToProjectData(unsafeRows);
    if (unsafeSnapshot.section !== "lineage") {
      throw new Error("Expected typed Portal lineage rows.");
    }
    assert.equal(
      unsafeSnapshot.providerObservations.some(
        (observation) => observation.binding.nativeScope === ".scratch/work",
      ),
      false,
    );
    await writeFixture(
      root,
      ".scratch/work/PRD.md",
      `# Safe Spec

Status: ready-for-agent

## Problem Statement

Safe context remains available.
`,
    );
    const safeCapture = await captureProjectProviderScopes(root, [".scratch/work"], {
      now: () => "2026-08-09T00:01:00.000Z",
    });
    assert.equal(safeCapture.outcome, "complete");
    const safeRows = await queryPortalProjectRows(root, "lineage", target);
    const evidence = safeRows.objects.find(
      (object) =>
        object.kind === "portal-native-evidence" &&
        object.value.role === "bound" &&
        object.value.observation?.binding.nativeScope === ".scratch/work",
    );
    if (
      evidence?.kind !== "portal-native-evidence" ||
      evidence.value.observation === undefined ||
      (evidence.value.observation.state !== "available" &&
        evidence.value.observation.state !== "partial") ||
      evidence.value.observation.projection.spec === undefined
    ) {
      throw new Error("Expected a stored Portal-native Spec observation.");
    }

    const database = new DatabaseSync(projectReadModelPath(root));
    try {
      const stored = evidence.value.observation;
      const storedSpec = stored.projection.spec;
      if (storedSpec === undefined) throw new Error("Expected stored Spec content.");
      const incompatibleDocuments = [
        { ...storedSpec.document, version: 2 },
        {
          ...storedSpec.document,
          sections: storedSpec.document.sections.map((section, index) =>
            index === 0
              ? {
                  ...section,
                  availability: "available",
                  blocks: [{ kind: "html", value: '<script>alert("unsafe")</script>' }],
                }
              : section,
          ),
        },
      ];
      for (const document of incompatibleDocuments) {
        const tampered = {
          ...evidence.value,
          observation: {
            ...stored,
            projection: {
              ...stored.projection,
              spec: { ...storedSpec, document },
            },
          },
        };
        database
          .prepare(
            "UPDATE project_objects SET payload_json = ? WHERE reference = ? AND kind = 'portal-native-evidence'",
          )
          .run(JSON.stringify(tampered), evidence.value.id);
        await assert.rejects(queryPortalProjectRows(root, "lineage", target));
      }
    } finally {
      database.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
