import { expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { createProjectMaterializer } from "../src/portal/project-materializer";
import { buildProjectSnapshot } from "../src/project-snapshot/projection";
import type { MattProviderFactory } from "../src/provider-capture-generation";
import {
  createLocalMarkdownMattProvider,
  type LocalMarkdownCaptureEvent,
} from "../src/providers/matt-skills-v1/local-markdown";
import { prepareSync } from "../src/sync-plan";
import { buildSnapshotForSyncPlan, createValidBearingRepo } from "./helpers";

const PACKAGE_VERSION = "0.1.1-test";

const injectedLatency = (): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, 2);
  });

test("injected Local acquisition latency remains one capture with no consumer re-fetch", async () => {
  const root = await createValidBearingRepo();
  const events: LocalMarkdownCaptureEvent[] = [];
  let captureCalls = 0;
  const providerFactory: MattProviderFactory = ({
    driver,
    configuration,
    repoRoot,
    capturedDocuments,
  }) => {
    expect(driver).toBe("local-markdown");
    const provider = createLocalMarkdownMattProvider({
      repoRoot,
      contractLocator: configuration.contractLocator,
      capturedDocuments,
      onCaptureEvent: async (event) => {
        events.push(event);
        await injectedLatency();
      },
    });
    return {
      id: provider.id,
      capture: async (binding, generation) => {
        captureCalls += 1;
        return provider.capture(binding, generation);
      },
    };
  };

  try {
    const plan = await prepareSync(root, { providerFactory });
    expect(plan.diagnostics).toEqual([]);
    expect(captureCalls).toBe(1);
    expect(plan.metrics.providerCaptureCount).toBe(1);

    const contentReads = events
      .filter((event) => event.kind === "content-read")
      .map((event) => event.locator);
    const metadataVerifications = events
      .filter((event) => event.kind === "metadata-verified")
      .map((event) => event.locator);
    expect(contentReads.length).toBeGreaterThan(0);
    expect(new Set(contentReads).size).toBe(contentReads.length);
    expect(metadataVerifications.sort()).toEqual([...contentReads].sort());
    expect(events.filter((event) => event.kind === "scope-enumerated")).toEqual([
      { kind: "scope-enumerated", locator: ".scratch/work" },
    ]);
    expect(plan.providerCaptures[0]?.freshness.evidence).toContainEqual({
      kind: "content-read-count",
      value: String(contentReads.length),
    });
    expect(plan.providerCaptures[0]?.freshness.evidence).toContainEqual({
      kind: "metadata-verification",
      value: "stable",
    });

    const eventCountAfterCapture = events.length;
    const effort = plan.planningGraph.contextFor({ kind: "effort", id: "effort:test" });
    expect(effort.state).toBe("complete");
    expect(plan.sitemap.length).toBeGreaterThan(0);
    const snapshot = await buildSnapshotForSyncPlan(root, PACKAGE_VERSION, plan);
    expect(snapshot.providerCaptures).toEqual(plan.providerCaptures);
    const portal = await createProjectMaterializer({
      packageVersion: PACKAGE_VERSION,
      dependencies: {
        prepare: async () => plan,
        buildSnapshot: buildProjectSnapshot,
      },
    }).run(root, "ensure-current");
    expect(portal.snapshot.providerCaptures).toEqual(plan.providerCaptures);
    expect(captureCalls).toBe(1);
    expect(events).toHaveLength(eventCountAfterCapture);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
