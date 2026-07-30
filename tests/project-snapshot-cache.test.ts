import { describe, expect, test } from "bun:test";
import { access, link, lstat, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { readProjectSnapshotCache, writeProjectSnapshotCache } from "../src/project-snapshot/cache";
import { projectSnapshotSchema } from "../src/project-snapshot/schema";
import { createSourceReference } from "../src/project-snapshot/source-reference";
import { makeTemporaryDirectory } from "./helpers";

const basisFingerprint = `sha256:${"a".repeat(64)}`;
const currentFingerprint = `sha256:${"b".repeat(64)}`;
const availableItems = { validity: "available", items: [] } as const;
const source = createSourceReference({
  basisFingerprint,
  kind: "canonical",
  displayLocator: ".bearing/state/project-summary.md",
});
const snapshot = projectSnapshotSchema.parse({
  schemaVersion: 5,
  producer: { packageVersion: "0.0.0-test" },
  basis: { sitemapVersion: 1, sitemapFingerprint: basisFingerprint },
  summary: { validity: "absent" },
  roadmapIndex: { validity: "absent" },
  roadmaps: availableItems,
  gates: availableItems,
  efforts: availableItems,
  authorities: availableItems,
  assets: availableItems,
  checks: availableItems,
  reviews: availableItems,
  audit: { validity: "absent" },
  guidance: { validity: "absent" },
  providerObservations: [],
  providerObservationSelections: [],
  diagnostics: [],
  attention: [],
  sources: [],
});

const createRoot = async (): Promise<string> => {
  const root = await makeTemporaryDirectory("bearing-snapshot-cache-");
  await mkdir(join(root, ".bearing"));
  return root;
};

const targetFor = (root: string): string => join(root, ".bearing/cache/project-snapshot.json");

const writeRawSnapshot = async (root: string, document: unknown): Promise<string> => {
  const target = targetFor(root);
  await mkdir(join(root, ".bearing/cache"), { recursive: true });
  await writeFile(target, `${JSON.stringify(document)}\n`, "utf8");
  return target;
};

describe("Project Snapshot cache semantics", () => {
  test("reads missing state without creating a cache directory", async () => {
    const root = await createRoot();

    expect(await readProjectSnapshotCache(root)).toEqual({ kind: "missing" });
    await expect(access(join(root, ".bearing/cache"))).rejects.toThrow();
  });

  test("creates only the missing cache directory and writes deterministic JSON", async () => {
    const root = await createRoot();

    await writeProjectSnapshotCache(root, snapshot);

    const bytes = await readFile(targetFor(root), "utf8");
    expect(bytes).toBe(`${JSON.stringify(snapshot, null, 2)}\n`);
    expect(await readProjectSnapshotCache(root, basisFingerprint)).toEqual({
      kind: "available",
      snapshot,
    });
  });

  test("returns a trustworthy supported Snapshot as behind when Sitemap basis differs", async () => {
    const root = await createRoot();
    await writeProjectSnapshotCache(root, snapshot);

    expect(await readProjectSnapshotCache(root, currentFingerprint)).toEqual({
      kind: "behind",
      snapshot,
    });
    expect(await readProjectSnapshotCache(root)).toEqual({ kind: "available", snapshot });
  });

  test("isolates malformed and unsupported bytes without returning a Snapshot", async () => {
    const invalidJsonRoot = await createRoot();
    await mkdir(join(invalidJsonRoot, ".bearing/cache"));
    await writeFile(targetFor(invalidJsonRoot), "{broken\n", "utf8");
    const invalidJson = await readProjectSnapshotCache(invalidJsonRoot);

    const malformedRoot = await createRoot();
    await writeRawSnapshot(malformedRoot, { ...snapshot, entryId: "catalog-entry" });
    const malformed = await readProjectSnapshotCache(malformedRoot);

    const unsupportedRoot = await createRoot();
    await writeRawSnapshot(unsupportedRoot, { schemaVersion: 1, legacy: true });
    const unsupported = await readProjectSnapshotCache(unsupportedRoot);

    expect(invalidJson).toEqual({ kind: "malformed", reason: "invalid-json" });
    expect(malformed).toEqual({ kind: "malformed", reason: "invalid-snapshot" });
    expect("snapshot" in malformed).toBe(false);
    expect(unsupported).toEqual({ kind: "unsupported", schemaVersion: 1 });
    expect("snapshot" in unsupported).toBe(false);
  });

  test("rejects a tampered cache whose normalized Summary contains formatting syntax", async () => {
    // Given: valid cache structure with Markdown inserted into one semantic title.
    const root = await createRoot();
    await writeRawSnapshot(root, {
      ...snapshot,
      summary: {
        validity: "available",
        value: {
          id: "project-summary:current",
          title: "**Marked title**",
          purpose: "Keep the whole picture visible.",
          currentDesign: "One read-oriented surface.",
          boundaries: [],
          futureCandidates: [],
          materialRevisions: [],
          source,
        },
      },
    });

    // When / Then: cache read isolates the bytes instead of returning them to Portal.
    expect(await readProjectSnapshotCache(root)).toEqual({
      kind: "malformed",
      reason: "invalid-snapshot",
    });
  });

  test("rejects available audit-based Guidance whose cached Audit basis is unavailable", async () => {
    const root = await createRoot();
    const item = {
      title: "Continue the current Gate",
      rationale: "Use the audited project horizon.",
      supportingReferences: ["roadmap:test"],
      source,
    };
    await writeRawSnapshot(root, {
      ...snapshot,
      guidance: {
        validity: "available",
        value: {
          id: "next-work-guidance:current",
          generatedAt: "2026-07-14T10:01:00+0800",
          semanticFreshness: "current",
          semanticCoverage: "complete",
          basedOnAuditId: "planning-audit:current",
          primary: item,
          alternatives: [
            { ...item, title: "Inspect Assets" },
            { ...item, title: "Review Attention" },
          ],
          source,
        },
      },
    });

    expect(await readProjectSnapshotCache(root)).toEqual({
      kind: "malformed",
      reason: "invalid-snapshot",
    });
  });

  test("validates caller data before creating cache state", async () => {
    const root = await createRoot();
    const snapshotWithCatalogIdentity = { ...snapshot, entryId: "catalog-entry" };

    await expect(writeProjectSnapshotCache(root, snapshotWithCatalogIdentity)).rejects.toThrow();
    await expect(access(join(root, ".bearing/cache"))).rejects.toThrow();
  });
});

describe("Project Snapshot cache filesystem boundary", () => {
  test("rejects a cache ancestor symlink for both read and write", async () => {
    const root = await createRoot();
    const outside = await makeTemporaryDirectory("bearing-snapshot-outside-");
    await symlink(outside, join(root, ".bearing/cache"));

    expect(await readProjectSnapshotCache(root)).toEqual({
      kind: "malformed",
      reason: "unsafe-cache-boundary",
    });
    await expect(writeProjectSnapshotCache(root, snapshot)).rejects.toThrow(
      "unsafe cache boundary",
    );
    await expect(access(join(outside, "project-snapshot.json"))).rejects.toThrow();
  });

  test("rejects a Snapshot symlink without reading or writing its referent", async () => {
    const root = await createRoot();
    const outside = join(await makeTemporaryDirectory("bearing-snapshot-outside-"), "data");
    await writeFile(outside, "outside\n", "utf8");
    await mkdir(join(root, ".bearing/cache"));
    await symlink(outside, targetFor(root));

    expect(await readProjectSnapshotCache(root)).toEqual({
      kind: "malformed",
      reason: "unsafe-cache-file",
    });
    await expect(writeProjectSnapshotCache(root, snapshot)).rejects.toThrow(
      "one unlinked regular file",
    );
    expect(await readFile(outside, "utf8")).toBe("outside\n");
  });

  test("rejects a directory target for both read and write", async () => {
    const root = await createRoot();
    await mkdir(targetFor(root), { recursive: true });

    expect(await readProjectSnapshotCache(root)).toEqual({
      kind: "malformed",
      reason: "unsafe-cache-file",
    });
    await expect(writeProjectSnapshotCache(root, snapshot)).rejects.toThrow(
      "one unlinked regular file",
    );
    expect((await lstat(targetFor(root))).isDirectory()).toBe(true);
  });

  test("rejects a multiply-linked target without changing either name", async () => {
    const root = await createRoot();
    const target = await writeRawSnapshot(root, snapshot);
    const peer = join(root, "snapshot-peer.json");
    await link(target, peer);

    expect(await readProjectSnapshotCache(root)).toEqual({
      kind: "malformed",
      reason: "unsafe-cache-file",
    });
    await expect(writeProjectSnapshotCache(root, snapshot)).rejects.toThrow(
      "one unlinked regular file",
    );
    expect(await Promise.all([readFile(target, "utf8"), readFile(peer, "utf8")])).toEqual([
      `${JSON.stringify(snapshot)}\n`,
      `${JSON.stringify(snapshot)}\n`,
    ]);
  });

  test("rejects a FIFO target without blocking", async () => {
    const root = await createRoot();
    await mkdir(join(root, ".bearing/cache"));
    const created = Bun.spawn(["mkfifo", targetFor(root)]);
    expect(await created.exited).toBe(0);

    expect(await readProjectSnapshotCache(root)).toEqual({
      kind: "malformed",
      reason: "unsafe-cache-file",
    });
    await expect(writeProjectSnapshotCache(root, snapshot)).rejects.toThrow(
      "one unlinked regular file",
    );
  }, 1_000);
});
