const { test, expect } = require("@playwright/test");

test("a show's link preview is its own artwork, as a JPEG", async ({
  page,
  request,
}) => {
  await page.goto("/");
  const card = page.locator("#events-grid .event-card:visible").first();
  const href = await card.locator(".event-card-thumb").getAttribute("href");
  const title = (await card.locator("h3").innerText()).trim();

  await page.goto(href);
  const meta = (property) =>
    page.locator(`meta[property="${property}"]`).getAttribute("content");
  const image = await meta("og:image");

  // Every show used to share one portrait photograph of an old production,
  // which Facebook then cropped into a sliver beside this show's title.
  expect(image).toMatch(
    /^https:\/\/glasgowtheatre\.com\/images\/og\/[0-9a-f]{20}\.jpg$/,
  );
  expect(await meta("og:image:type")).toBe("image/jpeg");
  expect(await meta("og:image:width")).toBe("1200");
  expect(await meta("og:image:height")).toBe("630");
  // The alt text belongs to this page, not to whatever the card shows.
  expect(await meta("og:image:alt")).toContain(title);
  expect(
    await page.locator('meta[name="twitter:image"]').getAttribute("content"),
  ).toBe(image);

  // A preview a platform cannot fetch is no preview at all.
  const response = await request.get(new URL(image).pathname);
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("image/jpeg");
  expect((await response.body()).subarray(0, 2).toString("hex")).toBe("ffd8");
});

test("a page without artwork still offers a landscape preview", async ({
  page,
  request,
}) => {
  await page.goto("/about.html");
  const image = await page
    .locator('meta[property="og:image"]')
    .getAttribute("content");
  expect(image).toMatch(/^https:\/\/glasgowtheatre\.com\/images\/og\//);
  expect(await page.locator('meta[property="og:image:width"]').getAttribute("content")).toBe("1200");
  const response = await request.get(new URL(image).pathname);
  expect(response.status()).toBe(200);
});
