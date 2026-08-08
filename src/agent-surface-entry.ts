import type { AgentSurface } from "./types";

export const AGENT_SURFACES = ["agent-skills", "claude"] as const;
export const BEARING_MANAGED_START = "<!-- bearing:managed-start -->";
export const BEARING_MANAGED_END = "<!-- bearing:managed-end -->";
export const BEARING_POINTER =
  "For a new request whose correct answer or action may depend on this repository, load the global `bearing` skill through this managed pointer. The skill must run `bearing configure inspect --repo <repository-root>` and continue model-invoked work only when the typed lifecycle is Active. Fresh and Deactivated model-invoked work stops without Bearing; Invalid or Unsupported requires explicit `/bearing` for reviewed platform removal. Explicit `/bearing` loads the skill directly. Reuse visibly reliable Bearing orientation only for a direct continuation of the same request and repository. Clear repository-independent conversation does not load Bearing.";

const MANAGED_BLOCK = `${BEARING_MANAGED_START}\n${BEARING_POINTER}\n${BEARING_MANAGED_END}`;

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

export const withBearingManagedPointer = (source: string): string => {
  const range = bearingManagedRange(source);
  if (range !== undefined)
    return `${source.slice(0, range.start)}${MANAGED_BLOCK}${source.slice(range.end)}`;
  const separator = source.length === 0 ? "" : source.endsWith("\n") ? "\n" : "\n\n";
  return `${source}${separator}${MANAGED_BLOCK}\n`;
};

export const withoutBearingManagedPointer = (source: string): string => {
  const range = bearingManagedRange(source);
  if (range === undefined) return source;
  return `${source.slice(0, range.start)}${source.slice(range.end)}`;
};
