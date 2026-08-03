import { expect, test } from "bun:test";
import { buildProjectAssetsModel, filterAssetRows } from "../src/portal-ui/project-assets-model";
import type { ProjectSnapshot } from "../src/project-snapshot/contract";
import { projectSnapshotSchema } from "../src/project-snapshot/schema";
import { createSourceRecord } from "../src/project-snapshot/source-records";
import { createProjectOverviewFixture } from "./fixtures/project-overview";
import { withRebuiltPlanningLineage } from "./planning-lineage-fixture";

const twoAssetFixture = (): ProjectSnapshot => {
  const snapshot = createProjectOverviewFixture();
  if (snapshot.assets.validity !== "available") throw new Error("Expected Assets fixture.");
  const source = createSourceRecord(snapshot.basis.sitemapFingerprint, {
    kind: "asset",
    locator: ".bearing/state/assets.md",
    binding: { role: "asset", identity: "asset:uncited-context" },
    fragment: "asset:uncited-context",
  });
  return projectSnapshotSchema.parse(
    withRebuiltPlanningLineage({
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
            registeredAt: { availability: "unavailable" },
            disposition: "superseded",
            supersededBy: "asset:planning-model-evidence",
            supersededAt: { availability: "unavailable" },
            producedFor: ".scratch/portal/issues/13-assets.md",
            displayLocation: "PRODUCT.md",
            contentAvailability: "available",
            contentShape: "file",
            evidenceRoles: [],
            authorityAdoptions: [],
            passageEvidence: [],
          },
        ],
      },
      sources: [...snapshot.sources, source],
    }),
  );
};

test("keeps projected Asset order while all six Evidence filters preserve identity", () => {
  const model = buildProjectAssetsModel(twoAssetFixture());
  expect(model.state).toBe("available");
  if (model.state !== "available") throw new Error("Expected available Assets.");

  expect(model.rows.map((row) => String(row.asset.id))).toEqual([
    "asset:planning-model-evidence",
    "asset:uncited-context",
  ]);
  expect(
    filterAssetRows(model.rows, "verification-report", "all", model.evidenceFilterCoverage.all).map(
      (row) => row.asset.title,
    ),
  ).toEqual(["Planning Model Evidence"]);
  expect(
    filterAssetRows(model.rows, "Uncited Product Context", "all", model.evidenceFilterCoverage.all),
  ).toHaveLength(1);
  expect(
    filterAssetRows(model.rows, "", "uncited", model.evidenceFilterCoverage.uncited).map(
      (row) => row.asset.title,
    ),
  ).toEqual(["Uncited Product Context"]);
  expect(
    filterAssetRows(model.rows, "product", "cited", model.evidenceFilterCoverage.cited),
  ).toEqual([]);
  expect(filterAssetRows(model.rows, "", "all", model.evidenceFilterCoverage.all)).toHaveLength(2);
  expect(
    filterAssetRows(model.rows, "", "cited", model.evidenceFilterCoverage.cited).map((row) =>
      String(row.asset.id),
    ),
  ).toEqual(["asset:planning-model-evidence"]);
  expect(
    filterAssetRows(
      model.rows,
      "",
      "passage-evidence",
      model.evidenceFilterCoverage["passage-evidence"],
    ).map((row) => String(row.asset.id)),
  ).toEqual(["asset:planning-model-evidence"]);
  const cited = model.rows[0];
  const uncited = model.rows[1];
  if (cited === undefined || uncited === undefined) throw new Error("Expected two Asset rows.");
  expect(
    filterAssetRows(
      [
        {
          ...cited,
          asset: {
            ...cited.asset,
            evidenceRoles: ["execution-evidence", ...cited.asset.evidenceRoles],
          },
        },
        uncited,
      ],
      "",
      "execution-evidence",
      model.evidenceFilterCoverage["execution-evidence"],
    ).map((row) => String(row.asset.id)),
  ).toEqual(["asset:planning-model-evidence"]);
  expect(
    filterAssetRows(
      [
        cited,
        {
          ...uncited,
          authorityBaselines: [{ id: "authority:design", available: true }],
        },
      ],
      "",
      "authority-baselines",
      model.evidenceFilterCoverage["authority-baselines"],
    ).map((row) => String(row.asset.id)),
  ).toEqual(["asset:uncited-context"]);
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
  if (partial.state !== "partial") throw new Error("Expected partial Assets.");
  expect(partial.evidenceFilterCoverage.all).toBe("incomplete");
  expect(partial.evidenceFilterCoverage["execution-evidence"]).toBe("incomplete");
  expect(
    filterAssetRows(
      partial.rows,
      "",
      "execution-evidence",
      partial.evidenceFilterCoverage["execution-evidence"],
    ),
  ).toEqual([]);

  expect(
    buildProjectAssetsModel({
      ...snapshot,
      assets: { validity: "invalid", issues: [issue] },
    } as ProjectSnapshot),
  ).toEqual({ state: "invalid", issueCount: 1, rows: [] });
});

test("keeps Authority baseline filter coverage explicit under degraded projections", () => {
  const snapshot = twoAssetFixture();
  const issue = {
    code: "invalid-authority",
    target: "authority:unavailable",
    message: "One Authority is unavailable.",
  };
  const partial = buildProjectAssetsModel({
    ...snapshot,
    authorities:
      snapshot.authorities.validity === "invalid"
        ? snapshot.authorities
        : {
            validity: "partial",
            items: snapshot.authorities.items,
            issues: [issue],
          },
  } as ProjectSnapshot);
  expect(partial.state).toBe("available");
  if (partial.state !== "available") throw new Error("Expected readable Assets.");
  expect(partial.evidenceFilterCoverage["authority-baselines"]).toBe("incomplete");

  const unavailable = buildProjectAssetsModel({
    ...snapshot,
    authorities: { validity: "invalid", issues: [issue] },
  } as ProjectSnapshot);
  expect(unavailable.state).toBe("available");
  if (unavailable.state !== "available") throw new Error("Expected readable Assets.");
  expect(unavailable.evidenceFilterCoverage["authority-baselines"]).toBe("incomplete");
  expect(
    filterAssetRows(
      unavailable.rows,
      "",
      "authority-baselines",
      unavailable.evidenceFilterCoverage["authority-baselines"],
    ),
  ).toEqual([]);
});

test("keeps Citation and Passage filters honest under degraded source coverage", () => {
  const snapshot = twoAssetFixture();
  const issue = {
    code: "unavailable-evidence-owner",
    target: "planning:evidence-owner",
    message: "One evidence-owning projection is unavailable.",
  };
  const partialCitations = buildProjectAssetsModel({
    ...snapshot,
    efforts:
      snapshot.efforts.validity === "invalid"
        ? snapshot.efforts
        : {
            validity: "partial",
            items: snapshot.efforts.items,
            issues: [issue],
          },
  } as ProjectSnapshot);
  if (partialCitations.state !== "available") throw new Error("Expected readable Assets.");
  expect(partialCitations.evidenceFilterCoverage.cited).toBe("incomplete");
  expect(partialCitations.evidenceFilterCoverage.uncited).toBe("incomplete");
  expect(partialCitations.evidenceFilterCoverage["passage-evidence"]).toBe("complete");
  expect(
    filterAssetRows(
      partialCitations.rows,
      "",
      "cited",
      partialCitations.evidenceFilterCoverage.cited,
    ).map((row) => String(row.asset.id)),
  ).toEqual(["asset:planning-model-evidence"]);
  expect(
    filterAssetRows(
      partialCitations.rows,
      "",
      "uncited",
      partialCitations.evidenceFilterCoverage.uncited,
    ),
  ).toEqual([]);

  const unavailablePassage = buildProjectAssetsModel({
    ...snapshot,
    gates: { validity: "invalid", issues: [issue] },
  } as ProjectSnapshot);
  if (unavailablePassage.state !== "available") throw new Error("Expected readable Assets.");
  expect(unavailablePassage.evidenceFilterCoverage["passage-evidence"]).toBe("incomplete");
  expect(
    filterAssetRows(
      unavailablePassage.rows,
      "",
      "passage-evidence",
      unavailablePassage.evidenceFilterCoverage["passage-evidence"],
    ).map((row) => String(row.asset.id)),
  ).toEqual(["asset:planning-model-evidence"]);
});
