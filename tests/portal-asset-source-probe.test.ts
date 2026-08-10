import { expect, test } from "bun:test";
import { mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { probeExactAssetSource } from "../src/portal/asset-source-probe";
import { createPortalProjectQueryService } from "../src/portal/project-query-service";
import type { AssetProjection } from "../src/project-generation/contract";
import { createValidBearingRepo } from "./helpers";

const asset = (sourceLocator: string) =>
  ({
    id: "asset:detail",
    title: "Detail Asset",
    purpose: "Prove exact source behavior.",
    kind: "reference",
    sourceLocator,
    owner: "project-summary:current",
    addedAt: { availability: "unavailable" },
    disposition: "active",
    citations: [],
    authorityBaselines: [],
    source: "source:asset",
  }) as unknown as AssetProjection;

test("probes one exact local Asset source without recursion or cache", async () => {
  const repoRoot = join(import.meta.dir, ".tmp-asset-source-probe");
  await mkdir(join(repoRoot, "docs", "nested"), { recursive: true });
  await writeFile(join(repoRoot, "docs", "asset.md"), "first\n");
  await writeFile(join(repoRoot, "docs", "nested", "ignored.md"), "ignored\n");
  try {
    await expect(probeExactAssetSource(repoRoot, "docs/asset.md")).resolves.toEqual({
      kind: "local",
      locator: "docs/asset.md",
      availability: "file",
    });
    await rm(join(repoRoot, "docs", "asset.md"));
    await expect(probeExactAssetSource(repoRoot, "docs/asset.md")).resolves.toEqual({
      kind: "local",
      locator: "docs/asset.md",
      availability: "missing",
    });
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test("returns a safe unverified HTTPS disposition without a network request", async () => {
  await expect(probeExactAssetSource("/unused", "https://example.com/reference")).resolves.toEqual({
    kind: "external",
    href: "https://example.com/reference",
    verification: "unverified",
  });
});

test("Portal list reads do not probe and exact Asset Detail reads probe once", async () => {
  let probes = 0;
  const probedLocators: string[] = [];
  const projectRoot = await realpath(await createValidBearingRepo());
  const rows = {
    section: "assets" as const,
    objects: [],
    lineage: [],
    attentionCount: 0,
    attention: [],
    diagnostics: [],
    sources: [],
  };
  try {
    const service = createPortalProjectQueryService({
      readCatalog: async () => ({
        state: "ready",
        entries: [
          {
            entryId: "project",
            displayName: "Project",
            repoRoot: projectRoot,
            availability: "available",
          },
        ],
      }),
      readRows: async (_repoRoot, section = "overview", target) =>
        ({
          ...rows,
          section,
          ...(target ? { target } : {}),
          objects:
            section === "lineage" && target?.kind === "asset"
              ? [{ kind: "asset" as const, value: asset("docs/asset.md") }]
              : [],
        }) as never,
      probeAssetSource: async (_repoRoot, locator) => {
        probes += 1;
        probedLocators.push(locator);
        return { kind: "local", locator: "docs/asset.md", availability: "file" };
      },
    });

    const list = await service.read("project", "assets");
    expect(list.kind).toBe("ready");
    expect(probes).toBe(0);

    const detail = await service.read("project", "lineage", {
      kind: "asset",
      id: "asset:detail",
    });
    expect(detail.kind).toBe("ready");
    expect(probes).toBe(1);
    expect(probedLocators).toEqual(["docs/asset.md"]);
    if (detail.kind !== "ready") throw new Error("Expected ready Asset detail.");
    expect("assetSourceProbe" in detail.rows ? detail.rows.assetSourceProbe : undefined).toEqual({
      kind: "local",
      locator: "docs/asset.md",
      availability: "file",
    });
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("Asset Detail probes the locator from its committed row generation after concurrent publication", async () => {
  const projectRoot = await realpath(await createValidBearingRepo());
  let currentPublishedLocator = "docs/generation-n.md";
  const probedLocators: string[] = [];
  try {
    const service = createPortalProjectQueryService({
      readCatalog: async () => ({
        state: "ready",
        entries: [
          {
            entryId: "project",
            displayName: "Project",
            repoRoot: projectRoot,
            availability: "available",
          },
        ],
      }),
      readRows: async (_repoRoot, section = "overview", target) => {
        const committedLocator = currentPublishedLocator;
        currentPublishedLocator = "docs/generation-n-plus-one.md";
        return {
          section,
          ...(target ? { target } : {}),
          objects: [{ kind: "asset" as const, value: asset(committedLocator) }],
          lineage: [],
          attentionCount: 0,
          attention: [],
          diagnostics: [],
          sources: [],
        } as never;
      },
      probeAssetSource: async (_repoRoot, locator) => {
        probedLocators.push(locator);
        return { kind: "local", locator, availability: "file" };
      },
    });

    const detail = await service.read("project", "lineage", {
      kind: "asset",
      id: "asset:detail",
    });
    expect(detail.kind).toBe("ready");
    expect(currentPublishedLocator).toBe("docs/generation-n-plus-one.md");
    expect(probedLocators).toEqual(["docs/generation-n.md"]);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});
