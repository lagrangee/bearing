import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { providerObservationIdentityFor } from "../src/native-work-provider";
import { createRepresentativeProject } from "./fixtures/representative-project";
import { installPackedProduct } from "./product-seams/installed-product";

type EvidenceRow = {
  binding_key: string;
  observation_id: string;
  observation_json: string;
  selection_json: string;
};

const activityArgs = (date: string): string[] => [
  "inspect",
  "activity",
  "--repo",
  ".",
  "--date",
  date,
  "--time-zone",
  "UTC",
];

const firstEvidence = (database: Database): EvidenceRow => {
  const row = database
    .query(
      "SELECT binding_key, observation_id, observation_json, selection_json FROM provider_evidence WHERE role = 'bound' ORDER BY binding_key LIMIT 1",
    )
    .get() as EvidenceRow | undefined;
  if (row === undefined) throw new Error("Expected one provider evidence row.");
  return row;
};

const writeEvidence = (
  database: Database,
  row: EvidenceRow,
  observation: unknown,
  selection: unknown,
): void => {
  const parsed = observation as { id: string };
  database
    .query(
      "UPDATE provider_evidence SET observation_id = ?, observation_json = ?, selection_json = ? WHERE binding_key = ? AND role = 'bound'",
    )
    .run(parsed.id, JSON.stringify(observation), JSON.stringify(selection), row.binding_key);
};

const restoreEvidence = (database: Database, row: EvidenceRow): void => {
  database
    .query(
      "UPDATE provider_evidence SET observation_id = ?, observation_json = ?, selection_json = ? WHERE binding_key = ? AND role = 'bound'",
    )
    .run(row.observation_id, row.observation_json, row.selection_json, row.binding_key);
};

const previousUtcDate = (date: string): string =>
  new Date(new Date(`${date}T00:00:00Z`).getTime() - 86_400_000).toISOString().slice(0, 10);

test("packed activity inspection preserves useful facts through degraded evidence", async () => {
  const product = await installPackedProduct();
  const fixture = await createRepresentativeProject("representative", product.root);
  const recoveryFixture = await createRepresentativeProject("representative", product.root);
  try {
    const rebuilt = await product.run(["cache", "rebuild", "--repo", "."], {
      cwd: fixture.root,
      observeRoots: [fixture.root],
    });
    expect(rebuilt.exitClass).toBe("success");
    const capture = await product.run(
      [
        "provider",
        "capture",
        ...Array.from({ length: 9 }, (_, index) => [
          "--scope",
          `.scratch/scope-${String(index + 1).padStart(3, "0")}`,
        ]).flat(),
        "--repo",
        ".",
      ],
      { cwd: fixture.root, observeRoots: [fixture.root] },
    );
    expect(capture.exitClass).toBe("success");
    const nativeDate = (await stat(join(fixture.root, fixture.nativeLocator))).birthtime
      .toISOString()
      .slice(0, 10);

    const unfinished = await product.run(activityArgs(nativeDate), {
      cwd: fixture.root,
      observeRoots: [fixture.root],
    });
    expect(unfinished).toMatchObject({
      exitClass: "success",
      exitCode: 0,
      effects: { created: [], changed: [], removed: [] },
    });
    expect(JSON.parse(unfinished.stdout)).toMatchObject({
      outcome: "partial",
      result: { historicalCompleteness: "not-established" },
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ code: "activity-day-unfinished" }),
      ]),
    });

    const completeEmpty = await product.run(activityArgs(previousUtcDate(nativeDate)), {
      cwd: fixture.root,
      observeRoots: [fixture.root],
    });
    expect(completeEmpty.exitClass).toBe("success");
    expect(JSON.parse(completeEmpty.stdout)).toMatchObject({
      outcome: "complete",
      result: {
        historicalCompleteness: "not-established",
        detailBudget: { expandedItemCount: 0, omittedItemCount: 0 },
      },
      diagnostics: [],
    });

    const database = new Database(join(fixture.root, ".bearing/cache/project-read-model.sqlite"));
    const original = firstEvidence(database);
    const observation = JSON.parse(original.observation_json);
    const selection = JSON.parse(original.selection_json);

    writeEvidence(database, original, observation, { ...selection, effectiveFreshness: "stale" });
    const stale = await product.run(activityArgs(nativeDate), {
      cwd: fixture.root,
      observeRoots: [fixture.root],
    });
    expect(stale.exitClass).toBe("success");
    const staleEnvelope = JSON.parse(stale.stdout);
    expect(staleEnvelope).toMatchObject({
      outcome: "partial",
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ code: "activity-provider-evidence-stale" }),
      ]),
    });
    expect(staleEnvelope.result.efforts[0]).toMatchObject({
      evidence: { freshness: "stale", observedAt: observation.observedAt },
      currentFrontier: { state: "withheld", reason: "stale-evidence" },
      activity: { totals: { nativeCreated: 10, trackerClosed: 10 } },
    });
    const staleEmpty = await product.run(activityArgs(previousUtcDate(nativeDate)), {
      cwd: fixture.root,
      observeRoots: [fixture.root],
    });
    expect(JSON.parse(staleEmpty.stdout)).toMatchObject({
      outcome: "partial",
      result: { detailBudget: { expandedItemCount: 0, omittedItemCount: 0 } },
    });

    const { id: _partialId, ...partialContent } = observation;
    const partialWithoutId = {
      ...partialContent,
      state: "partial",
      coverage: {
        assessment: "incomplete",
        dimensions: [{ key: "scope", state: "gap", detail: "Fixture coverage gap." }],
      },
      completion: "incomplete",
    };
    const partialId = providerObservationIdentityFor(partialWithoutId);
    writeEvidence(
      database,
      original,
      { id: partialId, ...partialWithoutId },
      { ...selection, observationId: partialId },
    );
    const partial = await product.run(activityArgs(nativeDate), {
      cwd: fixture.root,
      observeRoots: [fixture.root],
    });
    const partialEnvelope = JSON.parse(partial.stdout);
    expect(partialEnvelope).toMatchObject({
      outcome: "partial",
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ code: "activity-provider-evidence-incomplete" }),
      ]),
    });
    expect(partialEnvelope.result.efforts[0]).toMatchObject({
      evidence: { projectionState: "partial", coverage: "incomplete" },
      currentFrontier: {
        state: "available",
        counts: { resolved: { mode: "at-least", value: 10 } },
      },
      activity: { totals: { nativeCreated: 10, trackerClosed: 10 } },
    });

    writeEvidence(database, original, observation, {
      ...selection,
      latestAttempt: {
        intent: "exact-scope-capture",
        attemptedAt: observation.observedAt,
        outcome: "failed",
        diagnostics: [
          {
            code: "fixture-capture-failed",
            impact: "blocking",
            target: "fixture-scope",
            message: "The latest fixture capture failed.",
          },
        ],
      },
    });
    const failedAttempt = await product.run(activityArgs(nativeDate), {
      cwd: fixture.root,
      observeRoots: [fixture.root],
    });
    const failedEnvelope = JSON.parse(failedAttempt.stdout);
    expect(failedEnvelope).toMatchObject({
      outcome: "partial",
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ code: "activity-provider-latest-attempt-failed" }),
      ]),
    });
    expect(failedEnvelope.result.efforts[0]).toMatchObject({
      evidence: { latestAttempt: { outcome: "failed" } },
      currentFrontier: { state: "withheld", reason: "latest-attempt-failed" },
      activity: { totals: { nativeCreated: 10, trackerClosed: 10 } },
    });
    restoreEvidence(database, original);

    const firstEffort = database
      .query("SELECT payload_json FROM project_objects WHERE reference = 'effort:e001'")
      .get() as { payload_json: string };
    const secondEffortRow = database
      .query("SELECT payload_json FROM project_objects WHERE reference = 'effort:e002'")
      .get() as { payload_json: string };
    const firstEffortValue = JSON.parse(firstEffort.payload_json);
    const secondEffortValue = JSON.parse(secondEffortRow.payload_json);
    const firstPortalEvidence = database
      .query(
        "SELECT payload_json FROM project_objects WHERE reference = 'portal-native-evidence:bound:effort:e001'",
      )
      .get() as { payload_json: string };
    const secondPortalEvidence = database
      .query(
        "SELECT payload_json FROM project_objects WHERE reference = 'portal-native-evidence:bound:effort:e002'",
      )
      .get() as { payload_json: string };
    database
      .query("UPDATE project_objects SET payload_json = ? WHERE reference = 'effort:e002'")
      .run(
        JSON.stringify({
          ...secondEffortValue,
          workBinding: firstEffortValue.workBinding,
          workBindingState: { state: "bound" },
        }),
      );
    database
      .query(
        "UPDATE project_objects SET payload_json = ? WHERE reference = 'portal-native-evidence:bound:effort:e002'",
      )
      .run(
        JSON.stringify({
          ...JSON.parse(firstPortalEvidence.payload_json),
          id: "portal-native-evidence:bound:effort:e002",
          subjectReference: "effort:e002",
        }),
      );
    const conflict = await product.run(activityArgs(nativeDate), {
      cwd: fixture.root,
      observeRoots: [fixture.root],
    });
    const conflictEnvelope = JSON.parse(conflict.stdout);
    expect(conflictEnvelope).toMatchObject({
      outcome: "partial",
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ code: "activity-binding-conflict", target: "effort:e001" }),
        expect.objectContaining({ code: "activity-binding-conflict", target: "effort:e002" }),
      ]),
    });
    expect(conflictEnvelope.result.efforts[0]).toMatchObject({
      currentFrontier: { state: "withheld", reason: "binding-attention" },
      activity: { totals: { nativeCreated: 0, trackerClosed: 0 } },
    });
    database
      .query("UPDATE project_objects SET payload_json = ? WHERE reference = 'effort:e002'")
      .run(secondEffortRow.payload_json);
    database
      .query(
        "UPDATE project_objects SET payload_json = ? WHERE reference = 'portal-native-evidence:bound:effort:e002'",
      )
      .run(secondPortalEvidence.payload_json);

    const { id: _id, projection: _projection, ...invalidContent } = observation;
    const invalidWithoutId = { ...invalidContent, state: "invalid", completion: "incomplete" };
    const invalidId = providerObservationIdentityFor(invalidWithoutId);
    writeEvidence(
      database,
      original,
      { id: invalidId, ...invalidWithoutId },
      { ...selection, observationId: invalidId },
    );
    const invalid = await product.run(activityArgs(nativeDate), {
      cwd: fixture.root,
      observeRoots: [fixture.root],
    });
    expect(JSON.parse(invalid.stdout)).toMatchObject({
      outcome: "partial",
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ code: "activity-provider-evidence-invalid" }),
      ]),
    });
    restoreEvidence(database, original);
    database.close();

    const missing = await product.run(activityArgs(nativeDate), {
      cwd: recoveryFixture.root,
      observeRoots: [recoveryFixture.root],
    });
    expect(missing).toMatchObject({
      exitClass: "product-outcome",
      exitCode: 1,
      effects: { created: [], changed: [], removed: [] },
    });
    expect(JSON.parse(missing.stdout)).toMatchObject({
      outcome: "unfulfilled",
      result: { reason: "project-read-model-missing" },
    });

    const recoveryBuild = await product.run(["cache", "rebuild", "--repo", "."], {
      cwd: recoveryFixture.root,
      observeRoots: [recoveryFixture.root],
    });
    expect(recoveryBuild.exitClass).toBe("success");
    const recoveryPath = join(recoveryFixture.root, ".bearing/cache/project-read-model.sqlite");
    const busyDatabase = new Database(recoveryPath);
    busyDatabase.exec("PRAGMA locking_mode = EXCLUSIVE; BEGIN EXCLUSIVE;");
    const busy = await product.run(activityArgs(nativeDate), {
      cwd: recoveryFixture.root,
      observeRoots: [recoveryFixture.root],
    });
    busyDatabase.exec("ROLLBACK;");
    busyDatabase.close();
    expect(busy).toMatchObject({
      exitClass: "product-outcome",
      exitCode: 1,
      effects: { created: [], changed: [], removed: [] },
    });
    expect(JSON.parse(busy.stdout)).toMatchObject({
      outcome: "unfulfilled",
      result: { reason: "project-read-model-busy" },
    });

    const recoveryDatabase = new Database(recoveryPath);
    recoveryDatabase
      .query("UPDATE read_model_metadata SET projection_version = 9 WHERE singleton = 1")
      .run();
    recoveryDatabase.close();
    const older = await product.run(activityArgs(nativeDate), {
      cwd: recoveryFixture.root,
      observeRoots: [recoveryFixture.root],
    });
    expect(older.exitClass).toBe("product-outcome");
    expect(JSON.parse(older.stdout).outcome).toBe("recovery-required");

    const newerDatabase = new Database(recoveryPath);
    newerDatabase
      .query("UPDATE read_model_metadata SET projection_version = 11 WHERE singleton = 1")
      .run();
    newerDatabase.close();
    const newer = await product.run(activityArgs(nativeDate), {
      cwd: recoveryFixture.root,
      observeRoots: [recoveryFixture.root],
    });
    expect(newer.exitClass).toBe("product-outcome");
    expect(JSON.parse(newer.stdout).outcome).toBe("need-update");

    await writeFile(recoveryPath, "not a sqlite database\n");
    const corrupt = await product.run(activityArgs(nativeDate), {
      cwd: recoveryFixture.root,
      observeRoots: [recoveryFixture.root],
    });
    expect(corrupt.exitClass).toBe("product-outcome");
    expect(JSON.parse(corrupt.stdout).outcome).toBe("recovery-required");
  } finally {
    await product.dispose();
  }
}, 30_000);
