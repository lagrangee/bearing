import type { MattSemanticSection, MattSemanticSectionAvailability, MattSpec } from "./model";

type ObservedSemanticSectionAvailability = Exclude<MattSemanticSectionAvailability, "unsupported">;

export const MATT_SPEC_SECTION_DEFINITIONS = [
  { role: "problem", title: "Problem Statement", aliases: [] },
  { role: "solution", title: "Solution", aliases: [] },
  { role: "user-stories", title: "User Stories", aliases: [] },
  {
    role: "implementation",
    title: "Implementation Decisions",
    aliases: ["Implementation"],
  },
  { role: "testing", title: "Testing Decisions", aliases: ["Testing"] },
  { role: "out-of-scope", title: "Out of Scope", aliases: [] },
  { role: "further-notes", title: "Further Notes", aliases: [] },
] as const satisfies readonly Readonly<{
  role: MattSpec["sections"][number]["role"];
  title: string;
  aliases: readonly string[];
}>[];

export const semanticSection = (
  role: string,
  availability: MattSemanticSectionAvailability,
): MattSemanticSection => ({ role, availability });

export const semanticAvailabilityForItems = (
  sectionState: "found" | "absent" | "ambiguous",
  itemCount: number,
  hasUnstructuredContent = false,
): ObservedSemanticSectionAvailability => {
  if (sectionState !== "found") return "unavailable";
  if (itemCount > 0) return "available";
  return hasUnstructuredContent ? "unavailable" : "confirmed-empty";
};

export const semanticAvailabilityForOptionalContent = (
  sectionState: "found" | "absent" | "ambiguous",
  hasContent: boolean,
): ObservedSemanticSectionAvailability =>
  sectionState !== "found" ? "unavailable" : hasContent ? "available" : "confirmed-empty";
