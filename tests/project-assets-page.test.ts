import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AssetsPage } from "../src/portal-ui/assets-page";
import type { ProjectSnapshot } from "../src/project-snapshot/contract";
import { createProjectOverviewFixture } from "./fixtures/project-overview";

const render = (snapshot: ProjectSnapshot): string =>
  renderToStaticMarkup(
    createElement(AssetsPage, {
      entryId: "bearing",
      snapshot,
      onNavigate: () => {},
    }),
  );

test("renders the accepted Assets reading surface without embedding Asset content", () => {
  const html = render(createProjectOverviewFixture());

  expect(html).toContain("<h1>Assets</h1>");
  expect(html).toContain('placeholder="Find an Asset"');
  for (const option of [
    "Current",
    "Replaced",
    "Archived",
    "All Assets",
    "Cited",
    "Authority baselines",
    "Uncited",
  ]) {
    expect(html).toContain(option);
  }
  expect(html).toContain("Evidence");
  expect(html).toContain("Cited");
  expect(html).toContain("Planning Model Evidence");
  expect(html).not.toContain("owner gate:one");
  expect(html).not.toContain(".scratch/evidence/planning-model");
  expect(html).not.toContain("Quick Look");
  expect(html).not.toContain("Showing 1 of 1");
  expect(html).not.toContain("Asset body");
  expect(html).not.toContain("Preview");
});

test("renders empty, partial, and invalid Assets as scoped projection states", () => {
  const snapshot = createProjectOverviewFixture();
  const issue = { code: "invalid-asset", target: "assets", message: "Asset unavailable." };
  expect(render({ ...snapshot, assets: { validity: "available", items: [] } })).toContain(
    "No Assets",
  );
  if (snapshot.assets.validity === "invalid") throw new Error("Expected Assets fixture.");
  expect(
    render({
      ...snapshot,
      assets: { validity: "partial", items: snapshot.assets.items, issues: [issue] },
    } as ProjectSnapshot),
  ).toContain("Asset orientation is partial");
  expect(
    render({
      ...snapshot,
      assets: { validity: "invalid", issues: [issue] },
    } as ProjectSnapshot),
  ).toContain("Assets unavailable");
});
