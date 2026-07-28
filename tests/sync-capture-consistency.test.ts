import { expect, test } from "bun:test";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { createProjectMaterializer } from "../src/portal/project-materializer";
import type { MattProviderFactory } from "../src/provider-capture-generation";
import {
  createLocalMarkdownMattProvider,
  type LocalMarkdownCaptureEvent,
} from "../src/providers/matt-skills-v1/local-markdown";
import type { SyncPlan } from "../src/sync-plan";
import { commitSyncPlan, prepareSync } from "../src/sync-plan";
import {
  createValidBearingRepo,
  LOCAL_MATT_CONTRACT,
  LOCAL_MATT_TRIAGE_LABELS,
  writeFixture,
} from "./helpers";

test("commits the captured generation when a source changes after prepare", async () => {
  const root = await createValidBearingRepo();
  const ticket = ".scratch/work/issues/01-finish.md";
  const plan = await prepareSync(root);

  await writeFixture(
    root,
    ticket,
    "# Finish\n\nType: task\n\nStatus: claimed\n\n## Question\n\nWhat remains?\n",
  );
  await commitSyncPlan(plan);

  const committed = await readFile(join(root, ".bearing/cache/project-sitemap.md"), "utf8");
  expect(committed).toContain(`\`${ticket}\` | Finish | resolved-on-route |`);
  expect(committed).not.toContain("| claimed |");

  const next = await prepareSync(root);
  expect(next.sitemap.toString("utf8")).toContain(`\`${ticket}\` | Finish | open |`);
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

test("uses generation-captured interpretation documents without a second provider read", async () => {
  const root = await createValidBearingRepo();
  const contractLocator = "config/matt/issue-tracker.md";
  const triageLocator = "config/matt/triage-labels.md";
  await writeFixture(root, contractLocator, LOCAL_MATT_CONTRACT);
  await writeFixture(root, triageLocator, LOCAL_MATT_TRIAGE_LABELS);
  await writeFixture(
    root,
    ".bearing/provider.json",
    `${JSON.stringify({
      schemaVersion: 1,
      provider: "matt-skills/v1",
      contractLocator,
    })}\n`,
  );
  const events: LocalMarkdownCaptureEvent[] = [];
  let mutated = false;
  const providerFactory: MattProviderFactory = (input) => {
    const provider = createLocalMarkdownMattProvider({
      repoRoot: input.repoRoot,
      contractLocator: input.configuration.contractLocator,
      capturedDocuments: input.capturedDocuments,
      onCaptureEvent: (event) => {
        events.push(event);
      },
    });
    return {
      id: provider.id,
      capture: async (binding, generation) => {
        if (!mutated) {
          mutated = true;
          await writeFixture(root, triageLocator, "# Changed after the Sync input generation\n");
        }
        return provider.capture(binding, generation);
      },
    };
  };

  const captured = await prepareSync(root, { providerFactory });
  expect(captured.diagnostics).toEqual([]);
  expect(captured.providerCaptures[0]).toMatchObject({
    state: "available",
    freshness: { assessment: "current" },
  });
  expect(
    events.filter((event) => event.kind === "content-read").map((event) => event.locator),
  ).not.toContain(contractLocator);
  expect(
    events.filter((event) => event.kind === "content-read").map((event) => event.locator),
  ).not.toContain(triageLocator);

  const next = await prepareSync(root);
  expect(next.fingerprint).not.toBe(captured.fingerprint);
  expect(next.diagnostics).toContainEqual(
    expect.objectContaining({
      code: "matt.local.mapping.ambiguous",
      target: triageLocator,
    }),
  );
});
