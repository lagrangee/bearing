import type { AgentSurface, RuntimeChannel } from "./types";

export const AGENT_SURFACES = ["agent-skills", "claude"] as const;
export const BEARING_MANAGED_START = "<!-- bearing:managed-start -->";
export const BEARING_MANAGED_END = "<!-- bearing:managed-end -->";
const nominationClauses = [
  ["explicit-bearing", "explicit Bearing concepts"],
  ["direct-continuation", "a reliable direct continuation of Bearing work in this repository"],
  ["material-governance", "material planning/governance relevance"],
  [
    "bound-managed-decision-or-delivery",
    "a bound decision or delivery managed by the configured Work Management contract",
  ],
] as const;
const exclusionClauses = [
  ["unbound-or-uncertain-native", "unbound, unavailable, or ambiguous native work"],
  ["new-native", "newly proposed native work"],
  ["generic-tracker-activity", "generic issue-tracker activity"],
  ["repository-location", "repository location"],
  ["generic-roadmap-word", "generic roadmap words"],
  ["repository-independent-conversation", "repository-independent conversation"],
  ["ordinary-non-governance-work", "ordinary non-governance code/documentation work"],
] as const;
export const BEARING_CONTEXTUAL_NOMINATION_POLICY = Object.freeze({
  includes: Object.freeze(nominationClauses.map(([key]) => key)),
  excludes: Object.freeze(exclusionClauses.map(([key]) => key)),
  ownerComposition: "bearing-remains-router" as const,
});

const joinClauses = (clauses: readonly (readonly [string, string])[]): string =>
  clauses.map(([, text]) => text).join("; ");
const contextualNomination = joinClauses(nominationClauses);
const contextualExclusions = joinClauses(exclusionClauses);
const contextualOwnerComposition =
  "For exact managed work, Bearing stays the router when another owner Skill is invoked.";

export const BEARING_POINTER = `Load \`bearing\` only for ${contextualNomination}. ${contextualOwnerComposition} Do not load for ${contextualExclusions}. This pointer is contextual guidance, not an executable hook or lifecycle preflight. Each requested functional operation validates its required lifecycle. Explicit \`$bearing\` loads the Skill directly.`;
export const BEARING_DEVELOPMENT_POINTER = `This repository selects the Bearing Development Runtime. For a new request, load the repository-local \`$bearing-dev\` Skill from \`.agents/skills/bearing-dev\` only for ${contextualNomination}. ${contextualOwnerComposition} Do not load it for ${contextualExclusions}. Run repository-scoped Bearing commands through this checkout's \`dist/cli.js\`; each command must return a coherent Development Runtime receipt before it can operate. Use \`$bearing-dev\`, not the public \`$bearing\`, for this repository. Do not use or fall back to the public Stable Kit, CLI, Skill, or state. Explicit \`$bearing-dev\` follows this repository-local Development Runtime selection.`;

export const BEARING_MANAGED_BLOCK = `${BEARING_MANAGED_START}\n${BEARING_POINTER}\n${BEARING_MANAGED_END}`;
export const BEARING_DEVELOPMENT_MANAGED_BLOCK = `${BEARING_MANAGED_START}\n${BEARING_DEVELOPMENT_POINTER}\n${BEARING_MANAGED_END}`;

export const bearingManagedBlock = (runtime: RuntimeChannel = "stable"): string =>
  runtime === "development" ? BEARING_DEVELOPMENT_MANAGED_BLOCK : BEARING_MANAGED_BLOCK;

export const agentSurfaceEntryFile = (surface: AgentSurface): string =>
  surface === "agent-skills" ? "AGENTS.md" : "CLAUDE.md";

export const bearingManagedRange = (
  source: string,
): Readonly<{ start: number; end: number }> | undefined => {
  const starts = [...source.matchAll(new RegExp(BEARING_MANAGED_START, "gu"))];
  const ends = [...source.matchAll(new RegExp(BEARING_MANAGED_END, "gu"))];
  if (starts.length === 0 && ends.length === 0) return undefined;
  const start = starts[0]?.index;
  const endStart = ends[0]?.index;
  if (
    starts.length !== 1 ||
    ends.length !== 1 ||
    start === undefined ||
    endStart === undefined ||
    endStart < start
  ) {
    throw new Error("Agent Surface entry contains a malformed Bearing managed block.");
  }
  return { start, end: endStart + BEARING_MANAGED_END.length };
};

export const withBearingManagedPointer = (
  source: string,
  runtime: RuntimeChannel = "stable",
): string => {
  const managedBlock = bearingManagedBlock(runtime);
  const range = bearingManagedRange(source);
  if (range !== undefined)
    return `${source.slice(0, range.start)}${managedBlock}${source.slice(range.end)}`;
  const separator = source.length === 0 ? "" : source.endsWith("\n") ? "\n" : "\n\n";
  return `${source}${separator}${managedBlock}\n`;
};

export const withoutBearingManagedPointer = (source: string): string => {
  const range = bearingManagedRange(source);
  if (range === undefined) return source;
  return `${source.slice(0, range.start)}${source.slice(range.end)}`;
};
