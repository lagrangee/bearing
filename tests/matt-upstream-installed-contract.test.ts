import { expect, test } from "bun:test";
import { readFile, rm, symlink } from "node:fs/promises";
import { join } from "node:path";
import { createValidBearingRepo, writeFixture } from "./helpers";
import { installPackedProduct } from "./product-seams/installed-product";

const scope = ".scratch/work";
const ticket = `${scope}/issues/01-finish.md`;
const sourceRoot = join(import.meta.dir, "fixtures/matt-upstream-contract");

test("installed CLI admits and reconciles current Matt Delivery without manufacturing a Spec", async () => {
  const root = await createValidBearingRepo();
  await rm(join(root, scope, "map.md"));
  await writeFixture(
    root,
    "docs/agents/issue-tracker.md",
    await readFile(join(sourceRoot, "issue-tracker-local.md"), "utf8"),
  );
  const source = (await readFile(join(sourceRoot, "local-ticket-template.md"), "utf8"))
    .replace("<NN>: <Ticket title>", "01: Preserve a conversation delivery")
    .replace(
      'the numbers/titles of the tickets that gate this one, or "None (can start immediately)".',
      "None (can start immediately)",
    );
  await writeFixture(root, ticket, source);
  const product = await installPackedProduct();
  try {
    const captured = await product.run(["provider", "capture", "--repo", root, "--scope", scope], {
      observeRoots: [root],
    });
    expect(captured.exitClass).toBe("success");
    expect(JSON.parse(captured.stdout).outcome).toBe("complete");
    expect(captured.effects.created.filter((path) => path.includes(".scratch/"))).toEqual([]);
    expect(captured.effects.changed.filter((path) => path.includes(".scratch/"))).toEqual([]);
    const admitted = await product.run(["inspect", "--native", ticket, "--repo", root]);
    expect(JSON.parse(admitted.stdout)).toMatchObject({
      outcome: "complete",
      result: {
        binding: { state: "bound", targetedReconciliationBasis: { state: "ready" } },
        coverage: { state: "available", assessment: "complete", completion: "incomplete" },
      },
    });

    await writeFixture(root, ticket, source.replace("ready-for-agent", "resolved"));
    const reconciled = await product.run([
      "reconcile-native",
      "--repo",
      root,
      "--scope",
      scope,
      "--ref",
      ticket,
    ]);
    expect(reconciled.exitClass).toBe("success");
    const current = await product.run(["inspect", "--native", ticket, "--repo", root]);
    expect(JSON.parse(current.stdout)).toMatchObject({
      outcome: "complete",
      result: {
        coverage: { state: "available", assessment: "complete", completion: "undetermined" },
      },
    });
    expect(await readFile(join(root, ticket), "utf8")).toBe(
      source.replace("ready-for-agent", "resolved"),
    );
  } finally {
    await product.dispose();
  }
}, 60_000);

test("installed read model preserves undeclared Matt document lifecycle across cache rebuild", async () => {
  const root = await createValidBearingRepo();
  await rm(join(root, ticket));
  await rm(join(root, "docs/agents/triage-labels.md"));
  await writeFixture(
    root,
    "docs/agents/issue-tracker.md",
    await readFile(join(sourceRoot, "issue-tracker-local.md"), "utf8"),
  );
  await writeFixture(
    root,
    `${scope}/map.md`,
    "## Destination\n\nRead native work.\n\n## Notes\n\n## Decisions so far\n\n## Not yet specified\n\n## Out of scope\n",
  );
  await writeFixture(
    root,
    `${scope}/spec.md`,
    "## Problem Statement\n\nRead native facts.\n\n## Solution\n\nPreserve source evidence.\n\n## User Stories\n\n1. As a user, I can read my work.\n\n## Implementation Decisions\n\nUse the Provider.\n\n## Testing Decisions\n\nRead back the result.\n\n## Out of Scope\n\nNative mutation.\n\n## Further Notes\n\n",
  );
  const product = await installPackedProduct();
  try {
    const captured = await product.run(["provider", "capture", "--repo", root, "--scope", scope]);
    expect(captured.exitClass).toBe("success");
    const rebuilt = await product.run(["cache", "rebuild", "--repo", root]);
    expect(rebuilt.exitClass).toBe("success");
    for (const subject of [`${scope}/map.md`, `${scope}/spec.md`]) {
      const inspected = await product.run(["inspect", "--native", subject, "--repo", root]);
      expect(JSON.parse(inspected.stdout)).toMatchObject({
        outcome: "complete",
        result: {
          binding: { state: "bound", targetedReconciliationBasis: { state: "ready" } },
          coverage: { state: "available", assessment: "complete", completion: "undetermined" },
        },
      });
    }
  } finally {
    await product.dispose();
  }
}, 60_000);

test("installed capture does not treat unsafe triage input as optional absence", async () => {
  const root = await createValidBearingRepo();
  const vocabulary = join(root, "docs/agents/triage-labels.md");
  await rm(vocabulary);
  await symlink(join(root, "docs/agents/issue-tracker.md"), vocabulary);
  const product = await installPackedProduct();
  try {
    const captured = await product.run(["provider", "capture", "--repo", root, "--scope", scope]);
    expect(captured.exitClass).toBe("product-outcome");
    expect(JSON.parse(captured.stdout).outcome).toBe("unfulfilled");
  } finally {
    await product.dispose();
  }
}, 60_000);
