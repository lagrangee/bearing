import { expect, test } from "bun:test";
import { access, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { commitSyncPlan, prepareSync } from "../src/sync-plan";
import { createValidBearingRepo } from "./helpers";

const exists = async (target: string): Promise<boolean> => {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
};

test("prepares deterministic Sync outputs without writing, then commits them", async () => {
  const root = await createValidBearingRepo();
  const report = join(root, ".bearing/cache/sync-report.md");
  const sitemap = join(root, ".bearing/cache/project-sitemap.md");

  const initial = await prepareSync(root);
  expect(initial.changed).toBe(true);
  expect(await exists(report)).toBe(false);
  expect(await exists(sitemap)).toBe(false);

  const committed = await commitSyncPlan(initial);
  expect(committed.changed).toBe(true);
  expect(await exists(report)).toBe(true);
  expect(await exists(sitemap)).toBe(true);
  expect((await prepareSync(root)).changed).toBe(false);
});

test("detects changed discovery diagnostics even when the input fingerprint is unchanged", async () => {
  const root = await createValidBearingRepo();
  await commitSyncPlan(await prepareSync(root));
  const clean = await prepareSync(root);

  await mkdir(join(root, ".bearing/state/planning-audit.md"));
  const shapeChanged = await prepareSync(root);

  expect(shapeChanged.fingerprint).toBe(clean.fingerprint);
  expect(shapeChanged.inputs).toEqual(clean.inputs);
  expect(shapeChanged.changed).toBe(true);
  expect(shapeChanged.diagnostics).toContainEqual({
    code: "invalid-input-file",
    impact: "blocking",
    target: ".bearing/state/planning-audit.md",
    message: "Repository input must be a file.",
  });
});
