import { expect, test } from "bun:test";
import { buildPlanningLineageSubjectModel } from "../src/portal-ui/planning-lineage-model";
import type {
  PlanningLineageRelation,
  ProjectSnapshot,
  ProjectSnapshotInput,
} from "../src/project-snapshot/contract";
import {
  buildPlanningLineageProjection,
  findPlanningLineageSubjectProjection,
} from "../src/project-snapshot/planning-lineage";
import { projectSnapshotSchema } from "../src/project-snapshot/schema";
import { createSourceRecord } from "../src/project-snapshot/source-records";
import { createProjectOverviewFixture } from "./fixtures/project-overview";

const rebuild = (candidate: ProjectSnapshotInput): ProjectSnapshot =>
  projectSnapshotSchema.parse({
    ...candidate,
    lineage: buildPlanningLineageProjection(candidate),
  });

const relationFor = (
  snapshot: ProjectSnapshot,
  kind:
    | "roadmap"
    | "gate"
    | "effort"
    | "authority"
    | "alignment-check"
    | "planning-review"
    | "asset",
  id: string,
  key: PlanningLineageRelation["key"],
): PlanningLineageRelation => {
  const subject = findPlanningLineageSubjectProjection(snapshot.lineage, { kind, id });
  const relation = subject?.relations.find((candidate) => candidate.key === key);
  if (relation === undefined) throw new Error(`Missing ${kind} ${id} relation ${key}.`);
  return relation;
};

test("materializes canonical parents and relations once in the Snapshot contract", () => {
  const snapshot = createProjectOverviewFixture();
  const gate = findPlanningLineageSubjectProjection(snapshot.lineage, {
    kind: "gate",
    id: "gate:one",
  });
  expect(gate?.parentPath).toEqual({
    state: "complete",
    ancestors: [{ kind: "roadmap", id: "roadmap:portal" }],
  });
  expect(relationFor(snapshot, "gate", "gate:one", "outcome.roadmap")).toMatchObject({
    state: "present",
    inParentPath: true,
    targets: [
      {
        reference: "roadmap:portal",
        subject: { kind: "roadmap", id: "roadmap:portal" },
        availability: "available",
      },
    ],
  });

  const withoutRelation = {
    ...snapshot,
    lineage: {
      subjects: snapshot.lineage.subjects.map((subject) =>
        subject.identity.kind === "gate" && subject.identity.id === "gate:one"
          ? {
              ...subject,
              relations: subject.relations.filter((relation) => relation.key !== "outcome.roadmap"),
            }
          : subject,
      ),
    },
  };
  const withoutParent = {
    ...snapshot,
    lineage: {
      subjects: snapshot.lineage.subjects.map((subject) =>
        subject.identity.kind === "gate" && subject.identity.id === "gate:one"
          ? { ...subject, parentPath: { state: "complete" as const, ancestors: [] } }
          : subject,
      ),
    },
  };
  const relabeledTarget = {
    ...snapshot,
    lineage: {
      subjects: snapshot.lineage.subjects.map((subject) => ({
        ...subject,
        relations: subject.relations.map((relation) =>
          subject.identity.kind === "gate" &&
          subject.identity.id === "gate:one" &&
          relation.key === "outcome.roadmap" &&
          relation.state === "present"
            ? {
                ...relation,
                targets: relation.targets.map((target) => ({
                  ...target,
                  label: "Invented Roadmap",
                })),
              }
            : relation,
        ),
      })),
    },
  };
  for (const tampered of [withoutRelation, withoutParent, relabeledTarget]) {
    expect(projectSnapshotSchema.safeParse(tampered).success).toBe(false);
  }
});

test("treats an identity absent from partial coverage as unavailable rather than missing", () => {
  const snapshot = createProjectOverviewFixture();
  if (snapshot.gates.validity === "invalid") throw new Error("Expected readable Gates.");
  const candidate: ProjectSnapshotInput = {
    ...snapshot,
    gates: {
      validity: "partial",
      items: snapshot.gates.items.filter((gate) => gate.id !== "gate:one"),
      issues: [
        {
          code: "invalid-gate",
          target: "gate:one",
          message: "One Gate could not be normalized.",
        },
      ],
    },
    assets:
      snapshot.assets.validity === "invalid"
        ? snapshot.assets
        : {
            ...snapshot.assets,
            items: snapshot.assets.items.map((asset) => ({
              ...asset,
              gatePassageEvidenceFor: [],
            })),
          },
  };
  const partial = rebuild(candidate);
  expect(
    buildPlanningLineageSubjectModel(partial, { kind: "gate", id: "gate:one" }, "bearing"),
  ).toMatchObject({
    state: "unavailable",
    issueCount: 1,
  });
});

test("keeps provider-native Produced For opaque and Authority adoption provenance honest", () => {
  const snapshot = createProjectOverviewFixture();
  if (snapshot.assets.validity === "invalid") throw new Error("Expected readable Assets.");
  const assetCandidate: ProjectSnapshotInput = {
    ...snapshot,
    assets: {
      validity: "available",
      items: snapshot.assets.items.map((asset) => ({
        ...asset,
        kind: "execution-evidence",
        producer: { kind: "executor-profile", name: "generic-agent" },
        producedFor: ".scratch/portal/issues/11-lineage-navigation.md",
      })),
    },
  };
  const withProducedFor = rebuild(assetCandidate);
  expect(
    relationFor(
      withProducedFor,
      "asset",
      "asset:planning-model-evidence",
      "production.produced-for",
    ),
  ).toMatchObject({
    state: "present",
    targets: [
      {
        reference: ".scratch/portal/issues/11-lineage-navigation.md",
        availability: "unavailable",
        note: "Provider-native route unavailable in the current Snapshot.",
      },
    ],
  });

  const authoritySource = createSourceRecord(snapshot.basis.sitemapFingerprint, {
    kind: "canonical",
    locator: ".bearing/state/authorities/architecture.md",
    binding: { role: "authority", identity: "authority:architecture" },
  });
  const authorityCandidate: ProjectSnapshotInput = {
    ...snapshot,
    authorities: {
      validity: "available",
      items: [
        {
          id: "authority:architecture",
          title: "Architecture",
          source: authoritySource.reference,
          citations: [],
          scope: "Accepted architecture direction.",
          baselineAssetIds: ["asset:planning-model-evidence"],
          adoptions: [],
        },
      ],
    },
    assets: {
      ...snapshot.assets,
      items: snapshot.assets.items.map((asset) => ({
        ...asset,
        adoptedByAuthorityIds: [],
      })),
    },
    sources: [...snapshot.sources, authoritySource],
  };
  const withAuthority = rebuild(authorityCandidate);
  const authority = findPlanningLineageSubjectProjection(withAuthority.lineage, {
    kind: "authority",
    id: "authority:architecture",
  });
  expect(authority?.semanticSections).toContainEqual({
    role: "authority.adoption-decisions",
    availability: "confirmed-empty",
  });
  expect(
    relationFor(withAuthority, "authority", "authority:architecture", "adoption.current-baseline"),
  ).toMatchObject({ state: "present" });
  expect(
    relationFor(withAuthority, "authority", "authority:architecture", "adoption.used-by"),
  ).toMatchObject({ state: "confirmed-none" });
});

test("keeps unresolved planning references scoped unavailable", () => {
  const snapshot = createProjectOverviewFixture();
  if (snapshot.checks.validity === "invalid") throw new Error("Expected Alignment Checks.");
  const candidate: ProjectSnapshotInput = {
    ...snapshot,
    checks: {
      ...snapshot.checks,
      items: snapshot.checks.items.map((check) => ({
        ...check,
        target: ".scratch/example/PRD.md",
      })),
    },
  };
  const projected = rebuild(candidate);
  expect(
    relationFor(projected, "alignment-check", "alignment-check:portal", "governance.target"),
  ).toMatchObject({
    state: "present",
    targets: [
      {
        reference: ".scratch/example/PRD.md",
        availability: "unavailable",
        note: "Stable detail route unavailable for this planning reference in the current Snapshot.",
      },
    ],
  });
});

test("keeps lineage ordering stable when source collection order changes", () => {
  const snapshot = createProjectOverviewFixture();
  const reversed: ProjectSnapshotInput = {
    ...snapshot,
    roadmaps:
      snapshot.roadmaps.validity === "invalid"
        ? snapshot.roadmaps
        : { ...snapshot.roadmaps, items: snapshot.roadmaps.items.toReversed() },
    gates:
      snapshot.gates.validity === "invalid"
        ? snapshot.gates
        : { ...snapshot.gates, items: snapshot.gates.items.toReversed() },
    efforts:
      snapshot.efforts.validity === "invalid"
        ? snapshot.efforts
        : { ...snapshot.efforts, items: snapshot.efforts.items.toReversed() },
    providerObservations: snapshot.providerObservations.toReversed(),
    providerObservationSelections: snapshot.providerObservationSelections.toReversed(),
  };
  expect(buildPlanningLineageProjection(reversed)).toEqual(snapshot.lineage);
});

test("keeps Asset reverse-relation coverage partial until every source is complete", () => {
  const snapshot = createProjectOverviewFixture();
  if (
    snapshot.roadmaps.validity === "invalid" ||
    snapshot.gates.validity === "invalid" ||
    snapshot.authorities.validity === "invalid"
  ) {
    throw new Error("Expected readable Roadmaps, Gates, and Authorities.");
  }
  const partialRoadmaps = rebuild({
    ...snapshot,
    roadmaps: {
      validity: "partial",
      items: snapshot.roadmaps.items,
      issues: [
        {
          code: "invalid-roadmap",
          target: "roadmap:unreadable",
          message: "One Roadmap is outside trustworthy coverage.",
        },
      ],
    },
  });
  expect(
    relationFor(partialRoadmaps, "asset", "asset:planning-model-evidence", "planning-use.cited-by"),
  ).toMatchObject({
    state: "present",
    total: { coverage: "at-least" },
  });

  const partialGates = rebuild({
    ...snapshot,
    gates: {
      validity: "partial",
      items: snapshot.gates.items,
      issues: [
        {
          code: "invalid-gate",
          target: "gate:unreadable",
          message: "One Gate is outside trustworthy coverage.",
        },
      ],
    },
  });
  expect(
    relationFor(partialGates, "asset", "asset:planning-model-evidence", "passage.used-by"),
  ).toMatchObject({
    state: "present",
    total: { coverage: "at-least" },
  });

  const partialAuthorities = rebuild({
    ...snapshot,
    sources: [
      ...snapshot.sources,
      createSourceRecord(snapshot.basis.sitemapFingerprint, {
        kind: "canonical",
        locator: ".bearing/state/authorities/partial-coverage.md",
        binding: { role: "authority", identity: "authority:partial-coverage" },
      }),
    ],
    authorities: {
      validity: "partial",
      items: [
        ...snapshot.authorities.items,
        {
          id: "authority:partial-coverage",
          title: "Partial coverage",
          source: createSourceRecord(snapshot.basis.sitemapFingerprint, {
            kind: "canonical",
            locator: ".bearing/state/authorities/partial-coverage.md",
            binding: { role: "authority", identity: "authority:partial-coverage" },
          }).reference,
          citations: [],
          scope: "One trustworthy Authority remains readable.",
          baselineAssetIds: [],
          adoptions: [],
        },
      ],
      issues: [
        {
          code: "invalid-authority",
          target: "authority:unreadable",
          message: "One Authority is outside trustworthy coverage.",
        },
      ],
    },
  });
  expect(
    relationFor(partialAuthorities, "asset", "asset:planning-model-evidence", "adoption.used-by"),
  ).toMatchObject({
    state: "unknown",
    reason: "Partial source coverage cannot confirm an empty reverse relation.",
  });
});
