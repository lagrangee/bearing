import { catalogEntryIdSchema } from "../catalog/entry-id";
import {
  parsePlanningLineageFilteredView,
  parsePlanningLineageRelationPathToken,
  parsePlanningLineageSemanticAnchor,
  parsePlanningLineageSubject,
  type RequestedPlanningLineageFilteredView,
  type RequestedPlanningLineageSubject,
} from "../planning-lineage-route";
import type { ProjectSection } from "./project-navigation";

export type PortalRoute =
  | Readonly<{ kind: "catalog" }>
  | Readonly<{
      kind: "project";
      entryId: string;
      section: ProjectSection;
      subject?: RequestedPlanningLineageSubject | undefined;
      semanticAnchor?: string | undefined;
      filteredView?: RequestedPlanningLineageFilteredView | undefined;
    }>;

export const assetPreviewHref = (entryId: string, assetId: string): string =>
  `/preview/projects/${encodeURIComponent(entryId)}/assets/${encodeURIComponent(assetId)}`;

const sectionFor = (value: string | undefined): ProjectSection | undefined => {
  switch (value) {
    case undefined:
    case "":
    case "overview":
      return "overview";
    case "roadmaps":
    case "assets":
    case "audit":
    case "lineage":
      return value;
    default:
      return undefined;
  }
};

const decoded = (value: string): string | undefined => {
  try {
    return decodeURIComponent(value);
  } catch {
    return undefined;
  }
};

export const parsePortalRoute = (pathname: string, search = "", hash = ""): PortalRoute => {
  const segments = pathname.split("/");
  if (segments[1] !== "projects" || segments[2] === undefined) return { kind: "catalog" };
  const entryId = catalogEntryIdSchema.safeParse(segments[2]);
  if (!entryId.success) return { kind: "catalog" };
  const section = sectionFor(segments[3]);
  if (section === undefined) return { kind: "catalog" };
  const tail = segments.slice(4).filter((segment) => segment.length > 0);
  if (section === "lineage") {
    if (tail.length !== 2 && tail.length !== 4) return { kind: "catalog" };
    const kind = decoded(tail[0] ?? "");
    const id = decoded(tail[1] ?? "");
    if (kind === undefined || id === undefined) return { kind: "catalog" };
    const subject = parsePlanningLineageSubject(kind, id);
    if (subject === undefined) return { kind: "catalog" };
    const semanticAnchor = parsePlanningLineageSemanticAnchor(hash);
    if (tail.length === 2) {
      return {
        kind: "project",
        entryId: entryId.data,
        section,
        subject,
        ...(semanticAnchor === undefined ? {} : { semanticAnchor }),
      };
    }
    if (tail[2] !== "relations") return { kind: "catalog" };
    const relation = decoded(tail[3] ?? "");
    if (relation === undefined) return { kind: "catalog" };
    const relationKey = parsePlanningLineageRelationPathToken(relation);
    return {
      kind: "project",
      entryId: entryId.data,
      section,
      subject,
      filteredView: parsePlanningLineageFilteredView(relationKey ?? "", search),
      ...(semanticAnchor === undefined ? {} : { semanticAnchor }),
    };
  }
  return tail.length === 0
    ? { kind: "project", entryId: entryId.data, section }
    : { kind: "catalog" };
};
