import { expect, test } from "bun:test";
import type { ProjectSection } from "../src/portal-ui/project-navigation";
import { parsePortalRoute } from "../src/portal-ui/project-route";

test("parses Catalog and all accepted project destinations", () => {
  expect(parsePortalRoute("/")).toEqual({ kind: "catalog" });
  expect(parsePortalRoute("/projects/bearing")).toEqual({
    kind: "project",
    entryId: "bearing",
    section: "overview",
  });
  expect(parsePortalRoute("/projects/bearing/overview")).toEqual({
    kind: "project",
    entryId: "bearing",
    section: "overview",
  });
  const sections: ProjectSection[] = ["roadmaps", "assets", "audit"];
  for (const section of sections) {
    expect(parsePortalRoute(`/projects/bearing/${section}`)).toEqual({
      kind: "project",
      entryId: "bearing",
      section,
    });
  }
});

test("rejects nested list paths instead of accepting a second subject URL dialect", () => {
  expect(parsePortalRoute("/projects/bearing/roadmaps/roadmap%3Aportal")).toEqual({
    kind: "catalog",
  });
  expect(parsePortalRoute("/projects/bearing/roadmaps/not-a-roadmap")).toEqual({ kind: "catalog" });
  expect(parsePortalRoute("/projects/bearing/roadmaps/roadmap%3Aportal/extra")).toEqual({
    kind: "catalog",
  });
  expect(parsePortalRoute("/projects/../audit")).toEqual({ kind: "catalog" });
  expect(parsePortalRoute("/projects/bearing/unknown")).toEqual({ kind: "catalog" });
});
