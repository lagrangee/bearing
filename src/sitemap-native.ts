import type { CapturedNativeNode } from "./captured-native-work";
import type { SitemapLink, SitemapNode } from "./sitemap-model";

export { scopeFor, ticketNumber } from "./native-work";

export const sitemapNodeForNative = (
  captured: CapturedNativeNode,
  effortId: string | undefined,
): SitemapNode => {
  const { locator, native } = captured;
  if (native.kind === "map") {
    return {
      type: "Maps",
      reference: captured.reference,
      title: captured.title,
      state: native.status ?? "unknown",
      locator,
      scope: native.scope,
      links: effortId === undefined ? [] : [{ label: "effort", target: effortId }],
      annotations: [`fog-count=${native.fogCount}`],
      native,
    };
  }
  const links: SitemapLink[] =
    effortId === undefined ? [] : [{ label: "effort", target: effortId }];
  for (const target of native.blockerTargets ?? []) links.push({ label: "blocked-by", target });
  return {
    type: "Tickets",
    reference: captured.reference,
    title: captured.title,
    state: native.status ?? "unknown",
    locator,
    scope: native.scope,
    links,
    annotations: [],
    native,
  };
};
