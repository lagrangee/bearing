import type { AgentSurface, RuntimeChannel } from "./types";

export const AGENT_SURFACES = ["agent-skills", "claude"] as const;
export const BEARING_MANAGED_START = "<!-- bearing:managed-start -->";
export const BEARING_MANAGED_END = "<!-- bearing:managed-end -->";
const nominationClauses = [
  ["bearing-planning-or-configuration", "this repository's Bearing planning or configuration"],
  [
    "planning-related-feature",
    "a feature with an evident relationship to or consequence for accepted planning",
  ],
  [
    "existing-native-work",
    "work on an existing Map, PRD, Ticket, or tracker issue, including through another Skill",
  ],
] as const;
const exclusionClauses = [["unrelated-work", "unrelated work"]] as const;
export const BEARING_CONTEXTUAL_NOMINATION_POLICY = Object.freeze({
  includes: Object.freeze(nominationClauses.map(([key]) => key)),
  excludes: Object.freeze(exclusionClauses.map(([key]) => key)),
});

const joinClauses = (clauses: readonly (readonly [string, string])[]): string =>
  clauses.map(([, text]) => text).join("; ");
const contextualNomination = joinClauses(nominationClauses);
const contextualExclusions = joinClauses(exclusionClauses);

export const BEARING_POINTER = `Load \`bearing\` for ${contextualNomination}. Use normal Agent behavior for ${contextualExclusions}.`;
export const BEARING_DEVELOPMENT_POINTER = `This repository selects the Bearing Development Runtime. Load the repository-local \`$bearing-dev\` Skill from \`.agents/skills/bearing-dev\` for ${contextualNomination}. Use normal Agent behavior for ${contextualExclusions}. Run repository-scoped Bearing commands through this checkout's \`dist/cli.js\`; each command must return a coherent Development Runtime receipt before it can operate. Use \`$bearing-dev\`, not the public \`$bearing\`, for this repository. Do not use or fall back to the public Stable Kit, CLI, Skill, or state. Explicit \`$bearing-dev\` follows this repository-local Development Runtime selection.`;

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
