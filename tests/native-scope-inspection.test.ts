import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  createNativeScopeDiscoveryObservation,
  type DiscoveredNativeScope,
  NATIVE_SCOPE_DISCOVERY_PROVIDER,
  type NativeScopeDiscoveryObservation,
} from "../src/native-scope-discovery";
import type { NativeScopeDiscoveryProviderFactory } from "../src/native-scope-discovery-acquisition";
import { readNativeScopeInspectionStore } from "../src/native-scope-inspection";
import { createProviderScopeObservation } from "../src/native-work-provider";
import { PlanningLineagePage } from "../src/portal-ui/planning-lineage-page";
import { buildProjectOverviewModel } from "../src/portal-ui/project-overview-model";
import { findPlanningLineageSubjectProjection } from "../src/project-snapshot/planning-lineage";
import { nativeScopeInspectionProjectionSchema } from "../src/project-snapshot/schema-native-scope-inspection";
import type { MattProviderFactory } from "../src/provider-observation-acquisition";
import { ProviderObservationAcquisitionUnavailableError } from "../src/provider-observation-store";
import { encodeGitHubMattNativeScope } from "../src/providers/matt-skills-v1/github-native-scope";
import { commitSyncPlan, prepareSync } from "../src/sync-plan";
import { createMattReferenceProjection } from "./fixtures/matt-reference-scenario";
import { buildSnapshotForSyncPlan, createValidBearingRepo, writeFixture } from "./helpers";

const scope = (nativeScope: string, title = `Scope ${nativeScope}`): DiscoveredNativeScope => ({
  identity: nativeScope,
  binding: { provider: "matt-skills/v1", nativeScope },
  locator: nativeScope,
  driver: "local",
  rootRole: "wayfinder-map",
  title,
  lifecycle: "open",
  classification: "map",
  admission: ["contract-root"],
  subjects: [
    {
      identity: `${nativeScope}/map.md`,
      locator: `${nativeScope}/map.md`,
      title: `${title} Map`,
      classification: "map",
      lifecycle: "open",
      parentIdentity: null,
      admission: ["contract-map"],
    },
    {
      identity: `${nativeScope}/issues/01-work.md`,
      locator: `${nativeScope}/issues/01-work.md`,
      title: `${title} Work`,
      classification: "wayfinder",
      lifecycle: "open",
      parentIdentity: `${nativeScope}/map.md`,
      admission: ["contract-ticket"],
    },
  ],
});

const discoveryObservation = (
  scopes: readonly DiscoveredNativeScope[],
  observedAt: string,
): NativeScopeDiscoveryObservation =>
  createNativeScopeDiscoveryObservation({
    provider: NATIVE_SCOPE_DISCOVERY_PROVIDER,
    state: "available",
    observedAt,
    sourceRevision: `fixture:${observedAt}`,
    freshness: "current",
    coverage: "complete",
    scopes,
    diagnostics: [],
  });

const discoveryFactory =
  (observation: NativeScopeDiscoveryObservation): NativeScopeDiscoveryProviderFactory =>
  () => ({
    id: NATIVE_SCOPE_DISCOVERY_PROVIDER,
    discover: async () => observation,
  });

const providerFactory =
  (
    calls: { count: number; capturedLocators: string[][] },
    observedAt: string,
    state: "available" | "partial" = "available",
  ): MattProviderFactory =>
  (input) => ({
    id: "matt-skills/v1",
    capture: async (binding) => {
      calls.count += 1;
      calls.capturedLocators.push([...input.capturedDocuments.keys()].sort());
      const projection = JSON.parse(
        JSON.stringify(createMattReferenceProjection("local"))
          .replaceAll(".scratch/reference", binding.nativeScope)
          .replaceAll("local:opaque", `local:${binding.nativeScope}`),
      ) as ReturnType<typeof createMattReferenceProjection>;
      return createProviderScopeObservation({
        provider: "matt-skills/v1",
        binding,
        observedAt,
        sourceRevision: `fixture:${observedAt}`,
        validators: [{ kind: "fixture", value: observedAt }],
        state,
        freshness: {
          assessment: "current",
          evidence: [{ kind: "fixture", value: "native-scope-inspection" }],
        },
        coverage: {
          assessment: state === "available" ? "complete" : "incomplete",
          dimensions: [
            {
              key: "scope-membership",
              state: state === "available" ? "covered" : "gap",
            },
          ],
        },
        completion: state === "available" ? "complete" : "undetermined",
        diagnostics:
          state === "available"
            ? []
            : [
                {
                  code: "fixture.partial",
                  class: "acquisition",
                  impact: "blocking",
                  target: binding.nativeScope,
                  message: "The fixture inspection is partial.",
                },
              ],
        projection,
      });
    },
  });

const writeScope = async (root: string, nativeScope: string): Promise<void> => {
  await writeFixture(
    root,
    `${nativeScope}/map.md`,
    `# Wayfinder Map: ${nativeScope}\n\nStatus: active\n\n## Destination\n\nInspect one target.\n`,
  );
  await writeFixture(
    root,
    `${nativeScope}/issues/01-work.md`,
    "# Work\n\nType: task\n\nStatus: claimed\n\nClaimed by: fixture-agent\n\n## Question\n\nInspect this work.\n",
  );
};

const publishDiscovery = async (root: string, observation: NativeScopeDiscoveryObservation) => {
  const plan = await prepareSync(root, {
    nativeScopeDiscoveryIntent: "explicit-discovery",
    nativeScopeDiscoveryProviderFactory: discoveryFactory(observation),
  });
  await commitSyncPlan(plan);
  return plan;
};

test("ordinary Sync and Discovery Sync never inspect, while explicit detail acquires only its target", async () => {
  const root = await createValidBearingRepo();
  await writeScope(root, ".scratch/unbound");
  await writeScope(root, ".scratch/other");
  const scopes = [scope(".scratch/unbound"), scope(".scratch/other")];
  const discovery = await publishDiscovery(
    root,
    discoveryObservation(scopes, "2026-07-31T01:00:00.000Z"),
  );

  expect(discovery.nativeScopeInspectionOperation).toEqual({
    intent: { kind: "none" },
    outcome: "not-requested",
    acquisitionCount: 0,
  });
  expect(await readNativeScopeInspectionStore(root)).toEqual({ kind: "missing" });

  const misdirectedCalls = { count: 0, capturedLocators: [] as string[][] };
  const misdirected = await prepareSync(root, {
    nativeScopeInspectionIntent: {
      kind: "inspect",
      subject: { kind: "native-scope", id: ".scratch/unbound" },
      target: { provider: "matt-skills/v1", nativeScope: ".scratch/other" },
      refresh: false,
    },
    providerFactory: providerFactory(misdirectedCalls, "2026-07-31T01:04:00.000Z"),
  });
  expect(misdirected.nativeScopeInspectionOperation).toMatchObject({
    outcome: "target-unavailable",
    acquisitionCount: 0,
  });
  expect(misdirectedCalls.count).toBe(0);

  const calls = { count: 0, capturedLocators: [] as string[][] };
  const inspected = await prepareSync(root, {
    nativeScopeInspectionIntent: {
      kind: "inspect",
      subject: { kind: "native-scope", id: ".scratch/unbound" },
      target: { provider: "matt-skills/v1", nativeScope: ".scratch/unbound" },
      refresh: false,
    },
    providerFactory: providerFactory(calls, "2026-07-31T01:05:00.000Z"),
    providerObservationNow: () => "2026-07-31T01:05:00.000Z",
  });

  expect(inspected.nativeScopeInspectionOperation).toMatchObject({
    outcome: "acquired",
    acquisitionCount: 1,
  });
  expect(inspected.metrics.nativeScopeInspectionAcquisitionCount).toBe(1);
  expect(calls.count).toBe(1);
  expect(calls.capturedLocators[0]).toEqual(
    expect.arrayContaining([".scratch/unbound/map.md", ".scratch/unbound/issues/01-work.md"]),
  );
  expect(calls.capturedLocators[0]).not.toEqual(expect.arrayContaining([".scratch/other/map.md"]));
  expect(inspected.nativeScopeInspectionSelections[0]).toMatchObject({
    nativeScope: ".scratch/unbound",
    effectiveFreshness: "current",
    latestAttempt: {
      intent: "native-scope-inspection",
      outcome: "succeeded",
    },
  });
  expect(inspected.planningGraph.planningProjection().providerObservations).toEqual([]);
  const snapshot = await buildSnapshotForSyncPlan(root, "0.0.0-test", inspected);
  expect(snapshot.providerObservations).toEqual([]);
  expect(snapshot.nativeScopeInspections.observations).toHaveLength(1);
  expect(
    snapshot.nativeScopeDiscovery.state === "never-run"
      ? undefined
      : snapshot.nativeScopeDiscovery.scopes.map((candidate) => ({
          nativeScope: candidate.summary.binding.nativeScope,
          detailAvailability: candidate.detailAvailability,
        })),
  ).toEqual([
    { nativeScope: ".scratch/unbound", detailAvailability: "details-inspected" },
    { nativeScope: ".scratch/other", detailAvailability: "summary-only" },
  ]);
});

test("ordinary Sync retains an unresolved canonical binding route in Lineage and Attention", async () => {
  const root = await createValidBearingRepo();
  const plan = await prepareSync(root);
  const snapshot = await buildSnapshotForSyncPlan(root, "0.0.0-test", plan);
  const effort = findPlanningLineageSubjectProjection(snapshot.lineage, {
    kind: "effort",
    id: "effort:test",
  });
  expect(effort?.nativeWorkReadingState).toMatchObject({
    conclusion: "Binding needs attention",
    binding: {
      state: "attention",
      reason: "bound-unresolved",
      effortIds: ["effort:test"],
    },
  });
  const bindingRelation = effort?.relations.find(
    (relation) => relation.key === "native-work.binding",
  );
  expect(
    bindingRelation?.state === "present" ? bindingRelation.targets[0] : undefined,
  ).toMatchObject({
    availability: "unavailable",
    subject: { kind: "native-scope", id: ".scratch/work" },
  });
  expect(
    snapshot.gates.validity === "invalid"
      ? undefined
      : snapshot.gates.items.find((gate) => gate.id === "gate:test")?.readiness,
  ).toBe("unknown");
  expect(
    buildProjectOverviewModel(snapshot).attention.some(
      (item) =>
        item.nativeSubject?.kind === "native-scope" && item.nativeSubject.id === ".scratch/work",
    ),
  ).toBe(true);
});

test("ordinary Sync canonicalizes a GitHub binding route without provider evidence", async () => {
  const root = await createValidBearingRepo();
  const effortPath = join(root, ".bearing/state/efforts/test.md");
  const effort = await readFile(effortPath, "utf8");
  const nativeScope = encodeGitHubMattNativeScope({
    host: "github.com",
    rootKind: "wayfinder-map",
    repository: {
      owner: "example",
      name: "delivery",
      databaseId: "1",
      nodeId: "R_binding",
    },
    root: {
      objectKind: "issue",
      number: 18,
      databaseId: "18",
      nodeId: "I_binding",
    },
  });
  await writeFixture(
    root,
    ".bearing/state/efforts/test.md",
    effort.replace("Native scope: .scratch/work", `Native scope: ${nativeScope}`),
  );

  const plan = await prepareSync(root);
  const snapshot = await buildSnapshotForSyncPlan(root, "0.0.0-test", plan);
  const expectedSubject = { kind: "native-scope", id: "github:R_binding:I_binding" } as const;
  const effortSubject = findPlanningLineageSubjectProjection(snapshot.lineage, {
    kind: "effort",
    id: "effort:test",
  });
  const bindingRelation = effortSubject?.relations.find(
    (relation) => relation.key === "native-work.binding",
  );

  expect(
    bindingRelation?.state === "present" ? bindingRelation.targets[0]?.subject : undefined,
  ).toEqual(expectedSubject);
  expect(
    buildProjectOverviewModel(snapshot).attention.some(
      (item) =>
        item.nativeSubject?.kind === expectedSubject.kind &&
        item.nativeSubject.id === expectedSubject.id,
    ),
  ).toBe(true);
});

test("a first partial inspection remains a failed attempt without selecting untrusted detail", async () => {
  const root = await createValidBearingRepo();
  await writeScope(root, ".scratch/unbound");
  await publishDiscovery(
    root,
    discoveryObservation([scope(".scratch/unbound")], "2026-07-31T01:30:00.000Z"),
  );
  const calls = { count: 0, capturedLocators: [] as string[][] };
  const plan = await prepareSync(root, {
    nativeScopeInspectionIntent: {
      kind: "inspect",
      subject: { kind: "native-scope", id: ".scratch/unbound" },
      target: { provider: "matt-skills/v1", nativeScope: ".scratch/unbound" },
      refresh: false,
    },
    providerFactory: providerFactory(calls, "2026-07-31T01:35:00.000Z", "partial"),
  });

  expect(plan.nativeScopeInspectionOperation.outcome).toBe("unavailable");
  expect(plan.nativeScopeInspectionObservations).toEqual([]);
  expect(plan.nativeScopeInspectionSelections[0]).toMatchObject({
    observationId: null,
    effectiveFreshness: "undetermined",
    latestAttempt: { outcome: "failed" },
  });
  const snapshot = await buildSnapshotForSyncPlan(root, "0.0.0-test", plan);
  expect(
    snapshot.nativeScopeDiscovery.state === "never-run"
      ? undefined
      : snapshot.nativeScopeDiscovery.scopes[0]?.detailAvailability,
  ).toBe("summary-only");
});

test("a binding conflict withholds only its contributing Gate readiness", async () => {
  const root = await createValidBearingRepo();
  const gatePath = join(root, ".bearing/state/milestone-gates/test.md");
  const gate = await readFile(gatePath, "utf8");
  await writeFixture(
    root,
    ".bearing/state/milestone-gates/test.md",
    gate.replace(
      "Effort order:\n  - effort:test",
      "Effort order:\n  - effort:duplicate\n  - effort:test",
    ),
  );
  await writeFixture(
    root,
    ".bearing/state/efforts/duplicate.md",
    `---
Type: effort
ID: effort:duplicate
Title: Duplicate Scope
Roadmap: roadmap:test
Target gate: gate:test
Authorities: []
Citations: []
Lifecycle: active
Planned at: null
Activated at: null
Work binding:
  Provider: matt-skills/v1
  Native scope: .scratch/work
---

# Effort: Duplicate Scope

## Intent

Prove conflict isolation.

## Work

- Reuse the same native scope.
`,
  );
  await writeFixture(
    root,
    ".bearing/state/roadmap-index.md",
    `---
Type: roadmap-index
Roadmaps:
  - roadmap:test
  - roadmap:other
---

# Roadmap Index
`,
  );
  await writeFixture(
    root,
    ".bearing/state/roadmaps/other.md",
    `---
Type: roadmap
ID: roadmap:other
Title: Other Roadmap
Status: active
Focused gate: gate:other
Gate order:
  - gate:other
---

# Roadmap: Other

## Intent

Preserve unrelated readiness.
`,
  );
  await writeFixture(
    root,
    ".bearing/state/milestone-gates/other.md",
    `---
Type: milestone-gate
ID: gate:other
Title: Other Gate
Roadmap: roadmap:other
Status: active
Effort order:
  - effort:other
---

# Milestone Gate: Other

## Intent

Preserve unrelated readiness.

## Exit Criteria

- Finish the other Effort.
`,
  );
  await writeFixture(
    root,
    ".bearing/state/efforts/other.md",
    `---
Type: effort
ID: effort:other
Title: Other Effort
Roadmap: roadmap:other
Target gate: gate:other
Authorities: []
Citations: []
Lifecycle: concluded
Planned at: null
Activated at: null
Conclusion:
  Disposition: completed
  Rationale: The independent work is complete.
  Concluded at: null
Work binding:
  Provider: matt-skills/v1
  Native scope: .scratch/other
---

# Effort: Other

## Intent

Preserve unrelated readiness.

## Work

- Complete independent native work.
`,
  );
  await writeScope(root, ".scratch/other");
  const calls = { count: 0, capturedLocators: [] as string[][] };
  const plan = await prepareSync(root, {
    providerObservationIntent: "initial-baseline",
    providerFactory: providerFactory(calls, "2026-07-31T01:40:00.000Z"),
  });
  const snapshot = await buildSnapshotForSyncPlan(root, "0.0.0-test", plan);

  expect(calls.count).toBe(2);
  expect(
    snapshot.gates.validity === "invalid"
      ? []
      : snapshot.gates.items.map((item) => ({
          id: String(item.id),
          readiness: item.readiness,
        })),
  ).toEqual([
    { id: "gate:other", readiness: "ready-for-review" },
    { id: "gate:test", readiness: "unknown" },
  ]);
});

test("a subject detail uses canonical identity and fails closed when capture omits that subject", async () => {
  const root = await createValidBearingRepo();
  await writeScope(root, ".scratch/unbound");
  await publishDiscovery(
    root,
    discoveryObservation([scope(".scratch/unbound")], "2026-07-31T01:20:00.000Z"),
  );

  const inspected = await prepareSync(root, {
    nativeScopeInspectionIntent: {
      kind: "inspect",
      subject: { kind: "native-subject", id: ".scratch/unbound/issues/01-work.md" },
      target: { provider: "matt-skills/v1", nativeScope: ".scratch/unbound" },
      refresh: false,
    },
    providerObservationNow: () => "2026-07-31T01:25:00.000Z",
  });
  expect(inspected.nativeScopeInspectionOperation).toMatchObject({
    outcome: "acquired",
    acquisitionCount: 1,
  });
  const snapshot = await buildSnapshotForSyncPlan(root, "0.0.0-test", inspected);
  expect(
    snapshot.lineage.subjects.some(
      (subject) =>
        subject.identity.kind === "native-subject" &&
        subject.identity.id === ".scratch/unbound/issues/01-work.md",
    ),
  ).toBe(true);
  await commitSyncPlan(inspected);

  const mismatchedCalls = { count: 0, capturedLocators: [] as string[][] };
  const mismatched = await prepareSync(root, {
    nativeScopeInspectionIntent: {
      kind: "inspect",
      subject: { kind: "native-subject", id: ".scratch/unbound/issues/01-work.md" },
      target: { provider: "matt-skills/v1", nativeScope: ".scratch/unbound" },
      refresh: true,
    },
    providerFactory: providerFactory(mismatchedCalls, "2026-07-31T01:30:00.000Z"),
    providerObservationNow: () => "2026-07-31T01:30:00.000Z",
  });
  expect(mismatched.nativeScopeInspectionOperation).toMatchObject({
    outcome: "retained-after-failure",
    acquisitionCount: 1,
  });
  expect(
    mismatched.nativeScopeInspectionSelections[0]?.latestAttempt?.diagnostics.map(
      (diagnostic) => diagnostic.code,
    ),
  ).toContain("native-scope-inspection.subject-mismatch");
});

test("detail reopen reuses cache, Refresh reacquires, and failure retains prior evidence", async () => {
  const root = await createValidBearingRepo();
  await writeScope(root, ".scratch/unbound");
  await publishDiscovery(
    root,
    discoveryObservation([scope(".scratch/unbound")], "2026-07-31T02:00:00.000Z"),
  );
  const initialCalls = { count: 0, capturedLocators: [] as string[][] };
  const first = await prepareSync(root, {
    nativeScopeInspectionIntent: {
      kind: "inspect",
      subject: { kind: "native-scope", id: ".scratch/unbound" },
      target: { provider: "matt-skills/v1", nativeScope: ".scratch/unbound" },
      refresh: false,
    },
    providerFactory: providerFactory(initialCalls, "2026-07-31T02:05:00.000Z"),
    providerObservationNow: () => "2026-07-31T02:05:00.000Z",
  });
  await commitSyncPlan(first);
  const selectedId = first.nativeScopeInspectionObservations[0]?.id;

  const reopenCalls = { count: 0, capturedLocators: [] as string[][] };
  const reopened = await prepareSync(root, {
    nativeScopeInspectionIntent: {
      kind: "inspect",
      subject: { kind: "native-scope", id: ".scratch/unbound" },
      target: { provider: "matt-skills/v1", nativeScope: ".scratch/unbound" },
      refresh: false,
    },
    providerFactory: providerFactory(reopenCalls, "2026-07-31T02:10:00.000Z"),
  });
  expect(reopened.nativeScopeInspectionOperation).toMatchObject({
    outcome: "reused-cache",
    acquisitionCount: 0,
  });
  expect(reopenCalls.count).toBe(0);
  expect(reopened.nativeScopeInspectionObservations[0]?.id).toBe(selectedId);

  const refreshCalls = { count: 0, capturedLocators: [] as string[][] };
  const failedRefresh = await prepareSync(root, {
    nativeScopeInspectionIntent: {
      kind: "inspect",
      subject: { kind: "native-scope", id: ".scratch/unbound" },
      target: { provider: "matt-skills/v1", nativeScope: ".scratch/unbound" },
      refresh: true,
    },
    providerFactory: providerFactory(refreshCalls, "2026-07-31T02:15:00.000Z", "partial"),
    providerObservationNow: () => "2026-07-31T02:15:00.000Z",
  });

  expect(refreshCalls.count).toBe(1);
  expect(failedRefresh.nativeScopeInspectionOperation).toMatchObject({
    outcome: "retained-after-failure",
    acquisitionCount: 1,
  });
  expect(failedRefresh.nativeScopeInspectionObservations[0]?.id).toBe(selectedId);
  expect(failedRefresh.nativeScopeInspectionSelections[0]).toMatchObject({
    observationId: selectedId,
    effectiveFreshness: "undetermined",
    latestAttempt: {
      intent: "native-scope-inspection",
      outcome: "failed",
    },
  });
  expect(
    failedRefresh.nativeScopeInspectionSelections[0]?.latestAttempt?.diagnostics.map(
      (diagnostic) => diagnostic.code,
    ),
  ).toContain("native-scope-inspection.incomplete");
  const retainedSnapshot = await buildSnapshotForSyncPlan(root, "0.0.0-test", failedRefresh);
  const html = renderToStaticMarkup(
    createElement(PlanningLineagePage, {
      entryId: "bearing",
      requested: {
        validity: "valid",
        value: { kind: "native-scope", id: ".scratch/unbound" },
      },
      snapshot: retainedSnapshot,
      onInspect: () => {},
      onNavigate: () => {},
      inspectionOperation: { state: "failed" },
      onRefreshDetails: () => {},
    }),
  );
  expect(html).toContain("latest refresh failed");
  expect(html).toContain("Refresh details");
  expect(html).toContain("undetermined");

  const thrown = await prepareSync(root, {
    nativeScopeInspectionIntent: {
      kind: "inspect",
      subject: { kind: "native-scope", id: ".scratch/unbound" },
      target: { provider: "matt-skills/v1", nativeScope: ".scratch/unbound" },
      refresh: true,
    },
    providerFactory: () => ({
      id: "matt-skills/v1",
      capture: async () => {
        throw new ProviderObservationAcquisitionUnavailableError("private transport detail");
      },
    }),
    providerObservationNow: () => "2026-07-31T02:20:00.000Z",
  });
  expect(thrown.nativeScopeInspectionOperation).toMatchObject({
    outcome: "retained-after-failure",
    acquisitionCount: 1,
  });
  expect(thrown.nativeScopeInspectionObservations[0]?.id).toBe(selectedId);
  expect(thrown.nativeScopeInspectionSelections[0]?.latestAttempt?.diagnostics).toContainEqual({
    code: "native-scope-inspection.acquisition-failed",
    impact: "blocking",
    target: ".scratch/unbound",
    message: "Native scope detail acquisition failed.",
  });
  expect(JSON.stringify(thrown.nativeScopeInspectionSelections)).not.toContain(
    "private transport detail",
  );
});

test("new discovery evidence marks changed detail stale and unproven sameness undetermined", async () => {
  const root = await createValidBearingRepo();
  await writeScope(root, ".scratch/unbound");
  const original = scope(".scratch/unbound");
  await publishDiscovery(root, discoveryObservation([original], "2026-07-31T03:00:00.000Z"));
  const calls = { count: 0, capturedLocators: [] as string[][] };
  const inspected = await prepareSync(root, {
    nativeScopeInspectionIntent: {
      kind: "inspect",
      subject: { kind: "native-scope", id: ".scratch/unbound" },
      target: { provider: "matt-skills/v1", nativeScope: ".scratch/unbound" },
      refresh: false,
    },
    providerFactory: providerFactory(calls, "2026-07-31T03:05:00.000Z"),
  });
  await commitSyncPlan(inspected);

  const failedDiscovery = await publishDiscovery(
    root,
    createNativeScopeDiscoveryObservation({
      provider: NATIVE_SCOPE_DISCOVERY_PROVIDER,
      state: "invalid",
      observedAt: "2026-07-31T03:07:00.000Z",
      freshness: "undetermined",
      coverage: "incomplete",
      scopes: [],
      diagnostics: [
        {
          code: "fixture.discovery-failed",
          class: "acquisition",
          impact: "blocking",
          target: root,
          message: "The latest discovery attempt failed.",
        },
      ],
    }),
  );
  expect(failedDiscovery.nativeScopeDiscovery?.observationId).toBe(
    inspected.nativeScopeDiscovery?.observationId,
  );
  expect(failedDiscovery.nativeScopeDiscovery?.latestAttempt?.state).toBe("invalid");
  expect(failedDiscovery.nativeScopeInspectionSelections[0]?.effectiveFreshness).toBe(
    "undetermined",
  );

  const changed = await publishDiscovery(
    root,
    discoveryObservation(
      [scope(".scratch/unbound", "Renamed native scope")],
      "2026-07-31T03:10:00.000Z",
    ),
  );
  expect(changed.nativeScopeInspectionSelections[0]?.effectiveFreshness).toBe("stale");

  const unproven = await publishDiscovery(
    root,
    discoveryObservation([original], "2026-07-31T03:15:00.000Z"),
  );
  expect(unproven.nativeScopeInspectionSelections[0]?.effectiveFreshness).toBe("undetermined");
});

test("aggregate inspection budget retains the prior readable store and records a scoped failure", async () => {
  const root = await createValidBearingRepo();
  await writeScope(root, ".scratch/one");
  await writeScope(root, ".scratch/two");
  await publishDiscovery(
    root,
    discoveryObservation(
      [scope(".scratch/one"), scope(".scratch/two")],
      "2026-07-31T03:30:00.000Z",
    ),
  );
  const firstCalls = { count: 0, capturedLocators: [] as string[][] };
  const first = await prepareSync(root, {
    nativeScopeInspectionIntent: {
      kind: "inspect",
      subject: { kind: "native-scope", id: ".scratch/one" },
      target: { provider: "matt-skills/v1", nativeScope: ".scratch/one" },
      refresh: false,
    },
    providerFactory: providerFactory(firstCalls, "2026-07-31T03:35:00.000Z"),
  });
  await commitSyncPlan(first);
  const priorBytes = first.nativeScopeInspectionStoreBytes;
  const priorObservationId = first.nativeScopeInspectionObservations[0]?.id;
  if (priorObservationId === undefined) throw new Error("Expected a selected prior observation.");
  const maximumStoreBytes = priorBytes.length + 2_048;

  const secondCalls = { count: 0, capturedLocators: [] as string[][] };
  const bounded = await prepareSync(root, {
    nativeScopeInspectionIntent: {
      kind: "inspect",
      subject: { kind: "native-scope", id: ".scratch/two" },
      target: { provider: "matt-skills/v1", nativeScope: ".scratch/two" },
      refresh: false,
    },
    providerFactory: providerFactory(secondCalls, "2026-07-31T03:40:00.000Z"),
    nativeScopeInspectionMaximumStoreBytes: maximumStoreBytes,
  });

  expect(secondCalls.count).toBe(1);
  expect(bounded.nativeScopeInspectionOperation.outcome).toBe("unavailable");
  expect(bounded.nativeScopeInspectionStoreBytes.length).toBeLessThanOrEqual(maximumStoreBytes);
  expect(bounded.nativeScopeInspectionObservations.map((observation) => observation.id)).toContain(
    priorObservationId,
  );
  expect(
    bounded.nativeScopeInspectionSelections
      .find((selection) => selection.nativeScope === ".scratch/two")
      ?.latestAttempt?.diagnostics.map((diagnostic) => diagnostic.code),
  ).toContain("native-scope-inspection.store-resource-budget");
  await commitSyncPlan(bounded);
  expect((await readNativeScopeInspectionStore(root)).kind).toBe("available");
});

test("freshness reconciliation publishes only a readable aggregate cache", async () => {
  const root = await createValidBearingRepo();
  await writeScope(root, ".scratch/one");
  await publishDiscovery(
    root,
    discoveryObservation([scope(".scratch/one")], "2026-07-31T03:42:00.000Z"),
  );
  const first = await prepareSync(root, {
    nativeScopeInspectionIntent: {
      kind: "inspect",
      subject: { kind: "native-scope", id: ".scratch/one" },
      target: { provider: "matt-skills/v1", nativeScope: ".scratch/one" },
      refresh: false,
    },
    providerFactory: providerFactory(
      { count: 0, capturedLocators: [] },
      "2026-07-31T03:43:00.000Z",
    ),
  });
  await commitSyncPlan(first);

  const reconciled = await prepareSync(root, {
    nativeScopeDiscoveryIntent: "explicit-discovery",
    nativeScopeDiscoveryProviderFactory: discoveryFactory(
      discoveryObservation([scope(".scratch/one")], "2026-07-31T03:44:00.000Z"),
    ),
    nativeScopeInspectionMaximumStoreBytes: first.nativeScopeInspectionStoreBytes.length,
  });

  expect(reconciled.nativeScopeInspectionStoreBytes.length).toBeLessThanOrEqual(
    first.nativeScopeInspectionStoreBytes.length,
  );
  expect(
    reconciled.nativeScopeInspectionSelections.every(
      (selection) => selection.effectiveFreshness !== "current",
    ),
  ).toBe(true);
  await commitSyncPlan(reconciled);
  expect((await readNativeScopeInspectionStore(root)).kind).toBe("available");
});

test("bounded cache reuse retains the requested target before unrelated detail", async () => {
  const root = await createValidBearingRepo();
  await writeScope(root, ".scratch/one");
  await writeScope(root, ".scratch/two");
  await publishDiscovery(
    root,
    discoveryObservation(
      [scope(".scratch/one"), scope(".scratch/two")],
      "2026-07-31T03:45:00.000Z",
    ),
  );
  const first = await prepareSync(root, {
    nativeScopeInspectionIntent: {
      kind: "inspect",
      subject: { kind: "native-scope", id: ".scratch/one" },
      target: { provider: "matt-skills/v1", nativeScope: ".scratch/one" },
      refresh: false,
    },
    providerFactory: providerFactory(
      { count: 0, capturedLocators: [] },
      "2026-07-31T03:46:00.000Z",
    ),
  });
  await commitSyncPlan(first);
  const firstObservationId = first.nativeScopeInspectionObservations[0]?.id;
  if (firstObservationId === undefined) throw new Error("Expected the first cached inspection.");

  const second = await prepareSync(root, {
    nativeScopeInspectionIntent: {
      kind: "inspect",
      subject: { kind: "native-scope", id: ".scratch/two" },
      target: { provider: "matt-skills/v1", nativeScope: ".scratch/two" },
      refresh: false,
    },
    providerFactory: providerFactory(
      { count: 0, capturedLocators: [] },
      "2026-07-31T03:47:00.000Z",
    ),
  });
  await commitSyncPlan(second);
  expect(second.nativeScopeInspectionSelections).toHaveLength(2);

  const reuseCalls = { count: 0, capturedLocators: [] as string[][] };
  const reused = await prepareSync(root, {
    nativeScopeInspectionIntent: {
      kind: "inspect",
      subject: { kind: "native-scope", id: ".scratch/one" },
      target: { provider: "matt-skills/v1", nativeScope: ".scratch/one" },
      refresh: false,
    },
    providerFactory: providerFactory(reuseCalls, "2026-07-31T03:48:00.000Z"),
    nativeScopeInspectionMaximumStoreBytes: first.nativeScopeInspectionStoreBytes.length,
  });

  expect(reused.nativeScopeInspectionOperation).toMatchObject({
    outcome: "reused-cache",
    acquisitionCount: 0,
  });
  expect(reuseCalls.count).toBe(0);
  expect(reused.nativeScopeInspectionSelections.map((selection) => selection.nativeScope)).toEqual([
    ".scratch/one",
  ]);
  expect(reused.nativeScopeInspectionObservations.map((observation) => observation.id)).toEqual([
    firstObservationId,
  ]);
  expect(reused.nativeScopeInspectionStoreBytes.length).toBeLessThanOrEqual(
    first.nativeScopeInspectionStoreBytes.length,
  );
});

test("inspection Snapshot rejects a current selection over stale observation evidence", () => {
  const staleObservation = createProviderScopeObservation({
    provider: "matt-skills/v1",
    binding: { provider: "matt-skills/v1", nativeScope: ".scratch/stale" },
    observedAt: "2026-07-31T03:50:00.000Z",
    state: "available",
    freshness: {
      assessment: "stale",
      evidence: [{ kind: "fixture", value: "known-stale" }],
    },
    coverage: {
      assessment: "complete",
      dimensions: [{ key: "scope-membership", state: "covered" }],
    },
    completion: "incomplete",
    diagnostics: [],
    projection: createMattReferenceProjection("local"),
  });
  expect(
    nativeScopeInspectionProjectionSchema.safeParse({
      observations: [staleObservation],
      selections: [
        {
          provider: "matt-skills/v1",
          nativeScope: ".scratch/stale",
          observationId: staleObservation.id,
          effectiveFreshness: "current",
          latestAttempt: {
            intent: "native-scope-inspection",
            attemptedAt: "2026-07-31T03:50:00.000Z",
            outcome: "succeeded",
            diagnostics: [],
          },
        },
      ],
    }).success,
  ).toBe(false);
});

test("a matching bound capture is reused before the inspection cache", async () => {
  const root = await createValidBearingRepo();
  await publishDiscovery(
    root,
    discoveryObservation([scope(".scratch/work")], "2026-07-31T04:00:00.000Z"),
  );
  const calls = { count: 0, capturedLocators: [] as string[][] };
  const plan = await prepareSync(root, {
    providerObservationIntent: "initial-baseline",
    nativeScopeInspectionIntent: {
      kind: "inspect",
      subject: { kind: "native-scope", id: ".scratch/work" },
      target: { provider: "matt-skills/v1", nativeScope: ".scratch/work" },
      refresh: false,
    },
    providerFactory: providerFactory(calls, "2026-07-31T04:05:00.000Z"),
    providerObservationNow: () => "2026-07-31T04:05:00.000Z",
  });

  expect(calls.count).toBe(1);
  expect(plan.providerObservationOperation.acquisitionCount).toBe(1);
  expect(plan.nativeScopeInspectionOperation).toMatchObject({
    outcome: "reused-bound",
    acquisitionCount: 0,
  });
  expect(plan.nativeScopeInspectionObservations).toEqual([]);
  const snapshot = await buildSnapshotForSyncPlan(root, "0.0.0-test", plan);
  expect(
    snapshot.lineage.subjects.find(
      (subject) => subject.identity.kind === "effort" && subject.identity.id === "effort:test",
    )?.nativeWorkReadingState?.binding,
  ).toMatchObject({ state: "bound", discovery: "discovered" });
});

test("complete discovery omission is bound-not-discovered while uncertain omission stays unknown", async () => {
  const exactRoot = await createValidBearingRepo();
  await publishDiscovery(exactRoot, discoveryObservation([], "2026-07-31T05:00:00.000Z"));
  const exactCalls = { count: 0, capturedLocators: [] as string[][] };
  const exactPlan = await prepareSync(exactRoot, {
    providerObservationIntent: "initial-baseline",
    providerFactory: providerFactory(exactCalls, "2026-07-31T05:05:00.000Z"),
    providerObservationNow: () => "2026-07-31T05:05:00.000Z",
  });
  const exactSnapshot = await buildSnapshotForSyncPlan(exactRoot, "0.0.0-test", exactPlan);
  const exactEffort = exactSnapshot.lineage.subjects.find(
    (subject) => subject.identity.kind === "effort" && subject.identity.id === "effort:test",
  );
  expect(exactEffort?.nativeWorkReadingState?.binding).toEqual({
    state: "bound",
    effortIds: ["effort:test"],
    discovery: "bound-not-discovered",
  });
  expect(
    exactPlan.planningGraph.contextFor({ kind: "effort", id: "effort:test" }).context
      ?.nativeWorkReadingState,
  ).toEqual(exactEffort?.nativeWorkReadingState);

  const uncertainRoot = await createValidBearingRepo();
  await publishDiscovery(
    uncertainRoot,
    createNativeScopeDiscoveryObservation({
      provider: NATIVE_SCOPE_DISCOVERY_PROVIDER,
      state: "partial",
      observedAt: "2026-07-31T05:10:00.000Z",
      freshness: "undetermined",
      coverage: "incomplete",
      scopes: [],
      diagnostics: [
        {
          code: "fixture.discovery-partial",
          class: "acquisition",
          impact: "blocking",
          target: uncertainRoot,
          message: "The fixture cannot prove complete discovery coverage.",
        },
      ],
    }),
  );
  const uncertainCalls = { count: 0, capturedLocators: [] as string[][] };
  const uncertainPlan = await prepareSync(uncertainRoot, {
    providerObservationIntent: "initial-baseline",
    providerFactory: providerFactory(uncertainCalls, "2026-07-31T05:15:00.000Z"),
    providerObservationNow: () => "2026-07-31T05:15:00.000Z",
  });
  const uncertainSnapshot = await buildSnapshotForSyncPlan(
    uncertainRoot,
    "0.0.0-test",
    uncertainPlan,
  );
  const uncertainEffort = uncertainSnapshot.lineage.subjects.find(
    (subject) => subject.identity.kind === "effort" && subject.identity.id === "effort:test",
  );
  expect(uncertainEffort?.nativeWorkReadingState?.binding).toMatchObject({
    state: "bound",
    discovery: "unknown",
  });
});

test("inspection detail never becomes bound completion authority", async () => {
  const root = await createValidBearingRepo();
  await publishDiscovery(
    root,
    discoveryObservation([scope(".scratch/work")], "2026-07-31T06:00:00.000Z"),
  );
  const calls = { count: 0, capturedLocators: [] as string[][] };
  const plan = await prepareSync(root, {
    nativeScopeInspectionIntent: {
      kind: "inspect",
      subject: { kind: "native-scope", id: ".scratch/work" },
      target: { provider: "matt-skills/v1", nativeScope: ".scratch/work" },
      refresh: false,
    },
    providerFactory: providerFactory(calls, "2026-07-31T06:05:00.000Z"),
    providerObservationNow: () => "2026-07-31T06:05:00.000Z",
  });
  expect(plan.providerObservations).toEqual([]);
  expect(plan.nativeScopeInspectionObservations[0]?.completion).toBe("complete");

  const snapshot = await buildSnapshotForSyncPlan(root, "0.0.0-test", plan);
  const effortReading = snapshot.lineage.subjects.find(
    (subject) => subject.identity.kind === "effort" && subject.identity.id === "effort:test",
  )?.nativeWorkReadingState;
  const scopeReading = snapshot.lineage.subjects.find(
    (subject) =>
      subject.identity.kind === "native-scope" && subject.identity.id === ".scratch/work",
  )?.nativeWorkReadingState;
  expect(effortReading).toMatchObject({
    conclusion: "Binding needs attention",
    binding: {
      state: "attention",
      reason: "bound-unresolved",
      effortIds: ["effort:test"],
    },
    why: { completion: "undetermined" },
  });
  expect(scopeReading).toEqual(effortReading);
  expect(
    plan.planningGraph.contextFor({ kind: "effort", id: "effort:test" }).context
      ?.nativeWorkReadingState,
  ).toEqual(effortReading);
});
