import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { providerObservationIdentityFor } from "../src/native-work-provider";
import { planningLineageSubjectSchema } from "../src/planning-lineage-route";
import { buildProjectOverviewModel } from "../src/portal-ui/project-overview-model";
import { portalRowsToProjectData } from "../src/portal-ui/project-row-adapter";
import { PROJECT_READ_MODEL_PROJECTION_VERSION } from "../src/project-read-model/contract";
import { materializeProjectReadModelCandidate } from "../src/project-read-model/inspect";
import {
  PortalProjectReadModelUnavailableError,
  queryPortalAssetRow,
  queryPortalProjectRows,
  queryPortalProjectRowsWithGeneration,
  searchPortalProjectRows,
} from "../src/project-read-model/portal";
import {
  compileProjectReadModel,
  inspectProjectReadModel,
  projectReadModelPath,
  publishProjectReadModel,
} from "../src/project-read-model/store";
import { createProjectOverviewFixture } from "../tests/fixtures/project-overview";
import { createRepresentativeProject } from "../tests/fixtures/representative-project";

test("Portal reads bounded typed rows from one committed Project Read Model generation", async () => {
  const fixture = await createRepresentativeProject("representative");
  try {
    const materialized = await materializeProjectReadModelCandidate(fixture.root);
    const overviewSnapshot = createProjectOverviewFixture();
    const overviewCandidate = compileProjectReadModel({
      snapshot: overviewSnapshot,
      basisFingerprint: overviewSnapshot.basis.basisFingerprint,
      basisInputs: [],
      basisObservations: [],
      assetContentObservations: [],
    });
    const assetProjection = overviewSnapshot.assets;
    if (assetProjection.validity === "invalid" || assetProjection.items[0] === undefined) {
      throw new Error("Project overview fixture has no Asset row.");
    }
    const asset = assetProjection.items[0];
    const candidate = {
      ...materialized,
      objects: [
        ...materialized.objects,
        { reference: asset.id, kind: "asset", ordinal: 0, payload: JSON.stringify(asset) },
      ],
      providerEvidence: overviewCandidate.providerEvidence,
    };
    await publishProjectReadModel(fixture.root, candidate, {
      now: () => "2026-08-08T08:00:00.000Z",
    });

    const findDocument = candidate.objects.find((row) => row.kind === "portal-find-document");
    if (findDocument === undefined) throw new Error("Fixture has no Find document row.");
    const findDocumentValue = JSON.parse(findDocument.payload) as {
      id: string;
      document: { id: string };
    };
    await assert.rejects(
      publishProjectReadModel(
        fixture.root,
        {
          ...candidate,
          basisFingerprint: `sha256:${"f".repeat(64)}`,
          objects: candidate.objects.map((row) =>
            row === findDocument
              ? {
                  ...row,
                  payload: JSON.stringify({
                    ...findDocumentValue,
                    document: {
                      ...findDocumentValue.document,
                      id: `${findDocumentValue.document.id}:tampered`,
                    },
                  }),
                }
              : row,
          ),
        },
        { now: () => "2026-08-08T08:01:00.000Z" },
      ),
      /object identity is inconsistent/u,
    );

    const rows = await queryPortalProjectRows(fixture.root);
    const snapshot = await queryPortalProjectRowsWithGeneration(fixture.root);

    assert.equal("generation" in rows, false);
    assert.deepEqual(snapshot.rows, rows);
    assert.equal(snapshot.generation.basisFingerprint, candidate.basisFingerprint);
    assert.equal(snapshot.generation.publicationCount, 1);
    assert.equal(rows.section, "overview");
    assert.ok(rows.objects.length > 0);
    assert.ok(rows.objects.length <= 500);
    assert.ok(rows.lineage.length <= 500);
    assert.ok(rows.sources.length <= 500);
    assert.ok(rows.diagnostics.length <= 500);
    assert.equal("snapshot" in rows, false);
    const missingSummaryRows = {
      ...rows,
      objects: rows.objects.filter((object) => object.kind !== "project-summary"),
    };
    assert.throws(
      () => portalRowsToProjectData(missingSummaryRows),
      /singleton state is inconsistent/u,
    );
    const summaryRow = candidate.objects.find((row) => row.kind === "project-summary");
    if (summaryRow === undefined) throw new Error("Fixture has no Summary row.");
    const missingSummary = new DatabaseSync(projectReadModelPath(fixture.root));
    try {
      missingSummary
        .prepare("DELETE FROM project_objects WHERE reference = ?")
        .run(summaryRow.reference);
    } finally {
      missingSummary.close();
    }
    await assert.rejects(
      queryPortalProjectRows(fixture.root),
      /singleton projection cardinality is inconsistent/u,
    );
    const restoredSummary = new DatabaseSync(projectReadModelPath(fixture.root));
    try {
      restoredSummary
        .prepare(
          "INSERT INTO project_objects(reference, kind, ordinal, payload_json) VALUES (?, ?, ?, ?)",
        )
        .run(summaryRow.reference, summaryRow.kind, summaryRow.ordinal, summaryRow.payload);
    } finally {
      restoredSummary.close();
    }

    const assetRow = await queryPortalAssetRow(fixture.root, asset.id);
    assert.equal(assetRow.state, "available");
    if (assetRow.state === "available") assert.equal(assetRow.asset.id, asset.id);
    assert.deepEqual(await queryPortalAssetRow(fixture.root, "asset:missing"), {
      state: "missing",
    });

    const database = new DatabaseSync(projectReadModelPath(fixture.root));
    const roadmapRow = candidate.objects.find((row) => row.kind === "roadmap");
    if (roadmapRow === undefined) throw new Error("Fixture has no Roadmap row.");
    try {
      database
        .prepare("UPDATE project_objects SET payload_json = ? WHERE reference = ?")
        .run(
          JSON.stringify({ ...JSON.parse(roadmapRow.payload), id: "roadmap:tampered" }),
          roadmapRow.reference,
        );
    } finally {
      database.close();
    }
    await assert.rejects(queryPortalProjectRows(fixture.root), /object identity is inconsistent/u);

    const repaired = new DatabaseSync(projectReadModelPath(fixture.root));
    try {
      repaired
        .prepare("UPDATE project_objects SET payload_json = ? WHERE reference = ?")
        .run(roadmapRow.payload, roadmapRow.reference);
      repaired
        .prepare("UPDATE project_objects SET payload_json = ? WHERE reference = ?")
        .run(JSON.stringify({ ...asset, id: "asset:tampered" }), asset.id);
    } finally {
      repaired.close();
    }
    await assert.rejects(
      queryPortalAssetRow(fixture.root, asset.id),
      /object identity is inconsistent/u,
    );

    const coverage = new DatabaseSync(projectReadModelPath(fixture.root));
    const assetsState = candidate.objects.find(
      (row) => row.reference === "portal-projection:assets",
    );
    if (assetsState === undefined) throw new Error("Fixture has no Assets state row.");
    try {
      coverage
        .prepare("UPDATE project_objects SET payload_json = ? WHERE reference = ?")
        .run(JSON.stringify(asset), asset.id);
      coverage.prepare("UPDATE project_objects SET payload_json = ? WHERE reference = ?").run(
        JSON.stringify({
          id: "portal-projection:assets",
          projection: "assets",
          validity: "partial",
          issues: [],
        }),
        "portal-projection:assets",
      );
    } finally {
      coverage.close();
    }
    const partialAsset = await queryPortalAssetRow(fixture.root, asset.id);
    assert.equal(partialAsset.state, "available");
    assert.deepEqual(await queryPortalAssetRow(fixture.root, "asset:missing"), {
      state: "unavailable",
    });

    const projection = new DatabaseSync(projectReadModelPath(fixture.root));
    try {
      projection
        .prepare("UPDATE project_objects SET payload_json = ? WHERE reference = ?")
        .run(assetsState.payload, assetsState.reference);
      for (const obsoleteVersion of [1, 2]) {
        projection
          .prepare("UPDATE read_model_metadata SET projection_version = ? WHERE singleton = 1")
          .run(obsoleteVersion);
        await assert.rejects(queryPortalProjectRows(fixture.root), {
          name: "PortalProjectReadModelUnavailableError",
        });
        await assert.rejects(queryPortalAssetRow(fixture.root, asset.id), {
          name: "PortalProjectReadModelUnavailableError",
        });
        await assert.rejects(
          searchPortalProjectRows(fixture.root, "fixture-project", "audit", 20),
          { name: "PortalProjectReadModelUnavailableError" },
        );
        await assert.rejects(searchPortalProjectRows(fixture.root, "fixture-project", "   ", 20), {
          name: "PortalProjectReadModelUnavailableError",
        });
      }
      projection
        .prepare("UPDATE read_model_metadata SET projection_version = ? WHERE singleton = 1")
        .run(PROJECT_READ_MODEL_PROJECTION_VERSION + 1);
      await assert.rejects(queryPortalProjectRows(fixture.root), (error) => {
        assert.ok(error instanceof PortalProjectReadModelUnavailableError);
        assert.equal(error.reason, "need-update");
        return true;
      });
      projection
        .prepare("UPDATE read_model_metadata SET projection_version = ? WHERE singleton = 1")
        .run(PROJECT_READ_MODEL_PROJECTION_VERSION);
    } finally {
      projection.close();
    }

    const find = await searchPortalProjectRows(
      fixture.root,
      "fixture-project",
      "planning-audit:current",
      20,
    );
    assert.ok(find.results.length > 0);
    assert.ok(find.results.length <= 20);
    assert.ok(find.results.some((match) => match.subject.kind === "audit"));
    assert.deepEqual(find.scopeState, {
      state: "unavailable",
      cause: "No current Audit is available.",
      impact: "Other managed content remains searchable; Audit findings cannot be searched yet.",
      nextStep: "Close Find and open Audit for the Agent Surface resume instructions.",
    });

    const selectedEvidence = candidate.providerEvidence.find(
      (row) => row.role === "bound" && row.observation !== undefined,
    );
    if (
      selectedEvidence === undefined ||
      selectedEvidence.observation === undefined ||
      selectedEvidence.observationId === undefined
    ) {
      throw new Error("Fixture has no selected provider evidence.");
    }
    const retainedDetailEvidence = { ...selectedEvidence, role: "detail" as const };
    const retainedEvidence = new DatabaseSync(projectReadModelPath(fixture.root));
    try {
      retainedEvidence
        .prepare(
          "INSERT INTO provider_evidence(binding_key, role, observation_id, source_revision, observation_json, selection_json) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .run(
          retainedDetailEvidence.bindingKey,
          retainedDetailEvidence.role,
          retainedDetailEvidence.observationId ?? null,
          retainedDetailEvidence.sourceRevision ?? null,
          retainedDetailEvidence.observation ?? null,
          retainedDetailEvidence.selection,
        );
    } finally {
      retainedEvidence.close();
    }
    const selectedSelection = JSON.parse(selectedEvidence.selection) as {
      observationId: string | null;
    };
    const selectedObservation = JSON.parse(selectedEvidence.observation) as Record<
      string,
      unknown
    > & {
      id: string;
      binding: Readonly<{ provider: "matt-skills/v1"; nativeScope: string }>;
    };
    const { id: _selectedObservationId, ...selectedObservationContent } = selectedObservation;
    const crossScopeObservationContent = {
      ...selectedObservationContent,
      binding: {
        ...selectedObservation.binding,
        nativeScope: ".scratch/cross-scope",
      },
    };
    const crossScopeObservation = {
      id: providerObservationIdentityFor(crossScopeObservationContent),
      ...crossScopeObservationContent,
    };
    const providerEvidence = new DatabaseSync(projectReadModelPath(fixture.root));
    try {
      providerEvidence
        .prepare(
          "UPDATE provider_evidence SET observation_id = ?, source_revision = ?, observation_json = ?, selection_json = ? WHERE binding_key = ? AND role = ?",
        )
        .run(
          crossScopeObservation.id,
          selectedEvidence.sourceRevision ?? null,
          JSON.stringify(crossScopeObservation),
          JSON.stringify({
            ...selectedSelection,
            observationId: crossScopeObservation.id,
          }),
          retainedDetailEvidence.bindingKey,
          retainedDetailEvidence.role,
        );
    } finally {
      providerEvidence.close();
    }
    assert.equal((await inspectProjectReadModel(fixture.root)).state, "recovery-required");
    const receiptBeforeRejectedPublish = new DatabaseSync(projectReadModelPath(fixture.root));
    const previousReceipt = receiptBeforeRejectedPublish
      .prepare("SELECT receipt_json FROM read_model_metadata WHERE singleton = 1")
      .get()?.["receipt_json"];
    receiptBeforeRejectedPublish.close();
    await assert.rejects(
      publishProjectReadModel(
        fixture.root,
        { ...candidate, basisFingerprint: `sha256:${"d".repeat(64)}` },
        { now: () => "2026-08-08T08:02:00.000Z" },
      ),
      /provider observation identity is inconsistent/u,
    );
    const receiptAfterRejectedPublish = new DatabaseSync(projectReadModelPath(fixture.root));
    try {
      assert.equal(
        receiptAfterRejectedPublish
          .prepare("SELECT receipt_json FROM read_model_metadata WHERE singleton = 1")
          .get()?.["receipt_json"],
        previousReceipt,
      );
    } finally {
      receiptAfterRejectedPublish.close();
    }
    const restoredEvidence = new DatabaseSync(projectReadModelPath(fixture.root));
    try {
      restoredEvidence
        .prepare(
          "UPDATE provider_evidence SET observation_id = ?, source_revision = ?, observation_json = ?, selection_json = ? WHERE binding_key = ? AND role = ?",
        )
        .run(
          selectedEvidence.observationId ?? null,
          selectedEvidence.sourceRevision ?? null,
          selectedEvidence.observation,
          selectedEvidence.selection,
          retainedDetailEvidence.bindingKey,
          retainedDetailEvidence.role,
        );
    } finally {
      restoredEvidence.close();
    }

    const diagnosticOnlySourceReference = `source:${"f".repeat(64)}`;
    const diagnosticOnlyReference = `diagnostic:${"e".repeat(64)}`;
    const diagnosticOnlySource = {
      reference: diagnosticOnlySourceReference,
      kind: "tracker",
      displayLocator: ".scratch/diagnostic-only/issues/01.md",
      binding: {
        role: "delivery-ticket",
        identity: ".scratch/diagnostic-only/issues/01.md",
      },
    };
    const diagnosticOnly = {
      reference: diagnosticOnlyReference,
      code: "diagnostic-only-source",
      impact: "blocking",
      target: "project-summary:current",
      message: "Diagnostic-only source remains navigable.",
      source: diagnosticOnlySourceReference,
    };
    const diagnosticRows = new DatabaseSync(projectReadModelPath(fixture.root));
    try {
      diagnosticRows
        .prepare("INSERT INTO project_sources(reference, kind, payload_json) VALUES (?, ?, ?)")
        .run(
          diagnosticOnlySource.reference,
          diagnosticOnlySource.kind,
          JSON.stringify(diagnosticOnlySource),
        );
      diagnosticRows
        .prepare(
          "INSERT INTO project_diagnostics(reference, impact, target, payload_json) VALUES (?, ?, ?, ?)",
        )
        .run(
          diagnosticOnly.reference,
          diagnosticOnly.impact,
          diagnosticOnly.target,
          JSON.stringify(diagnosticOnly),
        );
      diagnosticRows
        .prepare("INSERT INTO project_attention(reference, payload_json) VALUES (?, ?)")
        .run(
          diagnosticOnly.reference,
          JSON.stringify({
            kind: "structural-diagnostic",
            diagnosticReference: diagnosticOnly.reference,
          }),
        );
    } finally {
      diagnosticRows.close();
    }
    const diagnosticOverviewRows = await queryPortalProjectRows(fixture.root, "overview");
    assert.ok(
      diagnosticOverviewRows.sources.some(
        (source) => source.reference === diagnosticOnlySource.reference,
      ),
    );
    const diagnosticOverviewData = portalRowsToProjectData(diagnosticOverviewRows);
    assert.equal(diagnosticOverviewData.section, "overview");
    if (diagnosticOverviewData.section !== "overview") {
      throw new Error("Expected Overview Project data.");
    }
    const diagnosticAttention = buildProjectOverviewModel(diagnosticOverviewData).attention.find(
      (item) => item.key === diagnosticOnly.reference,
    );
    assert.deepEqual(diagnosticAttention?.nativeSubject, {
      kind: "native-subject",
      id: diagnosticOnlySource.binding.identity,
    });

    const overflow = new DatabaseSync(projectReadModelPath(fixture.root));
    try {
      const insertContext = overflow.prepare(
        "INSERT INTO subject_contexts(reference, payload_json) VALUES (?, '{}')",
      );
      const insertAsset = overflow.prepare(
        "INSERT INTO project_objects(reference, kind, ordinal, payload_json) VALUES (?, 'asset', ?, '{}')",
      );
      const insertSource = overflow.prepare(
        "INSERT INTO project_sources(reference, kind, payload_json) VALUES (?, 'unrelated', '{}')",
      );
      const insertDiagnostic = overflow.prepare(
        "INSERT INTO project_diagnostics(reference, target, impact, payload_json) VALUES (?, ?, 'scoped', '{}')",
      );
      const insertAttention = overflow.prepare(
        "INSERT INTO project_attention(reference, payload_json) VALUES (?, '{}')",
      );
      const insertEvidence = overflow.prepare(
        "INSERT INTO provider_evidence(binding_key, role, selection_json) VALUES (?, 'bound', '{}')",
      );
      for (let index = 0; index <= 500; index += 1) {
        insertContext.run(`unrelated:${index}`);
        insertAsset.run(`unrelated-asset:${index}`, index + 1);
        insertSource.run(`source:${String(index).padStart(64, "0")}`);
        insertDiagnostic.run(`unrelated-diagnostic:${index}`, `unrelated:${index}`);
        insertAttention.run(`unrelated-attention:${index}`);
        insertEvidence.run(`matt-skills/v1\0unrelated:${index}`);
      }
    } finally {
      overflow.close();
    }
    const roadmapRows = await queryPortalProjectRows(fixture.root, "roadmaps");
    assert.equal(roadmapRows.attention.length, 0);
    assert.ok(roadmapRows.sources.length <= candidate.sources.length);
    assert.deepEqual(roadmapRows.diagnostics, []);
    const auditRows = await queryPortalProjectRows(fixture.root, "audit");
    assert.equal(
      auditRows.objects.some((object) => object.kind === "asset"),
      false,
    );
    assert.equal(auditRows.attention.length, 0);
    assert.ok(auditRows.attentionCount > 500);
    assert.deepEqual(auditRows.sources, []);
    assert.deepEqual(auditRows.diagnostics, []);
    const missingNativeScope = await queryPortalProjectRows(fixture.root, "lineage", {
      kind: "native-scope",
      id: "missing-scope",
    });
    assert.equal(missingNativeScope.nativeTargetState, "unavailable");

    const objectOverflow = new DatabaseSync(projectReadModelPath(fixture.root));
    try {
      const insert = objectOverflow.prepare(
        "INSERT INTO project_objects(reference, kind, ordinal, payload_json) VALUES (?, 'roadmap', ?, '{}')",
      );
      for (let index = 0; index <= 500; index += 1) {
        insert.run(`overflow:${index}`, index);
      }
    } finally {
      objectOverflow.close();
    }
    const target = planningLineageSubjectSchema.parse(
      JSON.parse(candidate.subjectContexts[0]?.payload ?? "null").identity,
    );
    const dossier = await queryPortalProjectRows(fixture.root, "lineage", target);
    assert.equal(dossier.target?.kind, target.kind);
    assert.equal(dossier.target?.id, target.id);
    assert.ok(
      dossier.lineage.some(
        (subject) => subject.identity.kind === target.kind && subject.identity.id === target.id,
      ),
    );
    assert.equal(
      dossier.lineage.some((subject) => subject.identity.id.startsWith("unrelated:")),
      false,
    );
    assert.equal(
      dossier.objects.some(
        (object) => "id" in object.value && String(object.value.id).startsWith("overflow:"),
      ),
      false,
    );
    await assert.rejects(
      queryPortalProjectRows(fixture.root),
      /too many object rows/u,
      "Portal reads must fail instead of silently truncating a Project Read Model generation",
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});
