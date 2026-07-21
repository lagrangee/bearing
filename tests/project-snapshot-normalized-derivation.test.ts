import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { buildRoadmapDetailModel } from "../src/portal-ui/project-roadmap-model";
import type { ProjectSnapshot } from "../src/project-snapshot/contract";
import { runSync } from "../src/sync";
import { createValidBearingRepo, writeFixture } from "./helpers";
import { buildProjectSnapshotForTest as buildProjectSnapshot } from "./project-snapshot-fixture";

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

test("derives Effort and Gate truth from the final normalized native projection", async () => {
  const root = await createValidBearingRepo();
  const path = join(root, ".scratch/work/map.md");
  const source = await readFile(path, "utf8");
  await writeFixture(root, ".scratch/work/map.md", source.replace("Test", "**Test**"));

  const snapshot = await materialize(root);

  expect(snapshot.maps.validity).toBe("invalid");
  expect(snapshot.efforts).toMatchObject({
    validity: "available",
    items: [{ id: "effort:test", derivedState: "unknown" }],
  });
  expect(snapshot.gates).toMatchObject({
    validity: "available",
    items: [{ id: "gate:test", readiness: "unknown" }],
  });
});

test("derives Gate Horizon from the final trustworthy Roadmap projection", async () => {
  const root = await createValidBearingRepo();
  const path = join(root, ".bearing/state/roadmaps/test.md");
  const source = await readFile(path, "utf8");
  await writeFixture(
    root,
    ".bearing/state/roadmaps/test.md",
    source.replace("Prove the fixture.", "Prove **the fixture**."),
  );

  const snapshot = await materialize(root);

  expect(snapshot.roadmaps.validity).toBe("invalid");
  expect(snapshot.gates).toMatchObject({
    validity: "available",
    items: [{ id: "gate:test", horizonState: "unknown" }],
  });
});

test("derives Roadmap Horizon from the final trustworthy Gate projection", async () => {
  const root = await createValidBearingRepo();
  const roadmapPath = join(root, ".bearing/state/roadmaps/test.md");
  const roadmap = await readFile(roadmapPath, "utf8");
  await writeFixture(
    root,
    ".bearing/state/roadmaps/test.md",
    roadmap.replace("Focused gate: gate:test", "Focused gate: null"),
  );
  const gatePath = join(root, ".bearing/state/milestone-gates/test.md");
  const gate = await readFile(gatePath, "utf8");
  await writeFixture(
    root,
    ".bearing/state/milestone-gates/test.md",
    gate
      .replace(
        "Status: active",
        "Status: passed\nPassage:\n  Accepted decision: Pass the Gate.\n  Rationale: The fixture is complete.\n  Evidence: []\n  Exceptions: []",
      )
      .replace("- All fixture work resolves.", "- **All fixture work resolves.**"),
  );

  const snapshot = await materialize(root);

  expect(snapshot.gates.validity).toBe("invalid");
  expect(snapshot.roadmaps).toMatchObject({
    validity: "available",
    items: [{ id: "roadmap:test", horizon: "unknown" }],
  });
});

test("isolates duplicate Efforts before rebuilding exact reverse planning relations", async () => {
  const root = await createValidBearingRepo();
  const effort = await readFile(join(root, ".scratch/work/effort.md"), "utf8");
  await writeFixture(root, ".scratch/duplicate/effort.md", effort);

  const snapshot = await materialize(root);

  expect(snapshot.efforts).toMatchObject({
    validity: "invalid",
    issues: [
      { code: "duplicate-stable-id", target: ".scratch/duplicate/effort.md" },
      { code: "duplicate-stable-id", target: ".scratch/work/effort.md" },
    ],
  });
  expect(snapshot.roadmaps).toMatchObject({
    validity: "available",
    items: [{ id: "roadmap:test", effortIds: [] }],
  });
  expect(snapshot.gates).toMatchObject({
    validity: "partial",
    items: [{ id: "gate:test", effortIds: [], readiness: "unknown" }],
    issues: [
      { code: "untrusted-effort-contributor", target: "gate:test" },
      { code: "untrusted-effort-contributor", target: "gate:test" },
    ],
  });
  expect(buildRoadmapDetailModel(snapshot, "roadmap:test").state).toBe("partial");
});

test("scopes an invalid canonical Effort contributor to only its declared Gate", async () => {
  const root = await createValidBearingRepo();
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
    `---\nType: milestone-gate\nID: gate:other\nTitle: Other Gate\nRoadmap: roadmap:other\nStatus: active\n---\n\n# Milestone Gate: Other\n\n## Intent\n\nPreserve exact sibling readiness.\n\n## Exit Criteria\n\n- Resolve the sibling work.\n`,
  );
  await writeFixture(
    root,
    ".scratch/other/effort.md",
    `---\nType: effort\nID: effort:other\nTitle: Other Effort\nRoadmap: roadmap:other\nTarget gate: gate:other\nAuthorities: []\nCitations: []\n---\n\n# Effort: Other\n\n## Intent\n\nProve scoped contributor isolation.\n\n## Work\n\n- [Map](map.md)\n`,
  );
  await writeFixture(
    root,
    ".scratch/other/map.md",
    "# Wayfinder Map: Other\n\nType: wayfinder:map\nStatus: resolved\n\n## Destination\n\nResolve sibling work.\n\n## Not yet specified\n",
  );
  await writeFixture(
    root,
    ".scratch/other/issues/01-finish.md",
    "# Finish Other\n\nType: task\nStatus: resolved\n\n## Answer\n\nDone.\n",
  );
  await writeFixture(
    root,
    ".scratch/broken/effort.md",
    `---\nType: effort\nID: effort:broken\nTitle: Broken Contributor\nRoadmap: roadmap:test\nTarget gate: gate:test\nAuthorities: []\nCitations: []\n---\n\n# Effort: Broken\n\n## Intent\n\nThis contributor has no Work section.\n`,
  );

  const snapshot = await materialize(root);

  expect(snapshot.efforts).toMatchObject({
    validity: "partial",
    items: [{ id: "effort:other" }, { id: "effort:test" }],
    issues: [{ target: ".scratch/broken/effort.md" }],
  });
  expect(snapshot.roadmaps).toMatchObject({
    validity: "available",
    items: [
      { id: "roadmap:other", effortIds: ["effort:other"] },
      { id: "roadmap:test", effortIds: ["effort:test"] },
    ],
  });
  expect(snapshot.gates).toMatchObject({
    validity: "partial",
    items: [
      { id: "gate:other", effortIds: ["effort:other"], readiness: "ready-for-review" },
      { id: "gate:test", effortIds: ["effort:test"], readiness: "unknown" },
    ],
    issues: [{ code: "untrusted-effort-contributor", target: "gate:test" }],
  });
  expect(buildRoadmapDetailModel(snapshot, "roadmap:test").state).toBe("partial");
  expect(buildRoadmapDetailModel(snapshot, "roadmap:other").state).toBe("available");
});

test("keeps ready aliases blocker-aware through the real Snapshot builder", async () => {
  const root = await createValidBearingRepo();
  const ticketPath = join(root, ".scratch/work/issues/01-finish.md");
  const ticket = await readFile(ticketPath, "utf8");
  await writeFixture(
    root,
    ".scratch/work/issues/01-finish.md",
    ticket.replace("Status: resolved", "Status: ready-for-agent\nBlocked by: 02"),
  );
  await writeFixture(
    root,
    ".scratch/work/issues/02-blocker.md",
    "# Blocker\n\nType: task\nStatus: open\n\n## Question\n\nIs work still open?\n",
  );

  const snapshot = await materialize(root);

  expect(snapshot.tickets).toMatchObject({
    validity: "available",
    items: [
      { reference: ".scratch/work/issues/01-finish.md", state: "blocked" },
      { reference: ".scratch/work/issues/02-blocker.md", state: "ready" },
    ],
  });
  expect(snapshot.gates).toMatchObject({
    validity: "available",
    items: [{ id: "gate:test", readiness: "not-ready" }],
  });
});

test("isolates ambiguous native Ticket numbers without leaking blocker relations across scopes", async () => {
  const root = await createValidBearingRepo();
  await writeFixture(
    root,
    ".scratch/work/issues/02-resolved.md",
    "# Resolved Duplicate\n\nType: task\nStatus: resolved\n\n## Answer\n\nDone.\n",
  );
  await writeFixture(
    root,
    ".scratch/work/issues/02-open.md",
    "# Open Duplicate\n\nType: task\nStatus: open\n\n## Question\n\nWhat remains?\n",
  );
  await writeFixture(
    root,
    ".scratch/work/issues/03-ambiguous.md",
    "# Ambiguous Dependent\n\nType: task\nStatus: open\nBlocked by: 02\n\n## Question\n\nWhich Ticket blocks this?\n",
  );
  await writeFixture(
    root,
    ".scratch/healthy/issues/02-resolved.md",
    "# Healthy Blocker\n\nType: task\nStatus: resolved\n\n## Answer\n\nDone.\n",
  );
  await writeFixture(
    root,
    ".scratch/healthy/issues/03-ready.md",
    "# Healthy Dependent\n\nType: task\nStatus: open\nBlocked by: 02\n\n## Question\n\nCan this start?\n",
  );

  const sync = await runSync(root);
  const snapshot = await buildProjectSnapshot({
    repoRoot: root,
    packageVersion: "0.0.0-test",
    inputs: sync.inputs,
    sitemapFingerprint: sync.fingerprint,
    diagnostics: sync.diagnostics,
    advisoryFreshness: sync.advisoryFreshness,
  });
  const sitemap = await readFile(sync.sitemapPath, "utf8");
  const ambiguousLine = sitemap
    .split("\n")
    .find((line) => line.includes("`.scratch/work/issues/03-ambiguous.md`"));
  const healthyLine = sitemap
    .split("\n")
    .find((line) => line.includes("`.scratch/healthy/issues/03-ready.md`"));

  expect(sync.diagnostics).toContainEqual({
    code: "ambiguous-ticket-blocker",
    impact: "blocking",
    target: ".scratch/work/issues/03-ambiguous.md",
    message: "Tracker-native Ticket blocker is ambiguous within its work scope.",
  });
  expect(
    sync.diagnostics.filter((diagnostic) => diagnostic.code === "duplicate-ticket-number"),
  ).toEqual([
    {
      code: "duplicate-ticket-number",
      impact: "blocking",
      target: ".scratch/work/issues/02-open.md",
      message: "Tracker-native Ticket number is duplicated within its work scope.",
    },
    {
      code: "duplicate-ticket-number",
      impact: "blocking",
      target: ".scratch/work/issues/02-resolved.md",
      message: "Tracker-native Ticket number is duplicated within its work scope.",
    },
  ]);
  expect(ambiguousLine).not.toContain("blocked-by:");
  expect(healthyLine).toContain("blocked-by: `.scratch/healthy/issues/02-resolved.md`");
  expect(snapshot.tickets).toMatchObject({
    validity: "partial",
    items: expect.arrayContaining([
      expect.objectContaining({
        reference: ".scratch/healthy/issues/02-resolved.md",
        state: "resolved",
        blockedBy: [],
      }),
      expect.objectContaining({
        reference: ".scratch/healthy/issues/03-ready.md",
        state: "ready",
        blockedBy: [".scratch/healthy/issues/02-resolved.md"],
      }),
    ]),
  });
  expect(
    snapshot.tickets.validity === "available"
      ? snapshot.tickets.items
      : snapshot.tickets.validity === "partial"
        ? snapshot.tickets.items
        : [],
  ).not.toEqual(
    expect.arrayContaining([
      expect.objectContaining({ reference: ".scratch/work/issues/02-open.md" }),
      expect.objectContaining({ reference: ".scratch/work/issues/02-resolved.md" }),
      expect.objectContaining({ reference: ".scratch/work/issues/03-ambiguous.md" }),
    ]),
  );
});
