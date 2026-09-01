import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createLiveJourneyObservation,
  verifyLiveJourneyObservation,
} from "../scripts/live-journey-matrix";

const stdout = [
  JSON.stringify({ type: "thread.started", thread_id: "private-session" }),
  JSON.stringify({ type: "turn.completed" }),
].join("\n");

const createObservation = (
  timing: Readonly<{ startedAt: string; endedAt: string; durationMs: number }> = {
    startedAt: "2026-08-30T00:00:00.000Z",
    endedAt: "2026-08-30T00:00:00.100Z",
    durationMs: 100,
  },
  output = stdout,
) =>
  createLiveJourneyObservation({
    turn: 1,
    codexCliVersion: "codex-cli 0.147.0",
    exitCode: 0,
    stdout: output,
    stderr: "",
    before: { repository: "a".repeat(64), agentHome: "b".repeat(64) },
    after: { repository: "c".repeat(64), agentHome: "d".repeat(64) },
    rawEventsPointer: "events/turn-01.jsonl",
    stderrPointer: "transcripts/turn-01.stderr.log",
    ...timing,
  });

describe("Live Journey Codex JSONL integrity", () => {
  test("rejects a started item without a valid identity", () => {
    for (const item of [{ type: "command_execution" }, { id: "" }]) {
      const output = [
        JSON.stringify({ type: "thread.started", thread_id: "private-session" }),
        JSON.stringify({ type: "item.started", item }),
        JSON.stringify({ type: "turn.completed" }),
      ].join("\n");

      expect(() => createObservation(undefined, output)).toThrow(
        "Codex item.started event has no valid item ID.",
      );
    }
  });

  test("rejects a turn that completes with an unfinished started item", () => {
    const output = [
      JSON.stringify({ type: "thread.started", thread_id: "private-session" }),
      JSON.stringify({ type: "item.started", item: { id: "item-1" } }),
      JSON.stringify({ type: "turn.completed" }),
    ].join("\n");

    expect(() => createObservation(undefined, output)).toThrow(
      "Codex turn completed with unfinished items: item-1",
    );
  });

  test("does not treat item.updated as terminal", () => {
    const output = [
      JSON.stringify({ type: "thread.started", thread_id: "private-session" }),
      JSON.stringify({ type: "item.started", item: { id: "item-1" } }),
      JSON.stringify({ type: "item.updated", item: { id: "item-1" } }),
      JSON.stringify({ type: "turn.completed" }),
    ].join("\n");

    expect(() => createObservation(undefined, output)).toThrow(
      "Codex turn completed with unfinished items: item-1",
    );
  });

  test("accepts completed items with or without a prior started event", () => {
    const output = [
      JSON.stringify({ type: "thread.started", thread_id: "private-session" }),
      JSON.stringify({ type: "item.completed", item: { id: "item-without-start" } }),
      JSON.stringify({ type: "item.started", item: { id: "item-1" } }),
      JSON.stringify({ type: "item.completed", item: { id: "item-1" } }),
      JSON.stringify({ type: "turn.completed" }),
    ].join("\n");

    expect(createObservation(undefined, output).terminalBoundary).toBe("turn.completed");
  });
});

describe("Live Journey observation timing", () => {
  test("records an exact ISO observation window and permits a zero-duration turn", () => {
    expect(createObservation()).toMatchObject({
      startedAt: "2026-08-30T00:00:00.000Z",
      endedAt: "2026-08-30T00:00:00.100Z",
      durationMs: 100,
    });
    expect(
      createObservation({
        startedAt: "2026-08-30T00:00:00.000Z",
        endedAt: "2026-08-30T00:00:00.000Z",
        durationMs: 0,
      }).durationMs,
    ).toBe(0);
  });

  test("rejects invalid, reversed, or contradictory timing", () => {
    expect(() =>
      createObservation({
        startedAt: "not-a-timestamp",
        endedAt: "2026-08-30T00:00:00.100Z",
        durationMs: 100,
      }),
    ).toThrow();
    expect(() =>
      createObservation({
        startedAt: "2026-08-30T00:00:00.100Z",
        endedAt: "2026-08-30T00:00:00.000Z",
        durationMs: 0,
      }),
    ).toThrow("must not precede");
    expect(() =>
      createObservation({
        startedAt: "2026-08-30T00:00:00.000Z",
        endedAt: "2026-08-30T00:00:00.100Z",
        durationMs: 99,
      }),
    ).toThrow("must equal endedAt minus startedAt");
  });

  test("revalidates the timing window when reading durable evidence", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "bearing-live-observation-"));
    await Promise.all([
      mkdir(join(workspace, "observations"), { recursive: true }),
      mkdir(join(workspace, "transcripts"), { recursive: true }),
    ]);
    const observation = createObservation();
    await Promise.all([
      writeFile(join(workspace, "transcripts/turn-01.jsonl"), stdout),
      writeFile(join(workspace, "transcripts/turn-01.stderr.log"), ""),
      writeFile(
        join(workspace, "observations/turn-01.json"),
        JSON.stringify({ ...observation, durationMs: 99 }),
      ),
    ]);

    await expect(
      verifyLiveJourneyObservation({
        workspaceRoot: workspace,
        pointer: "observations/turn-01.json",
        expectedCodexCliVersion: "codex-cli 0.147.0",
      }),
    ).rejects.toThrow("must equal endedAt minus startedAt");
  });
});
