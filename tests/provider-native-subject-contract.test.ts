import { expect, test } from "bun:test";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  type PlanningLineageSubject,
  planningLineageSubjectHref,
} from "../src/planning-lineage-route";
import { parsePortalRoute } from "../src/portal-ui/project-route";
import { buildMattNativeSourceRecords } from "../src/project-generation/native-work-sources";
import {
  decodeGitHubMattNativeScope,
  encodeGitHubMattNativeScope,
} from "../src/providers/matt-skills-v1/github";
import { createLocalMarkdownMattProvider } from "../src/providers/matt-skills-v1/local-markdown";
import { mattNativeRecords } from "../src/providers/matt-skills-v1/native-read-model";
import {
  mattNativeScopeIdentity,
  mattNativeScopeLocator,
  mattNativeSubjectForObject,
} from "../src/providers/matt-skills-v1/native-subject";
import { mattObjectsFromProjection } from "../src/providers/matt-skills-v1/projection";
import {
  mattScopeProjectionSchema,
  mattSkillsV1ProviderObservationSchema,
} from "../src/providers/matt-skills-v1/schema";
import { bearingSchema } from "../src/schema-definitions";
import {
  mattEquivalenceLocalContractLocator,
  mattEquivalenceLocalScope,
  mattEquivalenceTriageLocator,
  writeMattEquivalenceLocalRepository,
} from "./fixtures/matt-equivalence-scenario";
import {
  createMattReferenceProjection,
  createMattReferenceProvider,
} from "./fixtures/matt-reference-scenario";

const captureLocal = async (root: string) =>
  createLocalMarkdownMattProvider({
    repoRoot: root,
    contractLocator: mattEquivalenceLocalContractLocator,
    triageLocator: mattEquivalenceTriageLocator,
    clock: () => new Date("2026-07-31T00:00:00Z"),
  }).capture({ provider: "matt-skills/v1", nativeScope: mattEquivalenceLocalScope });

test("round-trips provider-native scope and subject identities through the shared route grammar", () => {
  const subjects: readonly PlanningLineageSubject[] = [
    { kind: "native-scope", id: ".scratch/matt-equivalence" },
    { kind: "native-subject", id: ".scratch/matt-equivalence/map.md" },
    { kind: "native-subject", id: ".scratch/matt-equivalence/PRD.md" },
    {
      kind: "native-subject",
      id: ".scratch/matt-equivalence/issues/03-research.md",
    },
    {
      kind: "native-subject",
      id: ".scratch/matt-equivalence/issues/07-delivery.md",
    },
    {
      kind: "native-subject",
      id: ".scratch/matt-equivalence/issues/08-incoming.md",
    },
    { kind: "native-subject", id: "github:R_reference:I_reference_3" },
  ];

  for (const subject of subjects) {
    const href = planningLineageSubjectHref("repository-a", subject);
    const url = new URL(href, "http://portal.test");
    expect(parsePortalRoute(url.pathname, url.search, url.hash)).toMatchObject({
      kind: "project",
      entryId: "repository-a",
      section: "lineage",
      subject: { validity: "valid", value: subject },
    });
  }

  const local = subjects[1];
  if (local === undefined) throw new Error("Expected Local native subject.");
  expect(planningLineageSubjectHref("repository-a", local)).not.toBe(
    planningLineageSubjectHref("repository-b", local),
  );
});

test("keeps GitHub node identity stable across locator changes and trustworthy reparenting", () => {
  const originalScope = encodeGitHubMattNativeScope({
    host: "github.com",
    rootKind: "wayfinder-map",
    repository: {
      owner: "example",
      name: "reference",
      databaseId: "9001",
      nodeId: "R_reference",
    },
    root: {
      objectKind: "issue",
      number: 101,
      databaseId: "9101",
      nodeId: "I_reference_map",
    },
  });
  const relocatedScope = encodeGitHubMattNativeScope({
    host: "github.com",
    rootKind: "parent-issue",
    repository: {
      owner: "display-owner",
      name: "display-name",
      databaseId: "9001",
      nodeId: "R_reference",
    },
    root: {
      objectKind: "issue",
      number: 999,
      databaseId: "9101",
      nodeId: "I_reference_map",
    },
  });
  expect(decodeGitHubMattNativeScope(originalScope)).toEqual({
    host: "github.com",
    rootKind: "wayfinder-map",
    repository: {
      owner: "example",
      name: "reference",
      databaseId: "9001",
      nodeId: "R_reference",
    },
    root: {
      objectKind: "issue",
      number: 101,
      databaseId: "9101",
      nodeId: "I_reference_map",
    },
  });
  expect(decodeGitHubMattNativeScope(`${originalScope}&unexpected=value`)).toBeUndefined();
  expect(
    decodeGitHubMattNativeScope(
      originalScope.replace("objectNodeId=", "rootKind=wayfinder-map&objectNodeId="),
    ),
  ).toBeUndefined();
  const reordered = new URL(originalScope);
  const reversedEntries = [...reordered.searchParams.entries()].reverse();
  reordered.search = "";
  for (const [key, value] of reversedEntries) reordered.searchParams.append(key, value);
  const nonCanonicalAliases = [
    originalScope.replace("github-matt-v1://github.com/", "github-matt-v1://reader@github.com/"),
    originalScope.replace("github-matt-v1://github.com/", "github-matt-v1://github.com:443/"),
    originalScope.replace("/issues/101?", "/issues/0101?"),
    reordered.toString(),
  ];
  for (const alias of nonCanonicalAliases) {
    expect(decodeGitHubMattNativeScope(alias)).toBeUndefined();
  }
  expect(
    mattNativeScopeLocator({
      binding: { provider: "matt-skills/v1", nativeScope: originalScope },
    }),
  ).toBe("github/example/reference/issues/101");
  const effort = {
    Type: "effort",
    ID: "effort:github",
    Title: "GitHub",
    Roadmap: "roadmap:github",
    "Target gate": "gate:github",
    Authorities: [],
    Citations: [],
    Lifecycle: "active",
    "Planned at": null,
    "Activated at": null,
    "Work binding": {
      Provider: "matt-skills/v1",
      "Native scope": originalScope,
    },
  };
  expect(bearingSchema.safeParse(effort).success).toBe(true);
  for (const alias of nonCanonicalAliases) {
    expect(
      bearingSchema.safeParse({
        ...effort,
        "Work binding": {
          Provider: "matt-skills/v1",
          "Native scope": alias,
        },
      }).success,
    ).toBe(false);
  }
  expect(
    bearingSchema.safeParse({
      ...effort,
      "Work binding": {
        Provider: "matt-skills/v1",
        "Native scope": "https://example.com/unowned/scope",
      },
    }).success,
  ).toBe(false);
  expect(
    mattNativeScopeIdentity({
      binding: { provider: "matt-skills/v1", nativeScope: originalScope },
    }),
  ).toBe(
    mattNativeScopeIdentity({
      binding: { provider: "matt-skills/v1", nativeScope: relocatedScope },
    }),
  );

  const projection = createMattReferenceProjection("github");
  const delivery = projection.deliveryTickets[0];
  const alternateParent = projection.map;
  if (delivery === undefined || alternateParent === undefined) {
    throw new Error("Expected GitHub native route fixtures.");
  }
  const before = mattNativeSubjectForObject(delivery);
  const reparented = {
    ...projection,
    graph: {
      ...projection.graph,
      parentChild: [
        ...projection.graph.parentChild.filter((relation) => relation.child !== delivery.ref),
        {
          parent: alternateParent.ref,
          child: delivery.ref,
          evidence: "github-native" as const,
        },
      ],
    },
  };
  const sameDelivery = reparented.deliveryTickets.find((ticket) => ticket.ref === delivery.ref);
  expect(sameDelivery).toBeDefined();
  expect(mattNativeSubjectForObject(sameDelivery ?? delivery)).toEqual(before);

  const incoming = projection.incomingIssues[0];
  if (incoming === undefined) throw new Error("Expected a GitHub incoming issue fixture.");
  const reclassified = { ...delivery, ref: incoming.ref };
  expect(mattNativeSubjectForObject(incoming)).toEqual(mattNativeSubjectForObject(reclassified));
  expect(planningLineageSubjectHref("repository-a", mattNativeSubjectForObject(incoming))).toBe(
    planningLineageSubjectHref("repository-a", mattNativeSubjectForObject(reclassified)),
  );

  expect(
    mattScopeProjectionSchema.safeParse({
      ...projection,
      map: {
        ...alternateParent,
        native: {
          ...alternateParent.native,
          identity: {
            ...alternateParent.native.identity,
            url: "javascript:alert(1)",
          },
        },
      },
    }).success,
  ).toBe(false);
});

test("rejects semantic availability that contradicts provider content", () => {
  const projection = createMattReferenceProjection("local");
  const map = projection.map;
  const firstDelivery = projection.deliveryTickets[0];
  const firstWayfinder = projection.wayfinderTickets[0];
  const spec = projection.spec;
  if (
    map === undefined ||
    firstDelivery === undefined ||
    firstWayfinder === undefined ||
    spec === undefined
  ) {
    throw new Error("Expected complete Matt reference projection.");
  }
  const replaceAvailability = (
    sections: typeof map.semanticSections,
    role: string,
    availability: "available" | "confirmed-empty" | "unavailable" | "unsupported",
  ) => sections.map((section) => (section.role === role ? { ...section, availability } : section));

  expect(
    mattScopeProjectionSchema.safeParse({
      ...projection,
      map: {
        ...map,
        semanticSections: replaceAvailability(map.semanticSections, "map.fog", "confirmed-empty"),
      },
    }).success,
  ).toBe(false);
  expect(
    mattScopeProjectionSchema.safeParse({
      ...projection,
      map: {
        ...map,
        fog: ["   "],
      },
    }).success,
  ).toBe(false);
  expect(
    mattScopeProjectionSchema.safeParse({
      ...projection,
      deliveryTickets: [
        {
          ...firstDelivery,
          acceptanceCriteria: [""],
        },
        ...projection.deliveryTickets.slice(1),
      ],
    }).success,
  ).toBe(false);
  expect(
    mattScopeProjectionSchema.safeParse({
      ...projection,
      wayfinderTickets: [
        {
          ...firstWayfinder,
          question: "",
        },
        ...projection.wayfinderTickets.slice(1),
      ],
    }).success,
  ).toBe(false);
  expect(
    mattScopeProjectionSchema.safeParse({
      ...projection,
      deliveryTickets: [
        {
          ...firstDelivery,
          whatToBuild: "",
        },
        ...projection.deliveryTickets.slice(1),
      ],
    }).success,
  ).toBe(false);
  expect(
    mattScopeProjectionSchema.safeParse({
      ...projection,
      spec: {
        ...spec,
        semanticSections: spec.semanticSections.map((section) =>
          section.role === "spec.problem"
            ? { ...section, availability: "confirmed-empty" as const }
            : section,
        ),
      },
    }).success,
  ).toBe(false);
});

test("requires explicit availability for supported native authored and closure time roles", () => {
  const local = createMattReferenceProjection("local");
  const localWayfinder = local.wayfinderTickets[0];
  if (localWayfinder?.answer.availability !== "available") {
    throw new Error("Expected an available Local Answer fixture.");
  }
  const { authoredAt: _authoredAt, ...answerWithoutAuthoredTime } = localWayfinder.answer.content;
  expect(
    mattScopeProjectionSchema.safeParse({
      ...local,
      wayfinderTickets: [
        {
          ...localWayfinder,
          answer: {
            availability: "available",
            content: answerWithoutAuthoredTime,
          },
        },
        ...local.wayfinderTickets.slice(1),
      ],
    }).success,
  ).toBe(false);

  const github = createMattReferenceProjection("github");
  const map = github.map;
  if (map === undefined || map.native.kind !== "github") {
    throw new Error("Expected a GitHub Map fixture.");
  }
  const { trackerClosure: _trackerClosure, ...nativeWithoutClosureRole } = map.native;
  expect(
    mattScopeProjectionSchema.safeParse({
      ...github,
      map: { ...map, native: nativeWithoutClosureRole },
    }).success,
  ).toBe(false);
});

test("requires one explicit native structural order and never substitutes object type or identity", () => {
  const projection = createMattReferenceProjection("github");
  const reversed = [...projection.structuralOrder].reverse();
  const reordered = { ...projection, structuralOrder: reversed };

  expect(mattScopeProjectionSchema.safeParse(reordered).success).toBe(true);
  expect(mattObjectsFromProjection(reordered).map((object) => object.ref)).toEqual(reversed);
  expect(
    mattScopeProjectionSchema.safeParse({
      ...projection,
      structuralOrder: projection.structuralOrder.slice(1),
    }).success,
  ).toBe(false);
  expect(
    mattScopeProjectionSchema.safeParse({
      ...projection,
      structuralOrder: [projection.structuralOrder[0], ...projection.structuralOrder],
    }).success,
  ).toBe(false);
});

test("fails a native scope record closed when its own Source is unavailable", async () => {
  const observation = await createMattReferenceProvider("local").capture({
    provider: "matt-skills/v1",
    nativeScope: ".scratch/reference",
  });
  const snapshotObservation = mattSkillsV1ProviderObservationSchema.parse(observation);
  const sources = buildMattNativeSourceRecords([observation], `sha256:${"a".repeat(64)}`).filter(
    (source) => source.binding?.role !== "native-scope",
  );
  const records = mattNativeRecords([snapshotObservation], sources);

  expect(records.some((record) => record.recordKind === "native-scope")).toBe(false);
  expect(records.some((record) => record.recordKind === "native-object")).toBe(true);
});

test("provider semantic roles survive compatible headings and distinguish empty, unavailable, and unsupported", async () => {
  const root = await writeMattEquivalenceLocalRepository();
  try {
    const mapLocator = join(root, mattEquivalenceLocalScope, "map.md");
    const specLocator = join(root, mattEquivalenceLocalScope, "PRD.md");
    await writeFile(
      mapLocator,
      (await readFile(mapLocator, "utf8")).replace("## Fog", "## Not yet specified"),
      "utf8",
    );
    await writeFile(
      specLocator,
      (await readFile(specLocator, "utf8"))
        .replace("## Implementation Decisions", "## Implementation")
        .replace("## Testing Decisions", "## Testing"),
      "utf8",
    );

    const compatible = await captureLocal(root);
    expect(compatible.projection?.map?.semanticSections).toContainEqual({
      role: "map.fog",
      availability: "available",
    });
    expect(
      compatible.projection?.spec?.document.sections.map(({ semanticRole, availability }) => ({
        role: semanticRole?.slice("spec.".length),
        availability,
      })),
    ).toContainEqual({ role: "testing", availability: "available" });

    const map = await readFile(mapLocator, "utf8");
    await writeFile(
      mapLocator,
      map.replace(
        /## Not yet specified\n\n- Whether one source comment can be uniquely identified as an Answer\.\n/u,
        "## Not yet specified\n\n",
      ),
      "utf8",
    );
    const confirmedEmpty = await captureLocal(root);
    expect(confirmedEmpty.projection?.map?.semanticSections).toContainEqual({
      role: "map.fog",
      availability: "confirmed-empty",
    });

    await writeFile(
      mapLocator,
      (await readFile(mapLocator, "utf8")).replace(/## Not yet specified\n\n/u, ""),
      "utf8",
    );
    const unavailable = await captureLocal(root);
    expect(unavailable.projection?.map?.semanticSections).toContainEqual({
      role: "map.fog",
      availability: "unavailable",
    });

    await writeFile(
      mapLocator,
      (await readFile(mapLocator, "utf8")).replace(
        "## Destination\n\nProve one complete Matt-native semantic scope.\n",
        "## Destination\n\n",
      ),
      "utf8",
    );
    const emptyDestination = await captureLocal(root);
    expect(emptyDestination.projection?.map?.semanticSections).toContainEqual({
      role: "map.destination",
      availability: "confirmed-empty",
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
