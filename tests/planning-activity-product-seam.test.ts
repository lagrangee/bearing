import { expect, test } from "bun:test";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
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
      outcome: "complete",
      request: {
        kind: "activity",
        date: "2026-08-09",
        timeZone: "Asia/Shanghai",
      },
      generation: { publicationCount: expect.any(Number) },
      diagnostics: [],
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
});
