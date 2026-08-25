import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { providerObservationIdentityFor } from "../src/native-work-provider";
import { createRepresentativeProject } from "./fixtures/representative-project";
import { installPackedProduct } from "./product-seams/installed-product";

const addGovernanceTimes = async (root: string): Promise<void> => {
  const roadmapPath = join(root, ".bearing/state/roadmaps/r001.md");
  const gatePath = join(root, ".bearing/state/milestone-gates/g001.md");
  const effortPath = join(root, ".bearing/state/efforts/e001.md");
  await writeFile(
    roadmapPath,
    (await readFile(roadmapPath, "utf8")).replace(
      "Status: active\n",
      "Status: active\nStarted at: 2026-08-09T00:00:00Z\n",
    ),
  );
  await writeFile(
    gatePath,
    (await readFile(gatePath, "utf8")).replace(
      "Status: active\n",
      "Status: active\nPlanned at: 2026-08-09T01:00:00Z\nActivated at: 2026-08-09T02:00:00Z\n",
    ),
  );
  await writeFile(
    effortPath,
    (await readFile(effortPath, "utf8"))
      .replace("Planned at: null", "Planned at: 2026-08-09T03:00:00Z")
      .replace("Activated at: null", "Activated at: 2026-08-09T04:00:00Z"),
  );
};

const promoteOneCapturedTicketToSourceEventEvidence = (root: string): void => {
  const database = new Database(join(root, ".bearing/cache/project-read-model.sqlite"));
  try {
    const row = database
      .query(
        "SELECT binding_key, observation_json, selection_json FROM provider_evidence WHERE role = 'bound' ORDER BY binding_key LIMIT 1",
      )
      .get() as
      | { binding_key: string; observation_json: string; selection_json: string }
      | undefined;
    if (row === undefined) throw new Error("Expected captured provider evidence.");
    const observation = JSON.parse(row.observation_json);
    const ticket = observation.projection.wayfinderTickets[0];
    if (ticket === undefined || ticket.trackerClosure.state !== "closed") {
      throw new Error("Expected one closed captured Wayfinder ticket.");
    }
    const sourceTime = (time: { value: string; precision: string }) => ({
      availability: "available",
      value: time.value,
      precision: time.precision,
      basis: "source-event",
    });
    const sourceClosure = {
      ...ticket.trackerClosure,
      closedAt: sourceTime(ticket.trackerClosure.closedAt),
    };
    const sourceTicket = {
      ...ticket,
      answer:
        ticket.answer.availability === "available"
          ? {
              ...ticket.answer,
              content: {
                ...ticket.answer.content,
                authoredAt: sourceTime(ticket.answer.content.authoredAt),
              },
            }
          : ticket.answer,
      trackerClosure: sourceClosure,
      native: {
        kind: "github",
        identity: {
          repositoryDatabaseId: "R_fixture",
          repositoryNodeId: "R_fixture_node",
          objectKind: "issue",
          objectDatabaseId: "I_fixture_1",
          objectNodeId: "I_fixture_node_1",
          number: 1,
          url: "https://github.com/example/activity/issues/1",
          owner: "example",
          repository: "activity",
        },
        createdAt: {
          ...sourceTime(ticket.native.createdAt),
          value: ticket.native.createdAt.value.slice(0, 10),
          precision: "date",
        },
        lastUpdated: sourceTime(ticket.native.lastUpdated),
        trackerClosure: sourceClosure,
        sourceAnchors: ticket.native.sourceAnchors,
        rawFacets: ticket.native.rawFacets,
      },
    };
    const { id: _id, ...content } = observation;
    const changed = {
      ...content,
      projection: {
        ...content.projection,
        wayfinderTickets: content.projection.wayfinderTickets.map((candidate: { ref: string }) =>
          candidate.ref === ticket.ref ? sourceTicket : candidate,
        ),
      },
    };
    const observationId = providerObservationIdentityFor(changed);
    const selection = { ...JSON.parse(row.selection_json), observationId };
    database
      .query(
        "UPDATE provider_evidence SET observation_id = ?, observation_json = ?, selection_json = ? WHERE binding_key = ? AND role = 'bound'",
      )
      .run(
        observationId,
        JSON.stringify({ id: observationId, ...changed }),
        JSON.stringify(selection),
        row.binding_key,
      );
  } finally {
    database.close();
  }
};

const setCommittedConditionalEffortLifecycles = (root: string): void => {
  const database = new Database(join(root, ".bearing/cache/project-read-model.sqlite"));
  try {
    const readEffort = (reference: string) => {
      const row = database
        .query("SELECT payload_json FROM project_objects WHERE reference = ? AND kind = 'effort'")
        .get(reference) as { payload_json: string } | undefined;
      if (row === undefined) throw new Error(`Expected committed ${reference}.`);
      return JSON.parse(row.payload_json);
    };
    const planned = readEffort("effort:e008");
    const concluded = readEffort("effort:e009");
    database.query("UPDATE project_objects SET payload_json = ? WHERE reference = ?").run(
      JSON.stringify({
        ...planned,
        lifecycle: "planned",
        plannedAt: {
          availability: "available",
          value: "2026-08-09T05:00:00Z",
          precision: "second",
        },
        activatedAt: undefined,
        workBindingState: { state: "invalid", reason: "lifecycle-conflict" },
      }),
      "effort:e008",
    );
    database.query("UPDATE project_objects SET payload_json = ? WHERE reference = ?").run(
      JSON.stringify({
        ...concluded,
        lifecycle: "concluded",
        conclusion: {
          disposition: "completed",
          rationale: "The fixture scope is complete.",
          concludedAt: {
            availability: "available",
            value: "2026-08-09T06:00:00Z",
            precision: "second",
          },
        },
      }),
      "effort:e009",
    );
  } finally {
    database.close();
  }
};

test("packed product inspects committed governance activity without effects", async () => {
  const product = await installPackedProduct();
  const fixture = await createRepresentativeProject("representative", product.root);
  try {
    await addGovernanceTimes(fixture.root);
    const rebuilt = await product.run(["cache", "rebuild", "--repo", "."], {
      cwd: fixture.root,
      observeRoots: [fixture.root],
    });
    expect(rebuilt.exitClass).toBe("success");

    const activity = await product.run(
      [
        "inspect",
        "activity",
        "--repo",
        ".",
        "--date",
        "2026-08-09",
        "--time-zone",
        "Asia/Shanghai",
      ],
      { cwd: fixture.root, observeRoots: [fixture.root] },
    );
    expect(activity).toMatchObject({
      exitClass: "success",
      exitCode: 0,
      stderr: "",
      effects: { created: [], changed: [], removed: [] },
    });
    const envelope = JSON.parse(activity.stdout);
    expect(envelope).toMatchObject({
      schemaVersion: 1,
      command: "inspect",
      outcome: "partial",
      request: {
        kind: "activity",
        date: "2026-08-09",
        timeZone: "Asia/Shanghai",
      },
      generation: { publicationCount: expect.any(Number) },
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ code: "activity-binding-unresolved" }),
      ]),
      result: {
        schemaVersion: 1,
        interval: {
          date: "2026-08-09",
          timeZone: "Asia/Shanghai",
          startInclusive: "2026-08-08T16:00:00Z",
          endExclusive: "2026-08-09T16:00:00Z",
        },
        historicalCompleteness: "not-established",
        governance: {
          roadmaps: {
            total: 1,
            items: [
              {
                reference: "roadmap:r001",
                currentTitle: "Roadmap 001",
                event: "roadmap-started",
                occurredAt: {
                  availability: "available",
                  value: "2026-08-09T00:00:00Z",
                  precision: "second",
                },
              },
            ],
          },
          gates: {
            total: 2,
            items: [
              expect.objectContaining({ reference: "gate:g001", event: "gate-planned" }),
              expect.objectContaining({ reference: "gate:g001", event: "gate-activated" }),
            ],
          },
          efforts: {
            total: 2,
            items: [
              expect.objectContaining({ reference: "effort:e001", event: "effort-planned" }),
              expect.objectContaining({ reference: "effort:e001", event: "effort-activated" }),
            ],
          },
        },
      },
    });
    expect(envelope.result).not.toHaveProperty("currentSpine");
    expect(envelope.result).not.toHaveProperty("timeline");
    expect(envelope.result.efforts).toHaveLength(9);
    expect(envelope.result.efforts[0]).toMatchObject({
      lifecycle: "active",
      evidence: { state: "unavailable" },
      currentFrontier: { state: "unavailable" },
      activity: {
        totals: { nativeCreated: 0, trackerClosed: 0, uniqueSubjects: 0 },
        items: [],
        omittedItemCount: 0,
      },
    });

    const repeated = await product.run(
      [
        "inspect",
        "activity",
        "--repo",
        ".",
        "--date",
        "2026-08-09",
        "--time-zone",
        "Asia/Shanghai",
      ],
      { cwd: fixture.root, observeRoots: [fixture.root] },
    );
    expect(repeated.effects).toEqual({ created: [], changed: [], removed: [] });
    expect(JSON.parse(repeated.stdout)).toEqual(envelope);

    setCommittedConditionalEffortLifecycles(fixture.root);
    const targetDayConditional = await product.run(
      [
        "inspect",
        "activity",
        "--repo",
        ".",
        "--date",
        "2026-08-09",
        "--time-zone",
        "Asia/Shanghai",
      ],
      { cwd: fixture.root, observeRoots: [fixture.root] },
    );
    const targetDayConditionalEnvelope = JSON.parse(targetDayConditional.stdout);
    expect(targetDayConditionalEnvelope.result.efforts).toHaveLength(9);
    expect(targetDayConditionalEnvelope.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "activity-binding-lifecycle-conflict",
        target: "effort:e008",
      }),
    );
    const emptyNextDay = await product.run(
      [
        "inspect",
        "activity",
        "--repo",
        ".",
        "--date",
        "2026-08-10",
        "--time-zone",
        "Asia/Shanghai",
      ],
      { cwd: fixture.root, observeRoots: [fixture.root] },
    );
    expect(JSON.parse(emptyNextDay.stdout).result.efforts).toHaveLength(7);

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
    promoteOneCapturedTicketToSourceEventEvidence(fixture.root);
    const nativeDate = (await stat(join(fixture.root, fixture.nativeLocator))).birthtime
      .toISOString()
      .slice(0, 10);
    const nativeActivity = await product.run(
      ["inspect", "activity", "--repo", ".", "--date", nativeDate, "--time-zone", "UTC"],
      { cwd: fixture.root, observeRoots: [fixture.root] },
    );
    expect(nativeActivity).toMatchObject({ exitClass: "success" });
    expect(nativeActivity.effects).toEqual({ created: [], changed: [], removed: [] });
    const nativeEnvelope = JSON.parse(nativeActivity.stdout);
    expect(nativeEnvelope.result.efforts).toHaveLength(9);
    expect(nativeEnvelope.result.efforts[0]).toMatchObject({
      reference: "effort:e001",
      currentTitle: "Effort 001",
      lifecycle: "active",
      evidence: {
        observedAt: expect.any(String),
        freshness: "current",
        coverage: "complete",
        completion: "complete",
      },
      currentFrontier: {
        state: "available",
        counts: {
          claimed: { mode: "exact", value: 0 },
          ready: { mode: "exact", value: 0 },
          blocked: { mode: "exact", value: 0 },
          resolved: { mode: "exact", value: 10 },
        },
      },
      activity: {
        totals: {
          nativeCreated: 10,
          trackerClosed: 10,
          uniqueSubjects: 10,
          byTimeBasis: {
            sourceEvent: 2,
            inferredSourceMetadata: 18,
          },
        },
        items: expect.arrayContaining([
          expect.objectContaining({
            event: "native-created",
            occurredAt: expect.objectContaining({ precision: "date", value: nativeDate }),
            timeBasis: "source-event",
          }),
          expect.objectContaining({ event: "tracker-closed", timeBasis: "source-event" }),
        ]),
        omittedItemCount: 0,
      },
    });
    expect(nativeEnvelope.result.efforts[1].activity).toMatchObject({
      items: [],
      omittedItemCount: 20,
    });
    expect(nativeEnvelope.result.detailBudget).toMatchObject({
      limit: 20,
      expandedItemCount: 20,
      omittedItemCount: 148,
    });
    expect(nativeActivity.stdout).not.toContain(".scratch/scope-");
    expect(nativeActivity.stdout).not.toContain("## Answer");
    expect(nativeActivity.stdout).not.toContain("Computer History");

    for (const args of [
      ["inspect", "activity", "--repo", ".", "--date", "2026-08-09"],
      ["inspect", "activity", "--repo", ".", "--date", "2026-02-30", "--time-zone", "UTC"],
      ["inspect", "activity", "--repo", ".", "--date", "2026-08-09", "--time-zone", "Not/A_Zone"],
    ]) {
      const invalid = await product.run(args, {
        cwd: fixture.root,
        observeRoots: [fixture.root],
      });
      expect(invalid.exitClass).toBe("usage-error");
      expect(invalid.exitCode).toBe(2);
      expect(invalid.effects).toEqual({ created: [], changed: [], removed: [] });
    }
  } finally {
    await product.dispose();
  }
}, 30_000);
