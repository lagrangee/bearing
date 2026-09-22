import assert from "node:assert/strict";
import { test } from "node:test";
import { formatPrimaryLabel, formatSecondaryLabel } from "../src/format-label.ts";

test("formats the primary label", () => {
  assert.equal(formatPrimaryLabel(" active "), "ACTIVE");
});

test("formats the secondary label", () => {
  assert.equal(formatSecondaryLabel(" PaUsEd "), "paused");
});
