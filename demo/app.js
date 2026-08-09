const demoDisclosure = document.querySelector("#demo-disclosure");
const sampleDate = document.querySelector("#sample-date");
const overviewLink = document.querySelector('nav a[href="#/overview"]');
const skipLink = document.querySelector(".skip-link");
const mainContent = document.querySelector("#main-content");

if (demoDisclosure !== null) demoDisclosure.textContent = globalThis.NORTHSTAR_DEMO.disclosure;
if (sampleDate !== null) sampleDate.textContent = globalThis.NORTHSTAR_DEMO.sampleDate;

const syncRoute = () => {
  if (overviewLink === null) return;
  const showsOverview = location.hash === "" || location.hash === "#/overview";
  if (showsOverview) overviewLink.setAttribute("aria-current", "page");
  else overviewLink.removeAttribute("aria-current");
};

skipLink?.addEventListener("click", () => mainContent?.focus());
addEventListener("hashchange", syncRoute);
syncRoute();
