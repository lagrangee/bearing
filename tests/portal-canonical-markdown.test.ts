import { expect, test } from "bun:test";
import { realpath, rm } from "node:fs/promises";
import { createPortalProjectQueryService } from "../src/portal/project-query-service";
import { createProjectOverviewFixture } from "./fixtures/project-overview";
import { createValidBearingRepo } from "./helpers";

test("Portal Host renders canonical Effort Intent Markdown for the detail route", async () => {
  const projectRoot = await realpath(await createValidBearingRepo());
  const fixture = createProjectOverviewFixture();
  if (fixture.efforts.validity !== "available") throw new Error("Expected Effort fixture.");
  const effort = fixture.efforts.items.find((item) => item.id === "effort:portal");
  if (effort === undefined) throw new Error("Expected target Effort.");
  const intent = "Preserve `matt.local.relation.blocked-by-format`.";
  const source = fixture.sources.find((item) => item.reference === effort.source);
  if (source === undefined) throw new Error("Expected Effort source.");
  try {
    const service = createPortalProjectQueryService({
      readCatalog: async () => ({
        state: "ready",
        entries: [
          {
            entryId: "project",
            displayName: "Project",
            repoRoot: projectRoot,
            availability: "available",
          },
        ],
      }),
      readRows: async (_repoRoot, section = "overview", target) =>
        ({
          section,
          ...(target ? { target } : {}),
          objects: [{ kind: "effort", value: { ...effort, intent } }],
          lineage: [],
          attentionCount: 0,
          attention: [],
          diagnostics: [],
          sources: [source],
        }) as never,
    });

    const result = await service.read("project", "lineage", {
      kind: "effort",
      id: "effort:portal",
    });

    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") throw new Error("Expected ready detail result.");
    expect(result.rows.renderedMarkdown).toContainEqual(
      expect.objectContaining({
        sourceLocator: source.displayLocator,
        markdown: intent,
        presentation: "rendered",
        html: expect.stringContaining("<code>matt.local.relation.blocked-by-format</code>"),
      }),
    );
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});
