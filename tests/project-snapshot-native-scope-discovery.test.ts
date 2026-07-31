import { expect, test } from "bun:test";
import {
  createNativeScopeDiscoveryObservation,
  type NativeScopeDiscoveryView,
} from "../src/native-scope-discovery";
import type { Effort } from "../src/project-snapshot/contract";
import { buildNativeScopeDiscoveryProjection } from "../src/project-snapshot/native-scope-discovery";
import { projectSnapshotSchema } from "../src/project-snapshot/schema";
import { createProjectOverviewFixture } from "./fixtures/project-overview";

const scope = {
  identity: "local-scope:.scratch/native",
  binding: { provider: "matt-skills/v1", nativeScope: ".scratch/native" },
  locator: ".scratch/native",
  driver: "local",
  rootRole: "wayfinder-map",
  title: "Native work",
  lifecycle: "open",
  classification: "map",
  admission: ["contract-map"],
  subjects: [
    {
      identity: "local:.scratch/native/map.md",
      locator: ".scratch/native/map.md",
      title: "Native work",
      classification: "map",
      lifecycle: "open",
      parentIdentity: null,
      admission: ["contract-map"],
    },
  ],
} as const;

const view = (overrides: Partial<NativeScopeDiscoveryView> = {}): NativeScopeDiscoveryView => {
  const observation = createNativeScopeDiscoveryObservation({
    provider: "matt-skills/v1",
    state: "available",
    observedAt: "2026-07-31T07:00:00.000Z",
    freshness: "current",
    coverage: "complete",
    scopes: [scope],
    diagnostics: [],
  });
  return {
    observationId: observation.id,
    provider: observation.provider,
    state: observation.state,
    observedAt: observation.observedAt,
    validators: observation.validators,
    freshness: observation.freshness.assessment,
    coverage: observation.coverage.assessment,
    scopes: observation.scopes,
    diagnostics: observation.diagnostics,
    confirmedEmpty: observation.confirmedEmpty,
    latestAttempt: null,
    ...overrides,
  };
};

const effort = (id: string, nativeScope: string): Effort =>
  ({
    id,
    workBinding: { provider: "matt-skills/v1", nativeScope },
  }) as Effort;

test("Snapshot keeps never-run distinct from a confirmed empty discovery", () => {
  expect(
    buildNativeScopeDiscoveryProjection(undefined, { validity: "available", items: [] }),
  ).toEqual({ state: "never-run" });
  const empty = buildNativeScopeDiscoveryProjection(view({ scopes: [], confirmedEmpty: true }), {
    validity: "available",
    items: [],
  });
  expect(empty).toEqual(
    expect.objectContaining({
      state: "available",
      count: { kind: "exact", value: 0 },
      confirmedUnboundEmpty: true,
    }),
  );
});

test("Snapshot reconciles discovery summaries with canonical bindings without mutation authority", () => {
  const unbound = buildNativeScopeDiscoveryProjection(view(), {
    validity: "available",
    items: [],
  });
  const bound = buildNativeScopeDiscoveryProjection(view(), {
    validity: "available",
    items: [effort("effort:bound", ".scratch/native")],
  });
  const conflict = buildNativeScopeDiscoveryProjection(view(), {
    validity: "available",
    items: [effort("effort:first", ".scratch/native"), effort("effort:second", ".scratch/native")],
  });

  expect(unbound.state === "never-run" ? undefined : unbound.scopes[0]).toEqual(
    expect.objectContaining({
      bindingContext: { state: "unbound", effortIds: [] },
      detailAvailability: "summary-only",
    }),
  );
  expect(unbound.state === "never-run" ? undefined : unbound.count).toEqual({
    kind: "exact",
    value: 1,
  });
  expect(bound.state === "never-run" ? undefined : bound.scopes[0]?.bindingContext.state).toBe(
    "bound",
  );
  expect(
    bound.state === "never-run" ? undefined : bound.scopes[0]?.bindingContext.effortIds.join(","),
  ).toBe("effort:bound");
  expect(bound.state === "never-run" ? undefined : bound.confirmedUnboundEmpty).toBe(true);
  expect(
    conflict.state === "never-run" ? undefined : conflict.scopes[0]?.bindingContext.state,
  ).toBe("binding-conflict");
  expect(
    conflict.state === "never-run"
      ? undefined
      : conflict.scopes[0]?.bindingContext.effortIds.join(","),
  ).toBe("effort:first,effort:second");
  expect(JSON.stringify(conflict)).not.toContain("completion");
  expect(JSON.stringify(conflict)).not.toContain("readiness");
});

test("incomplete canonical Effort coverage never turns an unknown binding into unbound", () => {
  const invalid = buildNativeScopeDiscoveryProjection(view(), { validity: "invalid" });
  const partial = buildNativeScopeDiscoveryProjection(view(), {
    validity: "partial",
    items: [effort("effort:known", ".scratch/native")],
  });

  expect(invalid.state === "never-run" ? undefined : invalid.scopes[0]?.bindingContext).toEqual({
    state: "bound-unresolved",
    effortIds: [],
  });
  expect(invalid.state === "never-run" ? undefined : invalid.count).toEqual({
    kind: "unavailable",
  });
  expect(invalid.state === "never-run" ? undefined : invalid.confirmedUnboundEmpty).toBe(false);
  expect(partial.state === "never-run" ? undefined : partial.scopes[0]?.bindingContext.state).toBe(
    "bound-unresolved",
  );
  expect(
    partial.state === "never-run"
      ? undefined
      : partial.scopes[0]?.bindingContext.effortIds.join(","),
  ).toBe("effort:known");
});

test("partial and failed-latest discovery expose uncertainty instead of exact zero", () => {
  const projection = buildNativeScopeDiscoveryProjection(
    view({
      state: "partial",
      coverage: "incomplete",
      freshness: "undetermined",
      latestAttempt: {
        observationId: `sha256:${"f".repeat(64)}`,
        state: "partial",
        observedAt: "2026-07-31T07:01:00.000Z",
        diagnostics: [],
      },
    }),
    { validity: "available", items: [] },
  );
  expect(projection.state).toBe("partial");
  expect(projection.state === "never-run" ? undefined : projection.count).toEqual({
    kind: "at-least",
    value: 1,
  });
  expect(projection.state === "never-run" ? undefined : projection.confirmedUnboundEmpty).toBe(
    false,
  );
});

test("Snapshot cache rejects forged discovery count, empty state, and binding context", () => {
  const snapshot = createProjectOverviewFixture();
  const discovery = buildNativeScopeDiscoveryProjection(view(), snapshot.efforts);
  expect(discovery.state).not.toBe("never-run");
  if (discovery.state === "never-run") return;
  const valid = {
    ...snapshot,
    nativeScopeDiscovery: discovery,
  };
  expect(projectSnapshotSchema.safeParse(valid).success).toBe(true);
  expect(
    projectSnapshotSchema.safeParse({
      ...valid,
      nativeScopeDiscovery: {
        ...discovery,
        count: { kind: "exact", value: 999 },
        confirmedUnboundEmpty: true,
      },
    }).success,
  ).toBe(false);
  expect(
    projectSnapshotSchema.safeParse({
      ...valid,
      nativeScopeDiscovery: {
        ...discovery,
        scopes: discovery.scopes.map((item) => ({
          ...item,
          bindingContext: { state: "bound", effortIds: ["effort:portal"] },
        })),
        count: { kind: "exact", value: 0 },
        confirmedUnboundEmpty: true,
      },
    }).success,
  ).toBe(false);
  expect(
    projectSnapshotSchema.safeParse({
      ...valid,
      nativeScopeDiscovery: {
        ...discovery,
        latestAttempt: {
          observationId: discovery.observationId,
          state: "unavailable",
          observedAt: discovery.observedAt,
          diagnostics: [],
        },
      },
    }).success,
  ).toBe(false);
});
