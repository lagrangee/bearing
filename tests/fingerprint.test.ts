import { describe, expect, test } from "bun:test";
import { link, symlink } from "node:fs/promises";
import { join } from "node:path";
import { fingerprintFiles } from "../src/fingerprint";
import { makeTemporaryDirectory, writeFixture } from "./helpers";

describe("Input Fingerprint V1", () => {
  test("normalizes Markdown and preserves binary asset bytes", async () => {
    const root = await makeTemporaryDirectory("bearing-fingerprint-");
    await writeFixture(
      root,
      "a.md",
      new Uint8Array([239, 187, 191, 97, 108, 112, 104, 97, 13, 10, 13, 10]),
    );
    await writeFixture(root, "nested/blob.bin", new Uint8Array([0, 255, 10]));

    const result = await fingerprintFiles(root, ["nested/blob.bin", "a.md", "a.md"]);

    expect(result.inputs).toEqual(["a.md", "nested/blob.bin"]);
    expect(result.fingerprint).toBe(
      "sha256:64c60ee2c20ca81af5eb4f24712f4e8b4bd91aff4d57cb63e74a9dfb6360d458",
    );
  });

  test("rejects locators that escape the repository", async () => {
    const root = await makeTemporaryDirectory("bearing-fingerprint-");
    await expect(fingerprintFiles(root, ["../outside.md"])).rejects.toThrow(
      "repository-relative POSIX path",
    );
  });

  test("rejects repository locators that resolve through an external symlink", async () => {
    const root = await makeTemporaryDirectory("bearing-fingerprint-");
    const outside = await makeTemporaryDirectory("bearing-outside-");
    await writeFixture(outside, "secret.bin", new Uint8Array([1, 2, 3]));
    await symlink(join(outside, "secret.bin"), join(root, "linked.bin"));

    await expect(fingerprintFiles(root, ["linked.bin"])).rejects.toThrow(
      "resolves outside the repository",
    );
  });

  test("rejects a final symlink even when its referent stays inside the repository", async () => {
    const root = await makeTemporaryDirectory("bearing-fingerprint-");
    await writeFixture(root, "source.md", "# Repository bytes\n");
    await symlink(join(root, "source.md"), join(root, "linked.md"));

    await expect(fingerprintFiles(root, ["linked.md"])).rejects.toThrow(
      "unavailable or resolves outside",
    );
  });

  test("rejects a repository input hard-linked to another repository", async () => {
    const root = await makeTemporaryDirectory("bearing-fingerprint-");
    const outside = await makeTemporaryDirectory("bearing-outside-");
    const shared = join(outside, "shared.md");
    await writeFixture(outside, "shared.md", "# Other repository bytes\n");
    await link(shared, join(root, "shared.md"));

    await expect(fingerprintFiles(root, ["shared.md"])).rejects.toThrow();
  });
});
