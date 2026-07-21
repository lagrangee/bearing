import { expect, test } from "bun:test";
import { deriveTicketLane } from "../src/planning-derivation";
import type { SitemapNode } from "../src/sitemap-model";

const node = (overrides: Partial<SitemapNode>): SitemapNode => {
  const result: SitemapNode = {
    type: "Tickets",
    reference: ".scratch/work/issues/01-first.md",
    title: "First",
    state: "open",
    locator: ".scratch/work/issues/01-first.md",
    scope: ".scratch/work",
    links: [],
    annotations: [],
    ...overrides,
  };
  if (result.native === undefined && result.type === "Maps") {
    const annotation = result.annotations.find((item) => item.startsWith("fog-count="));
    result.native = {
      kind: "map",
      locator: result.locator,
      scope: result.scope ?? "",
      status: result.state,
      fogCount: Number.parseInt(annotation?.slice("fog-count=".length) ?? "0", 10),
    };
  } else if (result.native === undefined && result.type === "Tickets") {
    result.native = {
      kind: "ticket",
      locator: result.locator,
      scope: result.scope ?? "",
      number: /\/(\d+)-/u.exec(result.locator)?.[1] ?? "01",
      status: result.state,
      blockers: [],
      blockerTargets: result.links
        .filter((link) => link.label === "blocked-by")
        .map((link) => link.target),
    };
  }
  return result;
};

test("derives tracker lanes without changing native status", () => {
  const resolved = node({
    reference: ".scratch/work/issues/01-resolved.md",
    state: "resolved",
  });
  const open = node({
    reference: ".scratch/work/issues/02-open.md",
    links: [{ label: "blocked-by", target: resolved.reference }],
  });
  const blocked = node({
    reference: ".scratch/work/issues/03-blocked.md",
    links: [{ label: "blocked-by", target: open.reference }],
  });
  const nodes = [resolved, open, blocked];
  expect(deriveTicketLane(resolved, nodes)).toBe("resolved");
  expect(deriveTicketLane(open, nodes)).toBe("ready");
  expect(deriveTicketLane(blocked, nodes)).toBe("blocked");
  expect(
    deriveTicketLane(
      node({ state: "ready-for-agent", links: [{ label: "blocked-by", target: open.reference }] }),
      nodes,
    ),
  ).toBe("blocked");
  expect(
    deriveTicketLane(
      node({
        state: "ready-for-human",
        links: [{ label: "blocked-by", target: resolved.reference }],
      }),
      nodes,
    ),
  ).toBe("ready");
  expect(deriveTicketLane(node({ state: "claimed" }), nodes)).toBe("claimed");
  expect(deriveTicketLane(node({ state: "needs-info" }), nodes)).toBe("triage");
});

test("derives native work from normalized truth rather than Sitemap presentation strings", () => {
  const resolved = node({
    reference: ".scratch/work/issues/01-resolved.md",
    state: "open",
    links: [],
  }) as SitemapNode & {
    native: {
      kind: "ticket";
      locator: string;
      scope: string;
      number: string;
      status: string;
      blockers: readonly string[];
      blockerTargets: readonly string[];
    };
  };
  resolved.native = {
    kind: "ticket",
    locator: resolved.locator,
    scope: resolved.scope ?? "",
    number: "01",
    status: "resolved",
    blockers: [],
    blockerTargets: [],
  };
  const ready = node({
    reference: ".scratch/work/issues/02-ready.md",
    state: "unsupported-presentation-state",
    links: [{ label: "blocked-by", target: "presentation-only-target" }],
  }) as typeof resolved;
  ready.native = {
    kind: "ticket",
    locator: ready.locator,
    scope: ready.scope ?? "",
    number: "02",
    status: "open",
    blockers: ["01"],
    blockerTargets: [resolved.reference],
  };

  expect(deriveTicketLane(resolved, [resolved, ready])).toBe("resolved");
  expect(deriveTicketLane(ready, [resolved, ready])).toBe("ready");
});
