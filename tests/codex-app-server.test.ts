import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  codexAppServerArgumentsFromExec,
  runCodexAppServerTurn,
} from "../scripts/codex-app-server";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const fakeAppServer = async (
  options: { exposeWayfinder?: boolean; resumeDifferentThread?: boolean } = {},
) => {
  const root = await mkdtemp(join(tmpdir(), "bearing-app-server-"));
  roots.push(root);
  const program = join(root, "codex");
  const capture = join(root, "requests.jsonl");
  await writeFile(
    program,
    `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";
if (process.argv[2] === "--version") {
  console.log("codex-fixture 1");
  process.exit(0);
}
const lines = createInterface({ input: process.stdin });
lines.on("line", (line) => {
  appendFileSync(${JSON.stringify(capture)}, line + "\\n");
  const message = JSON.parse(line);
  if (message.method === "initialize") {
    console.log(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: {} }));
  } else if (message.method === "skills/list") {
    console.log(JSON.stringify({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        data: [{
          cwd: message.params.cwds[0],
          skills: ${options.exposeWayfinder === false ? "[]" : '[{ name: "wayfinder", path: "/tmp/skills/wayfinder/SKILL.md", enabled: true }]'},
          errors: [],
        }],
      },
    }));
  } else if (message.method === "thread/start" || message.method === "thread/resume") {
    console.log(JSON.stringify({
      jsonrpc: "2.0",
      id: message.id,
      result: { thread: { id: message.params.threadId === undefined
        ? "11111111-1111-4111-8111-111111111111"
        : ${options.resumeDifferentThread ? '"22222222-2222-4222-8222-222222222222"' : "message.params.threadId"} } },
    }));
  } else if (message.method === "turn/start") {
    console.log(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { turn: { id: "turn-1" } } }));
    console.log(JSON.stringify({ jsonrpc: "2.0", method: "turn/started", params: {} }));
    console.log(JSON.stringify({
      jsonrpc: "2.0",
      method: "item/completed",
      params: { item: { id: "done", type: "agentMessage", text: "Structured reply" } },
    }));
    console.log(JSON.stringify({
      jsonrpc: "2.0",
      method: "turn/completed",
      params: { turn: { status: "completed" } },
    }));
  }
});
`,
  );
  await chmod(program, 0o755);
  return { root, program, capture };
};

describe("Codex app-server turn transport", () => {
  test("converts the sealed exec launch without carrying one-shot prompt flags", () => {
    expect(
      codexAppServerArgumentsFromExec([
        "exec",
        "--strict-config",
        "--model",
        "gpt-5.6-luna",
        "--config",
        'model_reasoning_effort="high"',
        "--enable",
        "fast_mode",
        "--ignore-user-config",
        "--ignore-rules",
        "-c",
        'default_permissions="bearing_live_journey"',
        "--cd",
        "/tmp/repository",
        "--json",
        "--disable",
        "shell_snapshot",
      ]),
    ).toEqual([
      "app-server",
      "--stdio",
      "--strict-config",
      "-c",
      'model="gpt-5.6-luna"',
      "--config",
      'model_reasoning_effort="high"',
      "--enable",
      "fast_mode",
      "-c",
      'default_permissions="bearing_live_journey"',
      "--disable",
      "shell_snapshot",
    ]);
  });

  test("sends a real Skill input and preserves the private thread on resume", async () => {
    const fake = await fakeAppServer();
    const environment = { ...process.env } as Record<string, string>;
    const first = await runCodexAppServerTurn({
      program: fake.program,
      arguments: ["app-server", "--stdio"],
      environment,
      workingDirectory: fake.root,
      prompt: "$wayfinder 请继续现有 Map。",
      invokedSkill: {
        name: "wayfinder",
        path: "/tmp/skills/wayfinder/SKILL.md",
      },
    });
    expect(first.exitCode).toBe(0);
    expect(first.stdout).toContain(
      JSON.stringify({
        type: "thread.started",
        thread_id: "11111111-1111-4111-8111-111111111111",
      }),
    );
    expect(first.stdout).toContain(
      JSON.stringify({
        type: "item.completed",
        item: { id: "done", type: "agent_message", text: "Structured reply" },
      }),
    );
    expect(first.stdout).toContain(JSON.stringify({ type: "turn.completed" }));

    const firstRequests = (await readFile(fake.capture, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(first.invokedSkill).toEqual({
      name: "wayfinder",
      path: "/tmp/skills/wayfinder/SKILL.md",
    });
    expect(firstRequests.map(({ method }) => method)).toEqual([
      "initialize",
      "initialized",
      "skills/list",
      "thread/start",
      "turn/start",
    ]);
    expect(firstRequests.find(({ method }) => method === "turn/start")?.params.input).toEqual([
      { type: "text", text: "请继续现有 Map。", text_elements: [] },
      { type: "skill", name: "wayfinder", path: "/tmp/skills/wayfinder/SKILL.md" },
    ]);

    await writeFile(fake.capture, "");
    await runCodexAppServerTurn({
      program: fake.program,
      arguments: ["app-server", "--stdio"],
      environment,
      workingDirectory: fake.root,
      sessionId: "11111111-1111-4111-8111-111111111111",
      prompt: "先 trim，再 lowercase。",
    });
    const resumedRequests = (await readFile(fake.capture, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(resumedRequests.find(({ method }) => method === "thread/resume")?.params).toMatchObject({
      threadId: "11111111-1111-4111-8111-111111111111",
    });
    expect(resumedRequests.find(({ method }) => method === "turn/start")?.params.input).toEqual([
      { type: "text", text: "先 trim，再 lowercase。", text_elements: [] },
    ]);
  });

  test("rejects an unavailable declared Skill before starting a thread", async () => {
    const fake = await fakeAppServer({ exposeWayfinder: false });
    await expect(
      runCodexAppServerTurn({
        program: fake.program,
        arguments: ["app-server", "--stdio"],
        environment: { ...process.env } as Record<string, string>,
        workingDirectory: fake.root,
        prompt: "$wayfinder 请继续现有 Map。",
        invokedSkill: {
          name: "wayfinder",
          path: "/tmp/skills/wayfinder/SKILL.md",
        },
      }),
    ).rejects.toThrow("Invoked Skill is not available");
    const requests = (await readFile(fake.capture, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(requests.some(({ method }) => method === "thread/start")).toBe(false);
  });

  test("rejects a resume response that changes the private thread identity", async () => {
    const fake = await fakeAppServer({ resumeDifferentThread: true });
    await expect(
      runCodexAppServerTurn({
        program: fake.program,
        arguments: ["app-server", "--stdio"],
        environment: { ...process.env } as Record<string, string>,
        workingDirectory: fake.root,
        sessionId: "11111111-1111-4111-8111-111111111111",
        prompt: "继续。",
      }),
    ).rejects.toThrow("changed the private thread identity");
  });
});
