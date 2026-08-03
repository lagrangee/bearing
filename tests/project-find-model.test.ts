import { expect, test } from "bun:test";
import { createProviderScopeObservation } from "../src/native-work-provider";
import { planningLineageSubjectHref } from "../src/planning-lineage-route";
import {
  buildProjectFindDocuments,
  buildProjectFindIndex,
  tokenizeProjectFindText,
} from "../src/portal-ui/project-find-model";
import type { ProjectSnapshot } from "../src/project-snapshot/contract";
import { createProjectOverviewFixture } from "./fixtures/project-overview";
import {
  parseRebuiltPlanningLineageFixture,
  withRebuiltPlanningLineage,
} from "./planning-lineage-fixture";

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

test("excludes native subjects that are not inside an accepted Effort binding", () => {
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
              workBinding: undefined,
              workBindingState: { state: "invalid" as const, reason: "missing" as const },
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
    nativeScopeInspections: {
      observations: [observation],
      selections: [
        {
          ...selection,
          latestAttempt: {
            intent: "native-scope-inspection",
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
});

test("recalls exact identities and semantic fields with stable typed routes", () => {
  const snapshot = snapshotFixture();
  const index = buildProjectFindIndex(snapshot, "bearing");

  const identity = index.search("asset:planning-model-evidence")[0];
  expect(identity?.subject).toEqual({ kind: "asset", id: "asset:planning-model-evidence" });
  expect(identity).not.toHaveProperty("matchedField");
  expect(identity).not.toHaveProperty("anchorAvailability");
  expect(identity?.excerpt).not.toContain("asset:planning-model-evidence");
  expect(identity?.href).toBe(
    planningLineageSubjectHref("bearing", {
      kind: "asset",
      id: "asset:planning-model-evidence",
    }),
  );

  const identityOnly = index.search(".scratch/portal")[0];
  expect(identityOnly?.subject).toEqual({ kind: "native-scope", id: ".scratch/portal" });
  expect(identityOnly?.title).toBe("Work Scope");
  expect(identityOnly?.excerpt).not.toContain(".scratch/portal");
  expect(index.search("managed project scope")).toHaveLength(0);

  const semantic = index.search("whole-project orientation")[0];
  expect(semantic?.subject).toEqual({ kind: "roadmap", id: "roadmap:portal" });
  expect(semantic?.href).toContain("roadmap.intent");
  expect(semantic?.excerpt).toContain("Prove whole-project orientation.");
});

test("supports representative Chinese and English field recall without repository text", () => {
  const base = snapshotFixture();
  if (base.gates.validity !== "available") throw new Error("Expected Gate fixture.");
  const snapshot = {
    ...base,
    gates: {
      validity: "available" as const,
      items: base.gates.items.map((gate) =>
        gate.id === "gate:two" ? { ...gate, title: "中文规划", intent: "确认中文阅读路径" } : gate,
      ),
    },
  } as ProjectSnapshot;
  const rebuilt = {
    ...snapshot,
    lineage: withRebuiltPlanningLineage(snapshot).lineage,
  } as ProjectSnapshot;
  const index = buildProjectFindIndex(rebuilt, "bearing");

  expect(tokenizeProjectFindText("中文阅读路径").length).toBeGreaterThan(1);
  const chinese = index.search("中文阅读路径")[0];
  expect(chinese?.subject).toEqual({ kind: "gate", id: "gate:two" });
  expect(index.search(".scratch/evidence/planning-model")).toHaveLength(0);
  expect(index.search("Project Summary has one malformed section")).toHaveLength(0);
});

test("fails closed for unavailable semantic fields and silently falls back from missing anchors", () => {
  const base = snapshotFixture();
  const baseLineage = base.lineage.subjects.find(
    (subject) => subject.identity.kind === "gate" && subject.identity.id === "gate:two",
  );
  if (baseLineage === undefined) throw new Error("Expected Gate lineage fixture.");
  const noAnchorLineage = {
    ...baseLineage,
    semanticSections: baseLineage.semanticSections.filter(
      (section) => section.role !== "gate.intent",
    ),
  };
  const unavailableLineage = {
    ...baseLineage,
    semanticSections: baseLineage.semanticSections.map((section) =>
      section.role === "gate.intent"
        ? { ...section, availability: "unavailable" as const }
        : section,
    ),
  };
  const missingAnchor = {
    ...base,
    lineage: {
      ...base.lineage,
      subjects: base.lineage.subjects.map((subject) =>
        subject === baseLineage ? noAnchorLineage : subject,
      ),
    },
  } as ProjectSnapshot;
  const unavailable = {
    ...base,
    gates: {
      validity: "available" as const,
      items:
        base.gates.validity === "available"
          ? base.gates.items.map((gate) =>
              gate.id === "gate:two" ? { ...gate, intent: "Only this unavailable phrase" } : gate,
            )
          : [],
    },
    lineage: {
      ...base.lineage,
      subjects: base.lineage.subjects.map((subject) =>
        subject === baseLineage ? unavailableLineage : subject,
      ),
    },
  } as ProjectSnapshot;

  const missingResult = buildProjectFindIndex(missingAnchor, "bearing").search("Prove Overview")[0];
  expect(missingResult?.subject).toEqual({ kind: "gate", id: "gate:two" });
  expect(missingResult).not.toHaveProperty("anchorAvailability");
  expect(missingResult).not.toHaveProperty("semanticAnchor");
  expect(missingResult?.href).toBe(
    planningLineageSubjectHref("bearing", { kind: "gate", id: "gate:two" }),
  );
  expect(
    buildProjectFindIndex(unavailable, "bearing").search("Only this unavailable phrase"),
  ).toHaveLength(0);
});

test("replaces the disposable index when the Snapshot fingerprint changes", () => {
  const snapshot = snapshotFixture();
  const first = buildProjectFindIndex(snapshot, "bearing");
  const second = buildProjectFindIndex(
    {
      ...snapshot,
      basis: {
        ...snapshot.basis,
        sitemapFingerprint: `sha256:${"c".repeat(64)}` as typeof snapshot.basis.sitemapFingerprint,
      },
    },
    "bearing",
  );

  expect(first.fingerprint).toBe(snapshot.basis.sitemapFingerprint);
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
  } as ProjectSnapshot;

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
    nativeScopeInspections: {
      observations: [obsoleteInspection],
      selections: [
        {
          provider: "matt-skills/v1",
          nativeScope: ".scratch/portal",
          observationId: obsoleteInspection.id,
          effectiveFreshness: "current",
          latestAttempt: {
            intent: "native-scope-inspection",
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
