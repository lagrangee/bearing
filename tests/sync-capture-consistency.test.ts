import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createProjectMaterializer } from "../src/portal/project-materializer";
import type { MattProviderFactory } from "../src/provider-observation-acquisition";
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

test("commits one observation and leaves later native edits for explicit verification", async () => {
  const root = await createValidBearingRepo();
  const ticket = ".scratch/work/issues/01-finish.md";
  const plan = await prepareSync(root, {
    providerObservationIntent: "initial-baseline",
  });

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
  expect(next.sitemap.toString("utf8")).toContain(`\`${ticket}\` | Finish | resolved-on-route |`);
  expect(next.fingerprint).toBe(plan.fingerprint);

  const verified = await prepareSync(root, {
    providerObservationIntent: "full-verification",
  });
  expect(verified.sitemap.toString("utf8")).toContain(`\`${ticket}\` | Finish | open |`);
  expect(verified.fingerprint).not.toBe(plan.fingerprint);
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
      capture: async (binding) => {
        if (!mutated) {
          mutated = true;
          await writeFixture(root, triageLocator, "# Changed after the Sync input generation\n");
        }
        return provider.capture(binding);
      },
    };
  };

  const captured = await prepareSync(root, {
    providerObservationIntent: "initial-baseline",
    providerFactory,
  });
  expect(captured.diagnostics).toEqual([]);
  expect(captured.providerObservations[0]).toMatchObject({
    state: "available",
    freshness: { assessment: "current" },
  });
  expect(
    events.filter((event) => event.kind === "content-read").map((event) => event.locator),
  ).not.toContain(contractLocator);
  expect(
    events.filter((event) => event.kind === "content-read").map((event) => event.locator),
  ).not.toContain(triageLocator);

  const next = await prepareSync(root, {
    providerObservationIntent: "full-verification",
  });
  expect(next.fingerprint).not.toBe(captured.fingerprint);
  expect(next.diagnostics).toContainEqual(
    expect.objectContaining({
      code: "matt.local.mapping.ambiguous",
      target: triageLocator,
    }),
  );
});
