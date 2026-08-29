import { expect, test } from "bun:test";
import type { z } from "zod";
import { repositoryManifestSchema } from "../src/schema-definitions";

const stableTarget: z.output<typeof repositoryManifestSchema> = {
  schemaVersion: 2,
  packageVersion: "0.1.2-dev",
  status: "active",
  runtime: "stable",
  surfaces: ["agent-skills"],
  executorProfiles: [],
};

test("repository manifest decoder requires the complete schema-2 Runtime target", () => {
  expect(repositoryManifestSchema.parse(stableTarget)).toEqual(stableTarget);
  expect(repositoryManifestSchema.parse({ ...stableTarget, runtime: "development" })).toEqual({
    ...stableTarget,
    runtime: "development",
  });

  const { runtime: _runtime, ...missingRuntime } = stableTarget;
  for (const invalid of [
    missingRuntime,
    { ...stableTarget, schemaVersion: 1 },
    { ...stableTarget, packageVersion: "not-semver" },
    { ...stableTarget, surfaces: ["agent-skills", "agent-skills"] },
    { ...stableTarget, executorProfiles: ["fixture", "fixture"] },
    { ...stableTarget, internalMigrationMode: "stable" },
  ]) {
    expect(repositoryManifestSchema.safeParse(invalid).success).toBeFalse();
  }
});
