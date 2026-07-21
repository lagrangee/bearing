import { expect, test } from "bun:test";
import { link } from "node:fs/promises";
import { join } from "node:path";
import { makeTemporaryDirectory, writeFixture } from "./helpers";
import { captureDecodedSourceInputs } from "./project-snapshot-fixture";

test("projection refuses source bytes from a cross-repository hard link", async () => {
  const root = await makeTemporaryDirectory("bearing-projection-input-");
  const outside = await makeTemporaryDirectory("bearing-foreign-input-");
  const foreign = join(outside, "CONTEXT.md");
  await writeFixture(outside, "CONTEXT.md", "FOREIGN_REPOSITORY_SECRET\n");
  await link(foreign, join(root, "CONTEXT.md"));

  await expect(
    captureDecodedSourceInputs({
      repoRoot: root,
      packageVersion: "0.0.0-test",
      inputs: ["CONTEXT.md"],
      sitemapFingerprint: `sha256:${"a".repeat(64)}`,
      diagnostics: [],
      advisoryFreshness: {},
    }),
  ).rejects.toThrow("one unlinked regular file");
});
