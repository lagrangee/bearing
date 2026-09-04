import assert from "node:assert/strict";
import { test } from "node:test";
import { formatPrimaryLabel } from "../src/format-label.ts";

test("formats the primary label", () => {
  assert.equal(formatPrimaryLabel(" active "), "ACTIVE");
});
