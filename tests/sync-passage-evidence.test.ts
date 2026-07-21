import { describe, expect, test } from "bun:test";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { runSync } from "../src/sync";
import { createValidBearingRepo, writeFixture } from "./helpers";

describe("bearing sync Gate Passage Evidence", () => {
  test("includes Gate Passage Evidence bytes in the input fingerprint", async () => {
    const root = await createValidBearingRepo();
    await writeFixture(root, "evidence/passage.txt", "first result\n");
    await writeFixture(
      root,
      ".bearing/state/assets.md",
      `---
Type: asset-registry
Assets:
  - ID: asset:passage
    Title: Passage Evidence
    Kind: verification-report
    Location: evidence/passage.txt
    Owner: gate:test
    Producer:
      Kind: agent-surface
      Name: test
    Lifecycle source: native
---

# Asset Registry
`,
    );
    await writeFixture(
      root,
      ".bearing/state/milestone-gates/test.md",
      `---
Type: milestone-gate
ID: gate:test
Title: Test Gate
Roadmap: roadmap:test
Status: passed
Passage:
  Accepted decision: Pass the test Gate.
  Rationale: The evidence is sufficient.
  Evidence:
    - asset:passage
  Exceptions: []
---

# Milestone Gate: Test

## Intent

Reach the fixture boundary.

## Exit Criteria

- All fixture work resolves.
`,
    );
    await writeFixture(
      root,
      ".bearing/state/roadmaps/test.md",
      `---
Type: roadmap
ID: roadmap:test
Title: Test Roadmap
Status: active
Focused gate: null
Gate order:
  - gate:test
---

# Roadmap: Test

## Intent

Prove the fixture.
`,
    );

    const first = await runSync(root);
    await writeFixture(root, "evidence/passage.txt", "second result\n");
    const second = await runSync(root);

    expect(first.inputs).toContain("evidence/passage.txt");
    expect(second.fingerprint).not.toBe(first.fingerprint);
    expect(await readFile(second.sitemapPath, "utf8")).toContain("asset:passage");
  });

  test("diagnoses an unsupported Passage Evidence filesystem shape", async () => {
    const root = await createValidBearingRepo();
    await mkdir(join(root, "evidence"), { recursive: true });
    const fifo = join(root, "evidence/passage.fifo");
    const created = Bun.spawn(["mkfifo", fifo]);
    expect(await created.exited).toBe(0);
    await writeFixture(
      root,
      ".bearing/state/assets.md",
      `---
Type: asset-registry
Assets:
  - ID: asset:passage
    Title: Passage Evidence
    Kind: verification-report
    Location: evidence/passage.fifo
    Owner: gate:test
    Producer:
      Kind: agent-surface
      Name: test
    Lifecycle source: native
---

# Asset Registry
`,
    );
    await writeFixture(
      root,
      ".bearing/state/milestone-gates/test.md",
      `---
Type: milestone-gate
ID: gate:test
Title: Test Gate
Roadmap: roadmap:test
Status: passed
Passage:
  Accepted decision: Pass the test Gate.
  Rationale: The evidence is sufficient.
  Evidence:
    - asset:passage
  Exceptions: []
---

# Milestone Gate: Test

## Intent

Reach the fixture boundary.

## Exit Criteria

- All fixture work resolves.
`,
    );

    const result = await runSync(root);

    expect(result.diagnostics).toContainEqual({
      code: "unsupported-input-shape",
      impact: "blocking",
      target: "evidence/passage.fifo",
      message: "Repository input has an unsupported filesystem shape.",
    });
    expect(result.inputs).not.toContain("evidence/passage.fifo");
  });
});
