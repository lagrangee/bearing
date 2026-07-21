import { expect, test } from "bun:test";
import { link, mkdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { inspectProjectCacheBoundary } from "../src/portal/project-cache-boundary";
import { createValidBearingRepo, makeTemporaryDirectory } from "./helpers";

const outputs = [
  "sync-report.md",
  "project-sitemap.md",
  "project-snapshot.json",
  "sync-receipt.json",
] as const;

test("accepts a missing cache and unlinked regular fixed outputs", async () => {
  const root = await createValidBearingRepo();
  expect(await inspectProjectCacheBoundary(root)).toEqual({ kind: "safe" });

  const cache = join(root, ".bearing/cache");
  await mkdir(cache);
  for (const output of outputs) await writeFile(join(cache, output), "fixture\n");

  expect(await inspectProjectCacheBoundary(root)).toEqual({ kind: "safe" });
});

test("rejects a symbolic-link cache boundary", async () => {
  const root = await createValidBearingRepo();
  const outside = await makeTemporaryDirectory("bearing-cache-boundary-");
  await symlink(outside, join(root, ".bearing/cache"));

  expect(await inspectProjectCacheBoundary(root)).toMatchObject({
    kind: "unsafe",
    reason: "unsafe-boundary",
    locator: ".bearing/cache",
  });
});

for (const output of outputs) {
  test(`rejects a symbolic-link ${output} fixed output`, async () => {
    const root = await createValidBearingRepo();
    const outside = join(await makeTemporaryDirectory("bearing-cache-output-"), "outside");
    await mkdir(join(root, ".bearing/cache"));
    await writeFile(outside, "outside\n");
    await symlink(outside, join(root, ".bearing/cache", output));

    expect(await inspectProjectCacheBoundary(root)).toMatchObject({
      kind: "unsafe",
      reason: "unsafe-output",
      locator: `.bearing/cache/${output}`,
    });
  });

  test(`rejects a multiply-linked ${output} fixed output`, async () => {
    const root = await createValidBearingRepo();
    const outside = join(await makeTemporaryDirectory("bearing-cache-output-"), "outside");
    await mkdir(join(root, ".bearing/cache"));
    await writeFile(outside, "outside\n");
    await link(outside, join(root, ".bearing/cache", output));

    expect(await inspectProjectCacheBoundary(root)).toMatchObject({
      kind: "unsafe",
      reason: "unsafe-output",
      locator: `.bearing/cache/${output}`,
    });
  });

  test(`rejects a directory at the ${output} fixed output`, async () => {
    const root = await createValidBearingRepo();
    await mkdir(join(root, ".bearing/cache", output), { recursive: true });

    expect(await inspectProjectCacheBoundary(root)).toMatchObject({
      kind: "unsafe",
      reason: "unsafe-output",
      locator: `.bearing/cache/${output}`,
    });
  });

  test(`rejects a FIFO at the ${output} fixed output without blocking`, async () => {
    const root = await createValidBearingRepo();
    const cache = join(root, ".bearing/cache");
    await mkdir(cache);
    const created = Bun.spawn(["mkfifo", join(cache, output)]);
    expect(await created.exited).toBe(0);

    expect(await inspectProjectCacheBoundary(root)).toMatchObject({
      kind: "unsafe",
      reason: "unsafe-output",
      locator: `.bearing/cache/${output}`,
    });
  });
}
