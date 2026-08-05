import { expect, test } from "bun:test";
import {
  parseExactSections,
  parsePlainText,
  parseUnorderedList,
} from "../src/bearing-record-sections";

const summaryBody = `# Project Summary

## Purpose

让用户持续看见 whole picture。

## Current Design

Bearing owns project governance.
It does not own execution.

Second paragraph remains distinct.

## Boundaries

- Keep native work native.
- Keep Web read-oriented.

## Extra Context

This unrelated section is allowed.
`;

test("extracts only exact H2 sections and preserves authored paragraph boundaries", () => {
  const parsed = parseExactSections(summaryBody, ["Purpose", "Current Design", "Boundaries"]);
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) throw new Error("Expected exact sections.");
  expect(parsePlainText(parsed.sections["Purpose"] ?? "")).toBe("让用户持续看见 whole picture。");
  expect(parsePlainText(parsed.sections["Current Design"] ?? "")).toBe(
    "Bearing owns project governance. It does not own execution.\n\nSecond paragraph remains distinct.",
  );
  expect(parseUnorderedList(parsed.sections["Boundaries"] ?? "")).toEqual([
    "Keep native work native.",
    "Keep Web read-oriented.",
  ]);
});

test("accepts CRLF but rejects missing, near-match, and duplicate required headings", () => {
  expect(parseExactSections(summaryBody.replaceAll("\n", "\r\n"), ["Purpose"]).ok).toBe(true);
  expect(parseExactSections(summaryBody.replace("## Purpose", "## Goal"), ["Purpose"]).ok).toBe(
    false,
  );
  expect(parseExactSections(summaryBody.replace("## Purpose", "##  Purpose"), ["Purpose"]).ok).toBe(
    false,
  );
  expect(parseExactSections(`${summaryBody}\n## Purpose\n\nDuplicate.\n`, ["Purpose"]).ok).toBe(
    false,
  );
});

test("list and prose decoders reject mixed or structurally ambiguous content", () => {
  expect(parseUnorderedList("\n\n")).toEqual([]);
  expect(parseUnorderedList("- One\nparagraph\n- Two")).toBeUndefined();
  expect(parseUnorderedList("1. One\n2. Two")).toBeUndefined();
  expect(parseUnorderedList("- Repeated\n- Repeated")).toBeUndefined();
  expect(parsePlainText("## Nested\n\nText")).toBeUndefined();
  expect(parsePlainText("\n\n")).toBeUndefined();
});

test("plain-text decoders reject inline Markdown and HTML without rewriting it", () => {
  const markedUp = [
    "Use `cache`.",
    "Read [the source](https://example.test/source).",
    "Show **strong** emphasis.",
    "Prefix*strong* emphasis.",
    "Show _emphasis_.",
    "Show _emphasis_—then continue.",
    "Keep ~~old~~ wording.",
    "Render <strong>HTML</strong>.",
  ];
  for (const value of markedUp) {
    expect(parsePlainText(value)).toBeUndefined();
    expect(parseUnorderedList(`- ${value}`)).toBeUndefined();
  }
  expect(parsePlainText("Use bearing-* capabilities and /bearing paths as literal text.")).toBe(
    "Use bearing-* capabilities and /bearing paths as literal text.",
  );
  expect(parsePlainText("Use 2 * 3 * 4, A --> B, and foo__bar__baz identifiers.")).toBe(
    "Use 2 * 3 * 4, A --> B, and foo__bar__baz identifiers.",
  );
  expect(parsePlainText("See https://example.test/reference for context.")).toBe(
    "See https://example.test/reference for context.",
  );
  expect(parseUnorderedList("- See https://example.test/reference for context.")).toEqual([
    "See https://example.test/reference for context.",
  ]);
  expect(parsePlainText("Show \\*escaped emphasis*.")).toBeUndefined();
  expect(parseUnorderedList("- Show \\*escaped emphasis*.")).toBeUndefined();
});

test("plain-text decoders reject reference and block markup while preserving ordinary literals", () => {
  // Given: obvious Markdown block/reference forms that would otherwise enter normalized prose.
  const markedUp = [
    "Read [the source][source].",
    "[source]: https://example.test/source",
    "> Quoted guidance.",
    ">Quoted guidance.",
    ">",
    "#",
    "*",
    "+",
    "1.",
    "~~~ts\nconst state = true;\n~~~",
    "    const state = true;",
    "      const state = true;",
    "<!-- hidden guidance -->",
    "<!DOCTYPE html>",
    '<?xml version="1.0"?>',
    "<![CDATA[hidden]]>",
    "<div",
    "<script",
    '<div\nclass="note">',
    '<?xml\nversion="1.0"?>',
    "---",
    "* * *",
    "___",
    "Heading\n===",
    "Heading\n=",
    "Heading\n--",
    "| Name | State |\n| --- | --- |\n| Bearing | Active |",
    "Name | State\n- | -\nBearing | Active",
    "| State |\n| --- |\n| Active |",
  ];

  // When / Then: prose and list-item decoders reject markup rather than stripping it.
  for (const value of markedUp) {
    expect(parsePlainText(value)).toBeUndefined();
    expect(parseUnorderedList(`- ${value}`)).toBeUndefined();
  }

  expect(parsePlainText("读取 docs/project-summary_v2.md；继续使用 bearing-* 与 /bearing。")).toBe(
    "读取 docs/project-summary_v2.md；继续使用 bearing-* 与 /bearing。",
  );
});

test("plain-text prose rejects markup formed only after paragraph normalization", () => {
  // Given: line breaks hide inline delimiters in the authored source.
  const normalizedMarkup = [
    "**Split\nemphasis.**",
    "[Split\nlink](https://example.test/source)",
    "[Split\nreference][source]",
  ];

  // When / Then: the normalized value is checked again instead of emitting markup.
  for (const value of normalizedMarkup) {
    expect(parsePlainText(value)).toBeUndefined();
  }
});
