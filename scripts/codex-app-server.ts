import { realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import { Readable } from "node:stream";
import { CODEX_E2E_RUNTIME } from "./codex-e2e-runtime";

type InvocationHooks = Readonly<{
  beforeSpawn: () => Promise<void>;
  spawnFailed: () => Promise<void>;
  spawned: (childPid: number) => Promise<void>;
}>;

type InvokedSkill = Readonly<{ name: string; path: string }>;

const fail = (message: string): never => {
  throw new Error(message);
};

export const codexAppServerArgumentsFromExec = (
  arguments_: readonly string[],
): readonly string[] => {
  if (arguments_[0] !== "exec" || arguments_[1] === "resume") {
    fail("Codex app-server launch must derive from the sealed initial exec contract.");
  }
  const converted = ["app-server", "--stdio"];
  for (let index = 1; index < arguments_.length; index += 1) {
    const argument = arguments_[index] as string;
    if (argument === "--strict-config") {
      converted.push(argument);
      continue;
    }
    if (argument === "--model") {
      const model = arguments_[index + 1] ?? fail("Codex exec model argument is incomplete.");
      converted.push("-c", `model=${JSON.stringify(model)}`);
      index += 1;
      continue;
    }
    if (["--config", "-c", "--enable", "--disable"].includes(argument)) {
      const value = arguments_[index + 1] ?? fail(`Codex exec ${argument} argument is incomplete.`);
      converted.push(argument, value);
      index += 1;
      continue;
    }
    if (
      ["--ignore-user-config", "--ignore-rules", "--json", "--skip-git-repo-check"].includes(
        argument,
      )
    ) {
      continue;
    }
    if (argument === "--cd") {
      if (arguments_[index + 1] === undefined) fail("Codex exec --cd argument is incomplete.");
      index += 1;
      continue;
    }
    fail(`Codex exec argument has no app-server equivalent: ${argument}.`);
  }
  return Object.freeze(converted);
};

const turnInput = (prompt: string, invokedSkill: InvokedSkill | undefined) => {
  let text = prompt;
  if (invokedSkill !== undefined) {
    const invocation = `$${invokedSkill.name}`;
    if (!text.startsWith(`${invocation} `)) {
      fail(`Initial Prompt must begin with the declared ${invocation} invocation.`);
    }
    text = text.slice(invocation.length).trimStart();
  }
  return [
    { type: "text" as const, text, text_elements: [] },
    ...(invokedSkill === undefined
      ? []
      : [{ type: "skill" as const, name: invokedSkill.name, path: invokedSkill.path }]),
  ];
};

const skillPathIdentity = (path: string): Promise<string> =>
  realpath(path).catch(() => resolve(path));

const resolveInvokedSkill = async (
  value: unknown,
  workingDirectory: string,
  requested: InvokedSkill,
): Promise<InvokedSkill> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail("Codex app-server emitted an invalid Skill catalog.");
  }
  const data = (value as Record<string, unknown>)["data"];
  if (!Array.isArray(data)) fail("Codex app-server emitted an invalid Skill catalog.");
  const catalogEntries = data as unknown[];
  const requestedPathIdentity = await skillPathIdentity(requested.path);
  const candidates = catalogEntries.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return [];
    const record = entry as Record<string, unknown>;
    if (typeof record["cwd"] !== "string" || resolve(record["cwd"]) !== resolve(workingDirectory)) {
      return [];
    }
    const skills = record["skills"];
    if (!Array.isArray(skills)) return [];
    return skills.flatMap((skill) => {
      if (typeof skill !== "object" || skill === null || Array.isArray(skill)) return [];
      const candidate = skill as Record<string, unknown>;
      return candidate["name"] === requested.name &&
        typeof candidate["path"] === "string" &&
        candidate["enabled"] === true
        ? [{ name: requested.name, path: candidate["path"] }]
        : [];
    });
  });
  const matches: InvokedSkill[] = [];
  for (const candidate of candidates) {
    if ((await skillPathIdentity(candidate.path)) === requestedPathIdentity)
      matches.push(candidate);
  }
  if (matches.length !== 1) {
    fail(`Invoked Skill is not available as one enabled exact catalog entry: ${requested.name}.`);
  }
  return Object.freeze(matches[0] as InvokedSkill);
};

const snakeCaseType = (type: string): string =>
  type.replace(/[A-Z]/gu, (value) => `_${value.toLowerCase()}`);

const normalizedItem = (value: unknown): Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail("Codex app-server emitted an invalid item notification.");
  }
  const item = value as Record<string, unknown>;
  const itemType = item["type"];
  if (typeof item["id"] !== "string") {
    fail("Codex app-server item notification has no identity or type.");
  }
  if (typeof itemType !== "string") {
    fail("Codex app-server item notification has no identity or type.");
  }
  return { ...item, type: snakeCaseType(itemType as string) };
};

const writeMessage = async (
  stdin: { write: (value: string) => number | Promise<number> },
  message: Readonly<Record<string, unknown>>,
) => {
  await stdin.write(`${JSON.stringify(message)}\n`);
};

export const runCodexAppServerTurn = async (
  input: Readonly<{
    program: string;
    arguments: readonly string[];
    environment: Readonly<Record<string, string>>;
    workingDirectory: string;
    sessionId?: string;
    prompt: string;
    invokedSkill?: InvokedSkill;
    hooks?: InvocationHooks;
  }>,
) => {
  if (input.sessionId !== undefined && input.invokedSkill !== undefined) {
    fail("A resumed Codex conversation cannot repeat the initial Skill invocation.");
  }
  await input.hooks?.beforeSpawn();
  const child = await (async () => {
    try {
      return Bun.spawn([input.program, ...input.arguments], {
        cwd: input.workingDirectory,
        env: input.environment,
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      });
    } catch (error) {
      await input.hooks?.spawnFailed();
      throw error;
    }
  })();
  try {
    await input.hooks?.spawned(child.pid);
  } catch (error) {
    child.kill();
    await child.exited;
    throw error;
  }

  const output: string[] = [];
  const stderrPromise = new Response(child.stderr).text();
  const lines = createInterface({
    input: Readable.fromWeb(child.stdout as unknown as Parameters<typeof Readable.fromWeb>[0]),
  });
  let threadId: string | undefined;
  let resolvedInvokedSkill: InvokedSkill | undefined;
  let terminal = false;
  const requiresSkillResolution = input.sessionId === undefined && input.invokedSkill !== undefined;
  const threadRequestId = requiresSkillResolution ? 3 : 2;
  const turnRequestId = threadRequestId + 1;
  const send = (message: Readonly<Record<string, unknown>>) => writeMessage(child.stdin, message);
  const startThread = () =>
    send({
      jsonrpc: "2.0",
      id: threadRequestId,
      method: input.sessionId === undefined ? "thread/start" : "thread/resume",
      params:
        input.sessionId === undefined
          ? {
              model: CODEX_E2E_RUNTIME.model,
              cwd: input.workingDirectory,
              approvalPolicy: "on-request",
              approvalsReviewer: "auto_review",
              permissions: "bearing_live_journey",
            }
          : {
              threadId: input.sessionId,
              model: CODEX_E2E_RUNTIME.model,
              cwd: input.workingDirectory,
              approvalPolicy: "on-request",
              approvalsReviewer: "auto_review",
              permissions: "bearing_live_journey",
            },
    });

  const processMessage = async (line: string) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      fail("Codex app-server emitted non-JSON protocol output.");
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      fail("Codex app-server emitted an invalid protocol message.");
    }
    const message = parsed as Record<string, unknown>;
    if (message["error"] !== undefined) {
      fail(`Codex app-server request failed: ${JSON.stringify(message["error"])}.`);
    }
    if (message["id"] === 1) {
      await send({ jsonrpc: "2.0", method: "initialized" });
      if (requiresSkillResolution) {
        await send({
          jsonrpc: "2.0",
          id: 2,
          method: "skills/list",
          params: { cwds: [input.workingDirectory], forceReload: true },
        });
      } else {
        await startThread();
      }
      return;
    }
    if (requiresSkillResolution && message["id"] === 2) {
      resolvedInvokedSkill = await resolveInvokedSkill(
        message["result"],
        input.workingDirectory,
        input.invokedSkill as InvokedSkill,
      );
      await startThread();
      return;
    }
    if (message["id"] === threadRequestId) {
      const result = message["result"] as Record<string, unknown> | undefined;
      const thread = result?.["thread"] as Record<string, unknown> | undefined;
      const responseThreadId = thread?.["id"];
      if (typeof responseThreadId !== "string") {
        fail("Codex app-server thread response has no thread identity.");
      }
      if (input.sessionId !== undefined && responseThreadId !== input.sessionId) {
        fail("Codex app-server resume changed the private thread identity.");
      }
      threadId = responseThreadId as string;
      output.push(JSON.stringify({ type: "thread.started", thread_id: threadId }));
      await send({
        jsonrpc: "2.0",
        id: turnRequestId,
        method: "turn/start",
        params: {
          threadId,
          input: turnInput(input.prompt, resolvedInvokedSkill),
          effort: CODEX_E2E_RUNTIME.reasoningEffort,
        },
      });
      return;
    }
    if (typeof message["method"] === "string" && message["id"] !== undefined) {
      fail(`Codex app-server requested unsupported client action: ${message["method"]}.`);
    }
    const method = message["method"];
    const params = message["params"] as Record<string, unknown> | undefined;
    if (method === "turn/started") {
      output.push(JSON.stringify({ type: "turn.started" }));
    } else if (method === "item/started" || method === "item/completed") {
      output.push(
        JSON.stringify({
          type: method === "item/started" ? "item.started" : "item.completed",
          item: normalizedItem(params?.["item"]),
        }),
      );
    } else if (method === "turn/completed") {
      const turn = params?.["turn"] as Record<string, unknown> | undefined;
      const completed = turn?.["status"] === "completed";
      output.push(
        JSON.stringify({
          type: completed ? "turn.completed" : "turn.failed",
          ...(completed ? {} : { error: turn?.["error"] ?? null }),
        }),
      );
      terminal = true;
      child.stdin.end();
    }
  };

  try {
    await send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        clientInfo: { name: "bearing-live-matrix", title: "Bearing Live Matrix", version: "1" },
        capabilities: { experimentalApi: true, requestAttestation: false },
      },
    });
    for await (const line of lines) if (line.trim().length > 0) await processMessage(line.trim());
    const [exitCode, stderr] = await Promise.all([child.exited, stderrPromise]);
    return {
      exitCode: terminal ? exitCode : exitCode === 0 ? 1 : exitCode,
      stdout: output.length === 0 ? "" : `${output.join("\n")}\n`,
      stderr,
      ...(resolvedInvokedSkill === undefined ? {} : { invokedSkill: resolvedInvokedSkill }),
    };
  } catch (error) {
    child.kill();
    await Promise.allSettled([child.exited, stderrPromise]);
    throw error;
  } finally {
    lines.close();
  }
};
