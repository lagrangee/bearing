import assert from "node:assert/strict";
import { test } from "node:test";
import { formatLabel } from "../src/format-label.ts";

test("formats a status label", () => {
  assert.equal(formatLabel(" ready "), "ready");
});
