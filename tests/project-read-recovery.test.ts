import { expect, test } from "bun:test";
import type { ProjectEntryResult } from "../src/portal/project-entry";
import { readCurrentProject } from "../src/portal/project-read-recovery";
import type { ProjectRepoView } from "../src/portal/project-view";

const repoView = (marker: string): ProjectRepoView => ({
  cache: {
    snapshot: { state: "malformed", diagnostic: { code: marker, message: marker } },
    receipt: null,
    retained: false,
  },
  diagnosticCounts: null,
});

const available = (repoRoot: string, displayName: string): ProjectEntryResult => ({
  kind: "available",
  entry: { entryId: "project-1", repoRoot, displayName },
});

test("a GET retries the latest Catalog root instead of returning a relinked root", async () => {
  let repoRoot = "/repo/alpha";
  const reads: string[] = [];
  const result = await readCurrentProject({
    entryId: "project-1",
    resolve: async () => available(repoRoot, repoRoot.endsWith("alpha") ? "Alpha" : "Beta"),
    readRepo: async (root) => {
      reads.push(root);
      if (root.endsWith("alpha")) repoRoot = "/repo/beta";
      return repoView(root);
    },
    validation: () => ({ due: true, cooldownRemainingMs: 0, inFlight: false }),
  });

  expect(reads).toEqual(["/repo/alpha", "/repo/beta"]);
  expect(result).toMatchObject({
    kind: "ready",
    view: {
      project: { displayName: "Beta" },
      cache: { snapshot: { diagnostic: { code: "/repo/beta" } } },
    },
  });
});

test("a GET fails closed when the Catalog keeps moving during bounded retries", async () => {
  let revision = 0;
  const result = await readCurrentProject({
    entryId: "project-1",
    resolve: async () => available(`/repo/${revision}`, `Revision ${revision}`),
    readRepo: async (root) => {
      revision += 1;
      return repoView(root);
    },
    validation: () => ({ due: true, cooldownRemainingMs: 0, inFlight: false }),
  });

  expect(result).toMatchObject({ kind: "read-failed", error: { code: "request-failed" } });
  expect(result).not.toHaveProperty("view");
});

test("a GET retries the latest root when reading the moved old root throws", async () => {
  let repoRoot = "/repo/alpha";
  const reads: string[] = [];
  const result = await readCurrentProject({
    entryId: "project-1",
    resolve: async () => available(repoRoot, repoRoot.endsWith("alpha") ? "Alpha" : "Beta"),
    readRepo: async (root) => {
      reads.push(root);
      if (root.endsWith("alpha")) {
        repoRoot = "/repo/beta";
        throw new Error("old root moved");
      }
      return repoView(root);
    },
    validation: () => ({ due: true, cooldownRemainingMs: 0, inFlight: false }),
  });

  expect(reads).toEqual(["/repo/alpha", "/repo/beta"]);
  expect(result).toMatchObject({
    kind: "ready",
    view: {
      project: { displayName: "Beta" },
      cache: { snapshot: { diagnostic: { code: "/repo/beta" } } },
    },
  });
});

test("a GET reports request-failed when the same Catalog root still cannot be read", async () => {
  const result = await readCurrentProject({
    entryId: "project-1",
    resolve: async () => available("/repo/alpha", "Alpha"),
    readRepo: async () => {
      throw new Error("read failed");
    },
    validation: () => ({ due: true, cooldownRemainingMs: 0, inFlight: false }),
  });

  expect(result).toMatchObject({ kind: "read-failed", error: { code: "request-failed" } });
});
