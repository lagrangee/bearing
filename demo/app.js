const demoDisclosure = document.querySelector("#demo-disclosure");
const sampleDate = document.querySelector("#sample-date");
const skipLink = document.querySelector(".skip-link");
const mainContent = document.querySelector("#main-content");
const topbar = document.querySelector(".topbar");
const mobileMenu = document.querySelector(".mobile-menu");
const navigation = document.querySelector(".project-navigation");
const navigationClose = document.querySelector(".nav-close");
const navigationScrim = document.querySelector(".nav-scrim");
const narrowViewport = matchMedia("(max-width: 900px)");
const screens = document.querySelectorAll("[data-screen]");
const screenById = new Map(Array.from(screens, (screen) => [screen.id, screen]));
const focusByRoute = new Map();
let activeRoute;

if (demoDisclosure !== null) demoDisclosure.textContent = globalThis.NORTHSTAR_DEMO.disclosure;
if (sampleDate !== null) sampleDate.textContent = globalThis.NORTHSTAR_DEMO.sampleDate;

const screenByRoute = Object.freeze({
  "#/overview": "overview-screen",
  "#/roadmaps": "roadmaps-screen",
  "#/roadmaps/public-beta-readiness": "public-beta-roadmap-screen",
  "#/gates/release-candidate-ready": "release-gate-screen",
  "#/efforts/release-packaging": "release-packaging-screen",
  "#/efforts/beta-operations": "beta-operations-screen",
  "#/native-work/release-packaging": "release-native-work-screen",
  "#/attention": "attention-screen",
  "#/reviews/public-beta-release-decision": "public-beta-review-screen",
  "#/assets": "assets-screen",
  "#/assets/public-beta-readiness-review": "release-asset-screen",
  "#/assets/tenant-isolation-report": "tenant-isolation-asset-screen",
  "#/assets/public-beta-handbook": "public-beta-handbook-asset-screen",
  "#/assets/browser-journey-report": "browser-journey-asset-screen",
  "#/assets/package-manifest": "package-manifest-asset-screen",
  "#/assets/public-beta-release-notes": "release-notes-asset-screen",
  "#/assets/audit-export-sample": "audit-export-asset-screen",
  "#/assets/partner-onboarding-guide": "partner-onboarding-asset-screen",
  "#/assets/rollback-runbook": "rollback-runbook-asset-screen",
  "#/assets/feedback-taxonomy": "feedback-taxonomy-asset-screen",
  "#/assets/alpha-interview-synthesis": "alpha-synthesis-asset-screen",
  "#/assets/northstar-design-tokens": "design-tokens-asset-screen",
  "#/assets/customer-trust-faq": "trust-faq-asset-screen",
  "#/assets/beta-operations-capture": "beta-operations-capture-asset-screen",
  "#/assets/partner-handoff-bundle": "partner-handoff-bundle-asset-screen",
  "#/assets/northstar-interaction-sample": "northstar-interaction-sample-asset-screen",
  "#/assets/legacy-packaging-checklist": "legacy-checklist-asset-screen",
  "#/assets/alpha-onboarding-guide": "alpha-onboarding-asset-screen",
  "#/authorities/product-experience": "product-experience-authority-screen",
  "#/authorities/reliability-operations": "reliability-operations-authority-screen",
  "#/authorities/data-security": "data-security-authority-screen",
  "#/preview/public-beta-readiness-review": "release-preview-screen",
  "#/preview/unavailable": "preview-unavailable-screen",
  "#/lineage/public-beta-readiness-review": "release-lineage-screen",
  "#/audit": "audit-screen",
});

const setNavigationVisibility = (open, returnFocus = false) => {
  document.body.classList.toggle("nav-open", open);
  mobileMenu?.setAttribute("aria-expanded", String(open));
  for (const background of [topbar, mainContent]) {
    if (background === null) continue;
    background.inert = open;
    if (open) background.setAttribute("aria-hidden", "true");
    else background.removeAttribute("aria-hidden");
  }
  if (navigation !== null && narrowViewport.matches) {
    navigation.inert = !open;
    navigation.setAttribute("aria-hidden", String(!open));
  }
  if (open) requestAnimationFrame(() => navigationClose?.focus());
  else if (returnFocus) requestAnimationFrame(() => mobileMenu?.focus());
};

const syncNavigationViewport = () => {
  if (navigation === null) return;
  if (narrowViewport.matches) setNavigationVisibility(false);
  else {
    setNavigationVisibility(false);
    navigation.inert = false;
    navigation.removeAttribute("aria-hidden");
  }
};

const syncRoute = (moveFocus = false) => {
  const route = location.hash === "" ? "#/overview" : location.hash;
  document.body.classList.toggle("preview-mode", route.startsWith("#/preview/"));
  if (moveFocus && activeRoute !== undefined) {
    const previousScreen = screenById.get(screenByRoute[activeRoute]);
    if (
      document.activeElement instanceof HTMLElement &&
      previousScreen?.contains(document.activeElement)
    ) {
      focusByRoute.set(activeRoute, document.activeElement);
    }
  }
  const activeScreen = screenById.get(screenByRoute[route] ?? "overview-screen");
  if (activeScreen !== undefined && mainContent !== null) {
    activeScreen.hidden = false;
    mainContent.replaceChildren(activeScreen);
    activeRoute = route;
    scrollTo({ top: 0, left: 0 });
    if (moveFocus) {
      requestAnimationFrame(() => {
        const savedFocus = focusByRoute.get(route);
        if (savedFocus instanceof HTMLElement && activeScreen.contains(savedFocus)) {
          savedFocus.focus();
        } else {
          activeScreen.querySelector("h1")?.focus();
        }
      });
    }
  }
  for (const link of document.querySelectorAll(".project-navigation a")) {
    const overviewContext =
      route.startsWith("#/overview") ||
      route.startsWith("#/attention") ||
      route.startsWith("#/reviews/");
    const assetContext =
      route.startsWith("#/assets") ||
      route.startsWith("#/authorities/") ||
      route.startsWith("#/preview/") ||
      route.startsWith("#/lineage/");
    const activeNavigationHref = route.startsWith("#/audit")
      ? "#/audit"
      : overviewContext
        ? "#/overview"
        : assetContext
          ? "#/assets"
          : "#/roadmaps";
    const selected =
      link.getAttribute("href") === activeNavigationHref;
    if (selected) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
};

const selectOrientation = (tab, moveFocus = false) => {
  const tabs = Array.from(document.querySelectorAll('.orientation-tabs [role="tab"]'));
  for (const candidate of tabs) {
    const selected = candidate.id === `project-${tab}-tab`;
    candidate.setAttribute("aria-selected", String(selected));
    candidate.tabIndex = selected ? 0 : -1;
    if (selected && moveFocus) candidate.focus();
  }
  for (const panel of document.querySelectorAll("[data-orientation-panel]")) {
    panel.hidden = panel.getAttribute("data-orientation-panel") !== tab;
  }
  document
    .querySelector("#project-orientation-panel")
    ?.setAttribute("aria-labelledby", `project-${tab}-tab`);
};

const applyAssetFilters = () => {
  const assetScreen = document.querySelector("#assets-screen");
  if (assetScreen === null) return;
  const query = assetScreen.querySelector('.search-field input[type="search"]')?.value
    .trim()
    .toLocaleLowerCase() ?? "";
  const disposition =
    assetScreen.querySelector('[data-asset-filter="disposition"]')?.value ?? "available";
  const evidence = assetScreen.querySelector('[data-asset-filter="evidence"]')?.value ?? "all";
  const rows = Array.from(assetScreen.querySelectorAll(".asset-row"));
  const filtering = query !== "" || disposition !== "available" || evidence !== "all";
  let visible = 0;
  for (const row of rows) {
    const dispositionMatch =
      disposition === "all" || row.dataset.disposition === disposition;
    const evidenceMatch =
      evidence === "all" || row.dataset.evidence?.split(" ").includes(evidence) === true;
    const queryMatch = query === "" || row.dataset.search?.includes(query);
    row.hidden = !(dispositionMatch && evidenceMatch && queryMatch);
    if (!row.hidden) visible += 1;
  }
  const result = assetScreen.querySelector(".asset-result-count");
  if (result !== null) {
    result.hidden = !filtering;
    result.textContent = `${visible} of ${rows.length} Assets`;
  }
  const table = assetScreen.querySelector(".asset-table");
  const empty = assetScreen.querySelector(".asset-empty");
  if (table !== null) table.hidden = visible === 0;
  if (empty !== null) empty.hidden = visible !== 0;
};

skipLink?.addEventListener("click", (event) => {
  event.preventDefault();
  mainContent?.focus();
});

mobileMenu?.addEventListener("click", () => setNavigationVisibility(true));
navigationClose?.addEventListener("click", () => setNavigationVisibility(false, true));
navigationScrim?.addEventListener("click", () => setNavigationVisibility(false, true));
navigation?.addEventListener("click", (event) => {
  if (event.target.closest("a") !== null && narrowViewport.matches) {
    setNavigationVisibility(false);
  }
});
navigation?.addEventListener("keydown", (event) => {
  if (!narrowViewport.matches) return;
  if (event.key === "Escape") {
    event.preventDefault();
    setNavigationVisibility(false, true);
    return;
  }
  if (event.key !== "Tab") return;
  const focusable = Array.from(navigation.querySelectorAll("a[href], button:not([disabled])"));
  const first = focusable[0];
  const last = focusable.at(-1);
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last?.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first?.focus();
  }
});

document.querySelector(".orientation-tabs")?.addEventListener("click", (event) => {
  const tab = event.target.closest('[role="tab"]');
  if (tab?.id === "project-brief-tab") selectOrientation("brief");
  if (tab?.id === "project-summary-tab") selectOrientation("summary");
});
document.querySelector(".orientation-tabs")?.addEventListener("keydown", (event) => {
  const next =
    event.key === "ArrowLeft" || event.key === "ArrowUp" || event.key === "Home"
      ? "brief"
      : event.key === "ArrowRight" || event.key === "ArrowDown" || event.key === "End"
        ? "summary"
        : undefined;
  if (next === undefined) return;
  event.preventDefault();
  selectOrientation(next, true);
});

document.querySelector("#assets-screen .asset-controls")?.addEventListener("input", applyAssetFilters);
document.querySelector("#assets-screen .asset-controls")?.addEventListener("change", applyAssetFilters);
document.querySelector("#assets-screen .asset-empty .action")?.addEventListener("click", () => {
  const search = document.querySelector('#assets-screen .search-field input[type="search"]');
  const disposition = document.querySelector(
    '#assets-screen [data-asset-filter="disposition"]',
  );
  const evidence = document.querySelector('#assets-screen [data-asset-filter="evidence"]');
  if (search !== null) search.value = "";
  if (disposition !== null) disposition.value = "available";
  if (evidence !== null) evidence.value = "all";
  applyAssetFilters();
  search?.focus();
});

document.addEventListener("click", (event) => {
  const link = event.target.closest("[data-scroll-target]");
  if (link === null) return;
  event.preventDefault();
  document.getElementById(link.getAttribute("data-scroll-target"))?.scrollIntoView();
});

narrowViewport.addEventListener("change", syncNavigationViewport);
addEventListener("hashchange", () => syncRoute(true));
syncNavigationViewport();
applyAssetFilters();
syncRoute();
