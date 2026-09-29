import { expect, test } from "bun:test";
import { createProviderScopeObservation } from "../src/native-work-provider";
import { planningLineageSubjectHref } from "../src/planning-lineage-route";
import {
  buildProjectFindDocuments,
  buildProjectFindIndex,
  tokenizeProjectFindText,
} from "../src/portal-ui/project-find-model";
import type { ProjectGeneration } from "../src/project-generation/contract";
import { createProjectOverviewFixture } from "./fixtures/project-overview";
import { parseRebuiltPlanningLineageFixture } from "./planning-lineage-fixture";

const snapshotFixture = createProjectOverviewFixture;

test("builds one current-generation document per identity-bearing subject", () => {
  const snapshot = snapshotFixture();
  const documents = buildProjectFindDocuments(snapshot, "bearing");

  expect(documents.length).toBeGreaterThan(0);
  expect(
    new Set(documents.map((document) => `${document.subject.kind}:${document.subject.id}`)).size,
  ).toBe(documents.length);
  expect(documents.some((document) => document.subject.kind === "asset")).toBe(true);
  expect(documents.some((document) => document.subject.kind === "audit")).toBe(true);
  expect(documents.some((document) => document.subject.kind === "native-subject")).toBe(true);
  expect(
    documents.find((document) => document.subject.id === ".scratch/portal/issues/03-gate.md")
      ?.subjectType,
  ).toBe("Delivery");
});

test("excludes native subjects while a planned Effort binding is not-created", () => {
  const snapshot = snapshotFixture();
  if (snapshot.efforts.validity === "invalid") throw new Error("Expected Efforts.");
  const withoutBinding = parseRebuiltPlanningLineageFixture({
    ...snapshot,
    efforts: {
      ...snapshot.efforts,
      items: snapshot.efforts.items.map((effort) =>
        effort.id === "effort:portal"
          ? {
              ...effort,
              lifecycle: "planned" as const,
              activatedAt: undefined,
              conclusion: undefined,
              workBinding: undefined,
              workBindingState: { state: "not-created" as const },
            }
          : effort,
      ),
    },
  });
  const documents = buildProjectFindDocuments(withoutBinding, "bearing");

  expect(
    documents.some(
      (document) =>
        (document.subject.kind === "native-scope" || document.subject.kind === "native-subject") &&
        document.subject.id.startsWith(".scratch/portal"),
    ),
  ).toBe(false);
  expect(documents.some((document) => document.subject.kind === "roadmap")).toBe(true);
});

test("indexes the managed Audit and inspection-backed bound work", () => {
  const snapshot = snapshotFixture();
  const observation = snapshot.providerObservations.find(
    (candidate) => candidate.binding.nativeScope === ".scratch/portal",
  );
  const selection = snapshot.providerObservationSelections.find(
    (candidate) => candidate.nativeScope === ".scratch/portal",
  );
  if (observation === undefined || selection === undefined) {
    throw new Error("Expected bound portal observation fixture.");
  }
  const inspectionBacked = parseRebuiltPlanningLineageFixture({
    ...snapshot,
    providerObservations: snapshot.providerObservations.filter(
      (candidate) => candidate !== observation,
    ),
    providerObservationSelections: snapshot.providerObservationSelections.filter(
      (candidate) => candidate !== selection,
    ),
    providerDetailEvidences: {
      observations: [observation],
      selections: [
        {
          ...selection,
          latestAttempt: {
            intent: "provider-detail-selection",
            attemptedAt: "2026-07-14T12:00:00+08:00",
            outcome: "succeeded",
            diagnostics: [],
          },
        },
      ],
    },
  });
  const index = buildProjectFindIndex(inspectionBacked, "bearing");

  expect(index.search("Planning Audit")[0]).toMatchObject({
    subject: { kind: "audit", id: "planning-audit:current" },
    subjectType: "Audit",
    href: "/projects/bearing/audit",
  });
  expect(index.search("Pass the integration gate")[0]?.subject).toEqual({
    kind: "native-subject",
    id: ".scratch/portal/issues/03-gate.md",
  });

  const boundWithoutObservation = {
    ...inspectionBacked,
    providerObservationSelections: [
      { ...selection, observationId: null, effectiveFreshness: "undetermined" as const },
    ],
  };
  const missing = buildProjectFindIndex(boundWithoutObservation, "bearing");
  expect(missing.search("Pass the integration gate")[0]?.subject).toEqual({
    kind: "native-subject",
    id: ".scratch/portal/issues/03-gate.md",
  });
  expect(missing.scopeState.state).toBe("unavailable");
});

test("does not recall body or comment text from Provider Markdown sections", () => {
  const snapshot = snapshotFixture();
  const observation = snapshot.providerObservations.find(
    (candidate) => candidate.binding.nativeScope === ".scratch/portal",
  );
  const selection = snapshot.providerObservationSelections.find(
    (candidate) => candidate.nativeScope === ".scratch/portal",
  );
  if (
    observation === undefined ||
    selection === undefined ||
    (observation.state !== "available" && observation.state !== "partial")
  ) {
    throw new Error("Expected the bound Portal observation.");
  }
  const additive = (
    sourceIdentity: string,
    title: string,
    sourceOrder: number,
    markdown: string,
  ) => ({
    version: 1 as const,
    sourceIdentity,
    title,
    sourceOrder,
    availability: "available" as const,
    markdown,
  });
  const authoredDocument = (semanticRole: string, title: string, markdown: string) => [
    {
      ...additive(`${semanticRole}.ordinary-comment`, title, 0, markdown),
      semanticRole,
    },
    additive(
      `${semanticRole}.additional.find-proof`,
      "Additional Find Proof",
      1,
      `${markdown} extra`,
    ),
  ];
  const projection = observation.projection;
  const augmented = createProviderScopeObservation({
    provider: observation.provider,
    binding: observation.binding,
    observedAt: observation.observedAt,
    ...(observation.sourceRevision === undefined
      ? {}
      : { sourceRevision: observation.sourceRevision }),
    ...(observation.sourceObservedAt === undefined
      ? {}
      : { sourceObservedAt: observation.sourceObservedAt }),
    validators: observation.validators,
    freshness: observation.freshness,
    state: observation.state,
    completion: observation.completion,
    diagnostics: observation.diagnostics,
    coverage: {
      assessment: observation.coverage.assessment,
      dimensions: observation.coverage.dimensions.map((dimension) => ({
        key: dimension.key,
        state: dimension.state,
        ...(dimension.detail === undefined ? {} : { detail: dimension.detail }),
      })),
    },
    projection: {
      ...projection,
      map:
        projection.map === undefined
          ? undefined
          : {
              ...projection.map,
              destination: [
                ...projection.map.destination,
                additive(
                  "map.destination.additional.find-proof",
                  "Map Additive",
                  1,
                  "map-additive-find-proof",
                ),
              ],
            },
      spec:
        projection.spec === undefined
          ? undefined
          : {
              ...projection.spec,
              document: [
                ...projection.spec.document,
                additive(
                  "spec.source.find-proof",
                  "Spec Additive",
                  projection.spec.document.length,
                  "spec-additive-find-proof",
                ),
              ],
            },
      wayfinderTickets: projection.wayfinderTickets.map((ticket, index) =>
        index === 0
          ? {
              ...ticket,
              question: [
                ...ticket.question,
                additive(
                  "wayfinder.question.additional.find-proof",
                  "Question Additive",
                  1,
                  "wayfinder-question-additive-find-proof",
                ),
              ],
              comments: [
                ...ticket.comments,
                {
                  role: "ordinary-comment" as const,
                  document: authoredDocument(
                    "wayfinder.comments",
                    "Comment",
                    "wayfinder-comment-find-proof",
                  ),
                  nativeIdentity: "comment:find-wayfinder",
                  authoredAt: { availability: "unsupported" as const },
                },
              ],
              semanticSections: ticket.semanticSections.map((section) =>
                section.role === "wayfinder.comments"
                  ? { ...section, availability: "available" as const }
                  : section,
              ),
            }
          : ticket,
      ),
      deliveryTickets: projection.deliveryTickets.map((ticket, index) =>
        index === 0
          ? {
              ...ticket,
              comments: [
                ...ticket.comments,
                {
                  role: "triage-note" as const,
                  document: authoredDocument(
                    "delivery.comments",
                    "Triage Note",
                    "delivery-comment-find-proof",
                  ),
                  authoredAt: { availability: "unsupported" as const },
                },
              ],
              semanticSections: ticket.semanticSections.map((section) =>
                section.role === "delivery.comments"
                  ? { ...section, availability: "available" as const }
                  : section,
              ),
            }
          : ticket,
      ),
      incomingIssues: projection.incomingIssues.map((issue, index) =>
        index === 0
          ? {
              ...issue,
              content: [
                ...issue.content.map((content) => ({
                  ...content,
                  document: [
                    ...content.document,
                    additive(
                      "incoming.content.additional.find-proof",
                      "Incoming Additive",
                      1,
                      "incoming-additive-find-proof",
                    ),
                  ],
                })),
                {
                  role: "ordinary-comment" as const,
                  document: authoredDocument(
                    "incoming.content",
                    "Comment",
                    "incoming-comment-find-proof",
                  ),
                  authoredAt: { availability: "unsupported" as const },
                },
              ],
            }
          : issue,
      ),
    },
  });
  const rebuilt = parseRebuiltPlanningLineageFixture({
    ...snapshot,
    providerObservations: snapshot.providerObservations.map((candidate) =>
      candidate.id === observation.id ? augmented : candidate,
    ),
    providerObservationSelections: snapshot.providerObservationSelections.map((candidate) =>
      candidate.observationId === observation.id
        ? { ...candidate, observationId: augmented.id }
        : candidate,
    ),
  });
  const index = buildProjectFindIndex(rebuilt, "bearing");
  for (const [phrase, id] of [
    ["map-additive-find-proof", ".scratch/portal/map.md"],
    ["spec-additive-find-proof", ".scratch/portal/PRD.md"],
    ["wayfinder-question-additive-find-proof", ".scratch/portal/issues/01-build.md"],
    ["wayfinder-comment-find-proof extra", ".scratch/portal/issues/01-build.md"],
    ["delivery-comment-find-proof extra", ".scratch/portal/issues/03-gate.md"],
    ["incoming-additive-find-proof", ".scratch/portal/issues/04-incoming.md"],
    ["incoming-comment-find-proof extra", ".scratch/portal/issues/04-incoming.md"],
  ] as const) {
    expect(index.search(phrase)).toHaveLength(0);
    expect(
      buildProjectFindDocuments(rebuilt, "bearing").some((document) => document.subject.id === id),
    ).toBe(true);
  }
});

test("recalls titles with stable typed routes, without ID, body, excerpts or anchors", () => {
  const index = buildProjectFindIndex(snapshotFixture(), "bearing");
  const result = index.search("Planning Model Evidence")[0];
  expect(result?.subject).toEqual({ kind: "asset", id: "asset:planning-model-evidence" });
  expect(result).not.toHaveProperty("excerpt");
  expect(result).not.toHaveProperty("semanticAnchor");
  expect(result?.href).toBe(
    planningLineageSubjectHref("bearing", {
      kind: "asset",
      id: "asset:planning-model-evidence",
    }),
  );
  for (const query of [
    "asset:planning-model-evidence",
    ".scratch/portal",
    "whole-project orientation",
    "managed project scope",
  ]) {
    expect(index.search(query)).toHaveLength(0);
  }
  for (const document of buildProjectFindDocuments(snapshotFixture(), "bearing")) {
    expect(document).not.toHaveProperty("fields");
    expect(document).not.toHaveProperty("fallbackExcerpt");
  }
});

test("supports Chinese and English titles and distinguishes duplicate titles by context", () => {
  const base = snapshotFixture();
  if (base.gates.validity !== "available") throw new Error("Expected Gate fixture.");
  const snapshot = parseRebuiltPlanningLineageFixture({
    ...base,
    gates: {
      ...base.gates,
      items: base.gates.items.map((gate) => ({
        ...gate,
        title: "中文规划",
        intent: "确认中文阅读路径",
      })),
    },
  });
  const index = buildProjectFindIndex(snapshot, "bearing");
  expect(tokenizeProjectFindText("中文规划").length).toBeGreaterThan(1);
  const chinese = index.search("中文规划");
  expect(chinese).toHaveLength(base.gates.items.length);
  expect(new Set(chinese.map((result) => result.href)).size).toBe(chinese.length);
  expect(chinese.every((result) => result.parentPath.length > 0)).toBe(true);
  expect(index.search("portal evolution")[0]?.subject).toEqual({
    kind: "roadmap",
    id: "roadmap:portal",
  });
  expect(index.search("确认中文阅读路径")).toHaveLength(0);
  expect(index.search("Project Summary has one malformed section")).toHaveLength(0);
});

test("does not index a lineage title without trustworthy matching detail", () => {
  const base = snapshotFixture();
  if (base.gates.validity !== "available") throw new Error("Expected Gate fixture.");
  const noDetail = {
    ...base,
    gates: { ...base.gates, items: base.gates.items.filter((gate) => gate.id !== "gate:two") },
  };
  expect(
    buildProjectFindDocuments(noDetail, "bearing").some(
      (document) => document.subject.id === "gate:two",
    ),
  ).toBe(false);
  const noLineage = {
    ...base,
    lineage: {
      ...base.lineage,
      subjects: base.lineage.subjects.filter((subject) => subject.identity.id !== "gate:two"),
    },
  };
  expect(
    buildProjectFindDocuments(noLineage, "bearing").some(
      (document) => document.subject.id === "gate:two",
    ),
  ).toBe(false);
});

test("keeps readable titles despite unavailable body sections without search anchors", () => {
  const base = snapshotFixture();
  const unavailable = {
    ...base,
    lineage: {
      ...base.lineage,
      subjects: base.lineage.subjects.map((subject) => ({
        ...subject,
        semanticSections: subject.semanticSections.map((section) => ({
          ...section,
          availability: "unavailable" as const,
        })),
      })),
    },
  };
  const result = buildProjectFindIndex(unavailable, "bearing").search("Portal Evolution")[0];
  expect(result?.subject).toEqual({ kind: "roadmap", id: "roadmap:portal" });
  expect(result?.href).toBe(
    planningLineageSubjectHref("bearing", { kind: "roadmap", id: "roadmap:portal" }),
  );
});

test("replaces the disposable index when the Snapshot fingerprint changes", () => {
  const snapshot = snapshotFixture();
  const first = buildProjectFindIndex(snapshot, "bearing");
  const second = buildProjectFindIndex(
    {
      ...snapshot,
      basis: {
        ...snapshot.basis,
        basisFingerprint: `sha256:${"c".repeat(64)}` as typeof snapshot.basis.basisFingerprint,
      },
    },
    "bearing",
  );

  expect(first.fingerprint).toBe(snapshot.basis.basisFingerprint);
  expect(second.fingerprint).not.toBe(first.fingerprint);
  expect(first.documentCount).toBe(second.documentCount);
});

test("reports typed scope degradation with an executable recovery", () => {
  const snapshot = snapshotFixture();
  const degraded = {
    ...snapshot,
    assets: {
      validity: "invalid" as const,
      issues: [{ code: "invalid-assets", target: "assets", message: "Assets unavailable." }],
    },
  } as ProjectGeneration;

  expect(buildProjectFindIndex(snapshot, "bearing").scopeState).toEqual({ state: "available" });
  expect(buildProjectFindIndex(degraded, "bearing").scopeState).toMatchObject({
    state: "invalid",
    cause: "Asset content is unavailable.",
  });

  const observation = snapshot.providerObservations.find(
    (candidate) => candidate.binding.nativeScope === ".scratch/portal",
  );
  if (
    observation === undefined ||
    (observation.state !== "available" && observation.state !== "partial")
  ) {
    throw new Error("Expected readable portal observation.");
  }
  const incompleteObservation = createProviderScopeObservation({
    provider: observation.provider,
    binding: observation.binding,
    observedAt: observation.observedAt,
    ...(observation.sourceRevision === undefined
      ? {}
      : { sourceRevision: observation.sourceRevision }),
    ...(observation.sourceObservedAt === undefined
      ? {}
      : { sourceObservedAt: observation.sourceObservedAt }),
    validators: observation.validators,
    freshness: observation.freshness,
    state: "partial",
    completion: "incomplete",
    diagnostics: observation.diagnostics,
    projection: observation.projection,
    coverage: {
      assessment: "incomplete",
      dimensions: observation.coverage.dimensions.map((dimension, index) => ({
        key: dimension.key,
        state: index === 0 ? ("gap" as const) : dimension.state,
        ...(dimension.detail === undefined ? {} : { detail: dimension.detail }),
      })),
    },
  });
  const incomplete = parseRebuiltPlanningLineageFixture({
    ...snapshot,
    providerObservations: snapshot.providerObservations.map((candidate) =>
      candidate.id === observation.id ? incompleteObservation : candidate,
    ),
    providerObservationSelections: snapshot.providerObservationSelections.map((selection) =>
      selection.observationId === observation.id
        ? { ...selection, observationId: incompleteObservation.id }
        : selection,
    ),
  });
  expect(buildProjectFindIndex(incomplete, "bearing").scopeState).toMatchObject({
    state: "partial",
    cause: "A bound work scope has incomplete coverage.",
  });
  expect(
    buildProjectFindIndex(incomplete, "bearing").search("Pass the integration gate"),
  ).toHaveLength(1);
  const stale = {
    ...snapshot,
    providerObservationSelections: snapshot.providerObservationSelections.map((selection) =>
      selection.observationId === observation.id
        ? { ...selection, effectiveFreshness: "stale" as const }
        : selection,
    ),
  };
  expect(buildProjectFindIndex(stale, "bearing").scopeState.state).toBe("stale");
  expect(buildProjectFindIndex(stale, "bearing").search("Pass the integration gate")).toHaveLength(
    1,
  );

  const obsoleteInspection = createProviderScopeObservation({
    provider: observation.provider,
    binding: observation.binding,
    observedAt: "2026-07-13T12:00:00+08:00",
    ...(observation.sourceRevision === undefined
      ? {}
      : { sourceRevision: observation.sourceRevision }),
    ...(observation.sourceObservedAt === undefined
      ? {}
      : { sourceObservedAt: observation.sourceObservedAt }),
    validators: observation.validators,
    freshness: observation.freshness,
    state: observation.state,
    completion: observation.completion,
    diagnostics: observation.diagnostics,
    coverage: {
      assessment: observation.coverage.assessment,
      dimensions: observation.coverage.dimensions.map((dimension) => ({
        key: dimension.key,
        state: dimension.state,
        ...(dimension.detail === undefined ? {} : { detail: dimension.detail }),
      })),
    },
    projection: {
      ...observation.projection,
      deliveryTickets: observation.projection.deliveryTickets.map((ticket, index) =>
        index === 0 ? { ...ticket, whatToBuild: "Obsolete inspection-only phrase" } : ticket,
      ),
    },
  });
  const providerAuthoritative = parseRebuiltPlanningLineageFixture({
    ...snapshot,
    providerDetailEvidences: {
      observations: [obsoleteInspection],
      selections: [
        {
          provider: "matt-skills/v1",
          nativeScope: ".scratch/portal",
          observationId: obsoleteInspection.id,
          effectiveFreshness: "current",
          latestAttempt: {
            intent: "provider-detail-selection",
            attemptedAt: "2026-07-14T12:00:00+08:00",
            outcome: "succeeded",
            diagnostics: [],
          },
        },
      ],
    },
  });
  expect(buildProjectFindIndex(providerAuthoritative, "bearing").scopeState).toEqual({
    state: "available",
  });
  expect(
    buildProjectFindIndex(providerAuthoritative, "bearing").search("Pass the integration gate"),
  ).toHaveLength(1);
  expect(
    buildProjectFindIndex(providerAuthoritative, "bearing").search(
      "Obsolete inspection-only phrase",
    ),
  ).toHaveLength(0);
});
