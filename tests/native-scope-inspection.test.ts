import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
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

const providerFactory =
  (
    calls: { count: number; capturedLocators: string[][] },
    observedAt: string,
    state: "available" | "partial" = "available",
    mapTitle?: string,
  ): MattProviderFactory =>
  (input) => ({
    id: "matt-skills/v1",
    capture: async (binding) => {
      calls.count += 1;
      calls.capturedLocators.push([...input.capturedDocuments.keys()].sort());
      const baseProjection = JSON.parse(
        JSON.stringify(createMattReferenceProjection("local"))
          .replaceAll(".scratch/reference", binding.nativeScope)
          .replaceAll("local:opaque", `local:${binding.nativeScope}`),
      ) as ReturnType<typeof createMattReferenceProjection>;
      const projection =
        mapTitle === undefined || baseProjection.map === undefined
          ? baseProjection
          : { ...baseProjection, map: { ...baseProjection.map, title: mapTitle } };
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

test("ordinary Sync keeps an unresolved declaration structural without creating a native route", async () => {
  const root = await createValidBearingRepo();
  const plan = await prepareSync(root);
  const snapshot = await buildSnapshotForSyncPlan(root, "0.0.0-test", plan);
  const effort = findPlanningLineageSubjectProjection(snapshot.lineage, {
    kind: "effort",
    id: "effort:test",
  });
  expect(effort?.nativeWorkReadingState).toBeUndefined();
  const bindingRelation = effort?.relations.find(
    (relation) => relation.key === "native-work.binding",
  );
  expect(bindingRelation).toMatchObject({
    state: "unavailable",
    reason: "The declared Work Binding does not resolve to a provider observation.",
  });
  expect(
    snapshot.gates.validity === "invalid"
      ? undefined
      : snapshot.gates.items.find((gate) => gate.id === "gate:test")?.readiness,
  ).toBe("unknown");
  expect(buildProjectOverviewModel(snapshot).attention).toEqual([]);
});

test("ordinary Sync does not create a GitHub native route without provider evidence", async () => {
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
  const effortSubject = findPlanningLineageSubjectProjection(snapshot.lineage, {
    kind: "effort",
    id: "effort:test",
  });
  const bindingRelation = effortSubject?.relations.find(
    (relation) => relation.key === "native-work.binding",
  );

  expect(bindingRelation).toMatchObject({
    state: "unavailable",
    reason: "The declared Work Binding does not resolve to a provider observation.",
  });
  expect(buildProjectOverviewModel(snapshot).attention).toEqual([]);
});

test("an unbound inspection is a zero-intrusion standalone result", async () => {
  const root = await createValidBearingRepo();
  const calls = { count: 0, capturedLocators: [] as string[][] };
  const plan = await prepareSync(root, {
    nativeScopeInspectionIntent: {
      kind: "inspect",
      subject: { kind: "native-scope", id: ".scratch/standalone" },
      target: { provider: "matt-skills/v1", nativeScope: ".scratch/standalone" },
      refresh: true,
    },
    providerFactory: providerFactory(calls, "2026-08-03T01:00:00.000Z"),
  });

  expect(calls.count).toBe(0);
  expect(plan.nativeScopeInspectionOperation).toMatchObject({
    outcome: "target-unavailable",
    acquisitionCount: 0,
  });
  expect(plan.nativeScopeInspectionObservations).toEqual([]);
  expect(plan.nativeScopeInspectionSelections).toEqual([]);
  expect(plan.nativeScopeInspectionStoreChanged).toBe(false);

  const snapshot = await buildSnapshotForSyncPlan(root, "0.0.0-test", plan);
  expect(
    snapshot.lineage.subjects.some((subject) => subject.identity.id.includes("standalone")),
  ).toBe(false);
  expect(snapshot.attention.some((item) => JSON.stringify(item).includes("standalone"))).toBe(
    false,
  );
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

test("an unresolved subject inspection stays disposable and never enrolls a native route", async () => {
  const root = await createValidBearingRepo();

  const inspected = await prepareSync(root, {
    nativeScopeInspectionIntent: {
      kind: "inspect",
      subject: { kind: "native-subject", id: ".scratch/work/issues/01-finish.md" },
      target: { provider: "matt-skills/v1", nativeScope: ".scratch/work" },
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
        subject.identity.id === ".scratch/work/issues/01-finish.md",
    ),
  ).toBe(false);
  await commitSyncPlan(inspected);

  const mismatchedCalls = { count: 0, capturedLocators: [] as string[][] };
  const mismatched = await prepareSync(root, {
    nativeScopeInspectionIntent: {
      kind: "inspect",
      subject: { kind: "native-subject", id: ".scratch/work/issues/01-finish.md" },
      target: { provider: "matt-skills/v1", nativeScope: ".scratch/work" },
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
  const initialCalls = { count: 0, capturedLocators: [] as string[][] };
  const first = await prepareSync(root, {
    nativeScopeInspectionIntent: {
      kind: "inspect",
      subject: { kind: "native-scope", id: ".scratch/work" },
      target: { provider: "matt-skills/v1", nativeScope: ".scratch/work" },
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
      subject: { kind: "native-scope", id: ".scratch/work" },
      target: { provider: "matt-skills/v1", nativeScope: ".scratch/work" },
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
      subject: { kind: "native-scope", id: ".scratch/work" },
      target: { provider: "matt-skills/v1", nativeScope: ".scratch/work" },
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
        value: { kind: "effort", id: "effort:test" },
      },
      snapshot: retainedSnapshot,
      onInspect: () => {},
      onNavigate: () => {},
      observationActionLabel: "Load source",
      observationBusy: false,
      onObserveSource: () => {},
    }),
  );
  expect(html).toContain("Latest refresh failed; retained verified work remains visible.");
  expect(html).toContain("Load source");
  expect(html).toContain("2026-07-31T02:05:00.000Z");

  const thrown = await prepareSync(root, {
    nativeScopeInspectionIntent: {
      kind: "inspect",
      subject: { kind: "native-scope", id: ".scratch/work" },
      target: { provider: "matt-skills/v1", nativeScope: ".scratch/work" },
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
    target: ".scratch/work",
    message: "Native scope detail acquisition failed.",
  });
  expect(JSON.stringify(thrown.nativeScopeInspectionSelections)).not.toContain(
    "private transport detail",
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
  ).toMatchObject({ state: "bound" });
});

test("an authoritative bound capture outranks retained inspection detail for lineage", async () => {
  const root = await createValidBearingRepo();
  const inspectionCalls = { count: 0, capturedLocators: [] as string[][] };
  const inspected = await prepareSync(root, {
    nativeScopeInspectionIntent: {
      kind: "inspect",
      subject: { kind: "native-scope", id: ".scratch/work" },
      target: { provider: "matt-skills/v1", nativeScope: ".scratch/work" },
      refresh: true,
    },
    providerFactory: providerFactory(
      inspectionCalls,
      "2026-08-03T02:00:00.000Z",
      "available",
      "Retained inspection detail",
    ),
  });
  await commitSyncPlan(inspected);

  const providerCalls = { count: 0, capturedLocators: [] as string[][] };
  const captured = await prepareSync(root, {
    providerObservationIntent: "initial-baseline",
    providerFactory: providerFactory(
      providerCalls,
      "2026-08-03T02:05:00.000Z",
      "available",
      "Authoritative provider capture",
    ),
  });
  const snapshot = await buildSnapshotForSyncPlan(root, "0.0.0-test", captured);
  const scope = snapshot.lineage.subjects.find(
    (subject) =>
      subject.identity.kind === "native-scope" && subject.identity.id === ".scratch/work",
  );
  const members = scope?.relations.find((relation) => relation.key === "native-work.members");

  expect(providerCalls.count).toBe(1);
  expect(snapshot.nativeScopeInspections.observations).toHaveLength(1);
  expect(
    members?.state === "present" ? members.targets.map((target) => target.label) : [],
  ).toContain("Authoritative provider capture");
  expect(JSON.stringify(scope)).not.toContain("Retained inspection detail");
});

test("inspection detail never becomes bound completion authority", async () => {
  const root = await createValidBearingRepo();
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
  expect(effortReading).toBeUndefined();
  expect(scopeReading).toBeUndefined();
  expect(
    plan.planningGraph.contextFor({ kind: "effort", id: "effort:test" }).context
      ?.nativeWorkReadingState,
  ).toBeUndefined();
});
