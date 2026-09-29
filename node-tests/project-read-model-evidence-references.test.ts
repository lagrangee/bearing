import assert from "node:assert/strict";
import { readFile, rm } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { PROJECT_READ_MODEL_PROJECTION_VERSION } from "../src/project-read-model/contract";
import { inspectProject } from "../src/project-read-model/inspect";
import { queryPortalProjectRows } from "../src/project-read-model/portal";
import {
  captureProjectProviderScopes,
  rebuildProjectReadModel,
  refreshProjectProviderDetail,
} from "../src/project-read-model/provider-operations";
import {
  inspectProjectReadModel,
  projectReadModelPath,
  readProjectProviderEvidence,
  replaceProjectProviderEvidence,
} from "../src/project-read-model/store";
import { defaultMattProviderFactory } from "../src/provider-acquisition";
import { createRepresentativeProject } from "../tests/fixtures/representative-project";
import { createValidBearingRepo } from "../tests/helpers";

test("subject evidence references hydrate one selected observation and reflect attempt-only updates", async () => {
  const root = await createValidBearingRepo();
  try {
    assert.equal((await captureProjectProviderScopes(root, [".scratch/work"])).outcome, "complete");
    const before = await inspectProjectReadModel(root);
    assert.ok(before.state === "ready");
    const bound = (await readProjectProviderEvidence(root, "bound"))[0];
    assert.ok(bound?.observation);
    const database = new DatabaseSync(projectReadModelPath(root), { readOnly: true });
    try {
      const references = database
        .prepare("SELECT payload_json FROM project_objects WHERE kind = 'portal-native-evidence'")
        .all();
      assert.ok(references.length > 2);
      for (const row of references) {
        assert.equal(typeof row["payload_json"], "string");
        const value = JSON.parse(String(row["payload_json"]));
        assert.deepEqual(Object.keys(value).sort(), [
          "bindingKey",
          "id",
          "role",
          "subjectReference",
        ]);
        assert.equal(value.bindingKey, bound.bindingKey);
        assert.equal(value.role, "bound");
      }
      assert.equal(
        database
          .prepare(
            "SELECT count(*) AS count FROM provider_evidence WHERE observation_json IS NOT NULL",
          )
          .get()?.["count"],
        1,
      );
    } finally {
      database.close();
    }

    const target = { kind: "native-scope" as const, id: ".scratch/work" };
    const read = () => queryPortalProjectRows(root, "lineage", target);
    const rows = await read();
    const hydrated = rows.objects.filter((row) => row.kind === "portal-native-evidence");
    assert.ok(hydrated.length > 2);
    for (const row of hydrated) {
      assert.deepEqual(row.value.observation, bound.observation);
      assert.strictEqual(row.value.observation, hydrated[0]?.value.observation);
      assert.strictEqual(row.value.selection, hydrated[0]?.value.selection);
    }

    const failed = {
      ...bound,
      selection: {
        ...bound.selection,
        effectiveFreshness: "stale" as const,
        latestAttempt: {
          intent: "targeted-reconciliation" as const,
          outcome: "failed" as const,
          attemptedAt: "2026-09-29T08:00:00.000Z",
          diagnostics: [],
        },
      },
    };
    await replaceProjectProviderEvidence(root, failed);
    const after = await inspectProjectReadModel(root);
    assert.ok(after.state === "ready");
    assert.deepEqual(after.metadata.receipt, before.metadata.receipt);
    for (const row of (await read()).objects.filter(
      (row) => row.kind === "portal-native-evidence",
    )) {
      assert.deepEqual(row.value.selection, failed.selection);
      assert.deepEqual(row.value.observation, bound.observation);
    }
    const native = await inspectProject(root, {
      kind: "native-reference",
      reference: ".scratch/work/issues/01-finish.md",
    });
    assert.ok(
      native.result && "binding" in native.result && native.result.binding.state === "bound",
    );
    assert.equal(native.result.binding.effectiveFreshness, "stale");
    assert.equal(native.result.binding.targetedReconciliationBasis.state, "capture-required");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("full-store validation rejects corrupt unique evidence and mismatched subject references", async () => {
  const fixture = await createRepresentativeProject("representative");
  try {
    assert.equal(
      (
        await captureProjectProviderScopes(fixture.root, [
          ".scratch/scope-001",
          ".scratch/scope-002",
        ])
      ).outcome,
      "complete",
    );
    const bound = (await readProjectProviderEvidence(fixture.root, "bound")).filter(
      (item) => item.observation !== undefined,
    );
    assert.ok(bound[0] && bound[1]);
    const database = new DatabaseSync(projectReadModelPath(fixture.root));
    try {
      const reference = database
        .prepare(
          "SELECT reference, payload_json FROM project_objects WHERE kind = 'portal-native-evidence' AND reference LIKE 'portal-native-evidence:bound:native-subject:%' ORDER BY reference LIMIT 1",
        )
        .get();
      assert.ok(reference);
      const original = JSON.parse(String(reference["payload_json"]));
      const other = bound.find((item) => item.bindingKey !== original.bindingKey);
      assert.ok(other);
      const mutations = [
        () =>
          database
            .prepare(
              "UPDATE provider_evidence SET observation_json = '{}' WHERE binding_key = ? AND role = 'bound'",
            )
            .run(other.bindingKey),
        () =>
          database
            .prepare(
              "UPDATE provider_evidence SET selection_json = '{}' WHERE binding_key = ? AND role = 'bound'",
            )
            .run(other.bindingKey),
        () =>
          database
            .prepare(
              "UPDATE provider_evidence SET observation_id = 'wrong' WHERE binding_key = ? AND role = 'bound'",
            )
            .run(other.bindingKey),
        () =>
          database
            .prepare("DELETE FROM provider_evidence WHERE binding_key = ? AND role = 'bound'")
            .run(original.bindingKey),
        ...[
          { ...original, bindingKey: "missing" },
          { ...original, bindingKey: other.bindingKey },
          { ...original, role: "detail" },
          { ...original, subjectReference: "native-subject:missing" },
          { ...original, observation: other.observation },
        ].map(
          (value) => () =>
            database
              .prepare("UPDATE project_objects SET payload_json = ? WHERE reference = ?")
              .run(JSON.stringify(value), String(reference["reference"])),
        ),
      ];
      for (const mutate of mutations) {
        database.exec("BEGIN");
        mutate();
        database.exec("COMMIT");
        assert.equal((await inspectProjectReadModel(fixture.root)).state, "recovery-required");
        // Restore from the published typed evidence and lightweight reference, not a fallback read.
        database
          .prepare("UPDATE project_objects SET payload_json = ? WHERE reference = ?")
          .run(String(reference["payload_json"]), String(reference["reference"]));
        for (const item of bound)
          database
            .prepare(
              "INSERT OR REPLACE INTO provider_evidence(binding_key, role, observation_id, source_revision, observation_json, selection_json) VALUES (?, ?, ?, ?, ?, ?)",
            )
            .run(
              item.bindingKey,
              item.role,
              item.observation?.id ?? null,
              item.observation?.sourceRevision ?? null,
              JSON.stringify(item.observation),
              JSON.stringify(item.selection),
            );
        assert.equal((await inspectProjectReadModel(fixture.root)).state, "ready");
      }
    } finally {
      database.close();
    }
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("detail-only evidence stays separate from bound coverage and Gate readiness", async () => {
  const root = await createValidBearingRepo();
  try {
    const refreshed = await refreshProjectProviderDetail(root, {
      binding: { provider: "matt-skills/v1", nativeScope: ".scratch/work" },
      subject: ".scratch/work/issues/01-finish.md",
    });
    assert.equal(refreshed.outcome, "complete");
    const evidence = await readProjectProviderEvidence(root);
    assert.equal(evidence.find((item) => item.role === "bound")?.observation, undefined);
    assert.ok(evidence.find((item) => item.role === "detail")?.observation);
    const rows = await queryPortalProjectRows(root, "lineage", {
      kind: "effort",
      id: "effort:test",
    });
    const native = rows.objects.filter((row) => row.kind === "portal-native-evidence");
    assert.ok(
      native.some((row) => row.value.role === "detail" && row.value.observation !== undefined),
    );
    assert.ok(
      native.some((row) => row.value.role === "bound" && row.value.observation === undefined),
    );
    const overview = await queryPortalProjectRows(root);
    const gate = overview.objects.find((row) => row.kind === "gate");
    assert.ok(gate?.kind === "gate");
    assert.notEqual(gate.value.readiness, "ready-for-review");
    const before = await inspectProjectReadModel(root);
    assert.ok(before.state === "ready");
    await refreshProjectProviderDetail(root, {
      binding: { provider: "matt-skills/v1", nativeScope: ".scratch/work" },
      subject: ".scratch/work/issues/01-finish.md",
    });
    const after = await inspectProjectReadModel(root);
    assert.ok(after.state === "ready");
    assert.deepEqual(after.metadata.receipt, before.metadata.receipt);
    assert.equal((await readProjectProviderEvidence(root, "bound"))[0]?.observation, undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("incompatible projection rebuild is acquisition-free and exact recovery preserves source bytes", async () => {
  const root = await createValidBearingRepo();
  try {
    const sourcePaths = [
      ".bearing/state/efforts/test.md",
      ".scratch/work/map.md",
      ".scratch/work/issues/01-finish.md",
    ];
    const before = await Promise.all(
      sourcePaths.map((path) => readFile(`${root}/${path}`, "utf8")),
    );
    assert.equal((await captureProjectProviderScopes(root, [".scratch/work"])).outcome, "complete");
    const prior = await readProjectProviderEvidence(root);
    assert.equal((await rebuildProjectReadModel(root)).result.acquisitionCount, 0);
    assert.deepEqual(await readProjectProviderEvidence(root), prior);
    for (const version of [12, 13]) {
      const database = new DatabaseSync(projectReadModelPath(root));
      database.prepare("UPDATE read_model_metadata SET projection_version = ?").run(version);
      database.close();
      assert.equal((await inspectProjectReadModel(root)).state, "recovery-required");
      await assert.rejects(queryPortalProjectRows(root), { reason: "need-rebuild" });
      const rebuilt = await rebuildProjectReadModel(root);
      assert.equal(rebuilt.outcome, "complete");
      assert.equal(rebuilt.result.acquisitionCount, 0);
      assert.deepEqual(rebuilt.result.missingEvidenceScopes, [".scratch/work"]);
      const missing = (await readProjectProviderEvidence(root, "bound"))[0];
      assert.equal(missing?.observation, undefined);
      assert.notEqual(missing?.selection.effectiveFreshness, "current");
      const acquired: string[] = [];
      const capture = await captureProjectProviderScopes(root, [".scratch/work"], {
        providerFactory: (input) => {
          const provider = defaultMattProviderFactory(input);
          return {
            ...provider,
            capture: async (binding) => {
              acquired.push(binding.nativeScope);
              return provider.capture(binding);
            },
          };
        },
      });
      assert.equal(capture.outcome, "complete");
      assert.deepEqual(acquired, [".scratch/work"]);
      assert.deepEqual(capture.result.missingEvidenceScopes, []);
      assert.deepEqual(
        await Promise.all(sourcePaths.map((path) => readFile(`${root}/${path}`, "utf8"))),
        before,
      );
    }
    const database = new DatabaseSync(projectReadModelPath(root));
    database
      .prepare("UPDATE read_model_metadata SET projection_version = ?")
      .run(PROJECT_READ_MODEL_PROJECTION_VERSION + 1);
    database.close();
    assert.equal((await inspectProjectReadModel(root)).state, "need-update");
    assert.equal((await rebuildProjectReadModel(root)).outcome, "need-update");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
