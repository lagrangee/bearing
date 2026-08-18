import { describe, expect, test } from "bun:test";
import { lstat, mkdir, readdir, readFile, rm, symlink, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  createLocalMarkdownMattProvider,
  type LocalMarkdownCaptureEvent,
} from "../src/providers/matt-skills-v1/local-markdown";
import { makeTemporaryDirectory, writeFixture } from "./helpers";

const contractLocator = "docs/agents/issue-tracker.md";
const triageLocator = "docs/agents/triage-labels.md";
const nativeScope = ".scratch/reference";
const binding = { provider: "matt-skills/v1" as const, nativeScope };
const contract = `# Issue tracker: Local Markdown

Issues and PRDs for this repo live as markdown files in \`.scratch/\`.

## Conventions

- One feature per directory: \`.scratch/<feature-slug>/\`
- The PRD is \`.scratch/<feature-slug>/PRD.md\`
- Implementation issues are \`.scratch/<feature-slug>/issues/<NN>-<slug>.md\`, numbered from \`01\`
- Triage state is recorded as a \`Status:\` line near the top of each issue file (see \`triage-labels.md\` for the role strings)
- New tickets use \`Blocked by: None — can start immediately\` when unblocked; otherwise they use comma-separated numeric ticket IDs, optionally followed by a spaced em-dash title. Historical omission is readable as unblocked; semicolons and undeclared prose are invalid.
- Comments and conversation history append to the bottom of the file under a \`## Comments\` heading

## Wayfinding operations

- Map: \`.scratch/<effort>/map.md\` - the Notes / Decisions-so-far / Fog body.
- Child ticket: \`.scratch/<effort>/issues/NN-<slug>.md\`, numbered from \`01\`, with the question in the body.
`;

const triage = `# Triage Labels

| Label in mattpocock/skills | Label in our tracker | Meaning |
| --- | --- | --- |
| \`needs-triage\` | \`custom-triage\` | Evaluate |
| \`needs-info\` | \`custom-info\` | Waiting |
| \`ready-for-agent\` | \`custom-ready\` | Ready |
| \`ready-for-human\` | \`custom-human\` | Human |
| \`wontfix\` | \`custom-wontfix\` | Rejected |
| \`bug\` | \`custom-bug\` | Defect |
| \`enhancement\` | \`custom-enhancement\` | Feature |
`;

const map = `# Wayfinder Map: Reference

Status: resolved

## Destination

Prove one complete Matt-native semantic scope.

## Notes

- Keep provider-native identity outside the semantic oracle.

## Decisions so far

- [Research the semantic contract](issues/01-research.md) — Use the versioned capture seam.
- Preserve an unlinked decision with [external context](https://example.com/decision).

## Fog

- Whether one source comment can be uniquely identified as an Answer.

## Out of scope

- [Grill the ontology boundary](issues/03-grilling.md) — Do not build a universal tracker ontology.
- Do not add another tracker provider in this release.
`;

const spec = `# Reference Spec

Status: ready-for-agent

## Problem Statement

Local and GitHub must preserve the same accepted semantics.

## Solution

Capture one concrete Matt scope through a versioned provider seam.

## User Stories

A consumer can distinguish workflow truth without native identity coupling.

## Implementation Decisions

Keep provider-specific projection behind a provider-neutral wrapper.

## Testing Decisions

Compare public provider captures through a test-owned oracle.

## Out of Scope

Do not build a generic tracker ontology.

## Further Notes

Opaque relation references are capture-local.
`;

const wayfinder = (input: {
  number: string;
  slug: string;
  type: "research" | "prototype" | "grilling" | "task";
  status: "claimed" | "resolved";
  question: string;
  blockedBy?: string;
  answer?: string;
  extra?: string;
}): readonly [string, string] => [
  `${nativeScope}/issues/${input.number}-${input.slug}.md`,
  `# ${input.slug.replaceAll("-", " ")}

Type: ${input.type}
${input.blockedBy === undefined ? "" : `\nBlocked by: ${input.blockedBy}\n`}

Status: ${input.status}
${input.status === "claimed" ? "\nClaimed by: lago\n" : ""}

## Question

${input.question}
${input.answer === undefined ? "" : `\n## Answer\n\n${input.answer}\n`}
${input.extra ?? ""}
`,
];

const delivery = `# Implement provider capture

**What to build:** A versioned capture seam.

Blocked by: 01

Status: resolved

- [x] Return independent state, freshness and completion.
- [x] Keep the capture immutable.

## Comments

Delivery completion is not tracker closure.

## Answer

Implemented and verified through the public capture seam.
`;

const incoming = `---
custom:
  owner: customer-success
---
# Support a custom-mapped enhancement

Category: custom-enhancement

Status: custom-ready

Reporter prose with [external evidence](https://example.com/customer-report).

## Triage Notes

Preserve this note distinctly.

## Custom Metadata

Owner-system: customer-success
`;

const writeReferenceRepository = async (): Promise<string> => {
  const root = await makeTemporaryDirectory("bearing-local-provider-");
  await writeFixture(root, contractLocator, contract);
  await writeFixture(root, triageLocator, triage);
  await writeFixture(root, `${nativeScope}/map.md`, map);
  await writeFixture(root, `${nativeScope}/PRD.md`, spec);
  for (const [locator, source] of [
    wayfinder({
      number: "01",
      slug: "research",
      type: "research",
      status: "resolved",
      question: "Which semantics are durable?",
      answer: "Preserve workflow-specific lifecycle and evidence.",
      extra: "\n## Comments\n\nThis comment is not the Answer.\n",
    }),
    wayfinder({
      number: "02",
      slug: "prototype",
      type: "prototype",
      status: "claimed",
      question: "Does one capture preserve all axes?",
      blockedBy: "01",
    }),
    wayfinder({
      number: "03",
      slug: "grilling",
      type: "grilling",
      status: "resolved",
      question: "What must remain provider-specific?",
    }),
    wayfinder({
      number: "04",
      slug: "task",
      type: "task",
      status: "claimed",
      question: "Can the decision be written durably?",
      extra: "\n## Agent Brief\n\nWrite only the accepted resolution.\n",
    }),
  ]) {
    await writeFixture(root, locator, source);
  }
  await writeFixture(root, `${nativeScope}/issues/05-delivery.md`, delivery);
  await writeFixture(root, `${nativeScope}/issues/06-incoming.md`, incoming);
  await writeFixture(root, `${nativeScope}/issues/nested/99-hidden.md`, "# Hidden\n");
  await writeFixture(root, `${nativeScope}/research/not-a-child.md`, "# Research evidence\n");
  return root;
};

const capture = async (
  root: string,
  options: Readonly<{
    onCaptureEvent?: (event: LocalMarkdownCaptureEvent) => void | Promise<void>;
    maximumFileBytes?: number;
    clock?: () => Date;
  }> = {},
) =>
  createLocalMarkdownMattProvider({
    repoRoot: root,
    contractLocator,
    triageLocator,
    clock: () => new Date("2026-07-28T00:00:00Z"),
    ...options,
  }).capture(binding);

const snapshotNativeBytes = async (root: string): Promise<Readonly<Record<string, string>>> => {
  const result: Record<string, string> = {};
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const target = join(directory, entry.name);
      if (entry.isDirectory()) await visit(target);
      else {
        const locator = target.slice(root.length + 1);
        const metadata = await lstat(target);
        result[locator] = `${metadata.mode}:${(await readFile(target)).toString("base64")}`;
      }
    }
  };
  await visit(join(root, nativeScope));
  return result;
};

describe("Local Markdown matt-skills/v1 capture", () => {
  test("accepts a supported contract with several lists inside Conventions", async () => {
    const root = await writeReferenceRepository();
    await writeFixture(
      root,
      contractLocator,
      `# Issue tracker: Local Markdown

## Conventions

- Feature specifications use \`.scratch/<feature-slug>/PRD.md\`.
- Delivery tickets use \`.scratch/<feature-slug>/issues/<NN>-<slug>.md\`.
- Triage vocabulary is defined by \`triage-labels.md\`.

### Map rules

- Maps have one title and one destination.

### Delivery rules

- Delivery tickets have one acceptance checklist.

## Wayfinding operations

- Read the Map at \`.scratch/<effort>/map.md\`.
- Read tickets from \`.scratch/<effort>/issues/NN-<slug>.md\`.
`,
    );

    const result = await capture(root);

    expect(result.state).toBe("available");
    expect(result.diagnostics).toEqual([]);
  });

  test("captures the complete reference scope through the public seam without native writes", async () => {
    const root = await writeReferenceRepository();
    const before = await snapshotNativeBytes(root);
    const events: LocalMarkdownCaptureEvent[] = [];
    const result = await capture(root, {
      onCaptureEvent: (event) => {
        events.push(event);
      },
    });

    expect(result.state).toBe("available");
    expect(result.freshness.assessment).toBe("current");
    expect(result.coverage.assessment).toBe("complete");
    expect(result.completion).toBe("incomplete");
    expect(result.diagnostics).toEqual([]);
    expect(result.sourceRevision).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(result.projection?.map).toMatchObject({
      title: "Wayfinder Map: Reference",
      destination: [
        {
          semanticRole: "map.destination",
          availability: "available",
          markdown: "Prove one complete Matt-native semantic scope.",
        },
      ],
      lifecycle: { state: "resolved" },
      native: {
        createdAt: { availability: "available", basis: "inferred-source-metadata" },
        lastUpdated: { availability: "available", basis: "inferred-source-metadata" },
      },
    });
    expect(result.projection?.map?.decisions[0]).toMatchObject({
      gist: "Use the versioned capture seam.",
    });
    expect(result.projection?.map?.decisions[1]).toEqual({
      gist: "Preserve an unlinked decision with external context.",
      sourceAnchor: {
        kind: "decision",
        target: `${nativeScope}/map.md#decision-2`,
      },
    });
    expect(result.projection?.map?.outOfScope[1]).toMatchObject({
      rationale: "Do not add another tracker provider in this release.",
    });
    expect(result.projection?.map?.fog).toEqual([
      "Whether one source comment can be uniquely identified as an Answer.",
    ]);
    expect(
      result.projection?.spec?.document.map((section) =>
        section.semanticRole?.slice("spec.".length),
      ),
    ).toEqual([
      "problem",
      "solution",
      "user-stories",
      "implementation",
      "testing",
      "out-of-scope",
      "further-notes",
    ]);
    expect(result.projection?.wayfinderTickets.map((ticket) => ticket.subtype)).toEqual([
      "research",
      "prototype",
      "grilling",
      "task",
    ]);
    expect(result.projection?.wayfinderTickets[0]).toMatchObject({
      claim: { state: "unclaimed" },
      answer: {
        availability: "available",
        content: {
          authoredAt: { availability: "available", basis: "inferred-source-metadata" },
        },
      },
      lifecycle: { state: "resolved-on-route" },
      trackerClosure: {
        state: "closed",
        closedAt: { availability: "available", basis: "inferred-source-metadata" },
      },
    });
    expect(result.projection?.wayfinderTickets[1]).toMatchObject({
      claim: { state: "claimed", claimant: "lago" },
      lifecycle: { state: "open" },
    });
    expect(result.projection?.wayfinderTickets[2]?.lifecycle.state).toBe("ruled-out-of-scope");
    expect(result.projection?.deliveryTickets[0]).toMatchObject({
      whatToBuild: "A versioned capture seam.",
      acceptanceCriteria: [
        "Return independent state, freshness and completion.",
        "Keep the capture immutable.",
      ],
      lifecycle: { state: "completed" },
    });
    expect(result.projection?.structuralOrder.map(String)).toEqual([
      `${nativeScope}/map.md`,
      `${nativeScope}/PRD.md`,
      `${nativeScope}/issues/01-research.md`,
      `${nativeScope}/issues/02-prototype.md`,
      `${nativeScope}/issues/03-grilling.md`,
      `${nativeScope}/issues/04-task.md`,
      `${nativeScope}/issues/05-delivery.md`,
      `${nativeScope}/issues/06-incoming.md`,
    ]);
    expect(result.projection?.incomingIssues[0]).toMatchObject({
      classification: {
        category: "enhancement",
        state: "ready-for-agent",
        nativeCategory: "custom-enhancement",
        nativeState: "custom-ready",
      },
    });
    expect(result.projection?.incomingIssues[0]?.content.map((document) => document.role)).toEqual([
      "issue-body",
      "triage-note",
    ]);
    expect(
      result.projection?.incomingIssues[0]?.content.every(
        (document) => document.document[0]?.version === 1 && !("body" in document),
      ),
    ).toBe(true);
    expect(result.projection?.incomingIssues[0]?.native.sourceAnchors).toContainEqual({
      kind: "external",
      target: "https://example.com/customer-report",
    });
    expect(
      result.projection?.incomingIssues[0]?.native.rawFacets.map((facet) => facet.key),
    ).not.toContain("markdown");
    expect(result.projection?.graph.parentChild).toHaveLength(5);
    expect(result.projection?.graph.blockedBy).toHaveLength(2);
    expect(
      result.projection
        ? [
            result.projection.map,
            result.projection.spec,
            ...result.projection.wayfinderTickets,
            ...result.projection.deliveryTickets,
            ...result.projection.incomingIssues,
          ]
            .filter((item) => item !== undefined)
            .map((item) => item.native.identity)
        : [],
    ).toEqual(
      expect.arrayContaining([
        { locator: `${nativeScope}/map.md` },
        { locator: `${nativeScope}/PRD.md` },
        { locator: `${nativeScope}/issues/01-research.md` },
      ]),
    );
    expect(events.filter((event) => event.kind === "content-read")).toHaveLength(10);
    expect(
      events.filter((event) => event.kind === "content-read").map((event) => event.locator),
    ).not.toContain(`${nativeScope}/issues/nested/99-hidden.md`);
    expect(await snapshotNativeBytes(root)).toEqual(before);
    expect(Object.isFrozen(result.projection)).toBe(true);
  });

  test("captures canonical Matt-kit blocker syntax and rejects undeclared dialects", async () => {
    const root = await writeReferenceRepository();
    await writeFixture(
      root,
      `${nativeScope}/issues/02-prototype.md`,
      wayfinder({
        number: "02",
        slug: "prototype",
        type: "prototype",
        status: "claimed",
        question: "Does one capture preserve all axes?",
        blockedBy: "None — can start immediately",
      })[1],
    );
    await writeFixture(
      root,
      `${nativeScope}/issues/04-task.md`,
      wayfinder({
        number: "04",
        slug: "task",
        type: "task",
        status: "claimed",
        question: "Can the decision be written durably?",
        blockedBy: "01 — research, 03 — grilling",
      })[1],
    );

    const canonical = await capture(root);

    expect(canonical.state).toBe("available");
    expect(canonical.diagnostics).toEqual([]);
    expect(
      canonical.projection?.graph.blockedBy.map((relation) => [
        String(relation.blocked),
        String(relation.blocker),
      ]),
    ).toEqual([
      [`${nativeScope}/issues/04-task.md`, `${nativeScope}/issues/01-research.md`],
      [`${nativeScope}/issues/04-task.md`, `${nativeScope}/issues/03-grilling.md`],
      [`${nativeScope}/issues/05-delivery.md`, `${nativeScope}/issues/01-research.md`],
    ]);

    for (const malformed of ["01; 03", "01 because it must finish", "01 trailing garbage"]) {
      await writeFixture(
        root,
        `${nativeScope}/issues/04-task.md`,
        wayfinder({
          number: "04",
          slug: "task",
          type: "task",
          status: "claimed",
          question: "Can the decision be written durably?",
          blockedBy: malformed,
        })[1],
      );
      const invalid = await capture(root);
      expect(invalid.state, malformed).toBe("partial");
      expect(
        invalid.diagnostics.map((diagnostic) => diagnostic.code),
        malformed,
      ).toContain("matt.local.relation.blocked-by-format");
      expect(
        invalid.projection?.graph.blockedBy.some(
          (relation) => String(relation.blocked) === `${nativeScope}/issues/04-task.md`,
        ),
        malformed,
      ).toBe(false);
    }
  });

  test("targeted reconciliation applies the same canonical blocker grammar", async () => {
    const root = await writeReferenceRepository();
    const capturedDocuments = new Map(
      await Promise.all(
        [contractLocator, triageLocator].map(async (locator) => {
          const bytes = await readFile(join(root, locator));
          return [locator, { locator, source: bytes.toString("utf8"), bytes }] as const;
        }),
      ),
    );
    const provider = createLocalMarkdownMattProvider({
      repoRoot: root,
      contractLocator,
      triageLocator,
      capturedDocuments,
      clock: () => new Date("2026-07-28T00:00:00Z"),
    });
    const issue = `${nativeScope}/issues/04-task.md`;
    const issueOne = `${nativeScope}/issues/01-research.md`;
    const issueThree = `${nativeScope}/issues/03-grilling.md`;
    let prior = await provider.capture(binding);

    const reconcile = async (blockedBy: string | undefined) => {
      await writeFixture(
        root,
        issue,
        wayfinder({
          number: "04",
          slug: "task",
          type: "task",
          status: "claimed",
          question: "Can the decision be written durably?",
          ...(blockedBy === undefined ? {} : { blockedBy }),
        })[1],
      );
      const next = await provider.reconcile?.({
        binding,
        prior,
        affected: {
          subjects: [issue],
          relations: [
            { kind: "blocked-by", source: issue, target: issueOne },
            { kind: "blocked-by", source: issue, target: issueThree },
          ],
        },
      });
      if (next === undefined) throw new Error("Expected Local targeted reconciliation.");
      prior = next;
      return next;
    };

    const multiple = await reconcile("01, 03 — grilling");
    expect(
      multiple.projection?.graph.blockedBy.filter((relation) => String(relation.blocked) === issue),
    ).toHaveLength(2);

    for (const empty of ["None — can start immediately", undefined] as const) {
      const result = await reconcile(empty);
      expect(
        result.projection?.graph.blockedBy.filter((relation) => String(relation.blocked) === issue),
      ).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    }

    const malformed = await reconcile("01; 03");
    expect(malformed.state).toBe("partial");
    expect(malformed.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "matt.local.relation.blocked-by-format",
    );
    expect(
      malformed.projection?.graph.blockedBy.filter(
        (relation) => String(relation.blocked) === issue,
      ),
    ).toEqual([]);
  });

  test("captures a Status-absent Wayfinder ticket as open and unclaimed", async () => {
    const root = await writeReferenceRepository();
    const locator = `${nativeScope}/issues/02-prototype.md`;
    const source = await readFile(join(root, locator), "utf8");
    await writeFixture(root, locator, source.replace("Status: claimed\n\nClaimed by: lago\n", ""));

    const result = await capture(root);

    expect(result.state).toBe("available");
    expect(result.diagnostics).toEqual([]);
    expect(result.projection?.wayfinderTickets[1]).toMatchObject({
      claim: { state: "unclaimed" },
      lifecycle: { state: "open" },
      trackerClosure: { state: "open" },
    });
  });

  test("projects current Local birthtime and mtime as read-only approximate display times", async () => {
    const root = await writeReferenceRepository();
    const locator = `${nativeScope}/issues/01-research.md`;
    const target = join(root, locator);
    const firstMtime = new Date("2040-01-02T03:04:05Z");
    await utimes(target, firstMtime, firstMtime);
    const metadata = await lstat(target);
    const expectedCreated = new Date(
      metadata.birthtimeMs > 0 ? metadata.birthtimeMs : metadata.mtimeMs,
    ).toISOString();
    const before = await snapshotNativeBytes(root);

    const first = await capture(root, {
      clock: () => new Date("2099-12-31T23:59:59Z"),
    });
    const firstTicket = first.projection?.wayfinderTickets[0];

    expect(firstTicket).toMatchObject({
      native: {
        createdAt: {
          availability: "available",
          value: expectedCreated,
          basis: "inferred-source-metadata",
        },
        lastUpdated: {
          availability: "available",
          value: firstMtime.toISOString(),
          basis: "inferred-source-metadata",
        },
      },
      answer: {
        availability: "available",
        content: {
          authoredAt: {
            availability: "available",
            value: firstMtime.toISOString(),
            basis: "inferred-source-metadata",
          },
        },
      },
      trackerClosure: {
        state: "closed",
        closedAt: {
          availability: "available",
          value: firstMtime.toISOString(),
          basis: "inferred-source-metadata",
        },
      },
    });

    const secondMtime = new Date("2041-02-03T04:05:06Z");
    await utimes(target, secondMtime, secondMtime);
    const second = await capture(root, {
      clock: () => new Date("2099-12-31T23:59:59Z"),
    });
    const secondTicket = second.projection?.wayfinderTickets[0];

    expect(second.sourceRevision).toBe(first.sourceRevision);
    expect(secondTicket?.native.lastUpdated).toMatchObject({
      value: secondMtime.toISOString(),
      basis: "inferred-source-metadata",
    });
    expect(secondTicket?.trackerClosure).toMatchObject({
      closedAt: { value: secondMtime.toISOString(), basis: "inferred-source-metadata" },
    });
    expect(second.projection?.structuralOrder).toEqual(first.projection?.structuralOrder);
    expect(second.completion).toBe(first.completion);
    expect(second.freshness).toEqual(first.freshness);
    expect(await snapshotNativeBytes(root)).toEqual(before);
    expect(JSON.stringify(second.projection)).not.toContain("firstObserved");
    expect(JSON.stringify(second.projection)).not.toContain("2099-12-31");
  });

  test("treats absent optional Map and Spec plus untriaged Incoming as fully acquired", async () => {
    const root = await makeTemporaryDirectory("bearing-local-provider-optional-");
    await writeFixture(root, contractLocator, contract);
    await writeFixture(root, triageLocator, triage);
    await writeFixture(root, `${nativeScope}/issues/01-untriaged.md`, "# New request\n\nBody.\n");

    const result = await capture(root);

    expect(result.state).toBe("available");
    expect(result.coverage.assessment).toBe("complete");
    expect(result.projection?.map).toBeUndefined();
    expect(result.projection?.spec).toBeUndefined();
    expect(result.projection?.incomingIssues[0]?.classification).toEqual({
      category: "unknown",
      state: "unknown",
    });
    expect(result.completion).toBe("incomplete");
  });

  test("accepts an empty contract-defined issues slot without inventing work", async () => {
    const root = await makeTemporaryDirectory("bearing-local-provider-empty-");
    await writeFixture(root, contractLocator, contract);
    await writeFixture(root, triageLocator, triage);
    await mkdir(join(root, nativeScope), { recursive: true });

    const result = await capture(root);

    expect(result.state).toBe("available");
    expect(result.coverage.assessment).toBe("complete");
    expect(result.projection).toEqual({
      wayfinderTickets: [],
      deliveryTickets: [],
      incomingIssues: [],
      structuralOrder: [],
      graph: { parentChild: [], blockedBy: [] },
    });
  });

  test("fails closed for mapping, decode, identity and relation gaps while retaining a trusted projection", async () => {
    const cases = [
      {
        name: "missing mapping",
        mutate: async (root: string) =>
          writeFixture(root, triageLocator, triage.replace("| `wontfix`", "| `ready-for-agent`")),
        code: "matt.local.mapping.ambiguous",
      },
      {
        name: "incomplete triage",
        mutate: async (root: string) =>
          writeFixture(
            root,
            `${nativeScope}/issues/06-incoming.md`,
            "# Partial incoming\n\nCategory: custom-enhancement\n",
          ),
        code: "matt.local.triage.incomplete",
      },
      {
        name: "unknown raw triage values",
        mutate: async (root: string) =>
          writeFixture(
            root,
            `${nativeScope}/issues/06-incoming.md`,
            "# Unknown incoming\n\nCategory: native-future-kind\n\nStatus: native-future-state\n",
          ),
        code: "matt.local.triage.unknown",
      },
      {
        name: "canonical category bypasses custom mapping",
        mutate: async (root: string) =>
          writeFixture(
            root,
            `${nativeScope}/issues/06-incoming.md`,
            incoming.replace("Category: custom-enhancement", "Category: enhancement"),
          ),
        code: "matt.local.triage.unknown",
      },
      {
        name: "ambiguous role",
        mutate: async (root: string) =>
          writeFixture(
            root,
            `${nativeScope}/issues/06-incoming.md`,
            "# Ambiguous\n\nType: research\n\nStatus: claimed\n\n**What to build:** Both.\n\n- [ ] One\n\n## Question\n\nWhich?\n",
          ),
        code: "matt.local.role.ambiguous",
      },
      {
        name: "incomplete Wayfinder role",
        mutate: async (root: string) =>
          writeFixture(
            root,
            `${nativeScope}/issues/06-incoming.md`,
            "# Partial Wayfinder\n\nType: research\n\nStatus: claimed\n\nWhich semantics?\n",
          ),
        code: "matt.local.role.ambiguous",
      },
      {
        name: "incomplete Delivery role",
        mutate: async (root: string) =>
          writeFixture(
            root,
            `${nativeScope}/issues/06-incoming.md`,
            "# Partial Delivery\n\n**What to build:** A partial body.\n\nBlocked by: 01\n\n- [ ] One\n",
          ),
        code: "matt.local.role.ambiguous",
      },
      {
        name: "broken blocker",
        mutate: async (root: string) =>
          writeFixture(
            root,
            `${nativeScope}/issues/02-prototype.md`,
            wayfinder({
              number: "02",
              slug: "prototype",
              type: "prototype",
              status: "claimed",
              question: "Does one capture preserve all axes?",
              blockedBy: "99",
            })[1],
          ),
        code: "matt.local.relation.broken",
      },
      {
        name: "broken Map ticket link",
        mutate: async (root: string) =>
          writeFixture(
            root,
            `${nativeScope}/map.md`,
            map.replace("issues/01-research.md", "issues/99-missing.md"),
          ),
        code: "matt.local.relation.broken",
      },
      {
        name: "duplicate short reference",
        mutate: async (root: string) =>
          writeFixture(root, `${nativeScope}/issues/01-second.md`, "# Duplicate\n"),
        code: "matt.local.identity.duplicate-reference",
      },
    ] as const;

    for (const item of cases) {
      const root = await writeReferenceRepository();
      await item.mutate(root);
      const result = await capture(root);
      expect(result.state, item.name).toBe("partial");
      expect(result.freshness.assessment, item.name).toBe("current");
      expect(result.coverage.assessment, item.name).toBe("incomplete");
      expect(result.completion, item.name).toBe("undetermined");
      expect(
        result.diagnostics.map((diagnostic) => diagnostic.code),
        item.name,
      ).toContain(item.code);
      expect(result.projection, item.name).toBeDefined();
      if (item.name === "unknown raw triage values") {
        expect(result.projection?.incomingIssues[0]?.classification).toMatchObject({
          category: "ambiguous",
          state: "ambiguous",
          nativeCategory: "native-future-kind",
          nativeState: "native-future-state",
        });
      }
      if (item.name === "canonical category bypasses custom mapping") {
        expect(result.projection?.incomingIssues[0]?.classification).toMatchObject({
          category: "ambiguous",
          state: "ready-for-agent",
          nativeCategory: "enhancement",
          nativeState: "custom-ready",
        });
      }
      if (item.name === "incomplete Wayfinder role") {
        expect(result.projection?.wayfinderTickets).toHaveLength(4);
      }
      if (item.name === "incomplete Delivery role") {
        expect(result.projection?.deliveryTickets).toHaveLength(1);
      }
    }
  }, 15_000);

  test("uses repository vocabulary for Delivery routing states", async () => {
    const root = await writeReferenceRepository();
    await writeFixture(
      root,
      `${nativeScope}/issues/05-delivery.md`,
      delivery
        .replace("Status: resolved", "Status: custom-ready")
        .replace("\n## Answer\n\nImplemented and verified through the public capture seam.", ""),
    );

    const result = await capture(root);

    expect(result.state).toBe("available");
    expect(result.diagnostics).toEqual([]);
    expect(result.projection?.deliveryTickets[0]).toMatchObject({
      lifecycle: { state: "open" },
      trackerClosure: { state: "open" },
      native: {
        rawFacets: expect.arrayContaining([{ key: "status", values: ["custom-ready"] }]),
      },
    });

    await writeFixture(
      root,
      `${nativeScope}/issues/05-delivery.md`,
      delivery
        .replace("Status: resolved", "Status: custom-wontfix")
        .replace("\n## Answer\n\nImplemented and verified through the public capture seam.", ""),
    );
    const wontfix = await capture(root);
    expect(wontfix.state).toBe("available");
    expect(wontfix.projection?.deliveryTickets[0]).toMatchObject({
      lifecycle: { state: "completion-unavailable", reason: "source-contract-gap" },
      trackerClosure: { state: "closed", disposition: "wontfix" },
    });
  });

  test("accepts canonical categories when the repository defines no category override", async () => {
    const root = await writeReferenceRepository();
    const stateOnlyTriage = triage
      .replace("| `bug` | `custom-bug` | Defect |\n", "")
      .replace("| `enhancement` | `custom-enhancement` | Feature |\n", "");
    await writeFixture(root, triageLocator, stateOnlyTriage);
    await writeFixture(
      root,
      `${nativeScope}/issues/06-incoming.md`,
      incoming.replace("Category: custom-enhancement", "Category: enhancement"),
    );

    const result = await capture(root);

    expect(result.state).toBe("available");
    expect(result.diagnostics).toEqual([]);
    expect(result.projection?.incomingIssues[0]?.classification).toMatchObject({
      category: "enhancement",
      state: "ready-for-agent",
      nativeCategory: "enhancement",
      nativeState: "custom-ready",
    });
  });

  test("accepts adjacent provider field lines without a Bearing-specific spacing rule", async () => {
    const root = await writeReferenceRepository();
    await writeFixture(
      root,
      `${nativeScope}/issues/06-incoming.md`,
      incoming.replace(
        "Category: custom-enhancement\n\nStatus: custom-ready",
        "Category: custom-enhancement\nStatus: custom-ready",
      ),
    );

    const result = await capture(root);

    expect(result.state).toBe("available");
    expect(result.projection?.incomingIssues[0]?.classification).toEqual({
      category: "enhancement",
      state: "ready-for-agent",
      nativeCategory: "custom-enhancement",
      nativeState: "custom-ready",
    });
    expect(result.diagnostics.map(({ code }) => code)).not.toContain(
      "matt.local.triage.incomplete",
    );
  });

  test("does not treat prose, examples, or quotes as provider fields", async () => {
    const root = await writeReferenceRepository();
    await writeFixture(
      root,
      `${nativeScope}/issues/06-incoming.md`,
      incoming.replace(
        "Category: custom-enhancement\n\nStatus: custom-ready",
        [
          "This paragraph explains an example value.",
          "Status: custom-ready",
          "",
          "```text",
          "Category: custom-enhancement",
          "```",
          "",
          "> Category: custom-enhancement",
        ].join("\n"),
      ),
    );

    const result = await capture(root);

    expect(result.state).toBe("available");
    expect(result.projection?.incomingIssues[0]?.classification).toMatchObject({
      category: "unknown",
      state: "unknown",
    });
    expect(result.diagnostics.map(({ code }) => code)).not.toContain(
      "matt.local.triage.incomplete",
    );
  });

  test("keeps non-Wayfinder Map links as native content without inventing decision relations", async () => {
    const root = await writeReferenceRepository();
    await writeFixture(
      root,
      `${nativeScope}/map.md`,
      map.replace(
        "\n## Fog",
        "\n- [Delivery checkpoint](issues/05-delivery.md) — Recorded without Wayfinder semantics.\n\n## Fog",
      ),
    );

    const result = await capture(root);

    expect(result.state).toBe("available");
    expect(result.diagnostics).toEqual([]);
    expect(result.projection?.map?.decisions.at(-1)).toEqual({
      gist: "Delivery checkpoint — Recorded without Wayfinder semantics.",
      sourceAnchor: {
        kind: "decision",
        target: `${nativeScope}/map.md#decision-3`,
      },
    });
  });

  test("returns scoped absent or invalid captures for root and filesystem safety failures", async () => {
    const absentRoot = await makeTemporaryDirectory("bearing-local-provider-absent-");
    await writeFixture(absentRoot, contractLocator, contract);
    await writeFixture(absentRoot, triageLocator, triage);
    const absent = await capture(absentRoot);
    expect(absent).toMatchObject({
      state: "absent",
      completion: "incomplete",
      freshness: { assessment: "current" },
    });

    const outside = await writeReferenceRepository();
    const outsideResult = await createLocalMarkdownMattProvider({
      repoRoot: outside,
      contractLocator,
      triageLocator,
      clock: () => new Date("2026-07-28T00:00:00Z"),
    }).capture({ ...binding, nativeScope: "../outside" });
    expect(outsideResult).toMatchObject({
      state: "invalid",
      freshness: { assessment: "undetermined" },
      completion: "undetermined",
    });
    expect(outsideResult.diagnostics[0]?.code).toBe("matt.local.scope.invalid");

    const unavailableRoot = await makeTemporaryDirectory("bearing-local-provider-root-");
    const unavailableResult = await createLocalMarkdownMattProvider({
      repoRoot: join(unavailableRoot, "missing"),
      contractLocator,
      triageLocator,
      clock: () => new Date("2026-07-28T00:00:00Z"),
    }).capture(binding);
    expect(unavailableResult.state).toBe("invalid");
    expect(unavailableResult.diagnostics[0]?.code).toBe("matt.local.repository.unavailable");

    const fileScope = await makeTemporaryDirectory("bearing-local-provider-file-scope-");
    await writeFixture(fileScope, contractLocator, contract);
    await writeFixture(fileScope, triageLocator, triage);
    await writeFixture(fileScope, nativeScope, "# Not a scope directory\n");
    const fileScopeResult = await capture(fileScope);
    expect(fileScopeResult.state).toBe("invalid");
    expect(fileScopeResult.diagnostics.map((item) => item.code)).toContain(
      "matt.local.scope.invalid",
    );

    const linked = await writeReferenceRepository();
    const external = await makeTemporaryDirectory("bearing-local-provider-external-");
    await writeFile(join(external, "linked.md"), "# Linked\n");
    await symlink(join(external, "linked.md"), join(linked, nativeScope, "issues", "07-linked.md"));
    const linkedResult = await capture(linked);
    expect(linkedResult.state).toBe("partial");
    expect(linkedResult.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "matt.local.input.unsafe",
    );

    const directoryChild = await writeReferenceRepository();
    await mkdir(join(directoryChild, nativeScope, "issues", "07-directory.md"));
    const directoryChildResult = await capture(directoryChild);
    expect(directoryChildResult.state).toBe("partial");
    expect(directoryChildResult.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "matt.local.input.unsafe",
    );

    const oversized = await writeReferenceRepository();
    await writeFixture(
      oversized,
      `${nativeScope}/issues/07-oversized.md`,
      `# Oversized\n\n${"x".repeat(4096)}\n`,
    );
    const oversizedResult = await capture(oversized, { maximumFileBytes: 2048 });
    expect(oversizedResult.state).toBe("partial");
    expect(oversizedResult.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "matt.local.input.too-large",
    );
  });

  test("detects concurrent mutation after one content read without retrying or mixing generations", async () => {
    const root = await writeReferenceRepository();
    const reads = new Map<string, number>();
    let changed = false;
    const result = await capture(root, {
      onCaptureEvent: async (event) => {
        if (event.kind !== "content-read") return;
        reads.set(event.locator, (reads.get(event.locator) ?? 0) + 1);
        if (!changed && event.locator.endsWith("02-prototype.md")) {
          changed = true;
          await writeFile(
            join(root, nativeScope, "issues", "02-prototype.md"),
            "# Mutated during capture\n",
          );
        }
      },
    });

    expect(result.state).toBe("partial");
    expect(result.freshness.assessment).toBe("undetermined");
    expect(result.completion).toBe("undetermined");
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "matt.local.concurrent-mutation",
    );
    expect([...reads.values()].every((count) => count === 1)).toBe(true);
    expect(
      result.projection?.wayfinderTickets.some((ticket) =>
        String(ticket.ref).endsWith("02-prototype.md"),
      ),
    ).toBe(false);
    expect(
      result.projection?.graph.blockedBy.some(
        (relation) =>
          String(relation.blocked).endsWith("02-prototype.md") ||
          String(relation.blocker).endsWith("02-prototype.md"),
      ),
    ).toBe(false);
  });

  test("drops relation evidence when issue membership changes during capture", async () => {
    const root = await writeReferenceRepository();
    let changed = false;
    const result = await capture(root, {
      onCaptureEvent: async (event) => {
        if (changed || event.kind !== "scope-enumerated") return;
        changed = true;
        await writeFixture(
          root,
          `${nativeScope}/issues/01-late-duplicate.md`,
          "# Concurrent duplicate\n",
        );
      },
    });

    expect(result.state).toBe("partial");
    expect(result.freshness.assessment).toBe("undetermined");
    expect(result.projection?.graph).toEqual({ parentChild: [], blockedBy: [] });
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "matt.local.concurrent-mutation",
    );
  });

  test("does not acquire linked content or let linked bytes change provider truth", async () => {
    const root = await writeReferenceRepository();
    const evidenceDirectory = `${nativeScope}/evidence`;
    const largeImageLocator = `${evidenceDirectory}/large.png`;
    const binaryLocator = `${evidenceDirectory}/binary.bin`;
    const missingLocator = `${evidenceDirectory}/missing.png`;
    const directoryLocator = `${evidenceDirectory}/directory`;
    const unsupportedLocator = `${evidenceDirectory}/unsupported.xyz`;
    const linkedLocators = [
      largeImageLocator,
      binaryLocator,
      missingLocator,
      directoryLocator,
      unsupportedLocator,
    ];
    const researchLocator = `${nativeScope}/issues/01-research.md`;
    await mkdir(join(root, directoryLocator), { recursive: true });
    await writeFile(join(root, largeImageLocator), Buffer.alloc(1024 * 1024 + 1));
    await writeFile(join(root, binaryLocator), Buffer.from([0xff]));
    await writeFixture(root, unsupportedLocator, "unsupported bytes\n");
    await writeFixture(
      root,
      researchLocator,
      wayfinder({
        number: "01",
        slug: "research",
        type: "research",
        status: "resolved",
        question: "Which semantics are durable?",
        answer: `Keep ![large image](../evidence/large.png), [binary](../evidence/binary.bin),
[missing](../evidence/missing.png), [directory](../evidence/directory),
[unsupported](../evidence/unsupported.xyz), [unsafe](../../../../outside.md),
and ![remote](https://images.example/plan.png) as authored links.`,
      })[1],
    );
    const captureWithReads = async () => {
      const reads: string[] = [];
      const result = await capture(root, {
        onCaptureEvent: (event) => {
          if (event.kind === "content-read") reads.push(event.locator);
        },
      });
      return { result, reads };
    };

    const { result: first, reads: firstReads } = await captureWithReads();

    expect(first.state).toBe("available");
    expect(first.freshness.assessment).toBe("current");
    expect(first.coverage.assessment).toBe("complete");
    expect(first.diagnostics).toEqual([]);
    expect(firstReads).toHaveLength(10);
    expect(firstReads).not.toEqual(expect.arrayContaining(linkedLocators));
    const answerMarkdown =
      first.projection?.wayfinderTickets[0]?.answer.availability === "available"
        ? first.projection.wayfinderTickets[0].answer.content.document[0]?.markdown
        : undefined;
    expect(answerMarkdown).toContain("![large image](../evidence/large.png)");
    expect(answerMarkdown).toContain("![remote](https://images.example/plan.png)");
    expect(first.projection?.wayfinderTickets[0]?.native.sourceAnchors).toEqual(
      expect.arrayContaining([
        { kind: "source", target: "../evidence/binary.bin" },
        { kind: "source", target: "../../../../outside.md" },
      ]),
    );

    await writeFile(join(root, largeImageLocator), Buffer.alloc(1024 * 1024 + 2, 1));
    await rm(join(root, binaryLocator));
    await writeFixture(root, missingLocator, "new linked bytes\n");
    await writeFixture(root, unsupportedLocator, "changed linked bytes\n");
    const { result: second, reads: secondReads } = await captureWithReads();

    expect(second.state).toBe("available");
    expect(second.diagnostics).toEqual([]);
    expect(secondReads).toHaveLength(10);
    expect(secondReads).not.toEqual(expect.arrayContaining(linkedLocators));
    expect(second.sourceRevision).toBe(first.sourceRevision);
    expect(second.projection).toEqual(first.projection);
  });

  test("keeps links in ordinary authored sections without acquiring their targets", async () => {
    const root = await writeReferenceRepository();
    const ordinaryLocator = `${nativeScope}/evidence/ordinary.md`;
    await writeFixture(root, ordinaryLocator, "# Ordinary\n");
    await writeFixture(
      root,
      `${nativeScope}/issues/06-incoming.md`,
      `${incoming}

## Agent Brief

[brief link](../evidence/ordinary.md)

## Triage Notes

[triage link](../evidence/ordinary.md)

[ordinary](../evidence/ordinary.md)
[remote](http://127.0.0.1:1/nope)
[email](mailto:owner@example.com)
`,
    );
    const reads: string[] = [];
    const result = await capture(root, {
      onCaptureEvent: (event) => {
        if (event.kind === "content-read") reads.push(event.locator);
      },
    });

    expect(result.state).toBe("available");
    expect(result.diagnostics).toEqual([]);
    expect(reads).not.toContain(ordinaryLocator);
    expect(result.projection?.incomingIssues[0]?.native.sourceAnchors).toEqual(
      expect.arrayContaining([
        { kind: "source", target: "../evidence/ordinary.md" },
        { kind: "external", target: "http://127.0.0.1:1/nope" },
        { kind: "external", target: "mailto:owner@example.com" },
      ]),
    );
  });

  test("keeps resolved Delivery without Answer evidence distinct from completed work", async () => {
    const root = await writeReferenceRepository();
    await writeFixture(
      root,
      `${nativeScope}/issues/07-delivery-without-answer.md`,
      `# Integrate provider capture

**What to build:** A single-generation consumer path.

Blocked by: 05

Status: resolved

- [x] Reuse the same capture downstream.
`,
    );

    const result = await capture(root);

    expect(result.state).toBe("partial");
    expect(result.completion).toBe("undetermined");
    expect(result.projection?.deliveryTickets[1]).toMatchObject({
      title: "Integrate provider capture",
      lifecycle: {
        state: "completion-unavailable",
        reason: "incomplete-writeback",
      },
      trackerClosure: { state: "closed", disposition: "completed" },
    });
    expect(result.diagnostics.map((item) => item.code)).toContain(
      "matt.local.delivery.incomplete-writeback",
    );
  });

  test("validates the confirmed contract before reporting an absent scope", async () => {
    const root = await makeTemporaryDirectory("bearing-local-provider-invalid-contract-");
    await writeFixture(root, contractLocator, "# Unsupported tracker\n");
    await writeFixture(root, triageLocator, triage);

    const result = await capture(root);

    expect(result.state).toBe("invalid");
    expect(result.diagnostics.map((item) => item.code)).toContain(
      "matt.local.contract.unsupported",
    );
  });
});
