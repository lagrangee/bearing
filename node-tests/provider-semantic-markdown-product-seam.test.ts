import assert from "node:assert/strict";
import { chmod, link, mkdir, realpath, rm, symlink } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { renderProviderMarkdownSections } from "../src/portal/markdown-engine";
import { createPortalProjectQueryService } from "../src/portal/project-query-service";
import { portalProjectRowsSchema } from "../src/portal-project-read-wire";
import { PlanningLineagePage } from "../src/portal-ui/planning-lineage-page";
import { portalRowsToProjectData } from "../src/portal-ui/project-row-adapter";
import { queryPortalProjectRows } from "../src/project-read-model/portal";
import { captureProjectProviderScopes } from "../src/project-read-model/provider-operations";
import { projectReadModelPath } from "../src/project-read-model/store";
import type { MattProviderFactory } from "../src/provider-acquisition";
import {
  createLocalMarkdownMattProvider,
  type LocalMarkdownCaptureEvent,
} from "../src/providers/matt-skills-v1/local-markdown";
import { mattProviderSemanticSections } from "../src/providers/matt-skills-v1/projection";
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
import { architectureContractionPrdReadingFixture } from "../tests/fixtures/provider-semantic-section";
import { createValidBearingRepo, writeFixture } from "../tests/helpers";

const portalData = (rows: Awaited<ReturnType<typeof queryPortalProjectRows>>) =>
  portalRowsToProjectData(
    portalProjectRowsSchema.parse({
      ...rows,
      renderedMarkdown: renderProviderMarkdownSections(
        rows.objects
          .flatMap((object) =>
            object.kind === "portal-native-evidence" && object.value.observation !== undefined
              ? [object.value.observation]
              : [],
          )
          .flatMap(mattProviderSemanticSections),
      ),
    }),
  );

test("linked content stays authored through Local capture, Portal, and Project Find", async () => {
  const root = await createValidBearingRepo();
  try {
    const issueLocator = ".scratch/work/issues/01-finish.md";
    const evidenceDirectory = ".scratch/work/evidence";
    const largeImageLocator = `${evidenceDirectory}/large.png`;
    const binaryLocator = `${evidenceDirectory}/binary.bin`;
    const missingLocator = `${evidenceDirectory}/missing.png`;
    const directoryLocator = `${evidenceDirectory}/directory`;
    const unsupportedLocator = `${evidenceDirectory}/unsupported.xyz`;
    const markdownLocator = `${evidenceDirectory}/reading.md`;
    const htmlLocator = `${evidenceDirectory}/reading.html`;
    const textLocator = `${evidenceDirectory}/reading.txt`;
    const audioLocator = `${evidenceDirectory}/sound.mp3`;
    const videoLocator = `${evidenceDirectory}/movie.mp4`;
    const pdfLocator = `${evidenceDirectory}/reading.pdf`;
    const overLimitLocator = `${evidenceDirectory}/over-limit.png`;
    const unreadableLocator = `${evidenceDirectory}/unreadable.txt`;
    const symlinkLocator = `${evidenceDirectory}/symlink.html`;
    const hardlinkLocator = `${evidenceDirectory}/hardlink.txt`;
    const linkedLocators = [
      largeImageLocator,
      binaryLocator,
      missingLocator,
      directoryLocator,
      unsupportedLocator,
      markdownLocator,
      htmlLocator,
      textLocator,
      audioLocator,
      videoLocator,
      pdfLocator,
      overLimitLocator,
      unreadableLocator,
      symlinkLocator,
      hardlinkLocator,
    ];
    await mkdir(`${root}/${directoryLocator}`, { recursive: true });
    await writeFixture(root, largeImageLocator, Buffer.alloc(1024 * 1024 + 1));
    await writeFixture(root, binaryLocator, Buffer.from([0xff]));
    await writeFixture(root, unsupportedLocator, "unsupported bytes\n");
    await writeFixture(root, markdownLocator, "# Linked Markdown\n");
    await writeFixture(root, htmlLocator, "<h1>Linked HTML</h1><script>bad()</script>\n");
    await writeFixture(root, textLocator, "Linked text\n");
    await writeFixture(root, audioLocator, "audio bytes");
    await writeFixture(root, videoLocator, "video bytes");
    await writeFixture(root, pdfLocator, "%PDF linked bytes");
    await writeFixture(root, overLimitLocator, Buffer.alloc(16 * 1024 * 1024 + 1));
    await writeFixture(root, unreadableLocator, "private\n");
    await chmod(`${root}/${unreadableLocator}`, 0);
    await symlink("reading.html", `${root}/${symlinkLocator}`);
    await writeFixture(root, `${evidenceDirectory}/hardlink-source.txt`, "linked twice\n");
    await link(`${root}/${evidenceDirectory}/hardlink-source.txt`, `${root}/${hardlinkLocator}`);
    await writeFixture(
      root,
      issueLocator,
      `# Finish

Type: task

Status: resolved

## Question

Can linked content remain authored only?

## Answer

Keep ![large image](../evidence/large.png), [binary target](../evidence/binary.bin),
[missing target](../evidence/missing.png), [directory target](../evidence/directory),
[unsupported target](../evidence/unsupported.xyz), [unsafe traversal](../../../../outside.md),
[Markdown target](../evidence/reading.md), [HTML target](../evidence/reading.html),
[text target](../evidence/reading.txt), [audio target](../evidence/sound.mp3),
[video target](../evidence/movie.mp4), [PDF target](../evidence/reading.pdf),
[over-limit target](../evidence/over-limit.png), [unreadable target](../evidence/unreadable.txt),
[symlink target](../evidence/symlink.html), [hardlink target](../evidence/hardlink.txt),
![HTTP image](http://images.example/plan.png), and
![HTTPS image](https://images.example/plan.png) as authored links.
`,
    );

    const captureEvents: LocalMarkdownCaptureEvent[] = [];
    const providerFactory: MattProviderFactory = (input) => {
      assert.equal(input.driver, "local-markdown");
      return createLocalMarkdownMattProvider({
        repoRoot: input.repoRoot,
        contractLocator: input.configuration.contractLocator,
        capturedDocuments: input.capturedDocuments,
        clock: () => new Date("2026-08-10T00:00:00.000Z"),
        onCaptureEvent: (event) => {
          captureEvents.push(event);
        },
      });
    };
    const capture = async () => {
      const eventStart = captureEvents.length;
      const result = await captureProjectProviderScopes(root, [".scratch/work"], {
        now: () => "2026-08-10T00:00:00.000Z",
        providerFactory,
      });
      const reads = captureEvents
        .slice(eventStart)
        .filter((event) => event.kind === "content-read")
        .map((event) => event.locator);
      assert.equal(result.outcome, "complete");
      assert.equal(result.result.acquisitionCount, 1);
      assert.equal(
        linkedLocators.some((locator) => reads.includes(locator)),
        false,
      );
      return result;
    };

    await capture();
    const target = { kind: "native-subject" as const, id: issueLocator };
    const firstRows = await queryPortalProjectRows(root, "lineage", target);
    const firstSnapshot = portalData(firstRows);
    if (firstSnapshot.section !== "lineage") {
      throw new Error("Expected typed Local Portal lineage rows.");
    }
    const firstObservation = firstSnapshot.providerObservations.find(
      (candidate) => candidate.binding.nativeScope === ".scratch/work",
    );
    if (
      firstObservation === undefined ||
      firstObservation.state !== "available" ||
      firstObservation.projection.wayfinderTickets[0] === undefined
    ) {
      throw new Error("Expected one complete Local linked-content observation.");
    }
    const firstTruth = {
      id: firstObservation.id,
      sourceRevision: firstObservation.sourceRevision,
      state: firstObservation.state,
      freshness: firstObservation.freshness,
      coverage: firstObservation.coverage,
      completion: firstObservation.completion,
      evidence: firstObservation.projection.wayfinderTickets[0].answer,
    };

    await writeFixture(root, largeImageLocator, Buffer.alloc(1024 * 1024 + 2, 1));
    await rm(`${root}/${binaryLocator}`);
    await writeFixture(root, missingLocator, "new linked bytes\n");
    await writeFixture(root, unsupportedLocator, "changed linked bytes\n");
    await capture();

    const portalRoot = await realpath(root);
    const service = createPortalProjectQueryService({
      readCatalog: async () => ({
        state: "ready",
        entries: [
          {
            entryId: "bearing",
            displayName: "Bearing",
            repoRoot: portalRoot,
            availability: "available",
          },
        ],
      }),
    });
    const portalRead = await service.read("bearing", "lineage", target);
    assert.equal(portalRead.kind, "ready");
    if (portalRead.kind !== "ready") throw new Error("Expected a production Portal read.");
    const secondSnapshot = portalRowsToProjectData(portalProjectRowsSchema.parse(portalRead.rows));
    const linkedRender = portalRead.rows.renderedMarkdown.find(
      (candidate) =>
        candidate.sourceLocator === issueLocator && candidate.markdown.includes("large image"),
    );
    assert.ok(linkedRender);
    assert.match(linkedRender.html, /class="markdown-linked-image-thumbnail"/u);
    assert.match(linkedRender.html, /loading="lazy"/u);
    assert.match(linkedRender.html, /href="\/preview\/projects\/bearing\/linked\/[a-f0-9]{64}"/u);
    assert.match(linkedRender.html, /Preview unavailable: The linked content is missing\./u);
    assert.match(linkedRender.html, /The linked target is a directory/u);
    assert.match(linkedRender.html, /not supported for safe Preview/u);
    assert.match(linkedRender.html, /not a safe repository-relative locator/u);
    assert.match(linkedRender.html, /exceeds the 16 MiB Preview limit/u);
    assert.match(linkedRender.html, /linked content is unreadable/u);
    assert.match(linkedRender.html, /failed repository containment or link safety checks/u);
    for (const label of [
      "Markdown target",
      "HTML target",
      "text target",
      "audio target",
      "video target",
      "PDF target",
    ]) {
      assert.match(
        linkedRender.html,
        new RegExp(`href="/preview/projects/bearing/linked/[a-f0-9]{64}"[^>]*>${label}</a>`, "u"),
      );
    }
    for (const [label, source] of [
      ["HTTP image", "http://images.example/plan.png"],
      ["HTTPS image", "https://images.example/plan.png"],
    ]) {
      assert.ok(
        linkedRender.html.includes(
          `<a class="markdown-linked-image" href="${source}" target="_blank" rel="noopener noreferrer"><img class="markdown-linked-image-thumbnail" src="${source}" alt="${label}" loading="lazy" /></a>`,
        ),
      );
    }
    assert.doesNotMatch(linkedRender.html, new RegExp(root, "u"));
    assert.doesNotMatch(linkedRender.html, /\.scratch\/work\/evidence/u);
    if (secondSnapshot.section !== "lineage") {
      throw new Error("Expected typed Local Portal lineage rows.");
    }
    const secondObservation = secondSnapshot.providerObservations.find(
      (candidate) => candidate.binding.nativeScope === ".scratch/work",
    );
    if (
      secondObservation === undefined ||
      secondObservation.state !== "available" ||
      secondObservation.projection.wayfinderTickets[0] === undefined
    ) {
      throw new Error("Expected one stable Local linked-content observation.");
    }
    assert.deepEqual(
      {
        id: secondObservation.id,
        sourceRevision: secondObservation.sourceRevision,
        state: secondObservation.state,
        freshness: secondObservation.freshness,
        coverage: secondObservation.coverage,
        completion: secondObservation.completion,
        evidence: secondObservation.projection.wayfinderTickets[0].answer,
      },
      firstTruth,
    );

    const html = renderToStaticMarkup(
      createElement(PlanningLineagePage, {
        entryId: "bearing",
        requested: { validity: "valid", value: target },
        snapshot: secondSnapshot,
        onInspect: () => {},
        onNavigate: () => {},
      }),
    );
    for (const text of [
      "large image",
      "binary target",
      "missing target",
      "directory target",
      "unsupported target",
      "unsafe traversal",
      "HTTP image",
      "HTTPS image",
    ]) {
      assert.match(html, new RegExp(text, "u"));
    }
    const find = await service.search("bearing", "binary target");
    assert.equal(find.kind, "ready");
    if (find.kind !== "ready") throw new Error("Expected a production Project Find read.");
    assert.ok(find.find.results.some((result) => result.subject.id === issueLocator));
  } finally {
    await chmod(`${root}/.scratch/work/evidence/unreadable.txt`, 0o600).catch(() => {});
    await rm(root, { recursive: true, force: true });
  }
});

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
    const snapshot = portalData(rows);
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
    assert.equal(spec.document[0]?.version, 1);
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
    assert.match(html, /<ul>[\s\S]*<li>Keep one nested bullet\.[\s\S]*<ul>/u);
    assert.match(html, /<strong>provider-neutral<\/strong>/u);
    assert.match(html, /<em>supporting detail<\/em>/u);
    assert.match(html, /<code>inline code<\/code>/u);
    assert.match(
      html,
      /<a href="https:\/\/example\.com\/spec" target="_blank" rel="noopener noreferrer">safe link<\/a>/u,
    );
    assert.match(html, /<h2>Compatibility Notes<\/h2>/u);
    assert.doesNotMatch(html, /<h[12]>Reading order<\/h[12]>/u);
    assert.doesNotMatch(html, /\*\*provider-neutral\*\*/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Host wire keeps every acquired section readable", async () => {
  const root = await createValidBearingRepo();
  try {
    const requiredSections = [
      ["Problem Statement", "Keep the acquired problem statement."],
      ["Solution", "Keep the acquired solution."],
      ["User Stories", "Keep the acquired user stories."],
      ["Implementation Decisions", "Keep the acquired implementation decisions."],
      ["Testing Decisions", "Keep the acquired testing decisions."],
      ["Out of Scope", "Keep the acquired exclusions."],
      ["Further Notes", "Keep the acquired notes."],
    ] as const;
    const additiveSections = Array.from(
      { length: 10 },
      (_, index) =>
        [`Additional Reading ${index}`, `Preserve additional section ${index}.`] as const,
    );
    const authored = `# Large valid reading corpus

Status: ready-for-agent

${[...requiredSections, ...additiveSections]
  .map(([title, body]) => `## ${title}\n\n${body}`)
  .join("\n\n")}
`;
    assert.ok(Buffer.byteLength(authored) < 1_048_576);
    await writeFixture(root, ".scratch/work/PRD.md", authored);

    const captured = await captureProjectProviderScopes(root, [".scratch/work"], {
      now: () => "2026-08-09T00:00:00.000Z",
    });
    assert.equal(captured.outcome, "complete");
    const rows = await queryPortalProjectRows(root, "lineage", {
      kind: "native-subject",
      id: ".scratch/work/PRD.md",
    });
    const snapshot = portalData(rows);
    if (snapshot.section !== "lineage") throw new Error("Expected typed Spec lineage rows.");
    const observation = snapshot.providerObservations.find(
      (candidate) => candidate.binding.nativeScope === ".scratch/work",
    );
    if (
      observation === undefined ||
      (observation.state !== "available" && observation.state !== "partial")
    ) {
      throw new Error("Expected the large acquired Spec observation.");
    }
    const acquiredSections = observation.projection.spec?.document.length ?? 0;
    assert.ok(acquiredSections >= 17);
    const allAcquiredSections = rows.objects
      .flatMap((object) =>
        object.kind === "portal-native-evidence" && object.value.observation !== undefined
          ? [object.value.observation]
          : [],
      )
      .flatMap(mattProviderSemanticSections);
    const uniqueAvailableMarkdown = new Set(
      allAcquiredSections.flatMap((section) =>
        section.availability === "available" ? [section.markdown] : [],
      ),
    );
    assert.equal(snapshot.renderedMarkdown.length, uniqueAvailableMarkdown.size);

    const html = renderToStaticMarkup(
      createElement(PlanningLineagePage, {
        entryId: "bearing",
        requested: {
          validity: "valid",
          value: { kind: "native-subject", id: ".scratch/work/PRD.md" },
        },
        snapshot,
        onInspect: () => {},
        onNavigate: () => {},
      }),
    );
    assert.match(html, /Additional Reading 9/u);
    assert.match(html, /Preserve additional section 9\./u);
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
    const snapshot = portalData(rows);
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
    assert.equal(map.destination[0]?.version, 1);
    assert.deepEqual(
      map.destination.map((section) => section.title),
      ["Destination", "Supporting Context"],
    );
    assert.deepEqual(map.notes, ["Notes remain typed."]);
    assert.deepEqual(map.fog, ["Fog remains typed."]);
    assert.equal(map.decisions[0]?.gist, "The route is complete.");
    assert.equal(map.lifecycle.state, "resolved");
    assert.equal(ticket.question[0]?.version, 1);
    assert.deepEqual(
      ticket.question.map((section) => section.title),
      ["Question", "Reader Context"],
    );
    assert.equal(ticket.answer.availability, "available");
    if (ticket.answer.availability !== "available") throw new Error("Expected an Answer.");
    assert.equal(ticket.answer.content.document[0]?.version, 1);
    assert.equal("body" in ticket.answer.content, false);
    assert.deepEqual(
      ticket.comments.map((comment) => comment.role),
      ["ordinary-comment", "agent-brief"],
    );
    assert.equal(
      ticket.comments.every((comment) => comment.document[0]?.version === 1),
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
    const mapSnapshot = portalData(mapRows);
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
    const typedSnapshot = portalData(typedRows);
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
            '<a href="https://example.com/incoming" target="_blank" rel="noopener noreferrer">safe source</a>',
            "<strong>independent</strong>",
            "<dt>Role</dt><dd>issue-body</dd>",
            "<dt>Role</dt><dd>triage-note</dd>",
            "<dt>Routing</dt><dd>needs-triage</dd>",
            "<dt>Source anchor</dt><dd>source: .scratch/work/issues/21-incoming.md</dd>",
          ],
        },
      ],
    ] as const) {
      const rows = await queryPortalProjectRows(root, "lineage", target);
      const snapshot = portalData(rows);
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
      for (const fragment of expected.fragments) {
        assert.ok(html.includes(fragment), `Missing Portal fragment: ${fragment}`);
      }
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
2. Preserve typed classification.`,
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
      const githubSnapshot = portalData(githubRows);
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
          document: readonly unknown[];
        }>[],
      ) =>
        documents.map((document) => ({
          role: document.role,
          sections: document.document,
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
      const githubIncomingSnapshot = portalData(githubIncomingRows);
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
        "<dt>Routing</dt><dd>ready-for-agent</dd>",
        "<dt>Disposition</dt><dd>completed</dd>",
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

test("unsupported GitHub comment capability still publishes readable Portal and Find content", async () => {
  const root = await createGitHubMattRepository();
  try {
    const repository = await writeStandardGitHubMattProductRepository(root, {
      title: "GitHub unsupported comment capability",
      intent: "Keep readable authored content when the comments endpoint is unsupported.",
      work: "Capture one exact GitHub scope and publish its partial capability evidence.",
    });
    const fixtures = createReferenceGitHubFixtures();
    for (const issueNumber of [3, 4, 5]) {
      fixtures[`repos/example/reference/issues/${issueNumber}/comments?per_page=100&page=1`] = {
        first: { status: 410, headers: {} },
      };
    }
    const transport = new FixtureGitHubTransport(fixtures);
    const captured = await captureProjectProviderScopes(root, [repository.nativeScope], {
      providerFactory: githubMattProviderFactoryFor(transport),
    });
    assert.equal(captured.outcome, "complete");
    assert.deepEqual(captured.result.scopes, [
      { scope: repository.nativeScope, disposition: "captured" },
    ]);

    const target = {
      kind: "native-subject" as const,
      id: "github:R_reference:I_reference_5",
    };
    const providerRequestCount = transport.requests.length;
    const portalRoot = await realpath(root);
    const service = createPortalProjectQueryService({
      readCatalog: async () => ({
        state: "ready",
        entries: [
          {
            entryId: "bearing",
            displayName: "Bearing",
            repoRoot: portalRoot,
            availability: "available",
          },
        ],
      }),
    });
    const portalRead = await service.read("bearing", "lineage", target);
    assert.equal(portalRead.kind, "ready");
    if (portalRead.kind !== "ready") throw new Error("Expected a production Portal read.");
    const snapshot = portalRowsToProjectData(portalProjectRowsSchema.parse(portalRead.rows));
    if (snapshot.section !== "lineage") {
      throw new Error("Expected typed GitHub Portal lineage rows.");
    }
    const observation = snapshot.providerObservations.find(
      (candidate) => candidate.binding.nativeScope === repository.nativeScope,
    );
    if (
      observation === undefined ||
      (observation.state !== "available" && observation.state !== "partial")
    ) {
      throw new Error("Expected a published GitHub observation with unsupported capabilities.");
    }
    assert.equal(observation.freshness.assessment, "current");
    assert.deepEqual(
      mattProviderSemanticSections(observation)
        .filter((section) => section.availability === "unsupported")
        .map((section) => section.sourceIdentity),
      [
        "wayfinder.answer.unsupported",
        "wayfinder.comments.unsupported",
        "delivery.comments.unsupported",
        "incoming.content.unsupported",
      ],
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
    assert.match(html, /Reporter prose with/u);
    assert.match(html, /This provider document section is unsupported\./u);
    const find = await service.search("bearing", "Reporter prose");
    assert.equal(find.kind, "ready");
    if (find.kind !== "ready") throw new Error("Expected a production Project Find read.");
    assert.ok(
      find.find.results.some(
        (result) => result.subject.kind === "native-subject" && result.subject.id === target.id,
      ),
    );
    assert.equal(transport.requests.length, providerRequestCount);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("unsafe Delivery and Incoming Markdown survives capture and is inert in Portal", async () => {
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
      assert.equal(captured.outcome, "complete");
      const id =
        scenario === "delivery-comment"
          ? ".scratch/work/issues/20-delivery.md"
          : ".scratch/work/issues/21-incoming.md";
      const rows = await queryPortalProjectRows(root, "lineage", {
        kind: "native-subject",
        id,
      });
      const snapshot = portalData(rows);
      if (snapshot.section !== "lineage") throw new Error("Expected Portal lineage rows.");
      const html = renderToStaticMarkup(
        createElement(PlanningLineagePage, {
          entryId: "bearing",
          requested: { validity: "valid", value: { kind: "native-subject", id } },
          snapshot,
          onInspect: () => {},
          onNavigate: () => {},
        }),
      );
      assert.doesNotMatch(html, /<(?:script|iframe|form|img)\b/iu);
      assert.doesNotMatch(html, /href="javascript:/iu);
      assert.match(html, scenario === "delivery-comment" ? /unsafe/u : /&lt;script&gt;/u);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test("unsafe Map and Wayfinder Markdown stays provider truth and renders inert", async () => {
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

- [Resolve the question](issues/01-finish.md) — Existing route.

## Fog
`,
    );
    const unsafeMap = await captureProjectProviderScopes(root, [".scratch/work"], {
      now: () => "2026-08-09T00:00:00.000Z",
    });
    assert.equal(unsafeMap.outcome, "complete");
    const mapRows = await queryPortalProjectRows(root, "lineage", {
      kind: "native-subject",
      id: ".scratch/work/map.md",
    });
    const mapSnapshot = portalData(mapRows);
    if (mapSnapshot.section !== "lineage") throw new Error("Expected Map lineage rows.");
    const mapHtml = renderToStaticMarkup(
      createElement(PlanningLineagePage, {
        entryId: "bearing",
        requested: {
          validity: "valid",
          value: { kind: "native-subject", id: ".scratch/work/map.md" },
        },
        snapshot: mapSnapshot,
        onInspect: () => {},
        onNavigate: () => {},
      }),
    );
    assert.doesNotMatch(mapHtml, /<script\b/iu);
    assert.match(mapHtml, /&lt;script&gt;/u);

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
    assert.equal(unsafeAnswer.outcome, "complete");

    const rows = await queryPortalProjectRows(root, "lineage", {
      kind: "native-subject",
      id: ".scratch/work/issues/01-finish.md",
    });
    const snapshot = portalData(rows);
    if (snapshot.section !== "lineage") throw new Error("Expected Wayfinder lineage rows.");
    const html = renderToStaticMarkup(
      createElement(PlanningLineagePage, {
        entryId: "bearing",
        requested: {
          validity: "valid",
          value: { kind: "native-subject", id: ".scratch/work/issues/01-finish.md" },
        },
        snapshot,
        onInspect: () => {},
        onNavigate: () => {},
      }),
    );
    assert.doesNotMatch(html, /href="javascript:/iu);
    assert.match(html, /unsafe link/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the committed Architecture Contraction PRD corpus retains its authored reading structure", async () => {
  const root = await createValidBearingRepo();
  try {
    await writeFixture(root, ".scratch/work/PRD.md", architectureContractionPrdReadingFixture);
    const captured = await captureProjectProviderScopes(root, [".scratch/work"], {
      now: () => "2026-08-09T00:00:00.000Z",
    });
    assert.equal(captured.outcome, "complete");

    const target = { kind: "native-subject" as const, id: ".scratch/work/PRD.md" };
    const rows = await queryPortalProjectRows(root, "lineage", target);
    const snapshot = portalData(rows);
    if (snapshot.section !== "lineage") throw new Error("Expected typed Portal lineage rows.");
    const observation = snapshot.providerObservations.find(
      (candidate) => candidate.binding.nativeScope === ".scratch/work",
    );
    if (
      observation === undefined ||
      (observation.state !== "available" && observation.state !== "partial") ||
      observation.projection.spec === undefined
    ) {
      throw new Error("Expected the committed Spec corpus provider observation.");
    }
    const userStories = observation.projection.spec.document.find(
      (section) => section.semanticRole === "spec.user-stories",
    );
    assert.equal(userStories?.availability, "available");
    assert.deepEqual(userStories?.markdown.match(/^\d+\.[ \t]/gmu), [
      "126. ",
      "127. ",
      "128. ",
      "129. ",
    ]);

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
    assert.match(html, /Preserve the observed Markdown instead of serializing mdast/u);
    assert.match(html, /<strong>AC-DR-01<\/strong>/u);
    assert.doesNotMatch(html, /## Provider-neutral document reading/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("unsafe authored content is sanitized and incompatible stored sections fail closed", async () => {
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
    assert.equal(captured.outcome, "complete");

    const target = { kind: "native-subject" as const, id: ".scratch/work/PRD.md" };
    const unsafeRows = await queryPortalProjectRows(root, "lineage", target);
    const unsafeSnapshot = portalData(unsafeRows);
    if (unsafeSnapshot.section !== "lineage") {
      throw new Error("Expected typed Portal lineage rows.");
    }
    const unsafeHtml = renderToStaticMarkup(
      createElement(PlanningLineagePage, {
        entryId: "bearing",
        requested: { validity: "valid", value: target },
        snapshot: unsafeSnapshot,
        onInspect: () => {},
        onNavigate: () => {},
      }),
    );
    assert.doesNotMatch(unsafeHtml, /<script\b|href="javascript:/iu);
    assert.match(unsafeHtml, /&lt;script&gt;/u);
    assert.match(unsafeHtml, /unsafe link/u);
    const evidence = unsafeRows.objects.find(
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
        storedSpec.document.map((section, index) =>
          index === 0 ? { ...section, version: 2 } : section,
        ),
        storedSpec.document.map((section, index) =>
          index === 0 ? { ...section, html: '<script>alert("unsafe")</script>' } : section,
        ),
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
