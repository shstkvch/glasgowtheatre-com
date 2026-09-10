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

/** On phones the filter panel starts collapsed, so open it before using it. */
async function openFilters(page) {
  const summary = page.locator(".filter-summary");
  if (await summary.isVisible()) {
    const panel = page.locator(".filter-controls");
    if (!(await panel.evaluate((el) => el.open))) await summary.click();
  }
}

test("search, art form, reset and empty state work together", async ({ page }) => {
  await page.goto("/");
  await openFilters(page);
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
  await page.locator('[data-form="dance"]').click();
  await expect(page.locator('[data-form="dance"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page).toHaveURL(/form=dance/);
  await page.reload();
  await expect(page.locator('[data-form="dance"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("a manually submitted listing appears as a normal card with its supplied image and access details", async ({
  page,
}) => {
  test.skip(
    londonDate() > "2026-10-17",
    "Thrice has finished and must no longer be listed.",
  );
  await page.goto(
    "/?q=Thrice&venue=tramway&from=2026-10-17&to=2026-10-17&form=dance",
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
  // Nothing is promoted above the listings any more.
  await expect(page.locator(".featured, #featured-show, .spotlight")).toHaveCount(
    0,
  );
});

test("the homepage leads with listings, not a masthead", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("What’s on.");
  await expect(page.locator(".hero, .featured, .spotlight")).toHaveCount(0);
  // The first card must be reachable without hunting for it.
  const card = page.locator(".event-card").first();
  await expect(card).toBeInViewport();
});

test("the thumbnail books the show without adding a second tab stop", async ({
  page,
}) => {
  await page.goto("/?q=Thrice");
  const card = page.locator("#events-grid .event-card:visible").first();
  const thumb = card.locator(".event-card-thumb");
  await expect(thumb).toHaveAttribute(
    "href",
    "https://www.tramway.org/event/328af962-85b1-4a39-9f3a-b43900ec12d2/",
  );
  // Same destination as the title, so it must stay out of the tab order.
  await expect(thumb).toHaveAttribute("tabindex", "-1");
  await expect(thumb).toHaveAttribute(
    "href",
    await card.locator("h3 a").getAttribute("href"),
  );
  // The date is announced from outside the thumbnail link.
  await expect(card.locator(".date-stamp")).toBeVisible();
});

test("filters collapse on phones and stay open on desktop", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  const panel = page.locator(".filter-controls");
  const mobile = testInfo.project.name === "mobile";
  expect(await panel.evaluate((el) => el.open)).toBe(!mobile);
  // Whatever the width, the controls must be reachable.
  await openFilters(page);
  await expect(page.getByLabel("Search shows")).toBeVisible();
});

test("Play, Pie and a Pint shows are labelled by their season, not the building", async ({
  page,
}) => {
  await page.goto("/?venue=oran-mor");
  const cards = page.locator("#events-grid .event-card:visible");
  await expect(cards.first()).toBeVisible();
  const labels = await cards.locator(".card-topline > a").allTextContents();
  expect(labels.length).toBeGreaterThan(0);
  expect([...new Set(labels)]).toEqual(["A Play, A Pie and A Pint"]);
  // The label still leads to the venue it runs in.
  await expect(cards.first().locator(".card-topline > a")).toHaveAttribute(
    "href",
    "/venues/oran-mor.html",
  );
});

test("expired listings disappear from an older static build", async ({
  page,
}) => {
  await page.clock.install({ time: new Date("2030-01-01T12:00:00Z") });
  await page.goto("/");
  await expect(page.locator("#events-grid .event-card:visible")).toHaveCount(0);
  await expect(page.locator("[data-upcoming-count]")).toHaveText("0");
  expect(await page.locator(".filter-pill-count").allTextContents()).toEqual(
    Array(await page.locator(".filter-pill-count").count()).fill("0"),
  );
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
    "/calendar.html",
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
    "calendar.html",
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
    "/calendar.html",
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

test("only art forms are offered and opera filters the matching cards", async ({ page }) => {
  const { FORMS } = require("../../scripts/art-forms");
  await page.goto("/");
  await openFilters(page);
  const forms = await page.locator(".filter-pill[data-form]").evaluateAll(
    (pills) => pills.map((pill) => pill.dataset.form).filter(Boolean),
  );
  expect(forms.length).toBeGreaterThan(0);
  expect(forms.every((form) => Object.hasOwn(FORMS, form))).toBe(true);
  await expect(page.locator(".filter-pills-group")).toHaveAttribute("aria-label", "Filter by art form");
  await page.getByRole("button", { name: /^Opera \d+$/ }).click();
  await expect(page).toHaveURL(/form=opera/);
  const cards = page.locator("#events-grid .event-card:visible");
  const expected = await page.evaluate(() => window.Listings.filterEvents(window.EVENTS, { form: "opera" }).length);
  expect(expected).toBeGreaterThan(0);
  await expect(cards).toHaveCount(expected);
  expect(await cards.locator(".card-topline > span").allTextContents()).toEqual(Array(expected).fill("Opera"));
});


test("art form pills show circular counts in descending popularity", async ({ page }) => {
  await page.goto("/");
  await openFilters(page);
  const pills = page.locator(".filter-pill");
  const values = await pills.evaluateAll((buttons) => buttons.map((button) => ({
    form: button.dataset.form,
    count: Number(button.querySelector(".filter-pill-count").textContent),
  })));
  const expected = await page.evaluate(() => {
    const counts = {};
    for (const event of window.Listings.filterEvents(window.EVENTS)) {
      counts[event.form] = (counts[event.form] || 0) + 1;
    }
    return Object.entries(counts).map(([form, count]) => ({ form, count }))
      .sort((a, b) => b.count - a.count || a.form.localeCompare(b.form));
  });
  expect(values).toEqual([{ form: "", count: expected.reduce((sum, item) => sum + item.count, 0) }, ...expected]);
  const badge = pills.first().locator(".filter-pill-count");
  const size = await badge.boundingBox();
  expect(size.width).toBe(size.height);
  await expect(badge).toHaveCSS("border-radius", "50%");
  await page.locator('[data-form="opera"]').click();
  expect(await pills.locator(".filter-pill-count").allTextContents()).toEqual(values.map((item) => String(item.count)));
  await page.screenshot({ path: `test-results/pills-${test.info().project.name}.png` });
});

test("the timeline lanes a venue's shows and opens on today", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/calendar.html");
  const chart = page.locator("#cal-scroll");
  await expect(chart).toBeVisible();
  // One lane per venue with something on, each led by its own name.
  const lanes = page.locator(".cal-lane-head");
  expect(await lanes.count()).toBeGreaterThan(3);
  await expect(lanes.first().locator(".cal-lane-name")).not.toBeEmpty();
  // Today is both marked in the header and where the chart has scrolled to.
  const today = londonDate();
  await expect(page.locator(".cal-day.is-today")).toHaveCount(1);
  expect(await chart.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
  // A run is drawn as many day columns wide as it actually lasts.
  const bar = await page.locator(".cal-item").first().evaluate((el) => ({
    span: Number(getComputedStyle(el).getPropertyValue("--span")),
    room: Number(getComputedStyle(el).getPropertyValue("--room")),
    href: el.getAttribute("href"),
  }));
  expect(bar.span).toBeGreaterThan(0);
  expect(bar.room).toBeGreaterThanOrEqual(bar.span);
  expect(bar.href).toMatch(/^\/venues\/[a-z-]+\.html#/);
  expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(errors).toEqual([]);
  await page.screenshot({
    path: `test-results/calendar-${test.info().project.name}.png`,
  });
});

test("a month button scrolls the chart and lights up", async ({ page }) => {
  await page.goto("/calendar.html");
  const chart = page.locator("#cal-scroll");
  const chips = page.locator("#cal-jump .cal-chip:not(.cal-chip-today)");
  const last = chips.last();
  await last.click();
  await expect(last).toHaveAttribute("aria-pressed", "true", { timeout: 4000 });
  await expect(chips.first()).toHaveAttribute("aria-pressed", "false");
  expect(await chart.evaluate((el) => el.scrollLeft)).toBeGreaterThan(1000);
});

test("picking a show from the timeline lands on its venue page, highlighted", async ({
  page,
}) => {
  await page.goto("/calendar.html");
  const item = page.locator(".cal-item").first();
  const id = await item.getAttribute("data-show");
  await item.click();
  await expect(page).toHaveURL(new RegExp(`/venues/.+\\.html#${id}$`));
  const card = page.locator(`[id="${id}"]`);
  await expect(card).toBeVisible();
  // The highlight is a panel behind the card, not an outline over the rule.
  expect(
    await card.evaluate(
      (el) => getComputedStyle(el, "::before").backgroundColor,
    ),
  ).not.toBe("rgba(0, 0, 0, 0)");
});

test("every bar's title is readable against its own venue colour", async ({
  page,
}) => {
  await page.goto("/calendar.html");
  const worst = await page.evaluate(() => {
    const channel = (v) =>
      v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    const luminance = (colour) => {
      const [r, g, b] = colour.match(/\d+/g).map((n) => channel(n / 255));
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    let lowest = 21;
    for (const label of document.querySelectorAll(
      ".label-inside .cal-item-label",
    )) {
      const bar = label.previousElementSibling;
      const [a, b] = [
        luminance(getComputedStyle(label).color),
        luminance(getComputedStyle(bar).backgroundColor),
      ].sort((x, y) => y - x);
      lowest = Math.min(lowest, (a + 0.05) / (b + 0.05));
    }
    return lowest;
  });
  expect(worst).toBeGreaterThanOrEqual(4.5);
});
