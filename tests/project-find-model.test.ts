import { expect, test } from "bun:test";
import { planningLineageSubjectHref } from "../src/planning-lineage-route";
import {
  buildProjectFindDocuments,
  buildProjectFindIndex,
  tokenizeProjectFindText,
} from "../src/portal-ui/project-find-model";
import type { ProjectSnapshot } from "../src/project-snapshot/contract";
import { createProjectOverviewFixture } from "./fixtures/project-overview";
import { withRebuiltPlanningLineage } from "./planning-lineage-fixture";

const snapshotFixture = createProjectOverviewFixture;

test("builds one current-generation document per identity-bearing subject", () => {
  const snapshot = snapshotFixture();
  const documents = buildProjectFindDocuments(snapshot, "bearing");

  expect(documents.length).toBeGreaterThan(0);
  expect(
    new Set(documents.map((document) => `${document.subject.kind}:${document.subject.id}`)).size,
  ).toBe(documents.length);
  expect(documents.some((document) => document.subject.kind === "asset")).toBe(true);
  expect(documents.some((document) => document.subject.kind === "native-subject")).toBe(true);
});

test("recalls exact identities and semantic fields with stable typed routes", () => {
  const snapshot = snapshotFixture();
  const index = buildProjectFindIndex(snapshot, "bearing");

  const identity = index.search("asset:planning-model-evidence")[0];
  expect(identity?.subject).toEqual({ kind: "asset", id: "asset:planning-model-evidence" });
  expect(identity?.matchedField).toBe("Identity");
  expect(identity?.href).toBe(
    planningLineageSubjectHref("bearing", {
      kind: "asset",
      id: "asset:planning-model-evidence",
    }),
  );

  const semantic = index.search("whole-project orientation")[0];
  expect(semantic?.subject).toEqual({ kind: "roadmap", id: "roadmap:portal" });
  expect(semantic?.matchedField).toBe("Intent");
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
  expect(chinese?.matchedField).toBe("Intent");
  expect(index.search(".scratch/evidence/planning-model")).toHaveLength(0);
  expect(index.search("Project Summary has one malformed section")).toHaveLength(0);
});

test("fails closed for unavailable semantic fields and keeps missing anchors explicit", () => {
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
  expect(missingResult?.anchorAvailability).toBe("unavailable");
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
