import { expect, test } from "bun:test";
import { mkdir, realpath, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { inspectRepository } from "../src/catalog/repository-inspection";
import { createValidBearingRepo, makeTemporaryDirectory } from "./helpers";

test("classifies canonical roots and manifests through one typed inspection", async () => {
  const available = await realpath(await createValidBearingRepo());
  const linkedParent = await makeTemporaryDirectory("bearing-inspection-link-");
  const linked = join(linkedParent, "project");
  await symlink(available, linked);
  const missingManifest = await realpath(await makeTemporaryDirectory("bearing-inspection-empty-"));
  const invalidManifest = await realpath(await makeTemporaryDirectory("bearing-inspection-bad-"));
  await mkdir(join(invalidManifest, ".bearing"));
  await writeFile(join(invalidManifest, ".bearing/manifest.json"), "{broken\n");

  await expect(inspectRepository(available, { requireCanonical: true })).resolves.toEqual({
    kind: "available",
    canonicalRoot: available,
  });
  await expect(inspectRepository(linked, { requireCanonical: false })).resolves.toEqual({
    kind: "available",
    canonicalRoot: available,
  });
  await expect(inspectRepository(linked, { requireCanonical: true })).resolves.toMatchObject({
    kind: "unavailable",
    availability: "unreadable",
    reason: "non-canonical",
  });
  await expect(
    inspectRepository(missingManifest, { requireCanonical: true }),
  ).resolves.toMatchObject({
    kind: "unavailable",
    availability: "manifest-missing",
    reason: "manifest",
  });
  await expect(
    inspectRepository(invalidManifest, { requireCanonical: true }),
  ).resolves.toMatchObject({
    kind: "unavailable",
    availability: "invalid-manifest",
    reason: "manifest",
  });
});
