import { expect, test } from "bun:test";
import { projectSnapshotSchema } from "../src/project-snapshot/schema";
import { createProjectOverviewFixture } from "./fixtures/project-overview";

const parses = (snapshot: unknown): boolean => projectSnapshotSchema.safeParse(snapshot).success;

test("rejects cached Effort state that contradicts complete native work", () => {
  const snapshot = createProjectOverviewFixture();
  if (snapshot.efforts.validity !== "available") throw new Error("Expected Efforts fixture.");
  const efforts = snapshot.efforts.items;

  const withEffortState = (id: string, derivedState: "active" | "resolved" | "unknown") => ({
    ...snapshot,
    efforts: {
      validity: "available" as const,
      items: efforts.map((effort) => (effort.id === id ? { ...effort, derivedState } : effort)),
    },
  });

  expect(parses(withEffortState("effort:model", "active"))).toBe(false);
  expect(parses(withEffortState("effort:portal", "resolved"))).toBe(false);
  expect(parses(withEffortState("effort:portal", "unknown"))).toBe(false);
});

test("requires every Map to be resolved with zero Fog before an Effort is resolved", () => {
  const snapshot = createProjectOverviewFixture();
  if (
    snapshot.efforts.validity !== "available" ||
    snapshot.gates.validity !== "available" ||
    snapshot.maps.validity !== "available"
  ) {
    throw new Error("Expected Efforts, Gates, and Maps fixture.");
  }
  const efforts = snapshot.efforts.items;
  const gates = snapshot.gates.items;
  const maps = snapshot.maps.items;
  const withNonterminalModelMap = (state: "active" | "resolved", fogCount: number) => ({
    ...snapshot,
    efforts: {
      validity: "available" as const,
      items: efforts.map((effort) =>
        effort.id === "effort:model"
          ? { ...effort, frontier: { ...effort.frontier, fogCount } }
          : effort,
      ),
    },
    gates: {
      validity: "available" as const,
      items: gates.map((gate) =>
        gate.id === "gate:one" ? { ...gate, readiness: "not-ready" as const } : gate,
      ),
    },
    maps: {
      validity: "available" as const,
      items: maps.map((map) =>
        map.effortId === "effort:model" ? { ...map, state, fogCount } : map,
      ),
    },
  });

  expect(parses(withNonterminalModelMap("active", 0))).toBe(false);
  expect(parses(withNonterminalModelMap("resolved", 1))).toBe(false);
});

test("requires a blocked Ticket to retain an unresolved native blocker", () => {
  const snapshot = createProjectOverviewFixture();
  if (snapshot.tickets.validity !== "available") throw new Error("Expected Tickets fixture.");
  const tickets = snapshot.tickets.items;
  const withBlockedBy = (blockedBy: readonly string[]) => ({
    ...snapshot,
    tickets: {
      validity: "available" as const,
      items: tickets.map((ticket) =>
        ticket.state === "blocked" ? { ...ticket, blockedBy } : ticket,
      ),
    },
  });

  expect(parses(withBlockedBy([]))).toBe(false);
  expect(parses(withBlockedBy([".scratch/model/issues/01-resolve.md"]))).toBe(false);
});

test("allows a ready Ticket only when every known blocker is resolved", () => {
  const snapshot = createProjectOverviewFixture();
  if (snapshot.tickets.validity !== "available") throw new Error("Expected Tickets fixture.");
  const tickets = snapshot.tickets.items;
  const withReadyBlockedBy = (blockedBy: readonly string[]) => ({
    ...snapshot,
    tickets: {
      validity: "available" as const,
      items: tickets.map((ticket) =>
        ticket.state === "ready" ? { ...ticket, blockedBy } : ticket,
      ),
    },
  });

  expect(parses(withReadyBlockedBy([".scratch/portal/issues/01-build.md"]))).toBe(false);
  expect(parses(withReadyBlockedBy([".scratch/model/issues/01-resolve.md"]))).toBe(true);
});

test("rejects a ready Ticket when a partial projection hides its blocker", () => {
  const snapshot = createProjectOverviewFixture();
  if (
    snapshot.efforts.validity !== "available" ||
    snapshot.gates.validity !== "available" ||
    snapshot.tickets.validity !== "available"
  ) {
    throw new Error("Expected Efforts, Gates, and Tickets fixture.");
  }
  const hiddenBlocker = ".scratch/portal/issues/02-review.md";
  const promotedTicket = ".scratch/portal/issues/03-gate.md";

  expect(
    parses({
      ...snapshot,
      efforts: {
        validity: "available",
        items: snapshot.efforts.items.map((effort) =>
          effort.id === "effort:portal"
            ? {
                ...effort,
                derivedState: "unknown",
                frontier: {
                  ...effort.frontier,
                  ready: [hiddenBlocker, promotedTicket],
                  blocked: [],
                },
              }
            : effort,
        ),
      },
      gates: {
        validity: "available",
        items: snapshot.gates.items.map((gate) =>
          gate.id === "gate:two" ? { ...gate, readiness: "unknown" } : gate,
        ),
      },
      tickets: {
        validity: "partial",
        items: snapshot.tickets.items
          .filter((ticket) => ticket.reference !== hiddenBlocker)
          .map((ticket) =>
            ticket.reference === promotedTicket ? { ...ticket, state: "ready" } : ticket,
          ),
        issues: [
          {
            code: "invalid-native-ticket",
            target: hiddenBlocker,
            message: "One native Ticket is structurally uncertain.",
          },
        ],
      },
    }),
  ).toBe(false);
});

test("requires unknown Effort state inside a partial native Ticket scope", () => {
  const snapshot = createProjectOverviewFixture();
  if (
    snapshot.efforts.validity !== "available" ||
    snapshot.gates.validity !== "available" ||
    snapshot.tickets.validity !== "available"
  ) {
    throw new Error("Expected Efforts, Gates, and Tickets fixture.");
  }
  const hiddenTicket = ".scratch/portal/issues/02-review.md";

  expect(
    parses({
      ...snapshot,
      gates: {
        validity: "available",
        items: snapshot.gates.items.map((gate) =>
          gate.id === "gate:two" ? { ...gate, readiness: "unknown" } : gate,
        ),
      },
      tickets: {
        validity: "partial",
        items: snapshot.tickets.items.filter((ticket) => ticket.reference !== hiddenTicket),
        issues: [
          {
            code: "invalid-native-ticket",
            target: hiddenTicket,
            message: "One native Ticket is structurally uncertain.",
          },
        ],
      },
    }),
  ).toBe(false);
});

test("requires a partial Ticket frontier to retain every trustworthy Ticket", () => {
  const snapshot = createProjectOverviewFixture();
  if (
    snapshot.efforts.validity !== "available" ||
    snapshot.gates.validity !== "available" ||
    snapshot.tickets.validity !== "available"
  ) {
    throw new Error("Expected Efforts, Gates, and Tickets fixture.");
  }
  const issue = {
    code: "invalid-native-ticket",
    target: ".scratch/portal/issues/04-corrupt.md",
    message: "One native Ticket is structurally uncertain.",
  };
  const partial = {
    ...snapshot,
    efforts: {
      validity: "available" as const,
      items: snapshot.efforts.items.map((effort) =>
        effort.id === "effort:portal" ? { ...effort, derivedState: "unknown" as const } : effort,
      ),
    },
    gates: {
      validity: "available" as const,
      items: snapshot.gates.items.map((gate) =>
        gate.id === "gate:two" ? { ...gate, readiness: "unknown" as const } : gate,
      ),
    },
    tickets: { validity: "partial" as const, items: snapshot.tickets.items, issues: [issue] },
  };

  expect(parses(partial)).toBe(true);
  expect(
    parses({
      ...partial,
      efforts: {
        validity: "available",
        items: partial.efforts.items.map((effort) =>
          effort.id === "effort:portal"
            ? {
                ...effort,
                frontier: { ...effort.frontier, claimed: [] },
              }
            : effort,
        ),
      },
    }),
  ).toBe(false);
});

test("preserves claimed, resolved, and triage Ticket priority over blocker rollup", () => {
  const snapshot = createProjectOverviewFixture();
  if (snapshot.efforts.validity !== "available" || snapshot.tickets.validity !== "available") {
    throw new Error("Expected Efforts and Tickets fixture.");
  }
  const efforts = snapshot.efforts.items;
  const tickets = snapshot.tickets.items;
  const withTicket = (
    reference: string,
    state: "claimed" | "ready" | "blocked" | "resolved" | "triage",
    blockedBy: readonly string[],
  ) =>
    tickets.map((ticket) =>
      ticket.reference === reference ? { ...ticket, state, blockedBy } : ticket,
    );
  expect(
    parses({
      ...snapshot,
      tickets: {
        validity: "available",
        items: withTicket(".scratch/portal/issues/01-build.md", "claimed", [
          ".scratch/portal/issues/02-review.md",
        ]),
      },
    }),
  ).toBe(true);
  expect(
    parses({
      ...snapshot,
      tickets: {
        validity: "available",
        items: withTicket(".scratch/model/issues/01-resolve.md", "resolved", [
          ".scratch/portal/issues/01-build.md",
        ]),
      },
    }),
  ).toBe(true);
  expect(
    parses({
      ...snapshot,
      efforts: {
        validity: "available",
        items: efforts.map((effort) =>
          effort.id === "effort:portal"
            ? { ...effort, frontier: { ...effort.frontier, ready: [] } }
            : effort,
        ),
      },
      tickets: {
        validity: "available",
        items: withTicket(".scratch/portal/issues/02-review.md", "triage", [
          ".scratch/portal/issues/01-build.md",
        ]),
      },
    }),
  ).toBe(true);
});

test("allows unknown Effort state when a blocking diagnostic makes its work uncertain", () => {
  const snapshot = createProjectOverviewFixture();
  if (snapshot.efforts.validity !== "available" || snapshot.gates.validity !== "available") {
    throw new Error("Expected Efforts and Gates fixture.");
  }
  const efforts = snapshot.efforts.items;
  const gates = snapshot.gates.items;
  const diagnosticReference = `diagnostic:${"b".repeat(64)}`;
  const uncertain = {
    ...snapshot,
    efforts: {
      validity: "available" as const,
      items: efforts.map((effort) =>
        effort.id === "effort:portal" ? { ...effort, derivedState: "unknown" as const } : effort,
      ),
    },
    gates: {
      validity: "available" as const,
      items: gates.map((gate) =>
        gate.id === "gate:two" ? { ...gate, readiness: "unknown" as const } : gate,
      ),
    },
    diagnostics: [
      ...snapshot.diagnostics,
      {
        reference: diagnosticReference,
        code: "invalid-native-work",
        impact: "blocking" as const,
        target: ".scratch/portal/invalid-work.md",
        message: "The Effort work scope is structurally uncertain.",
      },
    ],
    attention: [
      ...snapshot.attention,
      { kind: "structural-diagnostic" as const, diagnosticReference },
    ],
  };

  expect(parses(uncertain)).toBe(true);
});

test("derives unknown only when a complete Effort has no native child work", () => {
  const snapshot = createProjectOverviewFixture();
  if (
    snapshot.efforts.validity !== "available" ||
    snapshot.gates.validity !== "available" ||
    snapshot.maps.validity !== "available" ||
    snapshot.tickets.validity !== "available"
  ) {
    throw new Error("Expected complete native-work fixture.");
  }
  const withoutModelWork = {
    ...snapshot,
    efforts: {
      validity: "available" as const,
      items: snapshot.efforts.items.map((effort) =>
        effort.id === "effort:model"
          ? {
              ...effort,
              derivedState: "unknown" as const,
              frontier: { claimed: [], ready: [], blocked: [], resolved: [], fogCount: 0 },
            }
          : effort,
      ),
    },
    gates: {
      validity: "available" as const,
      items: snapshot.gates.items.map((gate) =>
        gate.id === "gate:one" ? { ...gate, readiness: "unknown" as const } : gate,
      ),
    },
    maps: {
      validity: "available" as const,
      items: snapshot.maps.items.filter((map) => map.effortId !== "effort:model"),
    },
    tickets: {
      validity: "available" as const,
      items: snapshot.tickets.items.filter((ticket) => ticket.effortId !== "effort:model"),
    },
  };

  expect(parses(withoutModelWork)).toBe(true);
  expect(
    parses({
      ...withoutModelWork,
      efforts: {
        ...withoutModelWork.efforts,
        items: withoutModelWork.efforts.items.map((effort) =>
          effort.id === "effort:model" ? { ...effort, derivedState: "active" as const } : effort,
        ),
      },
    }),
  ).toBe(false);
});

test("does not fabricate complete work truth from partial or invalid Ticket projections", () => {
  const snapshot = createProjectOverviewFixture();
  if (
    snapshot.efforts.validity !== "available" ||
    snapshot.gates.validity !== "available" ||
    snapshot.tickets.validity !== "available"
  ) {
    throw new Error("Expected Efforts, Gates, and Tickets fixture.");
  }
  const ticketsWithoutKnownBlocker = snapshot.tickets.items.filter(
    (ticket) => ticket.reference !== ".scratch/portal/issues/02-review.md",
  );
  const issue = {
    code: "invalid-native-ticket",
    target: ".scratch/portal/issues/02-review.md",
    message: "One native Ticket is structurally uncertain.",
  };
  const uncertainEfforts = snapshot.efforts.items.map((effort) =>
    effort.id === "effort:portal" ? { ...effort, derivedState: "unknown" as const } : effort,
  );
  const uncertainGates = snapshot.gates.items.map((gate) =>
    gate.id === "gate:two" ? { ...gate, readiness: "unknown" as const } : gate,
  );

  expect(
    parses({
      ...snapshot,
      efforts: { validity: "available", items: uncertainEfforts },
      gates: { validity: "available", items: uncertainGates },
      tickets: { validity: "partial", items: ticketsWithoutKnownBlocker, issues: [issue] },
    }),
  ).toBe(true);
  expect(
    parses({
      ...snapshot,
      efforts: {
        validity: "available",
        items: snapshot.efforts.items.map((effort) => ({
          ...effort,
          derivedState: "unknown" as const,
        })),
      },
      gates: {
        validity: "available",
        items: snapshot.gates.items.map((gate) => ({
          ...gate,
          readiness: "unknown" as const,
        })),
      },
      tickets: {
        validity: "invalid",
        issues: [
          issue,
          {
            code: "invalid-native-ticket",
            target: ".scratch/model/issues/01-resolve.md",
            message: "One native Ticket is structurally uncertain.",
          },
        ],
      },
    }),
  ).toBe(true);
});
