import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { unexpectedStaticRequests } from "./demo-static-boundary";

test("Pages root and hash deep links keep the browser-only sample boundary visible", async ({
  page,
}) => {
  await page.goto("./");
  await expect(page).toHaveURL(/\/bearing\/$/u);
  await expect(page.getByRole("heading", { name: "Northstar", level: 1 })).toBeVisible();
  await expect(
    page.getByText(
      "Fixed-data static sample · Not a hosted Bearing project · Runs entirely in your browser",
      {
        exact: true,
      },
    ),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Install Bearing locally" })).toHaveAttribute(
    "href",
    "https://github.com/lagrangee/bearing#quickstart-complete-one-real-alignment-loop",
  );
  await expect(
    page.getByRole("link", { name: "Read the data and security boundary" }),
  ).toHaveAttribute(
    "href",
    "https://github.com/lagrangee/bearing/blob/main/docs/data-and-security.md",
  );
  await expect(
    page.getByText(/Questions, feedback, and documentation reports use public GitHub/u),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Ask in Q&A" })).toHaveAttribute(
    "href",
    "https://github.com/lagrangee/bearing/discussions/categories/q-a",
  );
  await expect(page.getByRole("link", { name: "Share ideas and feedback" })).toHaveAttribute(
    "href",
    "https://github.com/lagrangee/bearing/discussions/categories/ideas",
  );
  await expect(page.getByRole("link", { name: "Report a documentation problem" })).toHaveAttribute(
    "href",
    "https://github.com/lagrangee/bearing/issues/new?template=documentation.yml",
  );
  await expect(
    page.getByRole("link", { name: "Report a vulnerability privately" }),
  ).toHaveAttribute("href", "https://github.com/lagrangee/bearing/security/advisories/new");

  await page.goto("./#/gates/release-candidate-ready");
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Release candidate ready", level: 1 }),
  ).toBeVisible();
  await expect(page.getByText("Not passed", { exact: true })).toBeVisible();

  await page.goto("./#/preview/public-beta-readiness-review");
  await expect(
    page.getByText(
      "Fixed-data static sample · Not a hosted Bearing project · Runs entirely in your browser",
      {
        exact: true,
      },
    ),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Install Bearing locally" })).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Read the data and security boundary" }),
  ).toBeVisible();
});

test("the verified artifact completes the daily governance journey without runtime side effects", async ({
  page,
}) => {
  const requests: { method: string; url: string }[] = [];
  const runtimeErrors: string[] = [];
  page.on("request", (request) => requests.push({ method: request.method(), url: request.url() }));
  page.on("console", (message) => {
    if (message.type() === "error") runtimeErrors.push(message.text());
  });
  page.on("pageerror", (error) => runtimeErrors.push(error.message));

  await page.goto("./#/overview");
  await page.getByRole("button", { name: "Start daily governance walkthrough" }).click();
  const guide = page.getByRole("dialog", { name: "Daily governance walkthrough" });
  for (const route of [
    "gates/release-candidate-ready",
    "attention",
    "efforts/release-packaging",
    "native-work/release-packaging",
    "assets/public-beta-readiness-review",
    "lineage/public-beta-readiness-review",
  ]) {
    await guide.getByRole("button", { name: "Next step" }).click();
    await expect(page).toHaveURL(new RegExp(`#/${route}$`, "u"));
  }
  await guide.getByRole("button", { name: "Finish walkthrough" }).click();

  await page.goto("./#/efforts/beta-operations");
  await expect(page.getByRole("region", { name: "Can't verify" })).toContainText("not current");
  await page.goto("./#/reviews/public-beta-release-decision");
  await expect(
    page.getByText("Beta Operations evidence remains stale and cannot contribute to readiness."),
  ).toBeVisible();

  expect(unexpectedStaticRequests(requests, new URL(page.url()).origin)).toEqual([]);
  await expect(page.locator('script[src*="@vite/client"]')).toHaveCount(0);
  expect(await page.context().cookies()).toEqual([]);
  expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([]);
  expect(await page.evaluate(() => Object.keys(sessionStorage))).toEqual([]);
  expect(
    await page.evaluate(() =>
      navigator.serviceWorker.getRegistrations().then((registrations) => registrations.length),
    ),
  ).toBe(0);
  expect(runtimeErrors).toEqual([]);
});

test("the daily reading remains complete and accessible at 360, 768, and 1440 pixels", async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const width of [360, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("./#/overview");
    await expect(page.getByRole("heading", { name: "Current Position", level: 3 })).toBeVisible();
    await expect(page.getByRole("region", { name: "Attention" })).toBeVisible();
    expect(
      await page.locator("html").evaluate((element) => element.scrollWidth > element.clientWidth),
    ).toBe(false);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({
      path: testInfo.outputPath(`pages-overview-${width}.png`),
      fullPage: true,
    });
  }
});
