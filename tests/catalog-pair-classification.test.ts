import { expect, test } from "bun:test";
import { classifyCatalogPair } from "../src/catalog/pair-classification";

const document = { version: 1 as const, entries: [] };

test("classifies every Catalog current and backup pair once", () => {
  expect(classifyCatalogPair({ kind: "available", document }, { kind: "uninspected" })).toEqual({
    kind: "current",
    document,
  });
  expect(classifyCatalogPair({ kind: "missing" }, { kind: "missing" })).toEqual({
    kind: "empty",
  });
  expect(classifyCatalogPair({ kind: "missing" }, { kind: "available", document })).toEqual({
    kind: "backup",
    document,
  });
  expect(classifyCatalogPair({ kind: "invalid" }, { kind: "available", document })).toEqual({
    kind: "backup",
    document,
  });
  expect(classifyCatalogPair({ kind: "invalid" }, { kind: "uninspected" })).toEqual({
    kind: "unusable",
  });
  expect(classifyCatalogPair({ kind: "missing" }, { kind: "invalid" })).toEqual({
    kind: "unusable",
  });
});
