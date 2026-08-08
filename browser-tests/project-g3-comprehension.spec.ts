import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { createProviderScopeObservation } from "../src/native-work-provider";
import {
  type PlanningLineageSubject,
  planningLineageSubjectHref,
} from "../src/planning-lineage-route";
import type { ProjectSnapshot, ProjectSnapshotInput } from "../src/project-snapshot/contract";
import { buildMattNativeSourceRecords } from "../src/project-snapshot/native-work-sources";
import { buildProjectSnapshot } from "../src/project-snapshot/projection";
import { projectSnapshotSchema } from "../src/project-snapshot/schema";
import { createSourceRecord } from "../src/project-snapshot/source-records";
import type { MattProviderFactory } from "../src/provider-observation-acquisition";
import { encodeGitHubMattNativeScope } from "../src/providers/matt-skills-v1/github";
import { mattNativeScopeSubject } from "../src/providers/matt-skills-v1/native-subject";
import { prepareSync } from "../src/sync-plan";
import { createMattReferenceProjection } from "../tests/fixtures/matt-reference-scenario";
import { createProjectOverviewFixture } from "../tests/fixtures/project-overview";
import {
  copyPortalProjectFixture,
  readRepositorySourceBytes,
} from "../tests/fixtures/repository-fixture";
import {
  parseRebuiltPlanningLineageFixture,
  withRebuiltPlanningLineage,
} from "../tests/planning-lineage-fixture";
import {
  projectFindEnvelope,
  projectRowEnvelope,
  projectSectionFromRequest,
  projectTargetFromRequest,
} from "./project-row-fixture";
import {
  type RunningTestPortal,
  runHarnessCommand,
  startBuiltPortal,
  stopBuiltPortal,
  writeCatalogFixture,
} from "./real-host-test-support";

const entryId = "g3-comprehension";

const withProjectBrief = (snapshot: ProjectSnapshot): ProjectSnapshot => {
  const source = createSourceRecord(snapshot.basis.sitemapFingerprint, {
    kind: "canonical",
    locator: ".bearing/state/project-brief.md",
    binding: { role: "project-brief", identity: "project-brief:current" },
  });
  return projectSnapshotSchema.parse({
    ...snapshot,
    brief: {
      validity: "available",
      value: {
        id: "project-brief:current",
        title: "Project Brief",
        generatedAt: "2026-08-03T02:03:04Z",
        projectPurpose: "Restore managed planning context without expanding Bearing Scope.",
        currentStage: "Review the revised G3 reading contract.",
        materialAchievedState: "Direct semantic reading and clean-cut boundaries are delivered.",
        source: source.reference,
      },
    },
    sources: [...snapshot.sources, source],
  });
};

const standaloneObservation = (nativeKind: "local" | "github", nativeScope: string) => {
  const projection = createMattReferenceProjection(nativeKind);
  if (projection.map === undefined) throw new Error("Expected standalone Map projection input.");
  return createProviderScopeObservation({
    provider: "matt-skills/v1",
    binding: { provider: "matt-skills/v1", nativeScope },
    observedAt: "2026-08-03T03:00:00.000Z",
    sourceRevision: `${nativeKind}:standalone-revision`,
    sourceObservedAt: "2026-08-03T03:00:00.000Z",
    validators: [],
    state: "available",
    freshness: {
      assessment: "current",
      evidence: [{ kind: `${nativeKind}-standalone`, value: nativeScope }],
    },
    coverage: {
      assessment: "complete",
      dimensions: [{ key: "scope", state: "covered" }],
    },
    completion: "incomplete",
    diagnostics: [],
    projection: {
      ...projection,
      map: {
        ...projection.map,
        title: "Unbound Standalone Release Triage",
        destination: "Triage release work without enrolling it in Bearing Scope.",
      },
    },
  });
};

const proveGitHubStandaloneExclusion = async (): Promise<void> => {
  const root = await realpath(await copyPortalProjectFixture("G3 GitHub Standalone Proof"));
  try {
    const boundScope = encodeGitHubMattNativeScope({
      host: "github.com",
      rootKind: "wayfinder-map",
      repository: {
        owner: "example",
        name: "reference",
        databaseId: "9001",
        nodeId: "R_reference",
      },
      root: {
        objectKind: "issue",
        number: 101,
        databaseId: "9101",
        nodeId: "I_reference_1",
      },
    });
    const standaloneTitle = "Unbound Standalone Release Triage";
    const standalone = standaloneObservation(
      "github",
      encodeGitHubMattNativeScope({
        host: "github.com",
        rootKind: "wayfinder-map",
        repository: {
          owner: "example",
          name: "standalone",
          databaseId: "9901",
          nodeId: "R_standalone",
        },
        root: {
          objectKind: "issue",
          number: 404,
          databaseId: "9911",
          nodeId: "I_standalone_404",
        },
      }),
    );
    const bound = createProviderScopeObservation({
      provider: "matt-skills/v1",
      binding: { provider: "matt-skills/v1", nativeScope: boundScope },
      observedAt: "2026-08-03T03:00:00.000Z",
      sourceRevision: "github:bound-revision",
      sourceObservedAt: "2026-08-03T03:00:00.000Z",
      validators: [],
      state: "available",
      freshness: {
        assessment: "current",
        evidence: [{ kind: "github-bound", value: boundScope }],
      },
      coverage: {
        assessment: "complete",
        dimensions: [{ key: "scope", state: "covered" }],
      },
      completion: "incomplete",
      diagnostics: [],
      projection: createMattReferenceProjection("github"),
    });
    const availableProviderInput = new Map([
      [boundScope, bound],
      [standalone.binding.nativeScope, standalone],
    ]);
    expect(availableProviderInput.get(standalone.binding.nativeScope)?.projection?.map?.title).toBe(
      standaloneTitle,
    );
    const effortPath = join(root, ".bearing/state/efforts/fixture.md");
    const effort = await readFile(effortPath, "utf8");
    await writeFile(
      effortPath,
      effort.replace("Native scope: .scratch/work", `Native scope: ${boundScope}`),
    );
    await writeFile(
      join(root, "docs/agents/issue-tracker.md"),
      '# Issue tracker: GitHub\n\n## Conventions\n\n- Use the `gh` CLI for GitHub tracker reads.\n\n## Pull requests as a triage surface\n\n**PRs as a request surface: no.**\n\n## When a skill says "publish to the issue tracker"\n\nCreate a GitHub issue.\n\n## When a skill says "fetch the relevant ticket"\n\nRun `gh issue view <number> --comments`.\n\n## Wayfinding operations\n\nUse one issue with child issues.\n',
    );
    const capturedScopes: string[] = [];
    const providerFactory: MattProviderFactory = (input) => ({
      id: "matt-skills/v1",
      capture: async (binding) => {
        expect(input.driver).toBe("github-issues");
        capturedScopes.push(binding.nativeScope);
        const observation = availableProviderInput.get(binding.nativeScope);
        if (observation === undefined) throw new Error("Unexpected GitHub binding capture.");
        return observation;
      },
    });
    const plan = await prepareSync(root, {
      providerObservationIntent: "initial-baseline",
      providerFactory,
    });
    const snapshot = await buildProjectSnapshot({
      repoRoot: root,
      packageVersion: "0.0.0-g3-proof",
      sitemapFingerprint: plan.fingerprint,
      diagnostics: plan.diagnostics,
      advisoryFreshness: plan.advisoryFreshness,
      decoded: plan.decoded,
      providerObservations: plan.providerObservations,
      providerObservationSelections: plan.providerObservationSelections,
      nativeScopeInspectionObservations: plan.nativeScopeInspectionObservations,
      nativeScopeInspectionSelections: plan.nativeScopeInspectionSelections,
      assetContentObservations: plan.assetContentObservations,
      planningGraph: plan.planningGraph,
    });
    expect(capturedScopes).toEqual([boundScope]);
    expect(plan.providerObservations.map((observation) => observation.id)).toEqual([bound.id]);
    const serialized = JSON.stringify(snapshot);
    expect(serialized).not.toContain(standaloneTitle);
    expect(serialized).not.toContain("example/standalone");
    expect(JSON.stringify(snapshot.attention)).not.toContain(standaloneTitle);
    expect(JSON.stringify(snapshot.lineage)).not.toContain(standaloneTitle);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
};

const withPreviewAsset = (snapshot: ProjectSnapshot): ProjectSnapshot => {
  if (snapshot.assets.validity !== "available") throw new Error("Expected readable Assets.");
  const source = createSourceRecord(snapshot.basis.sitemapFingerprint, {
    kind: "asset",
    locator: ".bearing/state/assets.md",
    binding: { role: "asset", identity: "asset:fixture-uncited" },
    fragment: "asset:fixture-uncited",
  });
  const candidate = {
    ...snapshot,
    assets: {
      validity: "available" as const,
      items: [
        ...snapshot.assets.items,
        {
          id: "asset:fixture-uncited",
          title: "Uncited Fixture Evidence",
          source: source.reference,
          evidenceRoles: [],
          citations: [],
          authorityAdoptions: [],
          passageEvidence: [],
          kind: "verification-report",
          owner: "effort:portal",
          producer: { kind: "executor-profile", name: "generic-agent" },
          lifecycleSource: "native",
          registeredAt: { availability: "unavailable" },
          displayLocation: "evidence/uncited.md",
          contentAvailability: "available",
          contentShape: "file",
        },
      ],
    },
    sources: [...snapshot.sources, source],
  };
  return projectSnapshotSchema.parse(withRebuiltPlanningLineage(candidate as ProjectSnapshotInput));
};

const localSnapshot = (): ProjectSnapshot => {
  const snapshot = withPreviewAsset(withEffortOutput(createProjectOverviewFixture()));
  if (snapshot.assets.validity === "invalid") throw new Error("Expected Assets.");
  return parseRebuiltPlanningLineageFixture({
    ...snapshot,
    assets: {
      ...snapshot.assets,
      items: snapshot.assets.items.map((asset) =>
        asset.id === "asset:fixture-uncited"
          ? {
              ...asset,
              owner: ".scratch/portal/issues/02-review.md",
              producedFor: ".scratch/portal/issues/01-build.md",
            }
          : asset,
      ),
    },
  });
};

const githubScenarioSnapshot = (): Readonly<{
  snapshot: ProjectSnapshot;
  nativeScope: PlanningLineageSubject;
  nativeSubject: PlanningLineageSubject;
  nativeScopeTitle: string;
  nativeSubjectTitle: string;
  standalone: ReturnType<typeof standaloneObservation>;
}> => {
  const base = withProjectBrief(withEffortOutput(createProjectOverviewFixture()));
  if (base.efforts.validity !== "available") throw new Error("Expected readable Efforts.");
  const nativeScope = encodeGitHubMattNativeScope({
    host: "github.com",
    rootKind: "wayfinder-map",
    repository: {
      owner: "example",
      name: "reference",
      databaseId: "9001",
      nodeId: "R_reference",
    },
    root: {
      objectKind: "issue",
      number: 101,
      databaseId: "9101",
      nodeId: "I_reference_1",
    },
  });
  const observation = createProviderScopeObservation({
    provider: "matt-skills/v1",
    binding: { provider: "matt-skills/v1", nativeScope },
    observedAt: "2026-07-31T10:00:00.000Z",
    sourceRevision: "github:reference-revision",
    sourceObservedAt: "2026-07-31T10:00:00.000Z",
    validators: [],
    state: "available",
    freshness: {
      assessment: "current",
      evidence: [{ kind: "github-scope", value: nativeScope }],
    },
    coverage: {
      assessment: "complete",
      dimensions: [{ key: "scope", state: "covered" }],
    },
    completion: "incomplete",
    diagnostics: [],
    projection: createMattReferenceProjection("github"),
  });
  if (observation.projection?.map === undefined) throw new Error("Expected a GitHub Map.");
  const providerObservations = [
    ...base.providerObservations.filter(
      (candidate) => candidate.binding.nativeScope !== ".scratch/portal",
    ),
    observation,
  ];
  const providerObservationSelections = [
    ...base.providerObservationSelections.filter(
      (candidate) => candidate.nativeScope !== ".scratch/portal",
    ),
    {
      provider: "matt-skills/v1" as const,
      nativeScope,
      observationId: observation.id,
      effectiveFreshness: "current" as const,
      latestAttempt: null,
    },
  ];
  const sources = [
    ...base.sources.filter((source) => !source.displayLocator.startsWith(".scratch/portal")),
    ...buildMattNativeSourceRecords([observation], base.basis.sitemapFingerprint),
  ];
  const snapshot = withPreviewAsset(
    parseRebuiltPlanningLineageFixture({
      ...base,
      efforts: {
        ...base.efforts,
        items: base.efforts.items.map((effort) =>
          effort.id === "effort:portal"
            ? { ...effort, workBinding: { provider: "matt-skills/v1" as const, nativeScope } }
            : effort,
        ),
      },
      providerObservations,
      providerObservationSelections,
      sources,
    }),
  );
  return {
    snapshot,
    nativeScope: mattNativeScopeSubject(observation),
    nativeSubject: { kind: "native-subject", id: observation.projection.map.ref },
    nativeScopeTitle: "Contributing Work",
    nativeSubjectTitle: "Reference Map",
    standalone: standaloneObservation(
      "github",
      encodeGitHubMattNativeScope({
        host: "github.com",
        rootKind: "wayfinder-map",
        repository: {
          owner: "example",
          name: "standalone",
          databaseId: "9901",
          nodeId: "R_standalone",
        },
        root: {
          objectKind: "issue",
          number: 404,
          databaseId: "9911",
          nodeId: "I_standalone_404",
        },
      }),
    ),
  };
};

const degradedSnapshot = (snapshot: ProjectSnapshot): ProjectSnapshot => {
  if (snapshot.gates.validity !== "available" || snapshot.assets.validity !== "available") {
    throw new Error("Expected readable Gates and Assets.");
  }
  const candidate = {
    ...snapshot,
    gates: {
      validity: "partial" as const,
      items: snapshot.gates.items.filter((gate) => gate.id !== "gate:one"),
      issues: [
        {
          code: "invalid-gate",
          target: "gate:one",
          message: "The requested Gate became unavailable.",
        },
      ],
    },
    assets: {
      ...snapshot.assets,
      items: snapshot.assets.items.map((asset) => ({
        ...asset,
        evidenceRoles: asset.evidenceRoles.filter((role) => role !== "passage-evidence"),
        passageEvidence: asset.passageEvidence.filter((evidence) => evidence.gateId !== "gate:one"),
      })),
    },
  };
  return projectSnapshotSchema.parse(withRebuiltPlanningLineage(candidate as ProjectSnapshotInput));
};

const withEffortOutput = (snapshot: ProjectSnapshot): ProjectSnapshot => {
  if (snapshot.assets.validity === "invalid") throw new Error("Expected readable Assets.");
  return parseRebuiltPlanningLineageFixture({
    ...snapshot,
    assets: {
      ...snapshot.assets,
      items: snapshot.assets.items.map((asset) =>
        asset.id === "asset:planning-model-evidence" ? { ...asset, owner: "effort:model" } : asset,
      ),
    },
  });
};

const portalObservation = (snapshot: ProjectSnapshot) => {
  const binding =
    snapshot.efforts.validity === "invalid"
      ? undefined
      : snapshot.efforts.items.find((effort) => effort.id === "effort:portal")?.workBinding;
  const observation = snapshot.providerObservations.find(
    (candidate) => binding !== undefined && candidate.binding.nativeScope === binding.nativeScope,
  );
  if (
    binding === undefined ||
    observation === undefined ||
    (observation.state !== "available" && observation.state !== "partial")
  ) {
    throw new Error("Expected readable Portal observation.");
  }
  return { binding, observation };
};

const withDegradedEffortObservation = (
  snapshot: ProjectSnapshot,
  state: "partial" | "stale",
): ProjectSnapshot => {
  const { observation } = portalObservation(snapshot);
  const degraded = createProviderScopeObservation({
    ...observation,
    ...(state === "partial"
      ? {
          state: "partial" as const,
          coverage: {
            assessment: "incomplete" as const,
            dimensions: [{ key: "scope", state: "gap" as const }],
          },
        }
      : {
          freshness: { ...observation.freshness, assessment: "stale" as const },
        }),
  } as never) as typeof observation;
  return parseRebuiltPlanningLineageFixture({
    ...snapshot,
    providerObservations: snapshot.providerObservations.map((candidate) =>
      candidate.id === observation.id ? degraded : candidate,
    ),
    providerObservationSelections: snapshot.providerObservationSelections.map((selection) =>
      selection.observationId === observation.id
        ? {
            ...selection,
            observationId: degraded.id,
            effectiveFreshness: degraded.freshness.assessment,
          }
        : selection,
    ),
  });
};

const withoutEffortObservation = (
  snapshot: ProjectSnapshot,
  prior: "none" | "retained",
): ProjectSnapshot => {
  const { binding, observation } = portalObservation(snapshot);
  const failedSelection = {
    provider: "matt-skills/v1" as const,
    nativeScope: binding.nativeScope,
    observationId: prior === "retained" ? observation.id : null,
    effectiveFreshness: "undetermined" as const,
    latestAttempt: {
      intent: "native-scope-inspection" as const,
      attemptedAt: "2026-08-03T10:15:00.000Z",
      outcome: "failed" as const,
      diagnostics: [
        {
          code: "fixture.refresh-failed",
          impact: "blocking" as const,
          target: binding.nativeScope,
          message: "The exact work-details refresh failed.",
        },
      ],
    },
  };
  return parseRebuiltPlanningLineageFixture({
    ...snapshot,
    providerObservations: snapshot.providerObservations.filter(
      (candidate) => candidate.id !== observation.id,
    ),
    providerObservationSelections: snapshot.providerObservationSelections.map((selection) =>
      selection.observationId === observation.id
        ? { ...failedSelection, observationId: null }
        : selection,
    ),
    nativeScopeInspections:
      prior === "retained"
        ? { observations: [observation], selections: [failedSelection] }
        : { observations: [], selections: [] },
  });
};

const withInvalidEffortBinding = (snapshot: ProjectSnapshot): ProjectSnapshot => {
  if (snapshot.efforts.validity === "invalid") throw new Error("Expected readable Efforts.");
  return parseRebuiltPlanningLineageFixture({
    ...snapshot,
    efforts: {
      ...snapshot.efforts,
      items: snapshot.efforts.items.map((effort) =>
        effort.id === "effort:portal"
          ? {
              ...effort,
              workBinding: undefined,
              workBindingState: { state: "invalid" as const, reason: "missing" as const },
            }
          : effort,
      ),
    },
  });
};

const withEmptyCurrentWork = (snapshot: ProjectSnapshot): ProjectSnapshot => {
  const { observation } = portalObservation(snapshot);
  const empty = createProviderScopeObservation({
    ...observation,
    projection: {
      ...observation.projection,
      wayfinderTickets: [],
      deliveryTickets: [],
      incomingIssues: [],
      structuralOrder: [observation.projection.map?.ref, observation.projection.spec?.ref].filter(
        (reference) => reference !== undefined,
      ),
      graph: { parentChild: [], blockedBy: [] },
    },
  } as never) as typeof observation;
  return parseRebuiltPlanningLineageFixture({
    ...snapshot,
    providerObservations: snapshot.providerObservations.map((candidate) =>
      candidate.id === observation.id ? empty : candidate,
    ),
    providerObservationSelections: snapshot.providerObservationSelections.map((selection) =>
      selection.observationId === observation.id
        ? { ...selection, observationId: empty.id }
        : selection,
    ),
  });
};

const withMixedCurrentWork = (snapshot: ProjectSnapshot): ProjectSnapshot => {
  const { observation } = portalObservation(snapshot);
  const blockedTicket = observation.projection.wayfinderTickets.find(
    (ticket) => ticket.lifecycle.state === "open" && ticket.claim.state === "unclaimed",
  );
  const blockerTicket = observation.projection.wayfinderTickets.find(
    (ticket) => ticket.lifecycle.state === "open" && ticket.claim.state === "claimed",
  );
  if (blockedTicket === undefined || blockerTicket === undefined) {
    throw new Error("Expected reference tickets for the mixed Current Work fixture.");
  }
  const mixed = createProviderScopeObservation({
    ...observation,
    projection: {
      ...observation.projection,
      graph: {
        ...observation.projection.graph,
        blockedBy: [
          ...observation.projection.graph.blockedBy,
          {
            blocked: blockedTicket.ref,
            blocker: blockerTicket.ref,
            evidence: "matt-contract",
          },
        ],
      },
    },
  } as never) as typeof observation;
  return parseRebuiltPlanningLineageFixture({
    ...snapshot,
    providerObservations: snapshot.providerObservations.map((candidate) =>
      candidate.id === observation.id ? mixed : candidate,
    ),
    providerObservationSelections: snapshot.providerObservationSelections.map((selection) =>
      selection.observationId === observation.id
        ? { ...selection, observationId: mixed.id }
        : selection,
    ),
  });
};

const withConcludedOpenWork = (snapshot: ProjectSnapshot): ProjectSnapshot => {
  if (snapshot.efforts.validity === "invalid") throw new Error("Expected readable Efforts.");
  return parseRebuiltPlanningLineageFixture({
    ...snapshot,
    efforts: {
      ...snapshot.efforts,
      items: snapshot.efforts.items.map((effort) =>
        effort.id === "effort:portal"
          ? {
              ...effort,
              lifecycle: "concluded" as const,
              conclusion: {
                disposition: "completed" as const,
                rationale: "The Effort was concluded while retained native work remains open.",
                concludedAt: { availability: "unavailable" as const },
              },
            }
          : effort,
      ),
    },
  });
};

const withRefreshedEffortDetails = (snapshot: ProjectSnapshot): ProjectSnapshot => {
  const { binding, observation } = portalObservation(snapshot);
  const refreshed = createProviderScopeObservation({
    ...observation,
    observedAt: "2026-08-03T10:20:00.000Z",
    freshness: { ...observation.freshness, assessment: "current" },
  } as never) as typeof observation;
  return parseRebuiltPlanningLineageFixture({
    ...snapshot,
    nativeScopeInspections: {
      observations: [refreshed],
      selections: [
        {
          provider: "matt-skills/v1",
          nativeScope: binding.nativeScope,
          observationId: refreshed.id,
          effectiveFreshness: "current",
          latestAttempt: {
            intent: "native-scope-inspection",
            attemptedAt: "2026-08-03T10:20:00.000Z",
            outcome: "succeeded",
            diagnostics: [],
          },
        },
      ],
    },
  });
};

const withLongMixedLineageContent = (snapshot: ProjectSnapshot): ProjectSnapshot => {
  if (snapshot.gates.validity === "invalid" || snapshot.efforts.validity === "invalid") {
    throw new Error("Expected readable Gates and Efforts.");
  }
  return parseRebuiltPlanningLineageFixture({
    ...snapshot,
    gates: {
      ...snapshot.gates,
      items: snapshot.gates.items.map((gate) =>
        gate.id === "gate:two"
          ? {
              ...gate,
              title:
                "Overview proven through a deliberately long governance outcome that must reflow without squeezing adjacent Gate columns",
            }
          : gate,
      ),
    },
    efforts: {
      ...snapshot.efforts,
      items: snapshot.efforts.items.map((effort) =>
        effort.id === "effort:portal"
          ? {
              ...effort,
              intent:
                "恢复可信 managed planning context while preserving read-only governance boundaries and direct navigation.",
            }
          : effort,
      ),
    },
  });
};

const healthySnapshot = (snapshot: ProjectSnapshot): ProjectSnapshot =>
  projectSnapshotSchema.parse({
    ...snapshot,
    checks:
      snapshot.checks.validity === "available"
        ? {
            ...snapshot.checks,
            items: snapshot.checks.items.map((check) => ({ ...check, status: "resolved" })),
          }
        : snapshot.checks,
    reviews:
      snapshot.reviews.validity === "available"
        ? {
            ...snapshot.reviews,
            items: snapshot.reviews.items.map((review) => ({ ...review, status: "completed" })),
          }
        : snapshot.reviews,
    diagnostics: [],
    attention: [],
  });

const invalidSummarySnapshot = (snapshot: ProjectSnapshot): ProjectSnapshot =>
  projectSnapshotSchema.parse({
    ...snapshot,
    summary: {
      validity: "invalid",
      issues: [
        {
          code: "invalid-summary",
          target: ".bearing/state/project-summary.md",
          message: "Summary sections are malformed.",
        },
      ],
    },
  });

const viewportOverflow = async (page: Page) =>
  page.locator("body *").evaluateAll((elements) =>
    elements.flatMap((element) => {
      const bounds = element.getBoundingClientRect();
      return bounds.right > window.innerWidth + 0.5
        ? [{ tag: element.tagName, text: element.textContent?.trim().slice(0, 80) }]
        : [];
    }),
  );

const expectCalmOrdinarySurface = async (page: Page): Promise<void> => {
  const main = page.locator("main");
  await expect(main).not.toContainText(
    /Time unavailable|Quick Look|Discovered Work|Next Work Guidance|Selected context/u,
  );
  await expect(main).not.toContainText(/source:[0-9a-f]{64}/u);
  await expect(main).not.toContainText(/\.bearing\/state\//u);
  await expect(main).not.toContainText(/\b(?:roadmap|gate|effort|asset):[a-z0-9-]+\b/u);
  expect(await page.getByText("Read only", { exact: true }).count()).toBeLessThanOrEqual(1);
  expect(await viewportOverflow(page)).toEqual([]);
};

const sourceState = async (root: string): Promise<Readonly<Record<string, string>>> => {
  const bytes = await readRepositorySourceBytes(root);
  return Object.fromEntries(
    Object.entries(bytes).filter(
      ([locator]) => locator.startsWith(".bearing/state/") || locator.startsWith(".scratch/"),
    ),
  );
};

type Scenario = Readonly<{
  name: "Local" | "GitHub";
  snapshot: ProjectSnapshot;
  nativeScope: PlanningLineageSubject;
  nativeSubject: PlanningLineageSubject;
  nativeScopeTitle: string;
  nativeSubjectTitle: string;
  nativeScopeEvidence: string;
  standalone: ReturnType<typeof standaloneObservation>;
}>;

let host: RunningTestPortal | undefined;
let homeRoot = "";
let fixtureRoot = "";
let exactReconciliation: Awaited<ReturnType<typeof runHarnessCommand>> | undefined;
let sourcesBeforeExactReconciliation: Readonly<Record<string, string>> = {};
let sourcesAfterExactReconciliation: Readonly<Record<string, string>> = {};

test.beforeAll(async () => {
  fixtureRoot = await realpath(await copyPortalProjectFixture("G3 Comprehension Project"));
  homeRoot = await mkdtemp(join(tmpdir(), "bearing-g3-comprehension-browser-home-"));
  await mkdir(join(homeRoot, ".bearing"), { recursive: true });
  await mkdir(join(fixtureRoot, ".scratch/standalone/issues"), { recursive: true });
  await Promise.all([
    writeFile(
      join(fixtureRoot, ".scratch/standalone/map.md"),
      "# Wayfinder Map: Standalone Release Triage\n\nStatus: active\n\n## Destination\n\nRemain outside Bearing Scope.\n\n## Decisions so far\n\nNone.\n\n## Fog\n\nNone.\n",
    ),
    writeFile(
      join(fixtureRoot, ".scratch/standalone/issues/99-release-triage.md"),
      "# Unbound Standalone Release Triage\n\nType: task\n\nStatus: ready\n\n## Question\n\nCan native work remain outside Bearing Scope?\n",
    ),
  ]);
  await writeCatalogFixture(homeRoot, [
    { entryId, repoRoot: fixtureRoot, displayName: "G3 Comprehension Project" },
  ]);
  const commandEnvironment: NodeJS.ProcessEnv = { ...process.env, HOME: homeRoot };
  delete commandEnvironment["FORCE_COLOR"];
  const baseline = await runHarnessCommand(
    "node",
    ["dist/cli.js", "provider", "capture", "--repo", fixtureRoot, "--scope", ".scratch/work"],
    { environment: commandEnvironment, label: "G3 exact provider capture" },
  );
  if (baseline.exitCode !== 0) throw new Error(`G3 provider capture failed: ${baseline.stderr}`);
  sourcesBeforeExactReconciliation = await sourceState(fixtureRoot);
  exactReconciliation = await runHarnessCommand(
    "node",
    [
      "dist/cli.js",
      "reconcile-native",
      "--repo",
      fixtureRoot,
      "--scope",
      ".scratch/work",
      "--ref",
      ".scratch/work/issues/01-verify-isolation.md",
    ],
    { environment: commandEnvironment, label: "G3 exact native reconciliation" },
  );
  sourcesAfterExactReconciliation = await sourceState(fixtureRoot);
  host = await startBuiltPortal(homeRoot);
});

test.afterAll(async () => {
  await stopBuiltPortal(host);
  await Promise.all(
    [homeRoot, fixtureRoot]
      .filter((root) => root.length > 0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

test("G3 uses one parameterized comprehension contract journey for Local and GitHub", async ({
  context,
  page,
}) => {
  test.slow();
  if (host === undefined) throw new Error("Ticket 24 built Portal did not start.");
  await proveGitHubStandaloneExclusion();
  const local: Scenario = {
    name: "Local",
    snapshot: localSnapshot(),
    nativeScope: { kind: "native-scope", id: ".scratch/portal" },
    nativeSubject: {
      kind: "native-subject",
      id: ".scratch/portal/issues/02-review.md",
    },
    nativeScopeTitle: "Contributing Work",
    nativeSubjectTitle: "Review the Roadmap journey",
    nativeScopeEvidence: ".scratch/portal",
    standalone: standaloneObservation("local", ".scratch/standalone"),
  };
  const github = githubScenarioSnapshot();
  const scenarios: readonly Scenario[] = [
    local,
    {
      name: "GitHub",
      snapshot: github.snapshot,
      nativeScope: github.nativeScope,
      nativeSubject: github.nativeSubject,
      nativeScopeTitle: github.nativeScopeTitle,
      nativeSubjectTitle: github.nativeSubjectTitle,
      nativeScopeEvidence: "github-matt-v1:",
      standalone: github.standalone,
    },
  ];
  if (exactReconciliation?.exitCode !== 0) {
    throw new Error(
      `Exact reconciliation failed: ${exactReconciliation?.stderr ?? "missing result"}\n${exactReconciliation?.stdout ?? ""}`,
    );
  }
  expect(exactReconciliation?.stderr).toBe("");
  const reconciliationOutput = JSON.parse(exactReconciliation.stdout) as {
    outcome?: string;
    diagnostics?: unknown[];
    result?: { scopedDiagnosticCount?: number; acquisitionCount?: number };
  };
  expect(reconciliationOutput.outcome).toBe("complete");
  expect(reconciliationOutput.diagnostics).toEqual([]);
  expect(reconciliationOutput.result?.scopedDiagnosticCount).toBe(0);
  expect(reconciliationOutput.result?.acquisitionCount).toBe(1);
  expect(sourcesAfterExactReconciliation).toEqual(sourcesBeforeExactReconciliation);
  await page.goto(host.url);
  await page
    .getByRole("list", { name: "Registered Bearing projects" })
    .getByRole("link", { name: /G3 Comprehension Project/u })
    .click();
  await expect(page.getByRole("heading", { name: "Fixed Portal Project", level: 1 })).toBeVisible();
  const actualSnapshotResponse = await page.request.get(
    `${host.url}/api/v1/projects/${entryId}/read-model?section=overview`,
  );
  expect(actualSnapshotResponse.ok()).toBe(true);
  const actualSnapshotBody = JSON.stringify(await actualSnapshotResponse.json());
  expect(actualSnapshotBody).not.toContain("Unbound Standalone Release Triage");
  expect(actualSnapshotBody).not.toContain(".scratch/standalone");
  await expect(page.locator("main")).not.toContainText("Unbound Standalone Release Triage");
  await expect(page.getByRole("region", { name: "Attention" })).toHaveCount(0);
  const actualFind = page.getByRole("button", { name: "Find in project" });
  await actualFind.click();
  const actualFindDialog = page.getByRole("dialog", { name: "Find in project" });
  const actualSearchbox = actualFindDialog.getByRole("searchbox", {
    name: "Search identity, title, or semantic phrase",
  });
  await actualSearchbox.fill("Unbound Standalone Release Triage");
  await expect(actualFindDialog.getByRole("option")).toHaveCount(0);
  await actualSearchbox.fill(".scratch/standalone");
  await expect(actualFindDialog.getByRole("option")).toHaveCount(0);
  await page.keyboard.press("Escape");
  const reconciledNativeHref = planningLineageSubjectHref(entryId, {
    kind: "native-subject",
    id: ".scratch/work/issues/01-verify-isolation.md",
  });
  await page.goto(`${host.url}${reconciledNativeHref}`);
  await expect(
    page.getByRole("heading", { name: "Verify repository isolation", level: 1 }),
  ).toBeVisible();
  let activeSnapshot = local.snapshot;
  let refreshTarget = degradedSnapshot(local.snapshot);
  let providerTarget = withRefreshedEffortDetails(
    withDegradedEffortObservation(local.snapshot, "stale"),
  );
  let providerFails = false;
  const providerBodies: unknown[] = [];
  const posts: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST") posts.push(request.url());
  });
  await page.route(`**/api/v1/projects/${entryId}/read-model?section=*`, (route) => {
    return route.fulfill({
      json: projectRowEnvelope({
        snapshot: activeSnapshot,
        section: projectSectionFromRequest(route.request().url()),
        target: projectTargetFromRequest(route.request().url()),
        entryId,
        displayName: "G3 Comprehension Project",
      }),
    });
  });
  await page.route(`**/api/v1/projects/${entryId}/find?*`, (route) =>
    route.fulfill({
      json: projectFindEnvelope(
        activeSnapshot,
        entryId,
        new URL(route.request().url()).searchParams.get("query") ?? "",
      ),
    }),
  );
  await page.route(`**/api/v1/projects/${entryId}/provider-observation`, async (route) => {
    const body = route.request().postDataJSON() as {
      action: "item-refresh" | "source-load" | "all-sources-refresh";
    };
    providerBodies.push(body);
    await new Promise((resolve) => setTimeout(resolve, 150));
    if (providerFails) {
      return route.fulfill({
        json: {
          version: 1,
          state: "attention",
          action: body.action,
          condition: "provider-network",
          acquisitionCount: 1,
          observations: [],
          diagnostics: [
            {
              reference: "matt.github.acquisition.network",
              summary: "Provider observation needs Agent Surface attention.",
            },
          ],
          explanation: "The provider network was unavailable for this observation.",
          nextAction: "Open Bearing in the Agent Surface to diagnose provider connectivity.",
        },
      });
    }
    activeSnapshot = providerTarget;
    return route.fulfill({
      json: {
        version: 1,
        state: "completed",
        action: body.action,
        acquisitionCount: 1,
        observations: [],
        diagnostics: [],
      },
    });
  });
  const beforeSources = await sourceState(fixtureRoot);

  for (const scenario of scenarios) {
    activeSnapshot = scenario.snapshot;
    refreshTarget = degradedSnapshot(scenario.snapshot);
    providerFails = false;
    posts.length = 0;
    providerBodies.length = 0;
    const roadmapHref = planningLineageSubjectHref(entryId, {
      kind: "roadmap",
      id: "roadmap:portal",
    });
    const gateHref = planningLineageSubjectHref(entryId, {
      kind: "gate",
      id: "gate:two",
    });
    const agentExplanation = {
      question: "Can the current Portal journey be reviewed without changing its governed state?",
      answer:
        "Portal Evolution targets Overview proven. Web Portal Validation remains active, its provider completion is incomplete, and no Gate Passage is inferred from this reading.",
      optionalPortalLink: roadmapHref,
    } as const;
    expect(agentExplanation.answer).toContain("no Gate Passage");
    expect(agentExplanation.optionalPortalLink).toBe(roadmapHref);

    await page.goto(host.url);
    await page
      .getByRole("list", { name: "Registered Bearing projects" })
      .getByRole("link", { name: /G3 Comprehension Project/u })
      .click();
    await expect(page.getByRole("heading", { name: "Portal Project", level: 1 })).toBeVisible();
    expect(scenario.standalone.projection?.map?.title).toBe("Unbound Standalone Release Triage");
    expect(
      scenario.snapshot.providerObservations.some(
        (observation) => observation.id === scenario.standalone.id,
      ),
    ).toBe(false);
    expect(JSON.stringify(scenario.snapshot.attention)).not.toContain(
      "Unbound Standalone Release Triage",
    );
    if (scenario.name === "Local") {
      expect(
        Buffer.from(
          sourcesBeforeExactReconciliation[".scratch/standalone/issues/99-release-triage.md"] ?? "",
          "base64",
        ).toString("utf8"),
      ).toContain("Unbound Standalone Release Triage");
    }
    const attention = page.getByRole("region", { name: "Attention" });
    await expect(attention).toBeVisible();
    await expect(attention).toContainText("actionable project items");
    await expect(attention).not.toContainText("Unbound Standalone Release Triage");
    await expect(page.locator("main")).not.toContainText("Unbound Standalone Release Triage");
    await expect(page.getByRole("tab", { name: "Brief" })).toHaveAttribute("aria-selected", "true");
    if (scenario.name === "Local") {
      await expect(page.getByText("Project Brief has not been generated yet.")).toBeVisible();
    } else {
      await expect(
        page.getByText("Restore managed planning context without expanding Bearing Scope."),
      ).toBeVisible();
      await expect(page.getByText("Generated", { exact: true })).toBeVisible();
    }
    await page.getByRole("tab", { name: "Project Summary" }).click();
    await expect(page.getByText("Keep the whole project visible.", { exact: true })).toBeVisible();
    if (scenario.name === "Local") {
      await expect(page.getByText("Updated", { exact: true })).toHaveCount(0);
    }

    activeSnapshot = healthySnapshot(scenario.snapshot);
    await page.goto(`${host.url}/projects/${entryId}`);
    await expect(page.getByRole("region", { name: "Attention" })).toHaveCount(0);
    activeSnapshot = invalidSummarySnapshot(scenario.snapshot);
    await page.goto(`${host.url}/projects/${entryId}`);
    await page.getByRole("tab", { name: "Project Summary" }).click();
    await expect(page.getByRole("heading", { name: "Project Summary unavailable" })).toBeVisible();
    await expect(page.getByText("Summary sections are malformed.")).toBeVisible();
    activeSnapshot = scenario.snapshot;

    if (scenario.name === "Local") {
      await page.emulateMedia({ reducedMotion: "reduce" });
      const primaryDestinations = [
        `/projects/${entryId}`,
        `/projects/${entryId}/roadmaps`,
        `/projects/${entryId}/assets`,
        `/projects/${entryId}/audit`,
      ] as const;
      for (const width of [1280, 640, 375] as const) {
        await page.setViewportSize({ width, height: width === 375 ? 812 : 900 });
        for (const destination of primaryDestinations) {
          await page.goto(`${host.url}${destination}`);
          await expectCalmOrdinarySurface(page);
        }
      }
      await page.emulateMedia({ reducedMotion: "no-preference" });
    }

    activeSnapshot = withMixedCurrentWork(scenario.snapshot);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${host.url}${agentExplanation.optionalPortalLink}`);
    await expect(page).toHaveURL(`${host.url}${roadmapHref}`);
    await expect(page.getByRole("heading", { name: "Portal Evolution", level: 1 })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Canonical Parent Path" })).toBeVisible();
    const outcomeSpine = page.getByRole("region", { name: "Outcome Spine" });
    await expect(outcomeSpine).toBeVisible();
    const modelGateLink = outcomeSpine.getByRole("link", { name: "Model ready", exact: true });
    const overviewGateLink = outcomeSpine.getByRole("link", {
      name: "Overview proven",
      exact: true,
    });
    await expect(modelGateLink).toBeVisible();
    await expect(overviewGateLink).toBeVisible();
    await expect(outcomeSpine.getByRole("link", { name: "Planning Model" })).toBeVisible();
    await expect(outcomeSpine.getByRole("link", { name: "Web Portal Validation" })).toBeVisible();
    const modelGateBox = await modelGateLink.boundingBox();
    const overviewGateBox = await overviewGateLink.boundingBox();
    expect(modelGateBox).not.toBeNull();
    expect(overviewGateBox).not.toBeNull();
    expect(Math.abs((modelGateBox?.y ?? 0) - (overviewGateBox?.y ?? 0))).toBeLessThan(2);
    expect(overviewGateBox?.x ?? 0).toBeGreaterThan(modelGateBox?.x ?? 0);
    await page.reload();
    await expect(page).toHaveURL(`${host.url}${roadmapHref}`);
    await expect(page.getByRole("heading", { name: "Portal Evolution", level: 1 })).toBeVisible();

    await page.locator(`a[href="${gateHref}"]`).first().click();
    await expect(page).toHaveURL(`${host.url}${gateHref}`);
    await expect(page.getByRole("heading", { name: "Overview proven", level: 1 })).toBeVisible();
    const technicalDetailsTrigger = page.getByRole("button", { name: "Open Technical Details" });
    await technicalDetailsTrigger.focus();
    await page.keyboard.press("Enter");
    const technicalDetails = page.getByRole("complementary", { name: "Technical Details" });
    await expect(technicalDetails).toBeVisible();
    await expect(technicalDetails.getByText("gate:two", { exact: true })).toBeVisible();
    await expect(technicalDetails).not.toContainText("Prove Overview comprehension.");
    await page.keyboard.press("Escape");
    await expect(technicalDetails).toHaveCount(0);
    await expect(technicalDetailsTrigger).toBeFocused();
    await expect(
      page.getByRole("heading", { name: "Contributing Efforts", level: 2 }),
    ).toBeVisible();
    const effortLink = page.getByRole("link", { name: "Web Portal Validation", exact: true });
    await effortLink.click();
    const effortHref = planningLineageSubjectHref(entryId, {
      kind: "effort",
      id: "effort:portal",
    });
    await expect(page).toHaveURL(`${host.url}${effortHref}`);
    await expect(
      page.getByRole("heading", { name: "Web Portal Validation", level: 1 }),
    ).toBeVisible();
    await expect(page.getByText("Effort", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Active", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Healthy", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Intent", level: 2 })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Current Work", level: 2 })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Planning Basis", level: 2 })).toBeVisible();
    await expect(page.getByText("Map", { exact: true })).toBeVisible();
    await expect(page.getByText("PRD / Spec", { exact: true })).toBeVisible();
    await expect(page.getByText("Claimed", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Ready", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Blocked", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Load source" })).toBeVisible();
    await expectCalmOrdinarySurface(page);
    const targetGateReturn = page
      .getByRole("link", { name: "Overview proven", exact: true })
      .last();
    await expect(targetGateReturn).toHaveAttribute("href", gateHref);
    await targetGateReturn.click();
    await expect(page).toHaveURL(`${host.url}${gateHref}`);
    await expect(page.getByRole("heading", { name: "Overview proven", level: 1 })).toBeVisible();
    const gateBreadcrumb = page.getByRole("navigation", { name: "Canonical Parent Path" });
    await gateBreadcrumb.getByRole("link", { name: "Portal Evolution", exact: true }).click();
    await expect(page).toHaveURL(`${host.url}${roadmapHref}`);
    await expect(page.getByRole("heading", { name: "Portal Evolution", level: 1 })).toBeVisible();
    await page.goto(`${host.url}${effortHref}`);

    activeSnapshot = withEmptyCurrentWork(scenario.snapshot);
    await page.goto(`${host.url}${effortHref}`);
    await expect(
      page.getByText("No nonterminal managed work is established by this observation."),
    ).toBeVisible();

    activeSnapshot = withConcludedOpenWork(scenario.snapshot);
    await page.goto(`${host.url}${effortHref}`);
    await expect(page.getByText("Concluded", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "Outcome", level: 2 })).toBeVisible();
    await expect(
      page.getByText(
        "This Effort is concluded, but nonterminal managed work remains in the bound scope.",
        { exact: true },
      ),
    ).toBeVisible();

    activeSnapshot = scenario.snapshot;

    const concludedEffortHref = planningLineageSubjectHref(entryId, {
      kind: "effort",
      id: "effort:model",
    });
    await page.goto(`${host.url}${concludedEffortHref}`);
    await expect(page.getByRole("heading", { name: "Planning Model", level: 1 })).toBeVisible();
    await expect(page.getByText("Concluded", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "Outcome", level: 2 })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Planning Basis", level: 2 })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Outputs", level: 2 })).toBeVisible();
    await expect(
      page.locator('[id="effort.outputs"]').getByText("Planning Model Evidence", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Governance & References", level: 2 }),
    ).toBeVisible();
    await expect(page.locator("main")).not.toContainText("Time unavailable");

    activeSnapshot = withDegradedEffortObservation(scenario.snapshot, "partial");
    await page.goto(`${host.url}${effortHref}`);
    await expect(
      page.getByText("Managed work coverage is partial", { exact: false }),
    ).toBeVisible();
    await expect(
      page.getByLabel("Effort governance status").getByText("Needs attention", { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "Current Work", level: 2 })).toBeVisible();
    await expect(page.getByRole("button", { name: "Load source" })).toBeVisible();

    const staleSnapshot = withDegradedEffortObservation(scenario.snapshot, "stale");
    activeSnapshot = staleSnapshot;
    providerTarget = withRefreshedEffortDetails(staleSnapshot);
    await page.goto(`${host.url}${effortHref}`);
    await expect(page.getByText("Managed work details are stale", { exact: false })).toHaveCount(1);
    await expect(page.getByText("Last verified", { exact: true })).toBeVisible();
    const loadSource = page.getByRole("button", { name: "Load source" });
    const syncPostsBeforeRefresh = posts.filter((url) => url.endsWith("/sync")).length;
    const successClick = loadSource.click();
    await expect(page.getByRole("button", { name: "Observing source" })).toBeDisabled();
    await successClick;
    await expect(page.locator(".provider-observation-status")).toContainText(
      "1 provider source observed",
    );
    await expect(loadSource).toBeFocused();
    expect(providerBodies.at(-1)).toEqual({
      version: 1,
      action: "source-load",
      binding: {
        provider: "matt-skills/v1",
        nativeScope: portalObservation(staleSnapshot).binding.nativeScope,
      },
    });
    expect(posts.filter((url) => url.endsWith("/sync"))).toHaveLength(syncPostsBeforeRefresh);

    activeSnapshot = withoutEffortObservation(scenario.snapshot, "retained");
    providerFails = true;
    await page.goto(`${host.url}${effortHref}`);
    await expect(page.getByText("Latest refresh failed", { exact: false })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Current Work", level: 2 })).toBeVisible();
    await expect(page.getByText("Last verified", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Load source" }).click();
    await expect(page.getByText("Latest refresh failed", { exact: false })).toBeVisible();
    await expect(page.locator(".provider-observation-status")).toContainText(
      "provider network was unavailable",
    );
    await expect(page.getByRole("button", { name: "Load source" })).toBeFocused();

    activeSnapshot = withoutEffortObservation(scenario.snapshot, "none");
    providerFails = false;
    await page.goto(`${host.url}${effortHref}`);
    await expect(
      page.getByText("Managed work details are unavailable", { exact: false }),
    ).toBeVisible();
    await expect(page.getByText("Managed work needs attention", { exact: false })).toBeVisible();
    await expect(page.locator("main")).not.toContainText("0 items");

    activeSnapshot = withInvalidEffortBinding(scenario.snapshot);
    await page.goto(`${host.url}${effortHref}`);
    await expect(
      page.getByText("this Effort has no declared Work Binding", { exact: false }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Load source" })).toHaveCount(0);
    await expect(page.locator("main")).not.toContainText("Not bound");

    activeSnapshot = scenario.snapshot;
    if (scenario.name === "Local") {
      activeSnapshot = withLongMixedLineageContent(scenario.snapshot);
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto(`${host.url}${roadmapHref}`);
      const longOutcomeLink = page.getByRole("link", {
        name: "Overview proven through a deliberately long governance outcome that must reflow without squeezing adjacent Gate columns",
      });
      const longModelGateLink = page.getByRole("link", { name: "Model ready", exact: true });
      const longModelGateBox = await longModelGateLink.boundingBox();
      const longOutcomeBox = await longOutcomeLink.boundingBox();
      expect(longModelGateBox).not.toBeNull();
      expect(longOutcomeBox).not.toBeNull();
      expect(longOutcomeBox?.y ?? 0).toBeGreaterThan(longModelGateBox?.y ?? 0);
      await longOutcomeLink.focus();
      await page.keyboard.press("Enter");
      await expect(page.getByText("Milestone Gate", { exact: true })).toBeVisible();
      const exitCriteria = page.getByRole("heading", { name: "Exit Criteria", level: 2 });
      const exitSectionSpacing = await exitCriteria.evaluate((heading) => {
        const section = heading.closest("section");
        if (section === null) throw new Error("Expected Exit Criteria section.");
        const style = getComputedStyle(section);
        return {
          top: Number.parseFloat(style.paddingTop),
          bottom: Number.parseFloat(style.paddingBottom),
        };
      });
      expect(exitSectionSpacing.top).toBeGreaterThanOrEqual(24);
      expect(exitSectionSpacing.bottom).toBeGreaterThanOrEqual(24);
      await page.goto(`${host.url}${effortHref}`);
      await expect(
        page.getByText(
          "恢复可信 managed planning context while preserving read-only governance boundaries and direct navigation.",
          { exact: true },
        ),
      ).toBeVisible();
      await expect(page.getByLabel("Effort governance status")).toHaveCSS(
        "border-top-style",
        "solid",
      );
      await expect(page.getByText("Effort", { exact: true }).first()).toBeVisible();

      await page.setViewportSize({ width: 375, height: 812 });
      await page.goto(`${host.url}${roadmapHref}`);
      expect(await viewportOverflow(page)).toEqual([]);
      const narrowModelGateBox = await page
        .getByRole("link", { name: "Model ready", exact: true })
        .boundingBox();
      const narrowOutcomeBox = await page
        .getByRole("link", {
          name: "Overview proven through a deliberately long governance outcome that must reflow without squeezing adjacent Gate columns",
        })
        .boundingBox();
      expect(narrowModelGateBox).not.toBeNull();
      expect(narrowOutcomeBox).not.toBeNull();
      expect(narrowOutcomeBox?.y ?? 0).toBeGreaterThan(narrowModelGateBox?.y ?? 0);
      await page.setViewportSize({ width: 640, height: 900 });
      await page.goto(`${host.url}${effortHref}`);
      await page.locator("body").evaluate((body) => {
        body.style.zoom = "2";
      });
      expect(await viewportOverflow(page)).toEqual([]);
      await page.locator("body").evaluate((body) => {
        body.style.zoom = "";
      });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await expect(
        page.getByLabel("Effort governance status").getByText("Needs attention", { exact: true }),
      ).toHaveCount(0);
      await page.emulateMedia({ reducedMotion: "no-preference" });
      activeSnapshot = scenario.snapshot;
    }

    const scopeHref = planningLineageSubjectHref(entryId, scenario.nativeScope);
    await page.goto(`${host.url}${scopeHref}`);
    await expect(page).toHaveURL(
      `${host.url}${planningLineageSubjectHref(entryId, scenario.nativeScope)}`,
    );
    await expect(
      page.getByRole("heading", { name: scenario.nativeScopeTitle, level: 1 }),
    ).toBeVisible();
    const subjectLink = page.getByRole("link", { name: scenario.nativeSubjectTitle, exact: true });
    if ((await subjectLink.count()) === 1) await subjectLink.click();
    else
      await page.goto(`${host.url}${planningLineageSubjectHref(entryId, scenario.nativeSubject)}`);
    await expect(page).toHaveURL(
      `${host.url}${planningLineageSubjectHref(entryId, scenario.nativeSubject)}`,
    );
    await expect(
      page.getByRole("heading", { name: scenario.nativeSubjectTitle, level: 1 }),
    ).toBeVisible();
    await expect(page.getByLabel("Lineage Context")).toBeVisible();

    await page.goto(`${host.url}/projects/${entryId}/audit`);
    await expect(page.getByRole("heading", { name: "Planning Audit", level: 1 })).toBeVisible();
    await expect(page.getByRole("heading", { name: "No findings" })).toBeVisible();
    await expect(page.getByText("Audit is advisory", { exact: false })).toHaveCount(1);

    await page.goto(`${host.url}/projects/${entryId}/assets`);
    const find = page.getByRole("button", { name: "Find in project" });
    await find.focus();
    await page.keyboard.press("Enter");
    const findDialog = page.getByRole("dialog", { name: "Find in project" });
    const searchbox = findDialog.getByRole("searchbox", {
      name: "Search identity, title, or semantic phrase",
    });
    await expect(searchbox).toBeFocused();
    await searchbox.fill("whole-project orientation");
    const result = findDialog.getByRole("option").filter({ hasText: "Portal Evolution" }).first();
    await expect(result).toContainText("Prove whole-project orientation.");
    await expect(result).not.toContainText("Intent");
    await expect(result).toContainText("Roadmap");
    await searchbox.fill("Unbound Standalone Release Triage");
    await expect(findDialog.getByRole("option")).toHaveCount(0);
    await searchbox.fill(scenario.standalone.binding.nativeScope);
    await expect(findDialog.getByRole("option")).toHaveCount(0);
    await searchbox.fill("whole-project orientation");
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.keyboard.press("Escape");
    await expect(find).toBeFocused();
    await find.press("Enter");
    await findDialog
      .getByRole("searchbox", {
        name: "Search identity, title, or semantic phrase",
      })
      .fill("roadmap:portal");
    const identityResult = findDialog
      .getByRole("option")
      .filter({ hasText: "Portal Evolution" })
      .first();
    await expect(identityResult).not.toContainText("roadmap:portal");
    await expect(identityResult).not.toContainText("Identity");
    await identityResult.click();
    await expect(page).toHaveURL(/roadmap%3Aportal/);

    const anchoredRoadmap = `${roadmapHref}#roadmap.intent`;
    await page.goto(`${host.url}${anchoredRoadmap}`);
    await expect(page.locator("#roadmap\\.intent")).toBeInViewport();
    await expect(page.getByRole("heading", { name: "Portal Evolution", level: 1 })).toBeVisible();

    await page.goto(`${host.url}/projects/${entryId}/assets`);
    const evidenceFilter = page.getByRole("combobox", { name: "Evidence", exact: true });
    await evidenceFilter.selectOption("cited");
    const assetRow = page.getByRole("link", { name: /Planning Model Evidence/u });
    await assetRow.scrollIntoViewIfNeeded();
    await assetRow.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(
      `${host.url}${planningLineageSubjectHref(entryId, {
        kind: "asset",
        id: "asset:planning-model-evidence",
      })}`,
    );
    await page.goBack();
    await expect(evidenceFilter).toHaveValue("cited");

    await page.getByRole("combobox", { name: "Evidence", exact: true }).selectOption("all");
    const uncitedAsset = page.getByRole("link", { name: /Uncited Fixture Evidence/u });
    if (scenario.name === "Local") {
      await expect(uncitedAsset).toHaveAccessibleName(/Review the Roadmap journey/u);
    }
    await uncitedAsset.click();
    if (scenario.name === "Local") {
      const nativeOwner = page.getByRole("link", {
        name: "Review the Roadmap journey",
        exact: true,
      });
      await expect(nativeOwner).toBeVisible();
      await expect(nativeOwner.locator("xpath=..")).toContainText(
        "Owner: Ticket: Review the Roadmap journey",
      );
      await expect(
        page.getByRole("link", {
          name: "Build the Roadmap journey",
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        page
          .getByRole("link", { name: "Build the Roadmap journey", exact: true })
          .locator("xpath=.."),
      ).toContainText("Produced For: Ticket: Build the Roadmap journey");
      await expect(page.getByText(/\.scratch\/portal\/issues\//u)).toHaveCount(0);
      await expect(page.locator("#relation\\.production\\.owner")).toHaveCount(0);
      await expect(page.locator("#relation\\.production\\.produced-for")).toHaveCount(0);
      await nativeOwner.click();
      await expect(page).toHaveURL(
        `${host.url}${planningLineageSubjectHref(entryId, {
          kind: "native-subject",
          id: ".scratch/portal/issues/02-review.md",
        })}`,
      );
      await page.goBack();
    }
    const previewTab = context.waitForEvent("page");
    await page.getByRole("link", { name: /View Content/u }).click();
    const previewPage = await previewTab;
    await expect(
      previewPage.getByRole("heading", { name: "Uncited Fixture Evidence" }),
    ).toBeVisible();
    await expect(previewPage.getByText("current-checkout content", { exact: false })).toBeVisible();
    await expect(
      previewPage.getByRole("button", { name: "Return to Asset detail" }),
    ).toHaveAttribute(
      "data-bearing-return-href",
      planningLineageSubjectHref(entryId, {
        kind: "asset",
        id: "asset:fixture-uncited",
      }),
    );
    await previewPage.close();
    await expect(page).toHaveURL(
      `${host.url}${planningLineageSubjectHref(entryId, {
        kind: "asset",
        id: "asset:fixture-uncited",
      })}`,
    );

    await page.goto(`${host.url}/projects/${entryId}/assets`);
    await page.setViewportSize({ width: 375, height: 812 });
    expect(
      await page.locator("html").evaluate((element) => element.scrollWidth > element.clientWidth),
    ).toBe(false);
    expect(await viewportOverflow(page)).toEqual([]);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

    for (const [destination, heading] of [
      [`/projects/${entryId}`, "Portal Project"],
      [roadmapHref, "Portal Evolution"],
      [gateHref, "Overview proven"],
      [`/projects/${entryId}/audit`, "Planning Audit"],
    ] as const) {
      await page.goto(`${host.url}${destination}`);
      await expect(page.getByRole("heading", { name: heading, level: 1 })).toBeVisible();
      expect(await viewportOverflow(page)).toEqual([]);
    }

    const degradedGateHref = planningLineageSubjectHref(entryId, {
      kind: "gate",
      id: "gate:one",
    });
    await page.goto(`${host.url}${degradedGateHref}`);
    activeSnapshot = refreshTarget;
    await page.reload();
    await expect(page.getByRole("heading", { name: "Gate unavailable", level: 1 })).toBeVisible();
    await expect(
      page.getByText("Partial collection coverage cannot establish", { exact: false }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Return to project Overview" })).toBeVisible();
    expect(posts.filter((url) => url.endsWith("/sync"))).toEqual([]);
  }

  expect(await sourceState(fixtureRoot)).toEqual(beforeSources);
});
