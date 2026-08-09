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
    scrollTo({ top: 0 });
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
    const activeNavigationHref = route.startsWith("#/audit")
      ? "#/audit"
      : overviewContext
        ? "#/overview"
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

document.addEventListener("click", (event) => {
  const link = event.target.closest("[data-scroll-target]");
  if (link === null) return;
  event.preventDefault();
  document.getElementById(link.getAttribute("data-scroll-target"))?.scrollIntoView();
});

narrowViewport.addEventListener("change", syncNavigationViewport);
addEventListener("hashchange", () => syncRoute(true));
syncNavigationViewport();
syncRoute();
