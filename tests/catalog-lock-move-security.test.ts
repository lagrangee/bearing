import { expect, test } from "bun:test";
import type { BigIntStats } from "node:fs";
import { lstat, mkdir, readFile, readlink, rename, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { moveAndVerify } from "../src/catalog/lock-move";
import { makeTemporaryDirectory } from "./helpers";

type Node = Readonly<{
  kind: "directory" | "regular" | "symlink" | "other";
  device: bigint;
  inode: bigint;
}>;

class TestMoveError extends Error {
  public constructor(options?: ErrorOptions) {
    super("typed move failure", options);
    this.name = "TestMoveError";
  }
}

const kindOf = (metadata: BigIntStats): Node["kind"] => {
  if (metadata.isDirectory()) return "directory";
  if (metadata.isFile()) return "regular";
  if (metadata.isSymbolicLink()) return "symlink";
  return "other";
};

const inspectNode = async (path: string): Promise<Node | undefined> => {
  try {
    const metadata = await lstat(path, { bigint: true });
    return {
      kind: kindOf(metadata),
      device: metadata.dev,
      inode: metadata.ino,
    };
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
    throw error;
  }
};

const matches = (expected: Node, observed: Node): boolean =>
  expected.kind === observed.kind &&
  expected.device === observed.device &&
  expected.inode === observed.inode;

const requiredNode = async (path: string): Promise<Node> => {
  const node = await inspectNode(path);
  if (node === undefined) throw new Error(`Missing fixture node: ${path}`);
  return node;
};

const failure = (cause?: unknown): TestMoveError =>
  new TestMoveError(cause === undefined ? undefined : { cause });

test("moves and verifies an unchanged regular file", async () => {
  const root = await makeTemporaryDirectory("bearing-lock-move-");
  const source = join(root, "source");
  const destination = join(root, "destination");
  await writeFile(source, "owned bytes");
  const expected = await requiredNode(source);

  await expect(
    moveAndVerify({ source, destination, expected, inspect: inspectNode, matches, failure }),
  ).resolves.toEqual(expected);
  expect(await inspectNode(source)).toBeUndefined();
  expect(await readFile(destination, "utf8")).toBe("owned bytes");
});

test("does not move a cooperative directory replacement made before reinspection", async () => {
  const root = await makeTemporaryDirectory("bearing-lock-move-");
  const source = join(root, "source");
  const preserved = join(root, "preserved");
  const destination = join(root, "destination");
  await writeFile(source, "captured bytes");
  const expected = await requiredNode(source);
  let destinationInspections = 0;

  await expect(
    moveAndVerify({
      source,
      destination,
      expected,
      inspect: async (path) => {
        if (path === destination) destinationInspections += 1;
        return inspectNode(path);
      },
      matches,
      failure,
      beforeMove: async () => {
        await rename(source, preserved);
        await mkdir(source);
      },
    }),
  ).rejects.toBeInstanceOf(TestMoveError);
  expect((await requiredNode(source)).kind).toBe("directory");
  expect(await readFile(preserved, "utf8")).toBe("captured bytes");
  expect(await inspectNode(destination)).toBeUndefined();
  expect(destinationInspections).toBe(0);
});

test("preserves a raced symlink at the destination without touching its referent", async () => {
  const root = await makeTemporaryDirectory("bearing-lock-move-");
  const source = join(root, "source");
  const preserved = join(root, "preserved");
  const destination = join(root, "destination");
  const external = join(root, "external");
  await writeFile(source, "captured bytes");
  await writeFile(external, "external bytes");
  const expected = await requiredNode(source);
  const externalBefore = await lstat(external, { bigint: true });
  let raceSource = true;

  await expect(
    moveAndVerify({
      source,
      destination,
      expected,
      inspect: async (path) => {
        const observed = await inspectNode(path);
        if (path === source && raceSource) {
          raceSource = false;
          await rename(source, preserved);
          await symlink(external, source);
        } else if (path === destination) {
          await writeFile(source, "canonical replacement");
        }
        return observed;
      },
      matches,
      failure,
    }),
  ).rejects.toBeInstanceOf(TestMoveError);

  const externalAfter = await lstat(external, { bigint: true });
  expect((await requiredNode(destination)).kind).toBe("symlink");
  expect(await readlink(destination)).toBe(external);
  expect(await readFile(source, "utf8")).toBe("canonical replacement");
  expect(await readFile(preserved, "utf8")).toBe("captured bytes");
  expect(await readFile(external, "utf8")).toBe("external bytes");
  expect({
    device: externalAfter.dev,
    inode: externalAfter.ino,
    links: externalAfter.nlink,
    size: externalAfter.size,
  }).toEqual({
    device: externalBefore.dev,
    inode: externalBefore.ino,
    links: externalBefore.nlink,
    size: externalBefore.size,
  });
});
