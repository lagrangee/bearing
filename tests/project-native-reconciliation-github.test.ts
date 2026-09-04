import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { githubDeliveryIssue, githubSpecIssue } from "./fixtures/github-matt-api";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

test("returns canonical URLs and relations through the public native reconciliation seam", async () => {
  const root = await mkdtemp(join(tmpdir(), "bearing-github-reconciliation-driver-"));
  roots.push(root);
  const build = await Bun.build({
    entrypoints: [join(import.meta.dir, "fixtures/github-reconciliation-product-driver.ts")],
    outdir: root,
    target: "node",
    format: "esm",
  });
  expect(build.success).toBe(true);
  const output = build.outputs[0];
  if (output === undefined) throw new Error("GitHub reconciliation driver was not built.");
  const child = Bun.spawn(["node", output.path], {
    cwd: join(import.meta.dir, ".."),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect(exitCode, stderr).toBe(0);
  const result = JSON.parse(stdout.trim());

  expect(result).toMatchObject({
    command: "reconcile-native",
    outcome: "complete",
    request: {
      subjects: [githubSpecIssue.html_url, githubDeliveryIssue.html_url],
    },
    result: {
      dispositions: [
        { reference: githubSpecIssue.html_url, disposition: "read" },
        { reference: githubDeliveryIssue.html_url, disposition: "read" },
      ],
      relationDispositions: [
        {
          relation: {
            kind: "parent-child",
            source: githubSpecIssue.html_url,
            target: githubDeliveryIssue.html_url,
          },
          disposition: "read",
        },
      ],
    },
  });
  expect(
    result.result.readback.map(
      ({ nativeReference }: { nativeReference: string }) => nativeReference,
    ),
  ).toEqual([githubSpecIssue.html_url, githubDeliveryIssue.html_url]);
});
