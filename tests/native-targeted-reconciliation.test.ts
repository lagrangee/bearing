import { expect, test } from "bun:test";
import { lstat, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import {
  nativeReconciliationRequestFingerprint,
  nativeReconciliationRequestSchema,
  normalizeNativeReconciliationRequest,
} from "../src/native-reconciliation-contract";
import { createProviderScopeObservation } from "../src/native-work-provider";
import { ProviderObservationAcquisitionUnavailableError } from "../src/provider-observation-store";
import { createGitHubMattProvider } from "../src/providers/matt-skills-v1/github";
import { createLocalMarkdownMattProvider } from "../src/providers/matt-skills-v1/local-markdown";
import { commitSyncPlan, prepareSync } from "../src/sync-plan";
import {
  createGitHubMattRepository,
  FixtureGitHubTransport,
  githubContractLocator,
  githubFixtureResponse,
  githubIncomingIssue,
  githubIssue,
  githubNativeScopeFor,
  githubRepository,
  githubTriageLocator,
} from "./fixtures/github-matt-api";
import { createMattReferenceProjection } from "./fixtures/matt-reference-scenario";
import { buildSnapshotForSyncPlan, createValidBearingRepo, writeFixture } from "./helpers";

const projectionFor = (nativeScope: string, title: string) => {
  const projection = JSON.parse(
    JSON.stringify(createMattReferenceProjection("local"))
      .replaceAll(".scratch/reference", nativeScope)
      .replaceAll("local:opaque", `local:${nativeScope}`),
  ) as ReturnType<typeof createMattReferenceProjection>;
  return {
    ...projection,
    map:
      projection.map === undefined
        ? undefined
        : {
            ...projection.map,
            title,
          },
  };
};

const observationFor = (
  binding: Readonly<{ provider: "matt-skills/v1"; nativeScope: string }>,
  observedAt: string,
  title: string,
) =>
  createProviderScopeObservation({
    provider: "matt-skills/v1",
    binding,
    observedAt,
    state: "available",
    freshness: {
      assessment: "current",
      evidence: [{ kind: "fixture", value: observedAt }],
    },
    coverage: {
      assessment: "complete",
      dimensions: [{ key: "scope-membership", state: "covered" }],
    },
    completion: "incomplete",
    diagnostics: [],
    projection: projectionFor(binding.nativeScope, title),
  });

test("transaction-close normalization deduplicates subjects and typed relations deterministically", () => {
  const request = normalizeNativeReconciliationRequest({
    binding: { provider: "matt-skills/v1", nativeScope: ".scratch/work" },
    subjects: [
      ".scratch/work/issues/02.md",
      ".scratch/work/issues/01.md",
      ".scratch/work/issues/02.md",
    ],
    relations: [
      {
        kind: "blocked-by",
        source: ".scratch/work/issues/02.md",
        target: ".scratch/work/issues/01.md",
      },
      {
        kind: "blocked-by",
        source: ".scratch/work/issues/02.md",
        target: ".scratch/work/issues/01.md",
      },
    ],
  });

  expect(request.subjects).toEqual([".scratch/work/issues/01.md", ".scratch/work/issues/02.md"]);
  expect(request.relations).toEqual([
    {
      kind: "blocked-by",
      source: ".scratch/work/issues/02.md",
      target: ".scratch/work/issues/01.md",
    },
  ]);
  expect(nativeReconciliationRequestSchema.parse(request)).toEqual(request);
});

test("the Project Wire reconciliation schema remains browser-safe without Node Buffer", () => {
  const runtime = globalThis as typeof globalThis & { Buffer?: typeof Buffer };
  const original = runtime.Buffer;
  try {
    Object.defineProperty(runtime, "Buffer", { configurable: true, value: undefined });
    const success = nativeReconciliationRequestSchema.safeParse({
      schemaVersion: 1,
      binding: { provider: "matt-skills/v1", nativeScope: ".scratch/work" },
      subjects: [".scratch/work/issues/01-finish.md"],
      relations: [],
    }).success;
    Object.defineProperty(runtime, "Buffer", { configurable: true, value: original });
    expect(success).toBe(true);
  } finally {
    Object.defineProperty(runtime, "Buffer", { configurable: true, value: original });
  }
});

test("schema-valid requests have one deterministic Unicode ordering and fingerprint", () => {
  const binding = { provider: "matt-skills/v1" as const, nativeScope: ".scratch/work" };
  for (const malformed of ["\uD800", "\uD801", "\uDC00"]) {
    expect(() =>
      normalizeNativeReconciliationRequest({
        binding,
        subjects: [malformed],
      }),
    ).toThrow("well-formed Unicode");
  }

  const left = normalizeNativeReconciliationRequest({
    binding,
    subjects: ["😀", "é", "a"],
  });
  const right = normalizeNativeReconciliationRequest({
    binding,
    subjects: ["a", "😀", "é"],
  });
  expect(right).toEqual(left);
  expect(nativeReconciliationRequestFingerprint(right)).toBe(
    nativeReconciliationRequestFingerprint(left),
  );
});

test("the observation owner dispatches targeted intent only through reconcile, publishes one immutable replacement, and ordinary Sync reuses it", async () => {
  const root = await createValidBearingRepo();
  const binding = { provider: "matt-skills/v1" as const, nativeScope: ".scratch/work" };
  const baselineCalls = { capture: 0 };
  const baseline = await prepareSync(root, {
    providerObservationIntent: "initial-baseline",
    providerFactory: () => ({
      id: "matt-skills/v1",
      capture: async () => {
        baselineCalls.capture += 1;
        return observationFor(binding, "2026-07-31T01:00:00.000Z", "Before");
      },
    }),
  });
  await commitSyncPlan(baseline);

  const calls = { capture: 0, reconcile: 0 };
  const request = normalizeNativeReconciliationRequest({
    binding,
    subjects: [".scratch/work/issues/01-finish.md", ".scratch/work/issues/01-finish.md"],
  });
  const reconciled = await prepareSync(root, {
    nativeScopeInspectionIntent: { kind: "reconcile", request },
    providerFactory: () => ({
      id: "matt-skills/v1",
      capture: async () => {
        calls.capture += 1;
        throw new Error("Full capture must not run during targeted reconciliation.");
      },
      reconcile: async (input) => {
        calls.reconcile += 1;
        expect(input.prior?.id).toBe(baseline.providerObservations[0]?.id);
        expect(input.affected.subjects).toEqual([".scratch/work/issues/01-finish.md"]);
        return observationFor(binding, "2026-07-31T01:05:00.000Z", "After");
      },
    }),
  });

  expect(calls).toEqual({ capture: 0, reconcile: 1 });
  expect(reconciled.providerObservationOperation).toEqual({
    intent: "targeted-reconciliation",
    outcome: "acquired",
    acquisitionCount: 1,
  });
  expect(reconciled.nativeScopeInspectionOperation).toMatchObject({
    intent: { kind: "reconcile" },
    outcome: "reused-bound",
    acquisitionCount: 0,
  });
  expect(reconciled.providerObservations[0]?.id).not.toBe(baseline.providerObservations[0]?.id);
  expect(reconciled.providerObservations[0]?.projection?.map?.title).toBe("After");
  await commitSyncPlan(reconciled);

  const ordinary = await prepareSync(root, {
    providerFactory: () => ({
      id: "matt-skills/v1",
      capture: async () => {
        throw new Error("Ordinary Sync must not capture.");
      },
    }),
  });
  expect(ordinary.providerObservationOperation).toEqual({
    intent: "ordinary-sync",
    outcome: "reused",
    acquisitionCount: 0,
  });
  expect(ordinary.providerObservations[0]?.id).toBe(reconciled.providerObservations[0]?.id);
  const snapshot = await buildSnapshotForSyncPlan(root, "0.0.0-test", ordinary);
  expect(snapshot.providerObservations[0]?.id).toBe(reconciled.providerObservations[0]?.id);
});

test("an unbound reconciliation never invokes provider capture or reconciliation", async () => {
  const root = await createValidBearingRepo();
  const calls = { capture: 0, reconcile: 0 };
  const request = normalizeNativeReconciliationRequest({
    binding: { provider: "matt-skills/v1", nativeScope: ".scratch/standalone" },
    subjects: [".scratch/standalone/issues/01.md"],
  });
  const plan = await prepareSync(root, {
    nativeScopeInspectionIntent: { kind: "reconcile", request },
    providerFactory: () => ({
      id: "matt-skills/v1",
      capture: async () => {
        calls.capture += 1;
        throw new Error("Standalone work must not be captured.");
      },
      reconcile: async () => {
        calls.reconcile += 1;
        throw new Error("Standalone work must not be reconciled.");
      },
    }),
  });

  expect(calls).toEqual({ capture: 0, reconcile: 0 });
  expect(plan.providerObservationOperation.acquisitionCount).toBe(0);
  expect(plan.nativeScopeInspectionOperation).toMatchObject({
    outcome: "target-unavailable",
    acquisitionCount: 0,
  });
  expect(plan.providerObservations).toEqual([]);
  expect(plan.nativeScopeInspectionObservations).toEqual([]);
});

test("targeted reconciliation updates one matched binding without capture-every-bound-scope N+1 work", async () => {
  const root = await createValidBearingRepo();
  const effort = await readFile(join(root, ".bearing/state/efforts/test.md"), "utf8");
  const gate = await readFile(join(root, ".bearing/state/milestone-gates/test.md"), "utf8");
  await writeFixture(
    root,
    ".bearing/state/efforts/other.md",
    effort
      .replaceAll("effort:test", "effort:other")
      .replaceAll("Test Effort", "Other Effort")
      .replaceAll(".scratch/work", ".scratch/other"),
  );
  await writeFixture(
    root,
    ".bearing/state/milestone-gates/test.md",
    gate.replace("  - effort:test", "  - effort:test\n  - effort:other"),
  );
  const baselineCaptures: string[] = [];
  const baseline = await prepareSync(root, {
    providerObservationIntent: "initial-baseline",
    providerFactory: () => ({
      id: "matt-skills/v1",
      capture: async (binding) => {
        baselineCaptures.push(binding.nativeScope);
        return observationFor(
          binding,
          "2026-07-31T01:30:00.000Z",
          `Baseline ${binding.nativeScope}`,
        );
      },
    }),
  });
  expect(baselineCaptures).toEqual([".scratch/other", ".scratch/work"]);
  await commitSyncPlan(baseline);

  const captures: string[] = [];
  const reconciliations: string[] = [];
  const request = normalizeNativeReconciliationRequest({
    binding: { provider: "matt-skills/v1", nativeScope: ".scratch/work" },
    subjects: [".scratch/work/issues/01-finish.md"],
  });
  const targeted = await prepareSync(root, {
    nativeScopeInspectionIntent: { kind: "reconcile", request },
    providerFactory: () => ({
      id: "matt-skills/v1",
      capture: async (binding) => {
        captures.push(binding.nativeScope);
        return observationFor(binding, "2026-07-31T01:31:00.000Z", "Forbidden");
      },
      reconcile: async (input) => {
        reconciliations.push(input.binding.nativeScope);
        return observationFor(input.binding, "2026-07-31T01:32:00.000Z", "Targeted");
      },
    }),
  });

  expect(captures).toEqual([]);
  expect(reconciliations).toEqual([".scratch/work"]);
  expect(targeted.providerObservationOperation.acquisitionCount).toBe(1);
  expect(
    targeted.providerObservations.find(
      (observation) => observation.binding.nativeScope === ".scratch/other",
    )?.id,
  ).toBe(
    baseline.providerObservations.find(
      (observation) => observation.binding.nativeScope === ".scratch/other",
    )?.id,
  );
});

test("bound reconciliation never falls back to full capture and retains prior current evidence on failure", async () => {
  const root = await createValidBearingRepo();
  const binding = { provider: "matt-skills/v1" as const, nativeScope: ".scratch/work" };
  const baseline = await prepareSync(root, {
    providerObservationIntent: "initial-baseline",
    providerFactory: () => ({
      id: "matt-skills/v1",
      capture: async () => observationFor(binding, "2026-07-31T02:00:00.000Z", "Prior"),
    }),
  });
  await commitSyncPlan(baseline);
  const prior = baseline.providerObservations[0];
  if (prior === undefined) throw new Error("Expected prior observation.");
  const calls = { capture: 0, reconcile: 0 };
  const request = normalizeNativeReconciliationRequest({
    binding,
    subjects: [".scratch/work/issues/01-finish.md"],
  });
  const failed = await prepareSync(root, {
    nativeScopeInspectionIntent: { kind: "reconcile", request },
    providerObservationNow: () => "2026-07-31T02:05:00.000Z",
    providerFactory: () => ({
      id: "matt-skills/v1",
      capture: async () => {
        calls.capture += 1;
        return observationFor(binding, "2026-07-31T02:06:00.000Z", "Forbidden");
      },
      reconcile: async () => {
        calls.reconcile += 1;
        throw new ProviderObservationAcquisitionUnavailableError("fixture network failure");
      },
    }),
  });

  expect(calls).toEqual({ capture: 0, reconcile: 1 });
  expect(failed.providerObservationOperation).toEqual({
    intent: "targeted-reconciliation",
    outcome: "retained-after-failure",
    acquisitionCount: 1,
  });
  expect(failed.providerObservations).toEqual([prior]);
  expect(failed.providerObservationSelections[0]).toMatchObject({
    observationId: prior.id,
    effectiveFreshness: "current",
    latestAttempt: {
      intent: "targeted-reconciliation",
      outcome: "failed",
    },
  });
  expect(failed.diagnostics).not.toContainEqual(
    expect.objectContaining({ code: "provider-targeted-reconciliation-failed" }),
  );
});

test("bound reconciliation without a current basis requests recovery without calling capture or reconcile", async () => {
  const root = await createValidBearingRepo();
  const calls = { capture: 0, reconcile: 0 };
  const request = normalizeNativeReconciliationRequest({
    binding: { provider: "matt-skills/v1", nativeScope: ".scratch/work" },
    subjects: [".scratch/work/issues/01-finish.md"],
  });
  const plan = await prepareSync(root, {
    nativeScopeInspectionIntent: { kind: "reconcile", request },
    providerFactory: () => ({
      id: "matt-skills/v1",
      capture: async () => {
        calls.capture += 1;
        throw new Error("Full capture must not run.");
      },
      reconcile: async () => {
        calls.reconcile += 1;
        throw new Error("Reconcile must not run without a current basis.");
      },
    }),
  });

  expect(calls).toEqual({ capture: 0, reconcile: 0 });
  expect(plan.providerObservationOperation).toEqual({
    intent: "targeted-reconciliation",
    outcome: "unavailable",
    acquisitionCount: 0,
  });
  expect(plan.diagnostics).toContainEqual(
    expect.objectContaining({
      code: "provider-targeted-reconciliation-basis-unavailable",
    }),
  );
});

test("Local targeted reconciliation reads no scope directory, coalesces duplicate refs, and preserves Matt-owned bytes and modes", async () => {
  const root = await createValidBearingRepo();
  const binding = { provider: "matt-skills/v1" as const, nativeScope: ".scratch/work" };
  const capturedDocuments = new Map(
    await Promise.all(
      ["docs/agents/issue-tracker.md", "docs/agents/triage-labels.md"].map(async (locator) => {
        const bytes = await readFile(join(root, locator));
        return [locator, { locator, source: bytes.toString("utf8"), bytes }] as const;
      }),
    ),
  );
  const events: {
    kind: "scope-enumerated" | "content-read" | "metadata-verified";
    locator: string;
  }[] = [];
  const provider = createLocalMarkdownMattProvider({
    repoRoot: root,
    contractLocator: "docs/agents/issue-tracker.md",
    capturedDocuments,
    clock: () => new Date("2026-07-31T04:00:00.000Z"),
    onCaptureEvent: (event) => {
      events.push(event);
    },
  });
  const prior = await provider.capture(binding);
  events.length = 0;
  const ticket = ".scratch/work/issues/01-finish.md";
  await writeFixture(
    root,
    ticket,
    `# Finish updated

Type: task

Status: resolved

## Question

Can the fixture finish?

## Answer

Yes, after targeted reconciliation.
`,
  );
  const beforeBytes = await readFile(join(root, ticket));
  const beforeMode = (await lstat(join(root, ticket))).mode;
  const reconciled = await provider.reconcile?.({
    binding,
    prior,
    affected: { subjects: [ticket, ticket], relations: [] },
  });
  if (reconciled === undefined) throw new Error("Expected Local targeted reconciliation.");

  expect(reconciled.state).toBe("available");
  expect(reconciled.freshness.assessment).toBe("current");
  expect(reconciled.projection?.wayfinderTickets[0]?.title).toBe("Finish updated");
  expect(events.filter((event) => event.kind === "scope-enumerated")).toEqual([]);
  expect(events.filter((event) => event.kind === "content-read")).toEqual([
    { kind: "content-read", locator: ticket },
  ]);
  expect(events.filter((event) => event.kind === "metadata-verified")).toEqual([
    { kind: "metadata-verified", locator: ticket },
  ]);
  expect(await readFile(join(root, ticket))).toEqual(beforeBytes);
  expect((await lstat(join(root, ticket))).mode).toBe(beforeMode);

  events.length = 0;
  const followUp = ".scratch/work/issues/02-follow-up.md";
  await writeFixture(
    root,
    followUp,
    `# Follow up

Type: task

Blocked by: 01

Status: claimed

Claimed by: fixture-agent

## Question

Does targeted relation reconciliation remain complete?
`,
  );
  const withRelation = await provider.reconcile?.({
    binding,
    prior: reconciled,
    affected: {
      subjects: [followUp],
      relations: [{ kind: "blocked-by", source: followUp, target: ticket }],
    },
  });
  if (withRelation === undefined) throw new Error("Expected Local relation reconciliation.");
  expect(
    withRelation.projection?.graph.blockedBy.map((relation) => ({
      blocked: String(relation.blocked),
      blocker: String(relation.blocker),
      evidence: relation.evidence,
    })),
  ).toContainEqual({
    blocked: followUp,
    blocker: ticket,
    evidence: "matt-contract",
  });
  expect(events.filter((event) => event.kind === "content-read")).toEqual([
    { kind: "content-read", locator: ticket },
    { kind: "content-read", locator: followUp },
  ]);
  expect(events.filter((event) => event.kind === "scope-enumerated")).toEqual([]);
});

test("Local targeted reconciliation removes incident blocked-by edges after deletion or ticket role change", async () => {
  for (const scenario of ["delete-blocker", "delete-blocked", "role-change"] as const) {
    const root = await createValidBearingRepo();
    const binding = { provider: "matt-skills/v1" as const, nativeScope: ".scratch/work" };
    const blocker = ".scratch/work/issues/01-finish.md";
    const blocked = ".scratch/work/issues/02-follow-up.md";
    await writeFixture(
      root,
      blocked,
      `# Follow up

Type: task

Blocked by: 01

Status: claimed

Claimed by: fixture-agent

## Question

Is the dependency still a ticket?
`,
    );
    const capturedDocuments = new Map(
      await Promise.all(
        ["docs/agents/issue-tracker.md", "docs/agents/triage-labels.md"].map(async (locator) => {
          const bytes = await readFile(join(root, locator));
          return [locator, { locator, source: bytes.toString("utf8"), bytes }] as const;
        }),
      ),
    );
    const provider = createLocalMarkdownMattProvider({
      repoRoot: root,
      contractLocator: "docs/agents/issue-tracker.md",
      capturedDocuments,
    });
    const prior = await provider.capture(binding);
    expect(prior.projection?.graph.blockedBy).toHaveLength(1);

    if (scenario === "delete-blocker") {
      await unlink(join(root, blocker));
    } else if (scenario === "delete-blocked") {
      await unlink(join(root, blocked));
    } else {
      await writeFixture(
        root,
        blocker,
        `# Reclassified report

Category: enhancement
Status: needs-triage

This subject is no longer a Wayfinder or Delivery ticket.
`,
      );
    }
    const reconciled = await provider.reconcile?.({
      binding,
      prior,
      affected: {
        subjects: [scenario === "delete-blocked" ? blocked : blocker],
        relations: [{ kind: "blocked-by", source: blocked, target: blocker }],
      },
    });
    if (reconciled === undefined) throw new Error("Expected Local targeted reconciliation.");

    expect(reconciled.projection?.graph.blockedBy).toEqual([]);
  }
});

test("GitHub targeted reconciliation reads one affected subject and its bounded relations without scope traversal or mutation", async () => {
  const root = await createGitHubMattRepository();
  const nativeScope = githubNativeScopeFor(githubIncomingIssue);
  const binding = { provider: "matt-skills/v1" as const, nativeScope };
  const baselineTransport = new FixtureGitHubTransport({
    "repos/example/reference": {
      first: githubFixtureResponse(githubRepository, '"repo-v1"'),
    },
    "repos/example/reference/issues/109": {
      first: githubFixtureResponse(githubIncomingIssue, '"issue-v1"'),
    },
    "repos/example/reference/issues/109/comments?per_page=100&page=1": {
      first: githubFixtureResponse([], '"comments-v1"'),
    },
    "repos/example/reference/issues/109/dependencies/blocked_by?per_page=100&page=1": {
      first: githubFixtureResponse([], '"dependencies-v1"'),
    },
  });
  const prior = await createGitHubMattProvider({
    repoRoot: root,
    contractLocator: githubContractLocator,
    triageLocator: githubTriageLocator,
    transport: baselineTransport,
    clock: () => new Date("2026-07-31T05:00:00.000Z"),
  }).capture(binding);
  const dependency = githubIssue({
    number: 110,
    title: "External dependency",
    body: "Dependency body.",
    labels: ["custom-enhancement", "custom-ready"],
  });
  const mutated = {
    ...githubIncomingIssue,
    title: "Updated by Matt",
    updated_at: "2026-07-31T05:05:00Z",
  };
  const remoteBefore = JSON.stringify({ mutated, dependency });
  const targetedTransport = new FixtureGitHubTransport({
    "repos/example/reference": {
      first: githubFixtureResponse(githubRepository, '"repo-v2"'),
    },
    "repos/example/reference/issues/109": {
      first: githubFixtureResponse(mutated, '"issue-v2"'),
    },
    "repos/example/reference/issues/109/comments?per_page=100&page=1": {
      first: githubFixtureResponse([], '"comments-v2"'),
    },
    "repos/example/reference/issues/109/dependencies/blocked_by?per_page=100&page=1": {
      first: githubFixtureResponse([dependency], '"dependencies-v2"'),
    },
    "repos/example/reference/issues/109/sub_issues?per_page=100&page=1": {
      first: { status: 410, headers: {} },
    },
  });
  const provider = createGitHubMattProvider({
    repoRoot: root,
    contractLocator: githubContractLocator,
    triageLocator: githubTriageLocator,
    transport: targetedTransport,
    clock: () => new Date("2026-07-31T05:06:00.000Z"),
  });
  const reconciled = await provider.reconcile?.({
    binding,
    prior,
    affected: {
      subjects: [githubIncomingIssue.html_url, githubIncomingIssue.html_url],
      relations: [],
    },
  });
  if (reconciled === undefined) throw new Error("Expected GitHub targeted reconciliation.");

  expect(reconciled.state).toBe("available");
  expect(reconciled.freshness.assessment).toBe("current");
  expect(reconciled.projection?.incomingIssues[0]?.title).toBe("Updated by Matt");
  expect(reconciled.projection?.incomingIssues[0]?.native.sourceAnchors).toContainEqual({
    kind: "external",
    target: dependency.html_url,
  });
  const initialRequests = targetedTransport.requests.filter(
    (request) => request.validator === undefined,
  );
  expect(
    initialRequests.filter((request) => request.endpoint === "repos/example/reference/issues/109"),
  ).toHaveLength(1);
  expect(initialRequests.filter((request) => request.endpoint.includes("/issues?"))).toHaveLength(
    0,
  );
  expect(
    targetedTransport.requests.filter((request) => request.endpoint.includes("/sub_issues")),
  ).toHaveLength(2);
  expect(JSON.stringify({ mutated, dependency })).toBe(remoteBefore);
  expect(JSON.stringify(reconciled)).not.toContain("ghp_");

  const invalidTransport = new FixtureGitHubTransport({
    "repos/example/reference": {
      first: githubFixtureResponse(githubRepository, '"repo-v3"'),
    },
  });
  const invalid = await createGitHubMattProvider({
    repoRoot: root,
    contractLocator: githubContractLocator,
    triageLocator: githubTriageLocator,
    transport: invalidTransport,
    clock: () => new Date("2026-07-31T05:07:00.000Z"),
  }).reconcile?.({
    binding,
    prior,
    affected: {
      subjects: ["https://ghp_secret_value@github.com/example/reference/issues/109"],
      relations: [],
    },
  });
  expect(JSON.stringify(invalid)).not.toContain("ghp_secret_value");
});
