import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import {
  assertAdaptiveScenarioCapacity,
  calculateAdaptivePeakConcurrency,
} from "../scripts/adaptive-live-matrix";
import { scanLiveScenarioDurableText } from "../scripts/live-scenario-evidence";

describe("adaptive Live Matrix orchestration", () => {
  test("enforces the four-Scenario active ceiling", () => {
    expect(() => assertAdaptiveScenarioCapacity(0)).not.toThrow();
    expect(() => assertAdaptiveScenarioCapacity(3)).not.toThrow();
    expect(() => assertAdaptiveScenarioCapacity(4)).toThrow("at most four");
    expect(() => assertAdaptiveScenarioCapacity(-1)).toThrow("non-negative integer");
  });

  test("derives actual peak concurrency independent of result input order", () => {
    const windows = [
      { startedAt: "2026-09-01T00:00:00.000Z", endedAt: "2026-09-01T00:00:04.000Z" },
      { startedAt: "2026-09-01T00:00:01.000Z", endedAt: "2026-09-01T00:00:03.000Z" },
      { startedAt: "2026-09-01T00:00:02.000Z", endedAt: "2026-09-01T00:00:05.000Z" },
      { startedAt: "2026-09-01T00:00:04.000Z", endedAt: "2026-09-01T00:00:06.000Z" },
    ];
    expect(calculateAdaptivePeakConcurrency(windows)).toBe(3);
    expect(calculateAdaptivePeakConcurrency([...windows].reverse())).toBe(3);
  });

  test("does not count a Scenario ending at the exact instant another starts as overlap", () => {
    expect(
      calculateAdaptivePeakConcurrency([
        { startedAt: "2026-09-01T00:00:00.000Z", endedAt: "2026-09-01T00:00:01.000Z" },
        { startedAt: "2026-09-01T00:00:01.000Z", endedAt: "2026-09-01T00:00:02.000Z" },
      ]),
    ).toBe(1);
  });

  test("publishes sealed Configure plan fingerprints without treating them as credentials", () => {
    const fingerprint = "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    const event = `${JSON.stringify({
      type: "item.completed",
      item: {
        type: "command_execution",
        command: `bearing configure apply --plan-token ${fingerprint}`,
      },
    })}\n`;

    expect(
      scanLiveScenarioDurableText({
        value: event,
        configPath: resolve(import.meta.dir, "../.gitleaks.toml"),
      }),
    ).toContain("<sealed-plan-fingerprint-redacted>");
  });

  test("still rejects credentials and names only the matching Gitleaks rule", () => {
    expect(() =>
      scanLiveScenarioDurableText({
        value:
          '{"sealedPlanToken":"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"}\n',
        configPath: resolve(import.meta.dir, "../.gitleaks.toml"),
      }),
    ).toThrow("generic-api-key");
  });
});
