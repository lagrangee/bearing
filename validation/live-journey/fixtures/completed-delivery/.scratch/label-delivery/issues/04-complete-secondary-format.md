# 04 — Complete secondary label formatting

**What to build:** Add the exported `formatSecondaryLabel` function. It trims surrounding whitespace and lowercases the result.

**Blocked by:** None — can start immediately

**Status:** resolved

- [x] Primary labels are trimmed and uppercased.
- [x] The exported secondary formatter is covered by one focused test.
- [x] `npm test` passes.

## Answer

The exported formatSecondaryLabel trims surrounding whitespace and lowercases the result, alongside the preserved primary formatter. The focused exported-function tests cover both outputs in tests/format-label.test.ts. `npm test` passes both tests on this fixed completed source.
