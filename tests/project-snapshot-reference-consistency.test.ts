import { expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { readProjectSnapshotCache } from "../src/project-snapshot/cache";
import type { ProjectSnapshot } from "../src/project-snapshot/contract";
import { projectSnapshotSchema } from "../src/project-snapshot/schema";
import { createSourceReference } from "../src/project-snapshot/source-reference";
import { createProjectOverviewFixture } from "./fixtures/project-overview";
import { makeTemporaryDirectory } from "./helpers";

const writeRawCache = async (document: unknown) => {
  const root = await makeTemporaryDirectory("bearing-snapshot-reference-consistency-");
  const cache = join(root, ".bearing/cache");
  await mkdir(cache, { recursive: true });
  await writeFile(join(cache, "project-snapshot.json"), `${JSON.stringify(document)}\n`, "utf8");
  return root;
};

const withSecondRoadmapLifecycle = (
  snapshot: ProjectSnapshot,
  lifecycle: "active" | "completed" | "superseded",
): ProjectSnapshot => {
  if (snapshot.roadmaps.validity === "invalid" || snapshot.roadmapIndex.validity === "absent") {
    throw new Error("Expected trustworthy Roadmaps and a Roadmap Index fixture.");
  }
  if (snapshot.roadmapIndex.validity === "invalid") {
    throw new Error("Expected a trustworthy Roadmap Index fixture.");
  }
  const secondId = "roadmap:second";
  return projectSnapshotSchema.parse({
    ...snapshot,
    roadmaps: {
      ...snapshot.roadmaps,
      items: snapshot.roadmaps.items.map((roadmap) =>
        roadmap.id === secondId
          ? {
              ...roadmap,
              lifecycle,
              horizon: lifecycle === "active" ? "unknown" : "exhausted",
            }
          : roadmap,
      ),
    },
    roadmapIndex: {
      ...snapshot.roadmapIndex,
      value: {
        ...snapshot.roadmapIndex.value,
        activeRoadmapIds:
          lifecycle === "active" ? [secondId, "roadmap:portal"] : ["roadmap:portal"],
        completedRoadmapIds: lifecycle === "completed" ? [secondId] : [],
        supersededRoadmapIds: lifecycle === "superseded" ? [secondId] : [],
      },
    },
  });
};

test("requires the Roadmap Index to exactly cover every trustworthy lifecycle group", () => {
  for (const lifecycle of ["active", "completed", "superseded"] as const) {
    const snapshot = withSecondRoadmapLifecycle(createProjectOverviewFixture(), lifecycle);
    if (snapshot.roadmapIndex.validity !== "available") {
      throw new Error("Expected an available Roadmap Index fixture.");
    }
    const field = `${lifecycle}RoadmapIds` as const;
    const tampered = {
      ...snapshot,
      roadmapIndex: {
        ...snapshot.roadmapIndex,
        value: {
          ...snapshot.roadmapIndex.value,
          [field]: snapshot.roadmapIndex.value[field].filter((id) => id !== "roadmap:second"),
        },
      },
    };

    expect(projectSnapshotSchema.safeParse(tampered).success).toBe(false);
  }
});

test("rejects dangling and basis-inconsistent Source provenance", () => {
  const snapshot = createProjectOverviewFixture();
  if (snapshot.summary.validity !== "available") {
    throw new Error("Expected an available Project Summary fixture.");
  }
  const summarySource = snapshot.summary.value.source;
  const dangling = {
    ...snapshot,
    summary: {
      ...snapshot.summary,
      value: { ...snapshot.summary.value, source: `source:${"f".repeat(64)}` },
    },
  };
  const mismatchedRecord = {
    ...snapshot,
    sources: snapshot.sources.map((record) =>
      record.reference === summarySource
        ? { ...record, displayLocator: ".bearing/state/tampered-summary.md" }
        : record,
    ),
  };

  expect(projectSnapshotSchema.safeParse(dangling).success).toBe(false);
  expect(projectSnapshotSchema.safeParse(mismatchedRecord).success).toBe(false);
});

test("rejects a primary Audit Source forged with a fragment", async () => {
  const snapshot = createProjectOverviewFixture();
  if (snapshot.audit.validity !== "available") {
    throw new Error("Expected an available Planning Audit fixture.");
  }
  const audit = snapshot.audit;
  const auditSource = snapshot.sources.find((record) => record.reference === audit.value.source);
  if (auditSource === undefined || auditSource.binding === undefined) {
    throw new Error("Expected a bound primary Audit Source.");
  }
  const reference = createSourceReference({
    basisFingerprint: snapshot.basis.sitemapFingerprint,
    kind: auditSource.kind,
    displayLocator: auditSource.displayLocator,
    fragment: "forged-fragment",
    binding: auditSource.binding,
  });
  const document = {
    ...snapshot,
    audit: {
      ...audit,
      value: { ...audit.value, source: reference },
    },
    sources: [...snapshot.sources, { ...auditSource, reference, fragment: "forged-fragment" }],
  };

  expect(projectSnapshotSchema.safeParse(document).success).toBe(false);
  const root = await writeRawCache(document);
  expect(await readProjectSnapshotCache(root)).toEqual({
    kind: "malformed",
    reason: "invalid-snapshot",
  });
});

test("cache reads isolate omitted Roadmaps and forged Source records", async () => {
  const snapshot = createProjectOverviewFixture();
  if (snapshot.roadmapIndex.validity !== "available" || snapshot.summary.validity !== "available") {
    throw new Error("Expected available consistency fixtures.");
  }
  const summarySource = snapshot.summary.value.source;
  const omittedRoadmap = {
    ...snapshot,
    roadmapIndex: {
      ...snapshot.roadmapIndex,
      value: { ...snapshot.roadmapIndex.value, activeRoadmapIds: ["roadmap:portal"] },
    },
  };
  const forgedSource = {
    ...snapshot,
    sources: snapshot.sources.map((record) =>
      record.reference === summarySource
        ? { ...record, displayLocator: ".bearing/state/tampered-summary.md" }
        : record,
    ),
  };

  for (const document of [omittedRoadmap, forgedSource]) {
    const root = await writeRawCache(document);
    expect(await readProjectSnapshotCache(root)).toEqual({
      kind: "malformed",
      reason: "invalid-snapshot",
    });
  }
});

test("binds primary Source provenance to its role and canonical object identity", async () => {
  // Given: one trustworthy Snapshot with multiple canonical object kinds and sibling Efforts.
  const snapshot = createProjectOverviewFixture();
  if (
    snapshot.roadmaps.validity !== "available" ||
    snapshot.gates.validity !== "available" ||
    snapshot.efforts.validity !== "available"
  ) {
    throw new Error("Expected trustworthy source-binding fixtures.");
  }
  const roadmap = snapshot.roadmaps.items.find((item) => item.id === "roadmap:portal");
  const gate = snapshot.gates.items.find((item) => item.id === "gate:two");
  const modelEffort = snapshot.efforts.items.find((item) => item.id === "effort:model");
  const portalEffort = snapshot.efforts.items.find((item) => item.id === "effort:portal");
  if (
    roadmap === undefined ||
    gate === undefined ||
    modelEffort === undefined ||
    portalEffort === undefined
  ) {
    throw new Error("Expected Roadmap, Gate, and sibling Effort fixtures.");
  }
  const roadmapItems = snapshot.roadmaps.items;
  const effortItems = snapshot.efforts.items;

  // When: cache bytes borrow a Gate source for a Roadmap or exchange same-role Effort sources.
  const crossRole = {
    ...snapshot,
    roadmaps: {
      ...snapshot.roadmaps,
      items: roadmapItems.map((item) =>
        item.id === roadmap.id ? { ...item, source: gate.source } : item,
      ),
    },
  };
  const exchangedObjects = {
    ...snapshot,
    efforts: {
      ...snapshot.efforts,
      items: effortItems.map((item) =>
        item.id === modelEffort.id
          ? { ...item, source: portalEffort.source }
          : item.id === portalEffort.id
            ? { ...item, source: modelEffort.source }
            : item,
      ),
    },
  };
  const forgedRoadmapSource = (kind: "canonical" | "tracker", displayLocator: string) => {
    const binding = { role: "roadmap" as const, identity: roadmap.id };
    const reference = createSourceReference({
      basisFingerprint: snapshot.basis.sitemapFingerprint,
      kind,
      displayLocator,
      binding,
    });
    return {
      ...snapshot,
      roadmaps: {
        ...snapshot.roadmaps,
        items: roadmapItems.map((item) =>
          item.id === roadmap.id ? { ...item, source: reference } : item,
        ),
      },
      sources: [...snapshot.sources, { reference, kind, displayLocator, binding }],
    };
  };
  const wrongKind = forgedRoadmapSource("tracker", ".bearing/state/roadmaps/portal.md");
  const wrongLocator = forgedRoadmapSource("canonical", ".bearing/state/milestone-gates/portal.md");

  // Then: both the public schema and persisted-cache seam reject provenance reassignment.
  for (const document of [crossRole, exchangedObjects, wrongKind, wrongLocator]) {
    expect(projectSnapshotSchema.safeParse(document).success).toBe(false);
    const root = await writeRawCache(document);
    expect(await readProjectSnapshotCache(root)).toEqual({
      kind: "malformed",
      reason: "invalid-snapshot",
    });
  }
});
