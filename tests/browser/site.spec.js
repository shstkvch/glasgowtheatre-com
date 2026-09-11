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

test("the thumbnail opens the show without adding a second tab stop", async ({
  page,
}) => {
  await page.goto("/?q=Thrice");
  const card = page.locator("#events-grid .event-card:visible").first();
  const thumb = card.locator(".event-card-thumb");
  // The title and the artwork both open the show's own page, where the
  // prices, the times and the concessions are collected.
  await expect(thumb).toHaveAttribute("href", /^\/shows\/.+\.html$/);
  // Same destination as the title, so it must stay out of the tab order.
  await expect(thumb).toHaveAttribute("tabindex", "-1");
  await expect(thumb).toHaveAttribute(
    "href",
    await card.locator("h3 a").getAttribute("href"),
  );
  // Booking still goes straight to the venue: nobody who only wants a ticket
  // is made to travel through us to get one.
  await expect(card.locator(".ticket-link")).toHaveAttribute(
    "href",
    "https://www.tramway.org/event/328af962-85b1-4a39-9f3a-b43900ec12d2/",
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

test("Play, Pie and a Pint shows are labelled by the programme, not the building", async ({
  page,
}) => {
  await page.goto("/?venue=oran-mor");
  const cards = page.locator("#events-grid .event-card:visible");
  await expect(cards.first()).toBeVisible();
  const labels = await cards.locator(".card-topline > a").allTextContents();
  expect(labels.length).toBeGreaterThan(0);
  expect([...new Set(labels)]).toEqual(["A Play, a Pie and a Pint"]);
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
}, testInfo) => {
  const mobile = testInfo.project.name === "mobile";
  /** On a phone the nav lives behind the hamburger, so open it first. */
  async function openNav() {
    const toggle = page.locator(".nav-toggle");
    if (await toggle.isVisible()) await toggle.click();
  }
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
    // Every page must offer a way out of itself: the nav on a wide screen,
    // the hamburger that holds it on a narrow one.
    await expect(
      mobile
        ? page.locator(".nav-toggle")
        : page.getByRole("navigation", { name: "Main navigation" }),
    ).toBeVisible();
  }
  await openNav();
  await page
    .getByRole("navigation", { name: "Main navigation" })
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
    ...fs.readdirSync("dist/shows").map((name) => "shows/" + name),
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
  // A show page carries a table, a definition list and two panels nothing
  // else on the site uses, so it is swept along with the rest.
  const showUrl = "/shows/" + fs.readdirSync("dist/shows")[0];
  for (const url of [
    "/",
    "/calendar.html",
    "/venues.html",
    "/venues/tramway.html",
    "/submit.html",
    showUrl,
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
  expect(bar.href).toMatch(/^\/shows\/[a-z0-9-]+\.html$/);
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

test("picking a show from the timeline opens its prices and times", async ({
  page,
}) => {
  await page.goto("/calendar.html");
  const item = page.locator(".cal-item").first();
  const id = await item.getAttribute("data-show");
  const title = await item.locator(".cal-item-label").textContent();
  await item.click();
  await expect(page).toHaveURL(`/shows/${id}.html`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
  await expect(page.locator(".ticket-panel")).toBeVisible();
  // The venue the run is at is still one click away.
  await expect(page.locator(".show-hero .eyebrow a")).toHaveAttribute(
    "href",
    /^\/venues\/[a-z-]+\.html$/,
  );
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

/* ------------------------------------------- prices, times and show pages */

/** The listings the build actually published, which is what the pages were
    made from — so a test picks its example the same way the build did. */
const published = () =>
  JSON.parse(fs.readFileSync("dist/data/events.json", "utf8"));

test("the images a visitor sees first are fetched first", async ({ page }) => {
  await page.goto("/");
  const images = page.locator("#events-grid .event-card-image img");
  const hints = await images.evaluateAll((els) =>
    els.map((el) => ({
      loading: el.getAttribute("loading"),
      priority: el.getAttribute("fetchpriority"),
    })),
  );
  expect(hints.length).toBeGreaterThan(4);
  // One of the first row's thumbnails is the largest thing painted on the
  // page, and lazy-loading it deferred the fetch past layout and then ran it
  // at low priority — 3.5 seconds to paint, on Cloudflare's own measurements.
  for (const hint of hints.slice(0, 3)) {
    expect(hint.loading).toBe(null);
    expect(hint.priority).toBe("high");
  }
  // Everything past the first row still waits to be scrolled to.
  for (const hint of hints.slice(3)) {
    expect(hint.loading).toBe("lazy");
    expect(hint.priority).toBe(null);
  }
});

test("a show page asks for its hero image before anything else", async ({
  page,
}) => {
  await page.goto("/shows/oran-mor-transparent.html");
  const hero = page.locator(".show-hero-image img");
  await expect(hero).toHaveAttribute("fetchpriority", "high");
  expect(await hero.getAttribute("loading")).toBe(null);
  const src = await hero.getAttribute("src");
  await expect(
    page.locator(`link[rel="preload"][as="image"][href="${src}"]`),
  ).toHaveCount(1);
});

test("a card carries when the show starts and what it costs", async ({
  page,
}) => {
  await page.goto("/");
  // Not every venue publishes a price, so this is a floor rather than a total:
  // the point is that the figures reach the listing at all.
  const priced = page.locator("#events-grid .event-card .fact-price");
  expect(await priced.count()).toBeGreaterThan(20);
  const timed = page.locator("#events-grid .event-card .fact-time");
  expect(await timed.count()).toBeGreaterThan(20);
  // Every price shown is a real one: money, "Free", or pay what you like.
  for (const text of await priced.allTextContents())
    expect(text).toMatch(/^(£\d|From £\d|Free$|Pay what you like)/);
  // No card claims a price the data does not carry.
  const honest = await page.evaluate(() => {
    const ids = [...document.querySelectorAll(".event-card")]
      .filter((card) => card.querySelector(".fact-price"))
      .map((card) => card.dataset.id);
    const priced = new Set(
      window.EVENTS.filter(
        (e) => e.pricing && (e.pricing.from != null || e.pricing.payWhatYouLike),
      ).map((e) => e.id),
    );
    return ids.every((id) => priced.has(id));
  });
  expect(honest).toBe(true);
});

test("a concession quoted on a card is explained on the show page", async ({
  page,
}) => {
  await page.goto("/?venue=citizens");
  const card = page
    .locator("#events-grid .event-card:visible")
    .filter({ has: page.locator(".fact-price", { hasText: "conc." }) })
    .first();
  await expect(card).toBeVisible();
  const quoted = await card.locator(".fact-price").textContent();
  const concession = quoted.match(/conc\. from (£[\d.]+)/)[1];
  await card.locator("h3 a").click();
  await expect(page).toHaveURL(/\/shows\/citizens-/);
  // The panel names whose scheme the figure belongs to rather than letting it
  // read as a price set for this production.
  await expect(page.locator(".ticket-source")).toContainText(concession);
  const panel = page.locator(".conc-panel");
  await expect(panel).toContainText("Gorbals Pass");
  await expect(panel).toContainText("G5 postcode");
  await expect(panel).toContainText("Low Income Pass");
  await expect(panel.locator(".conc-price").first()).toHaveText(concession);
  // And it says where it was read from, so a stale figure can be checked.
  await expect(panel.locator(".conc-source a")).toHaveAttribute(
    "href",
    /citz\.co\.uk/,
  );
});

test("Platform's postcode scheme reaches its own shows", async ({ page }) => {
  const platform = published().find((e) => e.venueId === "platform");
  await page.goto(`/shows/${platform.id}.html`);
  const panel = page.locator(".conc-panel");
  await expect(panel).toContainText("Local Links");
  await expect(panel).toContainText("G34 9");
  await expect(panel).toContainText("enter your postcode");
});

test("a show page lists every performance the venue published", async ({
  page,
}) => {
  const run = published()
    .filter((e) => (e.performances || []).length > 4)
    .sort((a, b) => b.performances.length - a.performances.length)[0];
  await page.goto(`/shows/${run.id}.html`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(run.title);
  await expect(page.locator(".perf-table tbody tr")).toHaveCount(
    run.performances.length,
  );
  // Times are printed as a person would say them, not as 24-hour clock.
  const times = await page.locator(".perf-time").allTextContents();
  expect(times.every((t) => /^(\d{1,2}(\.\d{2})?(am|pm)|noon|—)$/.test(t))).toBe(
    true,
  );
  // The table scrolls inside its own box rather than widening the page.
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBe(true);
});

test("a show page books at the venue and never invents a price", async ({
  page,
}) => {
  const unpriced = published().find((e) => !e.pricing);
  test.skip(!unpriced, "Every listing currently carries a price.");
  await page.goto(`/shows/${unpriced.id}.html`);
  await expect(page.locator(".ticket-headline")).toHaveText(
    "Prices not published",
  );
  // The Old Hairdressers is still on http, so the test asks for an absolute
  // link out to the venue rather than for a scheme it does not offer.
  await expect(page.locator(".ticket-panel .btn")).toHaveAttribute(
    "href",
    /^https?:\/\//,
  );
});

test("the timeline says when and how much without opening anything", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "The preview needs a mouse.");
  await page.goto("/calendar.html");
  const item = page
    .locator(".cal-item")
    .filter({ hasNot: page.locator(".nothing") })
    .first();
  // The tooltip carries it for a mouse and for assistive technology alike.
  const title = await item.getAttribute("title");
  expect(title).toMatch(/·/);
  await item.hover();
  const pop = page.locator(".cal-pop");
  await expect(pop).toBeVisible();
  await expect(pop.locator(".cal-pop-title")).not.toBeEmpty();
  const facts = pop.locator(".cal-pop-facts");
  // At least one of the two is known for the first bar on the chart.
  expect(
    (await facts.locator(".fact-time").textContent()) +
      (await facts.locator(".fact-price").textContent()),
  ).not.toBe("");
  await page.screenshot({
    path: `test-results/calendar-preview-${testInfo.project.name}.png`,
  });
});

test("show pages fit a phone and keep their columns on a desktop", async ({
  page,
}, testInfo) => {
  const listings = published();
  const show =
    listings.find((e) => e.venueId === "citizens" && e.pricing) || listings[0];
  await page.goto(`/shows/${show.id}.html`);
  await page.evaluate(() => document.fonts.ready);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBe(true);
  const columns = await page
    .locator(".show-columns")
    .evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(" ").length);
  expect(columns).toBe(testInfo.project.name === "mobile" ? 1 : 2);
  await page.screenshot({
    path: `test-results/show-${testInfo.project.name}.png`,
    fullPage: true,
  });
});

test("stylesheet and script URLs change when the file does", async ({
  page,
  request,
}) => {
  await page.goto("/");
  const assets = await page.evaluate(() =>
    [
      ...document.querySelectorAll('link[rel="stylesheet"], script[src]'),
    ].map((el) => el.getAttribute("href") || el.getAttribute("src")),
  );
  expect(assets.length).toBeGreaterThan(0);
  for (const url of assets) {
    // Cloudflare caches these for four hours and the HTML not at all, so an
    // unversioned URL means a returning visitor gets new markup with old CSS
    // and every class added since renders unstyled.
    expect(url, url).toMatch(/\?v=[a-f0-9]{8}$/);
    expect((await request.get(url)).ok(), url).toBe(true);
  }
  // The hash has to follow the contents, not just be present.
  const built = fs.readFileSync("dist/index.html", "utf8");
  const crypto = require("crypto");
  for (const file of ["css/style.css", "css/fonts.css"]) {
    const stamped = built.match(
      new RegExp(`/${file.replace(".", "\\.")}\\?v=([a-f0-9]{8})`),
    )[1];
    const expected = crypto
      .createHash("sha1")
      .update(fs.readFileSync(`src/${file}`))
      .digest("hex")
      .slice(0, 8);
    expect(stamped, file).toBe(expected);
  }
  // Each sheet is linked in its own right. An @import would hide fonts.css
  // behind style.css and put a second round trip in front of the first paint.
  expect(
    await page.evaluate(
      () => document.querySelectorAll('link[rel="stylesheet"]').length,
    ),
  ).toBe(2);
});

test("the nav is a hamburger on a phone and a row on a desktop", async ({
  page,
}, testInfo) => {
  const mobile = testInfo.project.name === "mobile";
  await page.goto("/");
  const toggle = page.locator(".nav-toggle");
  const links = page.locator(".site-header nav a");
  await expect(links).toHaveCount(5);

  if (!mobile) {
    // On a wide screen there is no hamburger at all and the links are a row.
    await expect(toggle).toBeHidden();
    await expect(links.first()).toBeVisible();
    return;
  }

  await expect(toggle).toBeVisible();
  await expect(links.first()).toBeHidden();
  // A thumb has to be able to hit it.
  const hit = await toggle.boundingBox();
  expect(hit.height).toBeGreaterThanOrEqual(40);

  await toggle.click();
  await expect(links.first()).toBeVisible();
  // Big enough to read, and each row big enough to tap.
  const size = await links
    .first()
    .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  expect(size).toBeGreaterThanOrEqual(15);
  for (const box of await links.evaluateAll((all) =>
    all.map((el) => el.getBoundingClientRect().height),
  ))
    expect(box).toBeGreaterThanOrEqual(40);
  // The panel must not push the page sideways.
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBe(true);
  await page.screenshot({ path: "test-results/nav-open-mobile.png" });

  await page.keyboard.press("Escape");
  await expect(links.first()).toBeHidden();
  await toggle.click();
  await expect(links.first()).toBeVisible();
  // A tap on the page behind it means "I am done with this" — below the
  // panel, and in the gutter so nothing else takes the tap.
  const panel = await page.locator(".site-header nav").boundingBox();
  await page.mouse.click(8, panel.y + panel.height + 40);
  await expect(links.first()).toBeHidden();

  // And it still navigates.
  await toggle.click();
  await links.filter({ hasText: "Calendar" }).click();
  await expect(page).toHaveURL(/calendar/);
});

test("without JavaScript every nav link is still reachable", async ({
  browser,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  // The menu is rendered open, so script collapsing it is an enhancement
  // rather than the only way in.
  await expect(page.locator(".site-header nav a").first()).toBeVisible();
  await expect(page.locator(".nav-menu")).toHaveAttribute("open", "");
  await context.close();
});
