import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import {
  captureProjectProviderScopes,
  rebuildProjectReadModel,
} from "../src/project-read-model/provider-operations";
import {
  createGitHubMattRepository,
  createReferenceGitHubFixtures,
  FixtureGitHubTransport,
  githubMattProviderFactoryFor,
  writeStandardGitHubMattProductRepository,
} from "../tests/fixtures/github-matt-api";

test("provider capture CLI reports an acquired but unpublished conflict with a failing exit", {
  timeout: 30_000,
}, async () => {
  const root = await createGitHubMattRepository();
  const acquiredPath = join(root, "acquired");
  const releasePath = join(root, "release");
  try {
    const repository = await writeStandardGitHubMattProductRepository(root, {
      title: "CLI publication conflict",
      intent: "Expose a competing publication without claiming the winning capture.",
      work: "- Capture one exact GitHub scope through the CLI.",
    });
    await rebuildProjectReadModel(root);
    const fixtures = createReferenceGitHubFixtures();
    const fixturePath = join(root, "responses.json");
    const binRoot = join(root, "bin");
    const homeRoot = join(root, "home");
    await mkdir(binRoot);
    await mkdir(homeRoot);
    await writeFile(fixturePath, JSON.stringify(fixtures));
    await writeFile(
      join(binRoot, "gh"),
      `#!${process.execPath}
const { access, readFile, writeFile } = require("node:fs/promises");
const { setTimeout: delay } = require("node:timers/promises");
(async () => {
  const endpoint = process.argv.at(-1);
  if (endpoint === "repos/example/reference") {
    await writeFile(${JSON.stringify(acquiredPath)}, "acquiring");
    const deadline = Date.now() + 15000;
    while (true) {
      try { await access(${JSON.stringify(releasePath)}); break; } catch {}
      if (Date.now() > deadline) throw new Error("Fixture release did not arrive.");
      await delay(5);
    }
  }
  const fixtures = JSON.parse(await readFile(${JSON.stringify(fixturePath)}, "utf8"));
  const response = fixtures[endpoint]?.first ??
    (/\\/issues\\/[1-9][0-9]*\\/parent$/.test(endpoint) ? { status: 404, headers: {} } : undefined);
  if (response === undefined) throw new Error("Unexpected fixture endpoint: " + endpoint);
  const headers = Object.entries(response.headers).map(([key, value]) => key + ": " + value);
  process.stdout.write(["HTTP/2 " + response.status, ...headers, "", JSON.stringify(response.body ?? null)].join("\\r\\n"));
})().catch((error) => { process.stderr.write(String(error)); process.exitCode = 1; });
`,
      { mode: 0o755 },
    );
    const child = spawn(
      process.execPath,
      [
        join(process.cwd(), "dist/cli.js"),
        "provider",
        "capture",
        "--repo",
        root,
        "--scope",
        repository.nativeScope,
      ],
      {
        cwd: root,
        env: { ...process.env, PATH: binRoot, HOME: homeRoot },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      stderr += chunk;
    });
    const exited = new Promise<number | null>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", resolve);
    });
    try {
      const deadline = Date.now() + 10_000;
      while (true) {
        try {
          await access(acquiredPath);
          break;
        } catch {}
        assert.ok(
          Date.now() < deadline && child.exitCode === null,
          `CLI did not acquire its source: ${stdout}\n${stderr}`,
        );
        await delay(5);
      }
      const winner = await captureProjectProviderScopes(root, [repository.nativeScope], {
        providerFactory: githubMattProviderFactoryFor(new FixtureGitHubTransport(fixtures)),
        now: () => "2026-08-08T11:00:00.000Z",
      });
      assert.equal(winner.outcome, "complete");
      await writeFile(releasePath, "release");
      const exitCode = await exited;
      assert.equal(exitCode, 1, `${stdout}\n${stderr}`);
      const result = JSON.parse(stdout);
      assert.equal(result.command, "provider-capture");
      assert.equal(result.outcome, "unfulfilled");
      assert.equal(result.result.acquisitionCount, 1);
      assert.deepEqual(result.result.scopes, [
        { scope: repository.nativeScope, disposition: "unpublished" },
      ]);
      assert.equal(result.result.generationFingerprint, undefined);
      assert.deepEqual(
        result.diagnostics.map((entry: { code: string }) => entry.code),
        ["project-read-model-publication-conflict"],
      );
    } finally {
      await writeFile(releasePath, "release");
      if (child.exitCode === null) child.kill();
      await exited;
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
