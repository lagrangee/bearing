import { describe, expect, test } from "bun:test";
import { access, link, mkdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { readProjectSitemapCache } from "../src/sitemap-cache";
import { makeTemporaryDirectory } from "./helpers";

const fingerprint = `sha256:${"a".repeat(64)}`;

const sitemapBytes = (version = 1): string => `---
Type: project-sitemap
Version: ${version}
Inputs:
  - .bearing/manifest.json
  - docs/agents/domain.md
Input fingerprint: ${fingerprint}
Advisory freshness:
  planning-audit:current: stale
  next-work-guidance:current: current
---

This prose is deliberately not a valid Sitemap node line.
`;

const writeSitemap = async (root: string, source = sitemapBytes()): Promise<string> => {
  const cache = join(root, ".bearing/cache");
  await mkdir(cache, { recursive: true });
  const target = join(cache, "project-sitemap.md");
  await writeFile(target, source);
  return target;
};

describe("Project Sitemap cache envelope", () => {
  test("returns the strict envelope without parsing Sitemap prose", async () => {
    // Given
    const root = await makeTemporaryDirectory("bearing-sitemap-cache-");
    await writeSitemap(root);

    // When
    const result = await readProjectSitemapCache(root);

    // Then
    expect(result).toEqual({
      kind: "available",
      envelope: {
        type: "project-sitemap",
        version: 1,
        inputs: [".bearing/manifest.json", "docs/agents/domain.md"],
        inputFingerprint: fingerprint,
        advisoryFreshness: {
          "planning-audit:current": "stale",
          "next-work-guidance:current": "current",
        },
      },
    });
  });

  test("returns missing without creating repository cache state", async () => {
    // Given
    const root = await makeTemporaryDirectory("bearing-sitemap-cache-");
    const cache = join(root, ".bearing/cache");

    // When
    const result = await readProjectSitemapCache(root);

    // Then
    expect(result).toEqual({ kind: "missing" });
    await expect(access(cache)).rejects.toThrow();
  });

  test("reports a well-formed newer envelope version as unsupported", async () => {
    // Given
    const root = await makeTemporaryDirectory("bearing-sitemap-cache-");
    await writeSitemap(root, sitemapBytes(2));

    // When
    const result = await readProjectSitemapCache(root);

    // Then
    expect(result).toEqual({ kind: "unsupported", version: 2 });
  });
});

const malformedEnvelopes = [
  ["missing frontmatter", "# Bearing Project Sitemap\n"],
  ["wrong Type", sitemapBytes().replace("Type: project-sitemap", "Type: sync-report")],
  ["non-numeric Version", sitemapBytes().replace("Version: 1", "Version: one")],
  ["invalid Inputs", sitemapBytes().replace("  - docs/agents/domain.md\n", "  - /tmp/outside\n")],
  [
    "duplicate Inputs",
    sitemapBytes().replace("  - docs/agents/domain.md\n", "  - .bearing/manifest.json\n"),
  ],
  ["invalid fingerprint", sitemapBytes().replace(fingerprint, "sha256:not-a-digest")],
  ["missing Advisory freshness", sitemapBytes().replace(/Advisory freshness:[\s\S]*?---/u, "---")],
  ["unknown advisory", sitemapBytes().replace("planning-audit:current", "unknown:current")],
  ["unknown freshness", sitemapBytes().replace("stale", "expired")],
  [
    "extra envelope field",
    sitemapBytes().replace("---\n\nThis prose", "Extra: nope\n---\n\nThis prose"),
  ],
] as const;

describe.each(malformedEnvelopes)("malformed Project Sitemap envelope: %s", (_name, source) => {
  test("isolates malformed cache bytes", async () => {
    // Given
    const root = await makeTemporaryDirectory("bearing-sitemap-cache-");
    await writeSitemap(root, source);

    // When
    const result = await readProjectSitemapCache(root);

    // Then
    expect(result.kind).toBe("malformed");
  });
});

describe("Project Sitemap cache filesystem boundary", () => {
  test("rejects a cache-directory symlink without following it", async () => {
    // Given
    const root = await makeTemporaryDirectory("bearing-sitemap-cache-");
    const outside = await makeTemporaryDirectory("bearing-sitemap-outside-");
    await writeSitemap(outside);
    await mkdir(join(root, ".bearing"));
    await symlink(join(outside, ".bearing/cache"), join(root, ".bearing/cache"));

    // When
    const result = await readProjectSitemapCache(root);

    // Then
    expect(result).toEqual({ kind: "malformed", reason: "unsafe-cache-boundary" });
  });

  test("rejects a Sitemap symlink without following it", async () => {
    // Given
    const root = await makeTemporaryDirectory("bearing-sitemap-cache-");
    const outside = await makeTemporaryDirectory("bearing-sitemap-outside-");
    const outsideSitemap = await writeSitemap(outside);
    await mkdir(join(root, ".bearing/cache"), { recursive: true });
    await symlink(outsideSitemap, join(root, ".bearing/cache/project-sitemap.md"));

    // When
    const result = await readProjectSitemapCache(root);

    // Then
    expect(result).toEqual({ kind: "malformed", reason: "unsafe-cache-file" });
  });

  test("rejects a directory at the Sitemap path", async () => {
    // Given
    const root = await makeTemporaryDirectory("bearing-sitemap-cache-");
    await mkdir(join(root, ".bearing/cache/project-sitemap.md"), { recursive: true });

    // When
    const result = await readProjectSitemapCache(root);

    // Then
    expect(result).toEqual({ kind: "malformed", reason: "unsafe-cache-file" });
  });

  test("rejects a hard-linked Sitemap", async () => {
    // Given
    const root = await makeTemporaryDirectory("bearing-sitemap-cache-");
    const target = await writeSitemap(root);
    await link(target, join(root, "sitemap-peer.md"));

    // When
    const result = await readProjectSitemapCache(root);

    // Then
    expect(result).toEqual({ kind: "malformed", reason: "unsafe-cache-file" });
  });

  test("rejects a FIFO without blocking on a read", async () => {
    // Given
    const root = await makeTemporaryDirectory("bearing-sitemap-cache-");
    const cache = join(root, ".bearing/cache");
    await mkdir(cache, { recursive: true });
    const target = join(cache, "project-sitemap.md");
    const created = Bun.spawn(["mkfifo", target]);
    expect(await created.exited).toBe(0);

    // When
    const result = await readProjectSitemapCache(root);

    // Then
    expect(result).toEqual({ kind: "malformed", reason: "unsafe-cache-file" });
  }, 1_000);
});
