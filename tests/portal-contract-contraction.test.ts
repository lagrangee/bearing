import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { PROJECT_SNAPSHOT_VERSION, projectSnapshotSchema } from "../src/project-snapshot/schema";
import { createProjectOverviewFixture } from "./fixtures/project-overview";

const removedPortalModules = [
  "src/portal/project-location-recovery.ts",
  "src/portal-ui/effort-row.tsx",
  "src/portal-ui/guidance-item.tsx",
  "src/portal-ui/project-inspector-state.ts",
  "src/portal-ui/project-roadmap-inspection.ts",
  "src/portal-ui/roadmap-detail.tsx",
  "src/portal-ui/roadmap-detail-gate.tsx",
  "src/portal-ui/roadmap-detail-work.tsx",
] as const;

const productionFiles = async (): Promise<readonly string[]> => {
  const glob = new Bun.Glob("src/**/*.{ts,tsx,css}");
  return [...glob.scanSync({ cwd: process.cwd(), onlyFiles: true })].sort();
};

test("clean-cuts obsolete Portal disclosure and persistent discovery compatibility", async () => {
  const files = await productionFiles();
  for (const file of removedPortalModules) expect(files).not.toContain(file);

  const portalSources = (
    await Promise.all(
      files
        .filter((file) => file.startsWith("src/portal-ui/"))
        .map((file) => readFile(join(process.cwd(), file), "utf8")),
    )
  ).join("\n");
  expect(portalSources).not.toMatch(
    /Quick Look|row-quick-look|guidance-section|primary-guidance|effort-row/iu,
  );
  expect(portalSources).not.toMatch(
    /Selected context|Open full detail|transient inspector|inspector/iu,
  );

  const allSources = (
    await Promise.all(files.map((file) => readFile(join(process.cwd(), file), "utf8")))
  ).join("\n");
  expect(allSources).not.toMatch(
    /project-location-recovery|createProjectLocationRecovery|locationRecovery/iu,
  );
  expect(allSources).not.toMatch(
    /legacyNativeScopeDiscovery|deleteLegacyNativeScopeDiscovery|nativeScopeDiscovery|native-scope-discovery/iu,
  );
  const snapshotSources = (
    await Promise.all(
      files
        .filter((file) => file.startsWith("src/project-snapshot/"))
        .map((file) => readFile(join(process.cwd(), file), "utf8")),
    )
  ).join("\n");
  expect(snapshotSources).not.toMatch(/NextWorkGuidance|nextWorkGuidanceSchema|guidance-item/iu);
});

test("exposes only the revised versioned Portal Snapshot contract", () => {
  const snapshot = createProjectOverviewFixture();

  expect(PROJECT_SNAPSHOT_VERSION).toBe(20);
  expect("guidance" in snapshot).toBe(false);
  expect(
    projectSnapshotSchema.safeParse({ ...snapshot, guidance: { validity: "absent" } }).success,
  ).toBe(false);
  expect(projectSnapshotSchema.safeParse({ ...snapshot, nativeScopeDiscovery: {} }).success).toBe(
    false,
  );
});
