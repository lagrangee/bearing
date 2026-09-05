import { expect, spyOn, test } from "bun:test";
import { createHash } from "node:crypto";
import { chmod, lstat, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createConnection, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startGitHubJourneyCredentialBroker } from "../scripts/github-live-journey";

const createFixture = async (latched = false, exitCode = 0) => {
  const root = await mkdtemp(join(tmpdir(), "bearing-broker-lifecycle-"));
  const agentHome = join(root, "agent-home");
  const program = join(root, "fake-gh.mjs");
  const invocationPath = join(root, "invocation.json");
  const exitReleasePath = join(root, "exit-release");
  const outputReleasePath = join(root, "output-release");
  const outputFinishedPath = join(root, "output-finished");
  const outputProgram = join(root, "fake-gh-output.mjs");
  const setupFailurePath = join(root, "setup-cleanup-failure");
  const nodeProgram = Bun.which("node");
  if (nodeProgram === null) throw new Error("Node is required for the broker fixture.");
  await mkdir(agentHome);
  await mkdir(join(root, ".git"));
  const gitConfig =
    '[core]\n\trepositoryformatversion = 0\n[remote "origin"]\n\turl = https://github.com/example/bearing-validation.git\n';
  await writeFile(join(root, ".git/config"), gitConfig);
  await writeFile(
    outputProgram,
    `import { existsSync, writeFileSync } from "node:fs";
import { setTimeout } from "node:timers/promises";
while (!existsSync(${JSON.stringify(outputReleasePath)})) await setTimeout(10);
if (!existsSync(process.env.GH_CONFIG_DIR)) throw new Error("Credentials were removed before output completion.");
process.stdout.write("operation tail\\n");
process.stderr.write("original operation error\\n");
writeFileSync(${JSON.stringify(outputFinishedPath)}, "complete");
`,
  );
  await writeFile(
    program,
    `#!${nodeProgram}
import { spawn } from "node:child_process";
import { chmodSync, existsSync, writeFileSync } from "node:fs";
import { setTimeout } from "node:timers/promises";
const args = process.argv.slice(2);
if (args[0] === "auth") process.stdout.write("fixture-credential\\n");
else if (args[0] === "api" && args.includes("user")) {
  const configDirectory = process.env.GH_CONFIG_DIR;
  if (existsSync(${JSON.stringify(setupFailurePath)}) && configDirectory?.startsWith("/private/tmp/bearing-github-config-")) {
    writeFileSync(configDirectory + "/protected", "owned");
    chmodSync(configDirectory, 0o500);
    writeFileSync(${JSON.stringify(invocationPath)}, JSON.stringify({ configDirectory }));
    process.stdout.write("wrong-account\\n");
  } else process.stdout.write("example-agent\\n");
}
else {
  writeFileSync(${JSON.stringify(invocationPath)}, JSON.stringify({
    args, pid: process.pid, configDirectory: process.env.GH_CONFIG_DIR,
  }));
  if (${latched}) {
    while (!existsSync(${JSON.stringify(exitReleasePath)})) await setTimeout(10);
    if (!existsSync(process.env.GH_CONFIG_DIR)) throw new Error("Credentials were removed before process exit.");
    const output = spawn(process.execPath, [${JSON.stringify(outputProgram)}], {
      env: process.env, stdio: ["ignore", "inherit", "inherit"],
    });
    output.unref();
  }
  process.stdout.write("operation output\\n");
  process.exitCode = ${exitCode};
}
`,
    { mode: 0o700 },
  );
  const input = {
    program,
    agentHome,
    repositoryRoot: root,
    repositorySlug: "example/bearing-validation",
    scopeKey: `bearing-live-broker-${"a".repeat(20)}`,
    preparedGitConfigSha256: createHash("sha256").update(gitConfig).digest("hex"),
    gitProgram: program,
    nodeProgram,
    baseEnvironment: { HOME: agentHome, PATH: "/usr/bin:/bin" },
  };
  const broker = await startGitHubJourneyCredentialBroker(input);
  const request = `${JSON.stringify({
    auth: broker.environment["BEARING_GITHUB_BROKER_AUTH"],
    tool: "gh",
    args: ["api", "repos/example/bearing-validation/issues/20"],
    stdin: "",
  })}\n`;
  return {
    root,
    broker,
    invocationPath,
    request,
    exitReleasePath,
    outputReleasePath,
    outputFinishedPath,
    input,
    setupFailurePath,
  };
};

const connect = async (path: string): Promise<Socket> => {
  const socket = createConnection(path);
  // A peer reset after stop is an expected transport outcome, not an operation failure.
  socket.on("error", () => {});
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("error", reject);
  });
  return socket;
};

const readResponse = (client: Socket) =>
  new Promise<string>((resolve, reject) => {
    let bytes = "";
    client.setEncoding("utf8");
    client.on("data", (chunk) => {
      bytes += chunk;
    });
    client.once("end", () => resolve(bytes));
    client.once("error", reject);
  });

const settlesWithin = async (promise: Promise<unknown>, milliseconds = 250) =>
  Promise.race([promise.then(() => true), Bun.sleep(milliseconds).then(() => false)]);

const waitFor = async (condition: () => Promise<boolean>) => {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    if (await condition()) return;
    await Bun.sleep(10);
  }
  throw new Error("Broker fixture did not reach its controlled lifecycle boundary.");
};

const exists = (path: string) =>
  lstat(path).then(
    () => true,
    () => false,
  );

const processExited = (pid: number) => {
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ESRCH") return true;
    throw error;
  }
};

test("broker stop closes idle and partial clients without accepting later request bytes", async () => {
  const fixture = await createFixture();
  const idle = await connect(fixture.broker.socketPath);
  const partial = await connect(fixture.broker.socketPath);
  let stopping: Promise<void> | undefined;
  try {
    partial.write(fixture.request.slice(0, -1));
    await Bun.sleep(20);
    stopping = fixture.broker.stop();
    partial.write("\n");
    idle.write(fixture.request);
    expect(await settlesWithin(stopping)).toBe(true);
    await expect(connect(fixture.broker.socketPath)).rejects.toBeInstanceOf(Error);
    await expect(lstat(fixture.invocationPath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(lstat(fixture.broker.runtimeDirectory)).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    idle.destroy();
    partial.destroy();
    await (stopping ?? fixture.broker.stop());
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test.each([
  "connected",
  "disconnected",
])("broker stop drains a %s operation through process exit and output completion", async (connection) => {
  const fixture = await createFixture(true);
  const client = await connect(fixture.broker.socketPath);
  let stopping: Promise<void> | undefined;
  try {
    client.write(fixture.request);
    await waitFor(() => exists(fixture.invocationPath));
    const invocation = JSON.parse(await readFile(fixture.invocationPath, "utf8")) as {
      pid: number;
      configDirectory: string;
    };
    if (connection === "disconnected") client.destroy();
    stopping = fixture.broker.stop();
    expect(fixture.broker.stop()).toBe(stopping);
    await expect(connect(fixture.broker.socketPath)).rejects.toBeInstanceOf(Error);
    expect(await settlesWithin(stopping)).toBe(false);
    expect(await exists(fixture.broker.runtimeDirectory)).toBe(true);
    expect(await exists(invocation.configDirectory)).toBe(true);

    await writeFile(fixture.exitReleasePath, "release");
    await waitFor(async () => processExited(invocation.pid));
    expect(await settlesWithin(stopping)).toBe(false);
    expect(await exists(fixture.broker.runtimeDirectory)).toBe(true);
    expect(await exists(invocation.configDirectory)).toBe(true);

    await writeFile(fixture.outputReleasePath, "release");
    await stopping;
    expect(fixture.broker.stop()).toBe(stopping);
    expect(await readFile(fixture.outputFinishedPath, "utf8")).toBe("complete");
    expect(await exists(invocation.configDirectory)).toBe(false);
    expect(await exists(fixture.broker.runtimeDirectory)).toBe(false);
  } finally {
    await writeFile(fixture.exitReleasePath, "release");
    await writeFile(fixture.outputReleasePath, "release");
    client.destroy();
    await (stopping ?? fixture.broker.stop());
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test.each([
  { operation: "gh", tool: "gh", args: ["api", "repos/example/bearing-validation/issues/20"] },
  { operation: "scope lookup", tool: "gh", args: ["issue", "close", "20"] },
  { operation: "git", tool: "git", args: ["push", "origin", "HEAD:fixture-delivery"] },
])("broker drains $operation after an output read rejects", async ({ tool, args }) => {
  const fixture = await createFixture(true);
  const client = await connect(fixture.broker.socketPath);
  const outputError = new Error("GitHub controlled output read failure.");
  const reading = spyOn(Response.prototype, "text").mockImplementationOnce(() =>
    Promise.reject(outputError),
  );
  let stopping: Promise<void> | undefined;
  let invocation: { pid: number; configDirectory: string } | undefined;
  try {
    client.write(
      `${JSON.stringify({
        auth: fixture.broker.environment["BEARING_GITHUB_BROKER_AUTH"],
        tool,
        args,
        stdin: "",
      })}\n`,
    );
    await waitFor(() => exists(fixture.invocationPath));
    invocation = JSON.parse(await readFile(fixture.invocationPath, "utf8")) as {
      pid: number;
      configDirectory: string;
    };
    const started = invocation;
    stopping = fixture.broker.stop();
    expect(await settlesWithin(stopping)).toBe(false);
    expect(await exists(fixture.broker.runtimeDirectory)).toBe(true);
    expect(await exists(started.configDirectory)).toBe(true);

    await writeFile(fixture.exitReleasePath, "release");
    await waitFor(async () => processExited(started.pid));
    expect(await settlesWithin(stopping)).toBe(false);
    expect(await exists(fixture.broker.runtimeDirectory)).toBe(true);
    expect(await exists(started.configDirectory)).toBe(true);

    await writeFile(fixture.outputReleasePath, "release");
    await stopping;
    expect(await readFile(fixture.outputFinishedPath, "utf8")).toBe("complete");
    expect(await exists(fixture.broker.runtimeDirectory)).toBe(false);
    expect(await exists(started.configDirectory)).toBe(false);
  } finally {
    reading.mockRestore();
    await writeFile(fixture.exitReleasePath, "release");
    await writeFile(fixture.outputReleasePath, "release");
    client.destroy();
    await (stopping ?? fixture.broker.stop());
    if (invocation !== undefined) {
      const started = invocation;
      await waitFor(async () => processExited(started.pid));
    }
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("broker preserves a nonzero operation result and its complete output while running", async () => {
  const fixture = await createFixture(true, 23);
  const client = await connect(fixture.broker.socketPath);
  try {
    const response = readResponse(client);
    client.write(fixture.request);
    await waitFor(() => exists(fixture.invocationPath));
    await writeFile(fixture.exitReleasePath, "release");
    expect(await settlesWithin(response)).toBe(false);
    await writeFile(fixture.outputReleasePath, "release");
    expect(JSON.parse(await response)).toEqual({
      exitCode: 23,
      stdout: "operation output\noperation tail\n",
      stderr: "original operation error\n",
    });
  } finally {
    await writeFile(fixture.exitReleasePath, "release");
    await writeFile(fixture.outputReleasePath, "release");
    client.destroy();
    await fixture.broker.stop();
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("broker preserves the first output read error after all terminal results settle", async () => {
  const fixture = await createFixture(true, 23);
  const client = await connect(fixture.broker.socketPath);
  const originalText = Response.prototype.text;
  const reading = spyOn(Response.prototype, "text")
    .mockImplementationOnce(() => Promise.reject(new Error("GitHub original output read error.")))
    .mockImplementationOnce(async function (this: Response) {
      await originalText.call(this);
      throw new Error("GitHub later output read error.");
    });
  try {
    const response = readResponse(client);
    client.write(fixture.request);
    await waitFor(() => exists(fixture.invocationPath));
    const { pid } = JSON.parse(await readFile(fixture.invocationPath, "utf8")) as { pid: number };
    expect(await settlesWithin(response)).toBe(false);
    await writeFile(fixture.exitReleasePath, "release");
    await waitFor(async () => processExited(pid));
    expect(await settlesWithin(response)).toBe(false);
    await writeFile(fixture.outputReleasePath, "release");
    expect(JSON.parse(await response)).toEqual({
      exitCode: 70,
      stdout: "",
      stderr: "GitHub original output read error.\n",
    });
    expect(await readFile(fixture.outputFinishedPath, "utf8")).toBe("complete");
  } finally {
    reading.mockRestore();
    await writeFile(fixture.exitReleasePath, "release");
    await writeFile(fixture.outputReleasePath, "release");
    client.destroy();
    await fixture.broker.stop();
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("broker setup preserves its original failure when credential cleanup also fails", async () => {
  const fixture = await createFixture();
  await fixture.broker.stop();
  try {
    await writeFile(fixture.setupFailurePath, "fail setup and cleanup");
    const failure = await startGitHubJourneyCredentialBroker(fixture.input).catch(
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(AggregateError);
    const aggregate = failure as AggregateError;
    expect(aggregate.cause).toBeInstanceOf(Error);
    expect((aggregate.cause as Error).message).toBe(
      "Isolated GitHub account selection changed account identity.",
    );
    expect(aggregate.errors[0]).toBe(aggregate.cause);
    expect(aggregate.errors[1]).toMatchObject({ code: "EACCES" });
    expect(await exists(fixture.broker.runtimeDirectory)).toBe(false);
  } finally {
    const { configDirectory } = JSON.parse(await readFile(fixture.invocationPath, "utf8")) as {
      configDirectory: string;
    };
    await chmod(configDirectory, 0o700);
    await rm(configDirectory, { recursive: true, force: true });
    await rm(fixture.broker.runtimeDirectory, { recursive: true, force: true });
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("concurrent broker stop callers receive the same original cleanup failure", async () => {
  const fixture = await createFixture();
  const protectedDirectory = join(fixture.broker.runtimeDirectory, "protected");
  await mkdir(protectedDirectory);
  await writeFile(join(protectedDirectory, "owned"), "owned");
  await chmod(protectedDirectory, 0o500);
  try {
    const first = fixture.broker.stop();
    const second = fixture.broker.stop();
    expect(second).toBe(first);
    const failures = await Promise.all([
      first.catch((error) => error),
      second.catch((error) => error),
    ]);
    expect(failures[0]).toMatchObject({ code: "EACCES" });
    expect(failures[1]).toBe(failures[0]);
    expect(fixture.broker.stop()).toBe(first);
  } finally {
    await chmod(protectedDirectory, 0o700);
    await rm(fixture.broker.runtimeDirectory, { recursive: true, force: true });
    await rm(fixture.root, { recursive: true, force: true });
  }
});
