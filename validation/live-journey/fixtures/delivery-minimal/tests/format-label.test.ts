import { expect, test } from "bun:test";
import { formatPrimaryLabel } from "../src/format-label";

test("formats the primary label", () => {
  expect(formatPrimaryLabel(" active ")).toBe("ACTIVE");
});
