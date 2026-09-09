const { test, expect } = require("@playwright/test");
const fs = require("fs");
const { londonDate } = require("../../src/js/listings");

test("all published images load and the page has no JavaScript errors", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  const broken = await page.evaluate(async () => {
    const images = [...document.images];
    await Promise.all(
      images.map((image) => {
        image.loading = "eager";
        return image.decode().catch(() => {});
      }),
    );
    return images
      .filter((image) => !image.naturalWidth)
      .map((image) => image.src);
  });
  expect(broken).toEqual([]);
  expect(errors).toEqual([]);
  await expect(page.locator("#results-count")).toHaveText(/\d+ shows?/);
  await page.screenshot({
    path: `test-results/home-${test.info().project.name}.png`,
  });
});

test("search, genre, reset and empty state work together", async ({ page }) => {
  await page.goto("/");
  const initial = await page
    .locator("#events-grid .event-card:visible")
    .count();
  await page.getByLabel("Search shows").fill("no-such-production-72819");
  await expect(page.locator("#results-count")).toHaveText("0 shows");
  await expect(page.locator("#no-results")).toBeVisible();
  await page
    .locator("#no-results")
    .getByRole("button", { name: "Clear filters" })
    .click();
  await expect(page.locator("#events-grid .event-card:visible")).toHaveCount(
    initial,
  );
  await page.locator('[data-tag="dance"]').click();
  await expect(page.locator('[data-tag="dance"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page).toHaveURL(/genre=dance/);
  await page.reload();
  await expect(page.locator('[data-tag="dance"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("Thrice has both dates, supplied image, BSL credit and direct booking link", async ({
  page,
}) => {
  test.skip(
    londonDate() > "2026-10-17",
    "Thrice has finished and must no longer be promoted.",
  );
  await page.goto(
    "/?q=Thrice&venue=tramway&from=2026-10-17&to=2026-10-17&genre=dance",
  );
  const card = page.locator("#events-grid .event-card:visible");
  await expect(card).toHaveCount(1);
  await expect(
    card.getByRole("heading", { name: "Thrice", exact: true }),
  ).toBeVisible();
  await expect(card).toContainText("BSL interpreted by Lisa Li");
  await expect(card.locator("img")).toHaveAttribute(
    "src",
    "/images/thrice.webp",
  );
  await expect(
    card.getByRole("link", { name: "Tickets for Thrice" }),
  ).toHaveAttribute(
    "href",
    "https://www.tramway.org/event/328af962-85b1-4a39-9f3a-b43900ec12d2/",
  );
  const spotlight = page.locator("#featured-show");
  await expect(spotlight).toContainText("Fri, 16 Oct 2026 · 7.30pm");
  await expect(spotlight).toContainText("Sat, 17 Oct 2026 · 7.30pm");
  await page.getByRole("link", { name: "Discover Thrice" }).click();
  await expect(page).toHaveURL(/#featured-show$/);
});

test("expired listings and spotlight disappear from an older static build", async ({
  page,
}) => {
  await page.clock.install({ time: new Date("2030-01-01T12:00:00Z") });
  await page.goto("/");
  await expect(page.locator("#events-grid .event-card:visible")).toHaveCount(0);
  await expect(page.locator(".featured:visible")).toHaveCount(0);
  await expect(page.locator("#featured-show:visible")).toHaveCount(0);
  await expect(page.locator("[data-upcoming-count]")).toHaveText("0");
  await page.goto("/venues/tramway.html");
  await expect(page.locator(".event-card:visible")).toHaveCount(0);
  await expect(page.locator("#no-results")).toBeVisible();
});

test("a missing image has a venue fallback and booking remains usable", async ({
  page,
}) => {
  await page.route("**/images/**", (route) => route.abort());
  await page.goto("/");
  const first = page.locator(".event-card").first();
  await first.scrollIntoViewIfNeeded();
  await expect(first.locator(".event-card-image")).toHaveClass(
    /image-unavailable/,
  );
  await expect(first.locator("img")).toBeHidden();
  await expect(first.locator(".image-fallback")).toBeVisible();
  await expect(first.locator(".ticket-link")).toBeVisible();
});

test("page layouts fit small screens and navigation reaches each page", async ({
  page,
}) => {
  for (const url of [
    "/",
    "/venues.html",
    "/venues/tramway.html",
    "/about.html",
    "/submit.html",
  ]) {
    await page.goto(url);
    await page.evaluate(() => document.fonts.ready);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await expect(page.locator("h1")).toBeVisible();
    await expect(
      page.getByRole("navigation", { name: "Main navigation" }),
    ).toBeVisible();
  }
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "Venues", exact: true })
    .click();
  await expect(page).toHaveURL(/\/venues.html$/);
  await page
    .locator(".venue-card")
    .filter({
      has: page.getByRole("heading", { name: "Tramway", exact: true }),
    })
    .click();
  await expect(page).toHaveURL(/\/venues\/tramway.html$/);
});

test("all internal links and local assets exist", async ({ request }) => {
  const pages = [
    "index.html",
    "venues.html",
    "about.html",
    "submit.html",
    ...fs.readdirSync("dist/venues").map((name) => "venues/" + name),
  ];
  const paths = new Set();
  for (const file of pages) {
    const content = fs.readFileSync("dist/" + file, "utf8");
    for (const match of content.matchAll(/(?:href|src)="(\/[^"#?]*)"/g))
      paths.add(match[1]);
  }
  for (const path of paths)
    expect((await request.get(path)).ok(), path).toBe(true);
});

test("pages have no automated WCAG A or AA accessibility violations", async ({
  page,
}) => {
  const AxeBuilder = require("@axe-core/playwright").default;
  for (const url of [
    "/",
    "/venues.html",
    "/venues/tramway.html",
    "/submit.html",
  ]) {
    await page.goto(url);
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(
      results.violations.map((v) => ({
        id: v.id,
        nodes: v.nodes.map((n) => n.target),
      })),
    ).toEqual([]);
  }
});
