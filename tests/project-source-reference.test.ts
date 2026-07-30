import { expect, test } from "bun:test";
import { link, mkdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { CatalogReadResult } from "../src/portal/contract";
import { createProjectMaterializer } from "../src/portal/project-materializer";
import { resolveProjectSourceReference } from "../src/portal/project-source-reference";
import { runSync } from "../src/sync";
import { createValidBearingRepo } from "./helpers";

const catalogFor =
  (entries: Extract<CatalogReadResult, { state: "ready" }>["entries"]) =>
  async (): Promise<CatalogReadResult> => ({ state: "ready", entries });

const materialize = async (repoRoot: string) => {
  await runSync(repoRoot, {
    completedAt: "2026-07-14T12:00:00.000Z",
    providerObservationIntent: "initial-baseline",
  });
  return createProjectMaterializer({ packageVersion: "0.0.0-test" }).run(
    repoRoot,
    "ensure-current",
  );
};

test("resolves an opaque Source Reference only to display-safe metadata in its Catalog Entry", async () => {
  const repoRoot = await realpath(await createValidBearingRepo());
  const materialized = await materialize(repoRoot);
  if (materialized.snapshot.summary.validity !== "available") {
    throw new Error("Expected a Project Summary source fixture.");
  }
  const reference = materialized.snapshot.summary.value.source;

  const result = await resolveProjectSourceReference({
    entryId: "project-one",
    reference,
    readCatalog: catalogFor([
      {
        entryId: "project-one",
        displayName: "Project one",
        repoRoot,
        availability: "available",
      },
    ]),
  });

  expect(result).toMatchObject({
    kind: "resolved",
    source: {
      reference,
      kind: "canonical",
      displayLocator: ".bearing/state/project-summary.md",
      binding: { role: "project-summary", identity: "project-summary:current" },
    },
  });
  expect(JSON.stringify(result)).not.toContain(repoRoot);
});

test("keeps each opaque reference Entry-scoped and rejects an unsafe source boundary", async () => {
  const firstRoot = await realpath(await createValidBearingRepo());
  const secondRoot = await realpath(await createValidBearingRepo());
  const [first, second] = await Promise.all([materialize(firstRoot), materialize(secondRoot)]);
  if (
    first.snapshot.summary.validity !== "available" ||
    second.snapshot.summary.validity !== "available"
  ) {
    throw new Error("Expected identical Project Summary source fixtures.");
  }
  const reference = first.snapshot.summary.value.source;
  const secondReference = second.snapshot.summary.value.source;
  expect(secondReference).not.toBe(reference);

  const outside = await createValidBearingRepo();
  await rm(join(secondRoot, ".bearing/state"), { recursive: true });
  await mkdir(join(outside, ".bearing/state"), { recursive: true });
  await writeFile(join(outside, ".bearing/state/project-summary.md"), "outside\n");
  await symlink(join(outside, ".bearing/state"), join(secondRoot, ".bearing/state"));
  const entries = [
    {
      entryId: "first",
      displayName: "First",
      repoRoot: firstRoot,
      availability: "available" as const,
    },
    {
      entryId: "second",
      displayName: "Second",
      repoRoot: secondRoot,
      availability: "available" as const,
    },
  ];

  expect(
    await resolveProjectSourceReference({
      entryId: "first",
      reference,
      readCatalog: catalogFor(entries),
    }),
  ).toMatchObject({ kind: "resolved" });
  expect(
    await resolveProjectSourceReference({
      entryId: "second",
      reference,
      readCatalog: catalogFor(entries),
    }),
  ).toEqual({ kind: "rejected", code: "source-reference-not-found" });
  expect(
    await resolveProjectSourceReference({
      entryId: "second",
      reference: secondReference,
      readCatalog: catalogFor(entries),
    }),
  ).toEqual({ kind: "rejected", code: "unsafe-source-target" });
});

test("rejects malformed, unknown, and another Entry's stale Source Reference", async () => {
  const firstRoot = await realpath(await createValidBearingRepo());
  const secondRoot = await realpath(await createValidBearingRepo());
  const secondSummary = join(secondRoot, ".bearing/state/project-summary.md");
  await writeFile(
    secondSummary,
    (await readFile(secondSummary, "utf8")).replace(
      "Exercise the fixture.",
      "Exercise another fixture.",
    ),
  );
  const [first, second] = await Promise.all([materialize(firstRoot), materialize(secondRoot)]);
  if (first.snapshot.summary.validity !== "available") {
    throw new Error("Expected a Project Summary source fixture.");
  }
  const readCatalog = catalogFor([
    {
      entryId: "first",
      displayName: "First",
      repoRoot: firstRoot,
      availability: "available",
    },
    {
      entryId: "second",
      displayName: "Second",
      repoRoot: secondRoot,
      availability: "available",
    },
  ]);

  expect(
    await resolveProjectSourceReference({
      entryId: "first",
      reference: "not-a-source-reference",
      readCatalog,
    }),
  ).toEqual({ kind: "rejected", code: "source-reference-not-found" });
  expect(
    await resolveProjectSourceReference({
      entryId: "first",
      reference: `source:${"f".repeat(64)}`,
      readCatalog,
    }),
  ).toEqual({ kind: "rejected", code: "source-reference-not-found" });
  expect(
    await resolveProjectSourceReference({
      entryId: "second",
      reference: first.snapshot.summary.value.source,
      readCatalog,
    }),
  ).toEqual({ kind: "rejected", code: "source-reference-not-found" });
  expect(second.snapshot.basis.sitemapFingerprint).not.toBe(
    first.snapshot.basis.sitemapFingerprint,
  );
});

test("distinguishes a missing Source target from an unsafe multiply-linked target", async () => {
  const missingRoot = await realpath(await createValidBearingRepo());
  const unsafeRoot = await realpath(await createValidBearingRepo());
  const [missing, unsafe] = await Promise.all([materialize(missingRoot), materialize(unsafeRoot)]);
  if (
    missing.snapshot.summary.validity !== "available" ||
    unsafe.snapshot.summary.validity !== "available"
  ) {
    throw new Error("Expected Project Summary source fixtures.");
  }
  await rm(join(missingRoot, ".bearing/state/project-summary.md"));
  const unsafeSummary = join(unsafeRoot, ".bearing/state/project-summary.md");
  const peer = join(unsafeRoot, "summary-peer.md");
  await link(unsafeSummary, peer);
  const entries = [
    {
      entryId: "missing",
      displayName: "Missing",
      repoRoot: missingRoot,
      availability: "available" as const,
    },
    {
      entryId: "unsafe",
      displayName: "Unsafe",
      repoRoot: unsafeRoot,
      availability: "available" as const,
    },
  ];

  expect(
    await resolveProjectSourceReference({
      entryId: "missing",
      reference: missing.snapshot.summary.value.source,
      readCatalog: catalogFor(entries),
    }),
  ).toEqual({ kind: "rejected", code: "source-target-unavailable" });
  expect(
    await resolveProjectSourceReference({
      entryId: "unsafe",
      reference: unsafe.snapshot.summary.value.source,
      readCatalog: catalogFor(entries),
    }),
  ).toEqual({ kind: "rejected", code: "unsafe-source-target" });
});
