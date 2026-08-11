import { expect, test } from "bun:test";
import { formatLabel } from "../src/format-label";

test("formats a short status label", () => {
  expect(formatLabel(" ready ")).toBe("ready");
});
