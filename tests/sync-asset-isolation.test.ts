import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { runSync } from "../src/sync";
import { createValidBearingRepo, writeFixture } from "./helpers";

describe("bearing sync Asset Registry isolation", () => {
  test("preserves healthy Asset nodes beside an invalid Asset entry", async () => {
    const root = await createValidBearingRepo();
    await writeFixture(root, "evidence/healthy.txt", "healthy\n");
    await writeFixture(
      root,
      ".bearing/state/efforts/test.md",
      `---
Type: effort
ID: effort:test
Title: Test Effort
Roadmap: roadmap:test
Target gate: gate:test
Authorities: []
Citations:
  - Asset: asset:healthy
    Note: Preserve this healthy referenced input.
Work binding:
  Provider: matt-skills/v1
  Driver: local-markdown
  Native scope: .scratch/work
---

# Effort: Test

## Intent

Exercise entry-level Asset isolation.

## Work

- [Map](map.md)
`,
    );
    await writeFixture(
      root,
      ".bearing/state/assets.md",
      `---
Type: asset-registry
Assets:
  - ID: asset:healthy
    Title: Healthy Asset
    Kind: verification-report
    Location: evidence/healthy.txt
    Owner: effort:test
    Producer:
      Kind: agent-surface
      Name: test
    Lifecycle source: native
  - ID: asset:broken
    Title: Broken Asset
    Kind: verification-report
    Owner: effort:test
    Producer:
      Kind: agent-surface
      Name: test
    Lifecycle source: native
---

# Asset Registry
`,
    );

    const result = await runSync(root);
    const sitemap = await readFile(result.sitemapPath, "utf8");

    expect(result.diagnostics).toContainEqual({
      code: "invalid-asset-schema",
      impact: "blocking",
      target: ".bearing/state/assets.md#asset:broken",
      message: "Asset entry does not match its package-owned schema.",
    });
    expect(sitemap).toContain("`asset:healthy` | Healthy Asset | native");
    expect(result.inputs).toContain("evidence/healthy.txt");
    expect(result.diagnostics).not.toContainEqual(
      expect.objectContaining({ code: "missing-referenced-asset", target: "asset:healthy" }),
    );
    expect(sitemap).toContain(
      "`invalid:.bearing/state/assets.md#asset:broken` | Broken Asset | invalid",
    );
  });

  test("excludes Asset links from a schema-invalid canonical object", async () => {
    const root = await createValidBearingRepo();
    await writeFixture(root, "evidence/untrusted.txt", "untrusted-v1\n");
    await writeFixture(root, "evidence/trusted.txt", "trusted-v1\n");
    await writeFixture(
      root,
      ".bearing/state/efforts/invalid.md",
      effortWithCitation("effort:invalid", "asset:untrusted", "    Unexpected: true"),
    );
    await writeFixture(
      root,
      ".bearing/state/efforts/valid.md",
      effortWithCitation("effort:valid", "asset:trusted"),
    );
    await writeFixture(
      root,
      ".bearing/state/assets.md",
      assetRegistry([
        ["asset:untrusted", "Untrusted Asset", "evidence/untrusted.txt"],
        ["asset:trusted", "Trusted Asset", "evidence/trusted.txt"],
      ]),
    );

    const initial = await runSync(root);
    const sitemap = await readFile(initial.sitemapPath, "utf8");

    expect(initial.diagnostics).toContainEqual({
      code: "invalid-bearing-schema",
      impact: "blocking",
      target: ".bearing/state/efforts/invalid.md",
      message: "Bearing frontmatter does not match its minimum schema.",
    });
    expect(initial.inputs).not.toContain("evidence/untrusted.txt");
    expect(initial.inputs).toContain("evidence/trusted.txt");
    expect(sitemap).toContain(
      "`asset:untrusted` | Untrusted Asset | native | owner: `effort:valid`; location=evidence/untrusted.txt; citation-count=0",
    );
    expect(sitemap).toContain(
      "`asset:trusted` | Trusted Asset | native | owner: `effort:valid`; location=evidence/trusted.txt; citation-count=1",
    );

    await writeFixture(root, "evidence/untrusted.txt", "untrusted-v2\n");
    const afterUntrustedChange = await runSync(root);
    expect(afterUntrustedChange.fingerprint).toBe(initial.fingerprint);

    await writeFixture(root, "evidence/trusted.txt", "trusted-v2\n");
    const afterTrustedChange = await runSync(root);
    expect(afterTrustedChange.fingerprint).not.toBe(afterUntrustedChange.fingerprint);
  });

  test("does not project entries from a semantically invalid Asset Registry", async () => {
    const root = await createValidBearingRepo();
    await writeFixture(root, "evidence/healthy.md", "healthy-v1\n");
    await writeFixture(
      root,
      ".bearing/state/efforts/test.md",
      effortWithCitation("effort:test", "asset:healthy"),
    );
    await writeFixture(
      root,
      ".bearing/state/assets.md",
      `---
Type: asset-registry
Assets:
  - ID: asset:healthy
    Title: Healthy Asset
    Kind: verification-report
    Location: evidence/healthy.md
    Owner: effort:test
    Producer:
      Kind: agent
      Name: fixture
    Lifecycle source: native
  - ID: asset:contradiction
    Title: Contradictory Asset
    Kind: verification-report
    Location: evidence/contradiction.md
    Owner: effort:test
    Producer:
      Kind: agent
      Name: fixture
    Lifecycle source: native
    Disposition: available
---

# Asset Registry
`,
    );

    const result = await runSync(root);
    const sitemap = await readFile(result.sitemapPath, "utf8");

    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: "native-asset-has-registry-disposition" }),
    );
    expect(sitemap).toContain("`invalid:.bearing/state/assets.md` | Asset Registry | invalid");
    expect(sitemap).not.toContain("`asset:healthy`");
    expect(sitemap).not.toContain("`asset:contradiction`");
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "broken-canonical-reference",
        target: ".bearing/state/efforts/test.md",
      }),
    );
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: "missing-referenced-asset", target: "asset:healthy" }),
    );
    expect(result.inputs).not.toContain("evidence/healthy.md");

    await writeFixture(root, "evidence/healthy.md", "healthy-v2\n");
    const afterAssetChange = await runSync(root);
    expect(afterAssetChange.fingerprint).toBe(result.fingerprint);
  });
});

const effortWithCitation = (id: string, asset: string, extra = ""): string => `---
Type: effort
ID: ${id}
Title: ${id}
Roadmap: roadmap:test
Target gate: gate:test
Authorities: []
Citations:
  - Asset: ${asset}
    Note: Exercise trusted citation isolation.
${extra === "" ? "" : `${extra}\n`}Work binding:
  Provider: matt-skills/v1
  Driver: local-markdown
  Native scope: .scratch/${id.slice("effort:".length)}
---

# Effort

## Intent

Exercise trusted citation isolation.

## Work

- [Map](map.md)
`;

const assetRegistry = (assets: readonly (readonly [string, string, string])[]): string => `---
Type: asset-registry
Assets:
${assets
  .map(
    ([id, title, location]) => `  - ID: ${id}
    Title: ${title}
    Kind: verification-report
    Location: ${location}
    Owner: effort:valid
    Producer:
      Kind: agent-surface
      Name: test
    Lifecycle source: native`,
  )
  .join("\n")}
---

# Asset Registry
`;
