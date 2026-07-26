import { expect, test } from "bun:test";
import {
  assetInspection,
  buildProjectAssetsModel,
  filterAssetRows,
} from "../src/portal-ui/project-assets-model";
import type { ProjectSnapshot } from "../src/project-snapshot/contract";
import { projectSnapshotSchema } from "../src/project-snapshot/schema";
import { createSourceRecord } from "../src/project-snapshot/source-records";
import { createProjectOverviewFixture } from "./fixtures/project-overview";

const twoAssetFixture = (): ProjectSnapshot => {
  const snapshot = createProjectOverviewFixture();
  if (snapshot.assets.validity !== "available") throw new Error("Expected Assets fixture.");
  const source = createSourceRecord(snapshot.basis.sitemapFingerprint, {
    kind: "asset",
    locator: ".bearing/state/assets.md",
    binding: { role: "asset", identity: "asset:uncited-context" },
    fragment: "asset:uncited-context",
  });
  return projectSnapshotSchema.parse({
    ...snapshot,
    assets: {
      validity: "available",
      items: [
        ...snapshot.assets.items,
        {
          id: "asset:uncited-context",
          title: "Uncited Product Context",
          source: source.reference,
          citations: [],
          kind: "product-design",
          owner: "effort:portal",
          producer: { kind: "planning-skill", name: "impeccable", reference: "review:42" },
          lifecycleSource: "registry",
          disposition: "superseded",
          supersededBy: "asset:planning-model-evidence",
          producedFor: ".scratch/portal/issues/13-assets.md",
          displayLocation: "PRODUCT.md",
          contentAvailability: "available",
          adoptedByAuthorityIds: [],
          gatePassageEvidenceFor: [],
          citationCount: 0,
        },
      ],
    },
    sources: [...snapshot.sources, source],
  });
};

test("keeps projected Asset order while search and citation filters expose zero-reference Assets", () => {
  const model = buildProjectAssetsModel(twoAssetFixture());
  expect(model.state).toBe("available");
  if (model.state !== "available") throw new Error("Expected available Assets.");

  expect(model.rows.map((row) => String(row.asset.id))).toEqual([
    "asset:planning-model-evidence",
    "asset:uncited-context",
  ]);
  expect(filterAssetRows(model.rows, "generic-agent", "all").map((row) => row.asset.title)).toEqual(
    ["Planning Model Evidence"],
  );
  expect(filterAssetRows(model.rows, "asset:uncited-context", "all")).toHaveLength(1);
  expect(filterAssetRows(model.rows, "", "uncited").map((row) => row.asset.title)).toEqual([
    "Uncited Product Context",
  ]);
  expect(filterAssetRows(model.rows, "product", "cited")).toEqual([]);
});

test("keeps trustworthy partial Assets readable and scopes an invalid collection", () => {
  const snapshot = twoAssetFixture();
  if (snapshot.assets.validity !== "available") throw new Error("Expected Assets fixture.");
  const issue = {
    code: "invalid-asset",
    target: ".bearing/state/assets.md#entry-3",
    message: "One Asset registry entry is invalid.",
  };

  const partial = buildProjectAssetsModel({
    ...snapshot,
    assets: { validity: "partial", items: snapshot.assets.items, issues: [issue] },
  } as ProjectSnapshot);
  expect(partial.state).toBe("partial");
  expect(partial.state === "partial" && partial.rows).toHaveLength(2);
  expect(partial.state === "partial" && partial.issueCount).toBe(1);

  expect(
    buildProjectAssetsModel({
      ...snapshot,
      assets: { validity: "invalid", issues: [issue] },
    } as ProjectSnapshot),
  ).toEqual({ state: "invalid", issueCount: 1, rows: [] });
});

test("builds one read-only Asset inspection from explicit projection semantics", () => {
  const model = buildProjectAssetsModel(twoAssetFixture());
  if (model.state !== "available") throw new Error("Expected available Assets.");
  const first = model.rows[0];
  if (first === undefined) throw new Error("Expected a projected Asset row.");
  const selection = assetInspection(first);

  expect(selection).toMatchObject({
    eyebrow: "Asset",
    title: "Planning Model Evidence",
    handoff: true,
    nativeSourceHandoff: true,
    source: { displayLocator: ".bearing/state/assets.md" },
  });
  expect(selection.facts).toContainEqual({
    label: "Stable ID",
    value: "asset:planning-model-evidence",
    code: true,
  });
  expect(selection.facts).toContainEqual({
    label: "Producer",
    value: "executor-profile · generic-agent",
  });
  expect(selection.facts).toContainEqual({ label: "Content", value: "Available" });
  expect(
    selection.sections?.find((section) => section.title === "Gate Passage evidence"),
  ).toMatchObject({ title: "Gate Passage evidence", items: ["gate:one"] });
  expect(
    selection.sections?.find((section) => section.title === "Planning Citations")?.items,
  ).toEqual([expect.stringContaining("effort:model · .bearing/state/efforts/model.md")]);

  const second = model.rows[1];
  if (second === undefined) throw new Error("Expected the second projected Asset row.");
  const lifecycle = assetInspection(second);
  expect(lifecycle.facts).toContainEqual({ label: "Lifecycle", value: "Registry" });
  expect(lifecycle.facts).toContainEqual({ label: "Disposition", value: "superseded" });
  expect(lifecycle.facts).toContainEqual({
    label: "Superseded by",
    value: "asset:planning-model-evidence",
    code: true,
  });
  expect(lifecycle.facts).toContainEqual({
    label: "Produced for",
    value: ".scratch/portal/issues/13-assets.md",
    code: true,
  });
  expect(lifecycle.facts).toContainEqual({ label: "Producer ref", value: "review:42", code: true });
});

test("keeps explicit missing relation targets visible in Asset inspection", () => {
  const snapshot = twoAssetFixture();
  if (snapshot.assets.validity !== "available") throw new Error("Expected Assets fixture.");
  const first = snapshot.assets.items[0];
  if (first === undefined) throw new Error("Expected a projected Asset.");
  const model = buildProjectAssetsModel({
    ...snapshot,
    authorities: { validity: "partial", items: [], issues: [] },
    gates: { validity: "partial", items: [], issues: [] },
    assets: {
      validity: "partial",
      items: [
        {
          ...first,
          adoptedByAuthorityIds: ["authority:missing"],
          gatePassageEvidenceFor: ["gate:missing"],
        },
      ],
      issues: [],
    },
  } as unknown as ProjectSnapshot);
  if (model.state !== "partial") throw new Error("Expected partial Assets.");
  const row = model.rows[0];
  if (row === undefined) throw new Error("Expected a retained Asset row.");
  const selection = assetInspection(row);

  expect(
    selection.sections?.find((section) => section.title === "Authority adoption")?.items,
  ).toEqual(["authority:missing · unavailable in the current Snapshot"]);
  expect(
    selection.sections?.find((section) => section.title === "Gate Passage evidence")?.items,
  ).toEqual(["gate:missing · unavailable in the current Snapshot"]);
});
