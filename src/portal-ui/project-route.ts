import { catalogEntryIdSchema } from "../catalog/entry-id";
import { roadmapIdSchema } from "../project-snapshot/schema-primitives";
import type { ProjectSection } from "./project-navigation";

export type PortalRoute =
  | Readonly<{ kind: "catalog" }>
  | Readonly<{
      kind: "project";
      entryId: string;
      section: ProjectSection;
      roadmapId?: string | undefined;
    }>;

const sectionFor = (value: string | undefined): ProjectSection | undefined => {
  switch (value) {
    case undefined:
    case "":
    case "overview":
      return "overview";
    case "roadmaps":
    case "assets":
    case "audit":
      return value;
    default:
      return undefined;
  }
};

export const parsePortalRoute = (pathname: string): PortalRoute => {
  const segments = pathname.split("/");
  if (segments[1] !== "projects" || segments[2] === undefined) return { kind: "catalog" };
  const entryId = catalogEntryIdSchema.safeParse(segments[2]);
  if (!entryId.success) return { kind: "catalog" };
  const section = sectionFor(segments[3]);
  if (section === undefined) return { kind: "catalog" };
  const tail = segments.slice(4).filter((segment) => segment.length > 0);
  if (section !== "roadmaps") {
    return tail.length === 0
      ? { kind: "project", entryId: entryId.data, section }
      : { kind: "catalog" };
  }
  if (tail.length > 1) return { kind: "catalog" };
  if (tail.length === 1) {
    let candidate: string;
    try {
      candidate = decodeURIComponent(tail[0] ?? "");
    } catch {
      return { kind: "catalog" };
    }
    const roadmapId = roadmapIdSchema.safeParse(candidate);
    if (!roadmapId.success) return { kind: "catalog" };
    return { kind: "project", entryId: entryId.data, section, roadmapId: roadmapId.data };
  }
  return { kind: "project", entryId: entryId.data, section };
};
