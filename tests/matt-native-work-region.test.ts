import { expect, test } from "bun:test";
import {
  buildMattNativeWorkRegion,
  type MattNativeWorkRegionContext,
} from "../src/providers/matt-skills-v1/work-region";
import { createProjectOverviewFixture } from "./fixtures/project-overview";

const fixture = () => {
  const snapshot = createProjectOverviewFixture();
  const observation = snapshot.providerObservations.find(
    (candidate) => candidate.binding.nativeScope === ".scratch/portal",
  );
  if (observation === undefined) throw new Error("Expected the Portal provider observation.");
  return {
    observation,
    selections: snapshot.providerObservationSelections,
  };
};

const build = (context: MattNativeWorkRegionContext) => {
  const { observation, selections } = fixture();
  return buildMattNativeWorkRegion(observation, selections, context);
};

test("presents one role-first native region in a bound context", () => {
  const bound = build({ state: "bound", effortIds: ["effort:portal"] });

  expect(bound.context).toEqual({
    state: "bound",
    label: "Contributing Work",
    effortIds: ["effort:portal"],
  });
  expect(bound.roles.map((role) => role.role)).toEqual([
    "map",
    "spec",
    "wayfinder",
    "delivery",
    "incoming",
  ]);
  expect(bound.total).toEqual({ mode: "exact", value: 6 });
  expect(bound.roles.map((role) => role.count)).toEqual([
    { mode: "exact", value: 1 },
    { mode: "exact", value: 1 },
    { mode: "exact", value: 2 },
    { mode: "exact", value: 1 },
    { mode: "exact", value: 1 },
  ]);
});

test("keeps Wayfinder, Delivery, and Incoming facts independent while deriving orientation", () => {
  const region = build({ state: "bound", effortIds: ["effort:portal"] });
  const wayfinder = region.roles.find((role) => role.role === "wayfinder");
  const delivery = region.roles.find((role) => role.role === "delivery");
  const incoming = region.roles.find((role) => role.role === "incoming");

  expect(wayfinder?.items.map((item) => [item.title, item.frontier])).toEqual([
    ["Build the Roadmap journey", "claimed"],
    ["Review the Roadmap journey", "ready"],
  ]);
  expect(wayfinder?.items[0]).toMatchObject({
    claimant: "lago",
    answerAvailability: "unavailable",
    trackerClosure: "open",
  });
  expect(delivery?.items[0]).toMatchObject({
    frontier: "blocked",
    blockers: [".scratch/portal/issues/02-review.md"],
    trackerClosure: "open",
  });
  expect(delivery?.items[0]).not.toHaveProperty("claimant");
  expect(incoming?.items[0]).toMatchObject({
    category: "enhancement",
    routingState: "ready-for-agent",
    nativeLifecycle: "open",
  });
  expect(incoming?.items[0]?.frontier).not.toBe("ready");
});

test("uses structural Current, History, and All views without flattening role groups", () => {
  const region = build({ state: "bound", effortIds: ["effort:portal"] });

  expect(region.views.map((view) => view.key)).toEqual(["current", "history", "all"]);
  expect(region.views[0]?.items.map((item) => item.reference)).toEqual(
    region.roles.flatMap((role) => role.items.map((item) => item.reference)),
  );
  expect(region.views[1]?.items).toEqual([]);
  expect(region.views[2]?.groups?.map((group) => group.role)).toEqual([
    "map",
    "spec",
    "wayfinder",
    "delivery",
    "incoming",
  ]);
});

test("publishes a complete Map chapter with truthful totals and bounded previews", () => {
  const { observation, selections } = fixture();
  if (
    (observation.state !== "available" && observation.state !== "partial") ||
    observation.projection.map === undefined
  ) {
    throw new Error("Expected a readable Map.");
  }
  const region = buildMattNativeWorkRegion(
    {
      ...observation,
      projection: {
        ...observation.projection,
        map: {
          ...observation.projection.map,
          fog: [
            ...observation.projection.map.fog,
            "Confirm the final preview cap.",
            "Keep the full total truthful.",
          ],
        },
      },
    },
    selections,
    { state: "bound", effortIds: ["effort:portal"] },
  );

  expect(region.mapChapter).toMatchObject({
    availability: "available",
    reference: ".scratch/portal/map.md",
    destination: {
      availability: "available",
      markdown: "Reach the accepted project outcome.",
    },
    lifecycle: "active",
    totals: {
      fog: { mode: "exact", value: 4 },
      decisions: { mode: "exact", value: 0 },
      outOfScope: { mode: "exact", value: 0 },
    },
  });
  if (region.mapChapter?.availability !== "available") {
    throw new Error("Expected an available Map chapter.");
  }
  expect(region.mapChapter.previews.fog).toHaveLength(3);
  expect(region.mapChapter.previews.decisions).toHaveLength(0);
  expect(region.mapChapter.previews.outOfScope).toHaveLength(0);
});

test("preserves scoped Map Destination availability instead of rendering empty content", () => {
  const { observation, selections } = fixture();
  if (
    (observation.state !== "available" && observation.state !== "partial") ||
    observation.projection.map === undefined
  ) {
    throw new Error("Expected a readable Map.");
  }
  const map = observation.projection.map;
  const region = buildMattNativeWorkRegion(
    {
      ...observation,
      projection: {
        ...observation.projection,
        map: {
          ...map,
          destination: map.destination.map((section) => ({
            ...section,
            availability: "unavailable" as const,
            markdown: "",
          })),
          semanticSections: map.semanticSections.map((section) =>
            section.role === "map.destination"
              ? { ...section, availability: "unavailable" as const }
              : section,
          ),
        },
      },
    },
    selections,
    { state: "bound", effortIds: ["effort:portal"] },
  );

  expect(region.mapChapter).toMatchObject({
    availability: "available",
    destination: { availability: "unavailable" },
  });
});

test("applies terminal and blocker precedence without erasing a blocked claimant", () => {
  const { observation, selections } = fixture();
  if (
    (observation.state !== "available" && observation.state !== "partial") ||
    observation.projection.map === undefined
  ) {
    throw new Error("Expected readable native work.");
  }
  const claimed = observation.projection.wayfinderTickets[0];
  const ready = observation.projection.wayfinderTickets[1];
  const delivery = observation.projection.deliveryTickets[0];
  if (claimed === undefined || ready === undefined || delivery === undefined) {
    throw new Error("Expected frontier fixtures.");
  }
  const terminal = {
    ...ready,
    lifecycle: {
      state: "resolved-on-route" as const,
      decisionSource: {
        kind: "decision" as const,
        target: ".scratch/portal/map.md#decision-terminal",
      },
    },
  };
  const completed = {
    ...delivery,
    lifecycle: {
      state: "completed" as const,
      evidence: ["Verified completion evidence."],
    },
  };
  const blockedByMap = [
    {
      blocked: claimed.ref,
      blocker: observation.projection.map.ref,
      evidence: "matt-contract" as const,
    },
    {
      blocked: terminal.ref,
      blocker: observation.projection.map.ref,
      evidence: "matt-contract" as const,
    },
    {
      blocked: completed.ref,
      blocker: observation.projection.map.ref,
      evidence: "matt-contract" as const,
    },
  ];
  const region = buildMattNativeWorkRegion(
    {
      ...observation,
      projection: {
        ...observation.projection,
        wayfinderTickets: [claimed, terminal],
        deliveryTickets: [completed],
        graph: {
          ...observation.projection.graph,
          blockedBy: blockedByMap,
        },
      },
    },
    selections,
    { state: "bound", effortIds: ["effort:portal"] },
  );

  expect(region.roles.find((role) => role.role === "wayfinder")?.items).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        title: "Build the Roadmap journey",
        frontier: "blocked",
        claimant: "lago",
      }),
      expect.objectContaining({
        title: "Review the Roadmap journey",
        frontier: "resolved",
      }),
    ]),
  );
  expect(region.roles.find((role) => role.role === "delivery")?.items[0]).toMatchObject({
    frontier: "resolved",
    completionEvidence: ["Verified completion evidence."],
  });
});

test("uses at-least counts and role uncertainty when provider coverage is partial", () => {
  const { observation, selections } = fixture();
  if (observation.state !== "available" && observation.state !== "partial") {
    throw new Error("Expected readable provider semantics.");
  }
  const partial = {
    ...observation,
    state: "partial" as const,
    coverage: {
      assessment: "incomplete" as const,
      dimensions: [{ key: "scope", state: "gap" as const }],
    },
  };
  const region = buildMattNativeWorkRegion(partial, selections, {
    state: "bound",
    effortIds: ["effort:portal"],
  });

  expect(region.total).toEqual({ mode: "at-least", value: 6 });
  expect(region.roles.map((role) => role.count.mode)).toEqual([
    "at-least",
    "at-least",
    "at-least",
    "at-least",
    "at-least",
  ]);
  expect(region.roles.find((role) => role.role === "wayfinder")?.items[1]?.frontier).toBe(
    "uncertain",
  );
});

test("distinguishes confirmed-empty roles from unavailable roles and an unresolved capture", () => {
  const { observation, selections } = fixture();
  if (observation.state !== "available" && observation.state !== "partial") {
    throw new Error("Expected readable provider semantics.");
  }
  const withoutIncoming = {
    ...observation,
    projection: {
      ...observation.projection,
      incomingIssues: [],
      structuralOrder: observation.projection.structuralOrder.filter(
        (reference) => !reference.endsWith("04-incoming.md"),
      ),
    },
  };
  const complete = buildMattNativeWorkRegion(withoutIncoming, selections, {
    state: "bound",
    effortIds: ["effort:portal"],
  });
  const partial = buildMattNativeWorkRegion(
    {
      ...withoutIncoming,
      state: "partial",
      coverage: {
        assessment: "incomplete",
        dimensions: [{ key: "scope", state: "gap" }],
      },
    },
    selections,
    { state: "bound", effortIds: ["effort:portal"] },
  );
  const unresolved = buildMattNativeWorkRegion(undefined, selections, {
    state: "attention",
    reason: "bound-unresolved",
    effortIds: ["effort:portal"],
  });

  expect(complete.roles.find((role) => role.role === "incoming")).toMatchObject({
    availability: "confirmed-empty",
    count: { mode: "exact", value: 0 },
  });
  expect(partial.roles.find((role) => role.role === "incoming")).toMatchObject({
    availability: "unavailable",
    count: { mode: "at-least", value: 0 },
  });
  expect(unresolved).toMatchObject({
    context: { state: "attention", reason: "bound-unresolved" },
    total: { mode: "unavailable" },
    mapChapter: { availability: "unavailable" },
  });
  expect(unresolved.roles.every((role) => role.availability === "unavailable")).toBe(true);
});

test("preserves anomalies as facts and scoped diagnostics instead of repairing native state", () => {
  const { observation, selections } = fixture();
  if (observation.state !== "available" && observation.state !== "partial") {
    throw new Error("Expected readable provider semantics.");
  }
  const wayfinder = observation.projection.wayfinderTickets[0];
  const incoming = observation.projection.incomingIssues[0];
  if (wayfinder === undefined || incoming === undefined)
    throw new Error("Expected native fixtures.");
  const anomalous = {
    ...observation,
    projection: {
      ...observation.projection,
      wayfinderTickets: [
        {
          ...wayfinder,
          answer: {
            availability: "available" as const,
            content: {
              role: "answer" as const,
              document: wayfinder.question.map((section) => ({
                ...section,
                sourceIdentity: "wayfinder.answer",
                semanticRole: "wayfinder.answer",
                title: "Answer",
              })),
              authoredAt: { availability: "unsupported" as const },
            },
          },
          semanticSections: wayfinder.semanticSections.map((section) =>
            section.role === "wayfinder.answer"
              ? { ...section, availability: "available" as const }
              : section,
          ),
        },
        ...observation.projection.wayfinderTickets.slice(1),
      ],
      incomingIssues: [
        {
          ...incoming,
          classification: {
            ...incoming.classification,
            state: "wontfix" as const,
          },
        },
      ],
    },
  };
  const region = buildMattNativeWorkRegion(anomalous, selections, {
    state: "bound",
    effortIds: ["effort:portal"],
  });

  expect(region.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
    "matt.work-region.answer-present-while-open",
  );
  expect(region.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
    "matt.work-region.wontfix-lifecycle-disagreement",
  );
  expect(region.roles.find((role) => role.role === "wayfinder")?.items[0]).toMatchObject({
    frontier: "claimed",
    answerAvailability: "available",
    nativeLifecycle: "open",
  });
  expect(region.roles.find((role) => role.role === "incoming")?.items[0]).toMatchObject({
    routingState: "wontfix",
    nativeLifecycle: "open",
  });
});

test("covers closure and decision anomalies without promoting native lifecycle", () => {
  const { observation, selections } = fixture();
  if (observation.state !== "available" && observation.state !== "partial") {
    throw new Error("Expected readable provider semantics.");
  }
  const firstWayfinder = observation.projection.wayfinderTickets[0];
  const secondWayfinder = observation.projection.wayfinderTickets[1];
  const delivery = observation.projection.deliveryTickets[0];
  if (firstWayfinder === undefined || secondWayfinder === undefined || delivery === undefined) {
    throw new Error("Expected Wayfinder and Delivery fixtures.");
  }
  const anomalous = {
    ...observation,
    projection: {
      ...observation.projection,
      wayfinderTickets: [
        {
          ...firstWayfinder,
          trackerClosure: {
            state: "closed" as const,
            disposition: "unknown" as const,
            closedAt: { availability: "unsupported" as const },
          },
        },
        {
          ...secondWayfinder,
          lifecycle: {
            state: "resolved-on-route" as const,
            decisionSource: {
              kind: "decision" as const,
              target: ".scratch/portal/map.md#decision-2",
            },
          },
        },
      ],
      deliveryTickets: [
        {
          ...delivery,
          trackerClosure: {
            state: "closed" as const,
            disposition: "unknown" as const,
            closedAt: { availability: "unsupported" as const },
          },
        },
      ],
    },
  };
  const region = buildMattNativeWorkRegion(anomalous, selections, {
    state: "bound",
    effortIds: ["effort:portal"],
  });

  expect(region.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
    expect.arrayContaining([
      "matt.work-region.closure-without-resolution",
      "matt.work-region.decision-without-answer",
      "matt.work-region.closure-without-completion",
    ]),
  );
  expect(region.roles.find((role) => role.role === "wayfinder")?.items[1]).toMatchObject({
    frontier: "resolved",
    answerAvailability: "unavailable",
    decisionEvidence: {
      kind: "decision",
      target: ".scratch/portal/map.md#decision-2",
    },
  });
  expect(region.roles.find((role) => role.role === "delivery")?.items[0]).toMatchObject({
    frontier: "ready",
    trackerClosure: "closed",
  });
  expect(region.roles.find((role) => role.role === "delivery")?.items[0]?.frontier).not.toBe(
    "resolved",
  );
});

test("places provider subject diagnostics beside the affected native item in plain language", () => {
  const { observation, selections } = fixture();
  if (observation.state !== "available" && observation.state !== "partial") {
    throw new Error("Expected readable provider semantics.");
  }
  const ticket = observation.projection.deliveryTickets[0];
  if (ticket === undefined) throw new Error("Expected a Delivery ticket.");
  const diagnostic = {
    code: "matt.delivery.answer-conflict",
    class: "mapping" as const,
    impact: "blocking" as const,
    target: `${ticket.ref}#answer`,
    message: "The Delivery Answer sources conflict.",
  };
  const degraded = {
    ...observation,
    completion: "undetermined" as const,
    diagnostics: [...observation.diagnostics, diagnostic],
  };
  const region = buildMattNativeWorkRegion(degraded, selections, {
    state: "bound",
    effortIds: ["effort:portal"],
  });
  const item = region.roles
    .find((role) => role.role === "delivery")
    ?.items.find((candidate) => candidate.reference === ticket.ref);

  expect(item).toMatchObject({
    diagnosticCodes: ["matt.delivery.answer-conflict"],
    diagnosticMessages: ["The Delivery Answer sources conflict."],
  });
  expect(region.readingState.why.causes).toContain("The Delivery Answer sources conflict.");
});

test("keeps binding failures in a separate attention context", () => {
  const conflict = build({
    state: "attention",
    reason: "binding-conflict",
    effortIds: ["effort:one", "effort:two"],
  });
  const unresolved = build({
    state: "attention",
    reason: "bound-unresolved",
    effortIds: ["effort:one"],
  });
  const mismatch = build({
    state: "attention",
    reason: "identity-mismatch",
    effortIds: ["effort:one"],
  });

  for (const region of [conflict, unresolved, mismatch]) {
    expect(region.context.state).toBe("attention");
    expect(region.context.label).toBe("Binding needs attention");
  }
});
