import { expect, test } from "bun:test";
import type { ProjectAssetRow } from "../src/portal-ui/project-assets-model";
import { filterAssetRows } from "../src/portal-ui/project-assets-model";

const row = (
  id: string,
  disposition: "active" | "superseded" | "archived",
  options: Readonly<{ cited?: boolean; baseline?: boolean; words?: string }> = {},
): ProjectAssetRow =>
  ({
    asset: {
      id,
      title: id,
      purpose: "Keep durable project context.",
      kind: "reference",
      sourceLocator: `docs/${id.slice(6)}.md`,
      owner: "project-summary:current",
      addedAt: { availability: "unavailable" },
      disposition,
      source: `source:${id}`,
      citations: options.cited
        ? [{ source: "source:roadmap", note: "Supports the active direction." }]
        : [],
      authorityBaselines: [],
    },
    ownerTitle: "Project",
    authorityBaselines: options.baseline ? [{ id: "authority:design", available: true }] : [],
    citationRelations: [],
    searchValue: `${id} ${options.words ?? ""}`.toLowerCase(),
    source: undefined,
  }) as unknown as ProjectAssetRow;

const rows = [
  row("asset:current", "active", { cited: true, words: "design system" }),
  row("asset:replaced", "superseded", { baseline: true }),
  row("asset:archived", "archived"),
];

test("filters Assets by Current, Replaced, Archived, and All without changing order", () => {
  expect(
    filterAssetRows(rows, "", "current", "all", "complete").map((item) => String(item.asset.id)),
  ).toEqual(["asset:current"]);
  expect(
    filterAssetRows(rows, "", "replaced", "all", "complete").map((item) => String(item.asset.id)),
  ).toEqual(["asset:replaced"]);
  expect(
    filterAssetRows(rows, "", "archived", "all", "complete").map((item) => String(item.asset.id)),
  ).toEqual(["asset:archived"]);
  expect(
    filterAssetRows(rows, "", "all", "all", "complete").map((item) => String(item.asset.id)),
  ).toEqual(["asset:current", "asset:replaced", "asset:archived"]);
});

test("combines Search with Citation, Authority baseline, and Uncited evidence filters", () => {
  expect(
    filterAssetRows(rows, "design", "all", "cited", "complete").map((item) =>
      String(item.asset.id),
    ),
  ).toEqual(["asset:current"]);
  expect(
    filterAssetRows(rows, "", "all", "authority-baselines", "complete").map((item) =>
      String(item.asset.id),
    ),
  ).toEqual(["asset:replaced"]);
  expect(
    filterAssetRows(rows, "", "all", "uncited", "complete").map((item) => String(item.asset.id)),
  ).toEqual(["asset:replaced", "asset:archived"]);
});

test("does not claim Uncited results when citation-owner coverage is incomplete", () => {
  expect(filterAssetRows(rows, "", "all", "uncited", "incomplete")).toEqual([]);
});
