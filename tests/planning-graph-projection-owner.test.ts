import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  CollectionProjection,
  Effort,
  MilestoneGate,
  ProviderScopeCapture,
  Roadmap,
} from "../src/project-snapshot/contract";
import { buildProjectSnapshot } from "../src/project-snapshot/projection";
import { prepareSync } from "../src/sync-plan";
import { createValidBearingRepo, writeFixture } from "./helpers";

type SharedPlanningProjection = Readonly<{
  roadmaps: CollectionProjection<Roadmap>;
  gates: CollectionProjection<MilestoneGate>;
  efforts: CollectionProjection<Effort>;
  providerCaptures: readonly ProviderScopeCapture[];
}>;

const sharedProjection = (graph: unknown): SharedPlanningProjection => {
  const candidate = graph as { planningProjection?: () => SharedPlanningProjection };
  if (candidate.planningProjection === undefined) {
    throw new Error("Planning Graph does not expose the shared planning projection.");
  }
  return candidate.planningProjection();
};

const snapshotFor = async (root: string) => {
  const plan = await prepareSync(root);
  const snapshot = await buildProjectSnapshot({
    repoRoot: root,
    packageVersion: "0.0.0-test",
    sitemapFingerprint: plan.fingerprint,
    diagnostics: plan.diagnostics,
    advisoryFreshness: plan.advisoryFreshness,
    decoded: plan.decoded,
    providerCaptures: plan.providerCaptures,
    assetContentObservations: plan.assetContentObservations,
    planningGraph: plan.planningGraph,
  });
  return { plan, snapshot };
};

test("one generation Planning Graph owns Snapshot relations and inspect agreement", async () => {
  const root = await createValidBearingRepo();
  const { plan, snapshot } = await snapshotFor(root);
  const projection = sharedProjection(plan.planningGraph);

  expect(plan.planningGraph.fingerprint).toBe(plan.fingerprint);
  expect(String(snapshot.basis.sitemapFingerprint)).toBe(plan.fingerprint);
  expect(plan.metrics.inputReadCount).toBe(plan.metrics.capturedInputCount);
  expect(plan.metrics.recordDecodeCount).toBe(plan.decoded.metrics.decodeCount);
  expect(plan.decoded.metrics.capturedInputCount).toBe(plan.metrics.capturedInputCount);
  expect(plan.metrics.repositoryRevalidationCount).toBe(0);
  expect(snapshot.roadmaps).toEqual(projection.roadmaps);
  expect(snapshot.gates).toEqual(projection.gates);
  expect(snapshot.efforts).toEqual(projection.efforts);
  expect(snapshot.providerCaptures).toEqual(projection.providerCaptures);

  const roadmap = plan.planningGraph.contextFor({ kind: "roadmap", id: "roadmap:test" });
  const gate = plan.planningGraph.contextFor({ kind: "gate", id: "gate:test" });
  const effort = plan.planningGraph.contextFor({ kind: "effort", id: "effort:test" });
  if (roadmap.state === "invalid" || gate.state === "invalid" || effort.state === "invalid") {
    throw new Error("Expected complete shared planning contexts.");
  }
  if (
    snapshot.roadmaps.validity === "invalid" ||
    snapshot.gates.validity === "invalid" ||
    snapshot.efforts.validity === "invalid"
  ) {
    throw new Error("Expected trustworthy Snapshot planning collections.");
  }
  expect(snapshot.roadmaps.items[0]?.effortIds).toEqual(
    roadmap.context.efforts.map((entry) => entry.effort.value.id),
  );
  expect(snapshot.gates.items[0]?.effortIds).toEqual(
    gate.context.efforts.map((entry) => entry.effort.value.id),
  );
  expect(snapshot.efforts.items[0]).toMatchObject(effort.context.effort.value);
});

test("shared graph projection isolates an invalid contributor consistently", async () => {
  const root = await createValidBearingRepo();
  const effort = await readFile(join(root, ".bearing/state/efforts/test.md"), "utf8");
  await writeFixture(root, ".bearing/state/efforts/duplicate.md", effort);
  const { plan, snapshot } = await snapshotFor(root);
  const projection = sharedProjection(plan.planningGraph);
  const gate = plan.planningGraph.contextFor({ kind: "gate", id: "gate:test" });

  expect(snapshot.efforts).toEqual(projection.efforts);
  expect(snapshot.gates).toEqual(projection.gates);
  expect(snapshot.efforts.validity).toBe("invalid");
  expect(snapshot.gates).toMatchObject({
    validity: "partial",
    items: [{ id: "gate:test", effortIds: [], readiness: "unknown" }],
  });
  expect(gate.state).toBe("partial");
  if (gate.state === "invalid") throw new Error("Expected partial Gate context.");
  expect(gate.context.efforts).toEqual([]);
  expect(gate.issues.filter((issue) => issue.code === "untrusted-effort-contributor")).toHaveLength(
    2,
  );
  expect(projection.providerCaptures).toEqual(plan.providerCaptures);
  const sitemap = plan.sitemap.toString("utf8");
  const mapLine = sitemap.split("\n").find((line) => line.startsWith("- `.scratch/work/map.md`"));
  const ticketLine = sitemap
    .split("\n")
    .find((line) => line.startsWith("- `.scratch/work/issues/01-finish.md`"));
  expect(mapLine).not.toContain("effort:");
  expect(ticketLine).not.toContain("effort:");
});

test("a missing ordered Gate stays unavailable beside unrelated duplicate Gate sources", async () => {
  const root = await createValidBearingRepo();
  const roadmapPath = join(root, ".bearing/state/roadmaps/test.md");
  const roadmap = await readFile(roadmapPath, "utf8");
  await writeFixture(
    root,
    ".bearing/state/roadmaps/test.md",
    roadmap.replace("  - gate:test", "  - gate:test\n  - gate:missing"),
  );
  const duplicateGate = `---
Type: milestone-gate
ID: gate:unrelated
Title: Unrelated duplicate
Roadmap: roadmap:test
Status: planned
---

# Milestone Gate: Unrelated duplicate

## Intent

Remain unrelated to the missing ordered Gate.

## Exit Criteria

- Preserve scoped availability.
`;
  await writeFixture(root, ".bearing/state/milestone-gates/unrelated-a.md", duplicateGate);
  await writeFixture(root, ".bearing/state/milestone-gates/unrelated-b.md", duplicateGate);

  const { plan, snapshot } = await snapshotFor(root);
  const projection = sharedProjection(plan.planningGraph);
  const roadmapContext = plan.planningGraph.contextFor({ kind: "roadmap", id: "roadmap:test" });

  expect(projection.gates.validity).toBe("partial");
  expect(projection.roadmaps.validity).toBe("invalid");
  expect(snapshot.roadmaps).toEqual(projection.roadmaps);
  expect(roadmapContext.state).toBe("partial");
  if (roadmapContext.state === "invalid") throw new Error("Expected retained inspect root.");
  expect(roadmapContext.issues).toContainEqual(
    expect.objectContaining({ code: "missing-gate", target: "gate:missing" }),
  );
});

test("duplicate Snapshot and Sitemap planning derivation owners are deleted", async () => {
  const [
    governance,
    snapshotProjection,
    sitemapEnrichment,
    planningGraph,
    sitemapModel,
    sitemapSerialization,
  ] = await Promise.all([
    readFile(join(process.cwd(), "src/project-snapshot/governance.ts"), "utf8"),
    readFile(join(process.cwd(), "src/project-snapshot/projection.ts"), "utf8"),
    readFile(join(process.cwd(), "src/sitemap-enrichment.ts"), "utf8"),
    readFile(join(process.cwd(), "src/planning-graph.ts"), "utf8"),
    readFile(join(process.cwd(), "src/sitemap-model.ts"), "utf8"),
    readFile(join(process.cwd(), "src/sitemap.ts"), "utf8"),
  ]);

  for (const legacyHelper of [
    "deriveEffortState",
    "deriveEffortFrontier",
    "deriveGateReadiness",
    "deriveRoadmapHorizon",
    "deriveGateHorizonState",
  ]) {
    expect(governance).not.toContain(legacyHelper);
    expect(sitemapEnrichment).not.toContain(legacyHelper);
  }
  expect(snapshotProjection).not.toContain("normalizePlanningDerivations");
  expect(snapshotProjection).not.toContain("buildProjectSitemapModelFromGeneration");
  expect(planningGraph).not.toContain("buildProjectSitemapModelFromGeneration");
  expect(planningGraph.match(/normalizePlanningDerivations\(\{/gu)).toHaveLength(1);
  expect(sitemapModel).not.toContain("effortByScope");
  expect(sitemapModel).not.toContain("planning?: PlanningGraphProjection");
  expect(sitemapEnrichment).not.toContain("planning?: PlanningGraphProjection");
  expect(sitemapSerialization).not.toContain("planningGraph?: PlanningGraph");
  expect(sitemapSerialization).not.toContain("planningGraph?.planningProjection()");
});

test("Sitemap consumes graph states but remains a compact sibling without reverse dossiers", async () => {
  const plan = await prepareSync(await createValidBearingRepo());
  const sitemap = plan.sitemap.toString("utf8");
  const roadmapLine = sitemap.split("\n").find((line) => line.startsWith("- `roadmap:test`"));
  const gateLine = sitemap.split("\n").find((line) => line.startsWith("- `gate:test`"));

  expect(sitemap).toContain("Gate readiness: `gate:test` = ready-for-review");
  expect(roadmapLine).not.toContain("effort");
  expect(gateLine).not.toContain("effort");
  for (const forbidden of [
    "contributing-effort",
    "contributor-count",
    "effort-count",
    "nested context",
  ]) {
    expect(sitemap).not.toContain(forbidden);
  }
});
