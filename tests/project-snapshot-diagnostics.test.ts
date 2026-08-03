import { expect, test } from "bun:test";
import { buildSnapshotDiagnostics } from "../src/project-snapshot/diagnostic-projection";
import { encodeGitHubMattNativeScope } from "../src/providers/matt-skills-v1/github-native-scope";

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

test("Attention includes canonical and bound-scope diagnostics but excludes standalone work", () => {
  const projected = buildSnapshotDiagnostics({
    sitemapFingerprint: BASIS,
    managedTargets: [".scratch/managed"],
    diagnostics: [
      {
        code: "managed-ticket-invalid",
        impact: "blocking",
        target: ".scratch/managed/issues/01-build.md",
        message: "Managed work needs attention.",
      },
      {
        code: "standalone-ticket-invalid",
        impact: "blocking",
        target: ".scratch/standalone/issues/01-build.md",
        message: "Standalone work remains outside Bearing Scope.",
      },
    ],
    sourceLocators: [
      { kind: "tracker", locator: ".scratch/managed/issues/01-build.md" },
      { kind: "tracker", locator: ".scratch/standalone/issues/01-build.md" },
    ],
  });

  expect(projected.diagnostics).toHaveLength(2);
  const managedReference = projected.diagnostics[0]?.reference;
  if (managedReference === undefined) throw new Error("Expected managed diagnostic reference.");
  expect(projected.attention).toEqual([
    {
      kind: "structural-diagnostic",
      diagnosticReference: managedReference,
    },
  ]);
});

test("GitHub native locators preserve managed Attention across locator dialects", () => {
  const nativeScope = encodeGitHubMattNativeScope({
    host: "github.com",
    rootKind: "wayfinder-map",
    repository: {
      owner: "example",
      name: "bearing",
      databaseId: "repository-database",
      nodeId: "R_bearing",
    },
    root: {
      objectKind: "issue",
      number: 32,
      databaseId: "issue-database",
      nodeId: "I_ticket_32",
    },
  });
  const locator = "https://github.com/example/bearing/issues/32";
  const childLocator = "https://github.com/example/bearing/issues/41";
  const projected = buildSnapshotDiagnostics({
    sitemapFingerprint: BASIS,
    managedTargets: [nativeScope, locator, childLocator],
    diagnostics: [
      {
        code: "native-work.binding-conflict",
        impact: "blocking",
        target: childLocator,
        message: "A managed GitHub child has an identity conflict.",
      },
    ],
    sourceLocators: [],
  });

  expect(childLocator.startsWith(nativeScope)).toBe(false);
  expect(childLocator.startsWith(`${locator}/`)).toBe(false);
  const reference = projected.diagnostics[0]?.reference;
  if (reference === undefined) throw new Error("Expected GitHub diagnostic reference.");
  expect(projected.attention).toEqual([
    {
      kind: "structural-diagnostic",
      diagnosticReference: reference,
    },
  ]);
});

test("Next Work diagnostics stay outside managed Attention without a Portal source", () => {
  const projected = buildSnapshotDiagnostics({
    sitemapFingerprint: BASIS,
    diagnostics: [
      {
        code: "invalid-next-work-guidance-body",
        impact: "blocking",
        target: ".bearing/state/next-work-guidance.md",
        message: "Legacy Next Work guidance is malformed.",
      },
    ],
    sourceLocators: [],
  });

  expect(projected.diagnostics).toHaveLength(1);
  expect(projected.attention).toEqual([]);
});
