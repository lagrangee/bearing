import type {
  Heading as MdastHeading,
  InlineCode as MdastInlineCode,
  Link as MdastLink,
  List as MdastList,
  Table as MdastTable,
  Paragraph,
  Root,
  RootContent,
} from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { frontmatterFromMarkdown, frontmatterToMarkdown } from "mdast-util-frontmatter";
import { gfmFromMarkdown, gfmToMarkdown } from "mdast-util-gfm";
import { toMarkdown } from "mdast-util-to-markdown";
import { toString as mdastToString } from "mdast-util-to-string";
import { frontmatter } from "micromark-extension-frontmatter";
import { gfm } from "micromark-extension-gfm";
import { visit } from "unist-util-visit";
import { parseDocument, stringify } from "yaml";
import { isSemanticPlainText } from "./markdown-document/semantic-plain-text.ts";

export { isSemanticPlainText } from "./markdown-document/semantic-plain-text.ts";

export type MarkdownDocument = Readonly<{
  kind: "markdown-document";
}>;

export type MarkdownHeadingDepth = 1 | 2 | 3 | 4 | 5 | 6;

export type MarkdownHeading = Readonly<{
  depth: MarkdownHeadingDepth;
  title: string;
}>;

export type MarkdownSection = Readonly<{
  heading: MarkdownHeading;
  markdown: string;
}>;

export type MarkdownField = Readonly<{
  label: string;
  value: string;
}>;

export type MarkdownListItem = Readonly<{
  text: string;
  checked?: boolean;
  links?: readonly MarkdownLink[];
}>;

export type MarkdownList = Readonly<{
  ordered: boolean;
  start?: number;
  items: readonly MarkdownListItem[];
}>;

export type MarkdownLink = Readonly<{
  label: string;
  target: string;
  title?: string;
}>;

export type MarkdownTable = Readonly<{
  columns: readonly string[];
  rows: readonly (readonly string[])[];
}>;

export type MarkdownQueryResult<Value> =
  | Readonly<{ state: "found"; value: Value }>
  | Readonly<{ state: "absent" }>
  | Readonly<{
      state: "ambiguous";
      reason: "conflict" | "duplicate" | "malformed";
      matches: number;
    }>;

export type MarkdownEnvelopeResult =
  | Readonly<{
      ok: true;
      data: Readonly<Record<string, unknown>>;
      body: string;
    }>
  | Readonly<{ ok: false; reason: "missing" | "malformed" }>;

type DocumentInternals = Readonly<{
  source: string;
  tree: Root;
}>;

type SectionInternals = Readonly<{
  document: MarkdownDocument;
  heading: MdastHeading;
  nodes: readonly RootContent[];
}>;

type FieldCandidate =
  | Readonly<{ state: "found"; value: MarkdownField }>
  | Readonly<{ state: "malformed" }>;

const documentInternals = new WeakMap<MarkdownDocument, DocumentInternals>();
const sectionInternals = new WeakMap<MarkdownSection, SectionInternals>();

const internalsFor = (document: MarkdownDocument): DocumentInternals => {
  const internals = documentInternals.get(document);
  if (internals === undefined) {
    throw new TypeError("Markdown document queries require a document from parseMarkdownDocument.");
  }
  return internals;
};

const nodesWithin = (
  document: MarkdownDocument,
  within?: MarkdownSection,
): readonly RootContent[] => {
  if (within === undefined) return internalsFor(document).tree.children;
  const internals = sectionInternals.get(within);
  if (internals?.document !== document) {
    throw new TypeError("Markdown section queries require a section from the same document.");
  }
  return internals.nodes;
};

const markdownForNodes = (source: string, nodes: readonly RootContent[]): string => {
  const start = nodes[0]?.position?.start.offset;
  const end = nodes.at(-1)?.position?.end.offset;
  return start === undefined || end === undefined ? "" : source.slice(start, end);
};

const found = <Value>(value: Value): MarkdownQueryResult<Value> => ({
  state: "found",
  value,
});

const resultFromCardinality = <Value>(
  values: readonly Value[],
  reason: "conflict" | "duplicate",
): MarkdownQueryResult<Value> => {
  if (values.length === 0) return { state: "absent" };
  if (values.length > 1) return { state: "ambiguous", reason, matches: values.length };
  return found(values[0] as Value);
};

const headingValue = (heading: MdastHeading): MarkdownHeading =>
  Object.freeze({
    depth: heading.depth,
    title: mdastToString(heading).trim(),
  });

const matchingHeadings = (
  document: MarkdownDocument,
  query: Readonly<{
    title: string;
    depth?: MarkdownHeadingDepth;
    within?: MarkdownSection;
  }>,
): readonly Readonly<{
  node: MdastHeading;
  value: MarkdownHeading;
  index: number;
  scopeNodes: readonly RootContent[];
}>[] => {
  const scopeNodes = nodesWithin(document, query.within);
  return scopeNodes.flatMap((node, index) => {
    if (node.type !== "heading") return [];
    const value = headingValue(node);
    if (value.title !== query.title || (query.depth !== undefined && value.depth !== query.depth)) {
      return [];
    }
    return [{ node, value, index, scopeNodes }];
  });
};

const fieldFromParagraph = (
  paragraph: Paragraph,
  label: string,
  separator: "colon" | "space",
): FieldCandidate | undefined => {
  const first = paragraph.children[0];
  if (first === undefined) return undefined;

  if (first.type === "strong") {
    const emphasized = mdastToString(first).trim();
    const inlinePrefix = separator === "colon" ? `${label}:` : `${label} `;
    if (paragraph.children.length === 1 && emphasized.startsWith(inlinePrefix)) {
      const value = emphasized.slice(inlinePrefix.length).trim();
      return value.length === 0 || value.startsWith(":")
        ? { state: "malformed" }
        : { state: "found", value: { label, value } };
    }
    const carriesColon = separator === "colon" && emphasized.endsWith(":");
    const emphasizedLabel = carriesColon ? emphasized.slice(0, -1).trimEnd() : emphasized;
    if (emphasizedLabel !== label) return undefined;
    const remainderText = mdastToString({
      type: "paragraph",
      children: paragraph.children.slice(1),
    });
    let remainder = remainderText.trimStart();
    if (!carriesColon) {
      if (separator === "space") {
        const hasSourceWhitespace = remainderText.length > remainderText.trimStart().length;
        if (!hasSourceWhitespace) return { state: "malformed" };
        remainder = remainderText.trim();
      } else {
        if (!remainder.startsWith(":")) return { state: "malformed" };
        remainder = remainder.slice(1).trimStart();
      }
    }
    return remainder.length === 0 || remainder.startsWith(":")
      ? { state: "malformed" }
      : { state: "found", value: { label, value: remainder } };
  }

  if (first.type !== "text") return undefined;
  const prefix = separator === "colon" ? `${label}:` : `${label} `;
  if (!first.value.startsWith(prefix)) return undefined;
  const paragraphText = mdastToString(paragraph);
  const value = paragraphText.slice(prefix.length).trim();
  if (value.length === 0 || value.startsWith(":")) return { state: "malformed" };
  return { state: "found", value: { label, value } };
};

const markdownLink = (link: MdastLink): MarkdownLink =>
  Object.freeze({
    label: mdastToString(link),
    target: link.url,
    ...(link.title === null || link.title === undefined ? {} : { title: link.title }),
  });

const markdownList = (list: MdastList): MarkdownList => {
  const items = list.children.map((item) => {
    const checked = item.checked;
    const links: MarkdownLink[] = [];
    visit(item, "link", (link: MdastLink) => {
      links.push(markdownLink(link));
    });
    return Object.freeze({
      text: mdastToString(item).trim(),
      ...(checked === null || checked === undefined ? {} : { checked }),
      ...(links.length === 0 ? {} : { links: Object.freeze(links) }),
    });
  });
  return Object.freeze({
    ordered: list.ordered === true,
    ...(list.ordered === true && list.start !== null && list.start !== undefined
      ? { start: list.start }
      : {}),
    items: Object.freeze(items),
  });
};

const markdownTable = (table: MdastTable): MarkdownTable => {
  const cells = table.children.map((row) =>
    Object.freeze(row.children.map((cell) => mdastToString(cell).trim())),
  );
  return Object.freeze({
    columns: cells[0] ?? Object.freeze([]),
    rows: Object.freeze(cells.slice(1)),
  });
};

export const parseMarkdownDocument = (source: string): MarkdownDocument => {
  const tree = fromMarkdown(source, {
    extensions: [gfm(), frontmatter(["yaml"])],
    mdastExtensions: [gfmFromMarkdown(), frontmatterFromMarkdown(["yaml"])],
  });
  const document: MarkdownDocument = Object.freeze({ kind: "markdown-document" });
  documentInternals.set(document, { source, tree });
  return document;
};

export const parseMarkdownEnvelope = (source: string): MarkdownEnvelopeResult => {
  const document = parseMarkdownDocument(source);
  const frontmatter = queryMarkdownFrontmatter(document);
  if (frontmatter.state === "absent") return { ok: false, reason: "missing" };
  if (frontmatter.state === "ambiguous") return { ok: false, reason: "malformed" };
  return {
    ok: true,
    data: frontmatter.value,
    body: markdownDocumentBody(document),
  };
};

export const markdownDocumentBody = (document: MarkdownDocument): string => {
  const { source, tree } = internalsFor(document);
  const envelope = tree.children[0];
  if (envelope?.type !== "yaml" || envelope.position?.end.offset === undefined) return source;
  let start = envelope.position.end.offset;
  if (source.startsWith("\r\n", start)) start += 2;
  else if (source.startsWith("\n", start) || source.startsWith("\r", start)) start += 1;
  return source.slice(start);
};

export const serializeMarkdownDocument = (input: {
  readonly frontmatter: Readonly<Record<string, unknown>>;
  readonly body: string;
}): string => {
  const bodyDocument = parseMarkdownDocument(input.body);
  const bodyTree = internalsFor(bodyDocument).tree;
  if (bodyTree.children.some((node) => node.type === "yaml")) {
    throw new TypeError(
      "Markdown serialization body must not contain another frontmatter envelope.",
    );
  }
  const envelope: Root = {
    type: "root",
    children: [{ type: "yaml", value: stringify(input.frontmatter, { lineWidth: 0 }).trimEnd() }],
  };
  const serializedEnvelope = toMarkdown(envelope, {
    extensions: [gfmToMarkdown(), frontmatterToMarkdown(["yaml"])],
  });
  return `${serializedEnvelope}${input.body}`;
};

export const queryMarkdownFrontmatter = (
  document: MarkdownDocument,
): MarkdownQueryResult<Readonly<Record<string, unknown>>> => {
  const yamlNodes = internalsFor(document).tree.children.filter((node) => node.type === "yaml");
  if (yamlNodes.length === 0) return { state: "absent" };
  if (yamlNodes.length > 1) {
    return { state: "ambiguous", reason: "duplicate", matches: yamlNodes.length };
  }
  const yamlNode = yamlNodes[0];
  if (yamlNode === undefined || yamlNode.type !== "yaml") return { state: "absent" };
  const parsed = parseDocument(yamlNode.value, { uniqueKeys: true });
  if (parsed.errors.length > 0) {
    return {
      state: "ambiguous",
      reason: parsed.errors.some((error) => error.code === "DUPLICATE_KEY")
        ? "conflict"
        : "malformed",
      matches: 1,
    };
  }
  const value: unknown = parsed.toJS();
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { state: "ambiguous", reason: "malformed", matches: 1 };
  }
  return found(Object.freeze(value as Record<string, unknown>));
};

export const queryMarkdownHeading = (
  document: MarkdownDocument,
  query: Readonly<{ title: string; depth?: MarkdownHeadingDepth }>,
): MarkdownQueryResult<MarkdownHeading> =>
  resultFromCardinality(
    matchingHeadings(document, query).map((match) => match.value),
    "duplicate",
  );

export const queryMarkdownDocumentTitle = (
  document: MarkdownDocument,
): MarkdownQueryResult<MarkdownHeading> =>
  resultFromCardinality(
    internalsFor(document).tree.children.flatMap((node) =>
      node.type === "heading" && node.depth === 1 ? [headingValue(node)] : [],
    ),
    "conflict",
  );

export const queryMarkdownPreamble = (
  document: MarkdownDocument,
): MarkdownQueryResult<MarkdownSection> => {
  const titleMatches = internalsFor(document).tree.children.flatMap((node, index) =>
    node.type === "heading" && node.depth === 1 ? [{ node, value: headingValue(node), index }] : [],
  );
  if (titleMatches.length === 0) return { state: "absent" };
  if (titleMatches.length > 1) {
    return { state: "ambiguous", reason: "conflict", matches: titleMatches.length };
  }
  const title = titleMatches[0];
  if (title === undefined) return { state: "absent" };
  const { source, tree } = internalsFor(document);
  const nextHeadingIndex = tree.children.findIndex(
    (node, index) => index > title.index && node.type === "heading",
  );
  const endIndex = nextHeadingIndex === -1 ? tree.children.length : nextHeadingIndex;
  const nodes = tree.children.slice(title.index + 1, endIndex);
  const section: MarkdownSection = Object.freeze({
    heading: title.value,
    markdown: markdownForNodes(source, nodes),
  });
  sectionInternals.set(section, { document, heading: title.node, nodes });
  return found(section);
};

const sectionFromMatch = (
  document: MarkdownDocument,
  match: Readonly<{
    node: MdastHeading;
    value: MarkdownHeading;
    index: number;
    scopeNodes: readonly RootContent[];
  }>,
): MarkdownSection => {
  const { source } = internalsFor(document);
  const nextHeadingIndex = match.scopeNodes.findIndex(
    (node, index) =>
      index > match.index && node.type === "heading" && node.depth <= match.node.depth,
  );
  const endIndex = nextHeadingIndex === -1 ? match.scopeNodes.length : nextHeadingIndex;
  const nodes = match.scopeNodes.slice(match.index + 1, endIndex);
  const section: MarkdownSection = Object.freeze({
    heading: match.value,
    markdown: markdownForNodes(source, nodes),
  });
  sectionInternals.set(section, { document, heading: match.node, nodes });
  return section;
};

export const queryMarkdownSection = (
  document: MarkdownDocument,
  query: Readonly<{
    title: string;
    depth?: MarkdownHeadingDepth;
    within?: MarkdownSection;
  }>,
): MarkdownQueryResult<MarkdownSection> => {
  const matches = matchingHeadings(document, query);
  if (matches.length === 0) return { state: "absent" };
  if (matches.length > 1)
    return { state: "ambiguous", reason: "duplicate", matches: matches.length };
  const match = matches[0];
  return match === undefined ? { state: "absent" } : found(sectionFromMatch(document, match));
};

export const queryMarkdownSections = (
  document: MarkdownDocument,
  query: Readonly<{ depth?: MarkdownHeadingDepth; within?: MarkdownSection }> = {},
): readonly MarkdownSection[] => {
  const scopeNodes = nodesWithin(document, query.within);
  return Object.freeze(
    scopeNodes.flatMap((node, index) => {
      if (node.type !== "heading" || (query.depth !== undefined && node.depth !== query.depth)) {
        return [];
      }
      return [sectionFromMatch(document, { node, value: headingValue(node), index, scopeNodes })];
    }),
  );
};

export const markdownCanonicalHeadingTitle = (
  document: MarkdownDocument,
  section: MarkdownSection,
): string | undefined => {
  const internals = sectionInternals.get(section);
  if (internals?.document !== document) {
    throw new TypeError("Markdown heading queries require a section from the same document.");
  }
  const { source } = internalsFor(document);
  const { heading } = internals;
  const start = heading.position?.start.offset;
  const end = heading.position?.end.offset;
  if (start === undefined || end === undefined) {
    return undefined;
  }
  const authored = source.slice(start, end);
  const prefix = `${"#".repeat(heading.depth)} `;
  if (!authored.startsWith(prefix)) return undefined;
  const title = authored.slice(prefix.length);
  return title.length > 0 && isSemanticPlainText(title) ? title : undefined;
};

export const markdownSectionLead = (
  document: MarkdownDocument,
  section: MarkdownSection,
): string => {
  const internals = sectionInternals.get(section);
  if (internals?.document !== document) {
    throw new TypeError("Markdown section queries require a section from the same document.");
  }
  const firstHeading = internals.nodes.find((node) => node.type === "heading");
  const { source } = internalsFor(document);
  const start = internals.heading.position?.end.offset;
  const end = firstHeading?.position?.start.offset ?? internals.nodes.at(-1)?.position?.end.offset;
  if (start === undefined || end === undefined) return "";
  return source
    .slice(start, end)
    .replace(/^(?:[ \t]*(?:\r\n|\n|\r))+/u, "")
    .trimEnd();
};

export const markdownSemanticPlainText = (source: string): string =>
  internalsFor(parseMarkdownDocument(source))
    .tree.children.flatMap((node) =>
      node.type === "list"
        ? node.children.map((item) => mdastToString(item, { includeHtml: false }).trim())
        : [mdastToString(node, { includeHtml: false }).trim()],
    )
    .filter((value) => value.length > 0)
    .join("\n");

const normalizedPlainParagraph = (source: string, paragraph: Paragraph): string | undefined => {
  const start = paragraph.position?.start.offset;
  const end = paragraph.position?.end.offset;
  if (start === undefined || end === undefined) return undefined;
  const authored = source.slice(start, end);
  if (!isSemanticPlainText(authored)) return undefined;
  const value = authored
    .split("\n")
    .map((line) => line.trim())
    .join(" ")
    .trim();
  return value.length === 0 ? undefined : value;
};

export const markdownPlainText = (source: string): string | undefined => {
  const tree = internalsFor(parseMarkdownDocument(source)).tree;
  if (tree.children.length === 0 || tree.children.some((node) => node.type !== "paragraph")) {
    return undefined;
  }
  const paragraphs = tree.children.map((node) =>
    node.type === "paragraph" ? normalizedPlainParagraph(source, node) : undefined,
  );
  if (paragraphs.some((paragraph) => paragraph === undefined)) return undefined;
  const value = (paragraphs as string[]).join("\n\n");
  return isSemanticPlainText(value) ? value : undefined;
};

export const markdownPlainUnorderedList = (source: string): readonly string[] | undefined => {
  if (source.trim().length === 0) return [];
  const tree = internalsFor(parseMarkdownDocument(source)).tree;
  if (tree.children.length !== 1 || tree.children[0]?.type !== "list") return undefined;
  const list = tree.children[0];
  if (list.ordered === true) return undefined;
  const items = list.children.map((item) => {
    if (
      (item.checked !== null && item.checked !== undefined) ||
      item.children.length !== 1 ||
      item.children[0]?.type !== "paragraph"
    ) {
      return undefined;
    }
    if (mdastToString(item.children[0]).includes("\n")) return undefined;
    return normalizedPlainParagraph(source, item.children[0]);
  });
  return items.some((item) => item === undefined) ? undefined : Object.freeze(items as string[]);
};

export const markdownInlineCodeUnorderedList = (source: string): readonly string[] | undefined => {
  const tree = internalsFor(parseMarkdownDocument(source)).tree;
  if (tree.children.length !== 1 || tree.children[0]?.type !== "list") return undefined;
  const list = tree.children[0];
  if (list.ordered === true) return undefined;
  const items = list.children.map((item) => {
    if (
      (item.checked !== null && item.checked !== undefined) ||
      item.children.length !== 1 ||
      item.children[0]?.type !== "paragraph" ||
      item.children[0].children.length !== 1 ||
      item.children[0].children[0]?.type !== "inlineCode"
    ) {
      return undefined;
    }
    return item.children[0].children[0].value;
  });
  return items.some((item) => item === undefined) ? undefined : Object.freeze(items as string[]);
};

export const queryMarkdownField = (
  document: MarkdownDocument,
  query: Readonly<{
    label: string;
    within?: MarkdownSection;
    separator?: "colon" | "space";
  }>,
): MarkdownQueryResult<MarkdownField> => {
  const candidates = nodesWithin(document, query.within).flatMap((node) => {
    if (node.type !== "paragraph") return [];
    const field = fieldFromParagraph(node, query.label, query.separator ?? "colon");
    return field === undefined ? [] : [field];
  });
  const malformed = candidates.filter((candidate) => candidate.state === "malformed");
  const values = candidates.flatMap((candidate) =>
    candidate.state === "found" ? [Object.freeze(candidate.value)] : [],
  );
  if (malformed.length > 0) {
    return {
      state: "ambiguous",
      reason: values.length > 0 ? "conflict" : "malformed",
      matches: candidates.length,
    };
  }
  return resultFromCardinality(values, "conflict");
};

export const markdownNarrative = (
  document: MarkdownDocument,
  query: Readonly<{
    within?: MarkdownSection;
    excludeFields?: readonly string[];
  }> = {},
): string => {
  const { source } = internalsFor(document);
  const excluded = query.excludeFields ?? [];
  const retained = nodesWithin(document, query.within).flatMap((node, index) => {
    if (
      node.type === "paragraph" &&
      excluded.some((label) => fieldFromParagraph(node, label, "colon") !== undefined)
    ) {
      return [];
    }
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    return start === undefined || end === undefined ? [] : [{ index, start, end }];
  });
  const groups: { firstIndex: number; lastIndex: number; start: number; end: number }[] = [];
  for (const node of retained) {
    const current = groups.at(-1);
    if (current !== undefined && node.index === current.lastIndex + 1) {
      current.lastIndex = node.index;
      current.end = node.end;
    } else {
      groups.push({
        firstIndex: node.index,
        lastIndex: node.index,
        start: node.start,
        end: node.end,
      });
    }
  }
  return groups.map((group) => source.slice(group.start, group.end)).join("\n\n");
};

const markdownListsWithin = (
  document: MarkdownDocument,
  query: Readonly<{ within?: MarkdownSection; ordered?: boolean }>,
): readonly MarkdownList[] =>
  Object.freeze(
    nodesWithin(document, query.within).flatMap((node) =>
      node.type === "list" && (query.ordered === undefined || node.ordered === query.ordered)
        ? [markdownList(node)]
        : [],
    ),
  );

export const queryMarkdownList = (
  document: MarkdownDocument,
  query: Readonly<{ within?: MarkdownSection; ordered?: boolean }> = {},
): MarkdownQueryResult<MarkdownList> =>
  resultFromCardinality(markdownListsWithin(document, query), "duplicate");

export const queryMarkdownLists = (
  document: MarkdownDocument,
  query: Readonly<{ within?: MarkdownSection; ordered?: boolean }> = {},
): readonly MarkdownList[] => markdownListsWithin(document, query);

export const queryMarkdownLinks = (
  document: MarkdownDocument,
  query: Readonly<{ within?: MarkdownSection }> = {},
): readonly MarkdownLink[] => {
  const links: MarkdownLink[] = [];
  for (const node of nodesWithin(document, query.within)) {
    visit(node, "link", (link: MdastLink) => {
      links.push(markdownLink(link));
    });
  }
  return Object.freeze(links);
};

export const queryMarkdownInlineCodes = (
  document: MarkdownDocument,
  query: Readonly<{ within?: MarkdownSection }> = {},
): readonly string[] => {
  const values: string[] = [];
  for (const node of nodesWithin(document, query.within)) {
    visit(node, "inlineCode", (inlineCode: MdastInlineCode) => {
      values.push(inlineCode.value);
    });
  }
  return Object.freeze(values);
};

export const queryMarkdownTable = (
  document: MarkdownDocument,
  query: Readonly<{ within?: MarkdownSection }> = {},
): MarkdownQueryResult<MarkdownTable> =>
  resultFromCardinality(
    nodesWithin(document, query.within).flatMap((node) =>
      node.type === "table" ? [markdownTable(node)] : [],
    ),
    "duplicate",
  );
