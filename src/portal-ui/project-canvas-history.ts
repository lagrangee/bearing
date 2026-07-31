import { type AssetEvidenceFilter, isAssetEvidenceFilter } from "./asset-evidence-filter";
import type { ProjectSection } from "./project-navigation";

const HISTORY_KEY = "bearingCanvas";
const focusableSelector =
  "[data-bearing-focus-key],a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex='-1'])";

export type ProjectCanvasHistory = Readonly<{
  entryId: string;
  section: ProjectSection;
  location: string;
  scrollY?: number | undefined;
  focusKey?: string | undefined;
  assets?: Readonly<{
    query: string;
    evidenceFilter: AssetEvidenceFilter;
  }>;
}>;

const currentLocation = (): string =>
  `${window.location.pathname}${window.location.search}${window.location.hash}`;

export const projectCanvasFocusKey = (element: HTMLElement | null): string | undefined => {
  if (element === null) return undefined;
  const explicit = element.dataset["bearingFocusKey"];
  if (explicit !== undefined && explicit !== "") return `explicit:${explicit}`;
  const id = element.getAttribute("id");
  if (id !== null && id !== "") return `id:${id}`;
  if (element instanceof HTMLAnchorElement) {
    const href = element.getAttribute("href");
    if (href !== null && href !== "") return `href:${href}`;
  }
  const ariaLabel = element.getAttribute("aria-label");
  if (ariaLabel !== null && ariaLabel !== "") {
    return `${element.tagName.toLowerCase()}:aria:${ariaLabel}`;
  }
  const name = element.getAttribute("name");
  if (name !== null && name !== "") return `${element.tagName.toLowerCase()}:name:${name}`;
  return undefined;
};

const historyRecord = (): Record<string, unknown> =>
  typeof window.history.state === "object" && window.history.state !== null
    ? { ...(window.history.state as Record<string, unknown>) }
    : {};

const isProjectSection = (value: unknown): value is ProjectSection =>
  value === "overview" ||
  value === "roadmaps" ||
  value === "assets" ||
  value === "audit" ||
  value === "lineage";

const parseHistory = (value: unknown): ProjectCanvasHistory | undefined => {
  if (typeof value !== "object" || value === null) return undefined;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate["entryId"] !== "string" ||
    !isProjectSection(candidate["section"]) ||
    typeof candidate["location"] !== "string"
  ) {
    return undefined;
  }
  const assets = candidate["assets"];
  const parsedAssets =
    typeof assets === "object" &&
    assets !== null &&
    typeof (assets as Record<string, unknown>)["query"] === "string" &&
    isAssetEvidenceFilter((assets as Record<string, unknown>)["evidenceFilter"])
      ? {
          query: (assets as Record<string, unknown>)["query"] as string,
          evidenceFilter: (assets as Record<string, unknown>)[
            "evidenceFilter"
          ] as AssetEvidenceFilter,
        }
      : undefined;
  return {
    entryId: candidate["entryId"],
    section: candidate["section"],
    location: candidate["location"],
    ...(typeof candidate["scrollY"] === "number" ? { scrollY: candidate["scrollY"] } : {}),
    ...(typeof candidate["focusKey"] === "string" ? { focusKey: candidate["focusKey"] } : {}),
    ...(parsedAssets === undefined ? {} : { assets: parsedAssets }),
  };
};

export const readProjectCanvasHistory = (
  entryId: string,
  section: ProjectSection,
): ProjectCanvasHistory | undefined => {
  if (typeof window === "undefined") return undefined;
  const state = historyRecord();
  const parsed = parseHistory(state[HISTORY_KEY]);
  return parsed?.entryId === entryId &&
    parsed.section === section &&
    parsed.location === currentLocation()
    ? parsed
    : undefined;
};

const replaceProjectCanvasHistory = (next: ProjectCanvasHistory): void => {
  const state = historyRecord();
  state[HISTORY_KEY] = next;
  window.history.replaceState(state, "", window.location.href);
};

export const updateAssetCanvasFilters = (
  entryId: string,
  query: string,
  evidenceFilter: AssetEvidenceFilter,
): void => {
  const current = readProjectCanvasHistory(entryId, "assets");
  replaceProjectCanvasHistory({
    entryId,
    section: "assets",
    location: currentLocation(),
    assets: { query, evidenceFilter },
    ...(current?.scrollY === undefined ? {} : { scrollY: current.scrollY }),
    ...(current?.focusKey === undefined ? {} : { focusKey: current.focusKey }),
  });
};

export const captureProjectCanvasReturn = (
  entryId: string,
  section: ProjectSection,
  focusKey?: string,
): void => {
  const current = readProjectCanvasHistory(entryId, section);
  replaceProjectCanvasHistory({
    entryId,
    section,
    location: currentLocation(),
    scrollY: window.scrollY,
    ...(focusKey === undefined ? {} : { focusKey }),
    ...(current?.assets === undefined ? {} : { assets: current.assets }),
  });
};

export const restoreProjectCanvas = (
  entryId: string,
  section: ProjectSection,
): (() => void) | undefined => {
  const current = readProjectCanvasHistory(entryId, section);
  if (current === undefined || (current.scrollY === undefined && current.focusKey === undefined)) {
    return undefined;
  }
  const frame = window.requestAnimationFrame(() => {
    if (current.scrollY !== undefined) window.scrollTo({ top: current.scrollY });
    if (current.focusKey !== undefined) {
      const targets = document.querySelectorAll<HTMLElement>(focusableSelector);
      for (const target of targets) {
        if (projectCanvasFocusKey(target) === current.focusKey) {
          target.focus();
          break;
        }
      }
    }
  });
  return () => window.cancelAnimationFrame(frame);
};
