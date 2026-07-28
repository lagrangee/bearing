import type {
  Heading as MdastHeading,
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

type DocumentInternals = Readonly<{
  source: string;
  tree: Root;
}>;

type SectionInternals = Readonly<{
  document: MarkdownDocument;
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
  query: Readonly<{ title: string; depth?: MarkdownHeadingDepth }>,
): readonly Readonly<{ node: MdastHeading; value: MarkdownHeading; index: number }>[] =>
  internalsFor(document).tree.children.flatMap((node, index) => {
    if (node.type !== "heading") return [];
    const value = headingValue(node);
    if (value.title !== query.title || (query.depth !== undefined && value.depth !== query.depth)) {
      return [];
    }
    return [{ node, value, index }];
  });

const fieldFromParagraph = (paragraph: Paragraph, label: string): FieldCandidate | undefined => {
  const first = paragraph.children[0];
  if (first === undefined) return undefined;

  if (first.type === "strong") {
    const emphasized = mdastToString(first).trim();
    const carriesColon = emphasized.endsWith(":");
    const emphasizedLabel = carriesColon ? emphasized.slice(0, -1).trimEnd() : emphasized;
    if (emphasizedLabel !== label) return undefined;
    let remainder = mdastToString({
      type: "paragraph",
      children: paragraph.children.slice(1),
    }).trimStart();
    if (!carriesColon) {
      if (!remainder.startsWith(":")) return { state: "malformed" };
      remainder = remainder.slice(1).trimStart();
    }
    return remainder.length === 0 || remainder.startsWith(":")
      ? { state: "malformed" }
      : { state: "found", value: { label, value: remainder } };
  }

  if (first.type !== "text") return undefined;
  const prefix = `${label}:`;
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
  const tree: Root = {
    type: "root",
    children: [
      { type: "yaml", value: stringify(input.frontmatter).trimEnd() },
      ...bodyTree.children,
    ],
  };
  return toMarkdown(tree, {
    extensions: [gfmToMarkdown(), frontmatterToMarkdown(["yaml"])],
  });
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
  const contentStart = title.node.position?.end.offset;
  const contentEnd = tree.children[endIndex]?.position?.start.offset ?? source.length;
  const section: MarkdownSection = Object.freeze({
    heading: title.value,
    markdown:
      contentStart === undefined || contentEnd === undefined
        ? ""
        : source.slice(contentStart, contentEnd).trim(),
  });
  sectionInternals.set(section, { document, nodes });
  return found(section);
};

export const queryMarkdownSection = (
  document: MarkdownDocument,
  query: Readonly<{ title: string; depth?: MarkdownHeadingDepth }>,
): MarkdownQueryResult<MarkdownSection> => {
  const matches = matchingHeadings(document, query);
  if (matches.length === 0) return { state: "absent" };
  if (matches.length > 1)
    return { state: "ambiguous", reason: "duplicate", matches: matches.length };
  const match = matches[0];
  if (match === undefined) return { state: "absent" };

  const { source, tree } = internalsFor(document);
  const nextHeadingIndex = tree.children.findIndex(
    (node, index) =>
      index > match.index && node.type === "heading" && node.depth <= match.node.depth,
  );
  const endIndex = nextHeadingIndex === -1 ? tree.children.length : nextHeadingIndex;
  const nodes = tree.children.slice(match.index + 1, endIndex);
  const contentStart = match.node.position?.end.offset;
  const contentEnd = tree.children[endIndex]?.position?.start.offset ?? source.length;
  const markdown =
    contentStart === undefined || contentEnd === undefined
      ? ""
      : source.slice(contentStart, contentEnd).trim();
  const section: MarkdownSection = Object.freeze({
    heading: match.value,
    markdown,
  });
  sectionInternals.set(section, { document, nodes });
  return found(section);
};

export const queryMarkdownField = (
  document: MarkdownDocument,
  query: Readonly<{ label: string; within?: MarkdownSection }>,
): MarkdownQueryResult<MarkdownField> => {
  const candidates = nodesWithin(document, query.within).flatMap((node) => {
    if (node.type !== "paragraph") return [];
    const field = fieldFromParagraph(node, query.label);
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

export const queryMarkdownList = (
  document: MarkdownDocument,
  query: Readonly<{ within?: MarkdownSection; ordered?: boolean }> = {},
): MarkdownQueryResult<MarkdownList> =>
  resultFromCardinality(
    nodesWithin(document, query.within).flatMap((node) =>
      node.type === "list" && (query.ordered === undefined || node.ordered === query.ordered)
        ? [markdownList(node)]
        : [],
    ),
    "duplicate",
  );

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
