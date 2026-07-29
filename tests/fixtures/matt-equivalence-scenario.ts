import {
  encodeGitHubMattNativeScope,
  type GitHubReadRequest,
} from "../../src/providers/matt-skills-v1/github";
import { makeTemporaryDirectory, writeFixture } from "../helpers";
import type { MattReferenceEquivalenceView } from "../helpers/matt-reference-oracle";
import {
  customGitHubTriageMapping,
  FixtureGitHubTransport,
  type GitHubFixtureResponse,
  githubComment,
  githubFixtureResponse,
  githubIssue,
  githubRepository,
} from "./github-matt-api";

export const mattEquivalenceGeneration = {
  fingerprint: "sha256:matt-equivalence-generation",
};

export const mattEquivalenceLocalContractLocator = "docs/agents/issue-tracker.md";
export const mattEquivalenceTriageLocator = "docs/agents/triage-labels.md";
export const mattEquivalenceLocalScope = ".scratch/matt-equivalence";

const localContract = `# Issue tracker: Local Markdown

Issues and PRDs for this repo live as markdown files in \`.scratch/\`.

## Conventions

- One feature per directory: \`.scratch/<feature-slug>/\`
- The PRD is \`.scratch/<feature-slug>/PRD.md\`
- Implementation issues are \`.scratch/<feature-slug>/issues/<NN>-<slug>.md\`, numbered from \`01\`
- Triage state is recorded as a \`Status:\` line near the top of each issue file (see \`triage-labels.md\` for the role strings)
- Comments and conversation history append to the bottom of the file under a \`## Comments\` heading

## Wayfinding operations

- Map: \`.scratch/<effort>/map.md\` - the Notes / Decisions-so-far / Fog body.
- Child ticket: \`.scratch/<effort>/issues/NN-<slug>.md\`, numbered from \`01\`, with the question in the body.
`;

const localMap = `# Reference Map

Status: active

## Destination

Prove one complete Matt-native semantic scope.

## Notes

- Keep provider-native identity outside the semantic oracle.

## Decisions so far

- [Research the semantic contract](issues/03-research.md) — Use the versioned capture seam.

## Fog

- Whether one source comment can be uniquely identified as an Answer.

## Out of scope

- [Grill the ontology boundary](issues/05-grilling.md) — Do not build a universal tracker ontology.
`;

const referenceSpecBody = `## Problem Statement

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

const localSpec = `# Reference Spec

Status: ready-for-agent

${referenceSpecBody}`;

const localWayfinder = (input: {
  number: string;
  slug: string;
  title: string;
  type: "research" | "prototype" | "grilling" | "task";
  status?: "claimed" | "resolved";
  question: string;
  blockedBy?: string;
  claimant?: string;
  answer?: string;
  comment?: string;
}): readonly [string, string] => [
  `${mattEquivalenceLocalScope}/issues/${input.number}-${input.slug}.md`,
  `# ${input.title}

Type: ${input.type}
${input.blockedBy === undefined ? "" : `\nBlocked by: ${input.blockedBy}\n`}

${input.status === undefined ? "" : `Status: ${input.status}\n`}
${input.claimant === undefined ? "" : `\nClaimed by: ${input.claimant}\n`}

## Question

${input.question}
${input.answer === undefined ? "" : `\n## Answer\n\n${input.answer}\n`}
${input.comment === undefined ? "" : `\n## Comments\n\n${input.comment}\n`}
`,
];

const localDelivery = `# Implement provider capture

**What to build:** A versioned capture seam.

Blocked by: 03

Status: custom-ready

- [ ] Return independent state, freshness and completion.
- [ ] Keep the capture immutable.
`;

const localIncoming = `# Support a custom-mapped enhancement

Category: custom-enhancement

Status: custom-ready

[https://example.com/customer-report](https://example.com/customer-report)
`;

export const writeMattEquivalenceLocalRepository = async (): Promise<string> => {
  const root = await makeTemporaryDirectory("bearing-matt-equivalence-local-");
  await writeFixture(root, mattEquivalenceLocalContractLocator, localContract);
  await writeFixture(root, mattEquivalenceTriageLocator, customGitHubTriageMapping);
  await writeFixture(root, `${mattEquivalenceLocalScope}/map.md`, localMap);
  await writeFixture(root, `${mattEquivalenceLocalScope}/PRD.md`, localSpec);
  for (const [locator, source] of [
    localWayfinder({
      number: "03",
      slug: "research",
      title: "Research the semantic contract",
      type: "research",
      status: "resolved",
      question: "Which semantics are durable?",
      answer: "Preserve workflow-specific lifecycle and evidence.",
      comment: "This comment is not the Answer.",
    }),
    localWayfinder({
      number: "04",
      slug: "prototype",
      title: "Prototype the capture seam",
      type: "prototype",
      question: "Does one capture preserve all axes?",
      blockedBy: "03",
    }),
    localWayfinder({
      number: "05",
      slug: "grilling",
      title: "Grill the ontology boundary",
      type: "grilling",
      status: "resolved",
      question: "What must remain provider-specific?",
    }),
    localWayfinder({
      number: "06",
      slug: "task",
      title: "Record the accepted decision",
      type: "task",
      status: "claimed",
      question: "Can the decision be written durably?",
      claimant: "lago",
    }),
  ]) {
    await writeFixture(root, locator, source);
  }
  await writeFixture(root, `${mattEquivalenceLocalScope}/issues/07-delivery.md`, localDelivery);
  await writeFixture(root, `${mattEquivalenceLocalScope}/issues/08-incoming.md`, localIncoming);
  return root;
};

export const mattEquivalenceGitHubMap = githubIssue({
  number: 1,
  title: "Reference Map",
  labels: ["wayfinder:map"],
  body: `## Destination

Prove one complete Matt-native semantic scope.

## Notes

- Keep provider-native identity outside the semantic oracle.

## Decisions so far

- [Research the semantic contract](https://github.com/example/reference/issues/3#issuecomment-301) — Use the versioned capture seam.

## Fog

- Whether one source comment can be uniquely identified as an Answer.

## Out of scope

- [Grill the ontology boundary](https://github.com/example/reference/issues/5) — Do not build a universal tracker ontology.
`,
});

const mattEquivalenceGitHubSpec = githubIssue({
  number: 2,
  title: "Reference Spec",
  labels: ["custom-ready"],
  body: referenceSpecBody,
});

const mattEquivalenceGitHubResearch = githubIssue({
  number: 3,
  title: "Research the semantic contract",
  labels: ["wayfinder:research"],
  state: "closed",
  stateReason: "completed",
  body: `## Question

Which semantics are durable?
`,
});

const mattEquivalenceGitHubPrototype = githubIssue({
  number: 4,
  title: "Prototype the capture seam",
  labels: ["wayfinder:prototype"],
  body: `## Question

Does one capture preserve all axes?
`,
});

const mattEquivalenceGitHubGrilling = githubIssue({
  number: 5,
  title: "Grill the ontology boundary",
  labels: ["wayfinder:grilling"],
  state: "closed",
  stateReason: "not_planned",
  body: `## Question

What must remain provider-specific?
`,
});

const mattEquivalenceGitHubTask = githubIssue({
  number: 6,
  title: "Record the accepted decision",
  labels: ["wayfinder:task"],
  assignees: ["lago"],
  body: `## Question

Can the decision be written durably?
`,
});

const mattEquivalenceGitHubDelivery = githubIssue({
  number: 7,
  title: "Implement provider capture",
  labels: ["custom-ready"],
  body: `## What to build

A versioned capture seam.

## Acceptance criteria

- [ ] Return independent state, freshness and completion.
- [ ] Keep the capture immutable.
`,
});

const mattEquivalenceGitHubIncoming = githubIssue({
  number: 8,
  title: "Support a custom-mapped enhancement",
  labels: ["custom-enhancement", "custom-ready"],
  body: "[https://example.com/customer-report](https://example.com/customer-report)",
});

const githubObjects = [
  mattEquivalenceGitHubMap,
  mattEquivalenceGitHubSpec,
  mattEquivalenceGitHubResearch,
  mattEquivalenceGitHubPrototype,
  mattEquivalenceGitHubGrilling,
  mattEquivalenceGitHubTask,
  mattEquivalenceGitHubDelivery,
  mattEquivalenceGitHubIncoming,
] as const;

export const mattEquivalenceGitHubObjectCount = githubObjects.length;

export const mattEquivalenceGitHubScope = encodeGitHubMattNativeScope({
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
    number: mattEquivalenceGitHubMap.number,
    databaseId: String(mattEquivalenceGitHubMap.id),
    nodeId: mattEquivalenceGitHubMap.node_id,
  },
});

const githubChildrenFor = (number: number) => {
  if (number === mattEquivalenceGitHubMap.number) {
    return [
      mattEquivalenceGitHubResearch,
      mattEquivalenceGitHubPrototype,
      mattEquivalenceGitHubGrilling,
      mattEquivalenceGitHubTask,
      mattEquivalenceGitHubSpec,
      mattEquivalenceGitHubIncoming,
    ];
  }
  if (number === mattEquivalenceGitHubSpec.number) return [mattEquivalenceGitHubDelivery];
  return [];
};

const githubBlockersFor = (number: number) =>
  number === mattEquivalenceGitHubPrototype.number ||
  number === mattEquivalenceGitHubDelivery.number
    ? [mattEquivalenceGitHubResearch]
    : [];

const githubCommentsFor = (number: number) =>
  number === mattEquivalenceGitHubResearch.number
    ? [
        githubComment({
          id: 301,
          issue: mattEquivalenceGitHubResearch.number,
          body: "Preserve workflow-specific lifecycle and evidence.",
        }),
        githubComment({
          id: 302,
          issue: mattEquivalenceGitHubResearch.number,
          body: "This comment is not the Answer.",
          author: "reviewer",
        }),
      ]
    : [];

const createGitHubFixtures = (): Record<string, GitHubFixtureResponse> => {
  const fixtures: Record<string, GitHubFixtureResponse> = {
    "repos/example/reference": {
      first: githubFixtureResponse(githubRepository, '"repo-equivalence-v1"'),
    },
  };
  for (const issue of githubObjects) {
    const endpoint = `repos/example/reference/issues/${issue.number}`;
    fixtures[endpoint] = {
      first: githubFixtureResponse(issue, `"issue-${issue.number}-equivalence-v1"`),
    };
    fixtures[`${endpoint}/comments?per_page=100&page=1`] = {
      first: githubFixtureResponse(
        githubCommentsFor(issue.number),
        `"comments-${issue.number}-equivalence-v1"`,
      ),
    };
    fixtures[`${endpoint}/dependencies/blocked_by?per_page=100&page=1`] = {
      first: githubFixtureResponse(
        githubBlockersFor(issue.number),
        `"dependencies-${issue.number}-equivalence-v1"`,
      ),
    };
    fixtures[`${endpoint}/sub_issues?per_page=100&page=1`] = {
      first: githubFixtureResponse(
        githubChildrenFor(issue.number),
        `"children-${issue.number}-equivalence-v1"`,
      ),
    };
  }
  return fixtures;
};

export const createMattEquivalenceGitHubTransport = (): FixtureGitHubTransport =>
  new FixtureGitHubTransport(createGitHubFixtures());

export const mattEquivalenceAliases = (
  kind: "local" | "github",
): Readonly<Record<string, string>> => {
  const references =
    kind === "local"
      ? {
          map: `${mattEquivalenceLocalScope}/map.md`,
          spec: `${mattEquivalenceLocalScope}/PRD.md`,
          research: `${mattEquivalenceLocalScope}/issues/03-research.md`,
          prototype: `${mattEquivalenceLocalScope}/issues/04-prototype.md`,
          grilling: `${mattEquivalenceLocalScope}/issues/05-grilling.md`,
          task: `${mattEquivalenceLocalScope}/issues/06-task.md`,
          "delivery-one": `${mattEquivalenceLocalScope}/issues/07-delivery.md`,
          "incoming-enhancement": `${mattEquivalenceLocalScope}/issues/08-incoming.md`,
        }
      : {
          map: "github:R_reference:I_reference_1",
          spec: "github:R_reference:I_reference_2",
          research: "github:R_reference:I_reference_3",
          prototype: "github:R_reference:I_reference_4",
          grilling: "github:R_reference:I_reference_5",
          task: "github:R_reference:I_reference_6",
          "delivery-one": "github:R_reference:I_reference_7",
          "incoming-enhancement": "github:R_reference:I_reference_8",
        };
  return Object.fromEntries(
    Object.entries(references).map(([alias, reference]) => [reference, alias]),
  );
};

export const githubRequestBudget = (
  requests: readonly GitHubReadRequest[],
): Readonly<{
  uniqueEndpointCount: number;
  maximumRequestsForOneEndpoint: number;
  linearUpperBound: number;
}> => {
  const counts = new Map<string, number>();
  for (const request of requests) {
    counts.set(request.endpoint, (counts.get(request.endpoint) ?? 0) + 1);
  }
  return {
    uniqueEndpointCount: counts.size,
    maximumRequestsForOneEndpoint: Math.max(0, ...counts.values()),
    linearUpperBound: 2 * (1 + mattEquivalenceGitHubObjectCount * 5),
  };
};

export const expectedMattEquivalenceSemantics: MattReferenceEquivalenceView = {
  capture: {
    state: "available",
    freshness: "current",
    coverage: "complete",
    completion: "incomplete",
    diagnostics: [],
  },
  map: {
    title: "Reference Map",
    destination: "Prove one complete Matt-native semantic scope.",
    notes: ["Keep provider-native identity outside the semantic oracle."],
    decisions: [
      {
        ticket: "research",
        gist: "Use the versioned capture seam.",
        sourceKind: "decision",
      },
    ],
    fog: ["Whether one source comment can be uniquely identified as an Answer."],
    outOfScope: [
      {
        ticket: "grilling",
        rationale: "Do not build a universal tracker ontology.",
        sourceKind: "disposition",
      },
    ],
    lifecycle: "active",
  },
  spec: {
    title: "Reference Spec",
    lifecycle: "ready-for-agent",
    sections: [
      {
        role: "problem",
        title: "Problem Statement",
        body: "Local and GitHub must preserve the same accepted semantics.",
      },
      {
        role: "solution",
        title: "Solution",
        body: "Capture one concrete Matt scope through a versioned provider seam.",
      },
      {
        role: "user-stories",
        title: "User Stories",
        body: "A consumer can distinguish workflow truth without native identity coupling.",
      },
      {
        role: "implementation",
        title: "Implementation Decisions",
        body: "Keep provider-specific projection behind a provider-neutral wrapper.",
      },
      {
        role: "testing",
        title: "Testing Decisions",
        body: "Compare public provider captures through a test-owned oracle.",
      },
      {
        role: "out-of-scope",
        title: "Out of Scope",
        body: "Do not build a generic tracker ontology.",
      },
      {
        role: "further-notes",
        title: "Further Notes",
        body: "Opaque relation references are capture-local.",
      },
    ],
  },
  wayfinder: [
    {
      ref: "research",
      title: "Research the semantic contract",
      subtype: "research",
      question: "Which semantics are durable?",
      claim: { state: "unclaimed" },
      answer: {
        availability: "available",
        body: "Preserve workflow-specific lifecycle and evidence.",
        sourceKind: "answer",
      },
      lifecycle: "resolved-on-route",
      closure: "closed:completed",
      comments: [
        {
          role: "ordinary-comment",
          body: "This comment is not the Answer.",
        },
      ],
    },
    {
      ref: "prototype",
      title: "Prototype the capture seam",
      subtype: "prototype",
      question: "Does one capture preserve all axes?",
      claim: { state: "unclaimed" },
      answer: { availability: "unavailable", reason: "not-authored" },
      lifecycle: "open",
      closure: "open",
      comments: [],
    },
    {
      ref: "grilling",
      title: "Grill the ontology boundary",
      subtype: "grilling",
      question: "What must remain provider-specific?",
      claim: { state: "unclaimed" },
      answer: { availability: "unavailable", reason: "not-authored" },
      lifecycle: "ruled-out-of-scope",
      closure: "closed:wontfix",
      comments: [],
    },
    {
      ref: "task",
      title: "Record the accepted decision",
      subtype: "task",
      question: "Can the decision be written durably?",
      claim: { state: "claimed", claimantAmbiguous: undefined },
      answer: { availability: "unavailable", reason: "not-authored" },
      lifecycle: "open",
      closure: "open",
      comments: [],
    },
  ],
  delivery: [
    {
      ref: "delivery-one",
      title: "Implement provider capture",
      whatToBuild: "A versioned capture seam.",
      acceptanceCriteria: [
        "Return independent state, freshness and completion.",
        "Keep the capture immutable.",
      ],
      lifecycle: { state: "open" },
      closure: "open",
      comments: [],
    },
  ],
  incoming: [
    {
      ref: "incoming-enhancement",
      title: "Support a custom-mapped enhancement",
      classification: {
        category: "enhancement",
        state: "ready-for-agent",
      },
      lifecycle: "open",
      content: [
        {
          role: "source-anchor",
          body: "https://example.com/customer-report",
          sourceKind: "external",
        },
      ],
    },
  ],
  parentChild: ["map>research", "map>prototype", "map>grilling", "map>task", "spec>delivery-one"],
  blockedBy: ["prototype<research", "delivery-one<research"],
};
