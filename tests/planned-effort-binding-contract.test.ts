import { expect, test } from "bun:test";
import {
  hasUntrustedEffortContributor,
  normalizedGateReadiness,
} from "../src/project-generation/normalized-planning-derivation";
import { effortSchema } from "../src/project-generation/schema";
import { createProjectOverviewFixture } from "./fixtures/project-overview";
import { createValidBearingRepo, writeFixture } from "./helpers";
import { installPackedProduct } from "./product-seams/installed-product";

test("normalizes only the lifecycle-appropriate confirmed Work Binding states", () => {
  const snapshot = createProjectOverviewFixture();
  if (snapshot.efforts.validity === "invalid") throw new Error("Expected Efforts.");
  const template = snapshot.efforts.items[0];
  if (template === undefined) throw new Error("Expected an Effort.");
  const planned = {
    ...template,
    lifecycle: "planned" as const,
    activatedAt: undefined,
    conclusion: undefined,
    workBinding: undefined,
    workBindingState: { state: "not-created" as const },
  };

  expect(effortSchema.safeParse(planned).success).toBe(true);
  expect(
    effortSchema.safeParse({
      ...planned,
      workBinding: template.workBinding,
      workBindingState: { state: "bound" },
    }).success,
  ).toBe(false);
  expect(
    effortSchema.safeParse({
      ...template,
      workBinding: undefined,
      workBindingState: { state: "not-created" },
    }).success,
  ).toBe(false);
});

test("accepts authored Markdown only in Effort Intent", () => {
  const snapshot = createProjectOverviewFixture();
  if (snapshot.efforts.validity === "invalid") throw new Error("Expected Efforts.");
  const template = snapshot.efforts.items[0];
  if (template === undefined) throw new Error("Expected an Effort.");

  expect(
    effortSchema.safeParse({
      ...template,
      intent: "Preserve `provider grammar`.\n\n- Keep **authored meaning** readable.",
    }).success,
  ).toBe(true);
  expect(effortSchema.safeParse({ ...template, intent: "   " }).success).toBe(false);
  expect(effortSchema.safeParse({ ...template, title: "**Formatted title**" }).success).toBe(false);
});

test("keeps planned not-created work pending unless independent contributor trust is lost", () => {
  const gate = {
    id: "gate:test",
    source: "source:gate",
    roadmapId: "roadmap:test",
    lifecycle: "active" as const,
    readiness: "unknown" as const,
    horizonState: "focused" as const,
    effortIds: ["effort:test"],
  };
  const efforts = {
    validity: "available" as const,
    items: [
      {
        id: "effort:test",
        source: "source:effort",
        roadmapId: "roadmap:test",
        targetGateId: "gate:test",
        lifecycle: "planned" as const,
        workBindingState: { state: "not-created" as const },
      },
    ],
  };
  const gatesWithUntrustedContributor = {
    validity: "partial" as const,
    items: [gate],
    issues: [
      {
        code: "untrusted-effort-contributor",
        target: "gate:test",
      },
    ],
  };

  expect(normalizedGateReadiness(gate, efforts, [], [])).toBe("not-ready");
  expect(
    normalizedGateReadiness(
      gate,
      efforts,
      [],
      [],
      hasUntrustedEffortContributor(gatesWithUntrustedContributor, gate.id),
    ),
  ).toBe("unknown");
});

test("projects planned native work absence as not-created through Inspect and Gate Readiness", async () => {
  const root = await createValidBearingRepo();
  const effortPath = ".bearing/state/efforts/test.md";
  const active = await Bun.file(`${root}/${effortPath}`).text();
  const planned = active
    .replace("Lifecycle: active", "Lifecycle: planned")
    .replace("Activated at: null\n", "")
    .replace(
      /Work binding:\n {2}Provider: matt-skills\/v1\n {2}Native scope: \.scratch\/work\n/u,
      "",
    );
  await writeFixture(root, effortPath, planned);
  const product = await installPackedProduct();

  try {
    const rebuilt = await product.run(["cache", "rebuild", "--repo", root], {
      observeRoots: [root],
    });
    expect(rebuilt.exitClass).toBe("success");

    const projectInspection = await product.run(["inspect", "project", "--repo", root]);
    expect(projectInspection.exitClass).toBe("success");
    const project = JSON.parse(projectInspection.stdout);
    expect(project).toMatchObject({
      outcome: "complete",
      diagnostics: [],
      result: {
        roadmapFocus: [
          {
            focusedGate: { id: "gate:test", readiness: "not-ready" },
          },
        ],
        scopeOutline: [
          {
            effortId: "effort:test",
            lifecycle: "planned",
            binding: { state: "not-created" },
          },
        ],
        attentionCount: 0,
      },
    });

    const effortInspection = await product.run(["inspect", "effort:test", "--repo", root]);
    expect(effortInspection.exitClass).toBe("success");
    const effort = JSON.parse(effortInspection.stdout);
    expect(effort).toMatchObject({
      outcome: "complete",
      diagnostics: [],
      result: {
        target: {
          kind: "effort",
          value: {
            id: "effort:test",
            lifecycle: "planned",
            workBindingState: { state: "not-created" },
          },
        },
        directRelations: expect.arrayContaining([
          expect.objectContaining({
            key: "native-work.binding",
            state: "confirmed-none",
            reason: "Native work not started.",
          }),
        ]),
        coverage: {
          state: "available",
          semanticSections: expect.arrayContaining([
            { role: "effort.native-work", availability: "confirmed-empty" },
          ]),
        },
      },
    });

    const nativeInspection = await product.run([
      "inspect",
      "--native",
      ".scratch/work",
      "--repo",
      root,
    ]);
    expect(nativeInspection.exitClass).toBe("success");
    const native = JSON.parse(nativeInspection.stdout);
    expect(native).toMatchObject({
      outcome: "complete",
      result: {
        reference: ".scratch/work",
        binding: { state: "unbound" },
        coverage: { state: "unavailable" },
      },
    });
  } finally {
    await product.dispose();
  }
});
