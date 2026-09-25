import { describe, expect, test } from "bun:test";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import type { MattSkillsV1ProviderObservation } from "../src/providers/matt-skills-v1/capture";
import {
  createLocalMarkdownMattProvider,
  type LocalMarkdownCaptureEvent,
} from "../src/providers/matt-skills-v1/local-markdown";
import { mattSkillsV1ProviderObservationSchema } from "../src/providers/matt-skills-v1/schema";
import { makeTemporaryDirectory, writeFixture } from "./helpers";

// Raw templates and their pinned official provenance are maintained together in this fixture.
const upstream = (name: string) =>
  readFile(new URL(`./fixtures/matt-upstream-contract/${name}`, import.meta.url), "utf8");
const contractLocator = "docs/agents/issue-tracker.md";
const triageLocator = "docs/agents/triage-labels.md";
const nativeScope = ".scratch/upstream";
const binding = { provider: "matt-skills/v1" as const, nativeScope };
const ticketLocator = `${nativeScope}/issues/01-delivery.md`;
const specLocator = `${nativeScope}/spec.md`;

const deliverySource = async () =>
  (await upstream("local-ticket-template.md"))
    .replace("<NN>: <Ticket title>", "01: Deliver the accepted slice")
    .replace(
      'the numbers/titles of the tickets that gate this one, or "None (can start immediately)".',
      "None (can start immediately)",
    );

const repository = async (withTriage = true) => {
  const root = await makeTemporaryDirectory("bearing-matt-upstream-local-");
  await writeFixture(root, contractLocator, await upstream("issue-tracker-local.md"));
  if (withTriage) await writeFixture(root, triageLocator, await upstream("triage-labels.md"));
  await writeFixture(root, ticketLocator, await deliverySource());
  return root;
};

const providerFor = async (
  root: string,
  onCaptureEvent?: (event: LocalMarkdownCaptureEvent) => void | Promise<void>,
) => {
  const capturedDocuments = new Map(
    (
      await Promise.all(
        [contractLocator, triageLocator].map(async (locator) => {
          try {
            const bytes = await readFile(join(root, locator));
            return [locator, { locator, source: bytes.toString("utf8"), bytes }] as const;
          } catch (error) {
            if (error instanceof Error && "code" in error && error.code === "ENOENT")
              return undefined;
            throw error;
          }
        }),
      )
    ).filter((entry) => entry !== undefined),
  );
  return createLocalMarkdownMattProvider({
    repoRoot: root,
    contractLocator,
    triageLocator,
    capturedDocuments,
    ...(onCaptureEvent === undefined ? {} : { onCaptureEvent }),
  });
};

const semantics = (observation: MattSkillsV1ProviderObservation) => ({
  state: observation.state,
  coverage: observation.coverage.assessment,
  completion: observation.completion,
  projection: observation.projection,
  diagnostics: observation.diagnostics.map(({ code, class: category, impact, target }) => ({
    code,
    category,
    impact,
    target,
  })),
});

const reconcileAndCapture = async (root: string, change: () => Promise<readonly string[]>) => {
  const provider = await providerFor(root);
  const prior = await provider.capture(binding);
  expect(prior.state).toBe("available");
  expect(prior.coverage.assessment).toBe("complete");
  const subjects = await change();
  const ticketBefore = await readFile(join(root, ticketLocator));
  const targeted = await provider.reconcile?.({ binding, prior, affected: { subjects } });
  if (targeted === undefined) throw new Error("Local reconciliation must be available.");
  const full = await provider.capture(binding);
  expect(semantics(targeted)).toEqual(semantics(full));
  expect(await readFile(join(root, ticketLocator))).toEqual(ticketBefore);
  for (const result of [targeted, full]) {
    expect<unknown>(mattSkillsV1ProviderObservationSchema.parse(result)).toEqual(result);
  }
  return { prior, targeted, full };
};

describe("current upstream Matt Local contract", () => {
  test("conflicting completion evidence is not treated as an ordinary missing convention", async () => {
    const root = await repository();
    try {
      const { targeted } = await reconcileAndCapture(root, async () => {
        await writeFixture(
          root,
          ticketLocator,
          `${(await deliverySource()).replace("ready-for-agent", "resolved")}\n## Answer\n\nImplemented.\n\n## Answer\n\nNot implemented.\n`,
        );
        return [ticketLocator];
      });
      expect(targeted.state).toBe("partial");
      expect(targeted.completion).toBe("undetermined");
      expect(targeted.projection?.deliveryTickets[0]?.trackerClosure.state).toBe("closed");
      expect(targeted.diagnostics).toContainEqual(
        expect.objectContaining({
          code: "matt.local.delivery.ambiguous-completion-evidence",
          target: ticketLocator,
          impact: "blocking",
        }),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("a present but uncaptured vocabulary cannot masquerade as optional absence", async () => {
    const root = await repository(false);
    try {
      const reads: string[] = [];
      const provider = await providerFor(root, (event) => {
        if (event.kind === "content-read") reads.push(event.locator);
      });
      const prior = await provider.capture(binding);
      expect(prior.state).toBe("available");
      await writeFixture(root, triageLocator, await upstream("triage-labels.md"));
      const targeted = await provider.reconcile?.({
        binding,
        prior,
        affected: { subjects: [ticketLocator] },
      });
      const full = await provider.capture(binding);
      for (const result of [targeted, full]) {
        expect(result?.state).toBe("partial");
        expect(result?.completion).toBe("undetermined");
        expect(result?.diagnostics).toContainEqual(
          expect.objectContaining({ target: triageLocator, impact: "blocking" }),
        );
      }
      expect(reads).not.toContain(triageLocator);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("an explicit wontfix closure remains incomplete rather than an unknown completion", async () => {
    const root = await repository();
    try {
      const { targeted } = await reconcileAndCapture(root, async () => {
        await writeFixture(
          root,
          ticketLocator,
          (await deliverySource()).replace("ready-for-agent", "wontfix"),
        );
        return [ticketLocator];
      });
      expect(targeted.state).toBe("available");
      expect(targeted.completion).toBe("incomplete");
      expect(targeted.projection?.deliveryTickets[0]?.trackerClosure).toMatchObject({
        state: "closed",
        disposition: "wontfix",
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("untitled documents preserve declared pre-section status and reject duplicate status", async () => {
    const root = await repository();
    try {
      const body = await upstream("spec-template.md");
      const first = await reconcileAndCapture(root, async () => {
        await writeFixture(
          root,
          specLocator,
          `Status: ready-for-agent\n\n${body}\n\n## Appendix\n\nStatus: superseded\n`,
        );
        return [specLocator];
      });
      expect(first.targeted.diagnostics).toEqual([]);
      expect(first.targeted.projection?.spec?.lifecycle).toEqual({ state: "ready-for-agent" });
      const duplicate = await reconcileAndCapture(root, async () => {
        await writeFixture(
          root,
          specLocator,
          `Status: ready-for-agent\nStatus: superseded\n\n${body}`,
        );
        return [specLocator];
      });
      expect(duplicate.targeted.state).toBe("partial");
      expect(duplicate.targeted.projection?.spec?.lifecycle).toEqual({
        state: "unavailable",
        reason: "unrecognized",
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("a vocabulary appearing during acquisition is detected without erasing independent Wayfinder facts", async () => {
    for (const targeted of [false, true]) {
      const root = await repository(false);
      try {
        const mapLocator = `${nativeScope}/map.md`;
        const wayfinderLocator = `${nativeScope}/issues/02-decision.md`;
        await writeFixture(
          root,
          mapLocator,
          "# A map\n\nStatus: active\n\n## Destination\n\nChoose a boundary.\n\n## Notes\n\n## Decisions so far\n\n## Not yet specified\n\n## Out of scope\n",
        );
        await writeFixture(
          root,
          wayfinderLocator,
          "# Choose the boundary\n\nType: research\n\n## Question\n\nWhich facts are shared?\n",
        );
        let armed = false;
        const provider = await providerFor(root, async (event) => {
          if (armed && event.kind === "content-read" && event.locator === wayfinderLocator) {
            await writeFixture(root, triageLocator, await upstream("triage-labels.md"));
          }
        });
        const prior = await provider.capture(binding);
        expect(prior.state).toBe("available");
        armed = true;
        const result = targeted
          ? await provider.reconcile?.({
              binding,
              prior,
              affected: { subjects: [wayfinderLocator] },
            })
          : await provider.capture(binding);
        expect(result?.state).toBe("partial");
        expect(result?.completion).toBe("undetermined");
        expect(result?.diagnostics).toContainEqual(
          expect.objectContaining({ code: "matt.local.concurrent-mutation" }),
        );
        expect(result?.projection?.wayfinderTickets).toHaveLength(1);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    }
  });

  test("duplicate Map or Spec status is unrecognized rather than falsely not declared", async () => {
    for (const kind of ["map", "spec"] as const) {
      const root = await repository();
      try {
        const locator = `${nativeScope}/${kind}.md`;
        const body =
          kind === "map"
            ? "## Destination\n\nChoose a boundary.\n\n## Notes\n\n## Decisions so far\n\n## Not yet specified\n\n## Out of scope\n"
            : await upstream("spec-template.md");
        const { targeted } = await reconcileAndCapture(root, async () => {
          await writeFixture(
            root,
            locator,
            `# A document\n\nStatus: active\nStatus: resolved\n\n${body}`,
          );
          return [locator];
        });
        expect(targeted.state).toBe("partial");
        expect(targeted.projection?.[kind]?.lifecycle).toEqual({
          state: "unavailable",
          reason: "unrecognized",
        });
        expect(targeted.diagnostics).toContainEqual(
          expect.objectContaining({ code: "matt.local.decode.field-ambiguous", target: locator }),
        );
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    }
  });

  test("upstream instructional comments are not nonempty Map decisions or out-of-scope evidence", async () => {
    const root = await repository();
    try {
      const locator = `${nativeScope}/map.md`;
      const { targeted } = await reconcileAndCapture(root, async () => {
        await writeFixture(
          root,
          locator,
          (await upstream("wayfinder-map-template.md"))
            .replace(
              "<what reaching the end of this map looks like: the spec, decision, or change this effort is finding its way to. One or two lines; every session orients to it before choosing a ticket.>",
              "Find the accepted route.",
            )
            .replace(
              "<domain; skills every session should consult; standing preferences for this effort>",
              "- Keep the route bounded.",
            )
            .replace("- [<closed ticket title>](link): <one-line gist of the answer>", ""),
        );
        return [locator];
      });
      expect(targeted.diagnostics).toEqual([]);
      expect(targeted.state).toBe("available");
      expect(targeted.projection?.map?.semanticSections).toEqual(
        expect.arrayContaining([
          { role: "map.decisions", availability: "confirmed-empty" },
          { role: "map.fog", availability: "confirmed-empty" },
          { role: "map.out-of-scope", availability: "confirmed-empty" },
        ]),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("preserves native closure without treating a missing Provider Answer convention as Matt invalid", async () => {
    const root = await repository();
    try {
      const { targeted } = await reconcileAndCapture(root, async () => {
        await writeFixture(
          root,
          ticketLocator,
          (await deliverySource())
            .replace("ready-for-agent", "resolved")
            .replaceAll("- [ ]", "- [x]"),
        );
        return [ticketLocator];
      });
      expect(targeted.state).toBe("available");
      expect(targeted.diagnostics).toEqual([]);
      expect(targeted.coverage.assessment).toBe("complete");
      expect(targeted.completion).toBe("undetermined");
      expect(targeted.projection?.deliveryTickets[0]).toMatchObject({
        trackerClosure: { state: "closed", disposition: "completed" },
        lifecycle: { state: "completion-unavailable", reason: "source-contract-gap" },
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("omitted optional triage configuration does not invalidate standard Delivery and Wayfinder facts", async () => {
    const root = await repository(false);
    try {
      const mapLocator = `${nativeScope}/map.md`;
      const wayfinderLocator = `${nativeScope}/issues/02-decision.md`;
      const { targeted } = await reconcileAndCapture(root, async () => {
        await writeFixture(
          root,
          mapLocator,
          "# A decision map\n\nStatus: active\n\n## Destination\n\nChoose a boundary.\n\n## Notes\n\n## Decisions so far\n\n## Not yet specified\n\n## Out of scope\n",
        );
        await writeFixture(
          root,
          wayfinderLocator,
          "# Choose the boundary\n\nType: research\n\n## Question\n\nWhich facts are shared?\n",
        );
        return [mapLocator, wayfinderLocator];
      });
      const uncaptured = await createLocalMarkdownMattProvider({
        repoRoot: root,
        contractLocator,
      }).capture(binding);
      expect(semantics(uncaptured)).toEqual(semantics(targeted));
      expect(targeted.diagnostics).toEqual([]);
      expect(targeted.coverage.assessment).toBe("complete");
      expect(targeted.projection?.wayfinderTickets).toHaveLength(1);
      expect<unknown>(targeted.projection?.graph.parentChild).toEqual([
        { parent: mapLocator, child: wayfinderLocator, evidence: "matt-contract" },
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("keeps upstream Map and Spec bodies readable without invented titles or lifecycle", async () => {
    const root = await repository();
    try {
      const mapLocator = `${nativeScope}/map.md`;
      const { targeted } = await reconcileAndCapture(root, async () => {
        await writeFixture(root, specLocator, await upstream("spec-template.md"));
        await writeFixture(
          root,
          mapLocator,
          (await upstream("wayfinder-map-template.md"))
            .replace(
              "<what reaching the end of this map looks like: the spec, decision, or change this effort is finding its way to. One or two lines; every session orients to it before choosing a ticket.>",
              "Decide the contract boundary.",
            )
            .replace(
              "<domain; skills every session should consult; standing preferences for this effort>",
              "- Read the accepted tracker contract.",
            )
            .replace(
              "- [<closed ticket title>](link): <one-line gist of the answer>",
              "- The initial scope is accepted.",
            )
            .replace(
              '<!-- see "Out of scope": work ruled beyond the destination; closed, never graduates -->',
              "- No second tracker.",
            ),
        );
        return [specLocator, mapLocator];
      });
      expect(targeted.diagnostics).toEqual([]);
      expect(targeted.state).toBe("available");
      expect(targeted.coverage.assessment).toBe("complete");
      expect(targeted.completion).toBe("undetermined");
      for (const [object, locator] of [
        [targeted.projection?.map, mapLocator],
        [targeted.projection?.spec, specLocator],
      ] as const) {
        expect(object).toMatchObject({
          title: locator,
          lifecycle: { state: "unavailable", reason: "not-declared" },
        });
        expect(object?.native.rawFacets).toContainEqual({
          key: "title-source",
          values: ["locator-fallback"],
        });
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("keeps tickets readable when explicit parent evidence is ambiguous or unsafe", async () => {
    for (const parent of [
      "[One](../spec.md) and [Two](../PRD.md)",
      "[Outside](../../../../outside.md)",
      "[Missing](../spec.md)",
    ]) {
      const root = await repository();
      try {
        const { targeted } = await reconcileAndCapture(root, async () => {
          await writeFixture(
            root,
            ticketLocator,
            `${await deliverySource()}\n## Parent\n\n${parent}\n`,
          );
          return [ticketLocator];
        });
        expect(targeted.state).toBe("partial");
        expect(targeted.completion).toBe("undetermined");
        expect(targeted.projection?.deliveryTickets).toHaveLength(1);
        expect(targeted.projection?.graph.parentChild).toEqual([]);
        expect(targeted.diagnostics).toContainEqual(
          expect.objectContaining({ class: "identity", target: ticketLocator, impact: "blocking" }),
        );
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    }
  });

  test("projects an explicit unique parent and removes it when the referenced Spec disappears", async () => {
    const root = await repository();
    try {
      await writeFixture(
        root,
        specLocator,
        `# Accepted Spec\n\nStatus: ready-for-agent\n\n${await upstream("spec-template.md")}`,
      );
      const first = await reconcileAndCapture(root, async () => {
        await writeFixture(
          root,
          ticketLocator,
          `${await deliverySource()}\n## Parent\n\n[Accepted Spec](../spec.md)\n`,
        );
        return [ticketLocator];
      });
      expect<unknown>(first.targeted.projection?.graph.parentChild).toEqual([
        { parent: specLocator, child: ticketLocator, evidence: "matt-body-fallback" },
      ]);
      const deleted = await reconcileAndCapture(root, async () => {
        await rm(join(root, specLocator));
        return [specLocator];
      });
      expect(deleted.targeted.state).toBe("partial");
      expect(deleted.targeted.projection?.graph.parentChild).toEqual([]);
      expect(deleted.targeted.projection?.deliveryTickets).toEqual(
        deleted.prior.projection?.deliveryTickets,
      );
      expect(deleted.targeted.diagnostics).toContainEqual(
        expect.objectContaining({ code: "matt.local.relation.broken", target: ticketLocator }),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("scope membership alone does not give a Delivery ticket a Spec parent", async () => {
    const root = await repository();
    try {
      const { targeted } = await reconcileAndCapture(root, async () => {
        await writeFixture(
          root,
          specLocator,
          `# Accepted Spec\n\nStatus: ready-for-agent\n\n${await upstream("spec-template.md")}`,
        );
        return [specLocator];
      });
      expect(targeted.projection?.spec).toBeDefined();
      expect(targeted.projection?.graph.parentChild).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("reads the standard no-blocker Delivery template without requiring a parent Spec", async () => {
    const root = await repository();
    try {
      const { targeted } = await reconcileAndCapture(root, async () => {
        await writeFixture(
          root,
          ticketLocator,
          `${await deliverySource()}\n## Comments\n\nReviewed scope.\n`,
        );
        return [ticketLocator];
      });
      expect(targeted.state).toBe("available");
      expect(targeted.diagnostics).toEqual([]);
      expect(targeted.projection?.spec).toBeUndefined();
      expect(targeted.projection?.deliveryTickets).toHaveLength(1);
      expect(targeted.projection?.graph).toEqual({ parentChild: [], blockedBy: [] });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
