import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import {
  assertProjectReadModelObjectIdentity,
  assertProjectReadModelObjectRelationships,
  projectReadModelObjectSchema,
} from "../src/project-read-model/contract";
import { compileProjectReadModel } from "../src/project-read-model/store";
import { createProjectOverviewFixture } from "./fixtures/project-overview";

test("Portal public read transport has no whole-Snapshot route or browser schema", async () => {
  const [routes, browserContract, wire, pageData, assetPreview] = await Promise.all([
    readFile("src/portal/project-routes.ts", "utf8"),
    readFile("src/portal-ui/project-contract.ts", "utf8"),
    readFile("src/portal-project-read-wire.ts", "utf8"),
    readFile("src/portal-ui/project-data.ts", "utf8"),
    readFile("src/portal/asset-preview.ts", "utf8"),
  ]);

  expect(routes).not.toContain("/api/v1/projects/:entryId/snapshot");
  expect(routes).toContain("/api/v1/projects/:entryId/read-model");
  expect(browserContract).not.toContain("readProjectSnapshot");
  expect(browserContract).toContain("targetKind");
  expect(browserContract).toContain("targetId");
  expect(wire).not.toContain("projectSnapshotSchema");
  expect(wire).not.toContain("projectReadModelReceiptSchema");
  expect(wire).not.toContain("providerEvidence");
  expect(pageData).not.toContain("ProjectSnapshot");
  expect(pageData).toContain('section: "overview"');
  expect(pageData).toContain('section: "lineage"');
  expect(assetPreview).not.toContain("readProjectSnapshotCache");
  expect(assetPreview).not.toContain("readProjectSitemapCache");
  expect(assetPreview).toContain("queryPortalAssetRow");
});

test("composite Portal rows bind their nested identity to the row key", () => {
  const snapshot = createProjectOverviewFixture();
  const candidate = compileProjectReadModel({
    snapshot,
    basisFingerprint: snapshot.basis.sitemapFingerprint,
    basisInputs: [],
    basisObservations: [],
    assetContentObservations: [],
  });
  const kinds = [
    "portal-native-evidence",
    "portal-reference-title",
    "portal-find-document",
    "portal-projection-state",
  ] as const;

  for (const kind of kinds) {
    const row = candidate.objects.find((item) => item.kind === kind);
    if (row === undefined) throw new Error(`Fixture has no ${kind} row.`);
    const object = projectReadModelObjectSchema.parse({
      kind: row.kind,
      value: JSON.parse(row.payload),
    });
    expect(() => assertProjectReadModelObjectIdentity(row.reference, object)).not.toThrow();
    if (object.kind === "portal-native-evidence") {
      const tampered = projectReadModelObjectSchema.parse({
        ...object,
        value: { ...object.value, subjectReference: `${object.value.subjectReference}:tampered` },
      });
      expect(() => assertProjectReadModelObjectIdentity(row.reference, tampered)).toThrow(
        "Project Read Model object identity is inconsistent.",
      );
    } else if (object.kind === "portal-reference-title") {
      const tampered = projectReadModelObjectSchema.parse({
        ...object,
        value: { ...object.value, reference: `${object.value.reference}:tampered` },
      });
      expect(() => assertProjectReadModelObjectIdentity(row.reference, tampered)).toThrow(
        "Project Read Model object identity is inconsistent.",
      );
    } else if (object.kind === "portal-find-document") {
      const tampered = projectReadModelObjectSchema.parse({
        ...object,
        value: {
          ...object.value,
          document: { ...object.value.document, id: `${object.value.document.id}:tampered` },
        },
      });
      expect(() => assertProjectReadModelObjectIdentity(row.reference, tampered)).toThrow(
        "Project Read Model object identity is inconsistent.",
      );
    } else if (object.kind === "portal-projection-state") {
      const tampered = projectReadModelObjectSchema.parse({
        ...object,
        value: {
          ...object.value,
          projection: object.value.projection === "summary" ? "brief" : "summary",
        },
      });
      expect(() => assertProjectReadModelObjectIdentity(row.reference, tampered)).toThrow(
        "Project Read Model object identity is inconsistent.",
      );
    }
  }

  const objects = candidate.objects.map((row) =>
    projectReadModelObjectSchema.parse({ kind: row.kind, value: JSON.parse(row.payload) }),
  );
  expect(() => assertProjectReadModelObjectRelationships(objects)).not.toThrow();
  expect(() =>
    assertProjectReadModelObjectRelationships(
      objects.filter((object) => object.kind !== "project-summary"),
    ),
  ).toThrow("Project Read Model singleton projection cardinality is inconsistent.");
  expect(() =>
    assertProjectReadModelObjectRelationships(
      objects.filter(
        (object) =>
          object.kind !== "portal-projection-state" || object.value.projection !== "summary",
      ),
    ),
  ).toThrow("Project Read Model projection state is missing.");
  const evidence = objects.filter((object) => object.kind === "portal-native-evidence");
  const scopedEvidence = evidence.find(
    (object) =>
      object.value.subjectReference.startsWith("native-scope:") &&
      object.value.observation !== undefined,
  );
  const crossScopeEvidence = evidence.find(
    (object) =>
      object.value.observation !== undefined &&
      object.value.selection.nativeScope !== scopedEvidence?.value.selection.nativeScope,
  );
  if (scopedEvidence === undefined || crossScopeEvidence?.value.observation === undefined) {
    throw new Error("Fixture has no cross-scope native evidence pair.");
  }
  const crossScopeSubstitution = projectReadModelObjectSchema.parse({
    ...scopedEvidence,
    value: {
      ...scopedEvidence.value,
      selection: crossScopeEvidence.value.selection,
      observation: crossScopeEvidence.value.observation,
    },
  });
  expect(() =>
    assertProjectReadModelObjectIdentity(scopedEvidence.value.id, crossScopeSubstitution),
  ).toThrow("Project Read Model native evidence subject is inconsistent.");

  const effortEvidence = evidence.find(
    (object) =>
      object.value.subjectReference.startsWith("effort:") &&
      object.value.selection.nativeScope !== crossScopeEvidence.value.selection.nativeScope,
  );
  if (effortEvidence === undefined) throw new Error("Fixture has no Effort evidence row.");
  const effortSubstitution = projectReadModelObjectSchema.parse({
    ...effortEvidence,
    value: {
      ...effortEvidence.value,
      selection: crossScopeEvidence.value.selection,
      observation: crossScopeEvidence.value.observation,
    },
  });
  expect(() =>
    assertProjectReadModelObjectRelationships(
      objects.map((object) => (object === effortEvidence ? effortSubstitution : object)),
    ),
  ).toThrow("Project Read Model native evidence subject is inconsistent.");
});
