import { expect, test } from "bun:test";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { createProjectMaterializer } from "../src/portal/project-materializer";
import type { SyncPlan } from "../src/sync-plan";
import { commitSyncPlan, prepareSync } from "../src/sync-plan";
import { createValidBearingRepo, writeFixture } from "./helpers";

test("commits the captured generation when a source changes after prepare", async () => {
  const root = await createValidBearingRepo();
  const ticket = ".scratch/work/issues/01-finish.md";
  const plan = await prepareSync(root);

  await writeFixture(root, ticket, "# Finish\n\nStatus: claimed\n");
  await commitSyncPlan(plan);

  const committed = await readFile(join(root, ".bearing/cache/project-sitemap.md"), "utf8");
  expect(committed).toContain(`\`${ticket}\` | Finish | resolved |`);
  expect(committed).not.toContain("| claimed |");

  const next = await prepareSync(root);
  expect(next.sitemap.toString("utf8")).toContain(`\`${ticket}\` | Finish | claimed |`);
  expect(next.fingerprint).not.toBe(plan.fingerprint);
});

test("materializes report, Sitemap, Snapshot, and Receipt from one captured generation", async () => {
  const root = await createValidBearingRepo();
  let captured: SyncPlan | undefined;
  const result = await createProjectMaterializer({
    packageVersion: "0.0.0-test",
    now: () => "2026-07-18T12:00:00.000Z",
    dependencies: {
      prepare: async (repoRoot) => {
        const plan = await prepareSync(repoRoot);
        captured = plan;
        await writeFixture(repoRoot, "CONTEXT.md", "# Changed after capture\n");
        return plan;
      },
    },
  }).run(root, "force");
  if (captured === undefined) throw new Error("Expected one captured Sync plan.");
  if (result.receipt === undefined) throw new Error("Expected a Sync Receipt.");

  expect(captured.fingerprint).toBe(result.snapshot.basis.sitemapFingerprint);
  expect(captured.fingerprint).toBe(result.receipt.sitemap.fingerprint);
  expect(await readFile(captured.reportPath, "utf8")).toContain(
    `Input fingerprint: ${captured.fingerprint}`,
  );
  expect(await readFile(captured.sitemapPath, "utf8")).toContain(
    `Input fingerprint: ${captured.fingerprint}`,
  );
  const next = await prepareSync(root);
  expect(next.fingerprint).not.toBe(captured.fingerprint);
  expect(next.changed).toBe(true);
});

test("keeps Asset availability at the captured state until the next Sync", async () => {
  const root = await createValidBearingRepo();
  const assetLocation = "evidence/captured.md";
  await writeFixture(root, assetLocation, "captured evidence\n");
  await writeFixture(
    root,
    ".bearing/state/assets.md",
    `---
Type: asset-registry
Assets:
  - ID: asset:captured
    Title: Captured evidence
    Kind: verification-report
    Location: ${assetLocation}
    Owner: effort:test
    Producer:
      Kind: agent
      Name: fixture
    Lifecycle source: native
---

# Assets
`,
  );

  const first = await createProjectMaterializer({
    packageVersion: "0.0.0-test",
    dependencies: {
      prepare: async (repoRoot) => {
        const plan = await prepareSync(repoRoot);
        await rm(join(repoRoot, assetLocation));
        return plan;
      },
    },
  }).run(root, "force");
  expect(first.snapshot.assets).toMatchObject({
    validity: "available",
    items: [{ id: "asset:captured", contentAvailability: "available" }],
  });

  const second = await createProjectMaterializer({ packageVersion: "0.0.0-test" }).run(
    root,
    "force",
  );
  expect(second.snapshot.assets).toMatchObject({
    validity: "available",
    items: [{ id: "asset:captured", contentAvailability: "missing" }],
  });
  expect(second.snapshot.basis.sitemapFingerprint).not.toBe(
    first.snapshot.basis.sitemapFingerprint,
  );
});
