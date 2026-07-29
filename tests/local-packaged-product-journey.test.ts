import { expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { createProjectMaterializer } from "../src/portal/project-materializer";
import { buildProjectSnapshot } from "../src/project-snapshot/projection";
import type { MattProviderFactory } from "../src/provider-capture-generation";
import { createLocalMarkdownMattProvider } from "../src/providers/matt-skills-v1/local-markdown";
import { setupRepository } from "../src/repo-setup";
import { prepareSync } from "../src/sync-plan";
import {
  buildSnapshotForSyncPlan,
  LOCAL_MATT_CONTRACT,
  LOCAL_MATT_TRIAGE_LABELS,
  makeTemporaryDirectory,
  standardMattAgentSurface,
  writeFixture,
} from "./helpers";

const PACKAGE_VERSION = "0.1.1-test";

const writeCanonicalPlanning = async (root: string): Promise<void> => {
  await writeFixture(
    root,
    ".bearing/state/project-summary.md",
    `---
Type: project-summary
ID: project-summary:current
Title: Packaged Journey
---

# Project Summary: Packaged Journey

## Purpose

Prove the packaged Local Matt journey.

## Current Design

One provider capture per bound Effort.

## Boundaries

- Keep Matt workflow truth provider-owned.

## Future Candidates

- None.

## Material Revisions

- G2 clean cut.
`,
  );
  await writeFixture(
    root,
    ".bearing/state/roadmap-index.md",
    `---
Type: roadmap-index
Roadmaps:
  - roadmap:journey
---

# Roadmap Index
`,
  );
  await writeFixture(
    root,
    ".bearing/state/roadmaps/journey.md",
    `---
Type: roadmap
ID: roadmap:journey
Title: Packaged Journey
Status: active
Focused gate: gate:journey
Gate order:
  - gate:journey
---

# Roadmap: Packaged Journey

## Intent

Complete one packaged Local workflow.
`,
  );
  await writeFixture(
    root,
    ".bearing/state/milestone-gates/journey.md",
    `---
Type: milestone-gate
ID: gate:journey
Title: Journey complete
Roadmap: roadmap:journey
Status: active
---

# Milestone Gate: Journey complete

## Intent

Review the completed packaged journey.

## Exit Criteria

- Provider-assessed delivery is complete.
`,
  );
  await writeFixture(
    root,
    ".bearing/state/efforts/journey.md",
    `---
Type: effort
ID: effort:journey
Title: Local Matt delivery
Roadmap: roadmap:journey
Target gate: gate:journey
Authorities: []
Citations: []
Work binding:
  Provider: matt-skills/v1
  Native scope: .scratch/journey
---

# Effort: Local Matt delivery

## Intent

Deliver the accepted Local Matt product seam.

## Work

- [Map](map.md)
- [PRD](PRD.md)
`,
  );
  await writeFixture(
    root,
    ".bearing/state/assets.md",
    `---
Type: asset-registry
Assets: []
---

# Asset Registry
`,
  );
};

const PRD = `# Packaged Local Journey

Status: ready-for-agent

## Problem Statement

The packaged product must preserve Matt workflow truth.

## Solution

Capture one bound Local scope once per generation.

## User Stories

A user can inspect the same capture through every Bearing read surface.

## Implementation Decisions

Keep provider semantics out of the generic core.

## Testing Decisions

Exercise Setup through Portal materialization.

## Out of Scope

Do not add compatibility aliases.

## Further Notes

The provider owns completion.
`;

const writeDecisionPhaseComplete = async (root: string): Promise<void> => {
  await writeFixture(
    root,
    ".scratch/journey/map.md",
    `# Wayfinder Map: Packaged Journey

Status: active

## Destination

Deliver the packaged Local product seam.

## Decisions so far

- [Choose the capture boundary](issues/01-decide.md) — Use one provider capture.

## Fog
`,
  );
  await writeFixture(root, ".scratch/journey/PRD.md", PRD);
  await writeFixture(
    root,
    ".scratch/journey/issues/01-decide.md",
    `# Choose the capture boundary

Type: task

Status: resolved

## Question

Which boundary owns Matt semantics?

## Answer

The versioned provider capture.
`,
  );
  await writeFixture(
    root,
    ".scratch/journey/issues/02-review.md",
    `# Review the capture boundary

Type: grilling

Blocked by: 01

## Question

Does the accepted boundary preserve an unclaimed planning frontier?
`,
  );
  await writeFixture(
    root,
    ".scratch/journey/issues/03-deliver.md",
    `# Deliver the packaged journey

**What to build:** The Setup through Portal product seam.

Blocked by: 02

Status: claimed

- [ ] Preserve the Spec and Delivery lifecycle.
- [ ] Materialize the same capture in Portal.
`,
  );
};

const writeDeliveryComplete = async (root: string): Promise<void> => {
  await writeFixture(
    root,
    ".scratch/journey/map.md",
    `# Wayfinder Map: Packaged Journey

Status: resolved

## Destination

Deliver the packaged Local product seam.

## Decisions so far

- [Choose the capture boundary](issues/01-decide.md) — Use one provider capture.
- [Review the capture boundary](issues/02-review.md) — Preserve a Status-absent open and unclaimed frontier.

## Fog
`,
  );
  await writeFixture(
    root,
    ".scratch/journey/issues/02-review.md",
    `# Review the capture boundary

Type: grilling

Blocked by: 01

Status: resolved

## Question

Does the accepted boundary preserve an unclaimed planning frontier?

## Answer

Yes. Status absence is the Local driver encoding for open and unclaimed Wayfinder work.
`,
  );
  await writeFixture(
    root,
    ".scratch/journey/issues/03-deliver.md",
    `# Deliver the packaged journey

**What to build:** The Setup through Portal product seam.

Blocked by: 02

Status: resolved

- [x] Preserve the Spec and Delivery lifecycle.
- [x] Materialize the same capture in Portal.

## Answer

Implemented and verified through the packaged seam.
`,
  );
};

test("fresh packaged Local journey uses one generation-bound capture through Portal", async () => {
  const root = await makeTemporaryDirectory("bearing-packaged-local-");
  try {
    await writeFixture(root, "docs/agents/issue-tracker.md", LOCAL_MATT_CONTRACT);
    await writeFixture(root, "docs/agents/triage-labels.md", LOCAL_MATT_TRIAGE_LABELS);
    await writeFixture(root, "AGENTS.md", standardMattAgentSurface());

    const setup = await setupRepository({
      repoRoot: root,
      packageRoot: process.cwd(),
      surfaces: ["agent-skills"],
      profiles: [],
      provider: {
        key: "matt-skills/v1",
        contractLocator: "docs/agents/issue-tracker.md",
      },
    });
    expect(setup.outcome).toBe("applied");

    await writeCanonicalPlanning(root);
    await writeDecisionPhaseComplete(root);

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
      });
      return {
        id: provider.id,
        capture: async (binding, generation) => {
          captureCalls += 1;
          return provider.capture(binding, generation);
        },
      };
    };

    const decisionPlan = await prepareSync(root, { providerFactory });
    expect(decisionPlan.diagnostics).toEqual([]);
    expect(captureCalls).toBe(1);
    expect(decisionPlan.metrics.providerCaptureCount).toBe(1);
    expect(decisionPlan.inputs).not.toContain(".scratch/journey/map.md");
    expect(decisionPlan.inputs).not.toContain(".scratch/journey/issues/03-deliver.md");
    const decisionCapture = decisionPlan.providerCaptures[0];
    expect(decisionCapture?.generation.fingerprint).toBe(decisionPlan.fingerprint);
    expect(decisionCapture).toMatchObject({
      state: "available",
      completion: "incomplete",
      binding: { provider: "matt-skills/v1", nativeScope: ".scratch/journey" },
      projection: {
        map: { lifecycle: { state: "active" } },
        spec: { lifecycle: { state: "ready-for-agent" } },
        wayfinderTickets: [
          { lifecycle: { state: "resolved-on-route" } },
          {
            claim: { state: "unclaimed" },
            lifecycle: { state: "open" },
            trackerClosure: { state: "open" },
          },
        ],
        deliveryTickets: [{ lifecycle: { state: "open" } }],
      },
    });
    const decisionEffort = decisionPlan.planningGraph.contextFor({
      kind: "effort",
      id: "effort:journey",
    });
    expect(decisionEffort.state).toBe("complete");
    if (decisionEffort.state === "invalid") throw new Error("Expected Effort context.");
    expect(decisionEffort.context.providerCapture).toBe(decisionCapture);
    expect(decisionEffort.context.effort.value.derivedState).toBe("active");
    expect(
      decisionPlan.planningGraph.contextFor({ kind: "gate", id: "gate:journey" }),
    ).toMatchObject({
      state: "complete",
      context: { gate: { value: { readiness: "not-ready" } } },
    });

    await writeDeliveryComplete(root);
    captureCalls = 0;
    const completedPlan = await prepareSync(root, { providerFactory });
    expect(completedPlan.diagnostics).toEqual([]);
    expect(captureCalls).toBe(1);
    expect(completedPlan.metrics.providerCaptureCount).toBe(1);
    expect(completedPlan.fingerprint).not.toBe(decisionPlan.fingerprint);
    const completedCapture = completedPlan.providerCaptures[0];
    expect(completedCapture?.generation.fingerprint).toBe(completedPlan.fingerprint);
    expect(completedCapture).toMatchObject({
      state: "available",
      completion: "complete",
      projection: {
        deliveryTickets: [{ lifecycle: { state: "completed" } }],
      },
    });
    expect(Object.isFrozen(completedCapture)).toBe(true);

    const inspect = completedPlan.planningGraph.contextFor({
      kind: "effort",
      id: "effort:journey",
    });
    expect(inspect.state).toBe("complete");
    if (inspect.state === "invalid") throw new Error("Expected Effort context.");
    expect(inspect.context.providerCapture).toBe(completedCapture);
    expect(inspect.context.effort.value.derivedState).toBe("resolved");
    expect(
      completedPlan.planningGraph.contextFor({ kind: "gate", id: "gate:journey" }),
    ).toMatchObject({
      state: "complete",
      context: { gate: { value: { readiness: "ready-for-review" } } },
    });
    const sitemap = completedPlan.sitemap.toString("utf8");
    expect(sitemap).toContain(
      "`.scratch/journey/PRD.md` | Packaged Local Journey | ready-for-agent",
    );
    expect(sitemap).toContain(
      "`.scratch/journey/issues/03-deliver.md` | Deliver the packaged journey | completed",
    );

    const snapshot = await buildSnapshotForSyncPlan(root, PACKAGE_VERSION, completedPlan);
    expect(snapshot.providerCaptures).toEqual(completedPlan.providerCaptures);
    expect(snapshot.providerCaptures[0]?.generation.fingerprint).toBe(
      String(snapshot.basis.sitemapFingerprint),
    );
    expect("maps" in snapshot).toBe(false);
    expect("tickets" in snapshot).toBe(false);
    expect("nativeRecords" in completedPlan).toBe(false);
    if (snapshot.efforts.validity === "invalid") throw new Error("Expected Effort projection.");
    expect(snapshot.efforts.items[0]).not.toHaveProperty("frontier");
    expect(snapshot.efforts.items[0]?.workBinding).not.toHaveProperty("driver");

    let portalSawGenerationCapture = false;
    const materializer = createProjectMaterializer({
      packageVersion: PACKAGE_VERSION,
      dependencies: {
        prepare: async () => completedPlan,
        buildSnapshot: async (input) => {
          portalSawGenerationCapture = input.providerCaptures === completedPlan.providerCaptures;
          return buildProjectSnapshot(input);
        },
      },
    });
    const portal = await materializer.run(root, "ensure-current");
    expect(portalSawGenerationCapture).toBe(true);
    expect(portal.snapshot.providerCaptures).toEqual(completedPlan.providerCaptures);
    expect(String(portal.snapshot.basis.sitemapFingerprint)).toBe(completedPlan.fingerprint);

    const stablePlan = await prepareSync(root, { providerFactory });
    expect(stablePlan.fingerprint).toBe(completedPlan.fingerprint);
    expect(stablePlan.changed).toBe(false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
