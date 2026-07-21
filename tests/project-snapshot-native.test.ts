import { describe, expect, test } from "bun:test";
import type { CapturedNativeNode } from "../src/captured-native-work";
import { buildNativeProjection } from "../src/project-snapshot/native";
import { mapProjectionSchema, ticketProjectionSchema } from "../src/project-snapshot/schema";
import { createSourceReference } from "../src/project-snapshot/source-reference";
import type { SitemapNode } from "../src/sitemap-model";

const fingerprint = `sha256:${"a".repeat(64)}`;

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
  if (result.type === "Maps") {
    const annotation = result.annotations.find((item) => item.startsWith("fog-count="));
    result.native = {
      kind: "map",
      locator: result.locator,
      scope: result.scope ?? "",
      status: result.state,
      fogCount: Number.parseInt(annotation?.slice("fog-count=".length) ?? "0", 10),
    };
  } else {
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

const project = (nodes: readonly SitemapNode[]) => {
  const captured: CapturedNativeNode[] = nodes.map((item) => {
    if (item.native === undefined) throw new Error("Expected captured native work.");
    return {
      reference: item.reference,
      title: item.title,
      locator: item.locator,
      native: item.native,
    };
  });
  const effortByScope = new Map<string, string>();
  for (const item of nodes) {
    const effortId = item.links.find((link) => link.label === "effort")?.target;
    if (item.scope !== undefined && effortId !== undefined) {
      effortByScope.set(item.scope, effortId);
    }
  }
  return buildNativeProjection({ nodes: captured, effortByScope, sitemapFingerprint: fingerprint });
};

const sourceFor = (locator: string) =>
  createSourceReference({
    basisFingerprint: fingerprint,
    kind: "tracker",
    displayLocator: locator,
    binding: { role: locator.endsWith("/map.md") ? "map" : "ticket", identity: locator },
  });

describe("native Project Snapshot projection", () => {
  test("projects Maps in byte-stable reference order with Fog and Effort relations", () => {
    // Given
    const later = node({
      type: "Maps",
      reference: ".scratch/zeta/map.md",
      locator: ".scratch/zeta/map.md",
      title: "Zeta",
      state: "invented",
      scope: ".scratch/zeta",
      annotations: ["fog-count=0"],
    });
    const earlier = node({
      type: "Maps",
      reference: ".scratch/alpha/map.md",
      locator: ".scratch/alpha/map.md",
      title: "Alpha",
      state: "active",
      scope: ".scratch/alpha",
      links: [{ label: "effort", target: "effort:test" }],
      annotations: ["fog-count=3"],
    });

    // When
    const result = project([later, earlier]);

    // Then
    expect(result.maps).toEqual({
      validity: "available",
      items: [
        mapProjectionSchema.parse({
          reference: earlier.reference,
          title: "Alpha",
          source: sourceFor(earlier.locator),
          state: "active",
          effortId: "effort:test",
          fogCount: 3,
        }),
        mapProjectionSchema.parse({
          reference: later.reference,
          title: "Zeta",
          source: sourceFor(later.locator),
          state: "unknown",
          fogCount: 0,
        }),
      ],
    });
  });

  test("derives Ticket lanes and preserves stable blocker references", () => {
    // Given
    const resolved = node({
      reference: ".scratch/work/issues/01-resolved.md",
      locator: ".scratch/work/issues/01-resolved.md",
      state: "resolved",
    });
    const ready = node({
      reference: ".scratch/work/issues/02-ready.md",
      locator: ".scratch/work/issues/02-ready.md",
      state: "open",
      links: [{ label: "blocked-by", target: resolved.reference }],
    });
    const claimed = node({
      reference: ".scratch/work/issues/03-claimed.md",
      locator: ".scratch/work/issues/03-claimed.md",
      state: "claimed",
      links: [{ label: "effort", target: "effort:test" }],
    });
    const blocked = node({
      reference: ".scratch/work/issues/04-blocked.md",
      locator: ".scratch/work/issues/04-blocked.md",
      state: "open",
      links: [
        { label: "blocked-by", target: ready.reference },
        { label: "blocked-by", target: resolved.reference },
        { label: "blocked-by", target: ready.reference },
      ],
    });
    const triage = node({
      reference: ".scratch/work/issues/05-triage.md",
      locator: ".scratch/work/issues/05-triage.md",
      state: "needs-info",
    });
    const isolated = node({
      reference: ".scratch/work/issues/06-isolated.md",
      locator: ".scratch/work/issues/06-isolated.md",
      state: "unknown",
    });
    const nativeNodes = [isolated, triage, blocked, claimed, ready, resolved];

    // When
    const result = project(nativeNodes);

    // Then
    expect(result.tickets).toEqual({
      validity: "available",
      items: [
        ticketProjectionSchema.parse({
          reference: resolved.reference,
          title: "First",
          source: sourceFor(resolved.locator),
          state: "resolved",
          effortId: "effort:test",
          blockedBy: [],
        }),
        ticketProjectionSchema.parse({
          reference: ready.reference,
          title: "First",
          source: sourceFor(ready.locator),
          state: "ready",
          effortId: "effort:test",
          blockedBy: [resolved.reference],
        }),
        ticketProjectionSchema.parse({
          reference: claimed.reference,
          title: "First",
          source: sourceFor(claimed.locator),
          state: "claimed",
          effortId: "effort:test",
          blockedBy: [],
        }),
        ticketProjectionSchema.parse({
          reference: blocked.reference,
          title: "First",
          source: sourceFor(blocked.locator),
          state: "blocked",
          effortId: "effort:test",
          blockedBy: [resolved.reference, ready.reference],
        }),
        ticketProjectionSchema.parse({
          reference: triage.reference,
          title: "First",
          source: sourceFor(triage.locator),
          state: "triage",
          effortId: "effort:test",
          blockedBy: [],
        }),
        ticketProjectionSchema.parse({
          reference: isolated.reference,
          title: "First",
          source: sourceFor(isolated.locator),
          state: "triage",
          effortId: "effort:test",
          blockedBy: [],
        }),
      ],
    });
  });

  test("preserves every accepted native status alias in the derived Ticket lane", () => {
    // Given
    const nativeNodes = [
      node({
        reference: ".scratch/work/issues/01-agent.md",
        locator: ".scratch/work/issues/01-agent.md",
        state: "ready-for-agent",
      }),
      node({
        reference: ".scratch/work/issues/02-human.md",
        locator: ".scratch/work/issues/02-human.md",
        state: "ready-for-human",
      }),
      node({
        reference: ".scratch/work/issues/03-wontfix.md",
        locator: ".scratch/work/issues/03-wontfix.md",
        state: "wontfix",
      }),
      node({
        reference: ".scratch/work/issues/04-triage.md",
        locator: ".scratch/work/issues/04-triage.md",
        state: "needs-triage",
      }),
      node({
        reference: ".scratch/work/issues/05-isolated.md",
        locator: ".scratch/work/issues/05-isolated.md",
        state: "unsupported",
      }),
    ];

    // When
    const result = project(nativeNodes);

    // Then
    const lanes =
      result.tickets.validity === "available"
        ? Object.fromEntries(result.tickets.items.map((item) => [item.reference, item.state]))
        : {};
    expect(lanes).toEqual({
      ".scratch/work/issues/01-agent.md": "ready",
      ".scratch/work/issues/02-human.md": "ready",
      ".scratch/work/issues/03-wontfix.md": "resolved",
      ".scratch/work/issues/04-triage.md": "triage",
      ".scratch/work/issues/05-isolated.md": "triage",
    });
  });

  test("isolates formatted native titles while preserving trustworthy siblings", () => {
    // Given: each native collection has one plain title and one title with formatting syntax.
    const plainMap = node({
      type: "Maps",
      reference: ".scratch/plain/map.md",
      locator: ".scratch/plain/map.md",
      title: "Plain Map",
      state: "active",
    });
    const formattedMap = node({
      type: "Maps",
      reference: ".scratch/formatted/map.md",
      locator: ".scratch/formatted/map.md",
      title: "**Formatted Map**",
      state: "active",
    });
    const plainTicket = node({
      reference: ".scratch/plain/issues/01-plain.md",
      locator: ".scratch/plain/issues/01-plain.md",
      title: "Plain Ticket",
    });
    const formattedTicket = node({
      reference: ".scratch/formatted/issues/01-formatted.md",
      locator: ".scratch/formatted/issues/01-formatted.md",
      title: "Fix `sync`",
    });
    const nativeNodes = [formattedTicket, plainTicket, formattedMap, plainMap];

    // When: native nodes enter the normalized Snapshot projection.
    const result = project(nativeNodes);

    // Then: each collection remains readable and carries one source-scoped issue.
    expect(result.maps).toMatchObject({
      validity: "partial",
      items: [{ reference: plainMap.reference, title: plainMap.title }],
      issues: [
        {
          code: "invalid-native-map",
          target: formattedMap.locator,
          source: sourceFor(formattedMap.locator),
        },
      ],
    });
    expect(result.tickets).toMatchObject({
      validity: "partial",
      items: [{ reference: plainTicket.reference, title: plainTicket.title }],
      issues: [
        {
          code: "invalid-native-ticket",
          target: formattedTicket.locator,
          source: sourceFor(formattedTicket.locator),
        },
      ],
    });
  });

  test("reports an invalid native collection when every member is untrustworthy", () => {
    // Given: the only native Map has a formatted H1 title.
    const formattedMap = node({
      type: "Maps",
      reference: ".scratch/formatted/map.md",
      locator: ".scratch/formatted/map.md",
      title: "[Formatted Map](https://example.test)",
    });

    // When: the Map enters normalized projection.
    const result = project([formattedMap]);

    // Then: the Map collection is invalid without throwing or inventing a title.
    expect(result.maps).toMatchObject({
      validity: "invalid",
      issues: [{ code: "invalid-native-map", target: formattedMap.locator }],
    });
    expect(result.tickets).toEqual({ validity: "available", items: [] });
  });
});
