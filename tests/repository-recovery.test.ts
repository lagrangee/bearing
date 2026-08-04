import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { diagnoseRepositoryRecovery } from "../src/repo-lifecycle";
import { makeTemporaryDirectory } from "./helpers";

const hash = (bytes: string | Buffer): string =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

const seedStrictRecoveryBundle = async (bundleRoot: string): Promise<void> => {
  const createdAt = "2026-07-26T00:00:00.000Z";
  const payload = Buffer.from('{"schemaVersion":1}\n', "utf8");
  const inventory = `${JSON.stringify(
    {
      schemaVersion: 1,
      kind: "bearing-recovery-bundle",
      createdAt,
      sourceSchema: "bearing-repository/v0.1.0",
      targetSchema: "bearing-repository/v0.1.1",
      entries: [
        {
          source: ".bearing/manifest.json",
          bundlePath: "repository/.bearing/manifest.json",
          sha256: hash(payload),
          bytes: payload.length,
          disposition: "replace",
        },
      ],
    },
    null,
    2,
  )}\n`;
  await mkdir(join(bundleRoot, "repository/.bearing"), { recursive: true });
  await writeFile(join(bundleRoot, "repository/.bearing/manifest.json"), payload);
  await writeFile(join(bundleRoot, "inventory.json"), inventory);
  await writeFile(
    join(bundleRoot, "receipt.json"),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        kind: "bearing-recovery-bundle-receipt",
        createdAt,
        sourceSchema: "bearing-repository/v0.1.0",
        targetSchema: "bearing-repository/v0.1.1",
        inventoryHash: hash(inventory),
        entryCount: 1,
        verified: true,
      },
      null,
      2,
    )}\n`,
  );
};

test("repository recovery orders only diagnosis-proven choices", async () => {
  const newerRoot = await makeTemporaryDirectory("bearing-recovery-newer-");
  const olderRoot = await makeTemporaryDirectory("bearing-recovery-older-");
  const corruptRoot = await makeTemporaryDirectory("bearing-recovery-corrupt-");
  await mkdir(join(newerRoot, ".bearing"), { recursive: true });
  await mkdir(join(olderRoot, ".bearing"), { recursive: true });
  await mkdir(join(corruptRoot, ".bearing/state"), { recursive: true });
  await writeFile(
    join(newerRoot, ".bearing/manifest.json"),
    '{"schemaVersion":2,"packageVersion":"0.2.0"}\n',
  );
  await writeFile(
    join(olderRoot, ".bearing/manifest.json"),
    '{"schemaVersion":1,"packageVersion":"0.1.0","surfaces":["agent-skills"],"executorProfiles":[]}\n',
  );
  await writeFile(join(corruptRoot, ".bearing/manifest.json"), "{broken\n");
  await writeFile(join(corruptRoot, ".bearing/state/project-summary.md"), "not valid state\n");

  const newer = await diagnoseRepositoryRecovery(newerRoot);
  const older = await diagnoseRepositoryRecovery(olderRoot);
  const corrupt = await diagnoseRepositoryRecovery(corruptRoot);

  expect(newer).toMatchObject({
    classification: "invalid-or-unsupported",
    applied: false,
    blockers: [
      {
        cause: "newer-schema",
        unsafeInputs: [".bearing/manifest.json"],
        recoveryChoices: [{ kind: "compatible-kit", owner: "package-manager", order: 1 }],
      },
    ],
  });
  expect(newer.blockers[0]?.recoveryChoices.map((choice) => choice.kind)).not.toContain("purge");
  expect(older).toMatchObject({
    classification: "legacy-cutover",
    applied: false,
    blockers: [
      {
        cause: "recognized-older-schema",
        recoveryChoices: [{ kind: "bounded-cutover", order: 1 }],
      },
    ],
  });
  expect(corrupt.blockers.map((blocker) => blocker.cause)).toEqual([
    "corrupt-manifest",
    "invalid-state-object",
  ]);

  const bundleRoot = join(corruptRoot, ".bearing/backups/verified");
  await seedStrictRecoveryBundle(bundleRoot);
  const withBundle = await diagnoseRepositoryRecovery(corruptRoot);
  expect(withBundle.blockers[0]?.recoveryChoices.map((choice) => choice.kind)).toEqual([
    "restore-bundle",
    "explicit-object-disposition",
    "purge",
  ]);
  await writeFile(join(bundleRoot, "unexpected.txt"), "not verified\n");
  const invalidated = await diagnoseRepositoryRecovery(corruptRoot);
  expect(invalidated.blockers[0]?.recoveryChoices.map((choice) => choice.kind)).not.toContain(
    "restore-bundle",
  );
});
