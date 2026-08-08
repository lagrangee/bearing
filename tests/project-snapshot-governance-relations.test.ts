import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { buildOverviewRoadmaps } from "../src/portal-ui/project-overview-roadmaps";
import type { ProjectSnapshot, SourceRecord } from "../src/project-snapshot/contract";
import { gateSchema, projectSnapshotSchema } from "../src/project-snapshot/schema";
import { createSourceReference } from "../src/project-snapshot/source-reference";
import { runSync } from "../src/sync";
import { createValidBearingRepo, writeFixture } from "./helpers";
import { buildProjectSnapshotForTest as buildProjectSnapshot } from "./project-snapshot-fixture";

const BASIS = `sha256:${"a".repeat(64)}`;
const gateSource = createSourceReference({
  basisFingerprint: BASIS,
  kind: "canonical",
  displayLocator: ".bearing/state/milestone-gates/test.md",
});
const validPassage = {
  acceptedDecision: "Pass the Gate.",
  acceptedAt: { availability: "unavailable" as const },
  rationale: "The accepted outcome is complete.",
  evidence: [],
  exceptions: [],
};
const gate = {
  id: "gate:test",
  title: "Test Gate",
  source: gateSource,
  citations: [],
  intent: "Reach the fixture boundary.",
  exitCriteria: ["Complete the fixture."],
  roadmapId: "roadmap:test",
  lifecycle: "passed",
  plannedAt: { availability: "unavailable" as const },
  activatedAt: { availability: "unavailable" as const },
  readiness: "unknown",
  horizonState: "passed",
  effortIds: [],
};

const materialize = async (root: string): Promise<ProjectSnapshot> => {
  const sync = await runSync(root);
  return buildProjectSnapshot({
    repoRoot: root,
    packageVersion: "0.0.0-test",
    inputs: sync.inputs,
    sitemapFingerprint: sync.fingerprint,
    diagnostics: sync.diagnostics,
    advisoryFreshness: sync.advisoryFreshness,
  });
};

const addIndependentRoadmap = async (root: string): Promise<void> => {
  await writeFixture(
    root,
    ".bearing/state/roadmap-index.md",
    `---\nType: roadmap-index\nRoadmaps:\n  - roadmap:test\n  - roadmap:other\n---\n\n# Roadmap Index\n`,
  );
  await writeFixture(
    root,
    ".bearing/state/roadmaps/other.md",
    `---\nType: roadmap\nID: roadmap:other\nTitle: Other Roadmap\nStatus: active\nFocused gate: gate:other\nGate order:\n  - gate:other\n---\n\n# Roadmap: Other\n\n## Intent\n\nPreserve an independent horizon.\n`,
  );
  await writeFixture(
    root,
    ".bearing/state/milestone-gates/other.md",
    `---\nType: milestone-gate\nID: gate:other\nTitle: Other Gate\nRoadmap: roadmap:other\nStatus: active\nEffort order: []\n---\n\n# Milestone Gate: Other\n\n## Intent\n\nKeep the sibling readable.\n\n## Exit Criteria\n\n- Preserve the sibling.\n`,
  );
};

const sourceIndex = (snapshot: ProjectSnapshot): ReadonlyMap<string, SourceRecord> =>
  new Map(snapshot.sources.map((source) => [source.reference, source]));

const completeHorizon = (snapshot: ProjectSnapshot) => {
  if (snapshot.roadmaps.validity !== "available" || snapshot.gates.validity !== "available") {
    throw new Error("Expected one complete Roadmap horizon.");
  }
  const roadmap = snapshot.roadmaps.items[0];
  const milestone = snapshot.gates.items[0];
  if (roadmap === undefined || milestone === undefined) {
    throw new Error("Expected one Roadmap and Gate.");
  }
  return { roadmap, milestone };
};

test("rejects cached Gate lifecycle and Passage combinations that cannot be trusted", () => {
  // Given: the accepted Passage record and one otherwise valid normalized Gate.
  const passedWithoutPassage = gate;
  const activeWithPassage = { ...gate, lifecycle: "active", passage: validPassage };
  const supersededWithHistory = {
    ...gate,
    lifecycle: "superseded",
    supersededAt: { availability: "unavailable" },
    passage: validPassage,
  };

  // When: each combination crosses the Project Snapshot cache schema.
  const missing = gateSchema.safeParse(passedWithoutPassage);
  const premature = gateSchema.safeParse(activeWithPassage);
  const historical = gateSchema.safeParse(supersededWithHistory);

  // Then: only a passed Gate requires Passage; supersession may retain passage history.
  expect(missing.success).toBe(false);
  expect(premature.success).toBe(false);
  expect(historical.success).toBe(true);
});

test("isolates a passed Gate without Passage while preserving an independent horizon", async () => {
  // Given: one passed Gate lacks its accepted Passage record beside a healthy Roadmap.
  const root = await createValidBearingRepo();
  await addIndependentRoadmap(root);
  const path = join(root, ".bearing/state/milestone-gates/test.md");
  const source = await readFile(path, "utf8");
  await writeFixture(
    root,
    ".bearing/state/milestone-gates/test.md",
    source.replace("Status: active", "Status: passed"),
  );

  // When: the repository crosses the shared Project Snapshot projection seam.
  const snapshot = await materialize(root);

  // Then: the invalid relation chain is excluded and the sibling remains orientable.
  expect(snapshot.gates).toMatchObject({
    validity: "partial",
    items: [{ id: "gate:other" }],
  });
  expect(snapshot.roadmaps).toMatchObject({
    validity: "partial",
    items: [{ id: "roadmap:other" }],
  });
  expect(snapshot.roadmapIndex).toMatchObject({
    validity: "partial",
    value: { activeRoadmapIds: ["roadmap:other"] },
  });
});

test("isolates an active Gate carrying a premature Passage record", async () => {
  // Given: an active Gate claims accepted passage beside a healthy Roadmap.
  const root = await createValidBearingRepo();
  await addIndependentRoadmap(root);
  const path = join(root, ".bearing/state/milestone-gates/test.md");
  const source = await readFile(path, "utf8");
  await writeFixture(
    root,
    ".bearing/state/milestone-gates/test.md",
    source.replace(
      "Status: active",
      "Status: active\nPassage:\n  Accepted decision: Pass the Gate.\n  Rationale: The accepted outcome is complete.\n  Evidence: []\n  Exceptions: []",
    ),
  );

  // When: the repository crosses the shared Project Snapshot projection seam.
  const snapshot = await materialize(root);

  // Then: premature passage cannot enter trusted Gate or Roadmap orientation.
  expect(snapshot.gates).toMatchObject({
    validity: "partial",
    items: [{ id: "gate:other" }],
  });
  expect(snapshot.roadmaps).toMatchObject({
    validity: "partial",
    items: [{ id: "roadmap:other" }],
  });
});

test("never attaches a Gate to a Roadmap that conflicts with its declared owner", async () => {
  // Given: one Roadmap orders a Gate whose canonical owner is another Roadmap.
  const root = await createValidBearingRepo();
  await addIndependentRoadmap(root);
  const path = join(root, ".bearing/state/milestone-gates/test.md");
  const source = await readFile(path, "utf8");
  await writeFixture(
    root,
    ".bearing/state/milestone-gates/test.md",
    source.replace("Roadmap: roadmap:test", "Roadmap: roadmap:other"),
  );

  // When: Overview consumes the normalized Snapshot instead of raw source relations.
  const snapshot = await materialize(root);
  const overview = buildOverviewRoadmaps(snapshot, sourceIndex(snapshot));

  // Then: the conflicted Gate is scoped out and cannot appear under the wrong Roadmap.
  expect(snapshot.gates).toMatchObject({
    validity: "partial",
    items: [{ id: "gate:other" }],
  });
  expect(overview.state).toBe("partial");
  expect(
    overview.items.flatMap((roadmap) => roadmap.gates.map((entry) => String(entry.gate.id))),
  ).toEqual(["gate:other"]);
});

test("scopes an incoherent focused Gate through Roadmap and Index validity", async () => {
  // Given: one Roadmap focuses a Gate outside its own order beside a healthy sibling.
  const root = await createValidBearingRepo();
  await addIndependentRoadmap(root);
  const path = join(root, ".bearing/state/roadmaps/test.md");
  const source = await readFile(path, "utf8");
  await writeFixture(
    root,
    ".bearing/state/roadmaps/test.md",
    source.replace("Gate order:\n  - gate:test", "Gate order: []"),
  );

  // When: blocking topology diagnostics reach the semantic projection boundary.
  const snapshot = await materialize(root);
  const overview = buildOverviewRoadmaps(snapshot, sourceIndex(snapshot));

  // Then: only the incoherent horizon disappears from trusted Overview orientation.
  expect(snapshot.roadmaps).toMatchObject({
    validity: "partial",
    items: [{ id: "roadmap:other" }],
  });
  expect(snapshot.roadmapIndex).toMatchObject({
    validity: "partial",
    value: { activeRoadmapIds: ["roadmap:other"] },
  });
  expect(overview.items.map((item) => String(item.roadmap.id))).toEqual(["roadmap:other"]);
});

test("isolates a Roadmap Index that omits a trustworthy Roadmap", async () => {
  // Given: two trustworthy Roadmaps exist but the canonical Index silently omits one.
  const root = await createValidBearingRepo();
  await addIndependentRoadmap(root);
  await writeFixture(
    root,
    ".bearing/state/roadmap-index.md",
    `---\nType: roadmap-index\nRoadmaps:\n  - roadmap:test\n---\n\n# Roadmap Index\n`,
  );

  // When: the inconsistent source graph crosses the shared projection seam.
  const snapshot = await materialize(root);

  // Then: only the Index is invalid; both Roadmaps and their Gates remain trustworthy.
  expect(snapshot.roadmapIndex).toMatchObject({
    validity: "invalid",
    issues: [{ code: "roadmap-index-roadmap-unlisted", target: "roadmap:other" }],
  });
  if (snapshot.roadmaps.validity !== "available" || snapshot.gates.validity !== "available") {
    throw new Error("Expected the Index failure to preserve Roadmaps and Gates.");
  }
  expect(snapshot.roadmaps.items.map((roadmap) => String(roadmap.id))).toEqual([
    "roadmap:other",
    "roadmap:test",
  ]);
  expect(snapshot.gates.items.map((gate) => String(gate.id))).toEqual(["gate:other", "gate:test"]);
});

test("rejects cached Roadmap focus outside its Gate order", async () => {
  // Given: a trustworthy Snapshot whose cached Roadmap focus is tampered in isolation.
  const snapshot = await materialize(await createValidBearingRepo());
  const { roadmap } = completeHorizon(snapshot);
  const tampered = {
    ...snapshot,
    roadmaps: {
      validity: "available",
      items: [{ ...roadmap, focusedGateId: "gate:test", gateOrder: [] }],
    },
  };

  // When: same-version cache bytes cross the Project Snapshot schema.
  const parsed = projectSnapshotSchema.safeParse(tampered);

  // Then: an impossible focused relation cannot reach Overview.
  expect(parsed.success).toBe(false);
});

test("rejects cached Gate ownership that conflicts with Roadmap order", async () => {
  // Given: a trustworthy Snapshot whose cached Gate claims a different owner.
  const snapshot = await materialize(await createValidBearingRepo());
  const { milestone } = completeHorizon(snapshot);
  const tampered = {
    ...snapshot,
    gates: {
      validity: "available",
      items: [{ ...milestone, roadmapId: "roadmap:other" }],
    },
  };

  // When: same-version cache bytes cross the Project Snapshot schema.
  const parsed = projectSnapshotSchema.safeParse(tampered);

  // Then: a Gate cannot be attached under a Roadmap it does not declare.
  expect(parsed.success).toBe(false);
});
