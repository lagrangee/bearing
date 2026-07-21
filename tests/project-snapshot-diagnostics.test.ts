import { expect, test } from "bun:test";
import { buildSnapshotDiagnostics } from "../src/project-snapshot/diagnostic-projection";

const BASIS = `sha256:${"b".repeat(64)}`;

test("projects every diagnostic but only blocking diagnostics into Attention", () => {
  const projected = buildSnapshotDiagnostics({
    sitemapFingerprint: BASIS,
    diagnostics: [
      {
        code: "broken-canonical-reference",
        impact: "blocking",
        target: ".bearing/state/roadmaps/test.md",
        message: "The reference does not resolve.",
      },
      {
        code: "claimed-with-unresolved-blocker",
        impact: "non-blocking",
        target: ".scratch/work/issues/02-follow.md",
        message: "Claimed work still has a blocker.",
      },
    ],
    sourceLocators: [
      { kind: "canonical", locator: ".bearing/state/roadmaps/test.md" },
      { kind: "tracker", locator: ".scratch/work/issues/02-follow.md" },
    ],
  });
  expect(projected.diagnostics).toHaveLength(2);
  const blockingReference = projected.diagnostics[0]?.reference;
  if (blockingReference === undefined) throw new Error("Expected a blocking diagnostic.");
  expect(projected.attention).toEqual([
    {
      kind: "structural-diagnostic",
      diagnosticReference: blockingReference,
    },
  ]);
  expect(projected.diagnostics[0]?.source).toMatch(/^source:[0-9a-f]{64}$/u);
  expect(projected.diagnostics[1]?.source).toMatch(/^source:[0-9a-f]{64}$/u);
});

test("diagnostic references are stable and Snapshot-scoped", () => {
  const input = {
    sitemapFingerprint: BASIS,
    diagnostics: [
      { code: "test", impact: "blocking" as const, target: "project", message: "Test." },
    ],
    sourceLocators: [],
  };
  const first = buildSnapshotDiagnostics(input);
  const second = buildSnapshotDiagnostics(input);
  const next = buildSnapshotDiagnostics({
    ...input,
    sitemapFingerprint: `sha256:${"c".repeat(64)}`,
  });
  expect(first).toEqual(second);
  expect(first.diagnostics[0]?.reference).not.toBe(next.diagnostics[0]?.reference);
});
