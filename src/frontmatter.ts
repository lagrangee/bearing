import {
  markdownDocumentBody,
  parseMarkdownDocument,
  queryMarkdownFrontmatter,
} from "./markdown-document";

export type FrontmatterResult =
  | Readonly<{
      ok: true;
      data: Readonly<Record<string, unknown>>;
      body: string;
    }>
  | Readonly<{ ok: false; reason: "missing" | "malformed" }>;

export const parseFrontmatter = (source: string): FrontmatterResult => {
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
