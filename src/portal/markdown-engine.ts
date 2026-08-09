import { tasklist } from "@mdit/plugin-tasklist";
import MarkdownIt from "markdown-it";
import sanitizeHtml from "sanitize-html";
import type { ProviderSemanticSection } from "../provider-semantic-section";

export type HostRenderedMarkdown = Readonly<{
  html: string;
  presentation: "rendered" | "fallback";
}>;

type MarkdownEngineFailureHooks = Readonly<{
  render?: ((markdown: string) => string) | undefined;
  beforeSanitize?: ((html: string) => void) | undefined;
}>;

const escapeHtml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const safeAbsoluteHref = (value: string): boolean => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" || url.protocol === "mailto:";
  } catch {
    return false;
  }
};

const safeImageSourceHref = (value: string): boolean => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
};

const markdown = new MarkdownIt({
  breaks: false,
  html: false,
  linkify: false,
  typographer: false,
}).use(tasklist, { disabled: true, label: false });
markdown.enable("strikethrough");
markdown.validateLink = () => true;

markdown.renderer.rules.image = (tokens, index) => {
  const token = tokens[index];
  const source = token?.attrGet("src") ?? "";
  const alt = token?.content.trim() || "Image";
  return safeImageSourceHref(source)
    ? `<span class="markdown-image-reference">${escapeHtml(alt)} (<a href="${escapeHtml(source)}">image source</a>)</span>`
    : `<span class="markdown-image-reference">${escapeHtml(alt)}</span>`;
};

const sanitizerOptions: sanitizeHtml.IOptions = {
  allowedTags: [
    "a",
    "blockquote",
    "br",
    "code",
    "del",
    "em",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "input",
    "li",
    "ol",
    "p",
    "pre",
    "s",
    "span",
    "strong",
    "table",
    "tbody",
    "td",
    "th",
    "thead",
    "tr",
    "ul",
  ],
  allowedAttributes: {
    a: ["href", "rel", "target", "title"],
    input: ["type", "checked", "disabled", "class"],
    li: ["class"],
    ol: ["start"],
    span: ["class"],
    ul: ["class"],
  },
  allowedClasses: {
    input: ["task-list-item-checkbox"],
    li: ["task-list-item"],
    span: ["markdown-image-reference"],
    ul: ["task-list-container"],
  },
  allowedSchemes: ["http", "https", "mailto"],
  allowProtocolRelative: false,
  disallowedTagsMode: "discard",
  transformTags: {
    a: (tagName, attributes) =>
      attributes["href"] !== undefined && safeAbsoluteHref(attributes["href"])
        ? {
            tagName,
            attribs: {
              ...attributes,
              target: "_blank",
              rel: "noopener noreferrer",
            },
          }
        : { tagName: "span", attribs: {} },
    input: (_tagName, attributes) => ({
      tagName: "input",
      attribs: {
        type: "checkbox",
        disabled: "",
        ...(attributes["checked"] === undefined ? {} : { checked: "" }),
        class: "task-list-item-checkbox",
      },
    }),
  },
};

const fallback = (source: string): HostRenderedMarkdown => ({
  presentation: "fallback",
  html: `<div class="markdown-formatting-fallback"><p>Formatting is unavailable for this section.</p><pre>${escapeHtml(source)}</pre></div>`,
});

export const createMarkdownEngine = (
  hooks: MarkdownEngineFailureHooks = {},
): Readonly<{ renderFragment(markdownSource: string): HostRenderedMarkdown }> => ({
  renderFragment(markdownSource) {
    try {
      const rendered = (hooks.render ?? ((source) => markdown.render(source)))(markdownSource);
      hooks.beforeSanitize?.(rendered);
      const html = sanitizeHtml(rendered, sanitizerOptions);
      return { presentation: "rendered", html };
    } catch {
      return fallback(markdownSource);
    }
  },
});

export const sharedMarkdownEngine = createMarkdownEngine();

export const renderProviderMarkdownSections = (
  sections: readonly ProviderSemanticSection[],
): readonly Readonly<{
  markdown: string;
  html: string;
  presentation: "rendered" | "fallback";
}>[] => {
  const markdownSources = new Set(
    sections.flatMap((section) => (section.availability === "available" ? [section.markdown] : [])),
  );
  return [...markdownSources].map((markdownSource) => ({
    markdown: markdownSource,
    ...sharedMarkdownEngine.renderFragment(markdownSource),
  }));
};
