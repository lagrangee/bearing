import type { AgentSurface, RuntimeChannel } from "./types";

export const AGENT_SURFACES = ["agent-skills", "claude"] as const;
export const BEARING_MANAGED_START = "<!-- bearing:managed-start -->";
export const BEARING_MANAGED_END = "<!-- bearing:managed-end -->";
const nominationClauses = [
  ["explicit-bearing", "explicit Bearing concepts"],
  ["direct-continuation", "direct Bearing continuation"],
  ["material-governance", "material governance"],
  [
    "named-existing-native-classification",
    "a request naming an existing repository decision or delivery",
  ],
] as const;
const exclusionClauses = [
  ["new-native", "proposed native work"],
  ["generic-tracker-activity", "generic tracker activity"],
  ["repository-location", "repository location"],
  ["generic-roadmap-word", "generic roadmap words"],
  ["repository-independent-conversation", "repository-independent conversation"],
  ["ordinary-non-governance-work", "ordinary non-governance code/documentation work"],
] as const;
const nativeDiscoveryClauses = [
  [
    "exact-inspect-before-owner",
    "For named native work, use Bearing to resolve exact tracker identity and Binding.",
  ],
  [
    "unbound-standalone-owner",
    "If unbound, end Bearing routing; Work Management may proceed standalone.",
  ],
  [
    "unavailable-or-ambiguous-stop-before-owner",
    "If unavailable or ambiguous, stop before owner work.",
  ],
] as const;
const ownerCompositionClause = [
  "preserve-and-return-before-final-response",
  "For bound work, preserve operation, scope, and exact subjects across the owner Skill; after terminal success, reconcile and read back once before replying.",
] as const;
export const BEARING_CONTEXTUAL_NOMINATION_POLICY = Object.freeze({
  includes: Object.freeze(nominationClauses.map(([key]) => key)),
  excludes: Object.freeze(exclusionClauses.map(([key]) => key)),
  nativeDiscovery: Object.freeze(nativeDiscoveryClauses.map(([key]) => key)),
  ownerComposition: ownerCompositionClause[0],
});

const joinClauses = (clauses: readonly (readonly [string, string])[]): string =>
  clauses.map(([, text]) => text).join("; ");
const contextualNomination = joinClauses(nominationClauses);
const contextualExclusions = joinClauses(exclusionClauses);
const contextualNativeDiscovery = nativeDiscoveryClauses.map(([, text]) => text).join(" ");
const contextualOwnerComposition = ownerCompositionClause[1];

export const BEARING_POINTER = `Load \`bearing\` for ${contextualNomination}. ${contextualNativeDiscovery} ${contextualOwnerComposition} Do not load for ${contextualExclusions}. Explicit \`$bearing\` loads it directly.`;
export const BEARING_DEVELOPMENT_POINTER = `This repository selects the Bearing Development Runtime. Load the repository-local \`$bearing-dev\` Skill from \`.agents/skills/bearing-dev\` for ${contextualNomination}. ${contextualNativeDiscovery} ${contextualOwnerComposition} Do not load it for ${contextualExclusions}. Run repository-scoped Bearing commands through this checkout's \`dist/cli.js\`; each command must return a coherent Development Runtime receipt before it can operate. Use \`$bearing-dev\`, not the public \`$bearing\`, for this repository. Do not use or fall back to the public Stable Kit, CLI, Skill, or state. Explicit \`$bearing-dev\` follows this repository-local Development Runtime selection.`;

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
