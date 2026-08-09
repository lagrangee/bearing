import assert from "node:assert/strict";
import { realpath, rm, writeFile } from "node:fs/promises";
import { test } from "node:test";
import { createProviderScopeObservation } from "../src/native-work-provider";
import { createPortalProviderApplicationService } from "../src/portal/provider-application";
import { rebuildProjectReadModel } from "../src/project-read-model/provider-operations";
import { readProjectProviderEvidence } from "../src/project-read-model/store";
import {
  defaultMattProviderFactory,
  ProviderObservationAcquisitionUnavailableError,
} from "../src/provider-acquisition";
import { readRepositorySourceBytes } from "../tests/fixtures/repository-fixture";
import { createRepresentativeProject } from "../tests/fixtures/representative-project";

const catalogFor = (repoRoot: string) => async () => ({
  state: "ready" as const,
  entries: [
    {
      entryId: "fixture",
      displayName: "Fixture",
      repoRoot,
      availability: "available" as const,
    },
  ],
});

test("Provider Application keeps exact item, exact source, and all-sources costs distinct", async () => {
  const fixture = await createRepresentativeProject("representative");
  try {
    const root = await realpath(fixture.root);
    await rebuildProjectReadModel(root);
    const sourceBytes = await readRepositorySourceBytes(root);
    const capturedScopes: string[] = [];
    const application = createPortalProviderApplicationService({
      readCatalog: catalogFor(root),
      providerDependencies: {
        providerFactory: (input) => {
          const provider = defaultMattProviderFactory(input);
          return {
            ...provider,
            capture: async (binding) => {
              capturedScopes.push(binding.nativeScope);
              return provider.capture(binding);
            },
          };
        },
        now: () => "2026-08-08T10:00:00.000Z",
      },
    });

    const source = await application.apply("fixture", {
      version: 1,
      action: "source-load",
      binding: { provider: "matt-skills/v1", nativeScope: ".scratch/scope-001" },
    });
    assert.equal(source.state, "completed");
    assert.equal(source.action, "source-load");
    assert.equal(source.acquisitionCount, 1);
    assert.equal(source.observations[0]?.scope, ".scratch/scope-001");
    assert.equal(source.observations[0]?.disposition, "captured");
    assert.match(source.observations[0]?.observedAt ?? "", /^\d{4}-\d{2}-\d{2}T/u);

    const unknownItem = await application.apply("fixture", {
      version: 1,
      action: "item-refresh",
      binding: { provider: "matt-skills/v1", nativeScope: ".scratch/scope-001" },
      subject: ".scratch/scope-001/issues/999-not-observed.md",
    });
    assert.equal(unknownItem.state, "attention");
    if (unknownItem.state !== "attention") throw new Error("Expected target attention.");
    assert.equal(unknownItem.condition, "baseline-missing");
    assert.equal(unknownItem.acquisitionCount, 0);
    assert.deepEqual(unknownItem.diagnostics, [
      {
        reference: "portal-item-refresh-target-unavailable",
        summary: "Source refresh needs Agent Surface attention.",
      },
    ]);
    assert.deepEqual(capturedScopes, [".scratch/scope-001"]);

    const item = await application.apply("fixture", {
      version: 1,
      action: "item-refresh",
      binding: { provider: "matt-skills/v1", nativeScope: ".scratch/scope-001" },
      subject: fixture.nativeLocator,
    });
    assert.equal(item.state, "completed");
    assert.equal(item.action, "item-refresh");
    assert.equal(item.acquisitionCount, 1);
    assert.deepEqual(capturedScopes, [".scratch/scope-001", ".scratch/scope-001"]);
    const detail = await readProjectProviderEvidence(root, "detail");
    assert.equal(detail.length, 1);
    assert.equal(detail[0]?.selection.nativeScope, ".scratch/scope-001");

    const all = await application.apply("fixture", {
      version: 1,
      action: "all-sources-refresh",
      confirmation: "refresh-all-current-sources",
    });
    assert.equal(all.state, "completed");
    assert.equal(all.action, "all-sources-refresh");
    assert.equal(all.acquisitionCount, 9);
    assert.equal(all.observations.length, 9);
    assert.deepEqual(await readRepositorySourceBytes(root), sourceBytes);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("failed provider acquisition retains the last valid observed time and a typed diagnostic", async () => {
  const fixture = await createRepresentativeProject("representative");
  try {
    const root = await realpath(fixture.root);
    await rebuildProjectReadModel(root);
    const healthy = createPortalProviderApplicationService({
      readCatalog: catalogFor(root),
      providerDependencies: { now: () => "2026-08-08T10:00:00.000Z" },
    });
    await healthy.apply("fixture", {
      version: 1,
      action: "source-load",
      binding: { provider: "matt-skills/v1", nativeScope: ".scratch/scope-001" },
    });
    const evidenceBefore = (await readProjectProviderEvidence(root, "bound")).find(
      (entry) => entry.selection.nativeScope === ".scratch/scope-001",
    );
    const selectedBefore = evidenceBefore?.selection.observationId;
    const observedBefore = evidenceBefore?.observation?.observedAt;
    const failing = createPortalProviderApplicationService({
      readCatalog: catalogFor(root),
      providerDependencies: {
        providerFactory: (input) => {
          const provider = defaultMattProviderFactory(input);
          return {
            ...provider,
            capture: async () => {
              throw new ProviderObservationAcquisitionUnavailableError(
                "provider network unavailable",
              );
            },
          };
        },
        now: () => "2026-08-08T11:00:00.000Z",
      },
    });
    const failed = await failing.apply("fixture", {
      version: 1,
      action: "source-load",
      binding: { provider: "matt-skills/v1", nativeScope: ".scratch/scope-001" },
    });

    assert.equal(failed.state, "attention");
    if (failed.state !== "attention") throw new Error("Expected typed attention result.");
    assert.equal(failed.condition, "provider-unavailable");
    assert.equal(failed.acquisitionCount, 1);
    assert.deepEqual(failed.observations, [
      {
        scope: ".scratch/scope-001",
        disposition: "retained-after-failure",
        observedAt: observedBefore,
      },
    ]);
    assert.ok(
      failed.diagnostics.some(
        (diagnostic) =>
          diagnostic.reference === "provider-acquisition-failed" &&
          diagnostic.summary === "Source refresh needs Agent Surface attention.",
      ),
    );
    assert.equal(
      (await readProjectProviderEvidence(root, "bound")).find(
        (entry) => entry.selection.nativeScope === ".scratch/scope-001",
      )?.selection.observationId,
      selectedBefore,
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("Provider Application keeps baseline, provider, storage, update, and removal conditions distinct", async () => {
  const fixture = await createRepresentativeProject("representative");
  try {
    const root = await realpath(fixture.root);
    await rebuildProjectReadModel(root);
    const classified = [
      ["matt.github.acquisition.authentication", "provider-auth"],
      ["matt.github.acquisition.rate-limit", "provider-rate-limit"],
      ["matt.github.acquisition.network", "provider-network"],
      ["matt.github.acquisition.unavailable", "provider-unavailable"],
    ] as const;
    for (const [code, condition] of classified) {
      const application = createPortalProviderApplicationService({
        readCatalog: catalogFor(root),
        providerDependencies: {
          providerFactory: () => ({
            id: "matt-skills/v1",
            capture: async (binding) =>
              createProviderScopeObservation({
                provider: "matt-skills/v1",
                binding,
                observedAt: "2026-08-08T10:00:00.000Z",
                freshness: { assessment: "undetermined", evidence: [] },
                state: "invalid",
                coverage: {
                  assessment: "incomplete",
                  dimensions: [{ key: "scope", state: "gap" }],
                },
                completion: "undetermined",
                diagnostics: [
                  {
                    code,
                    class: code.includes("authentication")
                      ? "permission"
                      : code.includes("network")
                        ? "network"
                        : "acquisition",
                    impact: "blocking",
                    target: binding.nativeScope,
                    message: "Typed fixture provider failure.",
                  },
                  ...(code.includes("network")
                    ? [
                        {
                          code,
                          class: "network" as const,
                          impact: "blocking" as const,
                          target: `${binding.nativeScope}#second-target`,
                          message: "The same public condition affected another private target.",
                        },
                      ]
                    : []),
                ],
              }),
          }),
        },
      });
      const result = await application.apply("fixture", {
        version: 1,
        action: "source-load",
        binding: { provider: "matt-skills/v1", nativeScope: ".scratch/scope-002" },
      });
      assert.equal(result.state, "attention");
      if (result.state !== "attention") throw new Error("Expected attention result.");
      assert.equal(result.condition, condition);
      assert.equal(result.diagnostics.filter(({ reference }) => reference === code).length, 1);
    }

    const baseline = await createPortalProviderApplicationService({
      readCatalog: catalogFor(root),
    }).apply("fixture", {
      version: 1,
      action: "source-load",
      binding: { provider: "matt-skills/v1", nativeScope: ".scratch/not-bound" },
    });
    assert.equal(baseline.state, "attention");
    if (baseline.state !== "attention") throw new Error("Expected baseline attention.");
    assert.equal(baseline.condition, "baseline-missing");
    assert.deepEqual(
      baseline.diagnostics.map(({ reference }) => reference),
      ["provider-scope-selection-invalid"],
    );

    const { DatabaseSync } = await import("node:sqlite");
    const path = `${root}/.bearing/cache/project-read-model.sqlite`;
    const newer = new DatabaseSync(path);
    newer.exec("PRAGMA user_version = 2");
    newer.close();
    const needUpdate = await createPortalProviderApplicationService({
      readCatalog: catalogFor(root),
    }).apply("fixture", {
      version: 1,
      action: "source-load",
      binding: { provider: "matt-skills/v1", nativeScope: ".scratch/scope-001" },
    });
    assert.equal(needUpdate.state, "attention");
    if (needUpdate.state !== "attention") throw new Error("Expected update attention.");
    assert.equal(needUpdate.condition, "need-update");
    assert.deepEqual(
      needUpdate.diagnostics.map(({ reference }) => reference),
      ["project-read-model-need-update"],
    );

    const restorable = new DatabaseSync(path);
    restorable.exec("PRAGMA user_version = 1");
    restorable.close();
    await writeFile(path, "not a sqlite database\n");
    const recovery = await createPortalProviderApplicationService({
      readCatalog: catalogFor(root),
    }).apply("fixture", {
      version: 1,
      action: "source-load",
      binding: { provider: "matt-skills/v1", nativeScope: ".scratch/scope-001" },
    });
    assert.equal(recovery.state, "attention");
    if (recovery.state !== "attention") throw new Error("Expected recovery attention.");
    assert.equal(recovery.condition, "storage-recovery-required");
    assert.deepEqual(
      recovery.diagnostics.map(({ reference }) => reference),
      ["project-read-model-recovery-required"],
    );

    await writeFile(`${root}/.bearing/manifest.json`, "{invalid\n");
    const removal = await createPortalProviderApplicationService({
      readCatalog: catalogFor(root),
    }).apply("fixture", {
      version: 1,
      action: "source-load",
      binding: { provider: "matt-skills/v1", nativeScope: ".scratch/scope-001" },
    });
    assert.equal(removal.state, "attention");
    if (removal.state !== "attention") throw new Error("Expected removal attention.");
    assert.equal(removal.condition, "removal-required");
    assert.deepEqual(
      removal.diagnostics.map(({ reference }) => reference),
      ["repository-integration-removal-required"],
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("Provider Application serializes different explicit sources for one Catalog Entry", async () => {
  const fixture = await createRepresentativeProject("representative");
  try {
    const root = await realpath(fixture.root);
    await rebuildProjectReadModel(root);
    let active = 0;
    let peak = 0;
    const application = createPortalProviderApplicationService({
      readCatalog: catalogFor(root),
      providerDependencies: {
        providerFactory: (input) => {
          const provider = defaultMattProviderFactory(input);
          return {
            ...provider,
            capture: async (binding) => {
              active += 1;
              peak = Math.max(peak, active);
              try {
                await new Promise((resolve) => setTimeout(resolve, 30));
                return await provider.capture(binding);
              } finally {
                active -= 1;
              }
            },
          };
        },
      },
    });

    const results = await Promise.all(
      [".scratch/scope-001", ".scratch/scope-002"].map((nativeScope) =>
        application.apply("fixture", {
          version: 1,
          action: "source-load",
          binding: { provider: "matt-skills/v1", nativeScope },
        }),
      ),
    );
    assert.deepEqual(
      results.map(({ state, acquisitionCount }) => [state, acquisitionCount]),
      [
        ["completed", 1],
        ["completed", 1],
      ],
    );
    assert.equal(peak, 1);
    const evidence = await readProjectProviderEvidence(root, "bound");
    assert.deepEqual(
      evidence
        .filter(
          (entry) =>
            entry.observation !== undefined &&
            [".scratch/scope-001", ".scratch/scope-002"].includes(entry.selection.nativeScope),
        )
        .map((entry) => entry.selection.nativeScope),
      [".scratch/scope-001", ".scratch/scope-002"],
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});
