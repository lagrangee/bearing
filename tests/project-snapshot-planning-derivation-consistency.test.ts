import { expect, test } from "bun:test";
import { projectSnapshotSchema } from "../src/project-snapshot/schema";
import { createProjectOverviewFixture } from "./fixtures/project-overview";

const issue = {
  code: "scoped-projection-failure",
  target: ".scratch/portal/map.md",
  message: "One planning relation is unavailable.",
} as const;

const rejects = (snapshot: unknown): void => {
  expect(projectSnapshotSchema.safeParse(snapshot).success).toBe(false);
};

test("rejects tampered Roadmap and Gate horizon caches", () => {
  const snapshot = createProjectOverviewFixture();
  if (snapshot.roadmaps.validity !== "available" || snapshot.gates.validity !== "available") {
    throw new Error("Expected complete planning fixture.");
  }

  rejects({
    ...snapshot,
    roadmaps: {
      validity: "available",
      items: snapshot.roadmaps.items.map((roadmap) =>
        roadmap.id === "roadmap:portal" ? { ...roadmap, horizon: "exhausted" } : roadmap,
      ),
    },
  });
  rejects({
    ...snapshot,
    gates: {
      validity: "available",
      items: snapshot.gates.items.map((gate) =>
        gate.id === "gate:two" ? { ...gate, horizonState: "planned" } : gate,
      ),
    },
  });
});

test("rejects Gate readiness that disagrees with a complete native work graph", () => {
  const snapshot = createProjectOverviewFixture();
  if (snapshot.gates.validity !== "available") throw new Error("Expected complete Gate fixture.");

  rejects({
    ...snapshot,
    gates: {
      validity: "available",
      items: snapshot.gates.items.map((gate) =>
        gate.id === "gate:two" ? { ...gate, readiness: "ready-for-review" } : gate,
      ),
    },
  });
  rejects({
    ...snapshot,
    gates: {
      validity: "available",
      items: snapshot.gates.items.map((gate) =>
        gate.id === "gate:one" ? { ...gate, readiness: "unknown" } : gate,
      ),
    },
  });
});

test("derives unknown readiness when a blocking diagnostic falls inside Effort source scope", () => {
  const snapshot = createProjectOverviewFixture();
  if (snapshot.gates.validity !== "available") throw new Error("Expected complete Gate fixture.");
  const diagnostic = {
    reference: `diagnostic:${"d".repeat(64)}`,
    code: "invalid-native-work",
    impact: "blocking" as const,
    target: ".scratch/portal/issues/99-invalid.md",
    message: "Native work has a blocking structural diagnostic.",
  };
  const withDiagnostic = {
    ...snapshot,
    diagnostics: [...snapshot.diagnostics, diagnostic],
    attention: [
      ...snapshot.attention,
      { kind: "structural-diagnostic" as const, diagnosticReference: diagnostic.reference },
    ],
  };

  expect(
    projectSnapshotSchema.safeParse({
      ...withDiagnostic,
      efforts:
        snapshot.efforts.validity === "invalid"
          ? snapshot.efforts
          : {
              ...snapshot.efforts,
              items: snapshot.efforts.items.map((effort) =>
                effort.id === "effort:portal"
                  ? { ...effort, derivedState: "unknown" as const }
                  : effort,
              ),
            },
      gates: {
        validity: "available",
        items: snapshot.gates.items.map((gate) =>
          gate.id === "gate:two" ? { ...gate, readiness: "unknown" } : gate,
        ),
      },
    }).success,
  ).toBe(true);
  rejects(withDiagnostic);
});

test("scopes partial native uncertainty to its contributing Effort and Gate", () => {
  const snapshot = createProjectOverviewFixture();
  if (
    snapshot.efforts.validity !== "available" ||
    snapshot.gates.validity !== "available" ||
    snapshot.tickets.validity !== "available"
  ) {
    throw new Error("Expected complete native planning fixture.");
  }
  const hiddenTicket = ".scratch/portal/issues/02-review.md";
  const partialNative = {
    ...snapshot,
    efforts: {
      validity: "available" as const,
      items: snapshot.efforts.items.map((effort) =>
        effort.id === "effort:portal" ? { ...effort, derivedState: "unknown" as const } : effort,
      ),
    },
    tickets: {
      validity: "partial" as const,
      items: snapshot.tickets.items.filter((ticket) => ticket.reference !== hiddenTicket),
      issues: [
        {
          code: "invalid-native-ticket",
          target: hiddenTicket,
          message: "One native Ticket is structurally uncertain.",
        },
      ],
    },
  };

  rejects(partialNative);
  const scoped = {
    ...partialNative,
    gates: {
      validity: "available" as const,
      items: snapshot.gates.items.map((gate) =>
        gate.id === "gate:two" ? { ...gate, readiness: "unknown" as const } : gate,
      ),
    },
  };
  expect(projectSnapshotSchema.safeParse(scoped).success).toBe(true);
  rejects({
    ...scoped,
    gates: {
      validity: "available",
      items: scoped.gates.items.map((gate) =>
        gate.id === "gate:one" ? { ...gate, readiness: "not-ready" } : gate,
      ),
    },
  });
});

test("does not over-reject scoped unknown derivations from partial collections", () => {
  const snapshot = createProjectOverviewFixture();
  if (
    snapshot.roadmaps.validity !== "available" ||
    snapshot.gates.validity !== "available" ||
    snapshot.maps.validity !== "available"
  ) {
    throw new Error("Expected complete projection fixture.");
  }
  const gates = snapshot.gates.items.map((gate) =>
    gate.id === "gate:two" ? { ...gate, horizonState: "unknown" as const } : gate,
  );
  const scopedHorizon = {
    ...snapshot,
    roadmapIndex: { validity: "invalid", issues: [issue] },
    roadmaps: {
      validity: "partial",
      items: snapshot.roadmaps.items.filter((roadmap) => roadmap.id !== "roadmap:portal"),
      issues: [issue],
    },
    gates: { validity: "available", items: gates },
  };
  expect(projectSnapshotSchema.safeParse(scopedHorizon).success).toBe(true);

  const unknownReadiness = {
    ...snapshot,
    efforts: {
      validity: "available" as const,
      items:
        snapshot.efforts.validity === "invalid"
          ? []
          : snapshot.efforts.items.map((effort) =>
              effort.id === "effort:portal"
                ? { ...effort, derivedState: "unknown" as const }
                : effort,
            ),
    },
    gates: {
      validity: "available",
      items: snapshot.gates.items.map((gate) =>
        gate.id === "gate:two" ? { ...gate, readiness: "unknown" as const } : gate,
      ),
    },
    maps: { validity: "invalid", issues: [issue] },
  };
  expect(projectSnapshotSchema.safeParse(unknownReadiness).success).toBe(true);
});

test("classifies Gate readiness per contributor when the Effort projection is partial", () => {
  const snapshot = createProjectOverviewFixture();
  if (snapshot.efforts.validity !== "available" || snapshot.gates.validity !== "available") {
    throw new Error("Expected complete Effort and Gate projections.");
  }
  const issue = {
    code: "invalid-effort-body",
    target: ".scratch/portal/effort.md",
    message: "One contributing Effort cannot enter the normalized read model.",
  };
  const partialEfforts = {
    validity: "partial" as const,
    items: snapshot.efforts.items.filter((effort) => effort.id !== "effort:portal"),
    issues: [issue],
  };
  const scoped = {
    ...snapshot,
    efforts: partialEfforts,
    gates: {
      validity: "available" as const,
      items: snapshot.gates.items.map((gate) =>
        gate.id === "gate:two" ? { ...gate, readiness: "unknown" as const } : gate,
      ),
    },
  };

  expect(projectSnapshotSchema.safeParse(scoped).success).toBe(true);
  rejects({
    ...scoped,
    gates: {
      validity: "available",
      items: scoped.gates.items.map((gate) =>
        gate.id === "gate:two" ? { ...gate, readiness: "not-ready" } : gate,
      ),
    },
  });
  rejects({
    ...scoped,
    gates: {
      validity: "available",
      items: scoped.gates.items.map((gate) =>
        gate.id === "gate:one" ? { ...gate, readiness: "unknown" } : gate,
      ),
    },
  });
});

test("matches blocking diagnostics against the whole Effort source scope", () => {
  const snapshot = createProjectOverviewFixture();
  if (
    snapshot.efforts.validity !== "available" ||
    snapshot.gates.validity !== "available" ||
    snapshot.tickets.validity !== "available"
  ) {
    throw new Error("Expected complete native planning projections.");
  }
  const portalTicket = snapshot.tickets.items.find(
    (ticket) => ticket.reference === ".scratch/portal/issues/01-build.md",
  );
  if (portalTicket === undefined) throw new Error("Expected Portal Ticket source.");
  const cases = [
    {
      reference: `diagnostic:${"e".repeat(64)}`,
      target: ".scratch/portal",
    },
    {
      reference: `diagnostic:${"f".repeat(64)}`,
      target: ".bearing/cache/unrelated.md",
      source: portalTicket.source,
    },
  ];

  for (const diagnostic of cases) {
    const projected = {
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
      diagnostics: [
        ...snapshot.diagnostics,
        {
          ...diagnostic,
          code: "invalid-native-work",
          impact: "blocking" as const,
          message: "Native work has a blocking structural diagnostic.",
        },
      ],
      attention: [
        ...snapshot.attention,
        {
          kind: "structural-diagnostic" as const,
          diagnosticReference: diagnostic.reference,
        },
      ],
    };
    expect(projectSnapshotSchema.safeParse(projected).success).toBe(true);
    rejects({ ...projected, efforts: snapshot.efforts, gates: snapshot.gates });
  }
});
