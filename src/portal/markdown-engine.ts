import { tasklist } from "@mdit/plugin-tasklist";
import MarkdownIt from "markdown-it";
import sanitizeHtml from "sanitize-html";
import type { ProviderSemanticSection } from "../provider-semantic-section";
import type { MattProviderSemanticDocument } from "../providers/matt-skills-v1/projection";
import type {
  LinkedContentPresentation,
  LinkedContentPreviewService,
} from "./linked-content-preview";

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

const safeLinkedPreviewHref = (value: string): boolean =>
  /^\/preview\/projects\/[^/]+\/linked\/[a-f0-9]{64}(?:\/content)?$/u.test(value);

type MarkdownRenderEnvironment = {
  linkedPresentations?: ReadonlyMap<string, LinkedContentPresentation> | undefined;
  linkedOpenStack?: (LinkedContentPresentation | undefined)[] | undefined;
};

const linkedPresentationKey = (usage: "image" | "link", href: string): string =>
  `${usage}\0${href}`;

const markdown = new MarkdownIt({
  breaks: false,
  html: false,
  linkify: false,
  typographer: false,
}).use(tasklist, { disabled: true, label: false });
markdown.enable("strikethrough");
markdown.validateLink = () => true;
markdown.core.ruler.after("task_list", "accessible_task_list", (state) => {
  for (const token of state.tokens) {
    if (token.type !== "inline") continue;
    const checkbox = token.children?.find((child) => child.type === "checkbox_input");
    if (checkbox === undefined) continue;
    checkbox.attrSet("aria-label", token.content.slice(3).trim() || "Task list item");
  }
});

markdown.renderer.rules.image = (tokens, index, _options, environment) => {
  const token = tokens[index];
  const source = token?.attrGet("src") ?? "";
  const alt = token?.content.trim() || "Image";
  const linked = (environment as MarkdownRenderEnvironment | undefined)?.linkedPresentations?.get(
    linkedPresentationKey("image", source),
  );
  if (linked?.kind === "available" && linked.thumbnailSrc !== undefined) {
    return `<a class="markdown-linked-image" href="${escapeHtml(linked.previewHref)}" target="_blank" rel="noopener noreferrer"><img class="markdown-linked-image-thumbnail" src="${escapeHtml(linked.thumbnailSrc)}" alt="${escapeHtml(alt)}" loading="lazy"></a>`;
  }
  if (linked?.kind === "unavailable") {
    return `<span class="markdown-linked-content-unavailable">${escapeHtml(alt)} — Preview unavailable: ${escapeHtml(linked.message)}</span>`;
  }
  return safeImageSourceHref(source)
    ? `<span class="markdown-image-reference">${escapeHtml(alt)} (<a href="${escapeHtml(source)}">image source</a>)</span>`
    : `<span class="markdown-image-reference">${escapeHtml(alt)}</span>`;
};

markdown.renderer.rules["link_open"] = (tokens, index, options, environment, renderer) => {
  const source = tokens[index]?.attrGet("href") ?? "";
  const env = (environment ?? {}) as MarkdownRenderEnvironment;
  const linked = env.linkedPresentations?.get(linkedPresentationKey("link", source));
  if (env.linkedOpenStack === undefined) env.linkedOpenStack = [];
  env.linkedOpenStack.push(linked);
  if (linked?.kind === "available") {
    return `<a class="markdown-linked-content" href="${escapeHtml(linked.previewHref)}" target="_blank" rel="noopener noreferrer">`;
  }
  if (linked?.kind === "unavailable") {
    return '<span class="markdown-linked-content-unavailable">';
  }
  return renderer.renderToken(tokens, index, options);
};

markdown.renderer.rules["link_close"] = (tokens, index, options, environment, renderer) => {
  const linked = (environment as MarkdownRenderEnvironment | undefined)?.linkedOpenStack?.pop();
  if (linked?.kind === "available") return "</a>";
  if (linked?.kind === "unavailable") {
    return ` — Preview unavailable: ${escapeHtml(linked.message)}</span>`;
  }
  return renderer.renderToken(tokens, index, options);
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
    "img",
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
    a: ["class", "href", "rel", "target", "title"],
    img: ["alt", "class", "loading", "src"],
    input: ["type", "checked", "disabled", "class", "aria-label"],
    li: ["class"],
    ol: ["start"],
    span: ["class"],
    ul: ["class"],
  },
  allowedClasses: {
    a: ["markdown-linked-content", "markdown-linked-image"],
    img: ["markdown-linked-image-thumbnail"],
    input: ["task-list-item-checkbox"],
    li: ["task-list-item"],
    span: ["markdown-image-reference", "markdown-linked-content-unavailable"],
    ul: ["task-list-container"],
  },
  allowedSchemes: ["http", "https", "mailto"],
  allowProtocolRelative: false,
  disallowedTagsMode: "discard",
  transformTags: {
    a: (tagName, attributes) =>
      attributes["href"] !== undefined &&
      (safeAbsoluteHref(attributes["href"]) || safeLinkedPreviewHref(attributes["href"]))
        ? {
            tagName,
            attribs: {
              ...attributes,
              target: "_blank",
              rel: "noopener noreferrer",
            },
          }
        : { tagName: "span", attribs: {} },
    img: (_tagName, attributes) =>
      attributes["src"] !== undefined && safeLinkedPreviewHref(attributes["src"])
        ? {
            tagName: "img",
            attribs: {
              ...attributes,
              loading: "lazy",
            },
          }
        : { tagName: "span", attribs: { class: "markdown-image-reference" } },
    input: (_tagName, attributes) => ({
      tagName: "input",
      attribs: {
        type: "checkbox",
        disabled: "",
        ...(attributes["checked"] === undefined ? {} : { checked: "" }),
        ...(attributes["aria-label"] === undefined
          ? {}
          : { "aria-label": attributes["aria-label"] }),
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
): Readonly<{
  renderFragment(
    markdownSource: string,
    environment?: MarkdownRenderEnvironment,
  ): HostRenderedMarkdown;
}> => ({
  renderFragment(markdownSource, environment = {}) {
    try {
      const rendered = (hooks.render ?? ((source) => markdown.render(source, environment)))(
        markdownSource,
      );
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

const linkedTargets = (
  markdownSource: string,
): readonly Readonly<{ usage: "image" | "link"; href: string }>[] => {
  const targets = new Map<string, Readonly<{ usage: "image" | "link"; href: string }>>();
  for (const token of markdown.parse(markdownSource, {})) {
    for (const child of token.children ?? []) {
      const usage =
        child.type === "image" ? "image" : child.type === "link_open" ? "link" : undefined;
      const href = child.attrGet(usage === "image" ? "src" : "href") ?? "";
      if (usage === undefined || href.length === 0 || safeAbsoluteHref(href)) continue;
      targets.set(linkedPresentationKey(usage, href), { usage, href });
    }
  }
  return [...targets.values()];
};

export const renderProviderMarkdownDocuments = async (
  entryId: string,
  documents: readonly MattProviderSemanticDocument[],
  linkedContent: LinkedContentPreviewService,
): Promise<
  readonly Readonly<{
    sourceLocator?: string | undefined;
    markdown: string;
    html: string;
    presentation: "rendered" | "fallback";
  }>[]
> => {
  const rendered = [];
  const seen = new Set<string>();
  for (const document of documents) {
    for (const section of document.sections) {
      if (section.availability !== "available") continue;
      const key = `${document.sourceLocator ?? ""}\0${section.sourceIdentity}\0${section.markdown}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const linkedPresentations = new Map<string, LinkedContentPresentation>();
      if (document.sourceLocator !== undefined) {
        for (const target of linkedTargets(section.markdown)) {
          linkedPresentations.set(
            linkedPresentationKey(target.usage, target.href),
            await linkedContent.present({
              entryId,
              sourceLocator: document.sourceLocator,
              authoredHref: target.href,
              usage: target.usage,
            }),
          );
        }
      }
      rendered.push({
        ...(document.sourceLocator === undefined ? {} : { sourceLocator: document.sourceLocator }),
        markdown: section.markdown,
        ...sharedMarkdownEngine.renderFragment(section.markdown, { linkedPresentations }),
      });
    }
  }
  return rendered;
};
